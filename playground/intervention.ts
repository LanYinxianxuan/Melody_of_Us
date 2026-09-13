// intervention.ts —— 支线 NPC 介入系统（两层）
// 第一层：程序规则筛选（成本 0）——地点/时间/关键词/关系/事件/冷却
// 第二层：AI 判断（成本 1 次调用）——只在规则筛出候选后，决定"是否出现/怎么出现"
// 原则：主角永远第一优先级；NPC 是世界的生命力，不是陪聊机器人。

import { store, saveState } from "./storage";
import { type NpcState, updateNpcSchedule, npcLearn, applyNpcDelta, npcScheduleAt } from "./npc";
import { goalKindOf, goalScoreBonus, isGoalRelevant, type NpcGoalKind } from "./npc-goal";
import { currentDayIndex, fmtVirtualTime, currentSchedule, herLocation } from "./time";

// ============ 介入模式 ============

export type InterventionMode = "join" | "message" | "mention" | "scene" | "none";

export interface InterventionCandidate {
    npc: NpcState;
    mode: InterventionMode;
    reason: string;
    score: number;
}

// ============ 第一层：程序规则筛选 ============

// 主角色名（从存档角色读，避免循环依赖——由 chat.ts 注入）
let mainNameGetter: () => string = () => "她";
let userNameGetter: () => string = () => "你";

export function setNpcNameGetters(main: () => string, user: () => string) {
    mainNameGetter = main;
    userNameGetter = user;
}

// NPC 当前是否在"主角所在场景"附近（同地点才可能直接加入/场景出现）
function npcIsNearby(npc: NpcState): boolean {
    const mainLoc = herLocation();
    const npcLoc = npc.location;
    // 场景地点互通：主角所在的场所（场景配置）+ 往返路上 视为同场景
    const s = store.scene;
    const zones = [s.place, `${s.place}附近`, "去" + s.place + "的路上"];
    if (zones.includes(mainLoc) && zones.includes(npcLoc)) return true;
    if (mainLoc === npcLoc) return true;
    // 路上相遇
    if (mainLoc === "去" + s.place + "的路上" && npcLoc === "去" + s.place + "的路上") return true;
    if (mainLoc === "回家的路上" && npcLoc === "回家的路上") return true;
    if (mainLoc === "家" && npcLoc === "家") return true;
    return false;
}

// 夜间/睡眠时段：NPC 不活跃
function npcIsAwake(npc: NpcState): boolean {
    return npc.label !== "深夜" && !npc.activity.includes("睡");
}

// 判断关键词是否命中最近对话
function keywordHit(npc: NpcState, recentText: string): boolean {
    return npc.profile.keywords.some((k) => recentText.includes(k));
}

/**
 * 【Phase 4-D 决策 C-1】最近一次筛选里每个 NPC 的 goal 相关性判定结果。
 *
 * 为什么记录它：`goalBonus` 是"相关才可能为 12"的，因此**只看分数无法区分**
 * "不相关（0）"与"相关但没掷中（0）"。测试与诊断都需要能直接读出判定本身。
 * 这是纯观测数据，不参与任何逻辑。
 */
export const lastGoalRelevance = new Map<
    string,
    { relevant: boolean; bonus: number; kind: NpcGoalKind | null }
>();

// 主函数：输入最近对话文本 + 虚拟时间，输出候选 NPC 列表（带介入模式与理由）
export function screenNpcCandidates(recentText: string): InterventionCandidate[] {
    const candidates: InterventionCandidate[] = [];
    // 【C-1】每次筛选重置观测记录，避免读到上一轮的陈旧判定
    lastGoalRelevance.clear();

    for (const npc of Object.values(store.npcs)) {
        // 已经在场：不重复触发（由在场管理处理离场）
        if (npc.present) continue;

        // 1. 时间合理性：晚上该睡觉的 NPC 不出现
        if (!npcIsAwake(npc)) continue;

        // 2. 更新她的当前作息（位置/活动随虚拟时间变化）
        updateNpcSchedule(npc, store.virtualMs, store.dayBaseMs);

        // 3. 冷却：最近刚参与过（虚拟时间 6 小时内）不反复出现
        if (store.virtualMs - npc.lastActiveAt < 6 * 3600000 && npc.lastActiveAt > 0) continue;

        let score = 0;
        let mode: InterventionMode = "none";
        let reason = "";

        // 关键词命中（提到她）→ 高概率介入
        const hit = keywordHit(npc, recentText);
        if (hit) {
            score += 30;
            reason = `你们聊到了${npc.profile.name}`;
            // 在同一场景 → 直接出现；不在 → 发消息
            mode = npcIsNearby(npc) ? "join" : "message";
        }

        // 地点相遇：她在主角所在场景 → 可能路过/打招呼
        if (npcIsNearby(npc)) {
            score += 20;
            reason = reason || `${npc.profile.name}恰好也在${npc.location}`;
            mode = mode === "none" ? "scene" : mode;
        }

        // 关系：和主角关系好 → 更可能主动
        if (npc.relToMain > 60) score += 10;
        if (npc.relToUser > 50) score += 5;

        // 剧情相关：当前剧情线提到她
        // 先取本地快照：store 是可变的，闭包内 TS 无法保持 activeThread 的非空收窄
        const activeThread = store.activeThread;
        if (activeThread && npc.profile.keywords.some((k) => activeThread.includes(k))) {
            score += 15;
            reason = reason || `和你们之间的事有关`;
        }

        // 她有自己的目标/心事 → 若**与本次候选场景相关**，才可能主动找主角
        //
        // 【Phase 4-D 决策 C-1】语义修正：
        //   修复前是 `if (npc.goal && Math.random() < 0.25) score += 12` ——
        //   而全部内置 NPC 都带 goal → 条件**恒为真** → 等价于"每次筛选无条件 25% 概率 +12"，
        //   goal 的文本内容从不参与判断。
        //
        //   现在：先判断"她的目标与这次场景是否基本相关"（`isGoalRelevant`，纯显式映射，
        //   无 NLP / 无 LLM）；只有相关时才允许掷原本那个 25% 的骰子。
        //
        //   边界（务必保持）：goal **只影响候选评分**，不决定"能否介入"，
        //   也**不能**绕过下方的 Core 世界安全守卫。
        const goalCtx = {
            goal: npc.goal,
            goalKind: npc.profile.goalKind ?? null,
            keywordHit: hit,
            nearby: npcIsNearby(npc),
            relationContext: PRIVATE_TOPIC_PATTERN.test(recentText),
        };
        const goalBonus = goalScoreBonus(goalCtx, () => Math.random());
        lastGoalRelevance.set(npc.profile.id, {
            relevant: isGoalRelevant(goalCtx),
            bonus: goalBonus,
            kind: goalKindOf(goalCtx.goal, goalCtx.goalKind),
        });
        if (goalBonus > 0) {
            score += goalBonus;
            reason = reason || `${npc.profile.name}心里有事想找${mainNameGetter()}`;
            mode = mode === "none" ? "message" : mode;
        }

        // 事件随机性：极低的基础概率（世界是活的，但不打扰）
        score += Math.random() * 8;

        // 场景私密保护：深夜/私人话题不加 NPC
        if (store.presentNpcs.length === 0 && currentSchedule().label === "深夜") score = 0;
        // 私人话题关键词（亲密/秘密）→ 不介入
        if (PRIVATE_TOPIC_PATTERN.test(recentText)) score = 0; // 【4-B3】与 Core 守卫共用同一份规则

        // 阈值：≥25 才够格进入第二层
        if (score >= 25) {
            candidates.push({ npc, mode, reason, score });
        }
    }

    // 排序：分数高的优先
    candidates.sort((a, b) => b.score - a.score);
    return candidates;
}

// ============ 【4-B3】Core 安全守卫（供任意入口复用）============
//
// 为什么需要它：Director 路径（`chat.ts` 的 `executeDirectorDecision`）以 `score: 100`
// 直接调 `runNpcIntervention`，**绕过了 `screenNpcCandidates` 里的全部检查** ——
// 包括那些与世界安全有关的规则（深夜保护、私密话题、参与者合法性）。
//
// 关键区分（这是 4-B3 的核心裁决）：
//   · **世界安全规则** → 任何入口都必须遵守（深夜保护 / 私密话题 / NPC 合法性与在场）：
//       它们保证"世界里不会发生不该发生的事"。
//   · **调度条件** → 只属于 Director 的调度语义（6 小时冷却 / 概率门）：
//       它们表达的是"多久尝试一次"，不是"合不合法"。
//       Director 的介入天然只发生在跨天与离线回归这两个时刻，
//       若也套用 6 小时冷却与概率门，跨天/离线介入会**直接失效**，
//       等于把已批准的功能关掉 —— 因此**不由 Core 阻断**。
//
// 本函数只做"世界安全"判定，不做任何概率与冷却判断。纯函数（除读取 store 的既有状态）。

/** 私密话题正则：与 `screenNpcCandidates` 使用同一份规则（单一来源） */
export const PRIVATE_TOPIC_PATTERN = /喜欢你|我爱你|亲你|抱你|秘密|心里话/;

export interface InterventionSafety {
    ok: boolean;
    /** 不合法时的原因（可诊断，供日志与测试断言） */
    reason?: "unknown-npc" | "npc-present" | "npc-asleep" | "late-night" | "private-topic" | "npc-busy";
}

/**
 * 世界安全守卫：判断"此刻让这个 NPC 介入"是否合法。
 *
 * @param npcId        被提议的 NPC id（Director 提供）
 * @param recentText   当前语境文本（用于私密话题判定；无则传空串）
 * @param opts.npcBusy 调用方已知的"另一个介入正在进行"
 */
export function checkInterventionSafety(
    npcId: string | null | undefined,
    recentText: string,
    opts: { npcBusy?: boolean } = {},
): InterventionSafety {
    if (opts.npcBusy) return { ok: false, reason: "npc-busy" };

    // 参与者合法性：不存在的 NPC / 未指定参与者
    if (typeof npcId !== "string" || !npcId) return { ok: false, reason: "unknown-npc" };
    const npc = store.npcs[npcId];
    if (!npc) return { ok: false, reason: "unknown-npc" };

    // 已经在场：不重复触发
    if (npc.present) return { ok: false, reason: "npc-present" };

    // 深夜保护：她该睡觉了（沿用 NPC 自己的作息标签，与常规路径同一判据）
    const label = npc.label !== "" ? npc.label : npcScheduleAt(npc, store.virtualMs, store.dayBaseMs).label;
    if (label === "深夜" || npc.activity.includes("睡")) return { ok: false, reason: "npc-asleep" };

    // 场景私密保护：深夜独处 / 私密话题不加 NPC
    if (store.presentNpcs.length === 0 && currentSchedule().label === "深夜") {
        return { ok: false, reason: "late-night" };
    }
    if (PRIVATE_TOPIC_PATTERN.test(recentText)) return { ok: false, reason: "private-topic" };

    return { ok: true };
}

// ============ 第二层：AI 判断 + 执行 ============

// 执行介入：对候选 NPC 决定是否真的介入（概率 + 随机），返回实际介入的 NPC 与模式
export function decideIntervention(candidates: InterventionCandidate[], recentText: string, publicRecent: { role: string; content: string }[]): InterventionCandidate | null {
    if (!candidates.length) return null;

    // 最多只介入 1 个（保持主角核心）
    const top = candidates[0]!;

    // 概率：按分数换算，分数越高越可能真的出现
    const chance = Math.min(0.55, 0.2 + top.score / 100);
    if (Math.random() > chance) return null;

    // 记录参与时间
    top.npc.lastActiveAt = store.virtualMs;
    return top;
}

// 构造"公开对话"（NPC 能听到的部分：最近几句，不含用户私密输入——MVP：全部公开，由场景判断）
export function buildPublicRecent(count = 4): { role: string; content: string }[] {
    return store.chatHistory.slice(-count).map((e) => ({
        role: e.role,
        content: e.content,
    }));
}

// NPC 介入后：处理她的发言结果（情绪/记忆/关系/离场）
export function applyNpcResult(npc: NpcState, result: { delta: Record<string, number>; learn?: string; leave?: boolean }) {
    // 情绪/关系变化
    applyNpcDelta(npc, result.delta ?? {});

    // 她新知道的事
    if (result.learn) npcLearn(npc, result.learn);

    // 关系变化记录
    if (Math.abs(result.delta?.relToMain ?? 0) >= 3 || Math.abs(result.delta?.relToUser ?? 0) >= 3) {
        npc.history.push(
            `第${currentDayIndex()}天 ${fmtVirtualTime()}：对${mainNameGetter()}${(result.delta?.relToMain ?? 0) >= 0 ? "好感上升" : "有些疏远"}，对${userNameGetter()}${(result.delta?.relToUser ?? 0) >= 0 ? "好感上升" : "有些疏远"}`,
        );
        if (npc.history.length > 30) npc.history = npc.history.slice(-30);
    }

    // 离场：说完后默认离开（恢复二人对话；除非 AI 明确 leave:false 表示她继续留下）
    const shouldLeave = result.leave !== false;
    if (shouldLeave && npc.present) {
        npc.present = false;
        store.presentNpcs = store.presentNpcs.filter((id) => id !== npc.profile.id);
    }

    saveState();
}

// ============ 被动的世界变化（无 AI 成本） ============

// NPC 自己过日子：随时间推进，更新她们的位置/活动（纯程序，0 成本）
export function tickNpcWorld() {
    for (const npc of Object.values(store.npcs)) {
        updateNpcSchedule(npc, store.virtualMs, store.dayBaseMs);
    }
}
