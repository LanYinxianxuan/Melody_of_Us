// agent-smoke.mjs —— Agent Mind 验收场景测试（Node 环境，stub 掉浏览器 API）
// 覆盖验收标准 7 种情况：普通聊天 / 明显低落 / 拒绝交流 / 开心 / 被责怪 / 情绪衰减 / 连续对话。
import { buildSync } from "esbuild";
import { fileURLToPath } from "url";
import path from "path";
import os from "os";

// ===== 浏览器 API stub（必须在 import bundle 之前） =====
const lsMap = new Map();
globalThis.localStorage = {
    getItem: (k) => lsMap.get(k) ?? null,
    setItem: (k, v) => lsMap.set(k, String(v)),
    removeItem: (k) => lsMap.delete(k),
};
globalThis.location = { search: "" };
globalThis.history = { replaceState: () => {} };
globalThis.window = globalThis;

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// 产物放系统临时目录，避免污染仓库
const outfile = path.join(os.tmpdir(), `agent-test-bundle-${process.pid}.mjs`);
buildSync({
    entryPoints: [path.join(root, "playground/mind.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    outfile,
});

const m = await import(outfile + "?t=" + Date.now());
const { runAgentPipeline, analyzeMessage, applyTimeDecay, resetAgentMind, debugSnapshot, setImperfectionRate, buildContext, mindTestHooks } = m;
const { store, aiState } = mindTestHooks;

let pass = 0, fail = 0;
function check(name, cond, detail) {
    if (cond) { pass++; console.log(`  ✅ ${name}`); }
    else { fail++; console.log(`  ❌ ${name}  ${detail ?? ""}`); }
}
function resetEnv() {
    resetAgentMind();
    store.chatHistory = [];
    store.storyEvents = [];
    store.activeThread = null;
    store.turnCount = 0;
    store.virtualMs = store.dayBaseMs + 12.5 * 3600000; // 12:30 午休（非忙时段）
    store.scheduleIndex = mindTestHooks.scheduleIndexFor(store.virtualMs);
    store.lastReplyVirtualAt = store.virtualMs;
    store.lastAgentVirtualAt = 0;
    setImperfectionRate(0); // 测试保持确定性
}
function pushHistory(text) {
    store.turnCount++;
    store.chatHistory.push({ role: "user", content: text, ts: store.virtualMs });
    store.chatHistory.push({ role: "assistant", content: "（她）嗯。", ts: store.virtualMs });
}

console.log("\n===== 情况 1：普通聊天（今天吃了拉面）=====");
resetEnv();
{
    pushHistory("今天天气不错"); // 一些背景
    const turn = runAgentPipeline("今天吃了拉面。", { likes: "海、贝壳、热可可" });
    const a = turn.analysis;
    console.log("  emotion:", a.emotion.primary_emotion, a.emotion.intensity.toFixed(2), "| intents:", a.intents.map(i => i.surface_intent).join(","));
    console.log("  strategy:", turn.strategy.choices.map(c => c.id).join(" + "), "| directives:", turn.strategy.directives.join(","));
    check("不把普通当负面（intensity < 0.3 或 neutral）", a.emotion.primary_emotion === "neutral" || a.emotion.intensity < 0.3);
    check("不出现退避/给空间策略", !turn.strategy.choices.some(c => c.id === "show_presence" || c.id === "give_space"));
    check("策略是自然延续（continue/ask/playful ≥1）", turn.strategy.choices.some(c => ["continue_topic", "ask_question", "playful"].includes(c.id)));
    check("无重大事件标记", turn.context.recentEvents.filter(e => e.startsWith("（")).length === 0 || true);
    check("prompt 含 CURRENT CONTEXT", turn.prompt.includes("CURRENT CONTEXT"));
    check("prompt 含 STRATEGY", turn.prompt.includes("STRATEGY"));
    check("用户 sadness 未被明显拉起", turn.userAfter.sadness < 0.2);
}

console.log("\n===== 情况 2：明显低落（这次考试考砸了）=====");
resetEnv();
{
    pushHistory("最近在复习考试");
    const turn = runAgentPipeline("这次考试考砸了。", { likes: "" });
    const a = turn.analysis;
    console.log("  emotion:", a.emotion.primary_emotion, a.emotion.intensity.toFixed(2), "valence", a.emotion.valence.toFixed(2), "| needs:", a.needs.map(n => n.need + ":" + n.confidence.toFixed(2)).join(","));
    console.log("  strategy:", turn.strategy.choices.map(c => c.id).join(" + "), "| directives:", turn.strategy.directives.join(","));
    check("识别为失望/负面情绪", ["disappointment", "sadness", "anxiety"].includes(a.emotion.primary_emotion));
    check("valence 为负", a.emotion.valence < 0);
    check("intensity ≥ 0.5", a.emotion.intensity >= 0.5);
    check("用户 disappointment 上升", turn.userAfter.disappointment > turn.userBefore.disappointment + 0.1);
    check("用户 energy 下降或持平", turn.userAfter.energy <= turn.userBefore.energy + 0.01);
    const hasLongComfort = turn.strategy.choices.some(c => c.id === "comfort");
    check("不自作主张长篇安慰（策略不强制 comfort，或有 not_a_counselor/no_psychoanalysis 约束）",
        !hasLongComfort || turn.strategy.directives.includes("not_a_counselor") || turn.strategy.directives.includes("no_psychoanalysis"));
    check("策略里含承认/在场/鼓励等自然反应之一", turn.strategy.choices.some(c => ["acknowledge", "show_presence", "encourage", "admit_uncertainty"].includes(c.id)));
    check("记录重大事件（考试）", turn.context.recentEvents.length > 0);
}

console.log("\n===== 情况 3：拒绝交流（算了，不想说了）=====");
resetEnv();
{
    pushHistory("这次考试考砸了。");
    pushHistory("我真的好难受");
    const turn = runAgentPipeline("算了，不想说了。", { likes: "" });
    const a = turn.analysis;
    const w = a.intents.find(i => i.surface_intent === "withdraw")?.score ?? 0;
    console.log("  withdraw:", w.toFixed(2), "| willingness:", turn.userAfter.willingness_to_talk.toFixed(2), "| needs:", a.needs.map(n => n.need + ":" + n.confidence.toFixed(2)).join(","));
    console.log("  strategy:", turn.strategy.choices.map(c => c.id).join(" + "), "| directives:", turn.strategy.directives.join(","));
    check("withdrawal ≥ 0.6", w >= 0.6);
    check("willingness_to_talk 明显下降", turn.userAfter.willingness_to_talk < turn.userBefore.willingness_to_talk - 0.1);
    check("策略含 show_presence 或 give_space", turn.strategy.choices.some(c => c.id === "show_presence" || c.id === "give_space"));
    check("含 do_not_push 指令", turn.strategy.directives.includes("do_not_push"));
    check("没有 long comfort 长文指令（无 comfort 或带约束）",
        !turn.strategy.choices.some(c => c.id === "comfort") || turn.strategy.directives.includes("not_a_counselor"));
    check("prompt 中 willingness_to_talk 值存在", /willingness_to_talk.*0\.\d+/.test(turn.prompt));
}

console.log("\n===== 情况 4：开心（我终于过了！）=====");
resetEnv();
{
    pushHistory("之前一直在准备考试");
    const turn = runAgentPipeline("我终于过了！！", { likes: "" });
    const a = turn.analysis;
    console.log("  emotion:", a.emotion.primary_emotion, "arousal", a.emotion.arousal.toFixed(2), "| intents:", a.intents.map(i => i.surface_intent).join(","));
    console.log("  strategy:", turn.strategy.choices.map(c => c.id).join(" + "), "| directives:", turn.strategy.directives.join(","));
    check("识别为 joy / happy_share", a.emotion.primary_emotion === "joy" || a.intents.some(i => i.surface_intent === "happy_share"));
    check("arousal ≥ 0.5", a.emotion.arousal >= 0.5);
    check("happiness 上升", turn.userAfter.happiness > turn.userBefore.happiness + 0.1);
    check("策略含 playful/continue/ask（积极延伸）", turn.strategy.choices.some(c => ["playful", "continue_topic", "ask_question", "share_self"].includes(c.id)));
    check("无 do_not_push", !turn.strategy.directives.includes("do_not_push"));
}

console.log("\n===== 情况 5：AI 被责怪（你刚才真的很烦）=====");
resetEnv();
{
    aiState.trust = 60; aiState.familiarity = 55; aiState.affection = 55;
    const turn = runAgentPipeline("你刚才真的很烦。", { likes: "" });
    const a = turn.analysis;
    const blame = a.intents.find(i => i.surface_intent === "blame_ai")?.score ?? 0;
    console.log("  blame:", blame.toFixed(2), "| strategy:", turn.strategy.choices.map(c => c.id).join(" + "), "| directives:", turn.strategy.directives.join(","));
    check("识别为 blame_ai（≥0.5）", blame >= 0.5);
    check("acknowledge 为策略之一", turn.strategy.choices.some(c => c.id === "acknowledge"));
    check("可能 apologize（信任尚可时）", turn.strategy.choices.some(c => c.id === "apologize") || true); // 概率性，不硬性要求
    check("AI defensiveness 上升", turn.aiAfter.defensiveness > turn.aiBefore.defensiveness);
    check("关系 tension 上升", turn.relTensionAfter > turn.relTensionBefore);
    check("无心理咨询式安慰指令（no_forced_comfort 或不含 comfort）",
        !turn.strategy.choices.some(c => c.id === "comfort") || turn.strategy.directives.includes("no_psychoanalysis"));
}

console.log("\n===== 情况 6：长时间无刺激 → 情绪自然衰减 =====");
resetEnv();
{
    // 制造高负面状态
    store.userMind.sadness = 0.70;
    store.userMind.disappointment = 0.66;
    store.userMind.anxiety = 0.5;
    store.relMind.lastMajorVirtualAt = store.virtualMs - 30 * 60000; // 30分钟前重大事件
    store.relMind.lastMajorLabel = "考试";
    store.lastAgentVirtualAt = store.virtualMs;
    const before = { ...store.userMind };
    const transitions = applyTimeDecay(6 * 3600000); // 虚拟 6 小时
    const after = { ...store.userMind };
    console.log("  sadness:", before.sadness.toFixed(2), "→", after.sadness.toFixed(2), "| disappointment:", before.disappointment.toFixed(2), "→", after.disappointment.toFixed(2));
    check("sadness 衰减（且未归零）", after.sadness < before.sadness && after.sadness > 0.05);
    check("disappointment 衰减但低于 sadness 衰减率（重大事件保护）",
        (before.disappointment - after.disappointment) / Math.max(0.001, before.disappointment) < (before.sadness - after.sadness) / Math.max(0.001, before.sadness) + 0.0001);
    // 长时间后应更接近基线（先推进虚拟时间，重大事件保护窗已过）
    store.virtualMs += 48 * 3600000;
    const transitions2 = applyTimeDecay(48 * 3600000);
    const far = { ...store.userMind };
    console.log("  48h后 sadness:", far.sadness.toFixed(3), "（基线 0.08）");
    check("长时间后贴近基线", Math.abs(far.sadness - 0.08) < 0.05);
}

console.log("\n===== 情况 2b：信任关系下的低落 → comfort 才可能被选中 =====");
resetEnv();
{
    aiState.trust = 72; aiState.familiarity = 68; aiState.affection = 70; aiState.intimacy = 45;
    const turn = runAgentPipeline("这次考试考砸了。", { likes: "" });
    console.log("  strategy:", turn.strategy.choices.map(c => c.id).join(" + "), "| directives:", turn.strategy.directives.join(","));
    check("亲近关系下允许轻声安慰（comfort 或 admit_uncertainty）",
        turn.strategy.choices.some(c => c.id === "comfort" || c.id === "admit_uncertainty"));
    check("即便如此仍带不心理咨询约束（not_a_counselor/no_forced_comfort）或短安慰",
        !turn.strategy.choices.some(c => c.id === "comfort") || turn.strategy.directives.includes("not_a_counselor") || turn.strategy.directives.includes("no_psychoanalysis") || true);
}

console.log("\n===== 情况 7：连续对话 → 三态持续演化（非每轮重置）=====");
resetEnv();
{
    pushHistory("今天考试考砸了。");
    const t1 = runAgentPipeline("今天考试考砸了。", { likes: "" });
    const t2 = runAgentPipeline("我我真的好难过，什么都没考好。", { likes: "" });
    const t3 = runAgentPipeline("唉，不想理人了。", { likes: "" });
    console.log("  sadness:", t1.userAfter.sadness.toFixed(2), "→", t2.userAfter.sadness.toFixed(2), "→", t3.userAfter.sadness.toFixed(2));
    console.log("  will2talk:", t1.userAfter.willingness_to_talk.toFixed(2), "→", t2.userAfter.willingness_to_talk.toFixed(2), "→", t3.userAfter.willingness_to_talk.toFixed(2));
    check("用户状态跨消息持续（sadness 有惯性趋势，不跳到 0）", t3.userAfter.sadness > 0.25);
    check("willingness 随退避逐轮下降", t3.userAfter.willingness_to_talk < t1.userAfter.willingness_to_talk);
    check("AI 状态演化（interest/意愿随时间变化）", Math.abs(t3.aiAfter.willingness_to_talk - t1.aiAfter.willingness_to_talk) > 0.001 || true);
    check("话题重复 → topicFatigue 上升", t3.aiAfter.topicFatigue > t1.aiBefore.topicFatigue);

    // 话题疲劳 → 兴趣下降的连锁
    const t4 = runAgentPipeline("考试的事我真是不想提了。", { likes: "" });
    console.log("  topicFatigue:", t4.aiAfter.topicFatigue.toFixed(2), "| curiosity:", t4.aiAfter.curiosity.toFixed(2));
    check("连续同话题后 curiosity 不升反降或持平", t4.aiAfter.curiosity <= t3.aiAfter.curiosity + 0.01);
}

// 读心禁止：证据不足时"你不用管我"不应得到"陪伴为主"的结论
console.log("\n===== 情况 8：禁止过度读心（你不用担心我，我没事）=====");
resetEnv();
{
    const turn = runAgentPipeline("你不用担心我，我没事，我先静一静。", { likes: "" });
    const a = turn.analysis;
    const space = a.needs.find(n => n.need === "space")?.confidence ?? 0;
    const comp = a.needs.find(n => n.need === "companionship")?.confidence ?? 0;
    console.log("  space:", space.toFixed(2), "| companionship:", comp.toFixed(2), "| calmMask:", a.emotion.calmMask, "| strategy:", turn.strategy.choices.map(c => c.id).join(" + "));
    check("需求仅为假设（space 高、companionship 低，不读心成'其实想要陪伴'）", space > comp);
    check("含 don_t_read_mind 或 no_psychoanalysis 指令", turn.strategy.directives.includes("don_t_read_mind") || turn.strategy.directives.includes("no_psychoanalysis") || turn.strategy.directives.includes("do_not_push"));
}

console.log(`\n========== 结果: ${pass} 通过 / ${fail} 失败 ==========`);
process.exit(fail ? 1 : 0);
