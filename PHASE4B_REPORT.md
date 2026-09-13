# PHASE4B_REPORT.md

> 阶段：**Phase 4-B「World Director + NPC + Event 因果链」**
> 验证基线：`npm run verify` **EXIT=0**，**839 断言 / 0 失败**
> 未改动：38D 公式 · 情绪衰减 · 关系公式 · NPC schedule · Memory 基础规则 · 事件概率 ·
> Story 概率 · 既有阈值 · 游戏结束条件 · 核心循环顺序 · Save Schema 语义（版本号未变）

---

## 1. D4 修复（重答重复累加 storyProgress）

### 1.1 缺陷定位

`RedoCheckpoint`（`chat.ts`）的字段清单里**没有 `storyProgress`**，
`reAnswerAt` 的回滚清单也**没有它**：

```
快照字段：domStart · userText · proactive · aiStateSnap · historyLen
          · storyLen · memLen · thread · agendaSnap · agentSnap
回滚动作：Object.assign(aiState,…) · restoreAgentMind(…) · chatHistory.length
          · storyEvents.length · memories.length · activeThread · agenda
          → ❌ storyProgress 从不回滚
```

同时 `sendMessage` 会再次执行 `store.storyProgress = clamp(round(old + story.progress))`
→ **同一轮重答 N 次 = 进度累加 N 次**（进度条虚高，且会提前顶到 100）。

### 1.2 修复

| 动作 | 位置 |
|---|---|
| `RedoCheckpoint` 新增 `storyProgressSnap: number` | `chat.ts` |
| 快照写入 `storyProgressSnap: store.storyProgress` | `chat.ts` 的 `turnCheckpoints.push` |
| 回滚新增 `store.storyProgress = cp.storyProgressSnap` | `chat.ts` 的 `reAnswerAt` |

**约束遵守**：未改数值设计（仍是 `clamp(0,100)` 的累加）· 未改单步上限 · 未改阈值 · 未改事件概率 ·
未改核心循环顺序 · 未改 Save Schema（`storyProgress` 字段语义一字未动）。

### 1.3 首次 / 重答行为确认（e2e phase 6，7 条断言）

```
✅ 首次回答让 progress 正常变化（原有行为未被改变）
✅ 检查点保存了该轮开始前的 storyProgress（回滚源正确）
✅ 重复重答同一轮不会让进度单调增长（缺陷版的判据）
✅ 每次重答都从同一起点重算（增量不超过单轮上限 3）
✅ 5 次重答后进度仍 ≤ 起点 + 单轮上限（未累加 5 轮）
✅ 进度仍在合法区间内
```

**观测数据**：
- 修复版：`start=0 序列=[1,2,2,3,3]` —— 在单轮上限内波动，**不增长**
- 缺陷版：`start=0 序列=[2,5,6,9,11]` —— **单调增长**

---

## 2. Director Intent Contract（4-B1）

产出：**`DIRECTOR_INTENT_CONTRACT.md`**。

### 字段归属

| 字段 | 归属 | Core 的处置 |
|---|---|---|
| `needEvent` | AI 建议 | `!!` 强制布尔 |
| `eventType` | AI 建议 | **白名单**；未命中 → 回落 `"none"` |
| `priority` | AI 建议 | **白名单**；未命中 → 回落 `"world"`（见 §3） |
| `npcId` | AI 建议 | 三重校验：`string` + 非空 + `store.npcs[id]` 存在 + `!npc.present` |
| `reason` | **AI 解释** | 只 `slice(0,30)`；作为旁白与档案文本，`source: "director"` → **不回注 prompt** |
| `relationshipEffect.delta` | AI 建议数值 | `[-10,10]` 夹取 → 状态闸门 ±25 → `clamp(0,100)`；`δ=0` 整条丢弃 |
| `memoryUpdate.content` | AI 建议内容 | `gateMemoryUpdate`：非字符串/空白/超长 → 净化或丢弃 |

### 五问回答

| 问题 | 答案 |
|---|---|
| 哪些是 **AI 建议** | 全部。没有任何字段具有强制力 |
| 哪些由 **Core 决定** | ① 事件是否真的发生 ② 数值幅度 ③ 参与者是否合法 ④ 记忆操作是否被接受 |
| 哪些**可以影响世界** | `eventType` · `npcId` · `relationshipEffect.*` · `memoryUpdate.*` |
| 哪些**只能用于解释/debug** | `reason` · `priority` |
| 哪些**必须经 State Gate** | `relationshipEffect.delta` · `memoryUpdate` · `npcId` |

### 新增的 Core 裁决层（可独立验证）

```ts
adjudicateIntentForTest(raw) → { decision, allowed, reasons }
```

把「归一化」与「应用」分开，于是"**Core 到底会不会允许这件事**"第一次成为**可断言的事实**，
而不是只能读代码推断。**它不执行任何世界修改。**

---

## 3. priority 的最终处理（4-B2）

### 调查结论

- 修复前 `priority` **被 `normalizeDecision` 校验后从未被消费**（全仓仅两处命中：写默认值、写校验值）。
- **代码不足以安全确定 `priority` 的语义**：Director 每轮最多产生**一个**事件
  （`DirectorDecision` 是单事件结构，没有队列）；`events.ts` 的随机种子与 `event-card.ts`
  是**独立并行通道**，各有自己的节奏计数器；**没有任何事件竞争/排序机制**。
- 因此"让 priority 决定事件竞争顺序"需要**新增事件队列与竞争规则 = 新增玩法** → 禁止项。

### 本阶段的选择（不发明规则）

**把 `priority` 从"校验后丢弃"变为"可追溯"，但绝不影响世界。**

| 动作 | 说明 |
|---|---|
| ① 保留白名单校验 | 未命中 → 回落 `"world"` |
| ② `StoryEvent.priority?`（**可选字段**） | Director 产出的事件带上当时的调度等级；旧档缺失 → 归一化为 `"world"`。**存档版本号未变** |
| ③ 写进契约 | `priority` **不参与**任何数值计算：不改情绪/关系/概率/进度/分支选择 |

### defect injection 可捕获性

部署缺陷注入 #3（删除 `priority: decision.priority`）后：

```
❌ 【核心】priority 一路带到世界档案（缺失即为「被忽略」）
   ← {"day":1,"text":"（4-B2）优先级应被追溯","source":"director","priority":"world"}
```

**断言变红 → 满足"priority 被完全忽略时测试必须失败"的要求，且未引入新玩法。**

---

## 4. NPC intervention 的 Core boundary（4-B3）

### 缺陷原貌

Director 路径以 `score: 100` **直调** `runNpcIntervention`，
**完全绕过** `screenNpcCandidates` 的全部检查 —— 包括与世界安全有关的那些。
即「导演可以决定在深夜、在私密话题里、甚至用一个不存在的 NPC 强行插入」。

### Core / Director 的职责切分（本阶段的核心裁决）

| 类别 | 内容 | 谁负责 | 对 Director 是否生效 |
|---|---|---|---|
| **世界安全规则** | 参与者合法性（存在 / 未在场 / 未在进行中的介入）· 深夜与睡眠保护 · 私密话题限制 | **Core**（`checkInterventionSafety`） | ✅ **必须遵守** |
| **调度条件** | 6 小时冷却 · Director 自己的概率门 · 跨天调度 · 离线调度 | **Director** | ⚠️ **不由 Core 阻断** |

**为什么不把调度条件也交给 Core**：Director 的 NPC 介入**天然只发生在跨天与离线回归**这两个时刻。
若对这两条路径套用 6 小时冷却与概率门，跨天/离线介入会**直接失效** ——
那是把已批准的功能关掉，不是"加强 Core 保护"。

### 实现

新增 `checkInterventionSafety(npcId, recentText, { npcBusy })`（`intervention.ts`），
返回 `{ ok, reason }`，`reason ∈ unknown-npc | npc-present | npc-asleep | late-night | private-topic | npc-busy`。
**私密话题正则提升为单一来源**（`PRIVATE_TOPIC_PATTERN`），常规路径与 Core 守卫共用同一份规则。

### 端到端断言（e2e phase 5 + phase 7）

```
✅ 合法介入通过 Core 守卫（不存在的冲突）
✅ 【核心】不存在的 NPC 被 Core 拒绝（非法参与者）
✅ 【核心】null / 空 npcId 被 Core 拒绝
✅ 【核心】已在场的 NPC 被 Core 拒绝（不重复触发）
✅ 【核心】深夜/睡眠中的 NPC 被 Core 拒绝（深夜保护）
✅ 恢复作息后同一 NPC 重新合法（断言不是恒定拒绝）
✅ 【核心】私密话题被 Core 拒绝（私密话题限制）
✅ 【核心】非法参与者的 Intent 被 Core 拒绝
✅ 【核心】被拒绝的 Intent 不产生任何世界事件（Director 不能绕过 Core）
```

---

## 5. NPC → Event → Story 因果链（4-B4 / 4-B5）

```
NPC Intervention（runNpcIntervention）
        ↓
Core confirmation（recordNpcInterventionEvent —— 代码确认这次介入真的发生了）
        ↓
StoryEvent(source="core")   ← 只有 Core 能产出事实
        ↓
store.storyEvents
        ↓
journal（finalizeDay 只取 core）
        ↓
future world context（journalText 只取 core → SYSTEM_PROMPT / Director worldSnapshot）
```

**两条被明确禁止的形态已封堵**

| 禁止形态 | 现状 |
|---|---|
| `NPC intervention → 只显示在 UI` | ❌ 不再可能：`recordNpcInterventionEvent` 写入 `storyEvents`（断言可证） |
| `AI 描述 NPC 来了 → 系统自动认为 NPC 来了` | ❌ 不再可能：AI 文本标 `narrative`，**不进**既成事实集合 |

**要求证明的 5 条，全部有断言**

| 要求 | 断言 |
|---|---|
| NPC intervention 能进入 world archive | ✅ `NPC 介入真的写入了世界档案（此前完全不写 → 断链）` |
| archive 中 `source = core` | ✅ `NPC 事件被标记为 Core 事实（不是 AI 叙述）` |
| narrative 不会进入事实集合 | ✅ `narrative 条目不在「既成事实」集合里（narration ≠ world state）` |
| 下一轮上下文可以看到 Core-confirmed fact | ✅ `NPC 事件进入了「既成事实」回注集合` |
| 删除/过滤 narrative 不会删除 Core fact | ✅ `既成事实集合 = 档案里 source==='core' 的那些（过滤规则可验证）` |

**4-B5（事件的事实确认属于 Core）**：Director 的 `eventType: weather_change` 一类提议
在 `normalizeDecision` 白名单之外会被强制回落 `"none"` → **不产生任何事件**
（断言：`未知 eventType 的 Intent 不产生任何事件`）。
即使命中白名单，`story_event`/`world_event` 产出的也只是 `source: "director"` 的**叙述**，
**不回注 prompt、不进剧情档案**。AI 的自然语言无法成为 world state。

---

## 6. Core Fact / Narrative 分离（4-A7 的延续与加固）

| 来源 | 产出者 | `source` | 展示 | 进剧情档案 | 回注 prompt |
|---|---|---|---|---|---|
| 被冷落反应 | Core 模板 + 本地时钟 | `core` | ✅ | ✅ | ✅ |
| NPC 介入（4-A5 新增） | 代码模板 + NPC 资料 | `core` | ✅ | ✅ | ✅ |
| 主模型 `story.event` | 主模型 | `narrative` | ✅ | ❌ | ❌ |
| 事件卡 `title/scene` | 模型或内置池 | `narrative` | ✅ | ❌ | ❌ |
| Director `reason` | Director | `director` | ✅ | ❌ | ❌ |

**可判定规则**：`isFactualStoryEvent(e) === (e.source ?? "narrative") === "core"`。
`STORY_EVENT_FACT_SOURCES = new Set(["core"])` —— 一处常量，可审计。

---

## 7. Director 权限边界（4-B6）

| Director **可以** | Director **不可以** |
|---|---|
| 观察世界（`worldSnapshot()` 只读） | 直接写 `store` / `aiState`（必须经 `executeDirectorDecision`） |
| 提议事件（`needEvent` / `eventType`） | 决定事件**最终是否发生** |
| 指定参与者（`npcId`） | 使用不存在的/已在场的 NPC |
| 提议关系变化方向与幅度 | 决定**实际落地幅度**（`[-10,10]` → 闸门 ±25 → `clamp(0,100)`） |
| 提议记忆操作 | 用短串批量删除记忆（已收紧为精确匹配） |
| 表达优先级（`priority`） | 用优先级改变概率/幅度/分支 |
| 解释自己的决定（`reason`） | 让解释变成世界事实 |

**Director 明确不负责**：情绪公式 · 关系公式 · 事件概率的最终裁决 · 时间推进 · 存档 ·
世界事实确认 · Core rule。**它没有被削成纯建议器** —— 它的提议仍能真实改变世界，
只是所有数值修改都经过同一道闸门，且参与者的合法性由 Core 判定。

---

## 8. NPC 最小自主行为闭环（4-B7）

```
NPC schedule（npcScheduleAt：纯函数查表，由 virtualMs 决定）
        ↓ tickNpcWorld（页面开着时每秒）
NPC state（location / activity / label）
        ↓
Director 判断是否值得介入（detectTrigger + callDirector，只在代码层 trigger 命中时）
        ↓
Intent（normalizeDecision：白名单 / 存在性 / 范围）
        ↓
Core validation（adjudicateIntent → checkInterventionSafety 世界安全守卫）
        ↓
NPC action（runNpcIntervention → npcSpeak）
        ↓
Event（recordNpcInterventionEvent）
        ↓
World state（npc.emotion / relToMain / relToUser / knownFacts / present / history）
        ↓
Narration（渲染 NPC 气泡；主角回应）
        ↓
World archive（storyEvents, source: "core"）→ journal → future context
```

**闭环已成立**：NPC 的位置/活动随虚拟时间自主推进（每秒，**不需要玩家点击**），
并且一旦真的介入，就会在世界档案里留下 Core 事实、进入后续上下文。

**本阶段未加入**（严格遵守禁止项）：Vector DB · 后端 · 多 Agent framework ·
长期后台 simulation · 新情绪维度 · 新数据库 · 新模型 · 新 AI Provider · Service Worker · 离线模拟。

**DECISION_REQUIRED（B7-1）**：NPC 目前**没有"不等玩家输入就说话"的通路**
（`maybeNpcIntervention` 只在 `!proactive` 的玩家轮次后调用）。
让它能自发开口 = **新增一条触发规则** → 属玩法决策，未自行实现。

---

## 9. 测试数量

```
npm run verify  →  EXIT=0        839 断言 / 0 失败
  save-schema 单测        88  │ voice-store 单测       44
  状态闸门单测             37  │ agent-smoke            50
  CSS 等价性              12  │ 架构边界               11
  产物检查                 47  │ e2e                   541
  页面冒烟                  9
```

**e2e 增长**：497 → **541**（renderboundary 套件 75 → **119**，新增 phase 6「D4 重答」、phase 7「Director 不能绕过 Core」）

**本期新增的断言覆盖**（对照 4-B9 的要求）：

| 类别 | 覆盖 |
|---|---|
| Director · intent contract | 字段保留 / 未知 eventType 回落 / 未知 priority 回落 / 非法 npcId 清空 / 非法数值夹取 / 非法 memoryUpdate 丢弃 |
| Director · priority | 校验保留 + **端到端带到档案**（可被注入捕获） |
| Director · invalid intent | 未知 eventType 不产生事件 · 非法参与者被拒绝 |
| Director · nonexistent NPC | `unknown-npc` · `npc-not-participable` |
| Director · illegal participant | `npc-present` 拒绝 |
| Director · cannot bypass Core | **端到端**：被拒绝的 Intent 不产生任何世界事件 · 不产生事件的 Intent 绝不新增档案条目 |
| NPC · intervention | 世界安全守卫 6 种 reason 全覆盖 · "不是恒定拒绝"反向断言 |
| NPC · intervention → event → archive → core | 全部 5 条要求 |
| Story · core fact / narrative / director | source 标记完整性 · 既成事实集合可验证 · prompt 不含 narrative |
| Regression · D4 / neglect / turnCount / State Gate / event cadence | phase 4（9 条）+ phase 6（6 条）+ phase 5（闸门 6 条）+ 原有 neglect/turnCount 断言 |

**未减少任何既有测试覆盖**。

---

## 10. Defect Injection 结果

按要求注入 **8 类**破坏，每一类都确认「注入 → 测试失败 → 恢复 → 测试通过」。

| # | 注入的破坏 | 捕获它的断言 | 结果 |
|---|---|---|---|
| 1 | **Director 直接写 store**（在裁决层插入 `storyEvents.push`） | `不产生事件的 Intent 绝不新增档案条目（Director 不能直写 store）` | ✅ 变红 |
| 2 | **Director 绕过 NPC Core Guard**（删掉 `safety.ok` 分支） | `已在场的 NPC 被 Core 拒绝` + **`非法参与者的 Intent 被 Core 拒绝`**（独立于守卫函数的判定，见下） | ✅ 变红 ×2 |
| 3 | **priority 被完全忽略**（删掉 `priority: decision.priority`） | `priority 一路带到世界档案（缺失即为「被忽略」）` | ✅ 变红 |
| 4 | **NPC intervention 不进入 story archive**（`void npcEventText`） | `NPC 介入真的写入了世界档案` · `NPC 事件被标记为 Core 事实` · `NPC 事件进入了「既成事实」回注集合` | ✅ 变红 ×3 |
| 5 | **narrative 被错误加入 factual context**（`FACT_SOURCES` 加入 `"narrative"`） | `narrative 条目不在「既成事实」集合里` · `既成事实集合 = core 的那些` · `既成事实集合是全部档案的子集` | ✅ 变红 ×3 |
| 6 | **D4 re-answer 重复累加**（删掉 `store.storyProgress = cp.storyProgressSnap`） | `重复重答同一轮不会让进度单调增长` · `每次重答都从同一起点重算` · `5 次重答后进度仍 ≤ 起点 + 单轮上限` | ✅ 变红 ×3（序列 `[2,5,6,9,11]`） |
| 7 | **非法 NPC participant 被放行**（`npc-present` 检查删除 + `normalizeDecision` 不校验存在性） | `已在场的 NPC 被 Core 拒绝` + `不存在的 NPC 被 Core 拒绝` + `非法参与者的 Intent 被 Core 拒绝` | ✅ 变红 ×3 |
| 8 | **非法数值修改**（状态闸门去掉单步夹取） | 单测 `正向量夹到 +25` / `负向量夹到 -25` / `刚超上限也被夹`；e2e `单步上限生效（9999 → 25）` | ✅ 变红 ×4 |

**注入 2 的一处工程改进值得记录**：初始版本的"绕过守卫"注入**没有被捕获** ——
因为断言只验证了 `checkInterventionSafety` 的返回值，而删掉调用点并不会改变该函数的返回值。
为此补了一条**不依赖守卫函数是否被调用**的独立判据：

```ts
} else if (decision.npcId === null) {
    // Director 提出的参与者在归一化后消失了（不存在 / 已在场）
    reasons.push("npc-not-participable");
}
```

这条判据只依赖 `normalizeDecision` 的输出，因此"绕过守卫"无法蒙混过关。
**这正是"只测函数、不测通路"的典型陷阱**，已在本报告留档。

全部注入已 `grep -rn '🧪' playground/` 确认清除（0 处残留），`tsc --noEmit` 零错误。

---

## 11. `npm run verify` 结果

```
npm run verify  →  EXIT=0        839 断言 / 0 失败
```

---

## 12. 未解决问题

| # | 问题 | 现状 |
|---|---|---|
| U1 | `ai.ts` 内 5 处 `fetch` 未走 `ai/client.ts` | 同模块内共用 headers 与解析，收益小 |
| U2 | `AIState` 是开放索引签名（编译期不防拼错维度） | 见 `A5_INDEXED_ACCESS.md` |
| U3 | mind 三态默认值 **3 份拷贝** | 收敛前需逐字段核对三份是否真的相同 |
| U4 | 死字段：`npc.goal`（参与 0.25 概率加分但恒为空）· `store.userLocation` · `store.pendingOvernight` · `ChatResult.stats` | P2 |
| U5 | `tickAgenda` 改状态不落盘 | P2 |
| U6 | `decideIntervention` 的两个参数未使用、注释与代码不符 | P2（文档修正即可） |
| U7 | 私密话题正则仍是**中缀匹配**（`/喜欢你/` 之类），可能出现误判 | 与既有行为一致，未改（改它会变玩法） |
| U8 | `story.progress` 无单轮上限、无单调性、门槛耦合（`story.event` 为空则 progress 失效） | 见 `STORY_CAUSALITY_REVIEW.md` 的 P3/P4 |
| U9 | 4-A1 的 P1–P5（删除 `userMind` 同名字段 / 合并 3 个 energy / 统一量纲 / prompt 合并两套数值） | `MIND_EMOTION_CONTRACT.md` §5 |
| U10 | `G-7` 的方向确认（剧情档案只收 Core 事实是否是你想要的） | `GAMEPLAY_REVIEW.md` |

---

## 13. DECISION_REQUIRED 清单

> 以下每一项都**必须由你决定**，本阶段**未自行实现**（按规则暂停）。

| # | 议题 | 为什么需要决策 | 我的建议（仅供参考） |
|---|---|---|---|
| **B2-1** | 是否让 `priority` 参与**事件竞争/排序**（例如 main 事件挤掉 world 事件） | 需要新增事件队列与竞争规则 = **新增玩法**；当前架构下无法安全推断语义 | 暂不做。当前把它做成"可追溯"已满足"不被忽略"的要求 |
| **B2-2** | 是否让 `priority` 影响**叙事长度/侧重** | 属 prompt 规模与叙事权重调整 | 暂不做 |
| **B7-1** | NPC 是否要能**不等玩家输入就说话**（自发开口） | = 新增一条触发规则，属玩法 | 若要，建议复用 `tryProactiveSpeak` 的门控（冷却/等待回复/深夜保护已就位），只新增触发条件 |
| **B8-1** | `story.progress` 是否加**单轮上限**（落实提示词承诺的 0~5） | 玩法数值 | 建议加，但取值需你定 |
| **B8-2** | 重答是否也应回滚 `turnCount` | 当前**不回滚**（重答被计为一次新的有效回合）。这符合"有效回合"的定义，但你可能期望它是"同一轮" | 保持现状（更快回滚会让菜单的"对话 N 轮"变成"重答次数不算"） |
| **B8-3** | `G-7`（剧情档案只收 Core 事实）方向确认 | 影响模型可见的历史量 | 保持；若觉得档案太"瘦"，可把 `narrative` 加入 `STORY_EVENT_FACT_SOURCES`（一处常量） |
| **B8-4** | `G-5`（单步上限 ±25）取值确认 | 提示词承诺是 ±15 | 保持 25（宽于承诺，只拦异常值） |
| **B8-5** | 4-A1 的 P1–P5（Mind/Emotion 的字段合并与量纲统一） | 涉及**存档语义**与玩法数值 | 全部保持现状 |
| **B8-6** | `npc.goal` 是否要接线（目前是死字段，却参与 `Math.random() < 0.25` 的加分） | 接线 = 新增 NPC 目标系统 = 新增玩法 | 建议先记录；若要接线，需设计"目标从哪来" |

---

## 14. 最终验收：核心链路已被测试证明

```
AI（Director JSON）
  ↓  ✅ 可断言：字段级白名单 / 类型 / 范围 / 存在性（phase 5、phase 7）
Intent（normalizeDecision）
  ↓  ✅ 可断言：adjudicateIntent 的 allowed / reasons（phase 7）
Core（validation：state-gate + checkInterventionSafety）
  ↓  ✅ 可断言：被拒绝时不产生任何世界事件（phase 7）
World State
  ↓  ✅ 可断言：非法数值被夹取（phase 5 + 单测 37 条）
Core Fact（source: "core"）
  ↓  ✅ 可断言：NPC 介入写入档案且标记为 core（phase 5）
Story（storyEvents → journal → journalText）
  ↓  ✅ 可断言：既成事实集合 = source==='core' 的子集（phase 5）
Future Context
  ↓  ✅ 可断言：narrative 不进 prompt，Core fact 进（phase 5）
玩家
```

**且**：`narration ≠ world state` · `Director 不能直写 store` · `Director 不能绕过 Core` ·
`priority 不被忽略但也不改世界` · `重答不重复累加进度` —— 五条边界都有**可执行证明**。

**Phase 4-B 完成，按用户要求立即停止，不进入 Phase 5。**
