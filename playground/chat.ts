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
    USER_EMOTION_FIX,
    EMOTION_NAMES,
} from "./state";
import { store, saveState, loadState, SAVE_KEY, CHAR_KEY, initNpcWorld } from "./storage";
import { CHARACTER, PRESETS, loadCharacter, saveCharacter, type CharacterProfile } from "./character";
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
    inSchool,
    currentSchedule,
    markUserReplied,
    setSlotChangeHandler,
    setDayChangeHandler,
    setMessageSender as setTimeMessageSender,
    setRandomMomentHook,
} from "./time";
import {
    fallbackStory,
    updateStoryUI,
    finalizeDay,
    maybeRandomMoment,
    bumpTurnsSinceEvent,
    markUserInput,
    userIsTyping,
    neglectLevel,
    neglectLine,
    setStoryMessageSender,
} from "./story";
import { chatWithDeepSeek, demoReply, setCharacterGetter, SYSTEM_PROMPT, type ChatResult } from "./ai";
import { npcContext, npcSpeak } from "./ai";
import {
    detectTrigger,
    callDirector,
    emptyDecision,
    userInputMentionsNpc,
    type DirectorDecision,
    type DirectorTrigger,
} from "./director";
import { openWizard, setWizardSavedCallback } from "./wizard";
import {
    screenNpcCandidates,
    decideIntervention,
    buildPublicRecent,
    applyNpcResult,
    tickNpcWorld,
    type InterventionCandidate,
    type InterventionMode,
} from "./intervention";

// ============ 角色弹层数据流 ============

let CHARACTER_REF: CharacterProfile = CHARACTER;

setCharacterGetter(() => CHARACTER_REF);

// ============ UI：38 维状态条 ============

function buildMeters() {
    for (const group of ["personality", "relation", "emotion", "status", "shadow"]) {
        const box = document.getElementById(`group-${group}`)!;
        box.innerHTML = "";

        for (const dim of DIMENSIONS.filter((d) => d.group === group)) {
            const div = document.createElement("div");
            div.className = "meter";
            div.id = `meter-${dim.key}`;
            div.innerHTML = `
                <div class="label"><span class="name">${dim.label}</span><span class="val" id="val-${dim.key}">0</span></div>
                <div class="bar"><div class="fill" id="bar-${dim.key}" style="width:0%;background:${dim.color}"></div></div>`;
            box.appendChild(div);
        }
    }

    for (const title of document.querySelectorAll<HTMLElement>(".group-title")) {
        title.style.cursor = "pointer";
        title.addEventListener("click", () => {
            const group = title.dataset.group!;
            const box = document.getElementById(`group-${group}`)!;
            box.style.display = box.style.display === "none" ? "" : "none";
            title.textContent = box.style.display === "none" ? title.textContent.replace(/^▸ /, "▾ ") : title.textContent.replace(/^▾ /, "▸ ");
        });
    }
}

function updateStateUI() {
    for (const dim of DIMENSIONS) {
        const v = aiState[dim.key];
        (document.getElementById(`val-${dim.key}`)!).textContent = v.toFixed(0);
        (document.getElementById(`bar-${dim.key}`)!).style.width = `${v}%`;
    }
    (document.getElementById("mood-text")!).textContent = `💬 ${describeMood()}`;
    drawChart();
}

// 情绪历史曲线
const chartHistory: { affection: number; joy: number; anger: number }[] = [];

function drawChart() {
    chartHistory.push({ affection: aiState.affection, joy: aiState.joy, anger: aiState.anger });
    if (chartHistory.length > 40) chartHistory.shift();

    const canvas = document.getElementById("emotion-chart") as HTMLCanvasElement;
    const ctx = canvas.getContext("2d")!;
    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(0, (H / 4) * i);
        ctx.lineTo(W, (H / 4) * i);
        ctx.stroke();
    }

    const drawLine = (key: "affection" | "joy" | "anger", color: string) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();

        for (let i = 0; i < chartHistory.length; i++) {
            const x = (i / Math.max(1, chartHistory.length - 1)) * W;
            const y = H - (chartHistory[i]![key] / 100) * H;

            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    };

    drawLine("affection", "#ff6b9d");
    drawLine("joy", "#facc15");
    drawLine("anger", "#ef4444");

    ctx.font = "9px sans-serif";
    ctx.fillStyle = "#ff6b9d";
    ctx.fillText("—好感", 6, 10);
    ctx.fillStyle = "#facc15";
    ctx.fillText("—喜悦", 50, 10);
    ctx.fillStyle = "#ef4444";
    ctx.fillText("—愤怒", 92, 10);
}

// ============ 消息渲染 ============

function logEmotion(who: "user" | "ai", text: string, extra?: string) {
    const box = document.getElementById("mood-history")!;
    const div = document.createElement("div");
    div.className = "entry";
    div.innerHTML = `<span class="who ${who === "ai" ? "ai" : ""}">${who === "ai" ? "AI" : "你"}</span>` +
        `<span class="emo">${extra ?? ""}</span><span style="color:#6a6a85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px;">${text}</span>`;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
}

function appendMessage(role: "user" | "ai"): HTMLElement {
    const container = document.getElementById("chat-messages")!;
    const div = document.createElement("div");
    div.className = `msg ${role}`;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    return div;
}

// 给消息加虚拟时间戳（体现"这条消息是几点发的"）
function attachTimeStamp(el: HTMLElement, tsMs?: number) {
    const ts = document.createElement("span");
    ts.className = "msg-ts";
    const d = new Date(tsMs ?? store.virtualMs);
    const p = (n: number) => String(n).padStart(2, "0");
    ts.textContent = `${p(d.getHours())}:${p(d.getMinutes())}`;
    el.appendChild(ts);
}

// 分段打字机：按 \n 分段逐段播放，段间停顿
function typeReply(el: HTMLElement, full: { dialogue: string; action?: string; thoughts?: string }) {
    const dialogue = document.createElement("div");
    dialogue.className = "dialogue";
    el.appendChild(dialogue);

    const segments = full.dialogue.split("\n").filter((s) => s.trim());
    const finalText = segments.join("\n");

    setBusyState(true);
    let segIdx = 0;
    let i = 0;
    let timer = 0;

    const finish = () => {
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

        setBusyState(false);
    };

    const playSegment = () => {
        if (segIdx >= segments.length) {
            finish();
            return;
        }

        const seg = segments[segIdx]!;
        timer = window.setInterval(() => {
            i += 3;
            dialogue.textContent = segments.slice(0, segIdx).join("\n") + (segIdx > 0 ? "\n" : "") + seg.slice(0, i);

            if (i >= seg.length) {
                clearInterval(timer);
                segIdx++;
                i = 0;
                dialogue.textContent += "…";
                setTimeout(() => {
                    dialogue.textContent = finalText.slice(0, finalText.length);
                    window.setTimeout(playSegment, 0);
                }, 700 + Math.random() * 400);
            }
        }, 55);
    };

    playSegment();
}

let busy = false;

function setBusyState(b: boolean) {
    busy = b;
    const dot = document.getElementById("status-dot")!;
    const title = document.getElementById("chat-title-text")!;
    dot.classList.toggle("busy", b);
    const thinking = (localStorage.getItem("deepseek-effort") ?? "high") !== "disabled";
    title.textContent = b
        ? `${CHARACTER_REF.name} · ${thinking ? "思考中…" : "回复中…"}`
        : `${CHARACTER_REF.name} · ${demoMode ? "演示模式（不会思考）" : "在线"}`;
}

// ============ 聊天流程 ============

let demoMode = false;
async function sendMessage(text: string, opts?: { proactive?: boolean }): Promise<ChatResult | null> {
    const proactive = opts?.proactive ?? false;

    if (!proactive) {
        bumpTurnsSinceEvent();
        markUserReplied(); // 用户回复了 → 她可以再次主动开口
        // 记录用户最后回复时刻（真实+虚拟），用于"被冷落"反应
        store.lastReplyRealAt = Date.now();
        store.lastReplyVirtualAt = store.virtualMs;
        const userEl = appendMessage("user");
        userEl.textContent = text;
        attachTimeStamp(userEl);
    }

    setBusyState(true);

    try {
        let result: ChatResult;

        if (demoMode) {
            const base = demoReply(text);
            // 被冷落时用专门的文案（proactive 触发）
            const isNeglect = /被冷落|等了你|没有回复|不理你|想你了/.test(text);
            result = proactive
                ? { ...base, dialogue: isNeglect ? neglectLine(neglectLevel().level) : proactiveLine(), story: fallbackStory() }
                : base;
        } else {
            result = await chatWithDeepSeek(text);
        }

        if (!result.dialogue) {
            throw new Error("AI 返回格式异常，请检查 API Key 或稍后重试");
        }

        applyDelta(result.delta ?? {});

        const fix = USER_EMOTION_FIX[result.user_emotion] ?? {};
        for (const [k, v] of Object.entries(fix)) {
            aiState[k] = clamp(aiState[k]! + (v as number) * 0.5);
        }

        updateStateUI();
        logEmotion(proactive ? "ai" : "user", proactive ? "✨主动" : text, EMOTION_NAMES[result.user_emotion] ?? result.user_emotion);
        logEmotion("ai", result.dialogue.slice(0, 20), `↗${dominantTrait()}`);

        // 剧情推进：AI 给了事件才记录（普通聊天不硬凑事件）
        const story = result.story && result.story.event ? result.story : null;

        if (story?.event) {
            store.storyEvents.push({ day: currentDayIndex(), text: story.event });
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

        // 写入聊天历史（AI 的记忆）
        if (proactive) {
            // 她主动开口：历史里 user 侧用说明性占位，避免 AI 把情境指令当用户的话
            store.chatHistory.push({ role: "user", content: "（她主动找你说话）", ts: store.virtualMs });
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
            const container = document.getElementById("chat-messages")!;
            const line = document.createElement("div");
            line.className = "story-line";
            line.textContent = `📖 ${story.event}`;
            container.appendChild(line);
            container.scrollTop = container.scrollHeight;
        }

        const msgEl = appendMessage("ai");

        if (proactive) {
            msgEl.classList.add("proactive");
        }

        typeReply(msgEl, result);
        attachTimeStamp(msgEl);

        const deltaSummary = Object.entries(result.delta ?? {})
            .filter(([, v]) => Math.abs(v as number) >= 3)
            .map(([k, v]) => {
                const dim = DIMENSIONS.find((d) => d.key === k);
                return `${dim?.label ?? k}${(v as number) > 0 ? "+" : ""}${v}`;
            })
            .join(" ");
        const tag = document.createElement("span");
        tag.className = "emotion-tag";
        tag.textContent = `${proactive ? "✨ 她主动开口｜" : ""}AI 状态：${dominantTrait()}${deltaSummary ? `｜变化：${deltaSummary}` : ""}`;
        msgEl.appendChild(tag);

        // 主角回复完成 → 世界调度层（Director）智能判断（代码层 trigger 命中才调用）
        if (!proactive) {
            void maybeDirector(text);
            void maybeNpcIntervention();
        }

        return result;
    } catch (e) {
        appendMessage("ai").textContent = `⚠️ ${(e as Error).message}`;
        return null;
    } finally {
        setBusyState(false);
    }
}

async function handleSend() {
    const input = document.getElementById("chat-input") as HTMLInputElement;
    const sendBtn = document.getElementById("chat-send") as HTMLButtonElement;
    const text = input.value.trim();

    if (!text) return;

    input.value = "";
    sendBtn.disabled = true;

    try {
        await sendMessage(text);
    } finally {
        sendBtn.disabled = false;
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
            store.storyEvents.push({ day: currentDayIndex(), text: ev });
            if (store.storyEvents.length > 100) store.storyEvents.shift();

            const container = document.getElementById("chat-messages")!;
            const line = document.createElement("div");
            line.className = "story-line";
            line.textContent = `📖 ${ev}`;
            container.appendChild(line);
            container.scrollTop = container.scrollHeight;

            updateStoryUI();
        }
    }

    // 2. NPC 介入（Director 指定，走现有 runNpcIntervention 渲染）
    if (decision.eventType === "npc_intervention" && decision.npcId) {
        const npc = store.npcs[decision.npcId];
        if (npc && !npc.present && !npcBusy) {
            npcBusy = true;
            try {
                // 复用介入模式：默认"加入场景"，跨场景用"发消息"
                const nearby = ["学校", "教室", "图书馆", "食堂", "放学"].some((z) => z === npc.location);
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
            aiState.affection = clamp(aiState.affection + rel.delta);
            aiState.trust = clamp(aiState.trust + rel.delta * 0.6);
            updateStateUI();
        } else if (rel.target === "user") {
            // 用户对主角（用户侧由用户自己决定，这里只微调主角感知）
            aiState.affection = clamp(aiState.affection + rel.delta * 0.5);
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
    if (decision.memoryUpdate) {
        if (decision.memoryUpdate.action === "save") {
            const m = decision.memoryUpdate.content;
            if (m && !store.memories.includes(m)) {
                store.memories.push(m);
                if (store.memories.length > 30) store.memories = store.memories.slice(-30);
            }
        } else {
            const m = decision.memoryUpdate.content;
            store.memories = store.memories.filter((x) => !x.includes(m));
        }
    }

    saveState();
}

// 主入口：用户消息后调用（主角回复完成后）
async function maybeDirector(userText: string) {
    if (directorBusy || demoMode) return;
    if (!localStorage.getItem("deepseek-key")) return;

    // 代码层 trigger：普通聊天 → null → 完全不调用 Director
    const trigger = detectTrigger(userText);
    if (!trigger) return;

    // 跨天/离线等外部 trigger 由调用方直接传；这里只处理消息类 trigger
    await runDirector(trigger);
}

// 通用执行（消息 trigger / 跨天 / 离线共用）
async function runDirector(trigger: DirectorTrigger) {
    if (directorBusy || demoMode) return;
    if (!localStorage.getItem("deepseek-key")) return;

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
    if (!localStorage.getItem("deepseek-key")) return;

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
        const container = document.getElementById("chat-messages")!;
        const line = document.createElement("div");
        line.className = "story-line";
        line.textContent = pick.mode === "scene"
            ? `【${npc.profile.name}从旁边经过】`
            : `【${npc.profile.name}走了过来】`;
        container.appendChild(line);
        container.scrollTop = container.scrollHeight;
    } else if (pick.mode === "message") {
        // 手机消息：小雨发来消息
        const container = document.getElementById("chat-messages")!;
        const line = document.createElement("div");
        line.className = "story-line";
        line.textContent = `📱 ${npc.profile.name}发来消息`;
        container.appendChild(line);
        container.scrollTop = container.scrollHeight;
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

    // 主角自然回应 NPC（她不是木头人——别人跟她说话，她会接）
    // 消息模式：几乎必回；现场模式：有一定概率接话，也可能只是点点头
    const replyChance = pick.mode === "message" ? 0.9 : 0.6;
    if (Math.random() < replyChance) {
        await mainReplyToNpc(npc, result.dialogue);
    }

    // 她说完离开了（恢复二人对话）——渲染离场提示
    if (!npc.present && !store.presentNpcs.includes(npc.profile.id)) {
        const container = document.getElementById("chat-messages")!;
        const line = document.createElement("div");
        line.className = "story-line";
        line.textContent = `${npc.profile.avatar} ${npc.profile.name}走了${pick.mode === "message" ? "，你放下手机" : ""}。`;
        container.appendChild(line);
        container.scrollTop = container.scrollHeight;
    }
}

// 主角回应 NPC：调用主角 AI（非 proactive 通道，但禁止再触发 NPC/Director 递归）
async function mainReplyToNpc(npc: { profile: { name: string; id: string } }, npcDialogue: string) {
    if (busy || demoMode) return;
    if (!localStorage.getItem("deepseek-key")) return;

    setBusyState(true);
    try {
        const result = await chatWithDeepSeek(
            `（${npc.profile.name}刚对你说：${npcDialogue.slice(0, 40)}。` +
            `自然地回应她——态度取决于你们的关系和你的心情；回应完如果有想对用户说的话也可以带上一句，但不要长篇大论，也别冷落用户。）`,
        );
        if (!result?.dialogue) return;

        applyDelta(result.delta ?? {});
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
        typeReply(msgEl, result);
        attachTimeStamp(msgEl);
    } catch (e) {
        console.warn("主角回应 NPC 失败：", e);
    } finally {
        setBusyState(false);
    }
}

// ============ 聊天历史面板 ============

function renderHistoryToChat() {
    if (!store.chatHistory.length) return;

    const container = document.getElementById("chat-messages")!;
    const divider = document.createElement("div");
    divider.className = "history-divider";
    divider.textContent = `—— 上次的聊天记录（共 ${store.chatHistory.length} 条）——`;
    container.appendChild(divider);

    for (const entry of store.chatHistory.slice(-20)) {
        const div = document.createElement("div");
        div.className = `msg ${entry.role === "user" ? "user" : "ai"}`;
        div.textContent = entry.content;
        container.appendChild(div);
    }

    container.scrollTop = container.scrollHeight;
}

function openHistory() {
    const modal = document.getElementById("history-modal")!;
    const list = document.getElementById("history-list")!;
    list.innerHTML = "";

    if (!store.chatHistory.length) {
        list.innerHTML = '<div style="color:rgba(255,255,255,0.5);font-size:12px;text-align:center;padding:20px;">还没有聊天记录。</div>';
    } else {
        const groups = new Map<string, typeof store.chatHistory>();

        for (const e of store.chatHistory) {
            const key = e.ts
                ? `第 ${Math.floor((e.ts - store.dayBaseMs) / 86400000) + 1} 天`
                : "过去";
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(e);
        }

        for (const [day, entries] of groups) {
            const dayTitle = document.createElement("div");
            dayTitle.className = "history-day";
            dayTitle.textContent = `📅 ${day}`;
            list.appendChild(dayTitle);

            for (const e of entries) {
                const div = document.createElement("div");
                div.className = `history-msg ${e.role}`;
                const time = e.ts ? new Date(e.ts) : null;
                const timeStr = time
                    ? `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`
                    : "";
                div.innerHTML =
                    `<span class="h-role">${e.role === "user" ? "你" : CHARACTER_REF.name}</span>` +
                    `<span class="h-time">${timeStr}</span>` +
                    `<div class="h-content">${e.content}</div>`;
                list.appendChild(div);
            }
        }
    }

    modal.classList.remove("hidden");
}

// ============ 角色设定弹层 ============

const charModal = document.getElementById("char-modal")!;
const charFields: { id: string; key: keyof CharacterProfile }[] = [
    { id: "char-name", key: "name" },
    { id: "char-age", key: "age" },
    { id: "char-appearance", key: "appearance" },
    { id: "char-personality", key: "personality" },
    { id: "char-background", key: "background" },
    { id: "char-speech", key: "speechStyle" },
    { id: "char-likes", key: "likes" },
    { id: "char-dislikes", key: "dislikes" },
    { id: "char-relation", key: "relation" },
    { id: "char-secrets", key: "secrets" },
];

function fillCharForm() {
    for (const f of charFields) {
        (document.getElementById(f.id) as HTMLInputElement | HTMLTextAreaElement).value = CHARACTER_REF[f.key];
    }
}

function readCharForm() {
    for (const f of charFields) {
        CHARACTER_REF[f.key] = (document.getElementById(f.id) as HTMLInputElement | HTMLTextAreaElement).value.trim();
    }
}

// ============ 事件绑定 ============

document.getElementById("chat-send")!.addEventListener("click", handleSend);
document.getElementById("chat-input")!.addEventListener("keydown", (e) => {
    markUserInput();
    if (e.key === "Enter") handleSend();
});
document.getElementById("chat-input")!.addEventListener("input", markUserInput);
document.getElementById("chat-input")!.addEventListener("focus", markUserInput);

// 状态面板开关
document.getElementById("panel-toggle")!.addEventListener("click", () => {
    const panel = document.getElementById("state-panel")!;
    const wrap = document.getElementById("chat-wrap")!;
    const btn = document.getElementById("panel-toggle")!;

    panel.classList.toggle("hidden");
    wrap.classList.toggle("panel-open");
    btn.classList.toggle("panel-open");
});

// 全部情感：打开全屏浮层
document.getElementById("emotions-toggle")!.addEventListener("click", () => {
    const modal = document.getElementById("emotions-modal")!;
    modal.classList.remove("hidden");
    drawChart();
});
document.getElementById("emotions-close")!.addEventListener("click", () => {
    document.getElementById("emotions-modal")!.classList.add("hidden");
});
document.getElementById("emotions-modal")!.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) {
        document.getElementById("emotions-modal")!.classList.add("hidden");
    }
});

const demoBtn = document.getElementById("demo-btn") as HTMLButtonElement;
demoBtn.addEventListener("click", () => {
    demoMode = !demoMode;
    demoBtn.textContent = demoMode ? "🎭 演示中" : "🎭 演示";
    demoBtn.classList.toggle("active", demoMode);
    if (demoMode) {
        appendMessage("ai").textContent =
            "⚠️ 当前是演示模式——回复是预设模板，不会思考、不接上下文。想体验真正的她，请到菜单页设置 DeepSeek API Key 后关闭演示。";
    } else {
        setBusyState(false); // 刷新标题状态
    }
});

document.getElementById("reset-state")!.addEventListener("click", () => {
    if (confirm("重置为新学期？会清空：情感、剧情、聊天记录、时间线，且无法恢复。")) {
        resetState();

        store.turnCount = 0;
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

        chartHistory.length = 0;
        document.getElementById("chat-messages")!.innerHTML = "";
        document.getElementById("mood-history")!.innerHTML = "<b>情绪日志</b><br>";

        updateStateUI();
        updateStoryUI();
        updateScheduleUI();
        saveState(); // 重置后立即保存（含新的 NPC 世界）
        appendMessage("ai").textContent = "🔄 已重置。新的学期开始了——一切从零开始。";
    }
});

// 速率/时间控件
function bindTimeControls() {
    document.getElementById("clock-more")!.addEventListener("click", () => {
        const detail = document.getElementById("clock-detail")!;
        const btn = document.getElementById("clock-more")!;
        const isHidden = detail.style.display === "none";
        detail.style.display = isHidden ? "" : "none";
        btn.textContent = isHidden ? "🔼 收起时间设置" : "⏱ 调整时间 / 倍率";
    });

    for (const btn of document.querySelectorAll<HTMLElement>(".rate-btn")) {
        btn.addEventListener("click", () => setTimeRate(parseFloat(btn.dataset.rate!)));
    }

    document.getElementById("rate-set")!.addEventListener("click", () => {
        const v = parseFloat((document.getElementById("rate-custom") as HTMLInputElement).value);
        if (Number.isFinite(v)) setTimeRate(v);
    });

    document.getElementById("time-set")!.addEventListener("click", () => {
        const day = parseInt((document.getElementById("day-input") as HTMLInputElement).value, 10);
        const hhmm = (document.getElementById("time-input") as HTMLInputElement).value;
        setVirtualTime(day, hhmm || "07:30");
    });

    document.getElementById("today-btn")!.addEventListener("click", jumpToToday);

    document.getElementById("date-set")!.addEventListener("click", () => {
        const iso = (document.getElementById("date-input") as HTMLInputElement).value;
        if (iso) setStartDate(iso);
    });
}

// 历史面板
document.getElementById("history-btn")!.addEventListener("click", openHistory);
document.getElementById("history-close")!.addEventListener("click", () => {
    document.getElementById("history-modal")!.classList.add("hidden");
});
document.getElementById("history-clear")!.addEventListener("click", () => {
    if (confirm("清空所有聊天记录？（情感状态保留）")) {
        store.chatHistory = [];
        saveState();
        document.getElementById("history-list")!.innerHTML =
            '<div style="color:rgba(255,255,255,0.5);font-size:12px;text-align:center;padding:20px;">已清空。</div>';
    }
});

// 角色弹层
document.getElementById("char-btn")!.addEventListener("click", () => {
    fillCharForm();
    charModal.classList.remove("hidden");
});

document.getElementById("char-cancel")!.addEventListener("click", () => {
    charModal.classList.add("hidden");
});

document.getElementById("char-save")!.addEventListener("click", () => {
    readCharForm();
    saveCharacter();
    charModal.classList.add("hidden");
    appendMessage("ai").textContent = `🔄 角色设定已更新。我是${CHARACTER_REF.name}，接下来也请多指教。`;
});

document.getElementById("char-reset-preset")!.addEventListener("click", () => {
    const preset = (document.getElementById("char-preset") as HTMLSelectElement).value;
    if (PRESETS[preset]) {
        Object.assign(CHARACTER_REF, { ...PRESETS[preset]! });
        fillCharForm();
    }
});

// ============ 胶水：跨模块回调注册 ============

setCharacterGetter(() => CHARACTER_REF);

setTimeMessageSender((text, opts) => {
    if (busy || userIsTyping()) return; // AI 回复中或用户正在输入，不打扰
    void sendMessage(text, opts);
});

setStoryMessageSender((text, opts) => {
    if (busy || userIsTyping()) return; // AI 回复中或用户正在输入，不打扰
    void sendMessage(text, opts);
});

setSlotChangeHandler(() => {
    updateScheduleUI();
    onSlotChanged();
});

setDayChangeHandler((oldDay) => {
    finalizeDay(oldDay);
    directorOnDayChange(oldDay, store.dayIndex);
});

setRandomMomentHook(() => {
    tickNpcWorld(); // NPC 自己的时间也在走
    maybeRandomMoment();
});

setWizardSavedCallback(() => {
    appendMessage("ai").textContent = `你好呀，我是${CHARACTER_REF.name}。设定已就位，接下来请多指教。`;
});

// ============ 初始化 ============

// 无 API Key：自动进入演示模式并明确提示（避免用户误以为是真实 AI）
if (!localStorage.getItem("deepseek-key")) {
    demoMode = true;
    demoBtn.textContent = "🎭 演示中";
    demoBtn.classList.add("active");
}

// 角色（读取存档中的角色；无存档时保持默认，等向导完成才落盘）
Object.assign(CHARACTER_REF, loadCharacter());

buildMeters();

const hadSave = loadState();
const hasChar = !!localStorage.getItem(CHAR_KEY);
updateStateUI();
updateStoryUI();

// 没有存档（新游戏）：时间停在"第一次相遇"，初始化 NPC 世界
if (!hadSave) {
    store.virtualMs = store.dayBaseMs + slotMinutes(FIRST_MEETING_HHMM) * 60000;
    store.scheduleIndex = scheduleIndexFor(store.virtualMs);
    store.dayIndex = currentDayIndex();
    updateScheduleUI();
    initNpcWorld();
}

// NPC 世界随虚拟时间推进（她们有自己的生活，0 成本）
tickNpcWorld();
saveState(); // 更新 NPC 作息后落盘

// 已有角色：显示欢迎语（欢迎回来 / 你好呀）
// 没有角色（新建档）：不显示欢迎语——等角色向导完成后，由 savedCallback 打招呼
if (hasChar) {
    const welcome = appendMessage("ai");
    welcome.innerHTML =
        (hadSave ? `欢迎回来，我（和我的心）都还在呢。我是${CHARACTER_REF.name}。` : `你好呀，我是${CHARACTER_REF.name}～`) +
        "<br>我的内心有 <b>38 个情感维度</b>，分成五层：<br>" +
        "🎭 人格（性格底色）· ❤️ 关系（好感/信任/亲密会积累）· 💭 情绪（喜悦/悲伤/愤怒/嫉妒/孤独…会波动）· 🫀 状态（精力/压力/疲惫）· 🖤 阴影（贪婪/虚荣/占有欲/傲慢/自私…平时潜伏，受刺激才浮现）<br>" +
        "试试：<b>夸我</b>（虚荣也会偷偷涨）、<b>凶我</b>、<b>表白</b>、<b>提别的女生</b>（会吃醋）、<b>说送我礼物</b>（会心动）、<b>道歉</b>（我会内疚）、<b>讲恐怖故事</b>（会害怕）～" +
        "<br>每轮对话都会自动存档；我不说话超过一会儿，她还会主动来找你。";
}

if (hadSave) {
    renderHistoryToChat();
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

// 调试钩子
(window as any).__debug = {
    next: () => {
        const oldDay = store.dayIndex;
        store.scheduleIndex = (store.scheduleIndex + 1) % 16;
        store.virtualMs = store.dayBaseMs + (currentDayIndex() - 1) * 86400000 + slotMinutes(currentSchedule().time) * 60000;
        store.dayIndex = currentDayIndex();
        if (oldDay !== store.dayIndex) finalizeDay(oldDay);
        updateScheduleUI();
        onSlotChanged();
    },
    setTime: (day: number, hhmm: string) => setVirtualTime(day, hhmm),
    setRate: (r: number) => setTimeRate(r),
    setStartDate: (iso: string) => setStartDate(iso),
    jumpToday: () => jumpToToday(),
    speak: () => void sendMessage("（现在你手头正在做的事：" + currentSchedule().activity + "。基于这件事主动和对方说一句话。）", { proactive: true }),
    state: () => aiState,
    time: () => ({ ...currentSchedule(), rate: store.timeRate, day: currentDayIndex() }),
    prompt: () => SYSTEM_PROMPT(CHARACTER_REF),
};

// 首次进入（无角色设定）：打开角色创建向导
if (!localStorage.getItem(CHAR_KEY)) {
    setTimeout(openWizard, 800);
}

// 移动端（小屏）：默认收起状态面板，聊天区全屏
if (window.innerWidth < 768) {
    document.getElementById("state-panel")!.classList.add("hidden");
    document.getElementById("chat-wrap")!.classList.remove("panel-open");
    document.getElementById("panel-toggle")!.classList.remove("panel-open");
}
