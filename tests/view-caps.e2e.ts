// view-caps.e2e.ts —— P0-4 回归测试：视图层必须是有界的
//
// 被修复的缺陷：
//   数据层是有界的（chatHistory 200 / storyEvents 100 / memories 30 / chartHistory 40），
//   但**视图层完全无界** —— #chat-messages 与 #mood-history 的唯一清空点是「重置故事」。
//   每轮对话往 #chat-messages 追加约 15~20 个节点（用户气泡 + 时间戳 + AI 气泡 + 头像 +
//   dialogue + action + thoughts + 情绪标签 + 重答按钮 + 内含 <svg><use>），
//   turnCheckpoints 每轮还累积一份 {38 维快照 + Agent Mind 快照 + agenda 深拷贝 + DOM 引用}。
//   长时间游玩会让 DOM 与内存持续膨胀，滚动变重、移动端尤其明显
//   —— 典型的「模型有界、视图无界」。
//
// 本测试加载真实的 chat.ts（在 DOM 夹具下），直接驱动真实的渲染函数，
// 反复追加远超上限的节点，验证：
//   · 节点数稳定在上限附近（不再线性增长）
//   · 保留的是**最近**的内容（不能裁剪掉新消息）
//   · 上限对 UI 可用性足够宽（不会让玩家刚聊几句就丢上下文）

import "../playground/chat";
import { e2eCheck, e2eLog, e2eRun } from "./e2e-assert";

interface ViewDebug {
    viewCaps: () => { messages: number; moodEntries: number; checkpoints: number };
    appendTestMessage: (role: "user" | "ai", text: string) => HTMLElement;
    logTestEmotion: (text: string) => void;
    checkpointCount: () => number;
}

const dbg = (window as unknown as { __debug: ViewDebug }).__debug;
const messagesEl = document.getElementById("chat-messages")!;
const moodEl = document.getElementById("mood-history")!;

await e2eRun(() => {
    e2eCheck("chat.ts 在夹具下成功初始化（__debug 可用）", !!dbg && typeof dbg.viewCaps === "function");

    const caps = dbg.viewCaps();
    e2eLog(`视图上限：消息 ${caps.messages} / 情绪日志 ${caps.moodEntries} / 检查点 ${caps.checkpoints}`);

    // ---------- ① 消息容器有界 ----------
    const cap = caps.messages;
    const rounds = cap * 3; // 大幅超过上限
    for (let i = 0; i < rounds; i++) {
        dbg.appendTestMessage(i % 2 === 0 ? "user" : "ai", `测试消息 ${i}`);
    }
    const afterMany = messagesEl.childElementCount;
    e2eLog(`追加 ${rounds} 条后，#chat-messages 子节点数=${afterMany}（上限 ${cap}）`);
    e2eCheck(
        "【核心】消息容器节点数不超过上限（修复前会一路增长到 " + rounds + " 左右）",
        afterMany <= cap,
        `${afterMany} > ${cap}`,
    );
    e2eCheck("裁剪后仍保留足量节点（没有裁空）", afterMany > cap * 0.9, `${afterMany}`);

    // ---------- ② 保留的是最近的内容 ----------
    const last = messagesEl.lastElementChild;
    e2eLog(`最后一条消息内容：${JSON.stringify(last?.textContent)}`);
    e2eCheck(
        "【核心】保留最新消息（裁剪从头部移除，不能误删新内容）",
        last?.textContent === `测试消息 ${rounds - 1}`,
        `${last?.textContent}`,
    );
    const first = messagesEl.firstElementChild;
    e2eLog(`第一条保留的消息：${JSON.stringify(first?.textContent)}`);
    e2eCheck(
        "保留窗口是最近的内容（首条应为第 rounds-caps 条附近）",
        first?.textContent === `测试消息 ${rounds - cap}`,
        `${first?.textContent}`,
    );

    // ---------- ③ 继续追加不会突破上限（稳态而非偶发） ----------
    for (let i = 0; i < cap; i++) dbg.appendTestMessage("ai", `追加 ${i}`);
    const afterMore = messagesEl.childElementCount;
    e2eCheck("继续追加后仍稳定在上限", afterMore <= cap, `${afterMore}`);

    // ---------- ④ 情绪日志有界 ----------
    const moodCap = caps.moodEntries;
    const moodRounds = moodCap * 2;
    for (let i = 0; i < moodRounds; i++) dbg.logTestEmotion(`情绪条目 ${i}`);
    const moodCount = moodEl.childElementCount;
    e2eLog(`追加 ${moodRounds} 条后，#mood-history 子节点数=${moodCount}（上限 ${moodCap}）`);
    e2eCheck("【核心】情绪日志节点数不超过上限", moodCount <= moodCap, `${moodCount} > ${moodCap}`);
    e2eCheck(
        "情绪日志保留最新条目",
        moodEl.lastElementChild?.textContent?.includes(`情绪条目 ${moodRounds - 1}`) === true,
        `${moodEl.lastElementChild?.textContent}`,
    );

    // ---------- ⑤ 上限本身要够宽（不能为了"有界"而伤可用性） ----------
    e2eCheck(
        "消息上限足够宽（≥100 条，覆盖正常回看范围）",
        cap >= 100,
        `${cap}`,
    );
    e2eCheck("情绪日志上限足够宽（≥50 条）", moodCap >= 50, `${moodCap}`);
    e2eCheck("检查点上限足够宽（≥10 轮）", caps.checkpoints >= 10, `${caps.checkpoints}`);

    // ---------- ⑥ 渲染的节点不带残留（旧节点被真正移除而非隐藏） ----------
    const detached = messagesEl.childElementCount;
    const total = rounds + cap;
    e2eCheck(
        "旧节点被真正移除（不是 display:none 累积）",
        detached < total,
        `childElementCount=${detached} 累计追加=${total}`,
    );
});
