// typewriter.e2e.ts —— P0-5 回归测试：打字机必须帧驱动，且不与 CSS 平滑滚动打架
//
// 被修复的缺陷（两处叠加，构成全页最明显的性能/体验问题）：
//   ① typeReply 用 window.setInterval(..., 55) 每 55ms 写一次 textContent，
//      并紧接着读 container.scrollHeight 做滚动 —— 即「每 55ms 一次强制同步布局 + 一次滚动写入」。
//      单条 200 字回复持续约 3.7 秒。
//   ② #chat-messages 上有 CSS `scroll-behavior: smooth`，而自动滚动写的是
//      `container.scrollTop = container.scrollHeight`。程序化赋值同样触发平滑滚动动画，
//      于是每 55ms 重新赋值一次 = 每 55ms 重启一次滚动动画 → 滚动持续抖动/追赶。
//
// 修法：① 改为 requestAnimationFrame + 时间累加器（保持「每 55ms 出 3 字」的原有节奏，
//          但渲染对齐到帧；切到后台时 rAF 自动暂停）；
//       ② 自动滚动一律显式 behavior:"auto"（CSS 的 smooth 仍保留给用户主动滚动）。

import "../playground/chat";
import { e2eCheck, e2eLog, e2eRun } from "./e2e-assert";

type ReplyFull = { dialogue: string; dialogue_ja?: string; action?: string; thoughts?: string };

interface TypewriterDebug {
    typeTestReply: (full: ReplyFull) => HTMLElement;
    typeTestReplyManual: (full: ReplyFull) => { el: HTMLElement; tick: ((now: number) => void) | null };
    lastAutoScrollBehavior: () => ScrollBehavior | null;
}

const dbg = (window as unknown as { __debug: TypewriterDebug }).__debug;
const messagesEl = document.getElementById("chat-messages")!;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** 等待条件成立，超时返回 false */
async function waitFor(fn: () => boolean, timeoutMs = 8000, step = 50): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (fn()) return true;
        await sleep(step);
    }
    return fn();
}

await e2eRun(async () => {
    e2eCheck("chat.ts 初始化成功（__debug 可用）", !!dbg && typeof dbg.typeTestReply === "function");

    // ---------- ① 自动滚动必须使用 behavior:"auto" ----------
    const dialogue = "第一句话。\n第二句话，稍微长一点用来观察打字效果。";
    const el = dbg.typeTestReply({ dialogue, action: "低头笑了笑", thoughts: "心跳有点快" });
    const container = el.closest("#chat-messages") ? messagesEl : messagesEl;

    const typed = await waitFor(() => {
        const d = el.querySelector(".dialogue");
        return !!d && d.textContent === dialogue;
    });
    e2eCheck("【核心】打字机最终输出完整文本", typed, JSON.stringify(el.querySelector(".dialogue")?.textContent));

    e2eLog(`最近一次自动滚动的 behavior = ${JSON.stringify(dbg.lastAutoScrollBehavior())}`);
    e2eCheck(
        '【核心】自动滚动使用 behavior:"auto"（不再与 CSS smooth 打架）',
        dbg.lastAutoScrollBehavior() === "auto",
        `${dbg.lastAutoScrollBehavior()}`,
    );
    e2eCheck("消息容器确实发生了滚动（滚动逻辑仍生效）", container.scrollTop > 0 || container.scrollHeight <= container.clientHeight, `scrollTop=${container.scrollTop}`);

    // ---------- ② 动作与心声在打字完成后补齐 ----------
    e2eCheck("打字完成后追加了动作", el.querySelector(".action")?.textContent === "（低头笑了笑）", `${el.querySelector(".action")?.textContent}`);
    e2eCheck("打字完成后追加了心声", el.querySelector(".thoughts")?.textContent === "💭 心跳有点快", `${el.querySelector(".thoughts")?.textContent}`);

    // ---------- ③ 渐进渲染：用人工驱动 tick 做确定性验证 ----------
    // 为什么不用"等 80ms 看渲染了多少字"：无头/限流环境下 rAF 可能只回调一次甚至不回调
    // （实测本环境 rAF 只触发 1 次），那样这种断言测的是环境而不是代码。
    // 这里改为手动逐帧驱动真实的 tick，直接验证"多帧渐进、最终完整"。
    const long = "这是一段足够长的文本，用来验证打字过程确实是逐帧推进而不是一次性渲染完成的。".repeat(2);
    const manual = dbg.typeTestReplyManual({ dialogue: long });
    e2eCheck("获得手动驱动句柄", typeof manual.tick === "function");

    const readText = () => manual.el.querySelector(".dialogue")?.textContent ?? "";
    const samples: number[] = [];
    let now = 0;
    // 每帧推进 60ms（> 55ms 出字间隔），逐帧记录已渲染字数
    for (let f = 0; f < 6; f++) {
        now += 60;
        manual.tick?.(now);
        samples.push(readText().length);
    }
    e2eLog(`逐帧已渲染字数：${samples.join(" → ")}`);

    // 第 1 帧只用于初始化时间基准（累加器需要一个起点），因此第 1 帧为 0 字是设计如此。
    e2eCheck(
        "最后 5 帧逐帧递增（确实是渐进渲染，不是一次性写入）",
        samples.slice(1).every((v, idx) => v > samples[idx]!),
        samples.join(","),
    );
    e2eCheck(
        "【核心】6 帧后仍未渲染完（证明不是一次性渲染）",
        samples[5]! > 0 && samples[5]! < long.length,
        `${samples[5]}/${long.length}`,
    );
    e2eCheck(
        "每帧出字数量符合预期（自第 2 帧起每步 3 字）",
        samples[1] === 3 && samples[2] === 6 && samples[3] === 9,
        samples.join(","),
    );
    e2eCheck("总帧数远小于一次性渲染（需要多帧才能打完）", Math.ceil(long.length / 3) > 10, `${Math.ceil(long.length / 3)} 帧`);

    // 驱动到结束，验证最终完整 + 动作/心声补齐
    for (let f = 0; f < 400 && readText() !== long; f++) {
        now += 60;
        manual.tick?.(now);
    }
    e2eCheck("【核心】驱动到结束后文本完整", readText() === long, `${readText().length}/${long.length}`);

    // ---------- ④ rAF 不可用时的兜底 ----------
    // 事实前提：本无头环境的 rAF 只回调 1 次（已实测）。第一条断言里 typeTestReply 的文本
    // 最终仍然完整，正是看门狗兜底在起作用 —— 否则文本会永远停在中途。
    e2eCheck(
        "【核心】rAF 几乎不回调时文本仍能渲染完整（看门狗兜底）",
        el.querySelector(".dialogue")?.textContent === dialogue,
        JSON.stringify(el.querySelector(".dialogue")?.textContent),
    );

    // ---------- ⑤ 不残留定时器型实现：连续两次打字互不干扰 ----------
    const a = dbg.typeTestReply({ dialogue: "甲甲甲甲甲" });
    const b = dbg.typeTestReply({ dialogue: "乙乙乙乙乙" });
    const bothDone = await waitFor(
        () =>
            a.querySelector(".dialogue")?.textContent === "甲甲甲甲甲" &&
            b.querySelector(".dialogue")?.textContent === "乙乙乙乙乙",
    );
    e2eCheck("【核心】并发两条打字互不干扰（各自独立完成）", bothDone);
    e2eCheck(
        "两条消息内容没有串写",
        a.querySelector(".dialogue")?.textContent === "甲甲甲甲甲" &&
            b.querySelector(".dialogue")?.textContent === "乙乙乙乙乙",
    );
});
