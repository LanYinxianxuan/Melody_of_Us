// storage.ts —— 数据层：多存档槽位、持久化数据的集中管理与存取
// 其他模块（time/story/chat/menu）都从这里读写持久化数据。

import { aiState } from "./state";
import { NPCS, createNpcState, applySceneToProfile, type NpcState } from "./npc";
// 【P0-12】存档契约（纯函数，零 I/O）。形状与默认值的唯一真理源在 save-schema.ts，
// 本模块只负责「读 / 写 / 应用到 store」，不再自己定义形状或散落默认值。
import {
    SAVE_VERSION,
    migrateToCurrent,
    type SaveV1,
    type StoryEvent,
    type HistoryEntry,
    type DayJournal,
    type AgendaItem,
    type AgendaDay,
    type SceneConfig,
} from "./save-schema";

// 保持既有 import 路径可用（character.ts / time.ts 等从 "./storage" 取这些类型）
export type { StoryEvent, HistoryEntry, DayJournal, AgendaItem, AgendaDay, SceneConfig, SaveV1 };
export { SAVE_VERSION };
// 类型导入（编译期擦除，避免 storage↔mind 运行时循环依赖）
import type { UserMindState, AiMindState, RelMindState } from "./mind";

// ============ 槽位（【P0-13】单一真理源） ============
//
// 缺陷原貌：同一次运行里有**三套**槽位解析并存 ——
//   · storage.ts 在此处解析一次并冻结为 currentSlot；
//   · ai.ts / tts.ts / director.ts / wizard.ts **每次调用都重新读** localStorage；
//   · menu.ts 又持有一份冻结副本 activeSlot。
// 三者对"当前槽位"可能得出不同答案。最典型的失效：用户直接打开 `chat.html?slot=3`
// （书签/外链），storage 认为槽位 3，而 getProviderConfig() 仍读 localStorage 里的旧值 →
// 读 A 槽的 Key/Model，却写 B 槽的存档。
//
// 收敛方式（G5）：**统一到本模块的两个入口**，二者共用同一套解析规则（URL 参数优先）：
//   · currentSlot      —— 冻结值，用于 key 构造（SAVE_KEY / CHAR_KEY 等）
//   · getActiveSlot()  —— 实时值。当前无生产消费者（读数与写数已统一到冻结值），
//     保留给"跨槽位操作"（如菜单页显式指定要配置的槽位）使用
// 因为有 URL 参数时两者必然一致，跨标签残留不会再造成分叉。

export const SLOT_MIN = 1;
export const SLOT_MAX = 9;
const SLOT_URL_PARAM = "slot";
export const CURRENT_SLOT_KEY = "melai-current-slot";
const SLOT_STORE_KEY = CURRENT_SLOT_KEY;

const slotParams = new URLSearchParams(location.search);

/** 槽位解析（唯一实现）：URL 参数优先，其次 localStorage，最后默认 1，并收敛到合法范围 */
function resolveSlot(): number {
    let raw: string | null = slotParams.get(SLOT_URL_PARAM);
    if (raw === null) {
        try {
            raw = localStorage.getItem(SLOT_STORE_KEY);
        } catch {
            raw = null;
        }
    }
    const parsed = parseInt(raw ?? "1", 10);
    return Math.max(SLOT_MIN, Math.min(SLOT_MAX, Number.isFinite(parsed) ? parsed : 1));
}

/** 冻结槽位（module 求值时确定；用于构造本页面的存储键） */
export const currentSlot = resolveSlot();

/**
 * 实时槽位（【P0-13】取代各处自行读 localStorage 的写法）。
 * 与 currentSlot 共用同一解析规则，因此有 URL 参数时二者必然相等 ——
 * 这正是消除"读 A 写 B"分叉的关键。
 */
export function getActiveSlot(): number {
    return resolveSlot();
}

/**
 * 槽位作用域键的唯一构造入口（【P0-13】）。
 * 取代散落各处的 `` `${prefix}-${slot}` `` 与 menu.ts 的本地 slotKey()。
 */
export function slotKey(prefix: string, slot: number = currentSlot): string {
    return `${prefix}-${slot}`;
}

// 槽位键前缀（集中声明，避免同一前缀在多处以字符串字面量重复出现）
export const KEY_PREFIX = {
    state: "melai-state",
    character: "melai-character",
    apikey: "apikey",
    provider: "provider",
    model: "model",
    customUrl: "custom-url",
    modelsCache: "models-cache",
    ttsEnabled: "melai-tts-enabled",
    ttsVoice: "melai-tts-voice",
    ttsApiKey: "melai-tts-apikey",
    ttsStyle: "melai-tts-style",
    ttsLang: "melai-tts-lang",
} as const;

// 【P0-11】?new=1 开新档。
//
// 缺陷原貌：这里曾经额外写一个 localStorage 标记 `melai-did-new-${slot}` 作为
// 「已清空过」的幂等守卫，而该标记只在「向导成功创建角色」时被删除
// （chat.ts 的 savedCallback）。于是用户点「新建」后在向导里点「取消」，
// 标记就永久留在该槽位上 —— 该槽此后再点「新建」时守卫命中、**不再清空旧档**，
// 用户以为在开新档，实际进了旧档。
//
// 为什么可以直接删掉这个标记：它声称要解决的问题并不存在 ——
// 紧随其后的 history.replaceState 已经把 ?new=1 从 URL 里移除，
// 刷新后 slotParams 不再含 new，本分支根本不会再次进入。
// 也就是说标记保护的「重复清空」在它生效的任何时刻都不会发生，
// 反过来它的存在却把一次清空变成了一道需要外部负责清理的持久状态。
// 现在清空动作与 URL 参数的消费在同一处完成，闭包内自洽，没有跨模块残留状态。
if (slotParams.get("new") === "1") {
    localStorage.removeItem(slotKey(KEY_PREFIX.state, currentSlot));
    localStorage.removeItem(slotKey(KEY_PREFIX.character, currentSlot));
}
// 无论是否命中 new=1，都从 URL 移除该参数，防止刷新再次触发
if (slotParams.has("new")) {
    const url = new URL(location.href);
    url.searchParams.delete("new");
    history.replaceState(null, "", url.toString());
}

localStorage.setItem(CURRENT_SLOT_KEY, String(currentSlot));

export const SAVE_KEY = slotKey(KEY_PREFIX.state, currentSlot);
export const CHAR_KEY = slotKey(KEY_PREFIX.character, currentSlot);

// 旧单档数据迁移到槽位 1
//
// 【P0-12 加固】迁移前先用契约探测一次，确认搬过来的确实**可读**，再删源键。
// 缺陷原貌：无条件搬移并删除源键。若那份旧档其实是损坏的，
// 用户手里唯一的原始数据会被"搬走即删除"，随后 loadState 才判定 corrupt —— 已无从恢复。
// 现在：探测失败就**原样保留源键**，让 P0-12 的只读守卫与导出能力仍能派上用场。
const LEGACY_SINGLE_KEYS = { state: "melai-state", character: "melai-character" } as const;

/** 只读探测：源键内容能否被当前契约读出（不写任何东西） */
function legacyPayloadIsReadable(raw: string): boolean {
    try {
        return migrateToCurrent(JSON.parse(raw)).ok === true;
    } catch {
        return false;
    }
}

if (currentSlot === 1) {
    const legacyState = localStorage.getItem(LEGACY_SINGLE_KEYS.state);
    if (!localStorage.getItem(slotKey(KEY_PREFIX.state, 1)) && legacyState !== null) {
        if (legacyPayloadIsReadable(legacyState)) {
            localStorage.setItem(slotKey(KEY_PREFIX.state, 1), legacyState);
            localStorage.removeItem(LEGACY_SINGLE_KEYS.state);
        }
        // 不可读则保留源键：宁可它继续占着空间，也不能丢掉用户唯一的原始数据
    }
    const legacyChar = localStorage.getItem(LEGACY_SINGLE_KEYS.character);
    if (!localStorage.getItem(slotKey(KEY_PREFIX.character, 1)) && legacyChar !== null) {
        // 角色卡结构简单（10 个字符串字段），只需能解析成对象即可
        let ok = false;
        try {
            ok = typeof JSON.parse(legacyChar) === "object";
        } catch {
            ok = false;
        }
        if (ok) {
            localStorage.setItem(slotKey(KEY_PREFIX.character, 1), legacyChar);
            localStorage.removeItem(LEGACY_SINGLE_KEYS.character);
        }
    }
}

// ============ 持久化数据 ============

// 【P0-12】数据形状与 DEFAULT_SCENE 已移至 save-schema.ts（契约的单一真理源）。
// 上方已 re-export，故 `import { SceneConfig } from "./storage"` 等既有写法不变。
export { DEFAULT_SCENE } from "./save-schema";
import { DEFAULT_SCENE } from "./save-schema";

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
    // 日程时间线（AI 规划的一天流程 + 对话中用户创建的事件）
    agenda: [] as AgendaDay[],
    // 用户当前方位（家 / 学校 / 路上 / 打工处）——决定面对面还是手机聊天
    userLocation: "家",
    // 深夜发出去、她睡着没看到的消息（等她醒来再送达）
    pendingOvernight: [] as string[],
    // ===== Agent Mind（情感判断与对话决策系统）持久化状态 =====
    // 用户持续状态（情绪维度 0~1，跨消息持续演化，含惯性/衰减）
    userMind: {
        happiness: 0.42, sadness: 0.10, anger: 0.06, fear: 0.06, anxiety: 0.20,
        disappointment: 0.12, loneliness: 0.18, embarrassment: 0.06, interest: 0.40,
        energy: 0.55, social_need: 0.32, willingness_to_talk: 0.60, stress: 0.25, tension: 0.10,
    } as UserMindState,
    // AI 对话引擎状态（兴趣/耐心/意愿…，受对话动态影响）
    aiMind: {
        interest: 0.55, patience: 0.75, willingness_to_talk: 0.62, social_need: 0.35,
        curiosity: 0.60, energy: 0.62, topicFatigue: 0, defensiveness: 0.15, comfortCount: 0, lastTopic: "",
    } as AiMindState,
    // 关系张力状态（trust/familiarity 仍由 38 维推导，这里只存张力与最近重大事件）
    relMind: { tension: 0.08, lastMajorLabel: "", lastMajorTurn: 0, lastMajorVirtualAt: 0 } as RelMindState,
    // Agent Mind 上次结算的虚拟时间（用于跨消息/离线后的情绪衰减计算）
    lastAgentVirtualAt: 0,
};

// ============ 存取 ============

/**
 * 【P0-3】存档写入失败的通知通道。
 *
 * 缺陷原貌：saveState() / saveCharacter() 原本是 `catch { /* ignore *\/ }`，
 * 把一切写入失败静默吞掉。最现实的触发路径是 localStorage 配额：
 * TTS 音色以 base64 data URL 存在同一配额里（tts.ts 允许最大 10MB 文件，
 * 而 base64 会让占用膨胀到 1.34 倍并按 UTF-16 计费 → 1MB 音频就吃掉约 53% 的 5MB 配额，
 * 2MB 直接超额）。配额一旦被占满，此后**所有**存档写入都会失败，
 * 而用户完全没有感知 —— 一直玩到刷新，才发现进度全丢。
 *
 * 另一个触发路径是隐私模式 / 存储被禁用，此时 setItem 同样抛错。
 *
 * 设计：storage 是数据层，不直接碰 DOM，因此只负责「报告失败」，
 * 由界面层（chat.ts）注册处理函数决定如何告知用户。回调失败不影响存档流程本身。
 */
export interface SaveFailure {
    /** 触发失败的存储键 */
    key: string;
    /** 原始异常（通常是 QuotaExceededError / SecurityError）；被守卫拦下时为 null */
    error: unknown;
    /** 是否可判定为配额耗尽 */
    quotaExceeded: boolean;
    /** 待写入内容的字节数（UTF-16，贴近 localStorage 的计费方式） */
    bytes: number;
    /**
     * 【P0-12】失败种类。默认 "write"（真正的写入失败），
     * "blocked-read-only" 表示当前存档处于损坏/未知版本状态，写入被**主动拒绝**以避免覆盖。
     */
    kind?: "write" | "blocked-read-only";
    /** kind 为 blocked-read-only 时的原因说明 */
    blockedReason?: string;
}

type SaveFailureHandler = (failure: SaveFailure) => void;

let saveFailureHandler: SaveFailureHandler | null = null;
let lastSaveFailure: SaveFailure | null = null;

/**
 * 【P0-2】失败计数器（单调递增）。
 *
 * 为什么需要它：判断"某次操作是否**导致**了存档失败"不能看 lastSaveFailure 是否存在 ——
 * 那可能是很久以前留下的陈旧失败，会造成误判：
 *     10:00 存档失败（配额满）→ 10:05 用户清理了空间、TTS 写入成功
 *     → 检查 lastSaveFailure !== null 仍然为真 → 错误地把这次成功的写入回滚掉。
 * 正确做法是记录操作前后的 generation 差值：只有**本次操作期间新增了失败**才算它的责任。
 */
let saveFailureGeneration = 0;

/** 读取当前失败计数（配合操作前后比对，实现 operation-scoped 判定） */
export function getSaveFailureGeneration(): number {
    return saveFailureGeneration;
}

/** 注册存档失败处理函数（界面层调用；传 null 可注销） */
export function setSaveFailureHandler(fn: SaveFailureHandler | null) {
    saveFailureHandler = fn;
}

/** 最近一次存档失败（供调试与测试读取） */
export function getLastSaveFailure(): SaveFailure | null {
    return lastSaveFailure;
}

/** 清除失败记录（测试与"存档恢复正常"时使用） */
export function clearSaveFailure(): void {
    lastSaveFailure = null;
}

function isQuotaError(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    // 各浏览器命名不一：Chrome/Safari 用 QuotaExceededError，Firefox 用 NS_ERROR_DOM_QUOTA_REACHED
    return (
        error.name === "QuotaExceededError" ||
        error.name === "NS_ERROR_DOM_QUOTA_REACHED" ||
        /quota/i.test(error.message)
    );
}

/**
 * 供其它数据模块（character.ts）复用的失败上报入口。
 * 集中在此处构造 SaveFailure，保证「配额判定 / 字节估算 / 最近失败记录」口径一致。
 */
export function notifySaveFailure(
    key: string,
    error: unknown,
    payload: string,
    extra?: { kind?: SaveFailure["kind"]; blockedReason?: string },
): void {
    reportFailure(key, error, payload, extra);
}

function reportFailure(
    key: string,
    error: unknown,
    payload: string,
    extra?: { kind?: SaveFailure["kind"]; blockedReason?: string },
): void {
    const failure: SaveFailure = {
        key,
        error,
        quotaExceeded: error !== null && isQuotaError(error),
        bytes: payload.length * 2, // localStorage 按 UTF-16 码元计费
        ...(extra?.kind ? { kind: extra.kind } : {}),
        ...(extra?.blockedReason ? { blockedReason: extra.blockedReason } : {}),
    };
    lastSaveFailure = failure;
    saveFailureGeneration++; // 【P0-2】operation-scoped 判定的依据
    try {
        saveFailureHandler?.(failure);
    } catch {
        /* 通知失败不得影响存档流程本身 */
    }
}

/**
 * 统一写入：返回是否成功，并在失败时通过回调上报。
 * 不再吞掉异常 —— 这是 P0-3 的核心。
 */
function writeKey(key: string, payload: string): boolean {
    try {
        localStorage.setItem(key, payload);
        return true;
    } catch (error) {
        reportFailure(key, error, payload);
        return false;
    }
}

/**
 * 存档是否成功。
 *
 * 【P0-3】此前无返回值、失败被静默吞掉 —— 现在返回 boolean 并上报失败。
 * 【P0-12】新增只读守卫：若上一次加载判定为「损坏 / 未知版本 / 读取失败」，
 * 则**拒绝写入**，避免把用户那份损坏但可能可修复的数据永久覆盖掉（修 D4）。
 * 用户如需重新开始，必须显式执行「重置」（resetState 路径会清除该状态）。
 */
export function saveState(): boolean {
    if (lastLoadOutcome && isLoadReadOnly(lastLoadOutcome)) {
        const outcome = lastLoadOutcome;
        const reason =
            outcome.status === "future"
                ? `存档来自更新的版本（version ${outcome.version}），本版本不会写回覆盖它`
                : outcome.status === "corrupt"
                  ? outcome.reason
                  : outcome.status === "read-error"
                    ? outcome.reason
                    : "存档不可写";
        reportFailure(SAVE_KEY, null, "", {
            kind: "blocked-read-only",
            blockedReason: reason,
        });
        return false;
    }
    return writeKey(
        SAVE_KEY,
        JSON.stringify({
            version: SAVE_VERSION, // 【P0-12】存档信封新增版本号
            aiState,
            ...store,
            savedAt: Date.now(),
        }),
    );
}

/** 【P0-12】清除只读状态（仅在用户显式重置/确认丢弃损坏档后调用） */
export function clearLoadOutcome(): void {
    lastLoadOutcome = null;
}

/**
 * 【P0-12】加载结果。取代原来的 `boolean`。
 *
 * 为什么要更丰富：原来的 `loadState(): boolean` 把两种完全不同的情况混为一谈：
 *   ① 没有存档（新游戏）→ 应该开新档
 *   ② 存档损坏 / 版本不认识 → **绝不能当成新游戏**，否则后续任何 saveState 都会
 *      把那份损坏数据永久覆盖掉（这就是缺陷 D4）。
 */
export type LoadOutcome =
    | { status: "empty" } // 无存档 → 新游戏
    | { status: "loaded"; from: number; notes: string[] } // 成功（from=0 表示由 V0 迁移而来）
    | { status: "corrupt"; reason: string } // 损坏/非法 → 只读模式，不得写回
    | { status: "future"; version: number } // 来自更新版本 → 拒绝加载与写回
    | { status: "read-error"; reason: string }; // localStorage 读取本身失败

/** 本次加载是否为「不可写回」状态（corrupt / future / read-error） */
export function isLoadReadOnly(outcome: LoadOutcome): boolean {
    return outcome.status === "corrupt" || outcome.status === "future" || outcome.status === "read-error";
}

/** 最近一次 loadState 的结果（供 saveState 守卫与调试读取） */
let lastLoadOutcome: LoadOutcome | null = null;
export function getLastLoadOutcome(): LoadOutcome | null {
    return lastLoadOutcome;
}

/** 把迁移+校验后的 SaveV1 应用到 store / aiState（唯一入口，含 NPC 按场景重建） */
function applyLoadedState(state: SaveV1): void {
    // aiState：契约已保证恰好 38 维且全部为有限数（缺失回落基线、脏值回落基线、多余键已丢）
    for (const key of Object.keys(aiState)) {
        if (!(key in state.aiState)) delete aiState[key];
    }
    Object.assign(aiState, state.aiState);

    store.turnCount = state.turnCount;
    store.storyProgress = state.storyProgress;
    store.storyEvents = state.storyEvents;
    store.chatHistory = state.chatHistory;
    store.journal = state.journal;
    store.activeThread = state.activeThread;
    store.scheduleIndex = state.scheduleIndex;
    store.timeRate = state.timeRate;
    store.virtualMs = state.virtualMs;
    store.dayBaseMs = state.dayBaseMs;
    store.dayIndex = state.dayIndex;
    store.memories = state.memories;
    store.lastReplyRealAt = state.lastReplyRealAt;
    store.lastReplyVirtualAt = state.lastReplyVirtualAt;
    store.lastNeglectAt = state.lastNeglectAt;
    store.lastNeglectRealAt = state.lastNeglectRealAt;
    store.lastNeglectLevel = state.lastNeglectLevel;
    store.presentNpcs = state.presentNpcs;
    store.npcEnabled = state.npcEnabled;
    store.scene = state.scene;
    store.agenda = state.agenda;
    store.userLocation = state.userLocation;
    store.pendingOvernight = state.pendingOvernight;
    store.userMind = state.userMind as unknown as UserMindState;
    store.aiMind = state.aiMind as unknown as AiMindState;
    store.relMind = state.relMind as unknown as RelMindState;
    store.lastAgentVirtualAt = state.lastAgentVirtualAt;

    // NPC：结构复杂且依赖 NPCS 定义与当前场景，因此在这里（而非契约层）重建。
    // 必须在 store.scene 之后，因为身份/作息/地点随场景变化。
    const savedNpcs = state.npcs as Record<string, { profile?: { id?: string } } | undefined>;
    store.npcs = {};
    for (const base of NPCS) {
        const profile = applySceneToProfile(base, store.scene);
        const saved = savedNpcs[base.id];
        if (saved && saved.profile?.id) {
            // 保留存档中的状态，但用最新 profile 定义补齐字段
            store.npcs[base.id] = { ...createNpcState(profile), ...saved, profile } as NpcState;
            const npc = store.npcs[base.id]!;
            if (!npc.emotion) npc.emotion = createNpcState(profile).emotion;
            if (!Array.isArray(npc.knownFacts)) npc.knownFacts = [];
            if (!Array.isArray(npc.history)) npc.history = [];
        } else {
            store.npcs[base.id] = createNpcState(profile);
        }
    }
    void savedNpcs;
}

/**
 * 【P0-12】从当前槽位加载存档（经 SaveV1 契约：侦测版本 → 迁移 → 校验 → 应用）。
 *
 * 与既有行为的关系：
 *   · 逐字段兜底策略**完全一致**（由契约模块统一实现），另修 D1（NaN 污染）/D2（残留维度）/D3（类型穿透）；
 *   · 新增：损坏档与未知高版本**不再被当成新游戏**，因此不会被后续 saveState 覆盖（修 D4）。
 */
export function loadState(): LoadOutcome {
    let raw: string | null = null;
    try {
        raw = localStorage.getItem(SAVE_KEY);
    } catch (e) {
        const outcome: LoadOutcome = { status: "read-error", reason: (e as Error)?.message ?? String(e) };
        lastLoadOutcome = outcome;
        return outcome;
    }

    if (raw === null) {
        const outcome: LoadOutcome = { status: "empty" };
        lastLoadOutcome = outcome;
        return outcome;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        // 损坏档：保留原始字符串，绝不覆盖
        const outcome: LoadOutcome = { status: "corrupt", reason: `JSON 解析失败：${(e as Error)?.message ?? "未知"}` };
        lastLoadOutcome = outcome;
        return outcome;
    }

    const migrated = migrateToCurrent(parsed);
    if (migrated.ok === false) {
        let outcome: LoadOutcome;
        switch (migrated.kind) {
            case "future-version":
                outcome = { status: "future", version: migrated.version };
                break;
            case "invalid-version":
                outcome = { status: "corrupt", reason: `版本号非法：${JSON.stringify(migrated.raw)}` };
                break;
            case "migration-failed":
                outcome = { status: "corrupt", reason: `迁移失败（v${migrated.from}）：${migrated.error}` };
                break;
            case "normalize-failed":
                outcome = { status: "corrupt", reason: `存档结构不完整：${migrated.reason}` };
                break;
        }
        lastLoadOutcome = outcome;
        return outcome;
    }

    applyLoadedState(migrated.state);
    const outcome: LoadOutcome = { status: "loaded", from: migrated.from, notes: migrated.notes };
    lastLoadOutcome = outcome;
    return outcome;
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

// ============ 【P0-12】槽位读写原语（供导出/导入使用） ============

/**
 * 读取任意槽位并归一化为 SaveV1，**不改动内存中的 store**。
 * 与 loadState 共用同一套侦测/迁移/校验，因此导出的永远是"可用的当前格式"。
 */
export type SlotStateRead =
    | { status: "ok"; state: SaveV1; from: number }
    | { status: "empty" }
    | { status: "unusable"; reason: string; future?: number };

export function readSlotState(slot: number): SlotStateRead {
    let raw: string | null;
    try {
        raw = localStorage.getItem(slotKey(KEY_PREFIX.state, slot));
    } catch (e) {
        return { status: "unusable", reason: `读取失败：${(e as Error)?.message ?? "未知"}` };
    }
    if (raw === null) return { status: "empty" };

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (e) {
        return { status: "unusable", reason: `JSON 解析失败：${(e as Error)?.message ?? "未知"}` };
    }

    const migrated = migrateToCurrent(parsed);
    if (migrated.ok === false) {
        if (migrated.kind === "future-version") {
            return { status: "unusable", reason: `来自更新版本（version ${migrated.version}）`, future: migrated.version };
        }
        const reason =
            migrated.kind === "invalid-version"
                ? `版本号非法：${JSON.stringify(migrated.raw)}`
                : migrated.kind === "migration-failed"
                  ? `迁移失败（v${migrated.from}）：${migrated.error}`
                  : `结构不完整：${migrated.reason}`;
        return { status: "unusable", reason };
    }
    return { status: "ok", state: migrated.state, from: migrated.from };
}

/**
 * 【P0-12】一次事务式地把「存档 + 角色卡」写入指定槽位。
 *
 * localStorage 的两次 setItem 不是事务：若先写角色卡成功、再写存档失败，
 * 就会留下"新角色 + 旧进度"的混合档。因此这里：
 *   ① 先把两个键的**原始字符串**备份到内存；
 *   ② 依次写入；
 *   ③ 任一失败 → 用备份原样写回（尽力恢复），并返回失败原因。
 *
 * 注意：这里刻意**不通过 writeKey**，而是自己捕获异常 —— 否则两次失败会产生
 * 两条独立的 SaveFailure 通知，且回滚写入本身也会触发通知，造成误导。
 */
export interface CommitResult {
    ok: boolean;
    /** 失败阶段：state / character / rollback */
    stage?: "state" | "character";
    error?: unknown;
}

export function commitSlotState(
    slot: number,
    stateJson: string,
    characterJson: string,
): CommitResult {
    const stateKey = slotKey(KEY_PREFIX.state, slot);
    const charKey = slotKey(KEY_PREFIX.character, slot);

    // ① 备份原始字符串（用于回滚）
    let backupState: string | null = null;
    let backupChar: string | null = null;
    try {
        backupState = localStorage.getItem(stateKey);
        backupChar = localStorage.getItem(charKey);
    } catch {
        /* 读不到就当没有备份，回滚会退化为删除 */
    }

    const rollback = () => {
        try {
            if (backupState === null) localStorage.removeItem(stateKey);
            else localStorage.setItem(stateKey, backupState);
        } catch {
            /* 尽力而为 */
        }
        try {
            if (backupChar === null) localStorage.removeItem(charKey);
            else localStorage.setItem(charKey, backupChar);
        } catch {
            /* 尽力而为 */
        }
    };

    // ② 先写角色卡（体积小、失败概率低），再写存档（体积大、可能触发配额）
    try {
        localStorage.setItem(charKey, characterJson);
    } catch (error) {
        rollback();
        return { ok: false, stage: "character", error };
    }

    try {
        localStorage.setItem(stateKey, stateJson);
    } catch (error) {
        rollback();
        return { ok: false, stage: "state", error };
    }

    return { ok: true };
}

/**
 * 【P0-13 加固】只清除本应用拥有的键。
 *
 * 缺陷原貌：菜单页「清空所有数据」用的是裸 `localStorage.clear()` ——
 * 它会抹掉**同源下的全部键**：5 个槽的存档与角色卡、全部 API Key、
 * 以及本应用的全局键（effort / TTS / 面板折叠 / 当前槽位），
 * 还会误删同源下**其它页面**的数据（本应用通常与项目站点同源部署）。
 *
 * 现在改为按已登记的前缀白名单枚举删除：
 *   · 只删本应用创建的键；
 *   · 同时覆盖历史遗留键（melai-state / melai-character / melai-did-new-*​）；
 *   · 单键删除失败不影响其它键。
 */
export function clearAllAppData(slotCount = SLOT_MAX): { removed: number } {
    const prefixes = [
        KEY_PREFIX.state,
        KEY_PREFIX.character,
        KEY_PREFIX.apikey,
        KEY_PREFIX.provider,
        KEY_PREFIX.model,
        KEY_PREFIX.customUrl,
        KEY_PREFIX.modelsCache,
        KEY_PREFIX.ttsEnabled,
        KEY_PREFIX.ttsVoice,
        KEY_PREFIX.ttsApiKey,
        KEY_PREFIX.ttsStyle,
        KEY_PREFIX.ttsLang,
        "melai-did-new",
        "melai-effort",
        "melai-agent-console",
        "panel.section",
        CURRENT_SLOT_KEY,
        // 历史遗留（无槽位后缀）
        "melai-state",
        "melai-character",
    ];

    // 先枚举出要删的键（避免边遍历边删导致索引错位）
    const doomed: string[] = [];
    try {
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (!key) continue;
            const owned = prefixes.some((pre) => key === pre || key.startsWith(`${pre}-`));
            if (owned) doomed.push(key);
        }
    } catch {
        return { removed: 0 };
    }

    let removed = 0;
    for (const key of doomed) {
        try {
            localStorage.removeItem(key);
            removed++;
        } catch {
            /* 单个键失败不影响其它键 */
        }
    }
    void slotCount;
    return { removed };
}

export function clearSlot(slot: number) {
    localStorage.removeItem(slotKey(KEY_PREFIX.state, slot));
    localStorage.removeItem(slotKey(KEY_PREFIX.character, slot));
    // 清理旧版本遗留的 "已清空过" 标记（P0-11 之前写入的键），
    // 否则该槽位在此后点「新建」时会因守卫命中而拿到旧档。
    localStorage.removeItem(slotKey("melai-did-new", slot)); // P0-11 前的遗留标记
}

// 菜单页用：读取任意槽位的摘要数据
export function loadSlotRaw(slot: number): Record<string, unknown> | null {
    try {
        const raw = localStorage.getItem(slotKey(KEY_PREFIX.state, slot));
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
        const raw = localStorage.getItem(slotKey(KEY_PREFIX.character, slot));
        if (raw) {
            const c = JSON.parse(raw);
            if (c?.name) return c.name;
        }
    } catch {
        /* ignore */
    }
    return "未命名";
}
