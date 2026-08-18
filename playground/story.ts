// story.ts —— 剧情系统：世界观、阶段、事件、档案、剧情线、随机事件
// 依赖 state / time / storage；随机事件的"她开口"通过 messageSender 回调（chat.ts 注册）。

import { aiState, clamp } from "./state";
import { store, saveState, HistoryEntry } from "./storage";
import { currentSchedule, currentDayIndex, fmtVirtualTime, isFirstMeeting, proactiveEnabled, setMessageSender, tryProactiveSpeak, tryProactiveSpeakForce } from "./time";

// 角色名注入（chat.ts 注册，避免循环依赖）
let charNameGetter: (() => string) | null = null;
export function setStoryCharNameGetter(fn: () => string) {
    charNameGetter = fn;
}

// ============ 世界观（通用框架 + 多人应变） ============

export function worldSetting(characterName: string): string {
    const s = store.scene;
    return `
【世界与情境】
- 你和${characterName}生活在同一个日常世界里（你们是谁、什么关系、在什么地方，见上方"角色设定"档案）。
- 你们的世界围绕「${s.name}」展开：她平时在${s.place}${s.routine}，身边有${s.others}。
- 这个世界不是只有你们两个人：${s.others}、朋友、家人、路人随时可能出现在对话里。
- 时间、你们是否在一起（面对面还是发消息）由时间系统决定，言行必须符合当前时间地点。
- 主线：你们的关系从陌生到……由你们共同书写，没有既定结局，顺着情感状态自然发展。

【你的职责：剧情导演 + 多人应变】
- 不要被动回答问题，主动推动剧情（发起日常事件、推进时间、制造相遇与别离）。
- 多人对话：当对话中提到别人、或情境需要（有${s.others}经过、朋友搭话、家人来电），你可以自然地让第三方角色出现并参与对话，由你一人扮演所有角色。
- 第三方说话时用清晰标记区分，例如：（她的朋友）"你俩天天待在一起哦～"——让对话者清楚知道是谁在说话。
- 灵活应变：从上下文中判断当前场合、在场的人、正在聊的话题，切换称呼和语气（对朋友随意、对长辈礼貌、对陌生人客气）。
- 别乱入：第三方角色只在情境自然需要时出现，不要无中生有地塞人进对话。
`;
}

// ============ 剧情阶段 ============

export function storyStage(): { name: string; pct: number; desc: string } {
    const aff = aiState.affection;
    const fam = aiState.familiarity;

    if (aff >= 80 && fam >= 60) return { name: "交心", pct: 90, desc: "彼此最重要的存在，话能说到最深处" };
    if (aff >= 60 || (aff >= 50 && fam >= 50)) return { name: "信任", pct: 70, desc: "她开始愿意说出自己的事（家庭、过去）" };
    if ((aff >= 40 && fam >= 25) || fam >= 40) return { name: "朋友", pct: 50, desc: "会一起吃饭、放学同行、互相吐槽" };
    if ((aff >= 25 && fam >= 12) || fam >= 20) return { name: "熟稔", pct: 30, desc: "交换了名字，日常搭话变多" };
    return { name: "初识", pct: 10, desc: "刚认识，对彼此还很陌生" };
}

// ============ 主动开口频率 ============
// 动态系数由“情绪 + 剧情”共同决定：
// - 关系越亲近、剧情越深入、有进行中的剧情线 → 越愿意主动开口
// - 开心/孤单/依赖/低落/吃醋 → 更想说话；疲惫/害羞/焦虑 → 更安静
// 返回 0.4 ~ 1.6 的倍率，供时段切换和随机事件统一使用。
export function proactiveDrive(): number {
    const relationAvg = (
        aiState.affection +
        aiState.trust +
        aiState.intimacy +
        aiState.familiarity +
        aiState.dependence
    ) / 5;

    // 基础：熟络程度（关系层）
    let factor = 0.65 + (relationAvg - 25) / 100;

    // 剧情阶段：越深入越愿意推进/分享
    factor += (storyStage().pct - 50) / 100;
    // 剧情总进度：故事走得越远，越主动制造/接住剧情
    factor += (store.storyProgress - 50) / 200;

    // 有正在推进的剧情线 → 更主动推进剧情
    if (store.activeThread) factor += 0.2;

    // 情绪层
    if (aiState.joy > 60) factor += 0.2;                                   // 开心想分享
    if (aiState.loneliness > 45) factor += 0.2;                            // 孤单想找你
    if (aiState.dependence > 45) factor += 0.15;                           // 依赖你
    if (aiState.sadness > 50) factor += 0.15;                              // 低落时想倾诉
    if (aiState.anger > 50 || aiState.jealousy > 45) factor += 0.15;       // 有情绪憋不住
    if (aiState.anxiety > 55 || aiState.nervousness > 55) factor -= 0.1;   // 不安时话变少
    if (aiState.fatigue > 55 || aiState.energy < 35) factor -= 0.2;        // 累了少说
    if (aiState.shyness > 55 || aiState.embarrassment > 50) factor -= 0.1; // 害羞/尴尬

    // 人格层：外向/自信的人本来就更主动；敏感的人会更犹豫
    factor += (aiState.extraversion - 50) / 200;
    factor += (aiState.confidence - 50) / 200;
    factor -= (aiState.neuroticism - 50) / 300;

    return clamp(factor, 0.4, 1.6);
}

// ============ 剧情档案（按天归档） ============

export function dayKey(ms: number): number {
    return Math.floor((ms - store.dayBaseMs) / 86400000) + 1;
}

export function finalizeDay(day: number) {
    if (store.journal.some((j) => j.day === day)) return;

    const dayEvents = store.storyEvents.filter((e) => e.day === day).map((e) => e.text);
    const dayChats = store.chatHistory.filter((c) => c.ts && dayKey(c.ts) === day);

    // 用当天的对话做更丰富的摘要：首尾各 2 条 + 中间的关键对话
    const pick = dayChats.slice(0, 4).concat(dayChats.slice(-4));
    const chatTail = pick.length
        ? `对话：${pick.map((c) => `${c.role === "user" ? "他" : "我"}：${c.content.slice(0, 25)}`).join(" / ")}`
        : "";

    // 当天关系/情绪变化轨迹
    const moodTrail: string[] = [];
    if (aiState.affection > 55) moodTrail.push("好感升温");
    if (aiState.trust > 45) moodTrail.push("信任加深");
    if (aiState.sadness > 40 || aiState.loneliness > 40) moodTrail.push("她心里有些低落");
    if (aiState.anger > 40) moodTrail.push("她闹了别扭");
    if (aiState.jealousy > 35) moodTrail.push("她吃醋了");

    const summary = [dayEvents.join("；"), chatTail, moodTrail.join("，")].filter(Boolean).join("。") || "平平无奇的一天，没有特别的事发生。";

    store.journal.push({ day, summary });
    store.journal.sort((a, b) => a.day - b.day);
    if (store.journal.length > 14) store.journal = store.journal.slice(-14);
    saveState();
}

export function journalText(): string {
    const lines: string[] = [];
    const today = currentDayIndex();

    for (const j of store.journal.slice(-3)) {
        lines.push(`第 ${j.day} 天：${j.summary}`);
    }

    const todayEvents = store.storyEvents.filter((e) => e.day === today).slice(-3).map((e) => e.text);
    if (todayEvents.length) lines.push(`今天（第 ${today} 天）发生的事：${todayEvents.join("；")}`);
    if (store.journal.length === 0 && !todayEvents.length) {
        lines.push(isFirstMeeting() ? "这是你们故事的第一天，一切都还陌生。" : "你们的故事从相识到如今，已经一起走过了不少日子。");
    }

    return lines.join("\n");
}

// ============ 事件兜底 ============

export function fallbackStory(): { event: string; progress: number; thread: "new" | "continue" | "end" } {
    const slot = currentSchedule();
    const mood: string[] = [];

    if (aiState.joy > 55) mood.push("她心情不错");
    if (aiState.sadness > 45) mood.push("她像有心事");
    if (aiState.anger > 40) mood.push("她脸色不太好看");
    if (aiState.fatigue > 50) mood.push("她有点犯困");
    if (aiState.nervousness > 45) mood.push("她有些心不在焉");

    if (slot.label === "深夜") {
        const d = new Date(store.virtualMs);
        const roll = d.getMinutes() % 3;
        const night = ["睡得很沉", "翻了个身，呢喃了句什么", "手机屏幕亮了一下，她没醒"][roll]!;
        return { event: `${night}（${fmtVirtualTime()}）`, progress: 0, thread: "continue" };
    }

    const suffix = mood.length ? `，${mood.join("，")}` : "";
    const thread = store.activeThread ? "continue" : "new";

    return {
        event: `${slot.activity}${suffix}（${fmtVirtualTime()}）`.slice(0, 30),
        progress: 1 + Math.floor(Math.random() * 3),
        thread,
    };
}

// ============ 随机事件 ============
// 不做预设模板（避免重复、割裂）——把实时情境交给 AI，由 AI 决定此刻发生什么、说不说、说什么。

let nextRandomAt = Date.now() + 8000;
let turnsSinceEvent = 0;
let lastUserInputAt = 0;

// 主动开口的"等待回复"纪律：她说了一句，必须等用户回复才能再说下一句
let awaitingReply = false;
let lastProactiveAt = 0;
const PROACTIVE_COOLDOWN_MS = 60000; // 两次主动开口最短间隔（即使话题不同）

export function bumpTurnsSinceEvent() {
    turnsSinceEvent++;
}

export function markUserInput() {
    lastUserInputAt = Date.now();
}

export function userIsTyping(): boolean {
    const input = document.getElementById("chat-input") as HTMLInputElement | null;
    if (input && input.value.trim()) return true;
    return Date.now() - lastUserInputAt < 2000;
}

let messageSender: ((text: string, opts?: { proactive?: boolean }) => void) | null = null;

export function setStoryMessageSender(fn: (text: string, opts?: { proactive?: boolean }) => void) {
    messageSender = fn;
}

// 构造"此刻的实时情境"，交给 AI 自己抉择（不预设任何事件内容）
function liveSituationText(): string {
    const slot = currentSchedule();
    const moodParts: string[] = [];
    if (aiState.joy > 55) moodParts.push("心情不错");
    if (aiState.sadness > 40) moodParts.push("心里有点低落");
    if (aiState.anger > 40) moodParts.push("压着火");
    if (aiState.jealousy > 35) moodParts.push("有点吃醋");
    if (aiState.loneliness > 40) moodParts.push("觉得孤单");
    if (aiState.fatigue > 50) moodParts.push("有点疲惫");
    if (aiState.anxiety > 45) moodParts.push("有些心不在焉");
    const mood = moodParts.join("，") || "心情平稳";

    const recent = store.chatHistory.slice(-4).map((e) =>
        `${e.role === "user" ? "对方" : "我"}：${e.content.slice(0, 30)}`,
    ).join(" ｜ ");

    return (
        `（此刻的真实情境：现在是${fmtVirtualTime()}，${slot.label}，你正在做的事：${slot.activity}。你的心情：${mood}。` +
        (recent ? `最近聊到：${recent}。` : "") +
        (store.activeThread ? `你们之间进行中的事：${store.activeThread}。` : "") +
        `现在你内心自然地冒出一个念头、注意到一个小细节，或身边发生了点小事，顺着它主动对对方说一句话——要像真实生活里突然想到什么随口提起，不要生硬汇报，不要重复聊过的话题，不要无中生有地堆砌事件。如果觉得没什么好说，就用行动或内心想法轻轻带过。）`
    );
}

export function maybeRandomMoment() {
    if (userIsTyping()) return;
    // 静默期（新存档/向导期间）：不随机开口，避免角色抢话
    if (!proactiveEnabled) {
        console.log("[随机事件] 跳过：proactiveEnabled=false");
        return;
    }

    // 新存档保护期：刚创建（还没聊过任何一轮）不触发"被冷落"
    // （避免创建完成就被说"你为什么不回我"）
    if (store.turnCount === 0) {
        // 但仍允许真实的主动开口（打招呼/分享）——只是不触发被冷落
        if (neglectLevel().level > 0) {
            store.lastReplyRealAt = Date.now();
            store.lastReplyVirtualAt = store.virtualMs;
        }
    } else {
        // 先检查"被冷落"：用户很久没回复时，触发情感反应（强制通道，突破等待）
        const neglect = neglectLevel();
        if (neglect.level > 0 && triggerNeglectReaction(neglect)) return;
    }

    if (currentSchedule().label === "深夜") {
        console.log("[随机事件] 跳过：深夜");
        return;
    }

    const forced = turnsSinceEvent >= 4;
    if (!forced && Date.now() < nextRandomAt) return;

    // 频率随情绪/剧情动态变化：越主动的时候，等待间隔越短、尝试概率越高
    const drive = proactiveDrive();
    const intervalMs = Math.max(15000, Math.min(180000, (30000 + Math.random() * 40000) / Math.max(0.4, drive)));
    nextRandomAt = Date.now() + intervalMs;
    if (!forced && Math.random() > Math.min(0.9, 0.45 * drive)) {
        console.log(`[随机事件] 跳过：随机概率 (drive=${drive.toFixed(2)})`);
        return;
    }

    turnsSinceEvent = 0;
    console.log("[随机事件] ✅ 触发主动开口");

    // 统一收口：正在等用户回复时不再开口（防止连续自言自语）
    tryProactiveSpeak(liveSituationText());
}

// ============ 被冷落反应（人的情感需要外界因素） ============

// demo 模式（无 API key）下的冷落文案，按等级递增
const DEMO_NEGLECT_LINES: Record<number, string[]> = {
    1: ["喂，你还在吗？", "……在忙吗？", "怎么突然不回消息了，我还以为你出事了。"],
    2: ["是不是我哪里说错话了……你怎么不理我。", "在吗……我有点想你了。", "你很久没回我了，是把我忘了吗……"],
    3: ["哼，不理你五分钟！（过了几秒）……你、你倒是说句话啊。", "你再不理我，我就……我就去找别人聊天了！（并没有）", "我等了你半天消息，你干嘛去了。"],
    4: ["你是不是讨厌我了……", "我知道了，你肯定去找别人聊了。", "（消息已发送，但一直没等到回复）我是不是对你来说一点都不重要……"],
};

export function neglectLine(level: number): string {
    const pool = DEMO_NEGLECT_LINES[level] ?? DEMO_NEGLECT_LINES[1]!;
    return pool[Math.floor(Math.random() * pool.length)]!;
}

// 等级：0=正常 1=试探 2=失落 3=委屈/赌气 4=伤心/心凉
export interface NeglectInfo {
    level: number;
    realIdleMin: number;
    virtualIdleMin: number;
    sinceText: string;
}

function fmtIdle(mins: number): string {
    if (mins < 60) return `${Math.max(1, Math.round(mins))} 分钟`;
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`;
}

// 根据真实闲置时长判定"被冷落"等级
export function neglectLevel(): NeglectInfo {
    const realIdleMin = (Date.now() - store.lastReplyRealAt) / 60000;
    const virtualIdleMin = (store.virtualMs - store.lastReplyVirtualAt) / 60000;

    let level = 0;
    if (realIdleMin >= 45 || (realIdleMin >= 15 && virtualIdleMin >= 240)) level = 4;
    else if (realIdleMin >= 20 || (realIdleMin >= 10 && virtualIdleMin >= 120)) level = 3;
    else if (realIdleMin >= 8 || virtualIdleMin >= 90) level = 2;
    else if (realIdleMin >= 3 || virtualIdleMin >= 45) level = 1;

    // 深夜不打扰（除非真的很久没联系）
    if (currentSchedule().label === "深夜" && level < 3) level = 0;

    return { level, realIdleMin, virtualIdleMin, sinceText: fmtIdle(realIdleMin) };
}

// 被冷落时的情感变化
const NEGLECT_DELTA: Record<number, Record<string, number>> = {
    1: { loneliness: 5, anxiety: 3, anticipation: -3, affection: 0 },
    2: { loneliness: 9, sadness: 5, anxiety: 6, anticipation: -5, affection: -1, shyness: 1 },
    3: { loneliness: 12, sadness: 8, anxiety: 8, anger: 4, affection: -2, trust: -1, possessiveness: 2 },
    4: { loneliness: 15, sadness: 12, anxiety: 10, anger: 7, affection: -4, trust: -2, fear: 4, possessiveness: 3 },
};

// 被冷落文案：等级 → 她可能会说的话（会经由 AI 自然化处理，这里只是引导情境）
const NEGLECT_SITUATION: Record<number, string> = {
    1: "对方已经 ${since} 没有回复你了。你有点在意，想试探一下他在不在、在忙什么。",
    2: "对方已经 ${since} 没回你了。你开始觉得被冷落了，心里空落落的，想问他是不是忘了你、或者是不是自己哪里让他不高兴了。",
    3: "对方已经 ${since} 没回你了。你越想越委屈：明明之前聊得好好的，他怎么突然不理你了？你想赌气不理他，又忍不住想发消息。",
    4: "对方已经 ${since} 没回你了。你很难过，觉得他可能根本不在乎你、是不是去找别人了。你想质问，又怕显得自己太在意。",
};

// 触发"被冷落"反应：她主动开口，且情感状态被影响。返回是否实际触发了。
export function triggerNeglectReaction(info: NeglectInfo): boolean {
    if (info.level <= 0) return false;

    // 触发条件：等级比上次高（升级了），或同一等级但已经过了很久（2 小时）——她等得更久、更在意
    const upgraded = info.level > store.lastNeglectLevel;
    const longWaitSameLevel = info.level === store.lastNeglectLevel && Date.now() - store.lastNeglectRealAt >= 2 * 3600000;
    if (!upgraded && !longWaitSameLevel) return false;

    store.lastNeglectAt = store.virtualMs;
    store.lastNeglectRealAt = Date.now();
    store.lastNeglectLevel = info.level;

    // 情感变化
    const delta = NEGLECT_DELTA[info.level] ?? NEGLECT_DELTA[1]!;
    for (const [k, v] of Object.entries(delta)) {
        aiState[k] = clamp(aiState[k]! + v);
    }

    const situation = (NEGLECT_SITUATION[info.level] ?? NEGLECT_SITUATION[1]!).replace("${since}", info.sinceText);

    store.storyEvents.push({
        day: currentDayIndex(),
        text: `她等了你 ${info.sinceText}，一直没有回复`,
    });
    if (store.storyEvents.length > 100) store.storyEvents.shift();

    saveState();
    updateStoryUI();

    // 让 AI 自然化这段情境（强制通道：被冷落升级允许突破"等待回复"，但仍有 60s 冷却）
    tryProactiveSpeakForce(
        `【情境】${situation}\n基于这个情境，主动给对方发一条消息——表达你的心情（在意/失落/委屈/难过，按等级递增），但不要质问式地咄咄逼人，保持角色性格。`,
    );
    return true;
}

// 剧情 UI（面板事件时间线）
export function updateStoryUI() {
    const stage = storyStage();

    (document.getElementById("story-stage-name")!).textContent = stage.name;
    (document.getElementById("story-stage-desc")!).textContent = stage.desc;
    (document.getElementById("story-progress-bar")!).style.width = `${store.storyProgress}%`;
    (document.getElementById("story-progress-val")!).textContent = `${store.storyProgress}%`;

    // 角色卡：名字 + 阶段 + 进度环
    const nameEl = document.getElementById("panel-char-name");
    if (nameEl) nameEl.textContent = charNameGetter?.() || "角色";
    const stageEl = document.getElementById("panel-char-stage");
    if (stageEl) stageEl.textContent = `${stage.name} · ${stage.desc}`;
    const ring = document.getElementById("stage-ring") as SVGCircleElement | null;
    if (ring) {
        const r = 18;
        const circ = 2 * Math.PI * r;
        ring.style.strokeDasharray = String(circ);
        ring.style.strokeDashoffset = String(circ * (1 - store.storyProgress / 100));
    }
    const pctEl = document.getElementById("panel-char-pct");
    if (pctEl) pctEl.textContent = `${store.storyProgress}%`;

    const box = document.getElementById("story-events")!;
    box.innerHTML = "";

    for (const ev of store.storyEvents.slice(-6)) {
        const div = document.createElement("div");
        div.className = "story-event";
        div.textContent = `📖 ${ev.text}`;
        box.appendChild(div);
    }
}
