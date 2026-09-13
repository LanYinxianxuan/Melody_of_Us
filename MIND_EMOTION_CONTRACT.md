# MIND_EMOTION_CONTRACT.md —— 一个概念只能有一个数值权威来源

> **4-A1 的产出。** 本文件冻结「哪个数值由谁说了算」，并给出现状的完整对照表与迁移方式。
>
> **本阶段不删除任何字段、不修改存档语义。** 凡需要改变存档语义的条目，
> 都在 §5 明确标注为「暂停并报告」，等决策。
>
> 取证方式：全仓 `grep` 穷举每个字段的读写点 + 逐消费者核对读取来源。
> 行号对应本文件写作时的工作区状态；每条同时给出函数名以便重新定位。

---

## 1. 为什么会有两份状态（历史成因）

| 模块 | 引入时间/目的 | 它当时想解决什么 |
|---|---|---|
| `state.ts` 的 38 维 `aiState` | 项目最初 | 「主角有真实情感状态」——可量化、可视化、可衰减 |
| `mind.ts` 的 `userMind` / `aiMind` / `relMind` | 后期（Agent Mind） | 「说话前先想清楚」——分析、状态转移、策略选择 |

两者服务的目标不同（**量化状态** vs **对话决策**），但**都在存数值**，
于是产生了「同一件事两个数」的结构。

**关键澄清（本契约的核心区分）**：

```
Emotion / 38 维 = 可量化的心理与关系状态（数值的权威）
Mind            = 认知、判断、意图、当前心理叙事（决策的权威）
```

**Mind 不该再保存一套与 Emotion 重复的数值真相。**

---

## 2. 现状总表（字段 / 来源 / 消费者 / 语义 / 是否重叠 / 最终权威 / 迁移方式）

### 2.1 `aiState`（38 维，`state.ts:18-62`，量纲 0–100）

| 组 | 维度 | 当前来源（写入点） | 当前消费者 | 与 Mind 重叠 | 最终权威 | 迁移方式 |
|---|---|---|---|---|---|---|
| personality ×5 | openness…neuroticism | 初值 `baseline`；`applyDelta` 的 AI delta；`initStateForRelation` | `SYSTEM_PROMPT`（`ai.ts:51`）· 面板 · `finalizeDay` 阈值 | ❌ 无 | **`aiState`** | 不动 |
| relation ×6 | affection / trust / intimacy / loyalty / dependence / familiarity | `applyDelta`（AI）· Director `relationshipEffect` · `NEGLECT_DELTA` · `initStateForRelation` | `storyStage()`（`story.ts:38`）· `proactiveDrive()`（`story.ts:54-60`）· `relationshipView()`（`mind.ts:667-669`）· `finalizeDay` · 面板 · 菜单 | ⚠️ `relationshipView` 把它们 ÷100 后与 `relMind.tension` 混合 | **`aiState`** | 不动（`relMind.tension` 见 §2.2） |
| emotion ×12 | joy…anticipation | `applyDelta`（AI）· `USER_EMOTION_FIX` · `NEGLECT_DELTA` · `initStateForRelation` | `SYSTEM_PROMPT` · `describeMood()`（`state.ts:186`）· `aiStateView()`（`mind.ts:679-681`）· `proactiveDrive()` · `action-suggest.ts` · `finalizeDay` · 面板 | ⚠️ 与 `userMind` 的 5 个同名字段**语义相同但主体不同**（见 §3） | **`aiState`**（对"主角"而言） | 不动；mind 侧改为"关于用户的观察"（§5-M2） |
| status ×5 | fatigue / energy / stress / nervousness / confidence | 同上；`fatigue` 另有每轮 `+0.015`（`state.ts:172`） | 同上 | ⚠️ `aiMind.energy` 语义不同（对话精力）；`aiStateView` 混合两者（`mind.ts:682`） | `aiState`（身体精力）· `aiMind`（对话精力）**两者并存且各有消费者 → 见 §5-M1** | 加注释区分语义；**不合并** |
| shadow ×10 | greed…guilt | `applyDelta` · `initStateForRelation` | `SYSTEM_PROMPT` · 面板 | ❌ 无 | **`aiState`** | 不动 |

### 2.2 `userMind`（14 字段，0–1，`store.userMind`）

> **语义澄清（本契约最重要的结论）**：`aiState` 描述的是**主角**。
> `userMind` 描述的是**用户**（经本地规则从用户消息推断）。
> 因此它们**不是同一实体的两个副本**，「一个概念两个权威」的真正冲突
> 只在 **§3 的 5 组"同名且被当作同一件事"** 处成立。

| 字段 | 当前来源（写入点） | 当前消费者 | 语义 | 与 `aiState` 重叠 | 最终权威 | 迁移方式 |
|---|---|---|---|---|---|---|
| `sadness` `anger` `anxiety` `loneliness` | `updateUserState`（`mind.ts:536`）· `applyTimeDecay`（`mind.ts:494`） | `selectStrategy`（`mind.ts:691`）· `buildAgentPrompt`（`mind.ts:904-909`） | 用户当前情绪 | ⚠️ **与主角同名维度被并列写进同一 prompt** | 主角侧=`aiState`；用户侧=`userMind`（**主体不同，均保留**） | 加注释区分主体；prompt 里显式标注"这是用户的"（§5-M2） |
| `fear` `stress` `embarrassment` | 同上 | 同上 | 用户情绪 | ⚠️ 同上 | 同上 | 同上 |
| `disappointment` `happiness` `interest` `social_need` `willingness_to_talk` `energy` | `updateUserState` / `applyTimeDecay` | `selectStrategy` · prompt | 用户状态 | ❌ `aiState` 中**没有**对应维度 | **`userMind`** | 不动 |
| `tension` | `updateUserState`（`mind.ts:556`） | `selectStrategy` | 用户紧张度 | ❌ 38 维无 | **`userMind`** | 不动（注意与 `relMind.tension` 是两个变量） |

### 2.3 `aiMind`（9 数值 + 1 字符串，0–1，`store.aiMind`）

| 字段 | 当前来源 | 当前消费者 | 语义 | 与 `aiState` 重叠 | 最终权威 | 迁移方式 |
|---|---|---|---|---|---|---|
| `energy` | `updateAiMind`（`mind.ts:628-631`） | `aiStateView`（`mind.ts:682`）· prompt | **对话精力**（非身体精力） | ⚠️ 名字与 `aiState.energy` 相同 | **两者并存**，各有消费者（`aiStateView` 显式混合 0.7/0.3） | 加注释；**不合并**（合并会改玩法） |
| `interest` `patience` `curiosity` `defensiveness` `topicFatigue` `willingness_to_talk` `social_need` `comfortCount` `lastTopic` | `updateAiMind` / `selectStrategy` | `selectStrategy` · prompt | 对话层认知与耐心 | ❌ `aiState` 无 | **`aiMind`** | 不动 |

### 2.4 `relMind`（3 数值 + 1 字符串）

| 字段 | 当前来源 | 当前消费者 | 与 `aiState` 重叠 | 最终权威 | 迁移方式 |
|---|---|---|---|---|---|
| `tension` | `updateRelationship`（`mind.ts:654-661`） | `relationshipView`（`mind.ts:670`）· `selectStrategy` | ❌ 38 维**没有**张力维度 | **`relMind`** | 不动 |
| `lastMajorLabel` `lastMajorTurn` `lastMajorVirtualAt` | `runAgentPipeline`（`mind.ts:948-950`） | `relationshipView`（衰减系数）· prompt | ❌ 无 | **`relMind`** | 不动 |

---

## 3. 真正需要处理的 5 组重叠（本契约的核心）

只有这 5 组是「**同一主体、同一语义、两个数**」，也就是本契约要消灭的对象。

| # | 组 | 主角侧（权威） | Mind 侧 | 当前是否会被并列展示 | 实际冲突风险 |
|---|---|---|---|---|---|
| O1 | 悲伤 | `aiState.sadness`（0–100） | `userMind.sadness`（0–1） | ✅ 同一 prompt | 低（主体不同，但**未标注主体**，模型可能混淆） |
| O2 | 愤怒 | `aiState.anger` | `userMind.anger` | ✅ 同一 prompt | 同上 |
| O3 | 焦虑 | `aiState.anxiety` | `userMind.anxiety` | ✅ 同一 prompt | 同上 |
| O4 | 孤独 | `aiState.loneliness` | `userMind.loneliness` | ✅ 同一 prompt | **中**：`proactiveDrive`（用主角侧）与 `companionshipNeed`（用用户侧）会得出不同结论 |
| O5 | 精力 | `aiState.energy`（0–100，身体） | `aiMind.energy` + `userMind.energy`（0–1，对话/用户） | ✅ 同一 prompt | 低（`aiStateView` 已显式混合，用户侧不参与）。**但 3 个 energy 并存，新人极易误用** |

**注意：这 5 组都不是"双写"，而是"双主体同名字段"** —— Mind 侧描述用户、`aiState` 侧描述主角。
真正的问题是**同一份 prompt 里两套数字并列且未标注主体/量纲**，
让模型（和读代码的人）无法判断"哪个 0.60 是谁的"。

---

## 4. 权威关系（本契约的裁决）

```
                     ┌─────────────────────────────────────────┐
                     │  主角的可量化心理与关系状态              │
                     │  权威 = aiState（38 维，0–100）          │
                     │  写入者：AI delta（经闸门）· Director     │
                     │          · 本地兜底表 · 冷落规则 · 时间回归│
                     └───────────────┬─────────────────────────┘
                                     │ 只读派生（÷100 后混合）
                                     ▼
   ┌──────────────────────────────────────────────────────────────┐
   │  mind：认知与决策（不改写上面的数值）                          │
   │  userMind = 关于**用户**的观察（主体不同，不是副本）           │
   │  aiMind   = 对话层认知（interest/patience/…，38 维里没有）     │
   │  relMind  = 张力与重大事件标记（38 维里没有）                  │
   └──────────────────────────────────────────────────────────────┘
```

**三条不可违反的规则**

1. **R1 · 主角的任何"可量化心理/关系"数值，权威只能是 `aiState`。**
   Mind 不得维护第二份主角数值。当前 `mind.ts` 对 `aiState` **只有读取、零写入**（`grep` 验证：`mind.ts` 内 `aiState` 仅出现于 `aiStateView` 的 `const g = (k) => aiState[k] ?? 0`）→ **R1 已被满足，无需改动。**
2. **R2 · Mind 里的数值必须能被一句话说明"它描述谁"。**
   `userMind.*` 描述用户；`aiMind.*` 描述对话层；`relMind.*` 描述关系状态。
   **不得新增"描述主角、但不在 `aiState` 里"的数值字段。**
3. **R3 · 展示与决策各自读各自的权威，但不许混用。**
   展示（面板/菜单/存档摘要）与叙事（`storyStage`/`proactiveDrive`/Director）**读 `aiState`**；
   策略（`selectStrategy`）**读 mind**。跨读只允许经 `aiStateView` / `relationshipView` 这两个**显式派生**入口。

---

## 5. 迁移方式（本阶段做了什么 / 什么被暂停）

### 已实施（不改变存档语义、不改变玩法数值）

| # | 动作 | 说明 |
|---|---|---|
| M1 | **建立本契约** | 明确 R1–R3 与 5 组重叠的处理原则 |
| M2 | **prompt 里标注主体与量纲** | ⏸ **暂停**：`buildAgentPrompt` 的 `USER` / `AI` 段文字属于「大规模改 prompt」的禁止项，留待决策 |
| M3 | **为同名不同义的字段加语义注释** | 计划中（`aiMind.energy` / `userMind.energy` / `aiState.energy` 三者各加一句"描述什么"） |
| M4 | **禁止新增"主角数值"到 Mind** | 写成本契约 R2 的规则；由 code review 保证（`tests/boundaries.test.mjs` 当前无法断言语义，暂不做静态检查） |

### 暂停并报告（需要改变存档语义 / 玩法数值 → 等决策）

| # | 动作 | 为什么必须暂停 |
|---|---|---|
| **P1** | 删除 `userMind` 中与主角同名的 5 个字段（O1–O4） | **它们是"用户"的状态，不是副本。删除会让策略层失去用户侧输入 → 直接改变玩法** |
| **P2** | 合并 3 个 `energy` | `aiStateView` 的 `0.7/0.3` 混合权重是既有玩法数值；合并必然改变它 |
| **P3** | 把 `aiState` 的 0–100 统一为 0–1 | **改变存档语义**（所有历史存档的数值含义变化），属禁止项 |
| **P4** | 让 mind 直接读写 `aiState`（取消 `aiStateView`） | 会改变策略层的输入分布 → 改变玩法 |
| **P5** | 在 prompt 里合并两套数值为一份 | 「大规模改 prompt」禁止项；且会改变模型可见信息 |

**结论：4-A1 的目标在"结构澄清"层面已达成（R1 本就满足、R2/R3 成为明确规则、5 组重叠被定性）；在"删除重复字段"层面必须停在 P1–P5，因为它们全部涉及玩法数值或存档语义。**

---

## 6. 复现命令（行号漂移时用）

```bash
cd /root/github/Melody_of_Us
# 主角数值的唯一写入者（应当只有 state.ts / chat.ts / story.ts / storage.ts）
grep -rn 'aiState\[' playground/ | grep -v '//'
# mind 是否写 aiState（应当无命中）
grep -rn 'aiState' playground/mind.ts
# 两套数值的消费者
grep -rln 'aiState\[' playground/*.ts playground/*/*.ts
grep -rln 'userMind\|aiMind\|relMind' playground/*.ts playground/*/*.ts
```
