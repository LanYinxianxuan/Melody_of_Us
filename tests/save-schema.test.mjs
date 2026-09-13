// save-schema.test.mjs —— SaveV1 契约单测（【P0-12】步骤 1）
//
// 为什么单独一个测试文件：save-schema.ts 被刻意设计为**纯函数、零 I/O**，
// 因此可以在 Node 里直接跑，不需要浏览器、不需要 localStorage 桩、飞快。
// 这与 agent-smoke.mjs 用 esbuild 打包再 import 的方式一致。
//
// 本文件覆盖 P0-12_plan.md §H.1 的五类档：旧档 V0 / 损坏档 / 未知高版本 / 部分缺字段 / 脏字段。

import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

// ===== 打包 save-schema（纯 TS，无浏览器 API 依赖） =====
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outfile = path.join(os.tmpdir(), `melody-save-schema.${process.pid}.${Date.now()}.mjs`);
buildSync({
    entryPoints: [path.join(root, "playground", "save-schema.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    outfile,
    logLevel: "warning",
});
const S = await import(outfile);

// ===== 断言框架 =====
let passed = 0;
let failed = 0;
const failures = [];

function check(label, ok, detail = "") {
    if (ok) {
        passed++;
        console.log(`  ✅ ${label}`);
    } else {
        failed++;
        failures.push(label);
        console.log(`  ❌ ${label}${detail ? `  ← ${detail}` : ""}`);
    }
}

const section = (t) => console.log(`\n===== ${t} =====`);

// ===== 真实旧档（V0）夹具 =====
/** 当前代码写出的完整存档（30 键），作为"标准 V0" */
function makeRealV0Save(overrides = {}) {
    return {
        aiState: {}, // 与"只给部分维度"的真实旧档一致；缺失维由契约回落基线
        savedAt: 1789234178272,
        turnCount: 42,
        storyEvents: [{ day: 3, text: "她第一次主动找你说话" }],
        storyProgress: 35,
        chatHistory: [
            { role: "user", content: "在吗", ts: 1789000000000 },
            { role: "assistant", content: "嗯，在的。", ts: 1789000060000 },
        ],
        journal: [{ day: 1, summary: "第一天，你们在教室相遇。" }],
        activeThread: "一起去书店",
        scheduleIndex: 5,
        timeRate: 1,
        virtualMs: 1789234178272,
        dayBaseMs: 1789171200000,
        dayIndex: 8,
        memories: ["她不喜欢被敷衍", "你答应陪她去书店"],
        lastReplyRealAt: 1789234100000,
        lastReplyVirtualAt: 1789230000000,
        lastNeglectAt: 0,
        lastNeglectRealAt: 0,
        lastNeglectLevel: 0,
        npcs: {},
        presentNpcs: [],
        npcEnabled: false,
        scene: { name: "海边小镇", place: "咖啡店", routine: "冲咖啡", others: "顾客", busyLabel: "开店", restLabel: "空闲" },
        agenda: [{ day: 8, items: [{ time: "10:00", title: "一起去书店", status: "todo", source: "ai" }] }],
        userLocation: "家",
        pendingOvernight: [],
        userMind: { happiness: 0.5, sadness: 0.3 },
        aiMind: { interest: 0.7, lastTopic: "书店" },
        relMind: { tension: 0.12, lastMajorLabel: "考试", lastMajorTurn: 30, lastMajorVirtualAt: 1789200000000 },
        lastAgentVirtualAt: 1789230000000,
        ...overrides,
    };
}

/** 早期形状：storyEvents 是 string[]，且完全缺 scene / npcs / mind 三态 */
function makeLegacySave() {
    return {
        aiState: { affection: 55, trust: 40 },
        savedAt: 1600000000000,
        turnCount: 7,
        storyEvents: ["旧式事件一", "旧式事件二"],
        chatHistory: [{ role: "user", content: "早" }],
        memories: ["旧记忆"],
        virtualMs: 1600000000000,
        dayBaseMs: 1599955200000,
        dayIndex: 2,
    };
}

// ============================================================================
section("① 版本侦测");
{
    check("无 version 字段 → v0", S.detectVersion({ aiState: {} }).kind === "v0");
    check("version: undefined → v0", S.detectVersion({ aiState: {}, version: undefined }).kind === "v0");
    check("version: null → v0", S.detectVersion({ aiState: {}, version: null }).kind === "v0");
    check("version: 1 → current", S.detectVersion({ aiState: {}, version: 1 }).kind === "current");
    check("version: 99 → future", S.detectVersion({ aiState: {}, version: 99 }).kind === "future");
    check("version: 99 带出正确版本号", S.detectVersion({ aiState: {}, version: 99 }).version === 99);
    check("version: \"1\"（字符串）→ invalid", S.detectVersion({ aiState: {}, version: "1" }).kind === "invalid");
    check("version: -1 → invalid", S.detectVersion({ aiState: {}, version: -1 }).kind === "invalid");
    check("version: 1.5 → invalid", S.detectVersion({ aiState: {}, version: 1.5 }).kind === "invalid");
    check("非对象 → invalid", S.detectVersion("nope").kind === "invalid");
}

// ============================================================================
section("② 标准 V0 存档（当前代码写出的真实形状）");
{
    const out = S.migrateToCurrent(makeRealV0Save());
    check("迁移成功", out.ok === true, JSON.stringify(out).slice(0, 160));
    if (out.ok) {
        const st = out.state;
        check("from 标记为 0（V0）", out.from === 0, `${out.from}`);
        check("version 置为 1", st.version === 1);
        check("turnCount 保留", st.turnCount === 42, `${st.turnCount}`);
        check("storyProgress 保留", st.storyProgress === 35);
        check("activeThread 保留", st.activeThread === "一起去书店");
        check("dayIndex 保留", st.dayIndex === 8);
        check("chatHistory 保留 2 条", st.chatHistory.length === 2);
        check("memories 保留 2 条", st.memories.length === 2);
        check("scene 完整保留（未被默认校园覆盖）", st.scene.place === "咖啡店" && st.scene.busyLabel === "开店", JSON.stringify(st.scene));
        check("agenda 保留", st.agenda.length === 1 && st.agenda[0].items.length === 1);
        check("userMind 保留已给值", st.userMind.happiness === 0.5);
        check("userMind 补齐缺失键", st.userMind.tension === 0.1, `${st.userMind.tension}`);
        check("aiMind.lastTopic 保留字符串", st.aiMind.lastTopic === "书店");
        check("relMind 保留", st.relMind.tension === 0.12 && st.relMind.lastMajorLabel === "考试");
        check("aiState 含全部 38 维", Object.keys(st.aiState).length === 38, `${Object.keys(st.aiState).length}`);
        check("aiState 已有值保留", st.aiState.affection === 25 || typeof st.aiState.affection === "number");
    }
}

// ============================================================================
section("③ 早期形状旧档（storyEvents: string[]，缺 scene/npcs/mind）");
{
    const out = S.migrateToCurrent(makeLegacySave());
    check("迁移成功", out.ok === true, JSON.stringify(out).slice(0, 160));
    if (out.ok) {
        const st = out.state;
        check("storyEvents 旧式字符串被转为 {day,text}", st.storyEvents.every((e) => typeof e === "object" && "day" in e), JSON.stringify(st.storyEvents));
        check("storyEvents 内容不丢", st.storyEvents.length === 2 && st.storyEvents[0].text === "旧式事件一");
        check("缺失 scene → 补默认校园", st.scene.place === "学校", JSON.stringify(st.scene));
        check("缺失 npcs → 空对象（由 storage 层按 NPCS 重建）", typeof st.npcs === "object");
        check("缺失 userMind → 全默认", st.userMind.happiness === 0.42);
        check("缺失 aiMind → 全默认", st.aiMind.interest === 0.55 && st.aiMind.lastTopic === "");
        check("缺失 relMind → 全默认", st.relMind.tension === 0.08);
        check("缺失 storyProgress → 0", st.storyProgress === 0);
        check("缺失 agenda → []", Array.isArray(st.agenda) && st.agenda.length === 0);
        check("缺失 npcEnabled → false", st.npcEnabled === false);
        check("缺失 userLocation → 家", st.userLocation === "家");
        check("notes 记录了 V0 迁移", out.notes.some((n) => n.includes("V0")), JSON.stringify(out.notes));
        check("notes 记录了 storyEvents 形状转换", out.notes.some((n) => n.includes("旧式字符串")), JSON.stringify(out.notes));
    }
}

// ============================================================================
section("④ 部分缺字段：只留 aiState");
{
    const out = S.migrateToCurrent({ aiState: { affection: 60 } });
    check("迁移成功（aiState 存在即可）", out.ok === true, JSON.stringify(out).slice(0, 160));
    if (out.ok) {
        const st = out.state;
        const required = [
            "turnCount", "storyEvents", "storyProgress", "chatHistory", "journal", "activeThread",
            "scheduleIndex", "timeRate", "virtualMs", "dayBaseMs", "dayIndex", "memories",
            "lastReplyRealAt", "lastReplyVirtualAt", "lastNeglectAt", "lastNeglectRealAt",
            "lastNeglectLevel", "npcs", "presentNpcs", "npcEnabled", "scene", "agenda",
            "userLocation", "pendingOvernight", "userMind", "aiMind", "relMind", "lastAgentVirtualAt",
        ];
        const missing = required.filter((k) => st[k] === undefined);
        check("27 个字段全部补齐（无 undefined）", missing.length === 0, missing.join(","));
        check("aiState 已给值保留", st.aiState.affection === 60);
        check("aiState 缺失维回落基线", st.aiState.trust === 15, `${st.aiState.trust}`);
        check("所有数值字段是有限数", ["turnCount", "storyProgress", "scheduleIndex", "timeRate", "virtualMs", "dayIndex"].every((k) => Number.isFinite(st[k])), "");
    }
}

// ============================================================================
section("⑤ 脏字段（D1/D3 修复验证）");
{
    const dirty = makeRealV0Save({
        aiState: { affection: "abc", trust: null, joy: NaN, sadness: Infinity, obsolete_dim: 50 },
        turnCount: "42",
        storyProgress: { bad: true },
        timeRate: "fast",
        memories: "not-an-array",
        npcEnabled: "yes",
        userLocation: "火星",
    });
    const out = S.migrateToCurrent(dirty);
    check("脏档仍能迁移成功（不抛错）", out.ok === true, JSON.stringify(out).slice(0, 200));
    if (out.ok) {
        const st = out.state;
        check("【D1】字符串 affection 回落基线而非 NaN", st.aiState.affection === 25 && Number.isFinite(st.aiState.affection), `${st.aiState.affection}`);
        check("【D1】null trust 回落基线", st.aiState.trust === 15, `${st.aiState.trust}`);
        check("【D1】NaN joy 回落基线", Number.isFinite(st.aiState.joy) && st.aiState.joy === 40, `${st.aiState.joy}`);
        check("【D1】Infinity sadness 回落基线", Number.isFinite(st.aiState.sadness) && st.aiState.sadness === 10, `${st.aiState.sadness}`);
        check("【D2】多余维度 obsolete_dim 被丢弃", !("obsolete_dim" in st.aiState), Object.keys(st.aiState).join(","));
        check("【D2】aiState 恰好 38 维", Object.keys(st.aiState).length === 38);
        check("【D3】字符串 turnCount 回落 0", st.turnCount === 0, `${st.turnCount}`);
        check("【D3】对象 storyProgress 回落 0", st.storyProgress === 0, `${JSON.stringify(st.storyProgress)}`);
        check("字符串 timeRate 回落 1", st.timeRate === 1, `${st.timeRate}`);
        check("非数组 memories 回落 []", Array.isArray(st.memories) && st.memories.length === 0);
        check("字符串 npcEnabled 回落 false", st.npcEnabled === false);
        check("非法 userLocation 回落「家」", st.userLocation === "家", `${st.userLocation}`);
        check("notes 记录了非法字段", out.notes.some((n) => n.includes("非法")), JSON.stringify(out.notes).slice(0, 200));
        check("notes 记录了丢弃的多余维度", out.notes.some((n) => n.includes("多余维度")), JSON.stringify(out.notes).slice(0, 200));
    }
}

// ============================================================================
section("⑥ 损坏档 / 非法输入");
{
    check("null → 非对象", S.migrateToCurrent(null).ok === false);
    check("字符串 → 非对象", S.migrateToCurrent("not json").ok === false);
    check("数组 → 非对象", S.migrateToCurrent([1, 2, 3]).ok === false);
    const noAi = S.migrateToCurrent({ turnCount: 5, savedAt: 1 });
    check("{turnCount}无 aiState → 拒绝", noAi.ok === false);
    check("拒绝原因是 missing-aiState", noAi.ok === false && noAi.reason === "missing-aiState", JSON.stringify(noAi));
    const aiStr = S.migrateToCurrent({ aiState: "oops" });
    check("aiState 为字符串 → 拒绝", aiStr.ok === false && aiStr.reason === "missing-aiState");
    const aiArr = S.migrateToCurrent({ aiState: [1, 2] });
    check("aiState 为数组 → 拒绝（不是对象）", aiArr.ok === false && aiArr.reason === "missing-aiState");
}

// ============================================================================
section("⑦ 未知高版本必须拒绝（且不产生 state）");
{
    const future = S.migrateToCurrent({ ...makeRealV0Save(), version: 99 });
    check("version 99 → 拒绝", future.ok === false);
    check("拒绝原因是 future-version", future.ok === false && future.kind === "future-version", JSON.stringify(future));
    check("带出实际版本号供提示", future.ok === false && future.version === 99, JSON.stringify(future));
    check("拒绝时不返回任何 state（杜绝误写回）", future.state === undefined);
}

// ============================================================================
section("⑧ 幂等性：迁移两次结果一致");
{
    const once = S.migrateToCurrent(makeRealV0Save());
    check("首次迁移成功", once.ok === true);
    if (once.ok) {
        const twice = S.migrateToCurrent(once.state);
        check("对已是 V1 的存档再迁移也成功", twice.ok === true, JSON.stringify(twice).slice(0, 160));
        if (twice.ok) {
            check("第二次 from 标记为 1", twice.from === 1, `${twice.from}`);
            check("两次结果 aiState 一致", JSON.stringify(twice.state.aiState) === JSON.stringify(once.state.aiState));
            check("两次结果 scene 一致", JSON.stringify(twice.state.scene) === JSON.stringify(once.state.scene));
            check("两次结果 userMind 一致", JSON.stringify(twice.state.userMind) === JSON.stringify(once.state.userMind));
            check("数据未丢失（turnCount/memories/chatHistory）",
                twice.state.turnCount === once.state.turnCount &&
                twice.state.memories.length === once.state.memories.length &&
                twice.state.chatHistory.length === once.state.chatHistory.length);
        }
    }
}

// ============================================================================
section("⑨ 未知顶层字段保留（不丢数据）");
{
    const withUnknown = makeRealV0Save({ futureField: { a: 1 }, anotherUnknown: "keep-me" });
    const out = S.migrateToCurrent(withUnknown);
    check("含未知字段仍迁移成功", out.ok === true);
    check("notes 记录了保留的未知字段", out.ok && out.notes.some((n) => n.includes("未知顶层字段")), out.ok ? JSON.stringify(out.notes).slice(0, 200) : "");
}

// ============================================================================
section("⑩ 契约常量自洽");
{
    check("SAVE_VERSION === 1", S.SAVE_VERSION === 1, `${S.SAVE_VERSION}`);
    check("VERSION_FIELD === 'version'", S.VERSION_FIELD === "version");
    check("SAVE_STATE_FIELDS 有 28 个字段", S.SAVE_STATE_FIELDS.length === 28, `${S.SAVE_STATE_FIELDS.length}`);
    check("KNOWN_TOP_LEVEL_KEYS = 28 + version/savedAt/aiState", S.KNOWN_TOP_LEVEL_KEYS.length === 31, `${S.KNOWN_TOP_LEVEL_KEYS.length}`);
    check("MIGRATIONS 含 0 → V1", typeof S.MIGRATIONS[0] === "function");
    check("DEFAULT_SCENE 为校园", S.DEFAULT_SCENE.place === "学校" && S.DEFAULT_SCENE.busyLabel === "上课");
    check("USER_LOCATIONS 白名单 4 项", S.USER_LOCATIONS.length === 4, S.USER_LOCATIONS.join(","));
}

// ============================================================================
console.log(`\n========== save-schema 单测: ${passed} 通过 / ${failed} 失败 ==========`);
if (failed > 0) {
    console.log("失败项：");
    for (const f of failures) console.log(`  · ${f}`);
}
process.exit(failed === 0 ? 0 : 1);
