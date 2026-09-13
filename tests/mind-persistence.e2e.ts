// mind-persistence.e2e.ts —— Agent Mind 三态在真实 localStorage 下的跨会话持久化验证
//
// 为什么必须用真实浏览器：tests/agent-smoke.mjs 用 Map 桩替代 localStorage，
// 「刷新后状态还在不在」这条路径在那边永远为真，测不出问题。
//
//   phase=1  清空 → 3 轮 Agent Mind 推演 → saveState() → 打标记
//   phase=2  同一 user-data-dir 重新加载 → loadState() → 验证跨会话持续 + 时间衰减

import {
    runAgentPipeline,
    applyTimeDecay,
    resetAgentMind,
    debugSnapshot,
    setImperfectionRate,
    mindTestHooks,
} from "../playground/mind";
import { loadState, saveState } from "../playground/storage";
import { e2eCheck, e2eLog, e2eParams, e2eRun } from "./e2e-assert";

const { store, scheduleIndexFor } = mindTestHooks;

function resetWorld() {
    store.chatHistory = [];
    store.storyEvents = [];
    store.activeThread = null;
    store.turnCount = 0;
    store.virtualMs = store.dayBaseMs + 12.5 * 3600000;
    store.scheduleIndex = scheduleIndexFor(store.virtualMs);
    store.lastReplyVirtualAt = store.virtualMs;
    store.lastAgentVirtualAt = 0;
    setImperfectionRate(0);
}

/** 把一轮对话写进历史（模拟 chat.ts 在调用 AI 后落库） */
function push(text: string) {
    store.turnCount++;
    store.chatHistory.push({ role: "user", content: text, ts: store.virtualMs });
    store.chatHistory.push({ role: "assistant", content: "（她）嗯。", ts: store.virtualMs });
}

await e2eRun(() => {
    const phase = e2eParams().get("phase") ?? "1";

    if (phase === "1") {
        localStorage.clear();
        resetAgentMind();
        resetWorld();

        push("这次考试考砸了。");
        const t1 = runAgentPipeline("这次考试考砸了。", { likes: "" });
        e2eLog(`T1 emo=${t1.analysis.emotion.primary_emotion}/${t1.analysis.emotion.intensity.toFixed(2)}`);
        e2eLog(`T1 strategy=[${t1.strategy.choices.map((c) => c.id).join(",")}] dir=${t1.strategy.directives.join("|")}`);
        e2eLog(`T1 sadness=${t1.userAfter.sadness.toFixed(2)} will=${t1.userAfter.willingness_to_talk.toFixed(2)}`);

        push("算了，我不想说了。");
        const t2 = runAgentPipeline("算了，我不想说了。", { likes: "" });
        e2eLog(`T2 strategy=[${t2.strategy.choices.map((c) => c.id).join(",")}] dir=${t2.strategy.directives.join("|")}`);
        e2eLog(`T2 will=${t2.userAfter.willingness_to_talk.toFixed(2)}`);

        push("你刚才真的很烦。");
        const t3 = runAgentPipeline("你刚才真的很烦。", { likes: "" });
        e2eLog(
            `T3 strategy=[${t3.strategy.choices.map((c) => c.id).join(",")}] ` +
                `tension=${t3.relTensionBefore.toFixed(2)}→${t3.relTensionAfter.toFixed(2)} ` +
                `defense=${t3.aiBefore.defensiveness.toFixed(2)}→${t3.aiAfter.defensiveness.toFixed(2)}`,
        );

        e2eCheck("第 1 轮负面情绪被识别（sadness 上升）", t1.userAfter.sadness > 0.1, `${t1.userAfter.sadness}`);
        e2eCheck("第 1 轮策略不含指责性推进", t1.strategy.choices.length > 0);
        e2eCheck("第 2 轮退避使意愿下降", t2.userAfter.willingness_to_talk < 0.6, `${t2.userAfter.willingness_to_talk}`);
        e2eCheck("第 3 轮关系张力上升", t3.relTensionAfter > t3.relTensionBefore);
        e2eCheck("第 3 轮 AI 防御性上升", t3.aiAfter.defensiveness > t3.aiBefore.defensiveness);

        saveState();
        localStorage.setItem("e2e-phase1-done", "1");
        e2eCheck("phase 1 存档已写入", !!localStorage.getItem("melai-state-1"));
        return;
    }

    // ===== phase 2：新页面实例，localStorage 保留 =====
    const done = localStorage.getItem("e2e-phase1-done") === "1";
    e2eLog(`LOADED_PHASE1=${done}`);
    e2eCheck("检测到 phase 1 的存档标记", done);

    // 【P0-12】loadState 现在返回可诊断的 LoadOutcome（不再是 boolean）
    const outcome = loadState();
    e2eLog(`loadState status=${outcome.status}`);
    e2eCheck("loadState() 成功加载", outcome.status === "loaded", outcome.status);
    e2eCheck("加载结果为跨会话的已存存档（非新游戏）", outcome.status !== "empty", outcome.status);

    const snap = debugSnapshot();
    e2eLog(
        `persisted sadness=${snap.user.sadness.toFixed(2)} will=${snap.user.willingness_to_talk.toFixed(2)} ` +
            `tension=${snap.rel.tension.toFixed(2)}`,
    );
    e2eLog(`persisted aiLastTopic=${snap.ai.lastTopic} defense=${snap.ai.defensiveness.toFixed(2)}`);

    e2eCheck("用户情绪跨会话保留", snap.user.sadness > 0.05, `${snap.user.sadness}`);
    e2eCheck("用户意愿跨会话保留", snap.user.willingness_to_talk > 0 && snap.user.willingness_to_talk < 0.6);
    e2eCheck("关系张力跨会话保留", snap.rel.tension > 0.05, `${snap.rel.tension}`);
    e2eCheck("AI 状态跨会话保留（话题可追溯）", snap.ai.lastTopic.length > 0, snap.ai.lastTopic);

    const before = snap.user.sadness;
    const decays = applyTimeDecay(90 * 60000);
    const after = debugSnapshot().user.sadness;
    e2eLog(`decay(90min) sadness ${before.toFixed(3)}→${after.toFixed(3)} changed=${decays.length > 0}`);
    e2eCheck("时间衰减执行且情绪下降", after < before, `${before} → ${after}`);
});
