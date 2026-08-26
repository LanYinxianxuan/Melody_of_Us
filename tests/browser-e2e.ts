// browser-e2e.ts —— 在真实浏览器环境跑 Agent Mind 验收（localStorage/ESM 语义与正式环境一致）
// 打包为 IIFE 后由 tests/e2e.html 加载；headless chrome dump-dom 抓取结果。
// phase=1：清空 → 跑 3 轮对话 → 存档；phase=2：重载 → 验证状态跨会话持续。

import {
    runAgentPipeline,
    applyTimeDecay,
    resetAgentMind,
    debugSnapshot,
    setImperfectionRate,
    mindTestHooks,
} from "../playground/mind";
import { loadState, saveState } from "../playground/storage";

const { store, scheduleIndexFor } = mindTestHooks;

function setEnv() {
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

function push(text: string) {
    store.turnCount++;
    store.chatHistory.push({ role: "user", content: text, ts: store.virtualMs });
    store.chatHistory.push({ role: "assistant", content: "（她）嗯。", ts: store.virtualMs });
}

const out: string[] = [];
function log(s: string) { out.push(s); console.log(s); }

try {
    const phase = new URLSearchParams(location.search).get("phase") ?? "1";
    if (phase === "1") {
        localStorage.clear();
        // 重新初始化模块内 store 到默认（storage 模块已在加载时读了干净的 localStorage）
        resetAgentMind();
        setEnv();

        push("这次考试考砸了。");
        const t1 = runAgentPipeline("这次考试考砸了。", { likes: "" });
        log(`T1 emo=${t1.analysis.emotion.primary_emotion}/${t1.analysis.emotion.intensity.toFixed(2)} strategy=[${t1.strategy.choices.map(c => c.id).join(",")}] dir=${t1.strategy.directives.join("|")}`);
        log(`T1 sadness=${t1.userAfter.sadness.toFixed(2)} will=${t1.userAfter.willingness_to_talk.toFixed(2)}`);

        push("算了，我不想说了。");
        const t2 = runAgentPipeline("算了，我不想说了。", { likes: "" });
        log(`T2 strategy=[${t2.strategy.choices.map(c => c.id).join(",")}] dir=${t2.strategy.directives.join("|")}`);
        log(`T2 will=${t2.userAfter.willingness_to_talk.toFixed(2)}`);

        push("你刚才真的很烦。");
        const t3 = runAgentPipeline("你刚才真的很烦。", { likes: "" });
        log(`T3 strategy=[${t3.strategy.choices.map(c => c.id).join(",")}] tension=${t3.relTensionBefore.toFixed(2)}→${t3.relTensionAfter.toFixed(2)} defense=${t3.aiBefore.defensiveness.toFixed(2)}→${t3.aiAfter.defensiveness.toFixed(2)}`);

        // 存档（保存用户/AI/关系状态）
        saveState();
        localStorage.setItem("e2e-phase1-done", "1");
        log("PHASE1_DONE");
    } else {
        const done = localStorage.getItem("e2e-phase1-done") === "1";
        log(`LOADED_PHASE1=${done}`);
        if (!done) { log("FAIL: no phase1 save"); }
        else {
            // 重载后：loadState 恢复 Agent Mind 状态（验证跨会话持续）
            const ok = loadState();
            log(`LOAD_STATE_OK=${ok}`);
            const snap = debugSnapshot();
            log(`persisted sadness=${snap.user.sadness.toFixed(2)} will=${snap.user.willingness_to_talk.toFixed(2)} tension=${snap.rel.tension.toFixed(2)}`);
            log(`persisted aiLastTopic=${snap.ai.lastTopic} defense=${snap.ai.defensiveness.toFixed(2)}`);
            // 时间衰减：推进 90 分钟虚拟时间后 sadness 应下降
            const before = snap.user.sadness;
            const decays = applyTimeDecay(90 * 60000);
            const after = debugSnapshot().user.sadness;
            log(`decay(90min) sadness ${before.toFixed(3)}→${after.toFixed(3)} changed=${decays.length > 0}`);
            log("PHASE2_DONE");
        }
    }
} catch (e) {
    log("ERROR: " + (e as Error).message);
}

document.addEventListener("DOMContentLoaded", () => {
    const pre = document.createElement("pre");
    pre.id = "e2e-results";
    pre.textContent = out.join("\n");
    document.body.appendChild(pre);
    document.title = "E2E_COMPLETE";
});
