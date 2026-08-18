// time.ts —— 时间系统：真实时钟 + 可调速率 + 作息表 + 在场判定
// 依赖 storage（时间变量 + saveState）；跨天/时段切换通过回调通知外部。
// 作息表由【场景配置】驱动（创建角色时询问），不再写死学校

import { store, saveState, type SceneConfig } from "./storage";

// ============ 作息表（场景驱动） ============

export interface ScheduleEntry {
    time: string;
    label: string;
    activity: string;
    speakChance: number;
    busy: boolean; // 该时段她是否"正忙"（说话要小声/简短）
}

// 场景 → 一天的作息：时段结构固定，活动内容按场景生成
export function getSchedule(): ScheduleEntry[] {
    const s: SceneConfig = store.scene;
    const busyL = s.busyLabel; // 上课/上班/开店/排练…
    const restL = s.restLabel; // 课间/休息/空闲…

    return [
        { time: "00:00", label: "深夜", activity: "已经睡着了", speakChance: 0, busy: true },
        { time: "06:30", label: "清晨", activity: "被闹钟吵醒，赖在床上不想起", speakChance: 0.2, busy: false },
        { time: "07:10", label: "出门", activity: `在去${s.place}的路上，耳机里放着歌`, speakChance: 0.25, busy: false },
        { time: "07:30", label: "开工", activity: `到了${s.place}，准备开始今天`, speakChance: 0.15, busy: true },
        { time: "08:45", label: busyL, activity: `在${s.place}${s.routine}，偶尔走神`, speakChance: 0.08, busy: true },
        { time: "09:45", label: restL, activity: `歇一会儿，${s.others}里有人跟你搭了两句`, speakChance: 0.45, busy: false },
        { time: "10:00", label: busyL, activity: `继续${s.routine}，偶尔走神`, speakChance: 0.08, busy: true },
        { time: "11:00", label: restL, activity: "抽空喝口水，放松一下", speakChance: 0.45, busy: false },
        { time: "11:15", label: busyL, activity: "在忙，肚子饿得咕咕叫", speakChance: 0.1, busy: true },
        { time: "12:15", label: "午休", activity: "休息吃饭，耳机分了一只耳朵", speakChance: 0.6, busy: false },
        { time: "13:30", label: busyL, activity: `下午继续${s.routine}`, speakChance: 0.08, busy: true },
        { time: "14:30", label: restL, activity: "靠在椅子上小憩一会儿", speakChance: 0.4, busy: false },
        { time: "14:45", label: busyL, activity: "忙着收尾今天的事", speakChance: 0.08, busy: true },
        { time: "15:45", label: "收工", activity: `忙完今天的${s.routine}`, speakChance: 0.55, busy: false },
        { time: "17:30", label: "傍晚", activity: "在回家的路上，想着今晚做什么", speakChance: 0.5, busy: false },
        { time: "20:00", label: "晚上", activity: "在自己的房间里放松，放着喜欢的歌", speakChance: 0.5, busy: false },
        { time: "22:30", label: "睡前", activity: "洗漱完躺在床上，还没睡着", speakChance: 0.55, busy: false },
    ];
}

// ============ 时间常量与状态 ============

export const TIME_RATES = [0.5, 1, 10, 30, 60, 1440];
export const RATE_MIN = 0.01;
export const RATE_MAX = 100000;
export const FIRST_MEETING_HHMM = "08:00"; // 第一次相遇（新游戏/重置起点）

let lastRealMs = Date.now();
let clockTimer = 0;

export let proactiveEnabled = true;

// 控制"主动开口"开关（新存档初始化/向导期间静默，避免角色抢话）
export function setProactiveEnabled(v: boolean) {
    proactiveEnabled = v;
}

// 外部回调（chat.ts 注册）
let slotChangeHandler: (() => void) | null = null;
let dayChangeHandler: ((oldDay: number) => void) | null = null;
let messageSender: ((text: string, opts?: { proactive?: boolean }) => void) | null = null;
let randomMomentHook: (() => void) | null = null;
// 角色关系回调（chat.ts 注入，避免 time ↔ character 循环依赖）
let relationGetter: (() => string) | null = null;
// 主动开口频率的“情绪/剧情动态系数”（chat.ts 注入 story.ts 的计算结果，避免 time ↔ story 循环依赖）
let proactiveDriveGetter: (() => number) | null = null;

export function setSlotChangeHandler(fn: () => void) { slotChangeHandler = fn; }
export function setDayChangeHandler(fn: (oldDay: number) => void) { dayChangeHandler = fn; }
export function setMessageSender(fn: (text: string, opts?: { proactive?: boolean }) => void) { messageSender = fn; }
export function setRandomMomentHook(fn: () => void) { randomMomentHook = fn; }
export function setRelationGetter(fn: () => string) { relationGetter = fn; }
export function setProactiveDriveGetter(fn: () => number) { proactiveDriveGetter = fn; }

// 关系阶段判断：是否"刚认识"（只有这时才说"第一次见面"）
// 恋人/青梅竹马/家人/朋友等已有关系 → 不是第一次见面
export function isFirstMeeting(): boolean {
    const rel = (relationGetter?.() ?? "").toLowerCase();
    // 明确已有亲密/熟悉关系 → 不是第一次见面
    if (/恋人|女朋友|男朋友|对象|老婆|老公|青梅竹马|家人|一起生活|同居|结婚|挚友|最好的朋友|多年/.test(rel)) return false;
    // 明确刚认识 → 是
    if (/刚认识|初识|陌生|第一次见|还不熟|刚见面|不了解/.test(rel)) return true;
    // 关系为空/中性（同桌/同学/朋友等）→ 默认已认识，不说第一次见面
    return false;
}

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
    if (awaitingReply) {
        console.log("[主动开口] 跳过：awaitingReply=true");
        return false;
    }
    if (now - lastProactiveAt < PROACTIVE_COOLDOWN_MS) {
        console.log(`[主动开口] 跳过：冷却中 (${Math.round((PROACTIVE_COOLDOWN_MS - (now - lastProactiveAt)) / 1000)}s)`);
        return false;
    }
    lastProactiveAt = now;
    awaitingReply = true;
    console.log("[主动开口] ✅ 发送消息");
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
    const schedule = getSchedule();
    const d = new Date(ms);
    const mins = d.getHours() * 60 + d.getMinutes();
    let idx = 0; // 默认深夜

    for (let i = 1; i < schedule.length; i++) {
        if (mins >= slotMinutes(schedule[i]!.time)) idx = i;
        else break;
    }

    return idx;
}

export function currentSchedule() {
    const schedule = getSchedule();
    const slot = schedule[store.scheduleIndex] ?? schedule[0]!;

    // 第一天开工时段：仅当你们"刚认识"时才是初次见面的特殊情境
    // （恋人/朋友/家人等已有关系 → 不写"第一次见面"，保持关系一致）
    if (store.dayIndex === 1 && slot.label === "开工" && isFirstMeeting()) {
        return { ...slot, activity: "第一天，你们第一次见面" };
    }

    return slot;
}

export function currentDayIndex(): number {
    return Math.floor((store.virtualMs - store.dayBaseMs) / 86400000) + 1;
}

// 她此刻是否在"工作/学习场所"（场景的忙碌时段：开工/忙/收工）
export function inSchool(): boolean {
    const s = currentSchedule();
    return s.busy && s.label !== "深夜";
}

// 深夜（00:00-06:30）：她睡着了
export function isDeepNight(): boolean {
    return currentSchedule().label === "深夜";
}

// 她此刻是否"正忙"（忙碌时段/深夜）：说话要小声、简短，不能像空闲时那样自在
export function isBusyNow(): boolean {
    const s = currentSchedule();
    return s.busy || s.label === "深夜";
}

// 面对面：你们始终在一起（用户是主角生活的一部分，不是隔着手机的网友）
// 方位 = 你们身处的场景（由她的作息决定），对话永远是面对面
export function faceToFace(): boolean {
    return true;
}

// 场景描述：你们此刻在一起、身处什么地方、她正在做什么（喂给 AI 的方位）
// 全部由场景配置驱动：place=她白天待的场所，others=身边的人
export function sceneDescription(): string {
    const slot = currentSchedule();
    const label = slot.label;
    const act = slot.activity;
    const s: SceneConfig = store.scene;
    const busyL = s.busyLabel;
    const restL = s.restLabel;

    if (label === "深夜") {
        return `你正躺在她身边/坐在床边，她刚刚睡着（${act}）。夜深了，房间里很安静，只有她均匀的呼吸声。`;
    }
    if (label === "清晨") {
        return `你们刚起床不久，她${act}。房间里还有清晨的光，气氛懒洋洋的。`;
    }
    if (label === "出门") {
        return `你们一起去${s.place}的路上，她${act}。路上行人不多，你们并排走着。`;
    }
    if (label === "开工") {
        return `你们到了${s.place}，她${act}。这里是她日常待的地方，周围有${s.others}。`;
    }
    if (label === busyL) {
        return `你们在${s.place}（她${act}）。周围有${s.others}，你们只能压低声音、偷偷说小话。`;
    }
    if (label === restL) {
        return `休息时间，你们在${s.place}歇一会儿，她${act}。周围${s.others}来来往往。`;
    }
    if (label === "午休") {
        return `休息吃饭时间，你们坐在一起，她${act}。午后的阳光透过窗户照进来。`;
    }
    if (label === "收工") {
        return `她忙完今天的${s.routine}了，你们在${s.place}待着。周围安静下来，适合说说话。`;
    }
    if (label === "傍晚") {
        return `傍晚，你们一起往回走，她${act}。街上渐渐亮起灯。`;
    }
    if (label === "晚上") {
        return `晚上，你们在她住的地方，她${act}。房间里只有你们两个人，气氛放松。`;
    }
    if (label === "睡前") {
        return `睡前，你们在她住的地方，她${act}。灯已经调暗了，你们轻声说着话。`;
    }
    return `你们在一起，她正在${act}。`;
}

// 主角此刻位置（由场景驱动）
export function herLocation(): string {
    const label = currentSchedule().label;
    const s: SceneConfig = store.scene;

    if (label === "收工" || label === "开工" || label === s.busyLabel || label === s.restLabel || label === "午休") return s.place;
    if (label === "傍晚") return "回家的路上";
    if (label === "晚上" || label === "睡前") return "她住的地方";
    if (label === "清晨" || label === "出门") return `去${s.place}的路上`;
    if (label === "深夜") return "她家里（睡着了）";
    return s.place;
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
    updateScheduleUI(); // 刷新倍率按钮 active 状态 + 时间显示
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

    // 每秒刷新时间显示（虚拟时间随时在走，UI 必须跟着走）
    updateScheduleUI();

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
    // 当前场景（具体地点 + 环境），供左侧面板显示
    const sceneEl = document.getElementById("clock-scene");
    if (sceneEl) sceneEl.textContent = `📍 ${sceneShort()}`;

    // 更新详细场景描述
    updateSceneUI();

    for (const btn of document.querySelectorAll<HTMLElement>(".rate-btn")) {
        const rate = parseFloat(btn.dataset.rate!);
        btn.classList.toggle("active", rate === store.timeRate);
    }
}

// 更新详细场景描述 UI
export function updateSceneUI() {
    const slot = currentSchedule();
    const label = slot.label;
    const s: SceneConfig = store.scene;
    const hour = new Date(store.virtualMs).getHours();

    // 场景标题
    const titleEl = document.getElementById("scene-title");
    if (titleEl) titleEl.textContent = getSceneTitle(label, s);

    // 地点
    const locationEl = document.getElementById("scene-location");
    if (locationEl) locationEl.textContent = getSceneLocation(label, s);

    // 氛围描述
    const atmosphereEl = document.getElementById("scene-atmosphere");
    if (atmosphereEl) atmosphereEl.textContent = getSceneAtmosphere(label, hour, s);

    // 天气
    const weatherEl = document.getElementById("scene-weather");
    if (weatherEl) {
        const textEl = weatherEl.querySelector(".scene-detail-text");
        if (textEl) textEl.textContent = getWeatherDescription(label, hour);
    }

    // 周围的人
    const peopleEl = document.getElementById("scene-people");
    if (peopleEl) {
        const textEl = peopleEl.querySelector(".scene-detail-text");
        if (textEl) textEl.textContent = getPeopleDescription(label, s);
    }

    // 环境声音
    const soundEl = document.getElementById("scene-sound");
    if (soundEl) {
        const textEl = soundEl.querySelector(".scene-detail-text");
        if (textEl) textEl.textContent = getSoundDescription(label, s);
    }

    // 光线
    const lightEl = document.getElementById("scene-light");
    if (lightEl) {
        const textEl = lightEl.querySelector(".scene-detail-text");
        if (textEl) textEl.textContent = getLightDescription(label, hour);
    }

    // 她正在做的事
    const activityEl = document.getElementById("scene-activity");
    if (activityEl) activityEl.textContent = `她正在${slot.activity.replace(/^你/, "").replace(/^正在/, "")}`;
}

function getSceneTitle(label: string, s: SceneConfig): string {
    if (label === "深夜") return "深夜·卧室";
    if (label === "清晨") return "清晨·起床";
    if (label === "出门") return "出门·路上";
    if (label === "开工") return `到达·${s.place}`;
    if (label === s.busyLabel) return `${label}·${s.place}`;
    if (label === s.restLabel) return `${label}·休息`;
    if (label === "午休") return "午休·用餐";
    if (label === "收工") return "收工·放松";
    if (label === "傍晚") return "傍晚·归途";
    if (label === "晚上") return "晚上·独处";
    if (label === "睡前") return "睡前·安静";
    return label;
}

function getSceneLocation(label: string, s: SceneConfig): string {
    if (label === "深夜" || label === "清晨" || label === "晚上" || label === "睡前") return "🏠 她住的地方";
    if (label === "出门" || label === "傍晚") return `🚶 去${s.place}的路上`;
    return `📍 ${s.place}`;
}

function getSceneAtmosphere(label: string, hour: number, s: SceneConfig): string {
    if (label === "深夜") return "万籁俱寂，只有窗外偶尔传来的虫鸣。月光透过窗帘洒在地上，房间里弥漫着淡淡的薰衣草香。";
    if (label === "清晨") return "晨光熹微，空气中带着一丝凉意。鸟儿在窗外啁啾，新的一天开始了。";
    if (label === "出门") return "街道上行人渐多，早餐店飘来阵阵香气。微风拂面，带着城市的气息。";
    if (label === "开工") return `${s.place}里渐渐热闹起来，大家都在准备开始新的一天。`;
    if (label === s.busyLabel) return `${s.place}里秩序井然，偶尔传来低声的交谈和翻书声。`;
    if (label === s.restLabel) return "短暂的休息时光，走廊里有人走动，教室里三三两两聚在一起聊天。";
    if (label === "午休") return "午后的阳光温暖而慵懒，食堂里飘来饭菜的香气。";
    if (label === "收工") return "一天的忙碌终于结束，${s.place}里渐渐安静下来。";
    if (label === "傍晚") return "夕阳西下，天边染上橙红色的晚霞。街灯次第亮起，城市披上温柔的光。";
    if (label === "晚上") return "夜幕降临，房间里灯光柔和。窗外是城市的万家灯火，宁静而温馨。";
    if (label === "睡前") return "夜深了，灯光调暗。整个世界都安静下来，只剩下彼此的呼吸声。";
    return "此刻的氛围刚刚好。";
}

function getWeatherDescription(label: string, hour: number): string {
    // 简单的天气模拟（可以根据实际需求扩展）
    if (label === "深夜") return "🌙 夜空晴朗，星光点点";
    if (label === "清晨") return "🌤 晨光温暖，微风轻拂";
    if (hour >= 6 && hour < 12) return "☀️ 上午阳光明媚";
    if (hour >= 12 && hour < 14) return "🌞 正午阳光强烈";
    if (hour >= 14 && hour < 18) return "⛅ 午后多云间晴";
    if (hour >= 18 && hour < 20) return "🌅 傍晚霞光满天";
    return "🌙 夜色已深";
}

function getPeopleDescription(label: string, s: SceneConfig): string {
    if (label === "深夜" || label === "晚上" || label === "睡前") return "只有你们两个人";
    if (label === "清晨") return "刚起床，周围很安静";
    if (label === "出门" || label === "傍晚") return "路上有零星行人";
    if (label === "开工" || label === s.busyLabel) return `周围有${s.others}`;
    if (label === s.restLabel) return `${s.others}来来往往`;
    if (label === "午休") return "食堂里人来人往";
    if (label === "收工") return "人渐渐散去";
    return "周围有人经过";
}

function getSoundDescription(label: string, s: SceneConfig): string {
    if (label === "深夜") return "寂静，偶尔的虫鸣和远处车辆声";
    if (label === "清晨") return "鸟鸣声，远处的车流声";
    if (label === "出门" || label === "傍晚") return "脚步声，车辆行驶声";
    if (label === "开工" || label === s.busyLabel) return "翻书声，低声交谈";
    if (label === s.restLabel) return "欢笑声，聊天声";
    if (label === "午休") return "餐具碰撞声，交谈声";
    if (label === "收工") return "收拾东西的声音";
    if (label === "晚上" || label === "睡前") return "轻柔的音乐，空调的低鸣";
    return "周围的环境音";
}

function getLightDescription(label: string, hour: number): string {
    if (label === "深夜") return "月光透过窗帘，房间昏暗";
    if (label === "清晨") return "晨光从窗户洒入，柔和温暖";
    if (label === "出门" || label === "傍晚") return "自然光，街灯渐亮";
    if (hour >= 6 && hour < 18) return "明亮的自然光";
    if (label === "晚上") return "室内灯光，柔和温馨";
    if (label === "睡前") return "调暗的台灯，昏黄温暖";
    return "光线适中";
}

// 当前场景的精简描述（左侧面板"📍"行）：地点 + 周围环境
export function sceneShort(): string {
    const label = currentSchedule().label;
    const s: SceneConfig = store.scene;
    const act = currentSchedule().activity.replace(/^你/, "她").replace(/^正在/, "");

    if (label === "深夜") return `她住的地方 · 卧室，夜很安静，她刚睡着`;
    if (label === "清晨") return `她住的地方 · 清晨的光，刚醒`;
    if (label === "出门") return `去${s.place}的路上，并排走着`;
    if (label === "开工") return `${s.place} · 刚到，准备开始今天`;
    if (label === s.busyLabel) return `${s.place} · ${act}，周围有${s.others}`;
    if (label === s.restLabel) return `${s.place} · 休息时间，${s.others}来来往往`;
    if (label === "午休") return `${s.place} · 休息吃饭，午后的阳光`;
    if (label === "收工") return `${s.place} · 忙完了，周围安静下来`;
    if (label === "傍晚") return `回家的路上 · 街上亮起灯`;
    if (label === "晚上") return `她住的地方 · 只有你们两个人`;
    if (label === "睡前") return `她住的地方 · 灯调暗了，轻声说话`;
    return `${s.place} · ${act}`;
}

// 时段切换：她可能主动开口（由手头的事引发）
// 概率会随“情绪 + 剧情”动态调整：心情好/想你/剧情正热 → 更爱开口；疲惫/害羞/初识 → 更安静
export function onSlotChanged() {
    const slot = currentSchedule();

    const drive = proactiveDriveGetter?.() ?? 1;
    const chance = Math.max(0, Math.min(1, slot.speakChance * drive));

    const hasChatCapability = !!localStorage.getItem("deepseek-key");

    if (slot.speakChance > 0 && proactiveEnabled && hasChatCapability && Math.random() < chance) {
        // 统一收口：等用户回复时不再主动开口（防止连续轰炸）
        tryProactiveSpeak(
            `（现在是${fmtVirtualTime()}${slot.label}。你手头正在做的事：${slot.activity}。基于这件事，主动和对方说一句话——可以分享、吐槽、求助，或者继续手头的事顺口说起。不要没话找话。）`,
        );
    }
}

// 按时间段的主动开口文案（随机选，不固定循环）
// 忙碌/休息时段标签是场景化的（上课/上班/课间/休息…），用场景生成兜底
export const PROACTIVE_BY_LABEL: Record<string, string[]> = {
    清晨: ["唔……再眯五分钟……（其实已经醒了）", "闹钟响第三次了，好烦。", "（翻了个身）今天星期几来着…"],
    出门: ["早。今天路上人好多……", "喂，你到地方了吗？", "路上看到只超胖的猫，可惜没拍下来。", "昨晚没睡好，困死了。"],
    午休: ["休息啦，一起吃饭吗？", "今天带了好吃的，分你一点。", "你要不要听我最近循环的歌？我刚好带着耳机。", "刚看到个有意思的事，跟你说。"],
    收工: ["终于忙完了，累死。", "今天也辛苦啦，一起回去？", "忙完了，想找个地方坐坐。"],
    傍晚: ["（回家的路上）今天遇到个有意思的人……", "走累了，找个地方歇会儿？", "（消息）你晚饭吃什么？"],
    晚上: ["今天过得怎么样？", "我循环了一晚上的歌，根本停不下来。", "（消息）你睡了吗？", "刚洗完澡，头发还没干。"],
    睡前: ["明天又要早起……晚安。", "（翻来覆去）睡不着，你陪我聊两句？"],
};

export function proactiveLine(): string {
    const slot = currentSchedule();
    const label = slot.label;
    const s: SceneConfig = store.scene;

    // 忙碌时段（上课/上班/开店…）：用场景生成"忙里偷闲"的文案
    if (slot.busy && label !== "深夜") {
        const busyLines = [
            `（${label}间隙，小声）偷个空跟你说一句……${s.others}在附近，不能多说。`,
            `（${label}中，压低声音）现在不太方便，等会儿再跟你说。`,
            `（忙里偷闲）呼——${s.routine}好累，但是想到你心情就好点了。`,
        ];
        return busyLines[Math.floor(Math.random() * busyLines.length)]!;
    }

    const pool = PROACTIVE_BY_LABEL[label] ?? PROACTIVE_BY_LABEL["晚上"]!;
    return pool[Math.floor(Math.random() * pool.length)]!;
}
