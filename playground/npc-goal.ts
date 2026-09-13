// npc-goal.ts —— 【Phase 4-D 决策 C-1】NPC「目标」的最小显式语义
//
// 缺陷原貌（审计确认）：
//   `intervention.ts` 里写的是
//       if (npc.goal && Math.random() < 0.25) { score += 12; … }
//   而 `NpcState.goal` 的唯一写入点是 `createNpcState()` 的 `profile.goal ?? null`，
//   **全部内置 NPC 都带 goal** → 该条件**恒为真** →
//   实际等价于「每个 NPC 每次筛选有 25% 概率获得固定 +12 分」，
//   **goal 的文本内容从不参与任何判断**。
//
// 本模块只解决这一个语义错误：让"有 goal"不再等于"无条件 +12"。
//
// 设计约束（严格遵守 Phase 4-D 的禁止项）：
//   · 不新增 Goal Agent / Planner / LLM goal reasoning / goal 数据库 / 新持久化结构
//   · 不新增概率系统 / 时间系统 / cooldown
//   · **不修改 Save Schema**（`goalKind` 只加在 `NpcProfile` 上 = 静态配置，不进存档）
//   · 不用 LLM 判断相关性；只做**最小、显式、可测试**的映射
//
// 语义边界（极重要）：
//   goal **只影响候选评分**，绝不决定"NPC 能否介入"。
//   它不能绕过 Core 世界安全守卫（`checkInterventionSafety`），
//   也不能直接写 store / 创建 Core Fact / 改情绪 / 改剧情进度。

/**
 * goal 的类别。这是**显式**的，不靠猜文本。
 *
 * 为什么不直接解析 `goal` 字符串：那需要一个关键词/NLP 引擎 —— 属于禁止项。
 * 改为在 `NpcProfile`（静态配置）上声明类别，语义明确、可测试、零存档影响。
 */
export type NpcGoalKind = "connect" | "understand";

/** 本轮介入场景的形态（由 `screenNpcCandidates` 已有的评分事实推导，不引入新数据） */
export interface GoalContext {
    /** goal 文本（`null` = 她没有目标 → 不产生任何加成） */
    goal: string | null;
    /** goal 的显式类别（未声明时由 `goalKindOf` 从文本做最小推断） */
    goalKind?: NpcGoalKind | null;
    /** 语境里是否提到了她（已有的 `keywordHit` 结果） */
    keywordHit: boolean;
    /** 她是否就在主角所在场景（已有的 `npcIsNearby` 结果） */
    nearby: boolean;
    /**
     * 语境是否属于"关系/情感互动"（已有的 `PRIVATE_TOPIC_PATTERN` 结果）。
     * ⚠️ 注意：这个事实同时被 Core 世界安全守卫用来**拒绝**介入；
     *    在 goal 相关性的语境里它只是"这是一个关系类场景"的信号。
     */
    relationContext: boolean;
}

/** 每个 goal 类别在什么场景下算"相关" —— 一处显式映射，可审计、可测试 */
const GOAL_RELEVANCE: Record<NpcGoalKind, (ctx: GoalContext) => boolean> = {
    /**
     * `connect`（想和主角保持联系 / 想撮合、想打趣你们俩）：
     * 与"关系互动"或"被提到"相关 —— 她本来就是冲着你们的关系来的。
     */
    connect: (ctx) => ctx.relationContext || ctx.keywordHit,

    /**
     * `understand`（想多了解主角 / 想找机会说话）：
     * 与"她适时在场"或"被提到"相关 —— 她需要一个自然的机会。
     */
    understand: (ctx) => ctx.nearby || ctx.keywordHit,
};

/**
 * 从 goal 文本做**最小**推断（仅用于兼容将来可能新增、但没声明 `goalKind` 的 NPC）。
 *
 * 这**不是**关键词引擎：只有两个显式规则，且只影响"哪一类相关性判据被使用"。
 * 未声明的 NPC 优先走 `profile.goalKind`；两者都没有时按 `understand` 处理（最保守：
 * 需要"她恰好在场"或"被提到"才算相关）。
 */
export function goalKindOf(goal: string | null | undefined, declared?: NpcGoalKind | null): NpcGoalKind | null {
    if (!goal) return null; // 没有目标 → 无关可言
    if (declared) return declared;
    // 最小推断：明确围绕"关系/撮合/打趣"的 → connect；其余 → understand
    if (/撮合|打趣|关系|在一起|联系/.test(goal)) return "connect";
    return "understand";
}

/**
 * 【C-1 的核心】她当前的 goal 是否与这次候选介入**基本相关**。
 *
 * 返回 `false` 的情形（都**不**产生加成）：
 *   · 她没有 goal（`goal` 为 null / 空串）
 *   · 语境与她当前关注的方向没有任何可观测的重合
 *
 * 返回 `true` 时**也只**意味着"允许原有的 25% × +12 机制参与评分"，
 * 不意味着"一定会介入"，更不意味着"绕过 Core"。
 */
export function isGoalRelevant(ctx: GoalContext): boolean {
    const kind = goalKindOf(ctx.goal, ctx.goalKind);
    if (!kind) return false;
    return GOAL_RELEVANCE[kind](ctx);
}

/**
 * goal 加成的**唯一**出口。
 *
 * @param roll 传入随机数（默认 `Math.random`），使判定在测试中完全确定
 * @returns 与 goal 相关的加分（相关且命中 25% 时为 `GOAL_BONUS`，否则 0）
 *
 * 注意：`GOAL_BONUS = 12` 与 `GOAL_CHANCE = 0.25` 都是**既有常量**，原样保留 —
 * 本模块只改了"什么时候允许掷这个骰子"，没有改骰子本身。
 */
export const GOAL_BONUS = 12;
export const GOAL_CHANCE = 0.25;

export function goalScoreBonus(ctx: GoalContext, roll: () => number = Math.random): number {
    if (!isGoalRelevant(ctx)) return 0; // ← 语义修正点：不相关 → 不掷骰、不加分
    return roll() < GOAL_CHANCE ? GOAL_BONUS : 0;
}
