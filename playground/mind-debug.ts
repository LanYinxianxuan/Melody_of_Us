// mind-debug.ts —— Agent 决策状态调试面板（第十八节：可调试性）
// 只负责渲染 mind.ts 的状态快照与决策轨迹；正式界面默认收起（用户可折叠/隐藏）。

import {
    debugSnapshot,
    getAgentTrace,
    type AgentTurn,
} from "./mind";

const EMO_LABEL: Record<string, string> = {
    joy: "喜悦", sadness: "悲伤", anger: "愤怒", fear: "恐惧", anxiety: "焦虑",
    disappointment: "失望", loneliness: "孤独", embarrassment: "尴尬", stress: "疲惫/压力",
    interest: "兴趣", neutral: "平静",
};
const INTENT_LABEL: Record<string, string> = {
    withdraw: "退避", blame_ai: "责怪AI", share: "分享", vent: "倾诉", ask: "提问",
    happy_share: "分享喜事", request: "请求", tease: "玩笑", deflect: "岔开", neutral: "普通交流",
};

function f1(v: number): string { return (v || 0).toFixed(1).replace(/^0/, ""); }
function f2(v: number): string { return (v || 0).toFixed(2).replace(/^0/, ""); }

function kvRow(items: [string, string][]): string {
    return `<div class="dbg-kv">${items.map(([k, v]) => `${k} <b>${v}</b>`).join(" · ")}</div>`;
}

export function renderAgentDebug(el: HTMLElement): void {
    if (!el) return;
    const snap = debugSnapshot();
    const trace = getAgentTrace();

    // —— 当前状态块 ——
    const user = snap.user;
    const emoKeys: [string, string][] = [
        ["sadness", f2(user.sadness)], ["anxiety", f2(user.anxiety)], ["anger", f2(user.anger)],
        ["happiness", f2(user.happiness)], ["loneliness", f2(user.loneliness)],
    ];
    const ai = snap.ai;
    const aiKeys: [string, string][] = [
        ["mood", f2(snap.aiView.mood)], ["energy", f2(snap.aiView.energy)],
        ["interest", f2(ai.interest)], ["patience", f2(ai.patience)],
        ["will2talk", f2(ai.willingness_to_talk)], ["curiosity", f2(ai.curiosity)],
        ["topicFatigue", f2(ai.topicFatigue)], ["defense", f2(ai.defensiveness)],
    ];
    const rel = snap.rel;
    const relKeys: [string, string][] = [
        ["trust", f2(rel.trust)], ["familiarity", f2(rel.familiarity)],
        ["comfort", f2(rel.comfort)], ["closeness", f2(rel.closeness)], ["tension", f2(rel.tension)],
    ];

    const last = trace[trace.length - 1];
    const strategyHtml = last
        ? `<div class="dbg-str">${last.strategySummary}</div>` +
          `<div class="dbg-tr-meta" style="margin-top:4px;">基于 「${shorten(last.userText, 24)}」</div>`
        : `<div class="dbg-kv" style="color:var(--ink-faint);">（还没有对话，发条消息试试）</div>`;

    const blocks = [
        `<div class="dbg-block">`,
        `<div class="dbg-h">👤 用户情绪 / 意图</div>`,
        kvRow(emoKeys),
        `<div class="dbg-kv">talk意愿 <b>${f2(user.willingness_to_talk)}</b> · 需求 <b>${f1(user.social_need)}</b> · 能量 <b>${f2(user.energy)}</b></div>`,
        `</div>`,
        `<div class="dbg-block">`,
        `<div class="dbg-h">🤖 AI 状态</div>`,
        kvRow(aiKeys),
        `</div>`,
        `<div class="dbg-block">`,
        `<div class="dbg-h">💞 关系状态</div>`,
        kvRow(relKeys),
        `</div>`,
        `<div class="dbg-block">`,
        `<div class="dbg-h">🎬 当前策略</div>`,
        strategyHtml,
        `</div>`,
    ];

    // —— 决策轨迹（previous → signal → transition → strategy → response）——
    const traceHtml = trace.slice(-8).reverse().map((t) => `
        <div class="dbg-tr">
          <div class="dbg-tr-meta"><b>#${t.id}</b> · ${timeStr(t.virtualAt)} · ${t.proactive ? "（她开口）" : "你："}<b>${shorten(t.userText, 22)}</b></div>
          <div class="dbg-tr-line">信号 → ${t.detectedSignal}</div>
          ${t.stateTransition ? `<div class="dbg-tr-line">状态 → ${t.stateTransition}</div>` : ""}
          <div class="dbg-tr-line">策略 → ${t.strategySummary}</div>
          ${t.refined ? `<div class="dbg-tr-line">修正 → ${t.refined}</div>` : ""}
          ${t.response ? `<div class="dbg-tr-line">回复 → ${shorten(t.response, 36)}</div>` : ""}
        </div>`).join("");

    el.innerHTML = blocks.join("") +
        `<div class="dbg-h" style="margin-top:10px;">📜 决策轨迹（最近 ${Math.min(8, trace.length)}）</div>` +
        `<div class="dbg-trace">${traceHtml || `<div class="dbg-kv" style="color:var(--ink-faint);">（暂无）</div>`}</div>`;
}

// 单轮更新（回复生成后刷一次，回填 response）
export function updateAgentDebugAfterTurn(_turn: AgentTurn): void {
    const el = document.getElementById("agent-debug");
    if (el) renderAgentDebug(el);
}

function shorten(s: string, n: number): string {
    const t = (s || "").replace(/\n/g, " ");
    return t.length > n ? t.slice(0, n) + "…" : t;
}

function timeStr(virtualAt: number): string {
    const d = new Date(virtualAt || Date.now());
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// 调试面板辅助：窗口控制台可直接用 __mind 查看/测试
export function installMindDebugHooks(): void {
    (window as any).__mind = {
        snapshot: () => debugSnapshot(),
        trace: () => getAgentTrace(),
        labels: { emo: EMO_LABEL, intent: INTENT_LABEL },
        render: () => {
            const el = document.getElementById("agent-debug");
            if (el) renderAgentDebug(el);
        },
    };
}
