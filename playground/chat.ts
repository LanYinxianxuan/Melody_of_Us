// chat.ts —— 聊天页主入口：UI 渲染、消息流程、事件胶水
// 数据与逻辑分散在 state/storage/character/time/story/ai/wizard 模块中。

import {
    aiState,
    DIMENSIONS,
    applyDelta,
    clamp,
    describeMood,
    dominantTrait,
    resetState,
    initStateForRelation,
    USER_EMOTION_FIX,
    EMOTION_NAMES,
} from "./state";
import { store, saveState, loadState, SAVE_KEY, CHAR_KEY, currentSlot, initNpcWorld, setSaveFailureHandler, clearLoadOutcome, slotKey, KEY_PREFIX } from "./storage";
import { CHARACTER, PRESETS, loadCharacter, saveCharacter, type CharacterProfile } from "./character";
// 命名空间导入而不是具名导入：本文件里有 13 处局部变量/参数也叫 `el`
// （appendMessage 的返回值、agent-debug 节点、头像遍历变量…）。
// 具名导入会被这些局部名**静默遮蔽** —— 今天恰好没有"在遮蔽作用域里调用 ui.el()"的地方，
// 但明天加一行就会变成一个极难定位的 TypeError。`ui.el(...)` 从语法上就不可能被遮蔽。
import * as ui from "./ui/dom";
import { invalidateWorldSurface, refreshWorldSurface } from "./ui/world/world-surface";
import { currentWorldViewModel, worldSurfaceStats } from "./ui/world/world-surface";
import { buildWorldViewModel } from "./ui/world/world-view-model";
import { __resetNpcSurfaceForTest, npcRowCount } from "./ui/world/npc-surface";
import { __resetEventSurfaceForTest, eventRowCount, renderEventSurface } from "./ui/world/event-surface";
import { __resetStoryLogForTest } from "./ui/world/story-log-surface";
import { __resetWorldSurfaceForTest } from "./ui/world/world-surface";
import { applyMemoryOp, gateDimensionDelta, gateMemoryUpdate, gateLocalDelta } from "./state-gate";
import { isFactualStoryEvent } from "./save-schema";
import {
    PROACTIVE_PLACEHOLDER,
    fillCharForm,
    hideCharModal,
    hideHistoryModal,
    matchCurrentPreset,
    openHistory,
    readCharForm,
    renderHistoryToChat,
    setCharacterRef,
    showCharModal,
    showHistoryCleared,
} from "./ui/modals";
import {
    buildMeters,
    drawChart,
    logEmotion,
    resetChartHistory,
    setStateGetter,
    updateStateUI,
} from "./ui/state-panel";
import {
    MAX_MOOD_ENTRIES,
    MAX_RENDERED_MESSAGES,
    appendMessage,
    appendSystemMessage,
    attachTimeStamp,
    getLastAutoScrollBehavior,
    scrollMessagesToBottom,
    setAvatarTextGetter,
    setBusyChangeHandler,
    trimContainer,
    typeReply,
} from "./ui/message";
import {
    FIRST_MEETING_HHMM,
    slotMinutes,
    scheduleIndexFor,
    currentDayIndex,
    startClock,
    updateScheduleUI,
    setVirtualTime,
    setTimeRate,
    setStartDate,
    jumpToToday,
    onSlotChanged,
    proactiveLine,
    currentSchedule,
    markUserReplied,
    setSlotChangeHandler,
    setDayChangeHandler,
    setMessageSender as setTimeMessageSender,
    setRelationGetter,
    setProactiveEnabled,
    setProactiveGate,
    setProactiveDriveGetter,
    setChatCapabilityGetter,
    setRandomMomentHook,
    herLocation,
} from "./time";
import {
    fallbackStory,
    updateStoryUI,
    finalizeDay,
    maybeRandomMoment,
    proactiveDrive,
    bumpTurnsSinceEvent,
    markUserInput,
    userIsTyping,
    isNewSaveProtectionActive,
    journalText,
    neglectLevel,
    neglectLine,
    setStoryCharNameGetter,
    setStoryLogEventsProvider,
} from "./story";
import { chatWithDeepSeek, demoReply, setCharacterGetter, SYSTEM_PROMPT, normalizeSuggestions, isThinkingEnabled, type ChatResult } from "./ai";
import { npcContext, npcSpeak } from "./ai";
import {
    runAgentPipeline,
    refineWithModelAnalysis,
    finishAgentTurn,
    snapshotAgentMind,
    restoreAgentMind,
    resetAgentMind,
    applyTimeDecay,
    setImperfectionRate,
    debugSnapshot,
    type AgentTurn,
} from "./mind";
import { renderAgentDebug, updateAgentDebugAfterTurn, installMindDebugHooks, logAgentTurnToConsole, logAgentTurnResponseToConsole, setAgentConsoleLog } from "./mind-debug";
import { speak, isTtsEnabled, setTtsEnabled, initTts, migrateVoice, generateEmotionStyle } from "./tts";
import {
    applyAgendaFromAI,
    tickAgenda,
    renderAgendaUI,
    planTodayAgenda,
    todayHasNoAgenda,
    setAgendaCharacterGetter,
} from "./agenda";
import {
    detectTrigger,
    callDirector,
    normalizeDecision,
    type DirectorDecision,
    type DirectorTrigger,
} from "./director";
import { openWizard, setWizardSavedCallback } from "./wizard";
import { rollEventSeed, resetEventTracker } from "./events";
import {
    screenNpcCandidates,
    decideIntervention,
    buildPublicRecent,
    applyNpcResult,
    tickNpcWorld,
    type InterventionCandidate,
    checkInterventionSafety,
    lastGoalRelevance,
    type InterventionMode,
} from "./intervention";
import {
    maybeShowEventCard,
    passOpenEventCards,
    resetEventCardTracker,
    dismissAllEventCards,
    previewEventCard,
    forceShowEventCard,
} from "./event-card";
import { setReplySuggestions, renderActionSuggestBar } from "./action-suggest";

// ============ 角色弹层数据流 ============

// 检查当前槽位是否有 API Key（per-slot 存储）
function hasApiKey(): boolean {
    return !!localStorage.getItem(slotKey(KEY_PREFIX.apikey, currentSlot));
}

let CHARACTER_REF: CharacterProfile = CHARACTER;

setCharacterGetter(() => CHARACTER_REF);

// 【阶段 3.3】把 chat 级的两个关注点注入 ui/message.ts：
//   · 头像文案（角色域 → emoji）
//   · 忙碌态（chat 还要管锁与副标题文案，所以由它拥有，ui 只负责通知）
setAvatarTextGetter(() => charAvatar());
setStateGetter(() => aiState);
// 【阶段 3.4b】把角色对象的读写注入 ui/modals.ts（避免 ui/ 反向依赖 chat.ts）
setCharacterRef(
    () => CHARACTER_REF,
    (patch) => Object.assign(CHARACTER_REF, patch),
);
setBusyChangeHandler((b) => setBusyState(b));

// 角色头像 emoji（从名字取，无则默认）
function charAvatar(): string {
    const name = CHARACTER_REF.name || "";
    if (/桃|momo|Momo/i.test(name)) return "🍑";
    if (/仁菜|nina|Nina/i.test(name)) return "🎀";
    if (/鲸/.test(name)) return "🐳";
    if (/洛|绫/.test(name)) return "🎸";
    if (/影/.test(name)) return "🐱";
    if (/熠/.test(name)) return "🩺";
    if (/安黎/.test(name)) return "💼";
    if (/苏|晚/.test(name)) return "🖌";
    return "🌸";
}


let busy = false;

function setBusyState(b: boolean) {
    busy = b;
    const dot = ui.el("status-dot");
    const title = ui.el("chat-title-text");
    const sub = ui.el("chat-subtitle");
    dot.classList.toggle("busy", b);
    // 【P0-7】曾误读 "deepseek-effort"（无写入方的孤儿键）→ 状态永远显示「思考中…」。
    // 统一走 ai.ts 的访问器，与真实请求参数共用同一个判断。
    const thinking = isThinkingEnabled();
    title.textContent = CHARACTER_REF.name || "情感 AI";
    sub.textContent = b
        ? `${thinking ? "思考中…" : "回复中…"}`
        : demoMode
            ? "演示模式（不会思考）"
            : "在线 · 她正等着你";
}

// ============ 聊天流程 ============

let demoMode = false;

// 每轮对话的检查点（每条主角回复一个，重答按钮定位用）
interface RedoCheckpoint {
    domStart: Node | null;                       // 该轮开始前的最后一个消息节点
    userText: string;                            // 该轮用户输入（重答时重发）
    proactive: boolean;                          // 是否为“她主动开口”（重答时保持同样的主动通道）
    aiStateSnap: Record<string, number | undefined>; // 情感快照
    /**
     * 【D4】剧情进度快照。
     *
     * 缺陷原貌：本接口**没有这个字段**，`reAnswerAt` 的回滚清单里也没有它
     *   → 重答时 `aiState`/历史/事件/记忆/剧情线/日程全部回滚，**唯独进度不回滚**，
     *     而重新生成会**再**把新那一轮的 `story.progress` 加上去
     *     → 同一轮重答 N 次 = 进度累加 N 次（进度条虚高，且会提前顶到 100）。
     * 修法：把进度纳入快照与回滚，与其它世界状态保持一致。
     * 注意：**不改变**进度的数值设计、单步上限或任何阈值 —— 只让它正确地被回滚。
     */
    storyProgressSnap: number;
    /**
     * 【Phase 4-C 决策 4】回合计数快照。
     *
     * 语义定义（Core 级）：**一次玩家输入产生的最终有效回答 = 一个历史有效回合。**
     *   · 首次回答 → `turnCount + 1`
     *   · Redo     → 回滚到该回答的检查点 → 重新生成 → **不额外增加历史 turnCount**
     * 因此"用户输入 11 → Redo" 仍然是 11，而不是 11 → 12 → 13。
     *
     * 注意与 `events.turnCounter` 的区别：后者是**会话级事件节奏计数**，
     * 既不持久化也不受本决策影响（随机事件频率不变）。
     */
    turnCountSnap: number;
    historyLen: number;                          // 聊天历史长度
    storyLen: number;                            // 剧情事件数
    memLen: number;                              // 记忆数
    thread: string | null;                       // 剧情线
    agendaSnap: typeof store.agenda;             // 日程快照
    agentSnap: ReturnType<typeof snapshotAgentMind>; // Agent Mind 快照（用户状态/AI状态/关系张力/轨迹）
}
// 可「重答」的最近轮数。属于检查点语义（core/turn），因此留在本文件而不是 ui/。
const MAX_TURN_CHECKPOINTS = 30;

let turnCheckpoints: RedoCheckpoint[] = [];

/**
 * 【P0-4】检查点同样需要上限。
 * 每个检查点都持有 {...aiState}(38 维) + snapshotAgentMind() + agenda 深拷贝 + DOM 节点引用，
 * 而此前只在「重答」时截断，正常游玩会一直累积。
 * 「重答」按钮随消息一起被 trimContainer 移除，因此旧的检查点即便保留也无法再被触发 ——
 * 保留最近若干轮即可覆盖实际可用的回看范围。
 */
function trimTurnCheckpoints() {
    if (turnCheckpoints.length <= MAX_TURN_CHECKPOINTS) return;
    turnCheckpoints.splice(0, turnCheckpoints.length - MAX_TURN_CHECKPOINTS);
}

/**
 * 【4-A2 · G-1】"有效玩家回合完成" → `store.turnCount++`
 *
 * 语义（与 `events.ts` 的会话级 `turnCounter` 严格区分）：
 *   · `store.turnCount`   = **持久化**的历史有效交互回合数（随存档往返，跨会话累积）
 *   · `events.turnCounter` = **当前 session** 的事件节奏计数（模块级，刷新即归零，不持久化）
 * 两者**互不写入**。本函数只动前者；`events.ts` 的节奏判定保持原样，因此随机事件的
 * 触发频率**不因本次修复而改变**（`events.ts:37-53` 只读它自己的计数器与 `Math.random()`）。
 *
 * 为什么挂在"渲染落定"上而不是"发起回复"上：
 *   一轮只有在**玩家看到回复**之后才算真正完成。若 API 失败、内容解析失败、
 *   或打字机因 rAF 被限流而卡住（15s 后放弃观察），都不计数 ——
 *   宁可少记一轮，也不让世界记一轮假的。
 */
let turnSerial = 0;
/** 已经计过数的最后一轮序号（保证同一轮即使有多个完成回调也只 +1） */
let lastCountedTurn = 0;

/**
 * 把第 `serial` 轮计为"一个历史有效回合"。
 *
 * 为什么必须**按序号幂等**：`typeReply` 的完成回调可能在多种时序下触发 ——
 *   ① 正常渲染完成（rAF 或 stall 看门狗）；② 上一轮的回调在本轮才迟到触发（rAF 被限流时很常见）。
 * 若只是无条件 `turnCount++`，迟到的旧回调会**各加一次**，
 * 于是"一轮"被记成多轮（实测：一次 Redo 后计数从 0 跳到 6）。
 *
 * 语义（Phase 4-C 决策 4）：**一次玩家输入产生的最终有效回答 = 一个历史有效回合。**
 *   · 首次回答 → +1
 *   · Redo     → 回滚计数后重新生成 → 该轮再 +1（净变化 0）
 *   · 迟到的旧回调 → 因序号落后而被忽略
 */
function countCompletedTurn(serial: number): void {
    if (serial <= lastCountedTurn) return; // 迟到的旧回调：忽略
    const cpSnap = turnCheckpoints[turnCheckpoints.length - 1]?.turnCountSnap;
    if (typeof cpSnap === "number" && store.turnCount !== cpSnap) {
        // 计数在"快照之后"被写过（例如重答回滚），以快照为基准重算，避免叠加
        store.turnCount = cpSnap;
    }
    lastCountedTurn = serial;
    store.turnCount = (Number.isFinite(store.turnCount) ? store.turnCount : 0) + 1;
    saveState();
}

async function sendMessage(text: string, opts?: { proactive?: boolean }): Promise<ChatResult | null> {
    const proactive = opts?.proactive ?? false;
    // 本轮回复的渲染句柄；成功路径会为它注册"完成计数"
    let replyHandle: ReturnType<typeof typeReply> = undefined;
    /** 本轮是否真的产出了对话内容（失败路径保持 false，因此不计数） */
    let replyDelivered = false;
    /** 本轮序号（用于让"完成计数"幂等，见 `countCompletedTurn`） */
    turnSerial += 1;
    const mySerial = turnSerial;
    // 每轮开始时把幂等基线归零。
    //
    // ⚠️ 诚实说明：**这不是一个已证实的缺陷修复，而是防御性收敛**。
    //   我一度以为它是"多次重答后新回合不再计数"的原因，但按行号注入
    //   （移除这一行）后套件仍然全绿 —— 注入**没有复现**，因此那个归因是错的。
    //   真实原因见 `tests/render-boundary.e2e.ts` phase 6 的注释：
    //   是**渲染完成观察器在虚拟时钟窗口内未触发**（无头环境限制），不是逻辑问题。
    //
    //   保留这一行的理由：`turnSerial` 单调递增，因此每个迟到回调的序号**必然小于**
    //   后续任何一轮 —— 归零基线在语义上等价，但它让"基线只描述当前轮"这件事显式化，
    //   避免将来有人改动序号分配方式时踩到隐藏前提。
    lastCountedTurn = 0;

    // 记录本轮检查点（每条主角回复一个，重答时回滚到该轮之前）
    const container = ui.el("chat-messages");
    const cpIdx = turnCheckpoints.length;
    turnCheckpoints.push({
        domStart: container.lastChild,
        userText: proactive ? PROACTIVE_PLACEHOLDER : text,
        proactive,
        aiStateSnap: { ...aiState },
        storyProgressSnap: store.storyProgress, // 【D4】
        turnCountSnap: store.turnCount, // 【决策 4】
        historyLen: store.chatHistory.length,
        storyLen: store.storyEvents.length,
        memLen: store.memories.length,
        thread: store.activeThread,
        agendaSnap: JSON.parse(JSON.stringify(store.agenda)),
        agentSnap: snapshotAgentMind(),
    });
    trimTurnCheckpoints(); // 【P0-4】与 DOM 裁剪保持一致的上限

    if (!proactive) {
        bumpTurnsSinceEvent();
        markUserReplied(); // 用户回复了 → 她可以再次主动开口
        // 记录用户最后回复时刻（真实+虚拟），用于"被冷落"反应
        store.lastReplyRealAt = Date.now();
        store.lastReplyVirtualAt = store.virtualMs;
        const userEl = appendMessage("user");
        userEl.textContent = text;
        attachTimeStamp(userEl, store.virtualMs);
    }

    setBusyState(true);

    try {
        let result: ChatResult;

        // ===== Agent Mind：先在回复前完成整条决策链（0 成本本地规则） =====
        // 分析用户消息 → 上下文 → 用户/AI/关系状态更新（惯性+衰减） → 策略选择 → 紧凑上下文注入 LLM
        const agentTurn: AgentTurn = runAgentPipeline(text, {
            proactive,
            likes: CHARACTER_REF.likes ?? "",
        });
        // 主流程决策链 → 控制台调试（正式用户不可见；__debug.mindConsole(false) 可关）
        logAgentTurnToConsole(agentTurn);

        if (demoMode) {
            const base = demoReply(text, agentTurn.analysis, agentTurn.strategy);
            // 被冷落时用专门的文案（proactive 触发）
            const isNeglect = /被冷落|等了你|没有回复|不理你|想你了/.test(text);
            result = proactive
                ? { ...base, dialogue: isNeglect ? neglectLine(neglectLevel().level) : proactiveLine(), story: fallbackStory() }
                : base;
        } else {
            // 代码层掷随机事件种子（30% 概率，连续 3 轮强制），注入系统提示词引导 AI 自然融入
            const eventSeed = rollEventSeed();
            // 策略块随后的单次模型调用：模型是最终语言生成器，决策已在上面完成
            result = await chatWithDeepSeek(text, 2, eventSeed ?? undefined, agentTurn.prompt);
        }

        if (!result.dialogue) {
            throw new Error("AI 返回格式异常，请检查 API Key 或稍后重试");
        }

        // LLM 同一调用内可选回传 user_analysis → 语义微调（不推翻本地信号）
        if (!demoMode && result.user_analysis) {
            refineWithModelAnalysis(agentTurn, result.user_analysis);
        }

        // 预判动作/表情条（独立于随机事件，常驻）：优先用模型回传的建议，缺失时本地规则兜底
        setReplySuggestions(normalizeSuggestions(result.suggestions));
        renderActionSuggestBar();

        // 【4-A3 / 4-A4】AI 的数值修改统一过闸门：
        //   维度白名单（AI 不能扩展状态字段）· 类型 · NaN/Infinity · 单步上限
        const deltaGate = gateDimensionDelta(result.delta);
        if (deltaGate.rejected.length) {
            console.warn("[状态闸门] 已丢弃非法 delta 条目：", deltaGate.rejected);
        }
        applyDelta(deltaGate.clean);

        // 本地兜底表同样过闸门（数值来自本地，但走同一套合法性检查）
        const fix = USER_EMOTION_FIX[result.user_emotion] ?? {};
        for (const [k, v] of Object.entries(gateLocalDelta(fix).clean)) {
            aiState[k] = clamp(aiState[k]! + v * 0.5);
        }

        updateStateUI();
        logEmotion(proactive ? "ai" : "user", proactive ? "主动" : text, EMOTION_NAMES[result.user_emotion] ?? result.user_emotion);
        logEmotion("ai", result.dialogue.slice(0, 20), `↗${dominantTrait()}`);

        // 剧情推进：AI 给了事件才记录（普通聊天不硬凑事件）
        const story = result.story && result.story.event ? result.story : null;

        if (story?.event) {
            store.storyEvents.push({ day: currentDayIndex(), text: story.event, source: "narrative" });
            if (store.storyEvents.length > 100) store.storyEvents.shift();
        }

        if (typeof story?.progress === "number") {
            store.storyProgress = clamp(Math.round(store.storyProgress + story.progress));
        }

        if (story?.thread === "new") {
            store.activeThread = story.event ?? null;
        } else if (story?.thread === "end") {
            store.activeThread = null;
        }

        updateStoryUI();

        // 日程：对话中产生了新约定 → 加入时间线
        applyAgendaFromAI(result.agenda);
        renderAgendaUI();

        // 写入聊天历史（AI 的记忆）
        if (proactive) {
            // 她主动开口：历史里 user 侧用说明性占位，避免 AI 把情境指令当用户的话
            store.chatHistory.push({ role: "user", content: PROACTIVE_PLACEHOLDER, ts: store.virtualMs });
        } else {
            store.chatHistory.push({ role: "user", content: text, ts: store.virtualMs });
        }
        store.chatHistory.push({ role: "assistant", content: result.dialogue, ts: store.virtualMs });
        if (store.chatHistory.length > 200) store.chatHistory = store.chatHistory.slice(-200);

        // 保存 AI 主动记住的重要事情（长期记忆）
        if (result.memory && result.memory.trim()) {
            const m = result.memory.trim().slice(0, 60);
            if (!store.memories.includes(m)) {
                store.memories.push(m);
                if (store.memories.length > 30) store.memories = store.memories.slice(-30);
            }
        }

        saveState();

        // 剧情旁白插入对话流（只有真的发生事件才插）
        if (story?.event) {
            const container = ui.el("chat-messages");
            const line = document.createElement("div");
            line.className = "story-line";
            line.textContent = story.event;
            container.appendChild(line);
            scrollMessagesToBottom();
        }

        const msgEl = appendMessage("ai");

        if (proactive) {
            msgEl.classList.add("proactive");
        }

        // 消息旁的重答按钮（定位到本轮检查点）
        addReanswerBtn(msgEl, cpIdx);

        // 【4-A2】保存句柄：真正的"有效回合完成"计数挂在渲染落定上（见 finally）
        replyHandle = typeReply(msgEl, result, aiState);
        attachTimeStamp(msgEl, store.virtualMs);

        const deltaSummary = Object.entries(result.delta ?? {})
            .filter(([, v]) => Math.abs(v as number) >= 3)
            .map(([k, v]) => {
                const dim = DIMENSIONS.find((d) => d.key === k);
                return `${dim?.label ?? k}${(v as number) > 0 ? "+" : ""}${v}`;
            })
            .join(" ");
        const tag = document.createElement("span");
        tag.className = "emotion-tag";
        tag.textContent = `${proactive ? "她主动开口｜" : ""}AI 状态：${dominantTrait()}${deltaSummary ? `｜变化：${deltaSummary}` : ""}`;
        msgEl.appendChild(tag);

        // 【4-A2】有效回合完成的判定：AI 真的产出了对话内容（catch 分支不会走到这里）
        replyDelivered = !!result.dialogue;

        // Agent Mind：回填决策轨迹（previous → signal → transition → strategy → response）并刷新调试面板
        finishAgentTurn(agentTurn, result.dialogue);
        logAgentTurnResponseToConsole(agentTurn, result.dialogue);
        updateAgentDebugAfterTurn(agentTurn);

        // 主角回复完成 → 世界调度层（Director）智能判断（代码层 trigger 命中才调用）
        if (!proactive) {
            void maybeDirector(text);
            void maybeNpcIntervention();
            // 随机事件卡（全局触发，30%~40%；只呈现事件，不含预判动作）
            void maybeShowEventCard(CHARACTER_REF.name);
        }

        return result;
    } catch (e) {
        appendSystemMessage((e as Error).message);
        return null;
    } finally {
        setBusyState(false);
        // 「有效回合完成」计数：两个条件都满足才计数 ——
        //   ① AI 真的产出了对话内容（replyDelivered）
        //   ② 渲染真正落定（onFinish 至多触发一次；未落定/超时则永不触发）
        if (replyDelivered && replyHandle) replyHandle.onFinish(() => countCompletedTurn(mySerial));
    }
}

async function handleSend() {
    const input = ui.el<HTMLInputElement>("chat-input");
    const sendBtn = ui.el<HTMLButtonElement>("chat-send");
    const text = input.value.trim();

    if (!text) return;

    input.value = "";
    sendBtn.disabled = true;

    try {
        // 用户从主输入框继续 → 未处理的随机事件卡视为"错过"（不再可点）
        passOpenEventCards();
        // 动作和话一起发出（如"我抱住她，说：想你"）→ 原文直发，
        // AI 自行区分哪些是动作、哪些是语言（见 SYSTEM_PROMPT）
        await sendMessage(text);
    } finally {
        sendBtn.disabled = false;
    }
}

// 重新回答：回滚到上一轮开始前（删除旧回复，只保留新回复），再重新生成
// 消息旁"重答"按钮：点击回滚到该条回复之前，重新生成
function addReanswerBtn(msgEl: HTMLElement, cpIdx: number) {
    const btn = document.createElement("button");
    btn.className = "msg-reanswer";
    btn.innerHTML = `<svg class="ico" viewBox="0 0 24 24" style="width:12px;height:12px;"><use href="#i-rotate-ccw"/></svg>`;
    btn.title = "重新回答这条（之后的内容也会重来）";
    btn.addEventListener("click", () => void reAnswerAt(cpIdx));
    msgEl.appendChild(btn);
}

// 重答指定轮：回滚到该轮开始前（删除该条回复及其后所有内容），再重新生成
async function reAnswerAt(cpIdx: number) {
    if (busy) return;
    if (cpIdx < 0 || cpIdx >= turnCheckpoints.length) return;
    const cp = turnCheckpoints[cpIdx];
    if (!cp) return;

    // 1. 删除该轮之后的所有 DOM（该回复、之后的剧情旁白/NPC消息…）
    const container = ui.el("chat-messages");
    let node = cp.domStart ? cp.domStart.nextSibling : container.firstChild;
    while (node) {
        const next = node.nextSibling;
        node.remove();
        node = next;
    }

    // 2. 回滚状态（情感/历史/事件/记忆/剧情线/日程/剧情进度/Agent Mind）到该轮开始前
    Object.assign(aiState, cp.aiStateSnap);
    restoreAgentMind(cp.agentSnap);
    store.storyProgress = cp.storyProgressSnap; // 【D4】此前漏了这一项 → 重答重复累加
    // 【决策 4】重答不算一个新的历史有效回合：回滚计数，重新生成后再由
    // `countCompletedTurn()` 恢复为"该轮 +1"。净效果 = 重答前后 turnCount 不变。
    store.turnCount = cp.turnCountSnap;
    store.chatHistory.length = cp.historyLen;
    store.storyEvents.length = cp.storyLen;
    store.memories.length = cp.memLen;
    store.activeThread = cp.thread;
    store.agenda = JSON.parse(JSON.stringify(cp.agendaSnap));
    updateStateUI();
    updateStoryUI();
    renderAgendaUI();
    {
        const debugBox = ui.optEl("agent-debug");
        if (debugBox) renderAgentDebug(debugBox);
    }

    // 3. 丢弃该轮及其后的检查点（之后 sendMessage 会重推）
    turnCheckpoints.length = cpIdx;

    // 4. 重新生成
    setBusyState(true);
    try {
        await sendMessage(cp.userText, cp.proactive ? { proactive: true } : undefined);
    } finally {
        setBusyState(false);
    }
}

// ============ 支线 NPC 介入流程 ============
// 主角回复完成后才检查（主角永远第一优先级）
// 第一层：程序规则筛选 → 第二层：概率决定 → NPC 发言（1 次 API）→ 渲染

// ============ World Director：世界调度层 ============
// 只在代码层 trigger 命中时调用（不每轮调用）；普通聊天不经过 Director。
// Director 只做智能决策（事件/NPC/记忆/情感），不生成聊天文本。

let directorBusy = false;

// 执行 Director 决策（不渲染聊天文本，只改变世界状态）
// 只执行：事件记录 / NPC 介入 / 关系变化 / 记忆更新。绝不生成聊天文本。
async function executeDirectorDecision(decision: DirectorDecision) {
    if (!decision) return;

    // 1. 事件（按优先级过滤：主线优先；NPC 事件若与主线冲突由 Director 自己已判断，这里只执行）
    if (decision.needEvent && decision.eventType !== "none") {
        // 事件文案：根据类型生成（NPC 事件用介入流程渲染；story/world 事件用旁白）
        if (decision.eventType === "npc_intervention" && decision.npcId) {
            // 交给 NPC 介入流程（第 2 步）
        } else if (decision.eventType === "story_event" || decision.eventType === "world_event") {
            // 主线/世界事件：旁白提示 + 记入剧情档案
            const ev = decision.reason || "世界悄悄地发生了变化";
            // 【4-A7】Director 的 reason 是"调度器对自己决定的解释"，不是已发生的事实描述
            // 【4-B2】带上调度等级：priority 全程不参与数值计算，只用于追溯与 prompt 可见性
            store.storyEvents.push({
                day: currentDayIndex(),
                text: ev,
                source: "director",
                priority: decision.priority,
            });
            if (store.storyEvents.length > 100) store.storyEvents.shift();

            const container = ui.el("chat-messages");
            const line = document.createElement("div");
            line.className = "story-line";
            line.textContent = ev;
            container.appendChild(line);
            scrollMessagesToBottom();

            updateStoryUI();
        }
    }

    // 2. NPC 介入（Director 指定，走现有 runNpcIntervention 渲染；多人模式关闭时不介入）
    if (decision.eventType === "npc_intervention" && decision.npcId && store.npcEnabled) {
        // 【4-B3】Director 只能"提议介入"，**是否合法由 Core 判定**。
        //
        // 缺陷原貌：这里直接以 `score: 100` 调 `runNpcIntervention`，
        //   完全绕过 `screenNpcCandidates` 的全部检查 —— 包括与世界安全有关的那些
        //   （深夜保护、私密话题、参与者合法性）。也就是「导演可以决定在深夜、
        //   在私密话题里、甚至用一个不存在的 NPC 强行插入」。
        //
        // Core 现在判定的是**世界安全规则**（`checkInterventionSafety`）：
        //   · 参与者合法（NPC 存在、未在场、未在进行中的介入里）
        //   · 她的作息不是深夜、没有在睡
        //   · 不是"深夜独处 + 私密话题"的场景
        // 而 **6 小时冷却与概率门不属于此列**：它们是 Director 的**调度条件**
        //   （表达"多久尝试一次"），不是"合不合法"。Director 的介入天然只发生在
        //   跨天与离线回归两个时刻，套用冷却与概率门会让该功能直接失效。
        const safety = checkInterventionSafety(decision.npcId, recentContextText(), { npcBusy });
        if (!safety.ok) {
            console.log(`[Director] NPC 介入被 Core 守卫拒绝：${safety.reason}`);
        } else {
            const npc = store.npcs[decision.npcId]!;
            npcBusy = true;
            try {
                // 复用介入模式：NPC 在主角所在场景附近 → 直接出现；否则 → 发消息
                const s = store.scene;
                const nearbyZones = [s.place, `${s.place}附近`, "去" + s.place + "的路上", "回家的路上"];
                const nearby = nearbyZones.includes(npc.location) || npc.location === herLocation();
                const mode: InterventionMode = nearby ? "join" : "message";
                const pick: InterventionCandidate = { npc, mode, reason: decision.reason, score: 100 };
                await runNpcIntervention(pick);
            } catch (e) {
                console.warn("Director NPC 介入失败：", e);
            } finally {
                npcBusy = false;
            }
        }
    }

    // 3. 关系变化（主角 38 维 / NPC 关系）
    if (decision.relationshipEffect) {
        const rel = decision.relationshipEffect;
        if (rel.target === "main") {
            // 主角对用户：落到好感/信任
            // 【4-A4 / 4-A8】与主回复共用同一个维度闸门（此前是两套独立校验）
            const relGate = gateDimensionDelta({ affection: rel.delta, trust: rel.delta * 0.6 });
            for (const [k, v] of Object.entries(relGate.clean)) {
                aiState[k] = clamp(aiState[k]! + v);
            }
            updateStateUI();
        } else if (rel.target === "user") {
            // 用户对主角（用户侧由用户自己决定，这里只微调主角感知）
            const relGate = gateDimensionDelta({ affection: rel.delta * 0.5 });
            for (const [k, v] of Object.entries(relGate.clean)) {
                aiState[k] = clamp(aiState[k]! + v);
            }
            updateStateUI();
        } else if (rel.target === "npc" && rel.npcId && store.npcs[rel.npcId]) {
            // NPC 与主角关系
            const npc = store.npcs[rel.npcId]!;
            npc.relToMain = clamp(npc.relToMain + rel.delta);
            npc.history.push(
                `第${currentDayIndex()}天：和${CHARACTER_REF.name}的关系${rel.delta >= 0 ? "更亲近了" : "有些疏远"}（${decision.reason}）`,
            );
            if (npc.history.length > 30) npc.history = npc.history.slice(-30);
        }
    }

    // 4. 记忆更新（主角长期记忆）
    // 【4-A4 / 4-A8】统一走闸门：`forget` 由"子串批量删除"收紧为"精确删除单条"
    // （安全性收紧，见 GAMEPLAY_REVIEW 的 G-6）
    const memOp = gateMemoryUpdate(decision.memoryUpdate);
    if (memOp) {
        store.memories = applyMemoryOp(store.memories, memOp);
    }

    saveState();
}

// 主入口：用户消息后调用（主角回复完成后）
async function maybeDirector(userText: string) {
    if (directorBusy || demoMode) return;
    if (!hasApiKey()) return;

    // 代码层 trigger：普通聊天 → null → 完全不调用 Director
    const trigger = detectTrigger(userText);
    if (!trigger) return;

    // 跨天/离线等外部 trigger 由调用方直接传；这里只处理消息类 trigger
    await runDirector(trigger);
}

// 通用执行（消息 trigger / 跨天 / 离线共用）
async function runDirector(trigger: DirectorTrigger) {
    if (directorBusy || demoMode) return;
    if (!hasApiKey()) return;

    directorBusy = true;
    try {
        const decision = await callDirector(trigger);
        await executeDirectorDecision(decision);
    } catch (e) {
        console.warn("Director 决策失败：", e);
    } finally {
        directorBusy = false;
    }
}

// 跨天触发（dayChangeHandler 调用）
function directorOnDayChange(oldDay: number, newDay: number) {
    void runDirector({ type: "day-change", oldDay, newDay });
}

// 离线回归触发（初始化时检查）
function directorOnOfflineReturn(idleMin: number) {
    if (idleMin < 30) return; // 30 分钟以上才值得世界响应
    void runDirector({ type: "offline-return", idleMin });
}

let npcBusy = false;

async function maybeNpcIntervention() {
    if (npcBusy || demoMode) return;
    if (!hasApiKey()) return;
    // 多人模式默认关闭：不启用 NPC 动态介入
    if (!store.npcEnabled) return;

    // 取最近对话文本用于关键词匹配（主角刚回复完，最近几条就是当前话题）
    const recentText = store.chatHistory.slice(-4).map((e) => e.content).join(" ");
    if (!recentText.trim()) return;

    // 第一层：程序规则筛选（0 成本）
    const candidates = screenNpcCandidates(recentText);
    if (!candidates.length) return;

    // 第二层：概率决定是否真的介入（最多 1 个，保持主角核心）
    const pick = decideIntervention(candidates, recentText, buildPublicRecent(4));
    if (!pick) return;

    npcBusy = true;
    try {
        await runNpcIntervention(pick);
    } catch (e) {
        console.warn("NPC 介入失败：", e);
    } finally {
        npcBusy = false;
    }
}

// 渲染并执行一次 NPC 介入
/**
 * 【4-A5】把一次成功的 NPC 介入记入世界档案。
 *
 * 缺陷原貌：`runNpcIntervention` 只写 DOM 与 `chatHistory`，**从不写 `storyEvents`**
 *   → NPC 介入不进世界档案、不进 `journalText()`，跨天后彻底消失
 *   （对照 `event-card.ts` 是有写的 —— 同层功能漏了一个）。
 *
 * 为什么标 `source: "core"`：这次介入是**代码确认发生过的**（NPC 真的入场/发言、
 *   `applyNpcResult` 真的改了 NPC 状态）。文本由代码模板 + NPC 资料拼成，
 *   其中 `dialogue` 是 AI 产出，但它作为**被引用的对话内容**出现，不是世界断言。
 *
 * 抽成具名函数是为了让它可被直接调用验证（`__debug.recordNpcEvent`），
 * 而不必在 e2e 里真的发一次需要 API Key 与多人模式的 NPC 请求。
 */
/** 【4-B3】当前语境文本：与 `maybeNpcIntervention` 取"最近几条对话"同一口径 */
/**
 * 【4-B1 / 4-B6】Core 对一条 Director Intent 的**裁决**（纯判定，不执行任何修改）。
 *
 * 为什么需要它：`executeDirectorDecision` 把"归一化"和"应用"混在一个函数里，
 * 于是"Core 到底会不会允许这件事"无法被单独验证。把裁决抽出来之后：
 *   · Intent 契约可以被逐个字段断言
 *   · "Director 不能绕过 Core"可以被断言（而不是只能读代码）
 *   · 未来若要把裁决与执行拆成两步，这一层已经就位
 *
 * 返回的不是"要不要做"，而是"**Core 是否允许它发生**"以及被拒的原因。
 */
function adjudicateIntentForTest(raw: unknown): {
    decision: DirectorDecision;
    allowed: boolean;
    reasons: string[];
} {
    const decision = normalizeDecision(raw);
    const reasons: string[] = [];

    // 数值类：必须能通过状态闸门（非法维度/类型/NaN/超上限 → 被闸门丢弃或夹取）
    if (decision.relationshipEffect) {
        const rel = decision.relationshipEffect;
        const g =
            rel.target === "main"
                ? gateDimensionDelta({ affection: rel.delta, trust: rel.delta * 0.6 })
                : rel.target === "user"
                  ? gateDimensionDelta({ affection: rel.delta * 0.5 })
                  : gateDimensionDelta({ relToMain: rel.delta });
        if (rel.target !== "npc" && Object.keys(g.clean).length === 0) {
            reasons.push("relationship-effect-rejected-by-gate");
        }
        if (rel.target === "npc") {
            if (!rel.npcId || !store.npcs[rel.npcId]) reasons.push("npc-not-found");
        }
    }

    // 记忆类：必须能通过记忆闸门
    if (decision.memoryUpdate === null && raw && (raw as any).memoryUpdate) {
        reasons.push("memory-update-rejected");
    }

    // 事件类：只有 story_event / world_event 会写入档案；npc_intervention 需通过世界安全守卫
    if (decision.eventType === "npc_intervention") {
        if (!store.npcEnabled) {
            reasons.push("multiplayer-disabled");
        } else if (decision.npcId === null) {
            // 【4-B6】核心判据：Director 提出的参与者在归一化后**消失了**
            // （不存在 / 已在场）→ 它拿不到合法参与者，这次介入必须被拒绝。
            // 这条判定**不依赖** `checkInterventionSafety` 是否被调用 ——
            // 因此"绕过守卫"这类注入无法蒙混过关。
            reasons.push("npc-not-participable");
        } else {
            const safety = checkInterventionSafety(decision.npcId, recentContextText(), { npcBusy });
            if (!safety.ok) reasons.push(`npc-safety:${safety.reason}`);
        }
    }

    return { decision, allowed: reasons.length === 0, reasons };
}

function recentContextText(): string {
    return store.chatHistory.slice(-4).map((e) => e.content).join(" ");
}

function recordNpcInterventionEvent(
    npc: { profile: { name: string }; location: string },
    mode: InterventionMode,
    dialogue: string,
): void {
    const npcEventText =
        `${npc.profile.name}${mode === "join" ? "走了过来" : "发来消息"}` +
        `（在${npc.location}）：${(dialogue || "").slice(0, 30)}`;
    store.storyEvents.push({
        day: currentDayIndex(),
        text: npcEventText,
        source: "core",
    });
    if (store.storyEvents.length > 100) store.storyEvents.shift();
}

// ============ 【Phase 4-C 决策 2】NPC 主动开口（最小、可控）============
//
// 目标：NPC 不再"只有玩家点击/发话后才存在"。但要严格区分
//   **NPC 自主生活 ≠ NPC 无限随机骚扰玩家**。
//
// 设计原则：**不新增任何 cooldown 与 probability 数值**，全部复用既有规则。
//
//   触发点：`startClock` 的每秒回调（既有；与 `tickNpcWorld` / `maybeRandomMoment` 同一节奏）
//     ↓
//   Core 前置门（全部是既有规则，逐条对应）
//     ① 不能打断玩家交互        → `busy || userIsTyping()`（与 setProactiveGate 同一判据）
//     ② 必须有聊天能力          → `hasApiKey() && !demoMode`（NPC 发言需要模型；与既有能力门控一致）
//     ③ 多人模式开关            → `store.npcEnabled`（与既有 NPC 介入同一开关）
//     ④ 新档保护期              → `store.turnCount >= 1`（至少完成过一轮，不打断开场）
//     ⑤ 深夜保护                → `currentSchedule().label !== "深夜"`（与既有规则一致）
//     ⑥ 冷却：她近期主动过      → `store.virtualMs - npc.lastActiveAt < 6h`（复用既有常量；
//                                   `lastActiveAt` 由 `decideIntervention` 在**任何**介入后写入）
//     ↓
//   候选筛选（`screenNpcCandidates`，既有：关键词/地点/关系/剧情线/私密话题/深夜 score=0）
//     ↓
//   概率门（`decideIntervention`，既有：min(0.55, 0.2 + score/100)）
//     ↓
//   世界安全守卫（`checkInterventionSafety`，Core）
//     ↓
//   真正介入（`runNpcIntervention`：NPC 发言 → Core 事实入档 → 主角可能回应）
//
// **没有新增任何触发常量**：⑥ 的 6 小时与概率门都是既有规则的原样复用。
// 与"玩家轮次后的介入"的唯一区别是**触发时机**：
//   后者在 `sendMessage` 之后（玩家刚说完话），本函数在时钟上（她可以自己找上来）。

/**
 * 她是否"已经能自己找上来"。
 *
 * 导出为具名函数是为了让 e2e 能**直接断言门的开合**，
 * 而不必等定时器或制造真实 API 调用。
 */
function npcProactiveReady(): { ready: boolean; reason?: string; reasons: string[] } {
    // ⚠️ 刻意**收集全部原因**而不是遇到第一个就返回。
    // 短路返回会让"能力门"遮蔽后面所有判定（演示模式下永远只看到 no-chat-capability），
    // 于是"深夜保护是否生效""新档保护是否生效"这类断言会**因为错误的原因通过或失败**。
    // 收集式判定让每个门都可被独立断言，也让日志能一次看清所有阻塞项。
    const reasons: string[] = [];
    if (npcBusy) reasons.push("npc-busy");
    if (busy) reasons.push("player-turn-in-progress");
    if (userIsTyping()) reasons.push("player-typing");
    if (demoMode || !hasApiKey()) reasons.push("no-chat-capability");
    if (!store.npcEnabled) reasons.push("multiplayer-disabled");
    // 新档保护期：至少完成过一轮有效交互（复用 `store.turnCount` 的既有语义）
    if (store.turnCount < 1) reasons.push("new-save-protection");
    if (currentSchedule().label === "深夜") reasons.push("late-night");
    return reasons.length === 0
        ? { ready: true, reasons }
        : { ready: false, reason: reasons[0], reasons };
}

/** 一次 NPC 主动开口尝试（幂等安全：所有门都在内部判定） */
async function maybeNpcProactiveInteraction(): Promise<void> {
    const gate = npcProactiveReady();
    if (!gate.ready) return;

    const recentText = store.chatHistory.slice(-4).map((e) => e.content).join(" ");
    if (!recentText.trim()) return; // 还没有任何对话上下文时，不主动找上来

    const candidates = screenNpcCandidates(recentText);
    if (!candidates.length) return;

    const pick = decideIntervention(
        candidates,
        recentText,
        store.chatHistory.slice(-6).map((e) => ({ role: e.role, content: e.content.slice(0, 40) })),
    );
    if (!pick) return;

    // Core 世界安全守卫（与 Director 路径同一个守卫）
    const safety = checkInterventionSafety(pick.npc.profile.id, recentText, { npcBusy });
    if (!safety.ok) {
        console.log(`[NPC 主动] 被 Core 守卫拒绝：${safety.reason}`);
        return;
    }

    npcBusy = true;
    try {
        await runNpcIntervention(pick);
    } catch (e) {
        console.warn("NPC 主动开口失败：", e);
    } finally {
        npcBusy = false;
    }
}

async function runNpcIntervention(pick: InterventionCandidate) {
    const npc = pick.npc;
    const mainName = CHARACTER_REF.name;

    // 标记入场
    npc.present = true;
    if (!store.presentNpcs.includes(npc.profile.id)) {
        store.presentNpcs.push(npc.profile.id);
    }
    saveState();

    // 场景事件渲染（加入场景）
    if (pick.mode === "scene" || pick.mode === "join") {
        const container = ui.el("chat-messages");
        const line = document.createElement("div");
        line.className = "story-line";
        line.textContent = pick.mode === "scene"
            ? `【${npc.profile.name}从旁边经过】`
            : `【${npc.profile.name}走了过来】`;
        container.appendChild(line);
        scrollMessagesToBottom();
    } else if (pick.mode === "message") {
        // 手机消息：小雨发来消息
        const container = ui.el("chat-messages");
        const line = document.createElement("div");
        line.className = "story-line";
        line.textContent = `📱 ${npc.profile.name}发来消息`;
        container.appendChild(line);
        scrollMessagesToBottom();
    }

    // 构造 NPC 上下文（信息边界：只给她知道的事 + 公开对话）
    const situation = `现在是${store.virtualMs ? new Date(store.virtualMs).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}，${npc.profile.name}正在${npc.activity}（在${npc.location}）。`;
    const context = npcContext(npc, {
        mainName,
        userName: "你",
        presentNpcs: store.presentNpcs,
        publicRecent: buildPublicRecent(4),
        situation,
    });

    // NPC 发言（1 次 API）
    const result = await npcSpeak(npc, context);

    // 渲染 NPC 消息
    const msgEl = appendMessage("ai");
    msgEl.classList.add("npc-msg");
    msgEl.dataset.npc = npc.profile.id;
    // NPC 头像（覆盖默认角色头像）
    const avEl = msgEl.querySelector(".msg-avatar");
    if (avEl) avEl.textContent = npc.profile.avatar;

    const nameTag = document.createElement("div");
    nameTag.className = "npc-name";
    nameTag.textContent = `${npc.profile.avatar} ${npc.profile.name}`;
    msgEl.appendChild(nameTag);

    const dialogue = document.createElement("div");
    dialogue.className = "dialogue";
    dialogue.textContent = result.dialogue;
    msgEl.appendChild(dialogue);

    if (result.action) {
        const action = document.createElement("span");
        action.className = "action";
        action.textContent = `（${result.action}）`;
        msgEl.appendChild(action);
    }

    // 处理结果：情绪/记忆/关系/离场
    // 先写入对话历史（主角必须知道 NPC 说过什么，否则下轮"失忆"）
    store.chatHistory.push({
        role: "user",
        content: `（${npc.profile.name}对你说）`,
        ts: store.virtualMs,
    });
    store.chatHistory.push({
        role: "assistant",
        content: `【${npc.profile.name}在场】${npc.profile.name}：${result.dialogue}`,
        ts: store.virtualMs,
    });
    if (store.chatHistory.length > 200) store.chatHistory = store.chatHistory.slice(-200);

    applyNpcResult(npc, result);
    updateStateUI();

    // 【4-A5】NPC 介入 → Core 世界事件。
    //
    // 缺陷原貌：`runNpcIntervention` 只写 DOM 与 `chatHistory`，**从不写 `storyEvents`**
    //   → NPC 介入不进世界档案、不进 `journalText()`，下一轮 AI 只能从最近几行聊天记录里读到，
    //     跨天后就彻底消失（对照 `event-card.ts` 是写 `storyEvents` 的 —— 同层功能漏了一个）。
    //
    // 为什么标 `source: "core"`：这次介入是**代码确认发生过的**（NPC 真的入场/发言、
    //   `applyNpcResult` 真的改了 NPC 状态）。文本由代码模板 + NPC 资料拼成，
    //   其中只有 `result.dialogue` 是 AI 产出，且它是**引用的对话内容**而非世界断言。
    //   因此这条事件属于既成事实，可以进入剧情档案并回注 prompt。
    recordNpcInterventionEvent(npc, pick.mode, result.dialogue);
    updateStoryUI();
    refreshWorldSurface(); // 【Phase 5】新的 Core Fact 出现 → 世界表面需要跟上
    saveState();

    // 主角自然回应 NPC（她不是木头人——别人跟她说话，她会接）
    // 消息模式：几乎必回；现场模式：有一定概率接话，也可能只是点点头
    const replyChance = pick.mode === "message" ? 0.9 : 0.6;
    if (Math.random() < replyChance) {
        await mainReplyToNpc(npc, result.dialogue);
    }

    // 她说完离开了（恢复二人对话）——渲染离场提示
    if (!npc.present && !store.presentNpcs.includes(npc.profile.id)) {
        const container = ui.el("chat-messages");
        const line = document.createElement("div");
        line.className = "story-line";
        line.textContent = `${npc.profile.avatar} ${npc.profile.name}走了${pick.mode === "message" ? "，你放下手机" : ""}。`;
        container.appendChild(line);
        scrollMessagesToBottom();
    }
}

// 主角回应 NPC：调用主角 AI（非 proactive 通道，但禁止再触发 NPC/Director 递归）
async function mainReplyToNpc(npc: { profile: { name: string; id: string } }, npcDialogue: string) {
    if (busy || demoMode) return;
    if (!hasApiKey()) return;

    setBusyState(true);
    try {
        const result = await chatWithDeepSeek(
            `（${npc.profile.name}刚对你说：${npcDialogue.slice(0, 40)}。` +
            `自然地回应她——态度取决于你们的关系和你的心情；回应完如果有想对用户说的话也可以带上一句，但不要长篇大论，也别冷落用户。）`,
        );
        if (!result?.dialogue) return;

        applyDelta(gateDimensionDelta(result.delta).clean);
        updateStateUI();

        // 写入历史：NPC 说了话 → 主角回应（user 侧用说明性占位）
        store.chatHistory.push({ role: "user", content: `（${npc.profile.name}和她说了话）`, ts: store.virtualMs });
        store.chatHistory.push({ role: "assistant", content: result.dialogue, ts: store.virtualMs });
        if (store.chatHistory.length > 200) store.chatHistory = store.chatHistory.slice(-200);

        // 记忆
        if (result.memory?.trim()) {
            const m = result.memory.trim().slice(0, 60);
            if (!store.memories.includes(m)) {
                store.memories.push(m);
                if (store.memories.length > 30) store.memories = store.memories.slice(-30);
            }
        }

        saveState();

        // 渲染主角回复（标记为回应 NPC）
        const msgEl = appendMessage("ai");
        msgEl.classList.add("proactive");
        // 主角回应 NPC：回滚到该轮检查点（NPC 介入轮）
        addReanswerBtn(msgEl, turnCheckpoints.length - 1);
        typeReply(msgEl, result, aiState);
        attachTimeStamp(msgEl, store.virtualMs);
    } catch (e) {
        console.warn("主角回应 NPC 失败：", e);
    } finally {
        setBusyState(false);
    }
}

// ============ 聊天历史面板 ============

// ============ 事件绑定 ============

ui.el("chat-send").addEventListener("click", handleSend);
ui.el("chat-input").addEventListener("keydown", (e) => {
    markUserInput();
    if (e.key === "Enter") handleSend();
});
ui.el("chat-input").addEventListener("input", markUserInput);
ui.el("chat-input").addEventListener("focus", markUserInput);

// 菜单链接：强制刷新菜单页，确保读到最新存档
ui.el("menu-link").addEventListener("click", (e) => {
    e.preventDefault();
    saveState(); // 确保当前状态已保存
    // 用 replace 强制加载，不走缓存
    window.location.replace(`./menu.html?_=${Date.now()}`);
});

// 状态面板开关
ui.el("panel-toggle").addEventListener("click", () => {
    const panel = ui.el("state-panel");
    const wrap = ui.el("chat-wrap");
    const btn = ui.el("panel-toggle");
    const mask = ui.el("panel-mask");

    const closing = !panel.classList.contains("hidden");
    panel.classList.toggle("hidden");
    wrap.classList.toggle("panel-open");
    btn.classList.toggle("panel-open");
    mask.classList.toggle("show", !closing);
});

// 移动端遮罩点击关闭面板
ui.el("panel-mask").addEventListener("click", () => {
    ui.el("state-panel").classList.add("hidden");
    ui.el("chat-wrap").classList.remove("panel-open");
    ui.el("panel-toggle").classList.remove("panel-open");
    ui.el("panel-mask").classList.remove("show");
});

// 全部情感：打开全屏浮层
ui.el("emotions-toggle").addEventListener("click", () => {
    const modal = ui.el("emotions-modal");
    modal.classList.remove("hidden");
    drawChart();
});
ui.el("emotions-close").addEventListener("click", () => {
    ui.el("emotions-modal").classList.add("hidden");
});
ui.el("emotions-modal").addEventListener("click", (e) => {
    if (e.target === e.currentTarget) {
        ui.el("emotions-modal").classList.add("hidden");
    }
});

const demoBtn = ui.el<HTMLButtonElement>("demo-btn");
function refreshDemoBtn() {
    demoBtn.innerHTML = demoMode
        ? `<svg class="ico" viewBox="0 0 24 24"><use href="#i-sparkles"/></svg><span>演示中</span>`
        : `<svg class="ico" viewBox="0 0 24 24"><use href="#i-sparkles"/></svg><span>演示</span>`;
    demoBtn.classList.toggle("active", demoMode);
}
demoBtn.addEventListener("click", () => {
    demoMode = !demoMode;
    refreshDemoBtn();
    if (demoMode) {
        const sysEl = appendMessage("ai");
        sysEl.classList.add("sys");
        sysEl.textContent = "当前是演示模式——回复是预设模板，不会思考、不接上下文。想体验真正的她，请到菜单页设置 DeepSeek API Key 后关闭演示。";
    } else {
        setBusyState(false); // 刷新标题状态
    }
});

// 多人模式开关（默认关闭）：控制支线 NPC 动态介入
const npcToggleBtn = ui.el<HTMLButtonElement>("npc-toggle");
function refreshNpcToggle() {
    npcToggleBtn.innerHTML = store.npcEnabled
        ? `<svg class="ico" viewBox="0 0 24 24"><use href="#i-users"/></svg><span>多人:开</span>`
        : `<svg class="ico" viewBox="0 0 24 24"><use href="#i-users"/></svg><span>多人:关</span>`;
    npcToggleBtn.classList.toggle("active", store.npcEnabled);
}
npcToggleBtn.addEventListener("click", () => {
    store.npcEnabled = !store.npcEnabled;
    // 关闭时清场：NPC 全部离开，恢复二人世界
    if (!store.npcEnabled) {
        store.presentNpcs = [];
        for (const npc of Object.values(store.npcs)) npc.present = false;
        dismissAllEventCards(); // 非多人模式：撤下进行中的随机事件卡
    }
    saveState();
    refreshNpcToggle();
    const npcSys = appendMessage("ai"); npcSys.classList.add("sys"); npcSys.textContent = store.npcEnabled
        ? "已开启多人模式：支线 NPC 可能会在合适的时机自然地出现（小雨、小美…）。"
        : "已关闭多人模式：现在是你们两个人的世界，支线角色不会出现。";
});
refreshNpcToggle();

// TTS 语音朗读开关
const ttsToggleBtn = ui.el<HTMLButtonElement>("tts-toggle");
function refreshTtsToggle() {
    ttsToggleBtn.innerHTML = isTtsEnabled()
        ? `<svg class="ico" viewBox="0 0 24 24"><use href="#i-volume-2"/></svg>`
        : `<svg class="ico" viewBox="0 0 24 24"><use href="#i-volume-x"/></svg>`;
    ttsToggleBtn.classList.toggle("active", isTtsEnabled());
}
ttsToggleBtn.addEventListener("click", () => {
    setTtsEnabled(!isTtsEnabled());
    refreshTtsToggle();
    const ttsSys = appendMessage("ai"); ttsSys.classList.add("sys"); ttsSys.textContent = isTtsEnabled()
        ? "已开启语音朗读：AI 回复会自动朗读。需要在菜单页上传音色样本。"
        : "已关闭语音朗读。";
});
refreshTtsToggle();

// 初始化 TTS
initTts();
// 【P0-2】音色迁移到 IndexedDB（fail-safe、幂等；失败时旧数据保留，功能不受影响）。
// 冷启动时若直接从 chat 页进入（没经过菜单页），这次调用保证音色也能被迁移。
void migrateVoice(currentSlot);

// 时间流逝 → Agent Mind 情绪自然衰减（时段切换/跨天/加载时均会触发）
function applyMindTimeDecay() {
    const lastAt = store.lastAgentVirtualAt || 0;
    if (!lastAt) return;
    const elapsed = store.virtualMs - lastAt;
    if (elapsed > 60000) {
        applyTimeDecay(elapsed);
        const debugBox = ui.optEl("agent-debug");
        if (debugBox) renderAgentDebug(debugBox);
    }
}

// Agent 决策调试按钮：打开状态面板并展开"决策状态（调试）"区
const agentBtn = ui.el<HTMLButtonElement>("agent-toggle");
agentBtn?.addEventListener("click", () => {
    const panel = ui.el("state-panel");
    const wrap = ui.el("chat-wrap");
    panel.classList.remove("hidden");
    wrap.classList.add("panel-open");
    const toggle = ui.qs('.panel-section-toggle[data-section="agent"]');
    const section = ui.el("section-agent");
    if (toggle && section) {
        toggle.classList.remove("collapsed");
        section.classList.remove("collapsed");
    }
    const debugBox = ui.optEl("agent-debug");
    if (debugBox) renderAgentDebug(debugBox);
    ui.optEl("chat-input")?.focus();
});

ui.el("reset-state").addEventListener("click", () => {
    if (confirm("重置这段故事？会清空：情感、剧情、聊天记录、时间线，且无法恢复。")) {
        resetState();

        store.turnCount = 0;
        lastCountedTurn = 0; // 【决策 4】重置后允许重新从 0 开始计数
        store.storyProgress = 0;
        store.storyEvents = [];
        store.chatHistory = [];
        store.journal = [];
        store.activeThread = null;
        store.memories = [];
        store.lastReplyRealAt = Date.now();
        store.lastReplyVirtualAt = store.virtualMs;
        store.lastNeglectAt = 0;
        store.lastNeglectRealAt = 0;
        store.lastNeglectLevel = 0;

        // 重置 NPC 世界（回到初始状态）
        initNpcWorld();
        tickNpcWorld();

        store.virtualMs = store.dayBaseMs + slotMinutes(FIRST_MEETING_HHMM) * 60000;
        store.scheduleIndex = scheduleIndexFor(store.virtualMs);
        store.dayIndex = currentDayIndex();

        localStorage.removeItem(SAVE_KEY);
        clearLoadOutcome(); // 【P0-12】用户显式确认重置 → 解除只读守卫，允许重新写入
        resetEventTracker(); // 重置随机事件防重复窗口
        resetAgentMind();    // Agent Mind（用户/AI/关系状态）一并归零
        resetEventCardTracker(); // 随机事件卡触发状态归零
        setReplySuggestions(null);
        renderActionSuggestBar();

        resetChartHistory();
        invalidateWorldSurface(); // 【Phase 5】重置后世界表面必须重建
        ui.el("chat-messages").innerHTML = "";
        ui.el("mood-history").innerHTML = "<b>情绪日志</b><br>";

        updateStateUI();
        updateStoryUI();
        updateScheduleUI();
        saveState(); // 重置后立即保存（含新的 NPC 世界）
        appendSystemMessage("已重置。一切从零开始——新的开始。");
    }
});

// 速率/时间控件
function bindTimeControls() {
    ui.el("clock-more").addEventListener("click", () => {
        const detail = ui.el("clock-detail");
        const btn = ui.el("clock-more");
        const isHidden = detail.style.display === "none";
        detail.style.display = isHidden ? "" : "none";
        btn.textContent = isHidden ? "🔼 收起时间设置" : "⏱ 调整时间 / 倍率";
    });

    for (const btn of ui.qsa(".rate-btn")) {
        btn.addEventListener("click", () => setTimeRate(parseFloat(btn.dataset.rate!)));
    }

    ui.el("rate-set").addEventListener("click", () => {
        const v = parseFloat(ui.el<HTMLInputElement>("rate-custom").value);
        if (Number.isFinite(v)) setTimeRate(v);
    });

    ui.el("time-set").addEventListener("click", () => {
        const day = parseInt(ui.el<HTMLInputElement>("day-input").value, 10);
        const hhmm = ui.el<HTMLInputElement>("time-input").value;
        setVirtualTime(day, hhmm || "07:30");
    });

    ui.el("today-btn").addEventListener("click", jumpToToday);

    ui.el("date-set").addEventListener("click", () => {
        const iso = ui.el<HTMLInputElement>("date-input").value;
        if (iso) setStartDate(iso);
    });
}

// 历史面板
ui.el("history-btn").addEventListener("click", () =>
    openHistory(store.chatHistory, store.dayBaseMs, CHARACTER_REF.name),
);
ui.el("history-close").addEventListener("click", hideHistoryModal);
ui.el("history-clear").addEventListener("click", () => {
    if (confirm("清空所有聊天记录？（情感状态保留）")) {
        store.chatHistory = [];
        saveState();
        showHistoryCleared();
    }
});

// 角色弹层
ui.el("char-btn").addEventListener("click", () => {
    // 动态填充预设下拉（含所有预设 + 自定义）
    const presetSel = ui.el<HTMLSelectElement>("char-preset");
    if (presetSel) {
        // 每次重建，保证选项最新
        presetSel.innerHTML = "";
        const customOpt = document.createElement("option");
        customOpt.value = "";
        
        customOpt.textContent = "🎨 自定义（非预设）";
        presetSel.appendChild(customOpt);
        for (const [key, p] of Object.entries(PRESETS)) {
            const o = document.createElement("option");
            o.value = key;
            
            o.textContent = `${p.name}${p.scene ? ` · ${p.scene.name}` : ""}`;
            presetSel.appendChild(o);
        }
        // 按当前角色匹配预设（名字+背景一致才算匹配）
        presetSel.value = matchCurrentPreset();
    }
    fillCharForm();
    showCharModal();
});

ui.el("char-cancel").addEventListener("click", hideCharModal);

ui.el("char-save").addEventListener("click", () => {
    readCharForm();
    saveCharacter();
    // 关系变了 → 重新初始化情感数值（改成"恋人"就该有恋人的好感，不再是陌生人）
    initStateForRelation(CHARACTER_REF.relation ?? "");
    updateStateUI();
    hideCharModal();
    appendSystemMessage(`角色设定已更新。我是${CHARACTER_REF.name}，接下来也请多指教。`);
});

ui.el("char-reset-preset").addEventListener("click", () => {
    const preset = ui.el<HTMLSelectElement>("char-preset").value;
    if (PRESETS[preset]) {
        const { scene: _scene, ...profile } = PRESETS[preset]!;
        Object.assign(CHARACTER_REF, profile);
        fillCharForm();
    }
});

// ============ 胶水：跨模块回调注册 ============

// 【P0-3】存档失败必须让用户看见。
// 缺陷原貌：storage/character 的写入失败被静默吞掉。最现实的触发是 localStorage 配额
// 被 TTS 音色（base64，1MB 音频即占约 53% 的 5MB 配额）占满，此后所有存档写入都会失败，
// 而用户毫无感知 —— 一直玩到刷新才发现进度全丢。
// 这里把失败转成一条系统提示（同一条消息只提示一次，避免每次 saveState 都刷屏）。
let saveFailureNotified = false;
setSaveFailureHandler((failure) => {
    console.error("[存档失败]", failure);
    if (saveFailureNotified) return;
    saveFailureNotified = true;
    appendSystemMessage(
        failure.kind === "blocked-read-only"
            ? `⚠️ 进度未保存：${failure.blockedReason ?? "当前存档不可写"}。`
            : failure.quotaExceeded
              ? "⚠️ 本地存储已满，进度无法保存。请在菜单页清理或缩小 TTS 音色文件后刷新页面。"
              : "⚠️ 进度无法保存到本地存储（可能处于隐私模式或存储被禁用）。",
    );
});

setCharacterGetter(() => CHARACTER_REF);
setRelationGetter(() => CHARACTER_REF.relation ?? ""); // 关系阶段判断（是否"第一次见面"）
setStoryCharNameGetter(() => CHARACTER_REF.name);
// 【Phase 5-A4】Story Log 的数据来源：完整叙事记录（core / narrative / director 都保留）
setStoryLogEventsProvider(() => buildWorldViewModel().allEvents); // 角色卡名字
// 主动开口频率：统一使用“情绪 + 剧情”动态系数（story.ts 计算，time.ts 的时段切换共用）
setProactiveDriveGetter(() => proactiveDrive());
// 日程规划：注入角色信息（让 AI 规划贴合她的日程）
setAgendaCharacterGetter(() => ({
    name: CHARACTER_REF.name,
    personality: CHARACTER_REF.personality,
    background: CHARACTER_REF.background,
    relation: CHARACTER_REF.relation,
}));

setTimeMessageSender((text, opts) => {
    if (busy || userIsTyping()) return; // AI 回复中或用户正在输入，不打扰
    void sendMessage(text, opts);
});

// 主动开口门控：AI 回复中 / 用户输入中不允许随机事件开口（不打断主流程）
setProactiveGate(() => !busy && !userIsTyping());

// 【P0-8】聊天能力门控：没有 API Key（或处于演示模式）时不主动开口。
// chat.ts 是唯一知道「当前槽位 + API Key 状态」的模块，因此由它注入给 time.ts，
// 覆盖 time.ts 时段切换与 story.ts 随机时刻两条主动开口路径。
// 原先 time.ts 自行读孤儿键 "deepseek-key"（无人写入）→ 时段切换的主动开口永不触发；
// 而 story.ts 那条路径完全没有能力判断，无 Key 时也会尝试开口。
setChatCapabilityGetter(() => hasApiKey() && !demoMode);

setSlotChangeHandler(() => {
    updateScheduleUI();
    onSlotChanged();
    applyMindTimeDecay(); // 时段切换 → 情绪自然衰减
});

setDayChangeHandler((oldDay, newDay) => {
    finalizeDay(oldDay);
    // 【P0-10】newDay 改为显式参数：原先读 store.dayIndex 推断，在 tickClock 路径上
    // 拿到的是尚未更新的旧值（两处触发点赋值顺序曾相反），导致 Director 收到
    // 「第X天 → 第X天」。现在由 time.ts 显式传入，与赋值顺序解耦。
    directorOnDayChange(oldDay, newDay);
    // 跨天 → AI 规划新一天的日程（无 key 时用作息表兜底）
    void planTodayAgenda(async (text) => {
        if (demoMode || !hasApiKey()) return {};
        try {
            return await chatWithDeepSeek(text);
        } catch {
            return {};
        }
    });
});

setRandomMomentHook(() => {
    tickNpcWorld(); // NPC 自己的时间也在走
    tickAgenda(); // 日程状态随虚拟时间推进
    renderAgendaUI();
    // 【Phase 5-A2】世界表面刷新。
    // 每秒都会被调用，但内部**指纹短路**：虚拟时间没跨分钟、NPC 状态没变、
    // 也没有新增 Core Fact 时直接返回，不构建 VM、不写 DOM。
    refreshWorldSurface();
    // 【决策 2】NPC 主动开口尝试（复用既有的每秒节奏；内部所有门都在 Core 侧判定）
    void maybeNpcProactiveInteraction();
    maybeRandomMoment();
});

setWizardSavedCallback(() => {
    // 问候语按关系变化：恋人不该像陌生人一样客套
    const rel = CHARACTER_REF.relation ?? "";
    const greeting = /恋人|女朋友|男朋友|对象|老婆|老公|最爱|热恋|相恋/.test(rel)
        ? `（看见你，她眼睛亮了一下）回来了？真是的，怎么感觉好久没见到你了。`
        : /最亲近|最重要|青梅竹马|挚友|最好的朋友|家人/.test(rel)
            ? `你来啦。见到你，心里踏实多了。`
            : `你好呀，我是${CHARACTER_REF.name}。设定已就位，接下来请多指教。`;
    const greetEl = appendMessage("ai");
    const greetText = document.createElement("div");
    greetText.className = "dialogue";
    greetText.textContent = greeting;
    greetEl.appendChild(greetText); // 保留消息头像，不用 textContent 覆盖
    // 刷新头像 + 角色卡 + 标题（角色已创建）
    const avNew = charAvatar();
    for (const el of ui.qsa(".chat-avatar, .char-card-avatar")) {
        el.textContent = avNew;
    }
    updateStoryUI();
    setBusyState(false);
    // 重置"被冷落"基准：她刚和你在一起（防止创建过程耗时被误判为冷落）
    store.lastReplyRealAt = Date.now();
    store.lastReplyVirtualAt = store.virtualMs;
    // 【P0-11】这里原本要清除 "melai-did-new" 标记。该标记已在 storage.ts 中移除
    // （它保护的重复清空不会发生，却会在「取消向导」后永久残留并导致旧档被当成新档），
    // 因此不再需要清除动作。
    saveState();
    // 向导完成：静默期结束，允许她主动开口；并把焦点还给输入框
    setProactiveEnabled(true);
    // 角色创建完成：清掉初始化时（空角色）生成的泛化日程，重新规划贴合她的日程
    const today = currentDayIndex();
    store.agenda = store.agenda.filter((d) => d.day !== today);
    saveState();
    void planTodayAgenda(async (text) => {
        if (demoMode || !hasApiKey()) return {};
        try {
            return await chatWithDeepSeek(text);
        } catch {
            return {};
        }
    });
    setTimeout(() => {
        const input = ui.el<HTMLInputElement>("chat-input");
        input?.focus();
    }, 300);
});

// ============ 初始化 ============

// 无 API Key：自动进入演示模式并明确提示（避免用户误以为是真实 AI）
if (!hasApiKey()) {
    demoMode = true;
    refreshDemoBtn();
    demoBtn.classList.add("active");
}

// 角色（读取存档中的角色；无存档时保持默认，等向导完成才落盘）
Object.assign(CHARACTER_REF, loadCharacter());

buildMeters();

// 【P0-12】loadState 现在返回可诊断结果。三种"不可写回"状态（损坏 / 未知高版本 / 读取失败）
// 必须与"新游戏"严格区分 —— 否则后续 saveState 会把用户那份损坏但可能可修复的数据永久覆盖。
const loadOutcome = loadState();
const hadSave = loadOutcome.status === "loaded";
const readOnly = loadOutcome.status === "corrupt" || loadOutcome.status === "future" || loadOutcome.status === "read-error";
const hasChar = !!localStorage.getItem(CHAR_KEY);
updateStateUI();
updateStoryUI();
updateScheduleUI(); // 确保场景描述卡片立即加载正确场景
refreshNpcToggle(); // 按存档的多人开关刷新按钮（loadState 后）

// 初始化头像（头部 + 面板角色卡）
const av0 = charAvatar();
for (const el of ui.qsa(".chat-avatar, .char-card-avatar")) {
    el.textContent = av0;
}

// 没有存档（新游戏）：时间停在"开工"时段起点，初始化 NPC 世界
// （刚认识 → 第一次相遇的情境由 currentSchedule 按关系判断，恋人/朋友则从普通的一天开始）
if (!hadSave && !readOnly) {
    store.virtualMs = store.dayBaseMs + slotMinutes(FIRST_MEETING_HHMM) * 60000;
    store.scheduleIndex = scheduleIndexFor(store.virtualMs);
    store.dayIndex = currentDayIndex();
    // 重置"被冷落"基准：她刚和你在一起（虚拟时间=上次回复时间，避免时间错位误判）
    store.lastReplyRealAt = Date.now();
    store.lastReplyVirtualAt = store.virtualMs;
    updateScheduleUI();
    initNpcWorld();
}

// NPC 世界随虚拟时间推进（她们有自己的生活，0 成本）
tickNpcWorld();
saveState(); // 更新 NPC 作息后落盘

// 日程：有角色且今天还没有安排 → 首次进入时规划当天日程（AI 或作息兜底），并渲染左侧时间线
tickAgenda();
if (hasChar && todayHasNoAgenda()) {
    void planTodayAgenda(async (text) => {
        // 检查当前槽位的 API Key（per-slot）
        const slot = currentSlot;
        const key = localStorage.getItem(slotKey(KEY_PREFIX.apikey, slot));
        if (demoMode || !key) return {};
        try {
            return await chatWithDeepSeek(text);
        } catch {
            return {};
        }
    });
}
renderAgendaUI();

// 已有角色：不显示欢迎语，直接进入对话
// 没有角色（新建档）：等角色向导完成后，由 savedCallback 打招呼

if (hadSave) {
    renderHistoryToChat(store.chatHistory, charAvatar);
}

// 【P0-12】只读状态提示：明确告知用户"当前进度不会被保存"，并给出可执行的出口。
if (readOnly) {
    const detail =
        loadOutcome.status === "future"
            ? `这份存档来自更新的版本（version ${loadOutcome.version}），当前版本无法读取，也不会覆盖它。`
            : `这份存档无法读取：${loadOutcome.reason}`;
    appendSystemMessage(
        `⚠️ ${detail}\n为避免破坏数据，本次游玩不会写入存档。你可以到菜单页「导出存档」保留原始数据，或确认后使用「重置」重新开始。`,
    );
}

// 时间开始流动
store.scheduleIndex = scheduleIndexFor(store.virtualMs);
store.dayIndex = currentDayIndex();
updateScheduleUI();
startClock();
bindTimeControls();

// 离线回归：距离上次回复超过 30 分钟，世界可能在她离开时发生了点变化
if (hadSave) {
    const idleMin = (Date.now() - store.lastReplyRealAt) / 60000;
    if (idleMin >= 30) {
        setTimeout(() => directorOnOfflineReturn(Math.round(idleMin)), 3000);
    }
}

// ===== 可折叠分组交互 =====
ui.qsa(".panel-section-toggle").forEach((btn) => {
    const section = btn.dataset.section;
    const content = ui.el(`section-${section}`);
    if (!content) return;

    // 从 localStorage 恢复折叠状态
    const saved = localStorage.getItem(`panel.section.${section}`);
    if (saved === "collapsed") {
        btn.classList.add("collapsed");
        content.classList.add("collapsed");
    }

    btn.addEventListener("click", () => {
        const isCollapsed = btn.classList.toggle("collapsed");
        content.classList.toggle("collapsed", isCollapsed);
        localStorage.setItem(`panel.section.${section}`, isCollapsed ? "collapsed" : "expanded");
    });
});

// ===== Agent Mind 调试面板初始化 =====
installMindDebugHooks();
// 预判动作/表情快捷条（本地规则兜底，每轮回复后刷新）
renderActionSuggestBar();
{
    const debugBox = ui.optEl("agent-debug");
    if (debugBox) renderAgentDebug(debugBox);
    // 调试区默认收起（正式界面隐藏；点顶部"决策"按钮可展开查看）
    const saved = localStorage.getItem("panel.section.agent");
    if (!saved) {
        const toggle = ui.qs('.panel-section-toggle[data-section="agent"]');
        const section = ui.el("section-agent");
        toggle?.classList.add("collapsed");
        section?.classList.add("collapsed");
        localStorage.setItem("panel.section.agent", "collapsed");
    }
}

// 离线回归：用户情绪按虚拟时间自然衰减（"长时间没有新刺激"）
applyMindTimeDecay();

// 调试钩子
// 【Phase 5-A2】世界表面首次渲染（此时 loadState / 时间对齐 / 角色都已就绪）
refreshWorldSurface(true);

(window as any).__debug = {
    next: () => {
        const oldDay = store.dayIndex;
        store.scheduleIndex = (store.scheduleIndex + 1) % 16;
        store.virtualMs = store.dayBaseMs + (currentDayIndex() - 1) * 86400000 + slotMinutes(currentSchedule().time) * 60000;
        store.dayIndex = currentDayIndex();
        if (oldDay !== store.dayIndex) finalizeDay(oldDay);
        updateScheduleUI();
        onSlotChanged();
        applyMindTimeDecay();
    },
    setTime: (day: number, hhmm: string) => setVirtualTime(day, hhmm),
    setRate: (r: number) => setTimeRate(r),
    setStartDate: (iso: string) => setStartDate(iso),
    jumpToday: () => jumpToToday(),
    speak: () => void sendMessage("（现在你手头正在做的事：" + currentSchedule().activity + "。基于这件事主动和对方说一句话。）", { proactive: true }),
    state: () => aiState,
    time: () => ({ ...currentSchedule(), rate: store.timeRate, day: currentDayIndex() }),
    prompt: () => SYSTEM_PROMPT(CHARACTER_REF),
    // Agent Mind 调试：查看/测试情感判断与策略决策
    mind: () => debugSnapshot(),
    mindDecay: (virtualMinutes: number) => {
        applyTimeDecay(virtualMinutes * 60000);
        const debugBox = ui.optEl("agent-debug");
        if (debugBox) renderAgentDebug(debugBox);
        return debugSnapshot().user;
    },
    mindSetImperfect: (rate: number) => setImperfectionRate(rate),
    mindConsole: (on: boolean) => setAgentConsoleLog(on), // Agent Mind 决策链 → 控制台 开关
    // 随机事件卡：eventDemo=样例卡预览（不调模型）；eventReal=真实生成（需多人模式+Key）
    eventDemo: () => previewEventCard(),
    eventReal: () => void forceShowEventCard(CHARACTER_REF.name),
    // 【P0-4】视图上限验证入口：直接驱动真实的渲染函数（e2e 用）。
    // 与 __mind 一样属于既有调试出口，便于在真实 DOM 上验证视图是有界的。
    viewCaps: () => ({ messages: MAX_RENDERED_MESSAGES, moodEntries: MAX_MOOD_ENTRIES, checkpoints: MAX_TURN_CHECKPOINTS }),
    // 【4-A2 · G-1】回合计数与冷落门的测试出口（只读 + 一个可控时间戳写入）
    // setLastReplyRealAt 只改"最后一次回复的真实时刻"这一个持久化字段，
    // 用于在真实浏览器里确定性地构造"用户很久没回"的状态（不引入新的生产逻辑）。
    turnCount: () => store.turnCount,
    setLastReplyRealAt: (ms: number) => {
        store.lastReplyRealAt = ms;
    },
    neglect: () => {
        const n = neglectLevel();
        return { level: n.level, realIdleMin: n.realIdleMin, virtualIdleMin: n.virtualIdleMin };
    },
    isNewSaveProtection: () => isNewSaveProtectionActive(),
    mindState: () => debugSnapshot(),
    // 【4-A5 / 4-A7】世界档案的可观测出口（测试用：验证"什么能进档案、什么被隔离"）
    storyEvents: () =>
        store.storyEvents.map((e) => ({
            day: e.day,
            text: e.text,
            source: e.source ?? "narrative",
            priority: e.priority ?? "world",
        })),
    // 【D4】重答通路与进度的可观测出口（测试用）
    storyProgress: () => store.storyProgress,
    reAnswerLast: () => reAnswerAt(turnCheckpoints.length - 1),
    setStoryProgress: (v: number) => {
        store.storyProgress = v;
    },
    // 【D4】单个检查点的剧情进度快照（用于直接断言"回滚源"正确）
    checkpointStoryProgress: () => turnCheckpoints.map((c) => c.storyProgressSnap),
    // 【决策 4】检查点里的回合计数快照（用于直接断言"回滚源"正确）
    checkpointTurnCount: () => turnCheckpoints.map((c) => c.turnCountSnap),
    factualStoryEvents: () => store.storyEvents.filter(isFactualStoryEvent).map((e) => e.text),
    // 【4-B3】Core 世界安全守卫（测试用：可直接断言"哪类介入是合法的"）
    npcIds: () => Object.keys(store.npcs),
    setNpcEnabled: (v: boolean) => {
        store.npcEnabled = v;
    },
    // 【Phase 5-A】World Surface 的可观测出口（只读 + 统计）
    worldSurface: () => worldSurfaceStats(),
    worldViewModel: () => currentWorldViewModel(),
    worldSurfaceRefresh: (force?: boolean) => refreshWorldSurface(force ?? false),
    worldInvalidate: () => invalidateWorldSurface(),
    npcRowCount: () => npcRowCount(),
    eventRowCount: () => eventRowCount(),
    // 【Phase 5-A4】Story Log 的可观测出口
    storyLogRows: () =>
        Array.from(ui.optEl("story-events")?.querySelectorAll(".story-event") ?? []).map((el) => ({
            source: el.querySelector(".story-event-source")?.className ?? "",
            label: (el.querySelector(".story-event-source")?.textContent ?? "").trim(),
            day: (el.querySelector(".story-event-day")?.textContent ?? "").trim(),
            text: (el.querySelector(".story-event-text")?.textContent ?? "").trim(),
        })),
    storyLogEmpty: () => !!ui.optEl("story-events")?.querySelector(".story-event-empty"),
    storyLogReset: () => __resetStoryLogForTest(),
    /** 仅测试用：直接把一份事件列表喂给 Recent Events 表面（验证其结构性防线） */
    renderEventSurfaceForTest: (events: unknown) =>
        renderEventSurface(events as Parameters<typeof renderEventSurface>[0]),
    /**
     * 仅测试用：临时替换 Story Log 的数据源。
     * 传 `null` / `undefined` 恢复为**生产数据源**（而不是把 provider 弄坏）——
     * 这正是第一版实现踩过的坑：传 undefined 会让 provider 变成非函数并在下一次渲染时抛错。
     */
    setStoryLogEventsProviderForTest: (fn?: (() => never[]) | null) => {
        setStoryLogEventsProvider(
            fn
                ? (fn as () => { day: number; text: string; source: string; today: boolean }[])
                : () => buildWorldViewModel().allEvents,
        );
    },
    refreshStoryUI: () => updateStoryUI(),
    worldReset: () => {
        __resetWorldSurfaceForTest();
        __resetNpcSurfaceForTest();
        __resetEventSurfaceForTest();
    },
    worldText: () => {
        const npcs = ui.optEl("world-npcs");
        const evs = ui.optEl("world-events");
        return {
            npcText: (npcs?.textContent ?? "").trim(),
            eventText: (evs?.textContent ?? "").trim(),
            npcRows: npcs?.querySelectorAll(".npc-row").length ?? 0,
            eventRows: evs?.querySelectorAll(".world-event").length ?? 0,
        };
    },
    // 【Phase 4-D 决策 C-1】NPC goal 相关性的可观测出口（只读）
    goalRelevance: () => Object.fromEntries(lastGoalRelevance),
    screenCandidates: (text: string) =>
        screenNpcCandidates(text).map((c) => ({ id: c.npc.profile.id, score: c.score, mode: c.mode, reason: c.reason })),
    scenePlace: () => store.scene.place,
    setNpcLocation: (id: string, location: string) => {
        const npc = store.npcs[id];
        if (npc) npc.location = location;
    },
    // 直接设置某个 NPC 的 goal（只改内存态，不落盘；用于断言"无 goal"与"goal 不绕过 Core"）
    setNpcGoal: (id: string, goal: string | null) => {
        const npc = store.npcs[id];
        if (npc) npc.goal = goal;
    },
    // 【决策 2】NPC 主动开口的门（可直接断言开合，不必等定时器）
    npcProactiveReady: () => npcProactiveReady(),
    // 直接驱动一次主动开口尝试（返回是否真的发起了介入）
    tryNpcProactive: () => maybeNpcProactiveInteraction().then(() => true),
    setLastActiveAt: (id: string, ms: number) => {
        const npc = store.npcs[id];
        if (npc) npc.lastActiveAt = ms;
    },
    npcLastActiveAt: (id: string) => store.npcs[id]?.lastActiveAt ?? -1,
    // 【决策 2】当前时段标签（用于驱动 NPC 作息与深夜保护的诊断/断言）
    scheduleLabel: () => currentSchedule().label,
    setNpcPresent: (id: string, v: boolean) => {
        const npc = store.npcs[id];
        if (!npc) return;
        npc.present = v;
        store.presentNpcs = v
            ? Array.from(new Set([...store.presentNpcs, id]))
            : store.presentNpcs.filter((x) => x !== id);
    },
    setNpcLabel: (id: string, label: string, activity: string) => {
        const npc = store.npcs[id];
        if (!npc) return;
        npc.label = label;
        npc.activity = activity;
    },
    interventionSafety: (npcId: string | null, recentText: string) =>
        checkInterventionSafety(npcId, recentText),
    // 【4-B2】Director Intent 的归一化（测试用：验证 priority 被正确校验与保留）
    normalizeIntent: (raw: unknown) => normalizeDecision(raw),
    // 【4-B2】Core 对一条 Intent 的裁决结果（不执行任何世界修改，纯判定）
    adjudicateIntent: (raw: unknown) => adjudicateIntentForTest(raw),
    /**
     * 【4-B1 / 4-B6】把一条原始 Intent 走**完整的生产通路**：
     *   normalizeDecision → Core 裁决 → （允许时）executeDirectorDecision
     *
     * 为什么需要它：只测 `checkInterventionSafety` 本身，证明不了
     * "Director 通路真的调用了它"。这个出口让 e2e 能断言**端到端**行为
     * （"非法 Intent 不会产生世界事件"），而不是只断言守卫函数的返回值。
     * 它不改变任何生产逻辑 —— 只是把 `runDirector` 内部已经存在的两步暴露出来。
     */
    runDirectorIntent: async (raw: unknown) => {
        const verdict = adjudicateIntentForTest(raw);
        if (!verdict.allowed) {
            return { applied: false, reasons: verdict.reasons, decision: verdict.decision };
        }
        await executeDirectorDecision(verdict.decision);
        return { applied: true, reasons: [], decision: verdict.decision };
    },
    /** 【4-A5】直接驱动「NPC 介入 → 世界档案」这条通路（不依赖 API Key / 多人模式） */
    recordNpcEvent: (name: string, mode: "join" | "message", dialogue: string) =>
        recordNpcInterventionEvent({ profile: { name }, location: "测试地点" }, mode, dialogue),
    journalText: () => journalText(),
    // 【4-A3 / 4-A4】闸门自身（测试用：在真实页面里直接验证闸门行为）
    gate: (raw: unknown) => gateDimensionDelta(raw),
    // relMind 的**原始**存储（`debugSnapshot().rel` 是 relationshipView 的派生结果，
    // 不含 lastMajorTurn/lastMajorLabel —— 这两个字段只有原始存储里有）
    relMind: () => store.relMind,
    appendTestMessage: (role: "user" | "ai", text: string) => {
        const el = appendMessage(role);
        el.textContent = text;
        return el;
    },
    logTestEmotion: (text: string) => logEmotion("ai", text, "test"),
    checkpointCount: () => turnCheckpoints.length,
    // 【P0-5】打字机验证入口
    typeTestReply: (
        full: { dialogue: string; dialogue_ja?: string; action?: string; thoughts?: string },
    ) => {
        const el = appendMessage("ai");
        typeReply(el, full);
        return el;
    },
    lastAutoScrollBehavior: () => getLastAutoScrollBehavior(),
    // 手动驱动的打字机：用于确定性验证"多帧渐进渲染"
    typeTestReplyManual: (full: { dialogue: string; dialogue_ja?: string; action?: string; thoughts?: string }) => {
        const el = appendMessage("ai");
        const driver = typeReply(el, full, undefined, true);
        return { el, tick: driver && "tick" in driver ? driver.tick : null };
    },
};

// 事件卡预览模式（?eventdemo=1）：预置角色卡跳过向导，直接渲染样例事件卡。
//
// 【P0-13 加固】只允许在**显式指定**的独立槽位上预览。
// 缺陷原貌：注释写着"建议配合 ?slot=9 使用"，但代码没有任何强制 ——
// 用户直接打开 chat.html?eventdemo=1（无 slot）且该槽尚无角色卡时，
// 演示用角色卡会被**永久写入其真实槽位**，覆盖掉"尚未创建角色"这一状态。
// 预览模式属于调试功能，绝不能污染用户的真实数据。
const eventDemoMode = new URLSearchParams(location.search).get("eventdemo") === "1";
if (eventDemoMode) {
    // 预览槽位固定在末位（9），与用户常用槽位隔离
    const EVENT_DEMO_SLOT = 9;
    const demoSlotParam = new URLSearchParams(location.search).get("slot");
    if (String(EVENT_DEMO_SLOT) !== demoSlotParam) {
        appendSystemMessage(
            `⚠️ 事件卡预览模式需要显式指定独立槽位：请在地址后加上 &slot=${EVENT_DEMO_SLOT}。` +
                `\n（为避免污染你的真实存档，本模式下不会写入任何数据）`,
        );
    } else {
        const demoCharKey = slotKey(KEY_PREFIX.character, EVENT_DEMO_SLOT);
        if (!localStorage.getItem(demoCharKey)) {
            localStorage.setItem(
                demoCharKey,
                JSON.stringify({
                    name: "仁菜（Nina）", age: "17 岁", appearance: "浅棕色短发别着发卡，琥珀色大眼睛",
                    personality: "倔强不服输、认死理，急了会炸毛", background: "转学插班生，成了你的同桌",
                    speechStyle: "标准腔，直率干脆", likes: "图书馆自习、汽水、听歌",
                    dislikes: "被敷衍", relation: "同桌", secrets: "喜欢桃子汽水",
                }),
            );
        }
        setTimeout(() => previewEventCard(), 1000);
    }
}

// 首次进入（无角色设定）：打开角色创建向导
// 向导期间静默（她先不主动说话，等创建完成、聚焦输入框后再说）
if (!localStorage.getItem(CHAR_KEY)) {
    setProactiveEnabled(false);
    setTimeout(openWizard, 800);
}

// 移动端（小屏）：默认收起状态面板，聊天区全屏
if (window.innerWidth < 768) {
    ui.el("state-panel").classList.add("hidden");
    ui.el("chat-wrap").classList.remove("panel-open");
    ui.el("panel-toggle").classList.remove("panel-open");
}
