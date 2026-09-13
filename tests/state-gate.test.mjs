// state-gate.test.mjs —— 【4-A3 / 4-A4】AI 世界变更闸门的单元测试
//
// 为什么这些断言必须在 Node 里跑（而不是浏览器）：
//   `state-gate.ts` 是**纯函数**（不 import store / DOM / 网络），因此它的契约可以在
//   没有浏览器的情况下被完整验证 —— 快、确定、不依赖虚拟时钟。
//   浏览器侧另有 e2e 断言验证"闸门真的接在生产路径上"（见 render-boundary phase 5）。
//
// 运行：node tests/state-gate.test.mjs

import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

// ===== 打包 state-gate（纯 TS，零浏览器 API 依赖）=====
// 与 save-schema.test.mjs / voice-store.test.mjs 同一套约定：纯函数模块用 esbuild
// 打成一个临时 mjs 再 import，不引入任何运行时依赖。
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outfile = path.join(os.tmpdir(), `melody-state-gate.${process.pid}.${Date.now()}.mjs`);
buildSync({
    entryPoints: [path.join(root, "playground", "state-gate.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    outfile,
    logLevel: "warning",
});
const { MAX_SINGLE_STEP, applyMemoryOp, gateDimensionDelta, gateLocalDelta, gateMemoryUpdate } = await import(outfile);
// DIMENSIONS 需要从 state.ts 单独取（state-gate 只导出闸门函数）
const stateOut = path.join(os.tmpdir(), `melody-state.${process.pid}.${Date.now()}.mjs`);
buildSync({
    entryPoints: [path.join(root, "playground", "state.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    outfile: stateOut,
    logLevel: "warning",
});
const { DIMENSIONS } = await import(stateOut);

let passed = 0;
let failed = 0;
const check = (label, ok, detail = "") => {
    if (ok) {
        passed++;
        console.log(`  ✅ ${label}`);
    } else {
        failed++;
        console.log(`  ❌ ${label}${detail ? `  ← ${detail}` : ""}`);
    }
};

console.log("===== AI 世界变更闸门（4-A3 / 4-A4）=====");

// ---------- ① 维度白名单：AI 不能自行扩展状态字段 ----------
console.log("\n--- 维度白名单 ---");
{
    const r = gateDimensionDelta({ joy: 5, __injected: 3, affection: -2, 好感: 1 });
    check("合法维度通过", r.clean.joy === 5 && r.clean.affection === -2, JSON.stringify(r.clean));
    check("未知维度被丢弃（AI 不能扩展状态字段）", !("__injected" in r.clean) && !("好感" in r.clean));
    check(
        "被丢弃的条目带可诊断原因",
        r.rejected.length === 2 && r.rejected.every((x) => x.reason === "unknown-dimension"),
        JSON.stringify(r.rejected),
    );
}
{
    // 白名单必须与 DIMENSIONS 同源：38 个维度全部可通过
    const all = Object.fromEntries(DIMENSIONS.map((d) => [d.key, 1]));
    const r = gateDimensionDelta(all);
    check(`全部 ${DIMENSIONS.length} 个合法维度均通过`, Object.keys(r.clean).length === DIMENSIONS.length);
    check("白名单与 DIMENSIONS 同源（无手写清单漂移）", r.rejected.length === 0);
}

// ---------- ② 类型与有限性 ----------
console.log("\n--- 非法类型 / NaN / Infinity ---");
{
    const r = gateDimensionDelta({
        joy: "5",
        sadness: null,
        anger: NaN,
        fear: Infinity,
        disgust: -Infinity,
        surprise: undefined,
        trust: true,
    });
    check("非 number 类型全部丢弃", Object.keys(r.clean).length === 0, JSON.stringify(r.clean));
    const reasons = r.rejected.map((x) => x.reason);
    check(
        "原因分类正确（not-a-number / not-finite）",
        reasons.filter((x) => x === "not-a-number").length === 4 &&
            reasons.filter((x) => x === "not-finite").length === 3,
        JSON.stringify(r.rejected),
    );
    check("NaN 被显式丢弃（typeof NaN === 'number' 的陷阱）", !("anger" in r.clean));
    check("±Infinity 被显式丢弃", !("fear" in r.clean) && !("disgust" in r.clean));
}
{
    check("null 输入返回空结果（不抛错）", gateDimensionDelta(null).clean && Object.keys(gateDimensionDelta(null).clean).length === 0);
    check("非对象输入返回空结果", Object.keys(gateDimensionDelta("nope").clean).length === 0);
    check("undefined 输入返回空结果", Object.keys(gateDimensionDelta(undefined).clean).length === 0);
}

// ---------- ③ 单步上限（Phase 4-C 决策 3：契约统一为 ±15）----------
console.log("\n--- 单步上限（Prompt 与 Core 契约一致：±15）---");
{
    check("上限就是提示词承诺的 15（契约一致性）", MAX_SINGLE_STEP === 15, `${MAX_SINGLE_STEP}`);

    // 用户明确要求的四条边界断言
    const p16 = gateDimensionDelta({ joy: 16 });
    check("+16 → 夹到 +15（超出即夹取）", p16.clean.joy === 15, `${p16.clean.joy}`);
    const n16 = gateDimensionDelta({ joy: -16 });
    check("-16 → 夹到 -15", n16.clean.joy === -15, `${n16.clean.joy}`);
    const p15 = gateDimensionDelta({ joy: 15 });
    check("+15 → 合法，逐字保留", p15.clean.joy === 15, `${p15.clean.joy}`);
    const n15 = gateDimensionDelta({ joy: -15 });
    check("-15 → 合法，逐字保留", n15.clean.joy === -15, `${n15.clean.joy}`);

    // 夹取不是"拒绝"：值仍会落地（只是被收窄），且不出现在 rejected 里
    check("被夹取的条目仍会落地（夹取 ≠ 拒绝）", Object.keys(p16.clean).length === 1);
    check("被夹取的条目不出现在 rejected", p16.rejected.length === 0);

    // 极端值
    const huge = gateDimensionDelta({ joy: 1000, sadness: -1000 });
    check("极端正值夹到 +15", huge.clean.joy === 15, `${huge.clean.joy}`);
    check("极端负值夹到 -15", huge.clean.sadness === -15, `${huge.clean.sadness}`);
    const exact = gateDimensionDelta({ fear: MAX_SINGLE_STEP });
    check(`恰好等于上限（${MAX_SINGLE_STEP}）不被改动`, exact.clean.fear === MAX_SINGLE_STEP);
}
{
    // 正常对话量级（模型通常给 ±1~±8）必须完全不受影响
    const normal = { joy: 8, sadness: -5, anger: 3, trust: -2, affection: 1 };
    const r = gateDimensionDelta(normal);
    check("正常对话量级（±1~±8）逐值不变", JSON.stringify(r.clean) === JSON.stringify(normal), JSON.stringify(r.clean));
    check("正常量级不产生任何 rejected", r.rejected.length === 0);
}

// ---------- ④ 零值 ----------
console.log("\n--- 零值 ---");
{
    const r = gateDimensionDelta({ joy: 0, sadness: 2 });
    check("零值被丢弃（不污染 trace）", !("joy" in r.clean));
    check("零值的原因为 zero", r.rejected[0]?.reason === "zero");
    check("非零值不受影响", r.clean.sadness === 2);
}

// ---------- ⑤ 本地表走同一闸门 ----------
console.log("\n--- 本地规则表（gateLocalDelta）---");
{
    const r = gateLocalDelta({ affection: 1, trust: -1, __bogus: 9, joy: NaN });
    check("本地表同样丢弃未知维度", !("__bogus" in r.clean));
    check("本地表同样丢弃 NaN", !("joy" in r.clean));
    check("本地表保留合法值", r.clean.affection === 1 && r.clean.trust === -1);
    check(
        "本地表与 AI delta 使用同一个校验器（行为一致）",
        JSON.stringify(gateLocalDelta({ joy: 200 }).clean) === JSON.stringify(gateDimensionDelta({ joy: 200 }).clean),
    );
}

// ---------- ⑥ 记忆操作 ----------
console.log("\n--- 记忆操作（gateMemoryUpdate / applyMemoryOp）---");
{
    check("null → null", gateMemoryUpdate(null) === null);
    check("非对象 → null", gateMemoryUpdate("x") === null);
    check("content 非字符串 → null", gateMemoryUpdate({ action: "save", content: 1 }) === null);
    check("空白内容 → null", gateMemoryUpdate({ action: "save", content: "   " }) === null);
    check("超长内容截断到 60 字", gateMemoryUpdate({ content: "あ".repeat(100) })?.content.length === 60);
    check("未知 action 回落为 save", gateMemoryUpdate({ action: "delete", content: "x" })?.action === "save");
    check("forget 保留", gateMemoryUpdate({ action: "forget", content: "x" })?.action === "forget");
}
{
    const base = ["约定明天见面", "约定明天见面吧", "她喜欢桃子汽水"];
    const after = applyMemoryOp(base, { action: "forget", content: "约定明天见面" });
    check(
        "【核心】forget 精确删除单条（不再子串批量删除）",
        after.length === 2 && !after.includes("约定明天见面") && after.includes("约定明天见面吧"),
        JSON.stringify(after),
    );
    const save = applyMemoryOp(["a"], { action: "save", content: "b" });
    check("save 追加", JSON.stringify(save) === JSON.stringify(["a", "b"]));
    const dup = applyMemoryOp(["a"], { action: "save", content: "a" });
    check("save 去重（已存在则不重复添加）", JSON.stringify(dup) === JSON.stringify(["a"]));

    const many = Array.from({ length: 30 }, (_, i) => `m${i}`);
    const capped = applyMemoryOp(many, { action: "save", content: "new" });
    check("save 保持 30 条上限（超出丢最旧）", capped.length === 30 && capped[29] === "new" && !capped.includes("m0"));

    const empties = applyMemoryOp(base, { action: "forget", content: "不存在的记忆" });
    check("forget 不存在的内容时数组不变", empties.length === base.length);
}

console.log(`\n========== 状态闸门: ${passed} 通过 / ${failed} 失败 ==========`);
process.exit(failed === 0 ? 0 : 1);
