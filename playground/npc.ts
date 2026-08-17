// npc.ts —— 支线 NPC 系统：独立人格、关系、记忆、作息、在场状态
// 设计原则：用户↔主角是绝对核心；NPC 是"世界里的其他人"——低频介入、有独立生活。
// NPC 不维护完整 38 维，只维护：情绪层子集 + 关系 + 记忆 + 作息 + 位置/活动。

import { clamp, DIMENSIONS } from "./state";

// ============ 类型 ============

export type NpcEmotionKey = "joy" | "sadness" | "anger" | "shyness" | "jealousy" | "loneliness" | "anxiety" | "fatigue";

export interface NpcScheduleEntry {
    time: string;       // "HH:MM" 起点
    label: string;      // 时段名
    activity: string;   // 在做什么
    location: string;   // 在哪
}

export interface NpcProfile {
    id: string;          // 唯一 id（存档键）
    name: string;        // 显示名
    title: string;       // 一句话身份（同班同学/社团朋友…）
    avatar: string;      // emoji 头像
    personality: string; // 性格核心（prompt 用）
    background: string;  // 背景
    speechStyle: string; // 说话风格
    likes: string;
    dislikes: string;
    relationToUser: number;   // 初始对用户好感 0-100
    relationToMain: number;   // 初始对主角好感 0-100
    schedule: NpcScheduleEntry[];
    keywords: string[];       // 触发关键词（提到她时介入概率上升）
    meetLocation: string;     // 常见出没地点（与主角交集）
    goal?: string | null;     // 她自己的小目标/心事（推动剧情用）
}

export interface NpcState {
    profile: NpcProfile;
    // 简化情感：只有情绪层关键维度（不维护完整 38 维，节省计算）
    emotion: Record<NpcEmotionKey, number>;
    // 与主角/用户的关系（独立保存）
    relToMain: number;
    relToUser: number;
    // 记忆：只有她真正知道的事（信息边界核心）
    knownFacts: string[];
    // 与主角的关系事件（她记得的互动）
    history: string[];
    // 当前虚拟时间下的作息状态
    location: string;
    activity: string;
    label: string;
    // 在场状态：是否正在当前对话场景中
    present: boolean;
    // 上次参与（虚拟时间戳），用于冷却
    lastActiveAt: number;
    // 她自己的小目标/心事（推动剧情用）
    goal: string | null;
}

// ============ 初始 NPC ============

export const NPCS: NpcProfile[] = [
    {
        id: "xiaoyu",
        name: "小雨",
        title: "同班同学，坐在你前排",
        avatar: "🌧️",
        personality: "开朗爱笑、有点八卦、热心肠，跟谁都聊得来，但心里也有细腻的一面。和主角关系很好，经常打趣主角和你。",
        background: "和主角从高一就同班，是主角为数不多的好朋友之一。知道主角不少事，会替主角说话。",
        speechStyle: "语气活泼，爱用语气词和感叹号，喜欢打趣人，偶尔会突然关心起你来。",
        likes: "奶茶、八卦、放学一起走",
        dislikes: "被人无视、数学课",
        relationToUser: 35,
        relationToMain: 75,
        schedule: [
            { time: "00:00", label: "深夜", activity: "睡了", location: "家" },
            { time: "07:00", label: "清晨", activity: "被闹钟叫醒，赖床", location: "家" },
            { time: "07:20", label: "出门", activity: "在上学路上，买了杯豆浆", location: "上学路上" },
            { time: "07:40", label: "早自习", activity: "在教室和同学聊天", location: "学校" },
            { time: "08:45", label: "上课", activity: "在听课，偷偷传纸条", location: "学校" },
            { time: "12:00", label: "午休", activity: "和同学一起吃午饭", location: "学校食堂" },
            { time: "13:30", label: "上课", activity: "在听课，有点犯困", location: "学校" },
            { time: "16:00", label: "放学", activity: "去社团活动", location: "学校" },
            { time: "17:30", label: "傍晚", activity: "回家路上", location: "回家路上" },
            { time: "18:30", label: "晚上", activity: "在家写作业、刷手机", location: "家" },
            { time: "22:30", label: "睡前", activity: "洗漱准备睡觉", location: "家" },
        ],
        keywords: ["小雨", "前排", "八卦", "奶茶", "社团"],
        meetLocation: "学校",
        goal: "想撮合你和主角，最近老想找机会打趣你们俩",
    },
    {
        id: "xiaomei",
        name: "小美",
        title: "隔壁班女生，图书馆常客",
        avatar: "🌸",
        personality: "安静、温柔、有点书卷气，说话轻声细语，偶尔有点天然呆。对主角有好感但很含蓄。",
        background: "和主角在图书馆认识的，会一起自习。跟你不算熟，但因为主角的关系偶尔会碰见。",
        speechStyle: "说话慢条斯理、轻轻柔柔的，爱用省略号，偶尔冒出一句有点呆的话。",
        likes: "书、咖啡、雨天",
        dislikes: "吵闹的地方、被人催",
        relationToUser: 20,
        relationToMain: 50,
        schedule: [
            { time: "00:00", label: "深夜", activity: "睡了", location: "家" },
            { time: "07:00", label: "清晨", activity: "起床看会儿书", location: "家" },
            { time: "07:30", label: "出门", activity: "在去学校的路上", location: "上学路上" },
            { time: "08:00", label: "早自习", activity: "在隔壁班早读", location: "学校" },
            { time: "12:00", label: "午休", activity: "在图书馆看书", location: "图书馆" },
            { time: "16:00", label: "放学", activity: "在图书馆自习", location: "图书馆" },
            { time: "18:00", label: "傍晚", activity: "回家路上，买了杯咖啡", location: "回家路上" },
            { time: "19:00", label: "晚上", activity: "在家看书、练字", location: "家" },
            { time: "22:30", label: "睡前", activity: "准备睡觉", location: "家" },
        ],
        keywords: ["小美", "图书馆", "隔壁班", "书", "自习"],
        meetLocation: "图书馆",
        goal: "想多了解主角，但一直没找到合适的机会",
    },
];

// ============ NPC 状态管理 ============

// 场景化：把 NPC 原型里的"学校"词汇替换为场景配置（创建角色后 NPC 属于当前世界）
// 保留人格/说话风格/好感等性格内核，只替换身份与地点
export function applySceneToProfile(profile: NpcProfile, scene: { place: string; others: string; routine: string }): NpcProfile {
    const p = { ...profile, schedule: profile.schedule.map((e) => ({ ...e })) };
    const place = scene.place;
    const others = scene.others;

    // 地点/身份词汇替换
    const replaceWords = (t: string) =>
        t
            .replace(/同班同学/g, `${others}，和你挺熟`)
            .replace(/隔壁班女生/g, `在${place}认识的女生`)
            .replace(/图书馆常客/g, `${place}常客`)
            .replace(/上学路上/g, `去${place}的路上`)
            .replace(/学校食堂/g, place)
            .replace(/教室|隔壁班/g, place)
            .replace(/图书馆/g, place)
            .replace(/学校/g, place);

    p.title = replaceWords(p.title);
    p.background = replaceWords(p.background);
    p.likes = replaceWords(p.likes);
    p.dislikes = replaceWords(p.dislikes);
    p.goal = replaceWords(p.goal ?? "");
    p.schedule = p.schedule.map((e) => ({ ...e, activity: replaceWords(e.activity), location: replaceWords(e.location) }));
    p.keywords = p.keywords.map((k) => replaceWords(k)).filter((k, i, arr) => arr.indexOf(k) === i);
    p.meetLocation = replaceWords(p.meetLocation);

    return p;
}

// 每档 NPC 情感初始值（复用 38 维的情感基线风格，但只取关键情绪）
function initEmotion(): Record<NpcEmotionKey, number> {
    return { joy: 55, sadness: 10, anger: 5, shyness: 30, jealousy: 10, loneliness: 20, anxiety: 15, fatigue: 15 };
}

export function createNpcState(profile: NpcProfile): NpcState {
    return {
        profile,
        emotion: initEmotion(),
        relToMain: profile.relationToMain,
        relToUser: profile.relationToUser,
        knownFacts: [],
        history: [],
        location: profile.schedule[0]!.location,
        activity: profile.schedule[0]!.activity,
        label: profile.schedule[0]!.label,
        present: false,
        lastActiveAt: 0,
        goal: profile.goal ?? null,
    };
}

// 根据虚拟时间计算 NPC 当前所处作息（复用 time 的时段概念，但用 NPC 自己的表）
export function npcScheduleAt(npc: NpcState, virtualMs: number, dayBaseMs: number): NpcScheduleEntry {
    const d = new Date(virtualMs);
    const mins = d.getHours() * 60 + d.getMinutes();
    let cur = npc.profile.schedule[0]!;
    for (const s of npc.profile.schedule) {
        const [h, m] = s.time.split(":").map(Number);
        if (mins >= h! * 60 + m!) cur = s;
        else break;
    }
    return cur;
}

// 更新 NPC 到当前虚拟时间的位置/活动
export function updateNpcSchedule(npc: NpcState, virtualMs: number, dayBaseMs: number) {
    const s = npcScheduleAt(npc, virtualMs, dayBaseMs);
    npc.location = s.location;
    npc.activity = s.activity;
    npc.label = s.label;
}

// NPC 情感变化（简化：只调关键情绪维，不调完整 38 维回归）
export function applyNpcDelta(npc: NpcState, delta: Record<string, number | undefined>) {
    for (const k of Object.keys(npc.emotion) as NpcEmotionKey[]) {
        const d = delta[k];
        if (typeof d === "number") {
            npc.emotion[k] = clamp(npc.emotion[k] + d);
        }
        // 轻回归到中间值（情绪会自然平复）
        npc.emotion[k] += (50 - npc.emotion[k]) * 0.05;
    }
    npc.relToMain = clamp(npc.relToMain + (delta.relToMain ?? 0));
    npc.relToUser = clamp(npc.relToUser + (delta.relToUser ?? 0));
}

// NPC 知道某事（信息传播的唯一入口）
export function npcLearn(npc: NpcState, fact: string) {
    const f = fact.trim().slice(0, 60);
    if (!f || npc.knownFacts.includes(f)) return;
    npc.knownFacts.push(f);
    if (npc.knownFacts.length > 20) npc.knownFacts = npc.knownFacts.slice(-20);
}

// NPC 情感 → 一句话描述（prompt 用）
export function describeNpcMood(npc: NpcState): string {
    const parts: string[] = [];
    const e = npc.emotion;
    if (e.joy > 60) parts.push("心情很好");
    if (e.sadness > 45) parts.push("有点难过");
    if (e.anger > 45) parts.push("有点不高兴");
    if (e.shyness > 50) parts.push("有点害羞");
    if (e.jealousy > 40) parts.push("有点吃醋");
    if (e.loneliness > 45) parts.push("觉得有点孤单");
    if (e.anxiety > 45) parts.push("有些不安");
    if (e.fatigue > 50) parts.push("有点累");
    return parts.join("，") || "心情平稳";
}

// 从 DIMENSIONS 导出 NpcEmotionKey 便于类型对齐（保留引用避免未使用告警）
export const NPC_EMOTION_DIMS = DIMENSIONS.filter((d) =>
    ["joy", "sadness", "anger", "shyness", "jealousy", "loneliness", "anxiety", "fatigue"].includes(d.key),
).map((d) => d.key);
