// time.ts —— 时间系统：真实时钟 + 可调速率 + 作息表 + 在场判定
// 依赖 storage（时间变量 + saveState）；跨天/时段切换通过回调通知外部。

import { aiState } from "./state";
import { store, saveState } from "./storage";

// ============ 作息表 ============

export const SCHEDULE: { time: string; label: string; activity: string; speakChance: number }[] = [
    { time: "00:00", label: "深夜", activity: "已经睡着了", speakChance: 0 },
    { time: "06:30", label: "清晨", activity: "被闹钟吵醒，赖在床上不想起", speakChance: 0.2 },
    { time: "07:10", label: "出门", activity: "在上学路上，耳机里放着歌", speakChance: 0.25 },
    { time: "07:30", label: "早自习", activity: "踩着铃声进教室，趴在桌上补觉", speakChance: 0.15 },
    { time: "08:45", label: "第一节课", activity: "在听课，笔记本上涂涂画画", speakChance: 0.08 },
    { time: "09:45", label: "课间", activity: "望着窗外发呆", speakChance: 0.45 },
    { time: "10:00", label: "第二节课", activity: "在听课，偶尔走神偷看手机", speakChance: 0.08 },
    { time: "11:00", label: "课间", activity: "去走廊接水，和同学聊了两句", speakChance: 0.45 },
    { time: "11:15", label: "第三节课", activity: "在听课，肚子饿得咕咕叫", speakChance: 0.1 },
    { time: "12:15", label: "午休", activity: "在吃便当，耳机分了一只耳朵", speakChance: 0.6 },
    { time: "13:30", label: "第四节课", activity: "在听课，犯困强撑着", speakChance: 0.08 },
    { time: "14:30", label: "课间", activity: "趴在桌上小憩", speakChance: 0.4 },
    { time: "14:45", label: "第五节课", activity: "在听课，等着放学", speakChance: 0.08 },
    { time: "15:45", label: "放学", activity: "在图书馆自习", speakChance: 0.55 },
    { time: "17:30", label: "傍晚", activity: "在打工的便利店整理货架", speakChance: 0.5 },
    { time: "20:00", label: "晚上", activity: "在自己的房间里写作业，放着桃香的歌", speakChance: 0.5 },
    { time: "22:30", label: "睡前", activity: "洗漱完躺在床上，还没睡着", speakChance: 0.55 },
];

// ============ 时间常量与状态 ============

export const TIME_RATES = [0.5, 1, 10, 30, 60, 1440];
export const RATE_MIN = 0.01;
export const RATE_MAX = 100000;
export const FIRST_MEETING_HHMM = "08:00"; // 第一次相遇（新游戏/重置起点）

let lastRealMs = Date.now();
let clockTimer = 0;

export let proactiveEnabled = true;

// 外部回调（chat.ts 注册）
let slotChangeHandler: (() => void) | null = null;
let dayChangeHandler: ((oldDay: number) => void) | null = null;
let messageSender: ((text: string, opts?: { proactive?: boolean }) => void) | null = null;
let randomMomentHook: (() => void) | null = null;

export function setSlotChangeHandler(fn: () => void) { slotChangeHandler = fn; }
export function setDayChangeHandler(fn: (oldDay: number) => void) { dayChangeHandler = fn; }
export function setMessageSender(fn: (text: string, opts?: { proactive?: boolean }) => void) { messageSender = fn; }
export function setRandomMomentHook(fn: () => void) { randomMomentHook = fn; }

// ============ 主动开口统一收口 ============
// 她说了一句，必须等用户回复才能再说下一句——防止连续轰炸/多来源叠加
let awaitingReply = false;
let lastProactiveAt = 0;
const PROACTIVE_COOLDOWN_MS = 60000; // 两次主动开口最短间隔

export function markUserReplied() {
    awaitingReply = false;
}

export function tryProactiveSpeak(text: string): boolean {
    const now = Date.now();
    if (awaitingReply) return false;
    if (now - lastProactiveAt < PROACTIVE_COOLDOWN_MS) return false;
    lastProactiveAt = now;
    awaitingReply = true;
    messageSender?.(text, { proactive: true });
    return true;
}

// 被冷落升级：允许突破"等待回复"，但仍有冷却
export function tryProactiveSpeakForce(text: string): boolean {
    const now = Date.now();
    if (now - lastProactiveAt < PROACTIVE_COOLDOWN_MS) return false;
    lastProactiveAt = now;
    awaitingReply = true;
    messageSender?.(text, { proactive: true });
    return true;
}

// ============ 时间计算 ============

export function slotMinutes(t: string): number {
    const [h, m] = t.split(":").map(Number);
    return h! * 60 + m!;
}

export function scheduleIndexFor(ms: number): number {
    const d = new Date(ms);
    const mins = d.getHours() * 60 + d.getMinutes();
    let idx = 0; // 默认深夜

    for (let i = 1; i < SCHEDULE.length; i++) {
        if (mins >= slotMinutes(SCHEDULE[i]!.time)) idx = i;
        else break;
    }

    return idx;
}

export function currentSchedule() {
    const slot = SCHEDULE[store.scheduleIndex] ?? SCHEDULE[0]!;

    // 开学第一天早自习：你们初次见面的特殊情境
    if (store.dayIndex === 1 && slot.label === "早自习") {
        return { ...slot, activity: "开学第一天，你们第一次见面" };
    }

    return slot;
}

export function currentDayIndex(): number {
    return Math.floor((store.virtualMs - store.dayBaseMs) / 86400000) + 1;
}

// 是否在校
const SCHOOL_LABELS = ["早自习", "第一节课", "课间", "第二节课", "第三节课", "午休", "第四节课", "第五节课"];

export function inSchool(): boolean {
    return SCHOOL_LABELS.includes(currentSchedule().label);
}

// 深夜（00:00-06:30）：她睡着了
export function isDeepNight(): boolean {
    return currentSchedule().label === "深夜";
}

// 她此刻是否"正忙"（上课/打工/睡）：说话要小声、简短，不能像空闲时那样自在
export function isBusyNow(): boolean {
    const label = currentSchedule().label;
    return label === "深夜" || label.includes("课") || label === "早自习" || label === "傍晚";
}

// 面对面：你们始终在一起（用户是主角生活的一部分，不是隔着手机的网友）
// 方位 = 你们身处的场景（由她的作息决定），对话永远是面对面
export function faceToFace(): boolean {
    return true;
}

// 场景描述：你们此刻在一起、身处什么地方、她正在做什么（喂给 AI 的方位）
export function sceneDescription(): string {
    const label = currentSchedule().label;
    const act = currentSchedule().activity;

    if (label === "深夜") {
        return `你正躺在她身边/坐在床边，她刚刚睡着（${act}）。夜深了，房间里很安静，只有她均匀的呼吸声。`;
    }
    if (label === "清晨") {
        return `你们刚起床不久，她在${act}。房间里还有清晨的光，气氛懒洋洋的。`;
    }
    if (label === "出门") {
        return `你们一起走在上学的路上，她${act}。街上行人不多，你们并排走着。`;
    }
    if (label === "早自习") {
        return `你们在教室里并排坐着，${act}。周围有同学在读书，你们压低声音说话。`;
    }
    if (label.includes("课")) {
        return `你们在教室里（她${act}）。周围有老师和同学，你们只能压低声音、偷偷说小话。`;
    }
    if (label === "课间") {
        return `课间十分钟，你们在教室里/走廊上，她${act}。周围同学来来往往。`;
    }
    if (label === "午休") {
        return `午休时间，你们坐在一起吃饭，她${act}。午后的阳光透过窗户照进来。`;
    }
    if (label === "放学") {
        return `放学了，你们在图书馆，她${act}。周围很安静，适合说悄悄话。`;
    }
    if (label === "傍晚") {
        return `你们在便利店里（她在这里打工），她${act}。偶尔有顾客进来，她得先招呼客人。`;
    }
    if (label === "晚上") {
        return `晚上，你们在她住的地方，她${act}。房间里只有你们两个人，气氛放松。`;
    }
    if (label === "睡前") {
        return `睡前，你们在她住的地方，她${act}。灯已经调暗了，你们轻声说着话。`;
    }
    return `你们在一起，她正在${act}。`;
}

// 主角此刻位置
export function herLocation(): string {
    const label = currentSchedule().label;

    if (label === "放学") return "图书馆";
    if (label === "傍晚") return "打工的便利店";
    if (label === "晚上" || label === "睡前") return "她住的地方";
    if (label === "清晨" || label === "出门") return "在上学路上";
    if (label === "深夜") return "她家里（睡着了）";
    return "学校";
}

// ============ 格式化 ============

export function fmtVirtualTime(): string {
    const d = new Date(store.virtualMs);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export function fmtVirtualDate(): string {
    const d = new Date(store.virtualMs);
    return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEKDAYS[d.getDay()]}`;
}

// ============ 时间操控 ============

export function setTimeRate(rate: number) {
    store.timeRate = Math.max(RATE_MIN, Math.min(RATE_MAX, rate));
    saveState();
}

export function setVirtualTime(day: number, hhmm: string) {
    const [h, m] = hhmm.split(":").map(Number);
    if (!Number.isFinite(day) || day < 1 || !Number.isFinite(h) || !Number.isFinite(m)) return;

    const oldDay = store.dayIndex;
    const oldIdx = store.scheduleIndex;
    store.virtualMs = store.dayBaseMs + (day - 1) * 86400000 + (h * 60 + m) * 60000;
    store.scheduleIndex = scheduleIndexFor(store.virtualMs);
    store.dayIndex = currentDayIndex();

    if (oldDay !== store.dayIndex) dayChangeHandler?.(oldDay);

    saveState();
    updateScheduleUI();
    // 时段变化也通知（手动改时间 = 时段切换：醒来送达/在场变化等依赖它）
    if (oldIdx !== store.scheduleIndex) slotChangeHandler?.();
}

export function setStartDate(iso: string) {
    const d = new Date(iso + "T00:00:00");
    if (Number.isNaN(d.getTime())) return;

    const offset = store.virtualMs - store.dayBaseMs;
    store.dayBaseMs = d.setHours(0, 0, 0, 0);
    store.virtualMs = store.dayBaseMs + offset;
    store.scheduleIndex = scheduleIndexFor(store.virtualMs);
    store.dayIndex = currentDayIndex();
    saveState();
    updateScheduleUI();
}

export function jumpToToday() {
    const now = new Date();
    setVirtualTime(1, `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`);
}

// ============ 时钟循环 ============

export function tickClock() {
    const now = Date.now();
    const dt = Math.max(0, now - lastRealMs);
    lastRealMs = now;
    store.virtualMs += dt * store.timeRate;

    const idx = scheduleIndexFor(store.virtualMs);
    const day = currentDayIndex();

    if (day !== store.dayIndex) {
        dayChangeHandler?.(store.dayIndex);
        store.dayIndex = day;
    }

    if (idx !== store.scheduleIndex) {
        store.scheduleIndex = idx;
        saveState();
        slotChangeHandler?.();
    }

    randomMomentHook?.();
}

export function startClock() {
    clearInterval(clockTimer);
    lastRealMs = Date.now();
    clockTimer = window.setInterval(tickClock, 1000);
}

export function updateScheduleUI() {
    const slot = currentSchedule();
    (document.getElementById("clock-time")!).textContent = fmtVirtualTime();
    (document.getElementById("clock-date")!).textContent = fmtVirtualDate();
    (document.getElementById("clock-label")!).textContent = slot.label;
    (document.getElementById("clock-activity")!).textContent = slot.activity;
    (document.getElementById("clock-day")!).textContent = `第 ${currentDayIndex()} 天`;

    for (const btn of document.querySelectorAll<HTMLElement>(".rate-btn")) {
        const rate = parseFloat(btn.dataset.rate!);
        btn.classList.toggle("active", rate === store.timeRate);
    }
}

// 时段切换：她可能主动开口（由手头的事引发）
export function onSlotChanged() {
    const slot = currentSchedule();

    let chance = slot.speakChance;
    if (aiState.joy > 65 || aiState.sadness > 65 || aiState.anger > 55) chance = Math.min(1, chance + 0.3);

    const hasChatCapability = !!localStorage.getItem("deepseek-key");

    if (slot.speakChance > 0 && proactiveEnabled && hasChatCapability && Math.random() < chance) {
        // 统一收口：等用户回复时不再主动开口（防止连续轰炸）
        tryProactiveSpeak(
            `（现在是${fmtVirtualTime()}${slot.label}。你手头正在做的事：${slot.activity}。基于这件事，主动和对方说一句话——可以分享、吐槽、求助，或者继续手头的事顺口说起。不要没话找话。）`,
        );
    }
}

// 按时间段的主动开口文案（随机选，不固定循环）
export const PROACTIVE_BY_LABEL: Record<string, string[]> = {
    清晨: ["唔……再眯五分钟……（其实已经醒了）", "闹钟响第三次了，好烦。", "（翻了个身）今天星期几来着…"],
    出门: ["早。今天的地铁挤死了……", "喂，你到学校了吗？", "路上看到只超胖的猫，可惜没拍下来。", "昨晚没睡好，困死了。"],
    早自习: ["（小声）作业借我抄一下，昨晚打工没写。", "老师怎么还没来……", "（打哈欠）早自习好难熬。"],
    课间: ["好困……去小卖部吗？", "喂，这道题你听懂了吗？", "你看窗外，那朵云像不像鲸鱼。", "刚才广播放的歌，你听到了吗？"],
    午休: ["午休了，去食堂吗？", "今天便当做多了，分你一点。", "你要不要听桃香的新歌？我刚好带着耳机。", "食堂今天有炸鸡，我看到了！"],
    放学: ["我待会去图书馆，你来吗？", "今天值日，帮我一下嘛。", "一起去车站？", "图书馆窗边的位置今天没人抢。"],
    傍晚: ["（打工间隙）刚才来了个超难缠的客人……", "货架终于摆完了，累死。", "（便利店）等下下班，要不要给你带个关东煮？"],
    晚上: ["作业好多……你写了吗？", "我循环了一晚上《空之箱》，根本停不下来。", "（消息）你睡了吗？", "刚洗完澡，头发还没干。"],
    睡前: ["明天又要早起……晚安。", "（翻来覆去）睡不着，你陪我聊两句？"],
};

export function proactiveLine(): string {
    const label = currentSchedule().label;
    const pool = PROACTIVE_BY_LABEL[label] ?? PROACTIVE_BY_LABEL["课间"]!;
    return pool[Math.floor(Math.random() * pool.length)]!;
}
