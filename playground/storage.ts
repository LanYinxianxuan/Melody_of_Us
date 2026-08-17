// storage.ts —— 数据层：多存档槽位、持久化数据的集中管理与存取
// 其他模块（time/story/chat/menu）都从这里读写持久化数据。

import { aiState, INITIAL_STATE } from "./state";
import { NPCS, createNpcState, applySceneToProfile, type NpcState } from "./npc";

// ============ 槽位 ============

// 存档槽位：URL ?slot=N；无参数时用上次的槽位；?new=1 清空该槽开新档
const slotParams = new URLSearchParams(location.search);
export const currentSlot = Math.max(
    1,
    Math.min(9, parseInt(slotParams.get("slot") ?? localStorage.getItem("melai-current-slot") ?? "1", 10) || 1),
);

if (slotParams.get("new") === "1") {
    localStorage.removeItem(`melai-state-${currentSlot}`);
}

localStorage.setItem("melai-current-slot", String(currentSlot));

export const SAVE_KEY = `melai-state-${currentSlot}`;
export const CHAR_KEY = `melai-character-${currentSlot}`;

// 旧单档数据迁移到槽位 1
if (currentSlot === 1) {
    if (!localStorage.getItem(`melai-state-1`) && localStorage.getItem("melai-state")) {
        localStorage.setItem(`melai-state-1`, localStorage.getItem("melai-state")!);
        localStorage.removeItem("melai-state");
    }
    if (!localStorage.getItem(`melai-character-1`) && localStorage.getItem("melai-character")) {
        localStorage.setItem(`melai-character-1`, localStorage.getItem("melai-character")!);
        localStorage.removeItem("melai-character");
    }
}

// ============ 持久化数据 ============

export interface StoryEvent {
    day: number;
    text: string;
}

export interface HistoryEntry {
    role: "user" | "assistant";
    content: string;
    ts?: number;
}

export interface DayJournal {
    day: number;
    summary: string;
}

// 场景配置：角色创建向导时询问"你们在哪里生活/她平时做什么"
// 所有"她白天在哪、忙什么、周围是谁"都由场景驱动，不再写死学校
export interface SceneConfig {
    name: string;        // 场景名（用户填的自由描述，如"海边小镇的咖啡店"）
    place: string;       // 她白天待的场所（学校/咖啡店/公司/工作室…）
    routine: string;     // 她平时做的事（上课/冲咖啡招呼客人/写代码/排练…）
    others: string;      // 她身边的人（同学/顾客/同事/乐队的伙伴…）
    busyLabel: string;   // 忙时段标签（上课/上班/开店/排练…）
    restLabel: string;   // 休息时段标签（课间/休息/空闲…）
}

// 默认场景（兼容旧存档/未设置）：校园
export const DEFAULT_SCENE: SceneConfig = {
    name: "学校",
    place: "学校",
    routine: "上课",
    others: "同学",
    busyLabel: "上课",
    restLabel: "课间",
};

// 所有需要随存档持久化的可变数据集中在这里（模块间通过 store 读写，避免 import 重绑定问题）
export const store = {
    turnCount: 0,
    storyEvents: [] as StoryEvent[],
    storyProgress: 0,
    chatHistory: [] as HistoryEntry[],
    journal: [] as DayJournal[],
    activeThread: null as string | null,
    scheduleIndex: -1,
    timeRate: 1,
    virtualMs: Date.now(),
    dayBaseMs: new Date().setHours(0, 0, 0, 0),
    dayIndex: 1,
    // 她的长期记忆（跨天/跨对话记住的重要事情）
    memories: [] as string[],
    // 用户最后一次回复：真实时间戳 + 虚拟时间戳（用于"被冷落"反应）
    lastReplyRealAt: Date.now(),
    lastReplyVirtualAt: Date.now(),
    // 上次触发"被冷落"反应的时刻（避免短时间重复轰炸）
    lastNeglectAt: 0,
    lastNeglectRealAt: 0,
    lastNeglectLevel: 0,
    // 支线 NPC 世界（主角之外的其他角色）
    npcs: {} as Record<string, NpcState>,
    // 当前在场者（主角之外的参与者 id 列表，用于主角感知在场变化）
    presentNpcs: [] as string[],
    // 多人模式开关：默认关闭（NPC 动态介入不启用；主角 prompt 也不注入在场者）
    npcEnabled: false,
    // 场景配置（创建角色时询问；默认校园兼容旧存档）
    scene: { ...DEFAULT_SCENE } as SceneConfig,
    // 用户当前方位（家 / 学校 / 路上 / 打工处）——决定面对面还是手机聊天
    userLocation: "家",
    // 深夜发出去、她睡着没看到的消息（等她醒来再送达）
    pendingOvernight: [] as string[],
};

// ============ 存取 ============

export function saveState() {
    try {
        localStorage.setItem(
            SAVE_KEY,
            JSON.stringify({
                aiState,
                ...store,
                savedAt: Date.now(),
            }),
        );
    } catch {
        /* ignore */
    }
}

export function loadState(): boolean {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (!data?.aiState) return false;

        Object.assign(aiState, INITIAL_STATE, data.aiState);

        store.turnCount = data.turnCount ?? 0;
        store.storyProgress = data.storyProgress ?? 0;
        store.storyEvents = Array.isArray(data.storyEvents)
            ? data.storyEvents.map((e: unknown) => (typeof e === "string" ? { day: 1, text: e } : e))
            : [];
        store.chatHistory = Array.isArray(data.chatHistory) ? data.chatHistory : [];
        store.journal = Array.isArray(data.journal) ? data.journal : [];
        store.activeThread = typeof data.activeThread === "string" ? data.activeThread : null;
        store.scheduleIndex = typeof data.scheduleIndex === "number" ? data.scheduleIndex : -1;
        store.timeRate = typeof data.timeRate === "number" ? data.timeRate : 1;
        store.virtualMs = typeof data.virtualMs === "number" ? data.virtualMs : Date.now();
        store.dayBaseMs = typeof data.dayBaseMs === "number"
            ? new Date(data.dayBaseMs).setHours(0, 0, 0, 0)
            : new Date().setHours(0, 0, 0, 0);
        store.dayIndex = typeof data.dayIndex === "number" ? data.dayIndex : 1;
        store.memories = Array.isArray(data.memories) ? data.memories.slice(-30) : [];
        store.lastReplyRealAt = typeof data.lastReplyRealAt === "number" ? data.lastReplyRealAt : Date.now();
        store.lastReplyVirtualAt = typeof data.lastReplyVirtualAt === "number" ? data.lastReplyVirtualAt : Date.now();
        store.lastNeglectAt = typeof data.lastNeglectAt === "number" ? data.lastNeglectAt : 0;
        store.lastNeglectRealAt = typeof data.lastNeglectRealAt === "number" ? data.lastNeglectRealAt : 0;
        store.lastNeglectLevel = typeof data.lastNeglectLevel === "number" ? data.lastNeglectLevel : 0;

        // 场景：旧存档没有 → 默认校园；有 → 合并（防止新增字段缺失）
        // 必须在 NPC 之前加载（NPC 按场景生成身份/地点）
        const savedScene = data.scene && typeof data.scene === "object" ? data.scene : {};
        store.scene = {
            ...DEFAULT_SCENE,
            ...savedScene,
        };

        // 支线 NPC：旧存档没有 → 自动初始化默认 NPC；有 → 合并（防止新增 NPC 缺失）
        // 一律按当前场景生成（身份/作息/地点随场景变化）
        const savedNpcs = data.npcs && typeof data.npcs === "object" ? data.npcs : {};
        store.npcs = {};
        for (const base of NPCS) {
            const profile = applySceneToProfile(base, store.scene);
            const saved = savedNpcs[base.id];
            if (saved && saved.profile?.id) {
                // 保留存档中的状态，但用最新 profile 定义补齐字段
                store.npcs[base.id] = { ...createNpcState(profile), ...saved, profile };
                // 确保关键字段存在
                if (!store.npcs[base.id]!.emotion) store.npcs[base.id]!.emotion = createNpcState(profile).emotion;
                if (!Array.isArray(store.npcs[base.id]!.knownFacts)) store.npcs[base.id]!.knownFacts = [];
                if (!Array.isArray(store.npcs[base.id]!.history)) store.npcs[base.id]!.history = [];
            } else {
                store.npcs[base.id] = createNpcState(profile);
            }
        }
        store.presentNpcs = Array.isArray(data.presentNpcs) ? data.presentNpcs : [];
        store.npcEnabled = typeof data.npcEnabled === "boolean" ? data.npcEnabled : false; // 旧存档默认关闭
        store.userLocation = ["家", "学校", "路上", "打工处"].includes(data.userLocation)
            ? data.userLocation
            : "家";
        store.pendingOvernight = Array.isArray(data.pendingOvernight) ? data.pendingOvernight : [];

        return true;
    } catch {
        return false;
    }
}

// 初始化默认 NPC 世界（无存档时调用）
export function initNpcWorld() {
    store.npcs = {};
    for (const base of NPCS) {
        // 按当前场景生成 NPC（身份/作息/地点随场景变化）
        store.npcs[base.id] = createNpcState(applySceneToProfile(base, store.scene));
    }
    store.presentNpcs = [];
}

export function clearSlot(slot: number) {
    localStorage.removeItem(`melai-state-${slot}`);
    localStorage.removeItem(`melai-character-${slot}`);
}

// 菜单页用：读取任意槽位的摘要数据
export function loadSlotRaw(slot: number): Record<string, unknown> | null {
    try {
        const raw = localStorage.getItem(`melai-state-${slot}`);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (!data?.aiState) return null;
        return data;
    } catch {
        return null;
    }
}

// 菜单页用：读取任意槽位的角色名
export function loadSlotCharacterName(slot: number): string {
    try {
        const raw = localStorage.getItem(`melai-character-${slot}`);
        if (raw) {
            const c = JSON.parse(raw);
            if (c?.name) return c.name;
        }
    } catch {
        /* ignore */
    }
    return "仁菜（Nina）";
}
