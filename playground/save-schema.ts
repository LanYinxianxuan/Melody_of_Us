// save-schema.ts —— SaveV1 存档契约：版本、校验、迁移链（【P0-12】）
//
// 设计原则（与 P0-12_plan.md §B 一致）：
//   ① 兼容优先于美观：字段名与嵌套形状**完全沿用现状**，只新增一个顶层 version；
//   ② 本模块是**纯函数**：不碰 localStorage、不碰 DOM、不碰 store，因此可以在 Node 里直接单测；
//   ③ 零信任读取：所有字段经统一校验后才允许进入 store；
//   ④ 失败不阻塞启动：任何校验/迁移失败都返回可诊断结果，由调用方决定如何提示。
//
// 字段分级（关键：**"必需"不等于"缺失即拒绝"**）：
//   L1 必需  —— 只有 aiState（且必须是非 null 对象）。缺失即判定"非本应用存档"。
//   L2 默认  —— 其余 27 个 store 字段。缺失/类型错 → 补默认值，与既有 loadState 的逐字段兜底行为一致。
//   L3 新增  —— version。缺失 → 视为 V0（旧档），走迁移。

import { DIMENSIONS, INITIAL_STATE } from "./state";
// 说明：本模块**不 import storage.ts** —— 契约必须是自包含的叶子模块，
// 否则 storage（要 import 本模块做校验）与本模块会形成循环依赖。
// DEFAULT_SCENE / 各数据形状在此处定义，storage.ts 改为从本模块 re-export，
// 以保持既有 `import { SceneConfig } from "./storage"` 的调用方不受影响。

// ============ 版本 ============

/** 当前存档格式版本。文件里缺失该字段 = V0（P0-12 之前的旧档）。 */
export const SAVE_VERSION = 1;

/** 存档信封中承载 version 的字段名 */
export const VERSION_FIELD = "version";

// ============ 形状定义 ============

/**
 * 世界档案里的一条事件。
 *
 * 【4-A7】`source` 区分「这条文本是谁产出的」，从而决定它**是否可以作为既成事实**
 * 回注进下一轮的 prompt / 剧情档案。
 *
 *   · `"core"`      —— 由本地代码模板 + 世界数值生成（例如被冷落反应）。
 *                      代码确认"这件事在游戏世界里真的发生了"。
 *   · `"narrative"` —— 由 AI（主模型或事件卡）产出的叙述文本。**仅供展示与回顾**。
 *   · `"director"`  —— Director 决策的 `reason`。它是**调度器对自己决定的解释**，
 *                      不是对已发生事实的描述 → 因此**不得**进入既成事实。
 *
 * 设计要点（避免破坏旧档）：
 *   · 字段是**可选**的，旧档没有它 → 归一化时补 `"narrative"`（最保守的默认）。
 *   · 因此**存档版本号不需要变**，`SaveV1` 契约的既有字段语义一字未改。
 *   · 默认值必须由 `normalizeToSaveV1` 显式补齐的**唯一原因**是：
 *     `storyEvents` 是**白名单字段**，其元素形状由本函数决定 —— 不补默认值的话，
 *     旧档载入后 `source` 会是 `undefined`，而 `undefined` 在判定里等价于
 *     "不可信来源"，会让所有旧事件都失去档案资格。
 */
export type StoryEventSource = "core" | "narrative" | "director";

/**
 * 【4-B2】事件优先级。**它是调度信息，不是规则**：
 *   · 它**不参与**任何数值计算（不改情绪/关系/概率/进度）
 *   · 它只用于：① 进入 prompt 时让 Director 看到自己的重要度判断确实被记录；
 *              ② 事件档案里可追溯"这条事件当时的调度等级"。
 * `priority` 全程可被忽略而不影响世界行为 —— 这是刻意的：
 *   把它接到"改概率/改幅度"上就等于让 AI 决定规则，属于禁止项。
 */
export type StoryEventPriority = "main" | "supporting" | "world";

export interface StoryEvent {
    day: number;
    text: string;
    /** 见 `StoryEventSource`。旧档缺失时归一化为 "narrative"。 */
    source?: StoryEventSource;
    /** 【4-B2】调度等级（可选）。旧档缺失 → 归一化为 "world"（最低）。 */
    priority?: StoryEventPriority;
}

/**
 * 【4-A7】哪些来源的事件文本可以进入「既成事实 / 剧情档案」。
 *
 * 只有 `core`：文本由代码模板 + 世界数值生成，代码知道这件事真的发生了。
 * `narrative` / `director` 一律只用于展示与回顾（`updateStoryUI` 仍然显示它们），
 * 但**不再**被 `journalText()` 当作历史事实回注给模型。
 *
 * ⚠️ 这是一处**行为变化**（改变了回注 prompt 的内容），已记录在
 * `GAMEPLAY_REVIEW.md` 的 `G-7`。
 */
export const STORY_EVENT_FACT_SOURCES: ReadonlySet<StoryEventSource> = new Set(["core"]);

/** 判断一条事件是否属于"既成事实"（可回注 prompt / 进入剧情档案） */
export function isFactualStoryEvent(e: { source?: StoryEventSource }): boolean {
    return STORY_EVENT_FACT_SOURCES.has(e.source ?? "narrative");
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

export interface AgendaItem {
    time: string;
    title: string;
    desc?: string;
    status: "todo" | "active" | "done";
    source: "ai" | "user";
}

export interface AgendaDay {
    day: number;
    items: AgendaItem[];
}

export interface SceneConfig {
    name: string;
    place: string;
    routine: string;
    others: string;
    busyLabel: string;
    restLabel: string;
}

/** 默认场景（兼容旧存档/未设置）：校园。与 storage.ts 中的取值完全一致。 */
export const DEFAULT_SCENE: SceneConfig = {
    name: "学校",
    place: "学校",
    routine: "上课",
    others: "同学",
    busyLabel: "上课",
    restLabel: "课间",
};

/**
 * SaveV1 —— 统一存档信封。
 * 字段名与 V0 **逐字一致**，仅新增 `version`。这是兼容性的核心保证。
 */
export interface SaveV1 {
    version: number;
    savedAt: number;
    aiState: Record<string, number>;
    turnCount: number;
    storyEvents: StoryEvent[];
    storyProgress: number;
    chatHistory: HistoryEntry[];
    journal: DayJournal[];
    activeThread: string | null;
    scheduleIndex: number;
    timeRate: number;
    virtualMs: number;
    dayBaseMs: number;
    dayIndex: number;
    memories: string[];
    lastReplyRealAt: number;
    lastReplyVirtualAt: number;
    lastNeglectAt: number;
    lastNeglectRealAt: number;
    lastNeglectLevel: number;
    npcs: Record<string, unknown>;
    presentNpcs: string[];
    npcEnabled: boolean;
    scene: SceneConfig;
    agenda: AgendaDay[];
    userLocation: string;
    pendingOvernight: string[];
    userMind: Record<string, number>;
    aiMind: Record<string, number | string>;
    relMind: Record<string, number | string>;
    lastAgentVirtualAt: number;
}

/**
 * SaveV1 里除 `version` / `savedAt` / `aiState` 之外的字段清单。
 * 用于：① 「已知字段」白名单（迁移时保留未知字段的判据）；
 *       ② 校验时逐字段补默认值。
 */
export const SAVE_STATE_FIELDS = [
    "turnCount",
    "storyEvents",
    "storyProgress",
    "chatHistory",
    "journal",
    "activeThread",
    "scheduleIndex",
    "timeRate",
    "virtualMs",
    "dayBaseMs",
    "dayIndex",
    "memories",
    "lastReplyRealAt",
    "lastReplyVirtualAt",
    "lastNeglectAt",
    "lastNeglectRealAt",
    "lastNeglectLevel",
    "npcs",
    "presentNpcs",
    "npcEnabled",
    "scene",
    "agenda",
    "userLocation",
    "pendingOvernight",
    "userMind",
    "aiMind",
    "relMind",
    "lastAgentVirtualAt",
] as const;

export type SaveStateField = (typeof SAVE_STATE_FIELDS)[number];

/** 存档信封的全部已知顶层键 */
export const KNOWN_TOP_LEVEL_KEYS: readonly string[] = [
    VERSION_FIELD,
    "savedAt",
    "aiState",
    ...SAVE_STATE_FIELDS,
];

// ============ 默认值（唯一真理源） ============
//
// 为什么集中在这里：避免默认值像现在这样散落在 loadState 的字面量里
// （userMind 的 14 个默认值在 storage.ts 里被抄了两遍）。
// 注意：这些默认值必须与 storage.ts 的 store 初始化**保持等价**。

export const DEFAULT_USER_MIND: Record<string, number> = {
    happiness: 0.42, sadness: 0.10, anger: 0.06, fear: 0.06, anxiety: 0.20,
    disappointment: 0.12, loneliness: 0.18, embarrassment: 0.06, interest: 0.40,
    energy: 0.55, social_need: 0.32, willingness_to_talk: 0.60, stress: 0.25, tension: 0.10,
};

export const DEFAULT_AI_MIND: Record<string, number | string> = {
    interest: 0.55, patience: 0.75, willingness_to_talk: 0.62, social_need: 0.35,
    curiosity: 0.60, energy: 0.62, topicFatigue: 0, defensiveness: 0.15, comfortCount: 0, lastTopic: "",
};

export const DEFAULT_REL_MIND: Record<string, number | string> = {
    tension: 0.08, lastMajorLabel: "", lastMajorTurn: 0, lastMajorVirtualAt: 0,
};

/** 允许的 userLocation 取值（与现状白名单一致） */
export const USER_LOCATIONS = ["家", "学校", "路上", "打工处"] as const;

// ============ 小工具 ============

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null && !Array.isArray(v);

const num = (v: unknown, fallback: number): number =>
    typeof v === "number" && Number.isFinite(v) ? v : fallback;

const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

const arr = <T>(v: unknown, fallback: T[]): T[] => (Array.isArray(v) ? (v as T[]) : fallback);

/**
 * 数值对象归一化：
 *   ① 以 defaults 为底（缺失键补默认）
 *   ② 丢弃非有限数的键（修 D1：脏值经 clamp 会变成 NaN 并永久污染）
 *   ③ 丢弃 defaults 之外的多余键（修 D2：旧版本删掉的键永久残留）
 */
function normalizeNumericRecord(
    v: unknown,
    defaults: Record<string, number>,
): Record<string, number> {
    const src = isPlainObject(v) ? v : {};
    const out: Record<string, number> = {};
    for (const key of Object.keys(defaults)) {
        const raw = src[key];
        out[key] = typeof raw === "number" && Number.isFinite(raw) ? raw : defaults[key]!;
    }
    return out;
}

/** 与 normalizeNumericRecord 同构，但允许字符串值（aiMind.lastTopic / relMind.lastMajorLabel） */
function normalizeMixedRecord(
    v: unknown,
    defaults: Record<string, number | string>,
): Record<string, number | string> {
    const src = isPlainObject(v) ? v : {};
    const out: Record<string, number | string> = {};
    for (const key of Object.keys(defaults)) {
        const fallback = defaults[key]!;
        const raw = src[key];
        if (typeof fallback === "number") {
            out[key] = typeof raw === "number" && Number.isFinite(raw) ? raw : fallback;
        } else {
            out[key] = typeof raw === "string" ? raw : fallback;
        }
    }
    return out;
}

// ============ 校验 + 归一化 ============

export type NormalizeResult =
    | { ok: true; state: SaveV1; notes: string[] }
    | { ok: false; kind: "not-an-object" | "missing-aiState" };

/**
 * 把任意对象归一化为合法 SaveV1。
 *
 * 与现有 loadState 的关系：**逐字段兜底策略完全一致**，只是：
 *   · 多了 aiState 的值类型校验与多余键清理（修 D1/D2）；
 *   · 把散落的默认值集中到本模块；
 *   · 返回值可诊断（notes 记录哪些字段被修正）。
 *
 * 不接受 `version` 的判定 —— 版本判定在 detectVersion/migrate 层完成。
 */
export function normalizeToSaveV1(input: unknown): NormalizeResult {
    if (!isPlainObject(input)) return { ok: false, kind: "not-an-object" };

    // L1：aiState 是唯一的必需字段
    if (!isPlainObject(input.aiState)) return { ok: false, kind: "missing-aiState" };

    const notes: string[] = [];
    const src = input;

    // aiState：补齐 38 维、丢弃非有限值、丢弃多余键
    const aiStateDefaults = INITIAL_STATE as Record<string, number>;
    const aiState: Record<string, number> = {};
    for (const dim of DIMENSIONS) {
        const raw = (src.aiState as Record<string, unknown>)[dim.key];
        if (typeof raw !== "number" || !Number.isFinite(raw)) {
            if (raw !== undefined) notes.push(`aiState.${dim.key} 非法（${typeof raw}）→ 回落默认`);
            aiState[dim.key] = aiStateDefaults[dim.key] ?? dim.baseline;
        } else {
            aiState[dim.key] = raw;
        }
    }
    const extraDims = Object.keys(src.aiState as Record<string, unknown>).filter(
        (k) => !(k in aiStateDefaults),
    );
    if (extraDims.length) notes.push(`aiState 丢弃多余维度: ${extraDims.join(",")}`);

    // storyEvents：兼容早期 string[] 形状
    const rawStoryEvents = src.storyEvents;
    let storyEvents: StoryEvent[] = [];
    if (Array.isArray(rawStoryEvents)) {
        const legacyStrings = rawStoryEvents.filter((e) => typeof e === "string").length;
        if (legacyStrings > 0) notes.push(`storyEvents 含 ${legacyStrings} 条旧式字符串，已转为 {day,text}`);
        // 【4-A7】source 是可选字段：旧档缺失 → 归一化为 "narrative"（最保守默认，
    // 即"不是既成事实"）。因此**不需要变更版本号**，旧档语义不变。
    const storySource = (v: unknown): StoryEventSource =>
        v === "core" || v === "narrative" || v === "director" ? v : "narrative";
    /** 【4-B2】priority 同样是可选字段：缺失 → "world"（最低档，最保守默认）。版本号不变。 */
    const storyPriority = (v: unknown): StoryEventPriority =>
        v === "main" || v === "supporting" || v === "world" ? v : "world";
    storyEvents = rawStoryEvents.map((e) =>
            typeof e === "string"
                ? { day: 1, text: e, source: "narrative" as const }
                : isPlainObject(e)
                  ? {
                        day: num(e.day, 1),
                        text: str(e.text, ""),
                        source: storySource(e.source),
                        priority: storyPriority(e.priority),
                    }
                  : { day: 1, text: String(e ?? ""), source: "narrative" as const },
        );
    }

    const sceneSrc = isPlainObject(src.scene) ? src.scene : {};
    const scene: SceneConfig = {
        name: str(sceneSrc.name, DEFAULT_SCENE.name),
        place: str(sceneSrc.place, DEFAULT_SCENE.place),
        routine: str(sceneSrc.routine, DEFAULT_SCENE.routine),
        others: str(sceneSrc.others, DEFAULT_SCENE.others),
        busyLabel: str(sceneSrc.busyLabel, DEFAULT_SCENE.busyLabel),
        restLabel: str(sceneSrc.restLabel, DEFAULT_SCENE.restLabel),
    };

    const userLocation = (USER_LOCATIONS as readonly string[]).includes(src.userLocation as string)
        ? (src.userLocation as string)
        : USER_LOCATIONS[0];

    const state: SaveV1 = {
        version: SAVE_VERSION,
        savedAt: num(src.savedAt, Date.now()),
        aiState,
        turnCount: num(src.turnCount, 0), // 修 D3：此前是 `?? 0`，字符串会穿透
        storyEvents,
        storyProgress: num(src.storyProgress, 0), // 修 D3
        chatHistory: arr<HistoryEntry>(src.chatHistory, []),
        journal: arr<DayJournal>(src.journal, []),
        activeThread: typeof src.activeThread === "string" ? src.activeThread : null,
        scheduleIndex: num(src.scheduleIndex, -1),
        timeRate: num(src.timeRate, 1),
        virtualMs: num(src.virtualMs, Date.now()),
        dayBaseMs: new Date(num(src.dayBaseMs, new Date().setHours(0, 0, 0, 0))).setHours(0, 0, 0, 0),
        dayIndex: num(src.dayIndex, 1),
        memories: arr<string>(src.memories, []).slice(-30),
        lastReplyRealAt: num(src.lastReplyRealAt, Date.now()),
        lastReplyVirtualAt: num(src.lastReplyVirtualAt, Date.now()),
        lastNeglectAt: num(src.lastNeglectAt, 0),
        lastNeglectRealAt: num(src.lastNeglectRealAt, 0),
        lastNeglectLevel: num(src.lastNeglectLevel, 0),
        // npcs 结构复杂且依赖 NPCS 定义（含按场景重建），保持"原样透传"由 storage 层处理，
        // 避免契约层反向依赖 npc.ts。这里只保证它是对象。
        npcs: isPlainObject(src.npcs) ? src.npcs : {},
        presentNpcs: arr<string>(src.presentNpcs, []),
        npcEnabled: bool(src.npcEnabled, false),
        scene,
        agenda: Array.isArray(src.agenda)
            ? src.agenda.filter(isPlainObject).map((d) => ({
                  day: num(d.day, 1),
                  items: Array.isArray(d.items) ? (d.items as AgendaItem[]) : [],
              }))
            : [],
        userLocation,
        pendingOvernight: arr<string>(src.pendingOvernight, []),
        userMind: normalizeNumericRecord(src.userMind, DEFAULT_USER_MIND),
        aiMind: normalizeMixedRecord(src.aiMind, DEFAULT_AI_MIND),
        relMind: normalizeMixedRecord(src.relMind, DEFAULT_REL_MIND),
        lastAgentVirtualAt: num(src.lastAgentVirtualAt, num(src.virtualMs, Date.now())),
    };

    // 未知的顶层字段：保留（不丢数据），但记录 note 以便排查
    const unknown = Object.keys(src).filter((k) => !KNOWN_TOP_LEVEL_KEYS.includes(k));
    if (unknown.length) notes.push(`保留未知顶层字段: ${unknown.join(",")}`);

    return { ok: true, state, notes };
}

// ============ 版本侦测 + 迁移链 ============

export type VersionDetection =
    | { kind: "v0" } // 无 version 字段 → 旧档
    | { kind: "current"; version: number }
    | { kind: "future"; version: number } // 高于当前 → 拒绝
    | { kind: "invalid"; raw: unknown }; // 非正整数

/**
 * 判定存档版本。
 * 三种"无版本"情形都归为 v0：字段不存在 / undefined / null。
 */
export function detectVersion(input: unknown): VersionDetection {
    if (!isPlainObject(input)) return { kind: "invalid", raw: input };
    const raw = input[VERSION_FIELD];
    if (raw === undefined || raw === null) return { kind: "v0" };
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0) {
        return { kind: "invalid", raw };
    }
    if (raw === SAVE_VERSION) return { kind: "current", version: raw };
    if (raw > SAVE_VERSION) return { kind: "future", version: raw };
    return { kind: "current", version: raw }; // 低于当前但显式标注：仍走迁移链
}

/** 单步迁移签名：接收任意对象，返回迁移后的对象（可抛错） */
export type MigrationStep = (input: Record<string, unknown>) => Record<string, unknown>;

/**
 * V0 → V1。
 *
 * **这不是新写的迁移**，而是把既有 loadState 的隐式逐字段兜底显式化 ——
 * 因此行为与现状等价（唯一差异是 aiState 的 D1/D2 修复，已在 §B.4 报备）。
 * 真正的归一化在 normalizeToSaveV1 里完成，本步只负责"打上版本号"。
 */
export const migrateV0toV1: MigrationStep = (input) => ({
    ...input,
    [VERSION_FIELD]: 1,
});

/** 迁移链：键 = 起始版本，值 = 该版本 → 下一版本的迁移函数 */
export const MIGRATIONS: Record<number, MigrationStep> = {
    0: migrateV0toV1,
    // 1: migrateV1toV2,  ← 未来在此追加
};

export type MigrateOutcome =
    | { ok: true; state: SaveV1; from: number; notes: string[] }
    | { ok: false; kind: "future-version"; version: number }
    | { ok: false; kind: "invalid-version"; raw: unknown }
    | { ok: false; kind: "migration-failed"; from: number; error: string }
    | { ok: false; kind: "normalize-failed"; reason: string };

/**
 * 完整迁移入口：侦测版本 → 逐级迁移 → 归一化为 SaveV1。
 *
 * 纯函数：不读不写任何存储。调用方拿到 `ok:true` 的 state 后才决定是否落盘。
 */
export function migrateToCurrent(input: unknown): MigrateOutcome {
    const detection = detectVersion(input);

    if (detection.kind === "future") {
        return { ok: false, kind: "future-version", version: detection.version };
    }
    if (detection.kind === "invalid") {
        return { ok: false, kind: "invalid-version", raw: detection.raw };
    }

    let currentVersion = detection.kind === "v0" ? 0 : detection.version;
    const startVersion = currentVersion;
    let working = isPlainObject(input) ? { ...input } : {};

    const notes: string[] = [];
    if (startVersion === 0) notes.push("检测到无版本号的旧存档（V0）→ 迁移至 V1");

    // 逐级迁移（每级 +1），带防御性上限避免迁移链配置错误导致死循环
    let guard = 0;
    while (currentVersion < SAVE_VERSION) {
        const step = MIGRATIONS[currentVersion];
        if (!step) {
            return { ok: false, kind: "migration-failed", from: currentVersion, error: "缺少迁移步骤" };
        }
        try {
            working = step(working);
        } catch (e) {
            return {
                ok: false,
                kind: "migration-failed",
                from: currentVersion,
                error: (e as Error)?.message ?? String(e),
            };
        }
        currentVersion++;
        if (++guard > 100) {
            return { ok: false, kind: "migration-failed", from: currentVersion, error: "迁移链未收敛" };
        }
    }

    const normalized = normalizeToSaveV1(working);
    if (normalized.ok === false) {
        return { ok: false, kind: "normalize-failed", reason: normalized.kind };
    }

    return {
        ok: true,
        state: { ...normalized.state, version: SAVE_VERSION },
        from: startVersion,
        notes: [...notes, ...normalized.notes],
    };
}
