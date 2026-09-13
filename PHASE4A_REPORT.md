# PHASE4A_REPORT.md

> 阶段：**Phase 4-A「修复断链 + 建立 AI Authority 边界」**
> 验证基线：`npm run verify` **EXIT=0**，**795 断言 / 0 失败**
> 全程遵守：不新增 Agent / 不新增 NPC / 不新增情绪维度 / 不引入向量库 / 不引入后端 /
> 不做离线世界模拟 / 不扩大 AI token / 不改 UI / 不改 CSS / 不改模型 / 不删旧字段

---

## 1. 4-A1 ～ 4-A8 完成情况

| 项 | 状态 | 一句话结果 |
|---|---|---|
| **4-A1** Mind / Emotion 权威归属 | ✅ 完成（结构层） | `MIND_EMOTION_CONTRACT.md` 建立；确认 `mind.ts` 对 `aiState` **零写入**（R1 本就满足）；5 组重叠被定性为「双主体同名字段」而非"双写"；需改变存档语义的 5 项全部暂停 |
| **4-A2** G-1 / 冷落系统 | ✅ 完成 | `store.turnCount` 现在是"持久化的历史有效回合数"，在**渲染落定后**自增；冷落门改为具名 `isNewSaveProtectionActive()`；`neglectContext()` 不再说谎。`events.turnCounter` **零改动** |
| **4-A3** AI Decision Gate | ✅ 完成 | 新建 `playground/state-gate.ts`（纯函数），`chat.ts` 的 **4 处** AI 数值写入改为统一过闸门 |
| **4-A4** normalizeDecision 统一保护 | ✅ 完成 | 维度白名单 / 类型 / NaN / ±Infinity / 零值 / 单步上限（25）/ 记忆操作净化 —— 全部收敛到一个校验器；**未改变任何既有阈值** |
| **4-A5** NPC → Event 因果链 | ✅ 完成 | 新增 `recordNpcInterventionEvent()`；NPC 介入现在写入世界档案（`source: "core"`） |
| **4-A6** StoryProgress 因果来源 | ✅ 分析完成（未改规则） | `STORY_CAUSALITY_REVIEW.md` 建立；确认 `storyProgress` 是全仓唯一"无 Core 规则来源"的持久化字段；候选规则 P1–P5 全部暂停待决策 |
| **4-A7** 阻止自由文本成为世界事实 | ✅ 完成 | 新增 `StoryEvent.source`（`core`/`narrative`/`director`）；`finalizeDay` 与 `journalText` 只接受 `core`。**存档版本号未变** |
| **4-A8** Director 绕过 Core 的路径 | ⚠️ **部分完成**（2/5 项需决策） | ✅ `relationshipEffect` 与 `memoryUpdate` 已纳入统一守卫；✅ `forget` 批量删除已收紧；❌ NPC 介入守卫 / `priority` 待决策（见 §16） |

---

## 2. Mind / Emotion 最终权威关系

```
        ┌──────────────────────────────────────────────────────┐
        │  主角的可量化心理与关系状态                            │
        │  权威 = aiState（38 维，0–100）                        │
        │  写入者：AI delta（经闸门）· Director（经闸门）·        │
        │          本地兜底表 · 冷落规则 · 每轮时间回归           │
        └──────────────────────┬───────────────────────────────┘
                               │ 只读派生（÷100 后混合）
                               ▼
  ┌────────────────────────────────────────────────────────────┐
  │  mind：认知与决策（不改写上面的数值）                        │
  │  userMind = 关于「用户」的观察（主体不同，不是副本）          │
  │  aiMind   = 对话层认知（38 维里没有这些概念）                 │
  │  relMind  = 张力与重大事件标记（38 维里没有）                 │
  └────────────────────────────────────────────────────────────┘
```

**三条规则（写入契约）**

- **R1** 主角的任何"可量化心理/关系"数值，权威只能是 `aiState`。Mind 不得维护第二份主角数值。
  → **已验证**：`mind.ts` 内 `aiState` 仅出现于 `aiStateView` 的读取，**零写入**。
- **R2** Mind 里的数值必须能一句话说明"它描述谁"。不得新增"描述主角但不在 `aiState` 里"的数值字段。
- **R3** 展示与叙事读 `aiState`；策略读 mind。跨读只允许经 `aiStateView` / `relationshipView` 两个显式派生入口。

**5 组重叠的定性**（`MIND_EMOTION_CONTRACT.md` §3）：sadness / anger / anxiety / loneliness（主角 vs 用户）、energy（3 个并存）。
它们**不是双写**，是**双主体同名字段**；真正的问题是 prompt 里两套数字并列且**未标注主体与量纲**。

---

## 3. AI Authority 权限矩阵（Phase 4-A 之后）

| 维度 | AI 可提议 | Core 校验 | 单步上限 | 最终写入点 |
|---|---|---|---|---|
| **Emotion**（38 维情绪/状态/阴影） | ✅ | ✅ 闸门：白名单 + 类型 + isFinite + 零值 + 维度夹取 | ✅ **±25**（`MAX_SINGLE_STEP`） | `state.ts` `applyDelta` → `clamp(0,100)` |
| **Relationship**（38 维关系组） | ✅ | ✅ **同一个闸门**（主回复 delta 与 Director `relationshipEffect` 共用） | ✅ ±25（Director 侧另有既有 δ∈[-10,10]） | 同上 |
| **NPC**（emotion / relToMain / relToUser / knownFacts / present） | ✅ | ✅ `npc.ts` 白名单循环 + `clamp` + 60 字/去重/上限 20 | ⚠️ 无显式单步上限（`clamp(0,100)` 兜底） | `applyNpcDelta` / `npcLearn` / `applyNpcResult` |
| **Memory** | ✅ | ✅ `gateMemoryUpdate` + `applyMemoryOp` | — | `applyMemoryOp`（精确匹配删除） |
| **Story**（storyProgress / activeThread / storyEvents） | ✅ 提议 | ⚠️ 仅 `clamp(0,100)` 总额；**无单轮上限**（待决策） | ❌ 待决策 | `chat.ts` `sendMessage` |
| **Event**（事件卡 / Director 事件） | ✅ 提议 | ✅ `source` 标记 + 事实过滤（只有 `core` 进档案与回注） | — | `storyEvents.push` + `isFactualStoryEvent` |
| **Time** | ❌ **不能** | N/A | N/A | 无 AI 路径（写入点已穷举） |
| **Player state**（userMind / aiMind / relMind） | ❌ 不能直接写 | 本地 `clamp01` + 固定维度表 | — | `mind.ts` 独占 |

---

## 4. Decision Gate 调用链

```
AI Output（ChatResult / DirectorDecision / NpcSpeakResult）
        ↓
Parse（`parseAIResponse` / `normalizeDecision` / 各自解析）
        ↓
Intent（字段级）
        ↓
┌───────────────────────────────────────────────────────┐
│  state-gate.ts（唯一闸门，纯函数）                      │
│   ① 维度白名单（与 DIMENSIONS 同源，非手写清单）         │
│   ② 类型必须是 number                                   │
│   ③ Number.isFinite（拦 NaN / ±Infinity）               │
│   ④ 零值丢弃（不污染 trace）                            │
│   ⑤ 单步夹取 [-25, +25]                                 │
│   ⑥ 记忆：gateMemoryUpdate + applyMemoryOp（精确删除）   │
└───────────────────────────────────────────────────────┘
        ↓
Core validation（`clamp(0,100)` 绝对值夹取 · Director 既有 δ∈[-10,10]）
        ↓
Apply（`applyDelta` / `aiState[k] = clamp(...)` / `applyMemoryOp`）
        ↓
World State
```

**禁止的形态（已封堵）**

```
❌ AI Output → 直接修改 Store
❌ AI reason / story.event → 直接进入剧情档案与回注 prompt
```

---

## 5. G-1 修复结果

| 项 | 修复前 | 修复后 |
|---|---|---|
| `store.turnCount` | **全仓无自增点**，恒为 0 | 由 `countCompletedTurn()` 在**渲染落定后**自增 |
| 语义 | 未定义（事实上的死字段） | **持久化的历史有效交互回合数**（随存档往返） |
| `events.turnCounter` | 会话级事件节奏计数 | **零改动**（仍在 `events.ts` 内自增，仍不持久化） |
| 两者关系 | 无 | **互不写入**；随机事件触发频率不变 |
| 冷落门 | `store.turnCount === 0` 恒真 | 具名 `isNewSaveProtectionActive()`，首轮完成后即关闭 |
| `neglectContext()` | 挂机时恒输出「他/她刚刚还在和你说话」（**事实错误**） | 反映真实 idle（断言：3 小时 → level 4） |
| `menu.ts` 存档卡 | 「对话 0 轮」恒定 | 显示真实回合数 |
| `relMind.lastMajorTurn` | 恒 0（死值） | 0 或等于当前回合数 |

**"一轮"的定义（`GAMEPLAY_REVIEW.md` G-9）**：① AI 真的产出了对话内容（`replyDelivered`）
**且** ② 打字机渲染落定（`ui/message.ts` 的 `onFinish`，带 15s 放弃观察）。
API 失败 / 解析失败 / 渲染卡住 → **不计数**（宁可少记一轮，不记假的）。

---

## 6. Neglect 因果链

```
每 tick（tickClock 每秒）
   ↓
story.ts maybeRandomMoment()
   ↓
isNewSaveProtectionActive()  ← 修复点：turnCount > 0 后为 false
   ├─ true （新档，未完成任何一轮）→ 允许主动开口，但把冷落计时重置到当下（保护期语义）
   └─ false（已完成过有效回合）
         ↓
      neglectLevel()
         ├─ realIdleMin  = (Date.now() - lastReplyRealAt) / 60000
         ├─ virtualIdleMin = (virtualMs - lastReplyVirtualAt) / 60000
         └─ level 0–4（阈值：3min / 8min / 20min / 45min；或虚拟 45/90/120/240min）
         ↓
      triggerNeglectReaction(neglect)
         ├─ 只在 level 升级 或 同级但已等 2 小时 时触发
         ├─ NEGLECT_DELTA[level] → 38 维情绪（loneliness / sadness / anxiety / anger / …）
         ├─ store.storyEvents.push({ …, source: "core" })   ← 4-A7：Core 事实
         └─ tryProactiveSpeakForce(情境提示) → sendMessage(proactive)
```

**同时修复的连带事实错误**：`neglectContext()` 现在读到的是真实 idle，
送给模型的「他/她已经 X 没回你了」不再恒为「刚刚还在和你说话」。

---

## 7. NPC → Event 因果链

```
maybeNpcIntervention()（仅在 !proactive 的玩家轮次后）
   ↓ screenNpcCandidates()（冷却/关键词/nearby/关系/剧情线/goal/扰动）
   ↓ decideIntervention()（概率 min(0.55, 0.2 + score/100)）
   ↓ runNpcIntervention(pick)
       ├─ npcSpeak() → 渲染 NPC 气泡（DOM）
       ├─ store.chatHistory.push ×2
       ├─ applyNpcResult() → NPC 情绪/关系/knownFacts/present
       └─ 【4-A5 新增】recordNpcInterventionEvent(npc, mode, dialogue)
             └─ store.storyEvents.push({ day, text, source: "core" })   ← Core 确认的事实
                   ↓
              journalText()（只取 core）→ 下一轮 SYSTEM_PROMPT / Director worldSnapshot
                   ↓
              finalizeDay()（只取 core）→ store.journal → journalText()
```

**修复前**：NPC 介入只写 DOM 与 `chatHistory`，`storyEvents` 完全不写 → 跨天后彻底消失
（对照 `event-card.ts` 是有写的 —— 同层功能漏了一个）。**现已在 e2e 中证明**（断言：`recordNpcEvent` 后 `storyEvents` +1 且 `source === "core"`）。

---

## 8. StoryProgress 因果分析（摘要，详见 `STORY_CAUSALITY_REVIEW.md`）

- `store.storyProgress` 是**全仓唯一"无 Core 规则来源"的持久化字段**：唯一业务写入点吃主模型 `story.progress`。
- Director 结构体**没有进度字段** → 判断"该推进剧情"却推不动进度。
- `storyStage()`（派生自 `affection`/`familiarity` 阈值）与 `storyProgress`（AI 数字累加）**两条互不相交的链**，只有并列展示、无一致性检查 → 「阶段=交心(90) 而 0%」是代码允许状态。
- **无单轮上限、无单调性、无 `isFinite` 守卫**；提示词承诺「0~5」在代码层从未实现。
- **门槛耦合**：`story.event` 为空时 `progress` 与 `thread:"end"` 全部失效。
- **重答重复累加**（`RedoCheckpoint` 不含进度字段）。
- 本阶段**未新增任何影响 `storyProgress` 的规则**；候选规则 P1–P5 全部暂停待决策。

---

## 9. Director 权限变化

| 路径 | 修复前 | 修复后 |
|---|---|---|
| `relationshipEffect`（target=main） | 自带 `δ∈[-10,10]`，**独立于主回复的校验** | ✅ 走**同一个** `gateDimensionDelta`（主回复与 Director 共用一套） |
| `relationshipEffect`（target=user） | 同上 | ✅ 同上 |
| `relationshipEffect`（target=npc） | `clamp` + `npcId` 白名单 | 保持（未动） |
| `memoryUpdate`（save / forget） | 自带 60 字截断；**forget 用子串批量删除** | ✅ `gateMemoryUpdate` + `applyMemoryOp`（**精确删除单条**） |
| NPC 介入 | 以 `score: 100` 直调，**绕过** 冷却 / 深夜保护 / 私密话题屏蔽 / 概率门 | ⚠️ **未改**（见 §16，需决策） |
| `priority` | 白名单校验后**从不消费** | ⚠️ **未改**（见 §16，需决策） |

**定位未变**：Director 仍是"世界调度器"，**没有被削成纯建议器**。
它的提议仍然能真实改变世界（关系 / 记忆 / NPC / 事件），只是现在**所有数值修改都经过同一道闸门**。

---

## 10. 自由文本事实污染是否消除

**是（在"进入世界历史"这条路上消除了）。**

| 通道 | 修复前 | 修复后 |
|---|---|---|
| `result.story.event`（主模型） | 进 `storyEvents` **且** 被 `journalText()` 回注 prompt | 标记 `narrative`：**仍展示**，但**不回注**、不进 `finalizeDay` 归档 |
| Director `reason` | 进 `storyEvents` **且** 回注 prompt（自喂环） | 标记 `director`：仍作为旁白展示，**不回注**、不进归档 |
| 事件卡 `title/scene` | 进 `storyEvents` 且回注 | 标记 `narrative`：同上 |
| 被冷落（Core 模板） | 进 `storyEvents`，回注 | 标记 `core`：**保留回注**（代码确认发生） |
| NPC 介入（4-A5 新增） | —— | 标记 `core`：**进入回注**（代码确认发生） |

**可执行证明**（e2e phase 5，全部通过）：

```
✅ 存在 narrative 来源的条目（对照物存在，断言不是空转）
✅ narrative 条目不在「既成事实」集合里（narration ≠ world state）
✅ 既成事实集合 = 档案里 source==='core' 的那些（过滤规则可验证）
✅ 剧情档案（回注 prompt 的内容）里不含任何 narrative 文本
```

**旧档兼容**：`source` 可选，缺失 → 归一化为 `narrative`（最保守默认）。
**`SAVE_VERSION` 未变，`SaveV1` 契约的既有字段语义一字未改。**

---

## 11. 存档兼容性

| 项 | 结论 |
|---|---|
| 版本号 | **未变**（仍为 `SaveV1`） |
| 新增字段 | `StoryEvent.source?`（**可选**） |
| 缺失时的行为 | `normalizeToSaveV1` 归一化为 `"narrative"` |
| 旧档语义 | **不变**（既有字段的含义、范围、校验一字未改） |
| 删除字段 | **无** |
| 删除数据 | **无** |
| 既有测试 | `save-schema` 88 条、`save-v1` e2e 8 个 phase、`save-io` 4 个 phase —— **全部通过，未修改** |

---

## 12. Gameplay 行为变化（完整清单，逐条已记入 `GAMEPLAY_REVIEW.md`）

| # | 变化 | 影响面 | 需要决策？ |
|---|---|---|---|
| **G-5** | AI 数值增量现在有单步上限 **±25** | 只拦异常值；正常对话（±1~±8）**完全不受影响**（有断言） | ⚠️ 取值需确认（提示词承诺是 ±15） |
| **G-6** | `forget` 由子串批量删除收紧为**精确删除单条** | 安全性收紧，正常语义不变 | ❌ 不需 |
| **G-7** | 剧情档案与回注 prompt **只接受 Core 事实** | ⚠️ **本阶段影响最明显**：档案会变"瘦"，模型能读到的历史事件变少 | ✅ **需要确认方向** |
| **G-8** | NPC 介入现在写入世界档案 | 模型能读到的历史变多；文本由代码模板拼接 | ⚠️ 可选（改 `source` 即可回退） |
| **G-9** | 「有效回合」= 内容产出 + 渲染落定 | `turnCount` 会比"发送次数"略少（失败轮不计数，刻意） | ❌ 不需 |
| **G-1 修复** | 冷落系统从"不可达"变为**可达**；挂机时冷落计时不再被重置 | ⚠️ **这是玩法行为的恢复**：从现在起，"用户很久没回"会真的触发她的负面情绪与质问 | ✅ 需知悉 |

**未改动的冻结项（逐条核对）**：38D 公式 · 情绪衰减回归系数 · NPC schedule · NPC 基础行为 ·
Relationship 数值规则 · Memory 基础规则（30 条/60 字上限）· Story/Event 原有概率（30%/35%/3 轮/7 轮）·
事件触发规则（`events.ts` 零改动）· 游戏结束条件（本就不存在）· 核心循环的 28 步顺序。

---

## 13. Defect Injection 结果

| # | 注入的缺陷 | 结果 |
|---|---|---|
| 1 | `countCompletedTurn()` 不自增（还原 G-1 原状） | ✅ **3 条核心断言变红**（+1 计数 / 保护期关闭 / 落盘） |
| 2 | 闸门去掉单步上限 + 去掉 isFinite 检查 + `forget` 改回子串匹配 | ✅ **9 条断言变红**（含「forget 精确删除单条」的关键反例） |
| 3 | `finalizeDay`/`journalText` 去掉事实过滤 | ✅ 过滤断言变红 |
| 4 | `recordNpcInterventionEvent` 不写档案（还原 A5 断链） | ✅ **3 条断言变红**（NPC 写入 / source 标记 / 进入既成事实集合） |

**全部注入已 `grep '🧪'` 确认清除**，且 `npx tsc --noEmit` 零错误。

---

## 14. 测试结果

```
npm run verify  →  EXIT=0        795 断言 / 0 失败
  save-schema 单测        88  │ voice-store 单测       44
  状态闸门单测（新增）      37  │ agent-smoke            50
  CSS 等价性              12  │ 架构边界               11
  产物检查                 47  │ e2e                   497
  页面冒烟                  9
```

- **新增**：`tests/state-gate.test.mjs`（37 条，纯函数单测，已接入 `test:unit`）
- **e2e 增长**：448 → **497**（renderboundary 套件 41 → **75**，新增 phase 4「回合计数与冷落门」、phase 5「闸门与事实过滤」）
- **未减少任何既有测试覆盖**：`save-schema` / `voice-store` / `agent-smoke` / `css` / `boundaries` / `dist` / `smoke` 的断言数**全部持平或增加**

---

## 15. `npm run verify` 最终结果

```
npm run verify  →  EXIT=0
```

---

## 16. 剩余 P0 / P1

### 仍需决策才能继续（本阶段**已按规则暂停**）

| # | 项 | 为什么暂停 |
|---|---|---|
| **D1** | **Director 的 NPC 介入仍绕过 4 道守卫**（6h 冷却 / 深夜保护 / 私密话题屏蔽 / 概率门） | 收紧它**会改变"离线回归与跨天时 NPC 能否出现"** = 玩法行为。且 Director 路径的介入**天然**只发生在跨天/离线，若套用 6h 冷却会让该功能失效 → 必须由你决定"哪几道守卫应该也管住 Director 路径"（我的建议：深夜保护与私密话题屏蔽应管住；冷却与概率门不应） |
| **D2** | **`priority` 校验后丢弃** | 让它生效会改变事件优先级 = 玩法；直接删除字段则不改玩法但会动 `normalizeDecision` 的契约 |
| **D3** | **`story.progress` 无单轮上限 + 门槛耦合**（`story.event` 为空则 progress 失效） | 加上限 = 玩法数值；改门槛 = 改变模型表达能力 |
| **D4** | **重答重复累加 `storyProgress`** | 这是**明确的缺陷**（`RedoCheckpoint` 不含该字段），修复只需加字段 + 回滚，**不涉及数值设计** → 建议优先批准 |
| **D5** | **4-A1 的 P1–P5**（删除 `userMind` 同名字段 / 合并 3 个 energy / 统一量纲 / prompt 合并两套数值） | 全部涉及**存档语义或玩法数值或 prompt 规模** |
| **D6** | **`G-7` 的方向确认**（剧情档案只收 Core 事实是否是你想要的） | 影响模型可见的历史量 |

### 仍是 P1（分析已就绪，不需要决策）

| # | 项 | 备注 |
|---|---|---|
| D7 | `AIState` 是开放索引签名（编译期不防拼错维度） | 见 `A5_INDEXED_ACCESS.md`：先收紧 `AIState` 键类型 |
| D8 | mind 三态默认值 **3 份拷贝**（`mind.ts` / `storage.ts` / `save-schema.ts`） | `save-schema.ts` 注释自认；收敛前需逐字段核对三份是否真的相同 |
| D9 | `ai.ts` 内 5 处 `fetch` 未走 `ai/client.ts` | 同模块内共用 headers/解析，收益小 |
| D10 | 死字段：`npc.goal`（参与 0.25 概率加分但恒为空）、`store.userLocation`、`store.pendingOvernight`、`ChatResult.stats` | 均为 P2 级 |
| D11 | `tickAgenda` 改状态不落盘 | P2 级 |
| D12 | `decideIntervention` 的两个参数未使用、注释与代码不符 | 文档修正即可 |

---

## 17. Phase 4-B 是否可以开始

# **可以开始，但建议先处理 D4（重答重复累加）**

**理由**

1. 本阶段的四道硬边界已经落地并且**有可执行证明**：
   - AI 不能扩展状态字段（维度白名单与 `DIMENSIONS` 同源）
   - AI 不能写入非法数值（类型 / NaN / ±Infinity / 单步上限）
   - AI 的自由文本**不能**成为世界事实（`source` 标记 + 事实过滤，e2e 可验证）
   - AI 不能影响时间（写入点已穷举，无路径）
2. `npm run verify` EXIT=0，795 断言；新增的 37 条闸门单测与 34 条 e2e 断言（renderboundary 套件 41 → 75）让"边界"从约定变成了**事实**。
3. 断链已接通两条（NPC → Event、回合计数 → 冷落）。
4. **建议先做 D4**：它是唯一一条"明确的缺陷、修复不涉及数值设计、影响可观测（进度条会因重答而虚高）"的项。完成它之后，Phase 4-B 的地基才是干净的。

**Phase 4-B 不应包含**：新增 Agent / 新增 NPC / 新增维度 / 向量库 / 后端 / 离线时间推进 / 扩大 token / 大规模改 prompt。

**Phase 4-B 建议包含**：D4（重答回滚进度）、D6（G-7 方向确认后的调整）、D7（`AIState` 类型收紧）、D8（默认值收敛）、D12（文档与代码对齐），以及 D1/D2/D3 的决策落地。

**按用户要求：本阶段到此停止，不自动进入 4-B。**
