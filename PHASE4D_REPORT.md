# PHASE4D_REPORT.md

> 阶段：**Phase 4-D「NPC Goal Semantics Closure」** —— 收口 C-1 与 C-2
> 验证基线：`npm run verify` **EXIT=0**，**887 断言 / 0 失败**
> `npm run typecheck` EXIT=0 ｜ `npm run build` EXIT=0
>
> **本阶段只解决这两个决策，未进行任何其他重构。**
> 未改：Save Schema · 38D Emotion · Mind/Emotion merge · StoryProgress 规则 · priority gameplay ·
> NPC schedule · cooldown 常量 · intervention 概率常量 · Core loop · 世界模拟 · UI · Prompt 规模

---

## 0. 断言数对照（用户要求）

| 项 | 值 |
|---|---|
| **before assertions**（Phase 4-C） | **868** |
| **after assertions** | **887** |
| **new assertions** | **+19** |
| **failures** | **0** |

其中：`e2e 564 → 583`（+19，新增 phase 9「NPC goal 语义」16 条 + phase 8「C-2 正向」1 条 + phase 9 深化断言 2 条）。
`状态闸门` / `save-schema` / `voice-store` / `CSS` / `边界` / `dist` / `smoke` 断言数**全部持平**。

---

## 1. C-1 最终实现方式

### 1.1 缺陷原貌（审计确认，比预期严重）

```ts
// intervention.ts（修复前）
if (npc.goal && Math.random() < 0.25) { score += 12; … }
```

| 事实 | 证据 |
|---|---|
| `NpcState.goal` 的唯一写入点 | `createNpcState()` 的 `profile.goal ?? null` |
| **全部 2 个内置 NPC 都带 `goal`** | `npc.ts` 的 `NPCS` |
| 因此条件**恒为真** | 推论 |
| 实际效果 | **每个 NPC 每次筛选有 25% 概率获得固定 +12 分** |
| goal 的**文本内容从不参与判断** | 该分支只判断真值 |

### 1.2 实现（最小、显式、可测试）

新增 **`playground/npc-goal.ts`**（纯函数，零 store/网络/LLM 依赖）：

```ts
export type NpcGoalKind = "connect" | "understand";

export interface GoalContext {
    goal: string | null;
    goalKind?: NpcGoalKind | null;
    keywordHit: boolean;      // 已有的 keywordHit 结果
    nearby: boolean;          // 已有的 npcIsNearby 结果
    relationContext: boolean; // 已有的 PRIVATE_TOPIC_PATTERN 结果
}

const GOAL_RELEVANCE: Record<NpcGoalKind, (ctx: GoalContext) => boolean> = {
    connect:    (ctx) => ctx.relationContext || ctx.keywordHit,   // 冲着"你们的关系"来的
    understand: (ctx) => ctx.nearby || ctx.keywordHit,            // 需要一个"自然的机会"
};

export const GOAL_BONUS = 12;    // 既有常量，原样保留
export const GOAL_CHANCE = 0.25; // 既有常量，原样保留

export function goalScoreBonus(ctx: GoalContext, roll = Math.random): number {
    if (!isGoalRelevant(ctx)) return 0;   // ← 语义修正点：不相关 → 不掷骰、不加分
    return roll() < GOAL_CHANCE ? GOAL_BONUS : 0;
}
```

`intervention.ts` 的评分处改为：

```ts
const goalCtx = { goal: npc.goal, goalKind: npc.profile.goalKind ?? null,
                  keywordHit: hit, nearby: npcIsNearby(npc),
                  relationContext: PRIVATE_TOPIC_PATTERN.test(recentText) };
const goalBonus = goalScoreBonus(goalCtx, () => Math.random());
lastGoalRelevance.set(npc.profile.id, { relevant: isGoalRelevant(goalCtx), bonus: goalBonus, kind: … });
if (goalBonus > 0) { score += goalBonus; … }
```

**关键：只改了"什么时候允许掷这个骰子"，没有改骰子本身**（仍是既有 25% × 12）。

### 1.3 未新增（严格遵守禁止项）

❌ Goal Agent ❌ Goal Planner ❌ LLM goal reasoning ❌ Goal 数据库 ❌ 新持久化结构
❌ 新 NPC 状态系统 ❌ 新概率系统 ❌ 新时间系统 ❌ NLP / 关键词引擎

（`goalKindOf` 只有**两条**显式规则，只在 NPC 未声明 `goalKind` 时作为兼容回退使用。）

---

## 2. `goalRelevant` 的精确定义

```
isGoalRelevant(ctx) =
    kind = goalKindOf(ctx.goal, ctx.goalKind)     // 她有没有"目标"这个概念
    if (kind === null) → false                    // 没有 goal → 永远不相关
    else GOAL_RELEVANCE[kind](ctx)                // 按类别查表
```

| kind | 判据 | 直观含义 |
|---|---|---|
| `connect` | `relationContext \|\| keywordHit` | 她的目标是"你们的关系"→ 关系类场景或被提到时相关 |
| `understand` | `nearby \|\| keywordHit` | 她需要"合适的机会"→ 她恰好在场或被提到时相关 |

`goalKindOf(goal, declared)`：
- `goal` 为空 → `null`
- `declared` 存在 → 用它（`NpcProfile.goalKind`，**静态配置**）
- 否则最小推断：`/撮合|打趣|关系|在一起|联系/` → `connect`；其余 → `understand`

**两个内置 NPC 的声明**（与其 goal 文本的实际语义一致）：

| NPC | goal | goalKind |
|---|---|---|
| 小雨 | 想撮合你和主角，最近老想找机会打趣你们俩 | `connect` |
| 小美 | 想多了解主角，但一直没找到合适的机会 | `understand` |

### 2.1 边界（务必保持）

| 约束 | 实现 |
|---|---|
| goal 存在**不再**恒等于 +12 | ✅ 不相关 → `goalScoreBonus` 直接返回 0，**根本不掷骰** |
| goal 不存在**不**导致 NPC 永远无法介入 | ✅ `goalBonus` 只是评分的一个加项；其余评分项（关键词 +30 / 地点 +20 / 关系 +15/+10 / 剧情线 +15 / 随机 +8）**全部不变**，阈值仍是 25 |
| goal 不能绕过 Core | ✅ 相关性判定与 `checkInterventionSafety` 是**两条独立判定**；后者在 `runNpcIntervention` 之前独立执行 |
| goal 不能直接改世界 | ✅ 评分函数是纯函数；`screenNpcCandidates` 不写 `storyEvents` / 不改 `turnCount` / 不改情绪 / 不改进度 |

---

## 3. 是否修改任何数据结构

| 结构 | 是否修改 | 说明 |
|---|---|---|
| **`SaveV1`（存档契约）** | ❌ **未修改** | 版本号未变，字段未增删改 |
| `NpcState`（**持久化**结构） | ❌ **未修改** | 一个字段都没加 |
| `NpcProfile`（**静态配置**结构） | ✅ 新增可选字段 `goalKind?: "connect" \| "understand" \| null` | `NpcProfile` 是常量表（`NPCS`），只在 `createNpcState` 时被引用，**不进存档** |
| `StoryEvent` | ❌ 未改（Phase 4-B 已加的可选 `priority`/`source` 保持不变） | — |
| `test` 侧新增导出 | `lastGoalRelevance`（纯观测 Map，不参与逻辑） | 用于让"相关但没掷中"与"不相关"可区分 |

**结论：没有修改存档结构，因此没有触发 `DECISION_REQUIRED: npc.goal requires structured schema`。**
实现"可靠语义"所需的显式标签放在**配置层**而非持久化层，这是最小改动的路径。

---

## 4. C-2 最终状态

**正式裁定：`turnCount >= 1` 保持不变。**

| 项 | 状态 |
|---|---|
| 判据 | `if (store.turnCount < 1) reasons.push("new-save-protection")`（`chat.ts` 的 `npcProactiveReady`） |
| 含义 | 新建存档 → **第一次玩家有效回合** → NPC 获得主动交互资格（而不是立刻主动说话） |
| 是否新增常量 | ❌ 没有 |
| 是否新增 cooldown | ❌ 没有 |
| 是否修改 6 小时规则 | ❌ 没有 |

**C-2 测试**（phase 8）

```
✅ 【核心】新档保护期阻断（未完成任何有效回合时不主动）      ← turnCount = 0
✅ 【核心】turnCount = 1 后「新档保护期」不再阻塞             ← 正向断言
✅ 【核心】Redo 不额外增加 turnCount（决策 4 保持）
✅ 【核心】正常新回合仍然 +1
✅ 【核心】检查点保存了该轮开始前的 turnCount（回滚源正确）
```

> ⚠️ 正向断言的表述细节：演示模式下**能力门（`no-chat-capability`）始终存在** ——
> 它是硬门，与调度门是两回事。因此断言的是**这一条门被解除**，
> 而不是"整体 `ready === true`"（后者在演示模式下永远不成立）。

---

## 5. 测试数量

```
npm run verify  →  EXIT=0        887 断言 / 0 失败
npm run typecheck → EXIT=0
npm run build     → EXIT=0

  save-schema 单测        88  │ voice-store 单测       44
  状态闸门单测             43  │ agent-smoke            50
  CSS 等价性              12  │ 架构边界               11
  产物检查                 47  │ e2e                   583
  页面冒烟                  9
```

### 对照用户列出的 5 项测试要求

| # | 要求 | 断言 |
|---|---|---|
| 1 | goal 与当前行为相关 → 原有 +12 机制可以触发 | ✅ `相关语境下判定为 relevant`（80/80）· `原有 25% × +12 机制确实仍在工作`（实测 46/200 ≈ 23%）· `加成幅度仍是 12` |
| 2 | goal 与当前行为无关 → 不产生 +12 | ✅ `无关语境下 40 次采样，bonus>0 的次数 = 0` |
| 3 | `goal = null` → 不产生 +12 | ✅ `goal = null 时永远不相关、永不产生 +12`（40/40 为 0） |
| 4 | goal 不能绕过 NPC Core Guard | ✅ `goal 相关 + 世界安全违规（深夜）并存时 Core 仍然阻断` · `相关性判定不会解除 Core 守卫` · `已在场的 NPC 也被 Core 守卫拒绝` |
| 5 | goal 不能直接改变世界状态 | ✅ `goal 不能创建 Core Fact`（筛选不写世界档案）· `goal 不能改变 turnCount` · `goal 不能改变 NPC 主动开口的门` |

---

## 6. Defect Injection

| 注入 | 内容 | 捕获它的断言 | 结果 |
|---|---|---|---|
| **A** | 恢复 `goal != null → 无条件掷骰 +12` | `goal 存在但与场景无关时从不产生 +12` | ✅ 变红（`seen=7`） |
| **B** | 让 `isGoalRelevant` 恒返回 `true` | 同上 + `goal = null 时永远不相关` | ✅ 变红 ×2（`seen=9` / `seen=40`） |
| **C** | 让 goal 相关时 `checkInterventionSafety` 直接返回 `{ok:true}`（绕过 Core） | `私密话题被 Core 拒绝` · `goal 相关 + 世界安全违规时 Core 仍然阻断` · `相关性判定不会解除 Core 守卫` · `已在场的 NPC 也被拒绝` · `候选资格与介入许可相互独立` | ✅ 变红 ×5 |

### 6.1 过程中两次「断言不够强」的修正（值得留档）

1. **Injection C 第一次没有被捕获**。原因：我只在评分层注入"跳过安全清零"，
   而真正的许可是由 `runNpcIntervention` 之前的 `checkInterventionSafety` 独立把关 ——
   注入没有触及许可层，因此断言正确地保持绿色。
   **结论**：把注入改为直接攻击许可层（让守卫在 goal 相关时返回 `ok`），随即捕获 5 条。
   *这反过来证明了架构是对的：评分与许可是两条独立通道。*

2. **「前置事实」断言最初是空转的**。为了同时制造"goal 相关"与"世界安全违规"，
   我最初用"已在场"做违规 —— 但 `screenNpcCandidates` 会**跳过已在场的 NPC**
   （`if (npc.present) continue`），因此根本没有产生相关性判定，断言在 `undefined` 上静默通过。
   补了一条**显式的前置事实断言**（`rel?.relevant === true`）后立刻暴露，
   改用"深夜保护"（不阻止筛选、只让守卫拒绝）作为违规来源。

全部注入已 `grep -rn '🧪' playground/ tests/` 确认清除（**0 处残留**）；`tsc --noEmit` 零错误。

---

## 7. 是否还有 DECISION_REQUIRED

| # | 议题 | 状态 |
|---|---|---|
| **C-1 · npc.goal gameplay semantics** | ✅ **已裁定并落地**。goal 保留，改为真正的目标驱动加成；不相关时不产生 +12；不绕过 Core；不改世界 |
| **C-2 · NPC 主动开口的新档保护** | ✅ **已裁定**：`turnCount >= 1` 保持不变，并有正反两条断言 |
| B2-1 / B2-2 · priority 参与竞争/叙事 | ⛔ Phase 4-C 已裁定**不参与**并冻结 |
| B8-1 · `story.progress` 单步上限 | ⛔ Phase 4-C 已裁定**冻结** |
| B8-3 · narrative 进档案 | ⛔ Phase 4-C 已裁定**冻结**（G-7） |
| B8-5 · Mind/Emotion 合并 | ⛔ Phase 4-C 已裁定**暂不合并** |
| U1–U10（`ai.ts` 5 处 fetch · `AIState` 开放索引签名 · mind 默认值 3 份拷贝 · 死字段 · `tickAgenda` 不落盘 · 注释与代码不符） | 📋 **P2 整洁项**，本阶段按要求**未顺手动** |

**结论：不存在新的 `DECISION_REQUIRED`。** 唯一新增的**观测性**导出 `lastGoalRelevance`
是纯只读诊断数据，不承载任何玩法语义，因此无需决策。

---

## 8. Phase 5 readiness

# **READY**

**理由**

1. **C-1 与 C-2 都已关闭**，且关闭方式满足全部约束：
   - goal 不再"存在即 +12"，也不再"不存在就永远无法介入"
   - goal 只影响**候选评分**，不决定**资格**，不绕过 Core，不直接改世界
   - **未修改 Save Schema**（显式标签放在配置层），因此未触发 structured schema 决策
   - C-2 保持 `turnCount >= 1`，零新增常量
2. **三组 defect injection 全部可捕获**（A:1 / B:2 / C:5 条变红），
   且过程中两次"断言不够强"都被发现并修正 —— 说明这套断言是真的在把关。
3. `verify` / `typecheck` / `build` 三项均 EXIT=0；887 断言 / 0 失败；未减少任何既有覆盖。
4. 前序阶段的 10 类注入（Director 直写 store / 绕过 NPC Guard / priority 被忽略 /
   NPC 不入档 / narrative 变事实 / D4 重复累加 / 非法参与者 / 非法数值 / Redo 增计数 /
   NPC 主动门缺失）保持可复现。

**Phase 5 可以开始**（待明确指令）。建议进入时注意：
- 本阶段把 `NpcProfile` 变成了"带语义标签的配置"，若 Phase 5 要新增 NPC，应同时声明 `goalKind`；
- `lastGoalRelevance` 是诊断出口，若 Phase 5 引入调试面板可直接复用它。

---

**Phase 4-D 完成。按要求立即停止，不进入 Phase 5，未顺手修改 U1–U10。**
