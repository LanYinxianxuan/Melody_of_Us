// ui/message.ts —— 消息流的渲染边界（阶段 3.3）
//
// 职责：把"世界状态"变成消息气泡的 DOM。**只管渲染**：
//   · 不 fetch（网络出口见 GAMEPLAY_REVIEW A-1）
//   · 不读写 localStorage
//   · 不判断任何游戏规则（该显示什么由调用方决定）
//
// 为什么这些函数值得单独成模块：
//   它们定义了**渲染输出的形状契约** —— `.msg` / `.msg-avatar` / `.dialogue` /
//   `.action` / `.thoughts` / `.emotion-tag` / `.msg-ts` / `.story-line`。
//   `tests/render-boundary.e2e.ts` 正是盯住这套形状；把它从业务流程里抽出来之后，
//   "形状"第一次有了单一归属，而不是散落在 sendMessage / typeReply / NPC 分支里。
//
// 依赖方向（无环）：
//   ui/message.ts → ui/dom.ts（DOM 收口）
//                 → tts.ts（语音朗读；叶子模块，无 DOM、无 store）
//   chat.ts       → ui/message.ts（并通过 setMessageHooks 注入"忙碌态"这一 chat 级关注点）

import * as ui from "./dom";
import { generateEmotionStyle, isTtsEnabled, speak } from "../tts";

// ============ 【P0-4】DOM 上限 ============
//
// 缺陷原貌：数据层是有界的（chatHistory 200 / storyEvents 100 / memories 30 / chartHistory 40），
// 但**视图层完全无界** —— #chat-messages 与 #mood-history 的唯一清空点是「重置故事」。
// 每轮对话都会往 #chat-messages 追加约 15~20 个节点，长时间游玩（数百轮）会让 DOM 持续膨胀。
// 典型的「模型有界、视图无界」。
//
// 修法：把视图节点数也变成有界的，只裁剪渲染出来的节点，不影响任何存档数据。
export const MAX_RENDERED_MESSAGES = 300; // #chat-messages 保留的最近消息节点数
export const MAX_MOOD_ENTRIES = 200; // #mood-history 保留的最近情绪日志条数

/**
 * 从容器头部移除多余子节点，保留最近 max 个。
 * 用 while + removeChild 而不是 innerHTML —— 后者会连带销毁仍在引用的节点。
 */
export function trimContainer(container: HTMLElement, max: number): void {
    while (container.childElementCount > max) {
        const first = container.firstElementChild;
        if (!first) break;
        container.removeChild(first);
    }
}

// ============ 【P0-5】自动滚动 ============
//
// 缺陷原貌：自动滚到底部写的是 `container.scrollTop = container.scrollHeight`，
// 而 #chat-messages 上有 CSS `scroll-behavior: smooth`。程序化赋值 scrollTop 同样走平滑滚动
// —— 打字机每 55ms 重新赋值一次，等于每 55ms 重启一次滚动动画，滚动持续抖动/追赶。
//
// 修法：程序化自动滚动一律显式 behavior:"auto"（立即到位，不与动画打架）。
// CSS 的 smooth 保留给用户主动触发的滚动，并在 prefers-reduced-motion 下本就关闭。
const AUTO_SCROLL_BEHAVIOR: ScrollBehavior = "auto";

/** 最近一次自动滚动使用的 behavior（供调试/测试断言，证明没有与 CSS smooth 打架） */
let lastAutoScrollBehavior: ScrollBehavior | null = null;

/** 读取最近一次自动滚动的 behavior（测试钩子，只读） */
export function getLastAutoScrollBehavior(): ScrollBehavior | null {
    return lastAutoScrollBehavior;
}

/** 自动滚动到底部（打字机 / 追加消息 / NPC 旁白共用） */
export function scrollMessagesToBottom(): void {
    // 这里刻意保留"可缺失"语义：滚动是纯锦上添花，缺节点不该让整轮回复失败
    const container = ui.optEl("chat-messages");
    if (container) {
        lastAutoScrollBehavior = AUTO_SCROLL_BEHAVIOR;
        container.scrollTo({ top: container.scrollHeight, behavior: AUTO_SCROLL_BEHAVIOR });
    }
}

// ============ 消息装配 ============
//
// 头像文案由 chat.ts 注入：它是"角色卡 → emoji"的映射，属于角色域，不是渲染边界的事。
let avatarText: () => string = () => "🌸";

/** 由 chat.ts 注入头像文案生成器（角色卡变更后会自动生效，因为存的是函数） */
export function setAvatarTextGetter(fn: () => string): void {
    avatarText = fn;
}

/**
 * 追加一条消息气泡。
 *
 * 形状契约（被 tests/render-boundary.e2e.ts 盯住）：
 *   `div.msg.<role>`；role === "ai" 时**首先**插入 `div.msg-avatar`。
 */
export function appendMessage(role: "user" | "ai"): HTMLElement {
    const container = ui.el("chat-messages");
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    // AI 消息带角色头像（NPC 消息会覆盖为自己的头像）
    if (role === "ai") {
        const avatar = document.createElement("div");
        avatar.className = "msg-avatar";
        avatar.textContent = avatarText();
        div.appendChild(avatar);
    }
    container.appendChild(div);
    trimContainer(container, MAX_RENDERED_MESSAGES); // 【P0-4】视图有界
    scrollMessagesToBottom(); // 【P0-5】统一走 behavior:"auto"
    return div;
}

/**
 * 【P0-6】系统提示消息的统一入口。
 *
 * 缺陷原貌：三处调用点写成
 *     appendMessage("ai").classList.add("sys"); appendMessage("ai").textContent = "..."
 * 这是两条语句 —— 创建了**两个**元素：
 *   ① 第一个被加上 .sys（居中、无头像、弱化色），但内容是空的、不可见；
 *   ② 第二个没有 .sys，于是提示文本被渲染成一条**带角色头像的正常 AI 气泡**。
 * 后果：重置/角色更新提示样式错误；而 catch 分支会把 API 错误原文
 * 伪装成「角色说的话」显示给用户。
 *
 * 现在收敛为一个函数，调用点不可能再各写一半。
 */
export function appendSystemMessage(text: string): HTMLElement {
    const el = appendMessage("ai");
    el.classList.add("sys");
    el.textContent = text;
    return el;
}

/** 给消息加虚拟时间戳（体现"这条消息是几点发的"） */
export function attachTimeStamp(el: HTMLElement, virtualMs: number): void {
    const ts = document.createElement("span");
    ts.className = "msg-ts";
    const d = new Date(virtualMs);
    const p = (n: number) => String(n).padStart(2, "0");
    ts.textContent = `${p(d.getHours())}:${p(d.getMinutes())}`;
    el.appendChild(ts);
}

// ============ 打字机 ============

/** 一条回复的完整内容（对话必填，日语版/动作/心声可选） */
export interface ReplyFull {
    dialogue: string;
    dialogue_ja?: string;
    action?: string;
    thoughts?: string;
}

/**
 * "忙碌态"由 chat.ts 拥有（它还要管锁、副标题文案），这里只通过回调通知它。
 * 用注入而不是 import：避免 ui/ 反向依赖 chat.ts 造成循环。
 */
let onBusyChange: (busy: boolean) => void = () => {};

/** 由 chat.ts 注入忙碌态回调 */
export function setBusyChangeHandler(fn: (busy: boolean) => void): void {
    onBusyChange = fn;
}

/**
 * 分段打字机：按 \n 分段逐段播放，段间停顿。
 *
 * 【P0-5】帧驱动实现。manual=true 时不自动启动 rAF，而是返回 tick 由调用方逐帧驱动
 * —— 用于确定性测试（无头/限流环境下 rAF 可能只回调一次甚至不回调，
 * 那样无法验证"渐进渲染"这一行为本身）。
 */
/** typeReply 的返回：manual 模式下由调用方逐帧驱动 */
export interface TypeReplyHandle {
    tick: (now: number) => void;
    /**
     * 【4-A2】注册"真正渲染完成"回调。
     *
     * 为什么需要它：世界层需要把「有效玩家回合完成」当成一次真实事件来计数
     * （`store.turnCount++`）。但打字机可能因为 rAF 被限流而永远停在半途，
     * 看门狗也只是"最后兜底"——若把计数挂在「发起渲染」上，
     * 就会出现"回复根本没显示出来，世界却记了一轮"。
     * 因此计数挂在**渲染真正落定**上，并且带一个失败计时器：
     * 超时仍未完成就**不计数**（宁可少记一轮，也不记一轮假的）。
     */
    onFinish: (cb: () => void) => void;
    /** 立即停止等待；不会触发 onFinish */
    cancelPending: () => void;
}

export function typeReply(
    el: HTMLElement,
    full: ReplyFull,
    emotions?: Record<string, number>,
    manual = false,
): TypeReplyHandle | undefined {
    const dialogue = document.createElement("div");
    dialogue.className = "dialogue";
    el.appendChild(dialogue);

    const segments = full.dialogue.split("\n").filter((s) => s.trim());
    const finalText = segments.join("\n");

    const scrollToBottom = scrollMessagesToBottom; // 【P0-5】共享同一实现

    onBusyChange(true);
    let segIdx = 0;
    let i = 0;
    let rafId = 0;
    let lastFrameAt = 0;
    let pauseUntil = 0;
    let cancelled = false;

    /**
     * rAF 卡死兜底。
     *
     * 为什么必须有：rAF 在页面被隐藏 / 后台标签 / 部分省电与无头环境下会被限流甚至完全不回调。
     * 若只依赖 rAF，一旦它不触发，打字机就会**永远停在中途**，玩家看到一条残缺的回复。
     * 这里用真实时间做看门狗：超过 STALL_TIMEOUT_MS 没有任何帧回调，就直接完成渲染。
     */
    const STALL_TIMEOUT_MS = 2000;
    let lastTickRealAt = Date.now();
    const stallWatchdog = window.setInterval(() => {
        if (cancelled) return;
        if (Date.now() - lastTickRealAt >= STALL_TIMEOUT_MS) {
            if (rafId) cancelAnimationFrame(rafId);
            finish();
        }
    }, 500);

    // 【4-A2】"渲染真正落定"的观察者。默认空实现，保持原有行为。
    let finishObserver: (() => void) | null = null;
    let finishObserverTimer: number | null = null;
    /** 渲染未在预算内落定时放弃观察（不计数），避免把"没显示出来的回复"记成一轮 */
    const FINISH_OBSERVER_TIMEOUT_MS = 15000;

    const notifyFinished = () => {
        if (finishObserverTimer !== null) {
            window.clearTimeout(finishObserverTimer);
            finishObserverTimer = null;
        }
        const cb = finishObserver;
        finishObserver = null;
        cb?.();
    };

    const finish = () => {
        cancelled = true;
        window.clearInterval(stallWatchdog);
        dialogue.textContent = finalText;

        if (full.action) {
            const action = document.createElement("span");
            action.className = "action";
            action.textContent = `（${full.action}）`;
            el.appendChild(action);
        }

        if (full.thoughts) {
            const thoughts = document.createElement("span");
            thoughts.className = "thoughts";
            thoughts.textContent = `💭 ${full.thoughts}`;
            el.appendChild(thoughts);
        }

        scrollToBottom();
        onBusyChange(false);

        // TTS 朗读对话内容（优先使用日语版，带情感风格 + 停顿/重音标记）
        if (isTtsEnabled()) {
            const ttsText = full.dialogue_ja || finalText;
            if (ttsText) {
                // 根据情感生成风格指令，并透传情感数值用于插入停顿/语速标记
                const style = emotions ? generateEmotionStyle(emotions) : undefined;
                speak(ttsText, style, emotions);
            }
        }

        // 【4-A2】渲染落定 → 通知观察者（世界层的"完成一轮"计数挂在这里）
        notifyFinished();
    };

    /**
     * 【P0-5】打字机主循环。
     *
     * 缺陷原貌：原本用 window.setInterval(..., 55) 每 55ms 写一次 textContent 并强制读 scrollHeight。
     * 也就是「每 55ms 一次强制同步布局 + 一次滚动写入」，与 CSS scroll-behavior:smooth 叠加后
     * 还会不断重启滚动动画 —— 单条 200 字回复持续约 3.7 秒的抖动与主线程压力。
     *
     * 修法：改为 rAF 驱动，用时间累加器保持原有的「每 55ms 出 3 个字」节奏
     * （视觉节奏不变，但每次渲染都对齐到浏览器帧；被切到后台时 rAF 自动暂停，不再空转）。
     */
    const FRAME_INTERVAL_MS = 55; // 与修复前一致的出字节奏
    const CHARS_PER_STEP = 3;

    const tick = (now: number) => {
        if (cancelled) return;
        lastTickRealAt = Date.now();
        if (!lastFrameAt) lastFrameAt = now;

        // 段间停顿（模拟"她想了想"），期间不刷新文字但持续持有帧循环
        if (now < pauseUntil) {
            rafId = requestAnimationFrame(tick);
            return;
        }

        const elapsed = now - lastFrameAt;
        if (elapsed < FRAME_INTERVAL_MS) {
            rafId = requestAnimationFrame(tick);
            return;
        }
        lastFrameAt = now;

        const seg = segments[segIdx];
        if (seg === undefined) {
            finish();
            return;
        }

        if (i < seg.length) {
            i = Math.min(seg.length, i + CHARS_PER_STEP);
            dialogue.textContent =
                segments.slice(0, segIdx).join("\n") + (segIdx > 0 ? "\n" : "") + seg.slice(0, i);
            scrollToBottom();
            rafId = requestAnimationFrame(tick);
            return;
        }

        // 本段播完 → 停顿后进入下一段
        segIdx++;
        i = 0;
        if (segIdx >= segments.length) {
            finish();
            return;
        }
        dialogue.textContent = segments.slice(0, segIdx).join("\n") + "\n…";
        scrollToBottom();
        pauseUntil = now + 700 + Math.random() * 400;
        lastFrameAt = pauseUntil;
        rafId = requestAnimationFrame(tick);
    };

    // 页面卸载 / 重置时避免继续向已脱离的节点写字
    window.addEventListener(
        "pagehide",
        () => {
            cancelled = true;
            if (rafId) cancelAnimationFrame(rafId);
            // 页面卸载 → 放弃观察，不计数
            if (finishObserverTimer !== null) {
                window.clearTimeout(finishObserverTimer);
                finishObserverTimer = null;
            }
            finishObserver = null;
        },
        { once: true },
    );

    const handle: TypeReplyHandle = {
        tick,
        onFinish(cb) {
            if (cancelled) {
                cb();
                return;
            }
            finishObserver = cb;
            finishObserverTimer = window.setTimeout(() => {
                finishObserverTimer = null;
                finishObserver = null; // 超时放弃：不计数
            }, FINISH_OBSERVER_TIMEOUT_MS);
        },
        cancelPending() {
            if (finishObserverTimer !== null) {
                window.clearTimeout(finishObserverTimer);
                finishObserverTimer = null;
            }
            finishObserver = null;
        },
    };

    if (manual) return handle;
    rafId = requestAnimationFrame(tick);
    return handle;
}
