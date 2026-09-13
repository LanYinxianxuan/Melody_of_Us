// state-gate.ts —— 【4-A3 / 4-A4】AI 世界变更的唯一闸门
//
// 原则（`GAMEPLAY_ARCHITECTURE_REVIEW.md` §8 R3、`GAMEPLAY_CONTRACT.md` 第一原则）：
//   **Core 决定世界中什么真正发生；AI 只能提出意图。**
//
// 缺陷原貌：AI 的数值修改散落在多处，各自为政：
//   · `chat.ts` 主回复 `applyDelta(result.delta)` —— 有维度白名单 + clamp(0,100)，**无单步上限**
//   · `chat.ts` `USER_EMOTION_FIX` 查表 —— 数值来自本地表（安全），但绕过 applyDelta 直写
//   · `chat.ts` Director `relationshipEffect` —— 有 δ∈[-10,10]，但**与上一条不是同一个校验器**
//   · `npc.ts` `applyNpcDelta` —— 有自己的白名单循环与 clamp
//   · `intervention.ts` `applyNpcResult` —— 又一层
//   于是"同一个概念（情绪增量）"在四个地方有四种校验强度。
//
// 本模块把**校验**收敛为纯函数，四个调用点改为调用它。
// **不改变任何现有阈值语义**（见 §"单步上限"说明），只把"散落的检查"变成"同一份检查"。
//
// 纯函数：不 import store / DOM / 网络，可直接单测。

import { DIMENSIONS } from "./state";

/** 合法维度的闭集（由 38 维定义派生，不是手写清单——避免与 state.ts 漂移） */
const DIM_KEYS: ReadonlySet<string> = new Set(DIMENSIONS.map((d) => d.key));

/**
 * 单步最大变化量 = **15**。
 *
 * 【Phase 4-C 决策 3】Prompt 与 Core 的契约现已一致：
 *   · `response-template.ts` 的提示词一直写着「每维 -15~15」；
 *   · 而修复前 `state.ts:applyDelta` **没有任何幅度上限**（模型返回 100 就推满）——
 *     这是"AI Contract 与 Core Enforcement 不一致"。
 *   · Phase 4-A 先把它实现为安全上限 25（宽于承诺）；
 *     Phase 4-C 收紧到 **15**，与提示词**逐字一致**。
 *
 * 语义边界（未触碰任何玩法数值）：
 *   · 只夹取**单笔 AI 提议的增量**。绝对值区间（0–100）仍由 `state.ts:clamp` 负责。
 *   · 未改 38D 公式、未改衰减系数、未改关系公式、未改初值、未改任何阈值。
 *   · 正常对话量级（模型通常给 ±1~±8）**完全不受影响**（有专门断言）。
 */
export const MAX_SINGLE_STEP = 15;

/** 一次校验的结果，带可观测的丢弃原因（便于调试与测试断言） */
export interface GateResult {
    /** 通过校验的维度增量 —— 可直接交给 `applyDelta` */
    clean: Record<string, number>;
    /** 被拒绝的原始条目（键 → 原因），用于 console 诊断与测试 */
    rejected: { key: string; value: unknown; reason: GateReason }[];
}

export type GateReason =
    | "unknown-dimension" // 不在 38 维闭集里（AI 不能自行扩展状态字段）
    | "not-a-number" // 类型非法
    | "not-finite" // NaN / ±Infinity
    | "zero"; // 值为 0（无意义，丢弃以免污染 trace）

/**
 * 校验一份「AI 提出的维度增量」。
 *
 * 依次执行（顺序即优先级）：
 *   ① 键必须属于 38 维闭集        —— 非法维度丢弃
 *   ② 值必须是 `number` 类型      —— 非法类型丢弃
 *   ③ 值必须有限（`isFinite`）    —— NaN / ±Infinity 丢弃
 *   ④ 值为 0 丢弃（无意义）
 *   ⑤ 单步幅度夹到 `[-MAX_SINGLE_STEP, +MAX_SINGLE_STEP]`
 *
 * 注意：**不在此处 clamp 0–100**。绝对值夹取属于 `state.ts:clamp` 的职责
 * （它知道每个维度的合法区间），本函数只管"这一笔增量合不合法"。
 * 两者职责分离，避免"夹两次"在某些维度上产生不同结果。
 */
export function gateDimensionDelta(raw: unknown): GateResult {
    const clean: Record<string, number> = {};
    const rejected: GateResult["rejected"] = [];

    if (raw === null || typeof raw !== "object") {
        return { clean, rejected };
    }

    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
        if (!DIM_KEYS.has(key)) {
            rejected.push({ key, value, reason: "unknown-dimension" });
            continue;
        }
        if (typeof value !== "number") {
            rejected.push({ key, value, reason: "not-a-number" });
            continue;
        }
        if (!Number.isFinite(value)) {
            rejected.push({ key, value, reason: "not-finite" });
            continue;
        }
        if (value === 0) {
            rejected.push({ key, value, reason: "zero" });
            continue;
        }
        clean[key] = Math.max(-MAX_SINGLE_STEP, Math.min(MAX_SINGLE_STEP, value));
    }

    return { clean, rejected };
}

/**
 * 把「本地规则表」（如 `USER_EMOTION_FIX`）也纳入同一闸门。
 *
 * 为什么本地表也要过闸门：这些数值虽然由代码给出（安全），但它们**绕过 `applyDelta`
 * 直写 `aiState`**（`chat.ts` 的 `USER_EMOTION_FIX` 循环）。统一走闸门之后，
 * "AI 提议"与"本地规则"共享同一套合法性检查，未来任何一方出问题都能在同一处拦住。
 */
export function gateLocalDelta(raw: Record<string, number | undefined>): GateResult {
    return gateDimensionDelta(raw);
}

/**
 * 对 AI 的 `memoryUpdate.content` 做统一净化。
 *
 * 缺陷原貌：Director 的 `memoryUpdate.content` 由 `director.ts` 单独截断到 60 字，
 * 而 `forget` 分支用 `store.memories.filter(x => !x.includes(m))` ——
 * **一个短子串可以一次删掉多条记忆**（`GAMEPLAY_ARCHITECTURE_REVIEW.md` P2.12）。
 */
export interface MemoryOp {
    action: "save" | "forget";
    content: string;
}

/**
 * 净化一条记忆操作。
 * @returns 净化后的操作；内容为空则返回 null（调用方应跳过）
 */
export function gateMemoryUpdate(raw: unknown): MemoryOp | null {
    if (raw === null || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    if (typeof r.content !== "string") return null;
    const content = r.content.trim().slice(0, 60);
    if (!content) return null;
    return { action: r.action === "forget" ? "forget" : "save", content };
}

/**
 * 精确删除一条记忆（取代 `includes` 子串批量删除）。
 *
 * 语义变化说明：修复前 `forget` 是"删掉所有**包含**该子串的记忆"，
 * 现在是"删掉**完全等于**该内容的记忆"。
 * 这是**安全性收紧**：AI 给出一个短串不再能一次抹掉多条记录。
 * ⚠️ 它改变了 `forget` 的行为语义 → 已记录为 `GAMEPLAY_REVIEW.md` 的 `G-6`。
 * 注意：`save` 的去重逻辑（`!memories.includes(m)`）本身是精确匹配，不受影响。
 */
export function applyMemoryOp(memories: string[], op: MemoryOp): string[] {
    if (op.action === "save") {
        if (memories.includes(op.content)) return memories;
        const next = [...memories, op.content];
        return next.length > 30 ? next.slice(-30) : next;
    }
    return memories.filter((x) => x !== op.content);
}
