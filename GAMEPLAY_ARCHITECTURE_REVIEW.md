# GAMEPLAY_ARCHITECTURE_REVIEW.md

> **独立玩法架构审查** — 只读，未修改任何代码 / 数值 / 概率 / 存档 / AI 行为 / UI。
>
> 审查日期：本阶段 ｜ 审查基线：`npm run verify` EXIT=0，724 assertions / 0 failures
> 方法：主 agent 逐行阅读核心调用链 + 3 个独立只读子代理并行取证 + 主 agent 对每条结论做代码级交叉验证。
> 所有结论均给出 `文件:行号`。**凡未找到证据的，一律标注「未找到」。**
>
> 配套文档：`GAMEPLAY_CONTRACT.md`（权责表与冻结清单）、`GAMEPLAY_REVIEW.md`（待决策问题）、
> `A2_RENDER_MIGRATION.md`、`A5_INDEXED_ACCESS.md`、`BOOT_SIDE_EFFECTS.md`。

---

## 1. Executive Summary

### 1.1 一句话结论

**Melody of Us 已经是一个「有真实规则内核的世界」，但它当前的世界模拟是「回合制 + 单点驱动」的：
一切因果都必须由玩家发一句话来点火；世界的另一半（NPC 计划、剧情档案、离线时间）没有接线。**

设计资产是真的（38 维情绪 + 决策层 + Director + NPC 作息 + 存档契约），
问题几乎全部集中在**已有系统之间的连接**，而不是缺少系统。

### 1.2 三个最重要的发现

| # | 发现 | 等级 | 一句话影响 |
|---|---|---|---|
| 1 | **「被冷落」子系统整体不可达** | **P0** | `store.turnCount` 全仓无自增点 → `story.ts:229` 恒真 → 冷落反应永不触发，且挂机时冷落计时被反复清零 → 送给 AI 的提示词恒为「他/她刚刚还在和你说话」（**事实错误**） |
| 2 | **双心理状态是两条无同步的平行管线** | **P0** | 同一份 system prompt 里同时出现 38 维（0–100）与 mind（0–1）两套数值；对话策略以 mind 为准、剧情/NPC/事件/UI 以 38 维为准 → **真实分叉** |
| 3 | **`normalizeDecision` 只保护 Director 一条通道** | **P1** | 主回复的 5 个字段（`delta / story.* / memory / agenda.add`）、NPC 返回值、访谈返回值、日程规划全部**不经**它落地 |

### 1.3 三个最重要的「非发现」（反证，同样重要）

1. **AI 无法影响时间。** `virtualMs / timeRate / scheduleIndex / dayIndex / dayBaseMs` 的**全部**写入点已穷举，无一来自 AI。这是 AI 权限边界中最干净的一条。
2. **AI 的 `user_analysis` 是死输入。** `refineWithModelAnalysis` 在状态已提交、prompt 已发出之后才调用，其修改只进调试 trace，**对任何状态与行为零影响**（`mind.ts:1003` vs `mind.ts:966-970` vs `chat.ts:294`）。所谓「模型修正本地规则」目前并不存在。
3. **决策层（mind）不写 38 维，38 维也不写 mind。** `mind.ts` 对 `aiState` 只有一处读取（`aiStateView`，`mind.ts:677`），无任何写入。因此**不存在双写**，只存在双轨。

### 1.4 与「AI 驱动世界模拟游戏」的距离

| 能力 | 现状 | 差距性质 |
|---|---|---|
| Causality（玩家行为 → 级联） | 玩家输入能完整驱动主角 38 维 + mind + 历史/记忆/剧情字段 | **通不到 NPC 计划层**：NPC 无计划层（`goal` 是死字段） |
| NPC Autonomy | 有作息表驱动的位置/活动（每秒）；有概率性介入 | **无自主发起**：NPC 说话的唯一常规入口在玩家轮次内（`chat.ts:408`） |
| World Persistence | 关页面 = 世界完全静止；离线唯一变化是 Director 的一次 LLM 决策 | **无时间推进、无补算、无事件**：`virtualMs` 只在 `setInterval` 里推进 |
| Emergence | 8 条真实跨系统回路 | 全部经「AI 文本」或「单一分数」中转，**没有一条是规则系统互推** |

**结论：距离「世界模拟」缺的不是功能数量，而是三处接线（见 §8 Recommended Architecture）。**

---

## 2. AI Authority

### 2.1 完整调用链

```
玩家输入 (chat-input)
  ↓ chat.ts:735 handleSend → chat.ts:238 sendMessage
  ├─ [A] chat.ts:276 runAgentPipeline(text)          ← mind.ts:923  写 store.userMind/aiMind/relMind（+ saveState）
  ├─ [B] chat.ts:292 rollEventSeed()                 ← events.ts:37 只掷骰，不读任何状态
  ├─ [C] chat.ts:294 chatWithDeepSeek(text,2,seed,agentTurn.prompt)
  │        prompt = SYSTEM_PROMPT(38 维, ai.ts:47-51) + agentPrompt(mind 摘要, mind.ts:879)
  ├─ [D] chat.ts:302 refineWithModelAnalysis         ← 只改 turn.analysis（无人消费）
  ├─ [E] chat.ts:310 applyDelta(result.delta)        ← state.ts:156  38 维白名单 + clamp(0,100) + 每维回归
  ├─ [F] chat.ts:312 USER_EMOTION_FIX 查表           ← state.ts:176  AI 只提供查表键
  ├─ [G] chat.ts:317 updateStateUI()                 ← 只渲染 38 维
  ├─ [H] chat.ts:322-362 storyEvents / storyProgress / activeThread / agenda / chatHistory / memories
  └─ [I] chat.ts:406-411 void maybeDirector / maybeNpcIntervention / maybeShowEventCard   ← 三条并行旁路
            ↓
        director.ts:184 callDirector → director.ts:249 normalizeDecision   ← 唯一结构化白名单
            ↓ chat.ts:510 executeDirectorDecision
        Core: aiState.affection/trust · npc.relToMain · store.memories · store.storyEvents · npc.present/presentNpcs
```

### 2.2 AI 网络出口（9 个，其中 1 个是死代码）

| 出口 | 位置 | 返回值关键字段 |
|---|---|---|
| `chatWithDeepSeek` | `ai.ts:501` | `dialogue, dialogue_ja?, action?, thoughts?, stats?, delta, user_emotion, story?{event,progress,thread}, memory?, agenda?{add[]}, user_analysis?, suggestions?` |
| `chatWithDeepSeekStream` | `ai.ts:414` | **全仓无调用方（死代码）** |
| `interviewWithAI` | `ai.ts:783` | `insight, question, done, character?` |
| `npcSpeak` | `ai.ts:880` | `dialogue, action?, thoughts?, delta, learn?, leave?` |
| `generateRandomEvent` | `ai.ts:986` | `title, scene, npc` |
| `callDirector` | `director.ts:184` | `needEvent, eventType, priority, npcId, reason, relationshipEffect?, memoryUpdate?` |
| `synthesizeSpeech` / `…Stream` | `tts.ts:352/395` | 二进制 |
| 菜单 `/models` | `menu.ts:425` | 模型 id 列表 |

**解析层无字段校验**：`ai.ts:232-278` 的 `parseAIResponse` 除 `dialogue` 与 `action` 兜底外**原样返回** `parsed as ChatResult`。

### 2.3 权限矩阵

| 状态维度 | AI 能否直接写 | AI 能否间接影响 | 经过什么校验 | 绕过 `normalizeDecision` |
|---|---|---|---|---|
| **emotion**（38 维 emotion/status 组） | ✅ `chat.ts:310` → `state.ts:162` | ✅ `USER_EMOTION_FIX` 查表（数值仍本地） | `DIMENSIONS` 白名单遍历 + `clamp[0,100]` + 每维回归；**无单维步长上限** | 是（不经） |
| **relationship**（38 维 relation 组 / NPC 关系） | ✅ `chat.ts:310`、`561-562`、`566`、`npc.ts:206-207`、`chat.ts:571` | ✅ 访谈产出的 `relation` 文本 → 本地正则选桶（`wizard.ts:523` → `state.ts:78-149`） | Director 侧 `delta∈[-10,10]`（`director.ts:281`）+ `clamp`；**主回复侧仅 `clamp`** | 是（主回复侧） |
| **npc**（emotion/relToMain/relToUser/knownFacts/present/history） | ✅ `npc.ts:197-216`、`intervention.ts:169/176-179` | ✅ `dialogue` 进 `chatHistory` → 影响后续上下文 | `emotion` 8-key 白名单 + `clamp`；`learn` 60 字/去重/上限 20；`history` 上限 30 | 是（无 `normalizeNpcResult`） |
| **time**（virtualMs/timeRate/scheduleIndex/dayIndex/dayBaseMs） | ❌ **不能**（写入点已穷举，无 AI 来源） | ❌ 不能（仅 `storyProgress → proactiveDrive → 开口间隔`，不改时间数值本身） | N/A | 无 |
| **memory**（`store.memories`） | ✅ `chat.ts:359`、`584`、`796` | ✅ 经 `ai.ts:156` 回注 prompt → 自我强化 | `trim().slice(0,60)` + 去重 + 上限 30 | 是（3 条入口里 2 条不经） |
| **story-event**（storyEvents / activeThread / storyProgress / journal） | ✅ `chat.ts:325`、`334/336`、`330`、`521`、`event-card.ts:104/192` | ✅ `journal` 派生（`story.ts:98-124`）→ 回注 prompt（`ai.ts:103-105`） | 仅 `>100 → shift`；Director `reason` `slice(0,30)`；`progress` 总额 `clamp(0,100)` | 是（主回复 `story.*` 不经） |
| **player-state**（userMind / aiMind / relMind） | ❌ 不能（`refineWithModelAnalysis` 在提交之后调用） | ✅ `store.storyEvents`/`activeThread`（AI 写）→ `ctx.recentEvents`（`mind.ts:438/446`）→ 本地规则 | 本地 `clamp01` + 固定维度表 | 否（但见 §7-P1.4 的未来风险） |
| **environment**（scene / agenda / presentNpcs / 事件卡） | ✅ agenda `chat.ts:342`、`agenda.ts:270`；presentNpcs `chat.ts:674`、`intervention.ts:179`；事件卡文本 `event-card.ts:104/192` | ✅ `agendaContext()`（`ai.ts:102`）、`presentContext()`（`ai.ts:175-192`）回注 prompt | title 30 / desc 60 / 去重；`time` **无格式校验**；`presentNpcs` **无校验** | 是（`planTodayAgenda` 是第二条 AI→agenda 通道） |

### 2.4 绕过 Core 的路径（完整清单）

| # | 路径 | 落地位置 | 校验 | 经 `normalizeDecision` |
|---|---|---|---|---|
| 1 | `result.delta` | `aiState` 38 维，`chat.ts:310` | 维度白名单 + `clamp(0,100)`；**无步长上限** | 否 |
| 2 | `result.story.event` | `store.storyEvents` + 用户可见旁白 + `journalText()` 回注 prompt | 无长度/内容校验 | 否 |
| 3 | `result.story.progress` | `store.storyProgress`，`chat.ts:330` | `clamp(0,100)` 总额；**无单轮上限** | 否 |
| 4 | `result.story.thread` | `store.activeThread`（= AI 文本原文） | 无 | 否 |
| 5 | `result.memory` | `store.memories` | trim/60 字/去重/上限 30 | 否 |
| 6 | `result.agenda.add` | `store.agenda`，`agenda.ts:62-72` | title 30 / desc 60；`time` 原样 | 否 |
| 7 | `npcSpeak` 返回值 | `intervention.ts:160-183` → `npc.ts:197-216` | 白名单循环 + `clamp`；**无归一化函数** | 否 |
| 8 | `interviewWithAI.character` | `wizard.ts:397-401` → `wizard.ts:519-527` → `initStateForRelation` | 无字段校验；关系→数值由本地正则决定 | 否 |
| 9 | `planTodayAgenda` 的日程 | `agenda.ts:268-271` | 同 #6 | 否 |

### 2.5 `normalizeDecision` 的实际保护面（`director.ts:249-305`）

| 字段 | 校验 / 兜底 |
|---|---|
| `needEvent` | `!!raw.needEvent` |
| `eventType` | **仅当 `needEvent` 为真**且命中 `{npc_intervention, story_event, world_event}` 才赋值；未知值 → 保持 `"none"`（不改变世界） |
| `priority` | 白名单校验，**但 `executeDirectorDecision` 从不读取它 → 校验后即丢弃** |
| `npcId` | 必须是 `string`、非空、`store.npcs[id]` 存在、**且 `!npc.present`** |
| `relationshipEffect.delta` | `Math.max(-10, Math.min(10, Number(δ) \|\| 0))`；`target` 白名单；**`delta !== 0` 才保留**；`target === "npc"` 时 `npcId` 必须存在（**不要求不在场**） |
| `memoryUpdate.content` | 必须 `string`；`trim().slice(0,60)`；空串丢弃；`action` 只有 `"forget"` 走 forget，**其余一律 "save"** |
| `reason` | `string` 才取，`slice(0,30)` |
| 整体解析失败 | `emptyDecision()`（不改变世界）+ `console.warn` |

### 2.6 超过 Core 拒绝能力的 11 处（AI 输出直通显示/行为）

| # | 位置 | 事实 |
|---|---|---|
| 1 | `ui/message.ts:164-235` | `dialogue` 原文逐字渲染；**无长度上限**（prompt 说 60 字，代码不校验） |
| 2 | `ui/message.ts:209-219` | `action` / `thoughts` 原文渲染 |
| 3 | `ui/message.ts:228-232` → `tts.ts:560` | `dialogue_ja` 原文送 TTS，无校验 |
| 4 | `chat.ts:325` + `367-374` | `story.event` 既入档又作为旁白插入对话流，随后回注下一轮 prompt |
| 5 | `chat.ts:334` | `activeThread` = AI 文本原文 → 进 prompt 与日程上下文 |
| 6 | `chat.ts:518-529` | **Director 的 `reason`（≤30 字自然语言）直接作为「世界事件」插入对话流并写入 `storyEvents`** |
| 7 | `chat.ts:580-591` | Director `memoryUpdate.content` 直进长期记忆；`forget` 用 `includes` **子串匹配批量删除** |
| 8 | `chat.ts:724-747` | NPC `dialogue`/`action` 原文渲染并入档 `chatHistory` |
| 9 | `intervention.ts:176-180` | `leave` **缺省即离场**（`result.leave !== false`）——AI 不写该字段就改变在场状态 |
| 10 | `event-card.ts:104-140` | 事件卡 `title/scene/npc` 原文渲染并写入 `storyEvents` |
| 11 | `action-suggest.ts:100-120` | `suggestions` 原文成为用户可见按钮文案 |

**最关键的权限漏洞**：Director 的 `npc_intervention` **绕过第一层全部守卫**，以 `score: 100` 直调 `runNpcIntervention`（`chat.ts:546-547`）。以下守卫**全部不生效**：6 小时冷却（`intervention.ts:73`）、深夜保护（`intervention.ts:118`）、私密话题屏蔽（`intervention.ts:120`）、概率门 `min(0.55, 0.2+score/100)`（`intervention.ts:143`）。仅剩 4 道门：`store.npcEnabled`、`!npc.present && !npcBusy`、`normalizeDecision` 的 npcId 白名单、`nearby` 判定。

### 2.7 是否存在「AI 说发生了但 Core 没发生」/ 反向

**方向一：AI 说发生了，Core 实际没发生（6 处）**

1. **Director 的 `story_event` / `world_event` 只有一行文本入档**（`chat.ts:520-521`）：无 NPC、无日程、无时间、无关系变化。剧情档案里会出现「昨天发生了 XX」而系统里什么都没发生。
2. **`npc_intervention` 在多人模式关闭时被静默丢弃**（`chat.ts:536`，而 `npcEnabled` 默认 `false`，`storage.ts:206`）→ 整次决策零效果、零提示。
3. **`npcId` 非法时完全空转**：`director.ts:271-276` 不写 `d.npcId` 但 `eventType` 保持 `"npc_intervention"` → `chat.ts:516`/`518` 两个分支都不成立。
4. **`needEvent=false` 且无关系/记忆** → 只执行 `chat.ts:593 saveState()`。
5. **模型在 `dialogue` 里声称状态变化而无 `delta`** → 零写入；`ChatResult.stats`（`ai.ts:32`）**全仓零消费点**；NPC 对白里的承诺（「明天我去找你」）不产生 agenda 项。
6. **演示模式（无 Key）下事件是模板伪造的**：`chat.ts:288` `story: fallbackStory()` → `story.ts:167 progress: 1+random(3)` → **真实写入** `storyEvents` 与 `storyProgress`。

**方向二：Core 已经发生，AI 没有表达（6 处）**

1. NPC 的 `emotion` / `relToMain` / `relToUser` 既不进主 prompt，也无任何 UI → 玩家只能从台词猜。
2. NPC 的 `knownFacts` 只在 NPC 自己的 prompt（`ai.ts:850-862`），主角「不知道」NPC 知道的事。
3. **`present` 生命周期短于一轮**：`chat.ts:672` 置 true → `intervention.ts:177-180` 在同一次介入结束时立即置 false 并移出 `presentNpcs` → 用户下一句发言时 `ai.ts:176` 已判定「没有其他人在场」。
4. `tickAgenda` 改状态**不落盘**（`agenda.ts:76-112` 全程无 `saveState()`）。
5. Director 路径不消耗 NPC 冷却（绕过 `intervention.ts:147` 的 `lastActiveAt` 写入）。
6. `store.userLocation`（`storage.ts:212`）与 `store.pendingOvernight`（`storage.ts:214`，注释称「深夜消息延迟送达」）**除存取外无任何读写** → 该功能不存在。

### 2.8 权限是否过大 / 过小

**过大（4 条）**

1. `delta` **无单维步长上限**：`response-template.ts:14` 的提示词写「每维 -15~15」，但 `state.ts:156-173` **没有实现**任何幅度检查。AI 返回 `{"joy": 100}` 会一次把该维推到 100。
2. `story.progress` **无单轮上限**：AI 可一次把剧情进度从 0 推到 100（总额有 `clamp`，单步没有）。
3. Director 的 `reason` 是**自然语言**却直接成为世界档案事实与用户可见旁白。
4. Director 的 NPC 介入绕过全部风险守卫（§2.6）。

**过小（3 条）—— 这些是「AI 该能却没有能力」**

1. **AI 无法影响时间**：Director 结构体没有任何时间字段，无法表达「过了一小时」。若世界要有模拟感，这是最合理的权限缺口（但**改它会改变玩法，属冻结范围**）。
2. **`stats` 无消费者**：AI 每次都在返回一份 `stats`，无人使用。
3. **`priority` 校验后被丢弃**：AI 表达的「这件事有多重要」没有任何效果。

### 2.9 AI Authority 评级

# **PARTIAL**

**理由（正反两面都必须成立才叫 SAFE）**

✅ **干净的部分**：时间维度 AI 完全无法触碰（写入点已穷举）；`applyDelta` 有维度白名单 + `clamp(0,100)` + 每维回归；`user_emotion` 仅作查表键、数值来自本地表；`USER_EMOTION_FIX` 只写 38 维内存在的维度。

❌ **不干净的部分**：8 个状态维度中 **5 个可被 AI 直接写**，且其中 **4 个的落地不经任何统一校验**；校验强度**逐站点不同**（Director 有 `[-10,10]`，主回复没有；`memory` 有截断，`story.event` 没有）；存在一条**把 AI 自由文本提升为世界事实**的通道（`reason` / `story.event` / `activeThread`）；**无单步幅度限制**意味着 AI 的输出量级可以直接决定世界状态的漂移速度。

**要升到 SAFE 的最小改动**（不在本次执行范围）：
① 给 `delta` 与 `story.progress` 加单步上限；② 让 `story.event` / `reason` / `activeThread` 区分「叙述」与「档案事实」；③ 把 NPC / 访谈 / 日程三条路径补上各自的 `normalize*`。

---

## 3. World Director

### 3.1 Director 的职责到底是什么

**代码事实**：`director.ts:1-4` 自述「不是聊天角色：不生成聊天文本，只做『世界是否该变化』的智能决策；只在代码层 trigger 命中时调用（不每轮调用）」。

**实际职责 = 两件事**

1. **一个多层触发器 + 一次 LLM 调用**（`detectTrigger` → `callDirector` → `normalizeDecision`）：
   触发条件为**代码层优先**——超长输入（≥40 字）、情绪关键词命中、提到 NPC（`director.ts:24-75`），以及外部直接构造的跨天 / 离线回归（`chat.ts:626-634`）。**普通聊天完全不经过 Director。**
2. **一个跨领域的状态写入器**（`executeDirectorDecision`，10 类改动，见 §3.2）。

**关键事实：Director 是当前唯一做「跨领域决策」的组件。** `mind.ts` 只决定「这句话怎么说」，`events.ts` 只掷骰，`intervention.ts` 只算一个分数，`story.ts` 只做派生判断。**只有 Director 能同时表达「发生一件事 + 关系变了 + 记住它 + 谁参与」。**

### 3.2 状态影响范围（`executeDirectorDecision`，`chat.ts:510`）

| # | 维度 | 改动 | 行号 | 校验强度 |
|---|---|---|---|---|
| 1 | Story/Event | `store.storyEvents.push({day, text: reason})` | `chat.ts:521` | 仅 `slice(0,30)` |
| 2 | UI 旁白 | `.story-line` 插入 `reason` 原文 | `chat.ts:524-529` | 无 |
| 3 | NPC | `npc.present = true` + `presentNpcs.push` | `chat.ts:536-547` → `672-676` | `npcEnabled` + `!present` + `!npcBusy` |
| 4 | NPC | `chatHistory.push` ×2 | `chat.ts:738-747` | 上限 200 |
| 5 | NPC | `npc.emotion` / `relToMain` / `relToUser` / `knownFacts` / `history` / `present` | `intervention.ts:160-183` → `npc.ts:197-216` | `clamp` + 白名单 |
| 6 | Emotion | 有可能再触发一次主角 AI 回复 → `applyDelta` | `chat.ts:756-757` → `778-799` | 同 §2.4 |
| 7 | Relationship | `aiState.affection += δ`；`trust += δ*0.6` | `chat.ts:561-562` | `δ∈[-10,10]` |
| 8 | Relationship | `aiState.affection += δ*0.5`（`target==="user"`） | `chat.ts:566` | 同上 |
| 9 | Relationship | `npc.relToMain += δ` + `npc.history.push` | `chat.ts:571-575` | `clamp` + `slice(0,30)` |
| 10 | Memory | `memories.push` / `memories = filter(!includes)` | `chat.ts:584`、`589` | 60 字 / 去重 / 上限 30；**forget 是子串批量删除** |
| 11 | — | `saveState()` | `chat.ts:593` | — |

**时间：不在此表。** Director **不能**影响任何时间字段（`DirectorDecision` 结构体里没有时间字段）。

### 3.3 状态维度 × 谁能改 × Director 能否提议 × Core 是否最终裁决

| 世界状态维度 | 谁可以修改 | Director 能否提出修改 | Core 是否最终裁决 |
|---|---|---|---|
| **Time** | `time.ts`（`setTimeRate`/`setVirtualTime`/`setStartDate`/`tickClock`）+ 用户 + 存档 | ❌ **不能**（结构体无字段） | N/A（无 AI 路径） |
| **Emotion**（38 维） | `state.ts:applyDelta`（AI delta）· `USER_EMOTION_FIX`（本地表）· `story.ts` NEGLECT_DELTA（本地规则）· `initStateForRelation`（本地正则） | ⚠️ **间接**：只能通过 `relationshipEffect` 改 `affection`/`trust` 两维 | ⚠️ 部分：`δ` 被夹到 `[-10,10]`，但**没有单步上限** |
| **Relationship** | 同上 + `npc.relToMain/relToUser` | ✅ **能**（`target = main \| user \| npc`） | ⚠️ 部分：`δ∈[-10,10]` + `clamp` |
| **NPC** | `npc.ts`（`applyNpcDelta`/`npcLearn`/`updateNpcSchedule`）· `intervention.ts`（`present`/`history`） | ✅ **能**（指定 `npcId` + `npc_intervention`） | ⚠️ 部分：**绕过第一层全部守卫**，只剩 4 道门 |
| **Memory** | `chat.ts` 三处（主回复 `memory` / Director `memoryUpdate` / NPC 轮 `memory`） | ✅ **能**（`save` / `forget`） | ⚠️ 部分：`forget` 子串匹配可批量误删 |
| **Story/Event** | `chat.ts:325/521` · `event-card.ts:104/192` · `story.ts:350` | ⚠️ **仅能写一行文本**（`story_event`/`world_event`）；**不能推进 `storyProgress`** | ❌ **无裁决**：`reason` 原文即档案事实 |
| **Environment**（agenda / scene / presentNpcs） | `agenda.ts` · `wizard.ts`（scene）· `chat.ts`/`intervention.ts`（presentNpcs） | ⚠️ **不能直接改 agenda**；只能通过 NPC 介入间接影响 `presentNpcs` | ⚠️ 部分：agenda 有本地兜底，但 `time` 无格式校验 |
| **Player state**（userMind/aiMind/relMind） | `mind.ts` 独占 | ❌ **不能**（Director 不读不写 mind） | N/A |

### 3.4 三类边界问题

**A. Director 无法调度、但理论上应该能调度的状态（3 条）**

1. **剧情进度**：`store.storyProgress` 唯一写入点是 `chat.ts:330`（只吃主模型 `story.progress`）。Director 结构体无此字段 → **Director 判断「该推进剧情」却推不动进度**。这是职责与能力最明显的不匹配。
2. **时间**：Director 能判断「离线很久了」，却只能通过改关系/记忆来回应，无法表达「时间过去了」。
3. **日程**：Director 不能增删日程项；`agenda` 的第二条 AI 通道是 `planTodayAgenda`（跨天专用）。

**B. Director 可以影响、但理论上不应该拥有权限的状态（3 条）**

1. **NPC 介入的全部风险守卫**：`chat.ts:546` 以 `score: 100` 直调，绕过冷却/深夜/私密话题/概率（§2.6）。「私密话题绝不介入」是写进 `DIRECTOR_PROMPT:145` 的铁律，却在代码层的私密词屏蔽（`intervention.ts:120`）上被自己的执行路径绕过。
2. **自由文本成为世界档案**：`reason`（≤30 字）直接进 `storyEvents` 并回注下一轮 prompt（`ai.ts:105`）与 Director 自己的上下文（`director.ts:103`）→ **自喂环**。
3. **`forget` 的子串批量删除**：`chat.ts:589` 用 `includes` 过滤，AI 给一个短串会一次性删掉多条记忆。

**C. Director 与 Core / AI 的职责重叠（4 条）**

| 重叠 | 说明 |
|---|---|
| Director ↔ 主 AI（**情绪/关系写入**） | 同一轮里主模型的 `delta` 与 Director 的 `relationshipEffect` 都能改 `affection`/`trust`，两者**互不知情**，没有优先级或合并规则 |
| Director ↔ `story.ts`（**剧情推进语义**） | Director 写 `storyEvents` 文本；`storyStage()` 却只看 `affection`/`familiarity` 阈值派生。**「事件」与「阶段」是两个互不相关的量** |
| Director ↔ `intervention.ts`（**NPC 筛选**） | 同一个 NPC 介入有两种入口：概率入口（有 4 道守卫）与 Director 入口（无守卫），**两套规则** |
| Director ↔ `events.ts`（**事件触发**） | `events.ts` 掷「是否注入事件种子」；Director 决定「是否发生事件」。两条独立的事件通道，**互不知情**，可能在同一轮都触发 |

**D. Director 是否在偷偷承担「游戏规则」的职责？**

**是，但有条件。** 判据：

- Director 的每一次 `relationshipEffect` / `memoryUpdate` / NPC 介入都是**规则级的状态变更**（改的是 Core 的世界变量，不只是文本）。
- 但这些变更的**触发时机**由 Core 的 `detectTrigger` 决定，**幅度**由 `normalizeDecision` 夹取，**NPC 存在性**由 `store.npcs` 白名单校验 → 它是「**在 Core 划定的笼子里做跨领域决策**」。
- 真正越界的是**文本通道**：`reason` → `storyEvents` → 回注 prompt。这条路上没有任何 Core 校验，AI 的叙述**直接变成世界事实**。

### 3.5 最终回答

> **World Director 应该是「世界调度器」，还是「第二套游戏规则引擎」？**

**当前它是「一个装了部分规则引擎的调度器」——而问题不在它装了规则，在于规则的执行强度在两条路径上不一致。**

- **它不该被削成纯调度器**：它是目前唯一能做跨领域决策的组件。把它降级为「只提建议」会让世界退回到「玩家说一句、AI 回一句」——正是要避免的形态。
- **它不该继续承担规则引擎**：`affection/trust` 的直接写入、NPC 介入绕过守卫、`forget` 的批量删除，这三件事本该是 Core 的职责。
- **正确的定位**：Director 提出**意图**（`needEvent` / `eventType` / 参与者 / 重要度），Core 决定**幅度与后果**（数值、守卫、是否允许）。
  当前 `priority` 被校验后丢弃，恰好说明**这个分工的位置已经预留、但没有接线**。

---

## 4. Mind vs Emotion（双心理状态）

### 4.1 状态结构

**38 维 `AIState`（`state.ts`）**

- 定义：`state.ts:18-62`，`AIState` 是**开放索引签名** `{ [k: string]: number }`（`state.ts:4-6`）→ **编译期无法防拼错维度名**。
- 量纲：**0–100**（`clamp`，`state.ts:151-153`）；初值 = 逐字段 `baseline`（`state.ts:64`）。
- 分组：personality 5 / relation 6 / emotion 12 / status 5 / shadow 10 = **38**。
- 位置：**模块级变量** `state.ts:66` `export let aiState`（载入存档时用 `Object.assign` **不换对象**，`storage.ts:433-437`）。

**mind 三态（`mind.ts`，存在 `store` 上）**

| 类型 | 字段数 | 量纲 | 声明 | 默认值 |
|---|---|---|---|---|
| `UserMindState` | 14 | 0–1 | `mind.ts:60-75` | `defaultUserMind()` `mind.ts:164-171` |
| `AiMindState` | 9 + 1 string | 0–1 | `mind.ts:78-89` | `defaultAiMind()` `mind.ts:172-176` |
| `RelMindState` | 3 + 1 string | 0–1 / 轮次 / ms | `mind.ts:92-97` | `defaultRelMind()` `mind.ts:177-179` |

- 位置：`store` 的属性（`storage.ts:217-229`），随存档序列化（`storage.ts:391-396`）。
- 所有比例字段经 `clamp01`（`mind.ts:190`）。
- ⚠️ **默认值有 3 份拷贝**：`mind.ts:164-179`、`storage.ts:217-229`、`save-schema.ts:167+`（`save-schema.ts:165` 的注释自认「userMind 的 14 个默认值在 storage.ts 里被抄了两遍」）。

### 4.2 语义重叠与字段对照

**只有 5 组是「真同义」**（同主体、同语义、仅量纲不同）：

| mind 字段 | 38 维维度 | 是否同一语义 | 量纲一致 |
|---|---|---|---|
| `userMind.sadness` | `sadness` | ✅ | ❌ 0–1 vs 0–100 |
| `userMind.anger` | `anger` | ✅ | ❌ |
| `userMind.anxiety` | `anxiety` | ✅ | ❌ |
| `userMind.loneliness` | `loneliness`（用户 vs 她，**主体不同**） | ⚠️ 部分 | ❌ |
| `relMind.tension` | （38 维无此维度） | ➖ 与 `userMind.tension` **同域同义候选，但是两个变量** | — |

**「同名不同物」8 组**：`interest`（38 维**根本没有** `interest` 维度）、`energy`（**三个 energy 并存**：`aiState.energy` 0–100 / `aiMind.energy` 0–1 / `userMind.energy` 0–1，且第三个从不参与 `aiStateView`）、`stress`/`fear`/`embarrassment`（同名但主体不同：她的 vs 用户的）、`happiness`（mind 有，38 维只有 `joy`）、`tension`、`social_need`、`willingness_to_talk`。

**唯一被显式设计为跨套读取的代码（两处，都是只读派生）**：

```ts
// mind.ts:666-673  关系视图：38 维 /100 后与 relMind.tension 混合
const familiarity = (aiState.familiarity ?? 0) / 100;
const trust = (aiState.trust ?? 0) / 100;
const closeness = Math.min(1, ((aiState.intimacy ?? 0) / 100) * 0.5 + ((aiState.affection ?? 0) / 100) * 0.5);
const tension = rel.tension;
const comfort = clamp01((trust * 0.4 + closeness * 0.35 + familiarity * 0.25) - tension * 0.35);

// mind.ts:677-686  AI 视图：38 维 /100 后与 aiMind 线性混合
const mood = clamp01((g("joy")*0.5 - g("sadness")*0.42 - g("anger")*0.5 - g("anxiety")*0.25 - g("fatigue")*0.15 + 30) / 100);
const energy = clamp01(g("energy") / 100 * 0.7 + mind.energy * 0.3);
const confidence = clamp01(g("confidence") / 100 * 0.7 + mind.willingness_to_talk * 0.3);
```

### 4.3 是否存在双写

**不存在双写，只存在双轨。** 精确事实：

- `mind.ts` 对 `aiState` **只有一处读取**（`aiStateView`，`mind.ts:678` `const g = (k: string) => aiState[k] ?? 0`），**零写入**。
- `chat.ts` / `state.ts` / `story.ts` 等对 `store.userMind/aiMind/relMind` **零写入**（只有 `mind.ts` 与 `storage.ts` 写）。
- 同轮顺序（`sendMessage`）：`runAgentPipeline` 写 mind（`mind.ts:966-970`，并 `saveState()`）→ **`chatWithDeepSeek` 用的 prompt 里 38 维是本轮 `applyDelta` 之前的旧值** → `applyDelta` 写 38 维（`chat.ts:310`）。

**只写一方的路径共 10 条**（审计已穷举）：

| 只写 38 维（6 条） | 位置 |
|---|---|
| 模型 delta | `chat.ts:310` |
| `USER_EMOTION_FIX` | `chat.ts:312-315` |
| **Director 关系变更** | `chat.ts:561-567` |
| **被冷落反应**（实际不可达） | `story.ts:343-346` |
| **角色卡关系变更** | `chat.ts:1093 initStateForRelation` |
| **主角回应 NPC 轮** | `chat.ts:784` |

| 只写 mind（4 条） | 位置 |
|---|---|
| 每轮 mind 演化 | `mind.ts:966-968` |
| 离线/时段时间衰减 | `mind.ts:497` |
| 重答/载入回滚 | `mind.ts:1053-1055` |
| 重置 | `mind.ts:1062-1064` |

### 4.4 权威归属（**没有单一权威**）

| 问题 | 以哪一份为准 | 代码路径 |
|---|---|---|
| 本轮说多长 / 问不问 / 安慰不安慰 | **mind** | `mind.ts:959 selectStrategy` → `chat.ts:294` |
| 她「现在多开心/多累/多想聊」 | **两套并列，互不覆盖** | 38 维：`ai.ts:47-51` + `describeMood()`；mind：`mind.ts:911-913` |
| 剧情阶段 / 主动开口频率 / 被冷落 | **38 维** | `story.ts:37-46`、`53-90` → `chat.ts:1133` → `time.ts:566` |
| NPC 是否出现 / 说什么 | **两套都不读**（只读 `store.npcs` / 时间 / 文本） | `intervention.ts:59-131` |
| 面板上用户看到的数值 | **38 维** | `chat.ts:162` → `ui/state-panel.ts:62-68` |
| 世界调度决策 | **38 维** | `director.ts:79-89 worldSnapshot()` |
| 跨会话记住什么 | **两套都存** | `storage.ts:393-396` |

### 4.5 消费者 → 读取哪一份（完整）

| 消费者 | 读 38 维 | 读 mind | 读派生视图 |
|---|---|---|---|
| `SYSTEM_PROMPT`（`ai.ts:47-51`） | ✅ 全 38 维整数 | ❌ | ❌ |
| `chatWithDeepSeek` prompt 组装（`ai.ts:508-518`） | ✅ | ✅ | ✅（文本内） |
| `selectStrategy`（`mind.ts:691`） | ❌ 直接读 | ✅ | ✅ |
| `buildAgentPrompt`（`mind.ts:879`） | ❌ | ✅ | ✅ |
| `story.ts`（阶段/主动开口/冷落/归档） | ✅ **（冷落路径还会写）** | ❌ | ✅ `proactiveDrive` |
| `director.ts worldSnapshot` | ✅ | ❌ | ❌ |
| `chat.ts executeDirectorDecision` | ✅ **写** | ❌ | ❌ |
| `chat.ts mainReplyToNpc` | ✅ **写** | ❌ | ❌ |
| `chat.ts updateStateUI` | ✅ | ❌ | ❌ |
| `agenda.ts` 文案 | ✅ | ❌ | ❌ |
| `action-suggest.ts` | ✅ | ❌ | ❌ |
| `menu.ts` / `save-io.ts` 摘要 | ✅ | ❌ | ❌ |
| `mind-debug.ts` 面板 | ✅（仅派生） | ✅ | ✅ |
| `npc.ts` / `intervention.ts` | ❌ | ❌ | ❌ |
| `events.ts rollEventSeed` | ❌ | ❌ | ❌ |
| `event-card.ts` | ❌ | ❌ | ❌ |
| `time.ts` | ❌ 直接读 | ❌ | ✅ `proactiveDriveGetter` |
| `save-schema.ts` / `storage.ts` | ✅ 序列化 | ✅ 序列化 | ❌ |

**注**：`intervention.ts` / `npc.ts` **两套都不读** → 不存在「看到 B」的问题，但意味着 **NPC 对她的情绪一无所知**（`intervention.ts:1-4` 注释声明这是刻意的信息边界）。

### 4.6 「AI 看到 A、NPC/剧情看到 B」是否真实存在

# ✅ **存在，共 4 条分叉**

**分叉 1（最严重）：同一份 prompt 里两套数值并列**

```
chat.ts:276  runAgentPipeline
             ├─ mind.ts:930 applyTimeDecay → 写 store.userMind
             ├─ mind.ts:941-943 更新三态
             ├─ mind.ts:957 aiStateView(ai.next)  ← 读 38 维（本轮 applyDelta 之前的旧值）
             ├─ mind.ts:959 selectStrategy
             └─ mind.ts:966-970 提交 mind + saveState()          ← 分叉点 ①
chat.ts:294  chatWithDeepSeek(...)
             └─ ai.ts:508 baseSys = SYSTEM_PROMPT  ← 读 38 维（同为本轮旧值）
                ai.ts:511 sysContent = baseSys + agentPrompt（mind 新值）
             ⇒ 同一 system message 中同时存在：
                `💕好感38`（整数 0–100，来源 applyDelta 历史累积）
                `familiarity .38`（两位小数 0–1，来源 aiState.familiarity/100 现算）
                `mood: 还不错(0.55)`（混合值，来源 aiStateView）
chat.ts:310  applyDelta(...)                                    ← 分叉点 ③
chat.ts:406-410  Director / NPC / 事件卡：只读 38 维             ← 永不感知 mind
```

**可观测后果**：同一轮里，用户能在 4 个地方看到同一件事的 4 个不同数字——`SYSTEM_PROMPT` 的 `😢悲伤12`（38 维）、`CURRENT CONTEXT` 的 `USER emotion: sadness 0.60`（mind 分析）、左侧面板的 `悲伤 12`（38 维）、agent-debug 面板的 `sadness .60`（mind）。

**分叉 2：被冷落只写 38 维，而它触发的主动开口用的是「neutral」分析**

```ts
// story.ts:343-346  只写 38 维
for (const [k, v] of Object.entries(delta)) { aiState[k] = clamp(aiState[k]! + v); }
// story.ts:360-362  触发 proactive 通道
tryProactiveSpeakForce(`【情境】${situation}\n基于这个情境，主动给对方发一条消息…`);
```
→ `sendMessage(text, {proactive:true})` → `mind.ts:934-936` **把 analysis 硬编码为 neutral**（`rawText: ""`）→ `updateUserState` 收到 neutral 信号 → `userMind.sadness/loneliness` **不因被冷落上升**，`relMind.tension` 不动。
**「被冷落」这件事只存在于 38 维，且 mind 无法从文本读回它。**

**分叉 3：NPC 轮只写 38 维，策略层完全不知道发生过对话**

`chat.ts:772 mainReplyToNpc` 全流程**不调用 `runAgentPipeline`**，只 `applyDelta` + `updateStateUI`（`chat.ts:784`）→ `aiMind.interest/patience/defensiveness`、`userMind.*`、`relMind.tension` 停留在上一轮主对话的值。

**分叉 4：`relationshipView` 把 Director 写的关系读回来 → 同一件事被两套动力学处理**

`chat.ts:561-562`（Director 写 38 维）→ 下一轮 `mind.ts:668` 的 `trust = aiState.trust/100` 立即反映。但 38 维 `trust` 每轮回归 2%（`state.ts:27`），`relMind.tension` 每轮 `*0.92 + 0.008`（`mind.ts:658`）→ **两者不构成一个连贯的关系动力学**。

**反证（不存在分叉的地方）**：`event-card.ts`（上下文不含任何情绪数值）、`events.ts`（只掷骰）、`time.ts`（自身不持状态）、`npc.ts`/`intervention.ts`（两套都不读）。

### 4.7 量纲与漂移

- **未发现把 0–1 直接写进 0–100（或反向）的赋值**。所有跨界处都是显式 `/100` 后再混合（`mind.ts:667-669`、`mind.ts:682-684`）。
- **1 处量纲语义混用**：`ai.ts:270-273` 把模型返回的 **delta**（增量，契约 ±20）用 `{...aiState, ...parsed.delta}` 展开进**绝对值**对象，供 `actions.ts:83-101` 以 `> 45` 的**绝对阈值**取最大项 → 增量被当绝对情绪值参与比较。影响面仅「补全一个动作文案」，**不污染状态**。
- **不会双衰减**（对象不同），但**同一个心理名会在两套里以不同基线、不同速率持续背离**：38 维 `sadness` 按 `baseline 10 / regression 0.22`（每轮）漂移；mind `sadness` 按 `STATE_BASE 0.08 / TURN_DECAY 0.10 / HOUR_DECAY`（逐轮 + 逐虚拟小时）漂移。**两者永不对账。**
- **38 维没有任何基于时间流逝的衰减**：唯一回归在 `applyDelta` 内（`state.ts:165-168`），只随对话轮次发生。
- **prompt 里两套格式完全不同**：38 维是 `emoji+标签+整数`（无小数）；mind 是 `toFixed(2)`（两位小数）。模型收到的是**同一件事的两种不可比表示**。

### 4.8 影响：高优先级

> **「Emotion = A, Mind = B，AI 看到 A，NPC 行为看到 B」——这个模式真实存在，标记为高优先级。**

具体说：**AI（语言生成）同时看到 A 和 B（并列且不可比），NPC/剧情/事件/面板只看 A，而"这句话该怎么说"只看 B。**

### 4.9 风险等级

# **P0**（最高）

理由：① 分叉是**结构性**的，不是笔误；② 它直接污染发给模型的输入（同一 prompt 两套矛盾数值）；③ 它让「被冷落」这条情感回路在语义上断裂；④ 修复方向清晰但**涉及玩法语义**（哪一份是权威），属于必须由需求方决策的范围。

---

## 5. Core Gameplay Loop

### 5.1 实际调用链（一次玩家输入，28 步）

| # | 行号 | 动作 | 是真正状态变化 / 仅 AI 描述 / 确定性 / 概率性 |
|---|---|---|---|
| 1 | `chat.ts:242-256` | 记录检查点（38 维快照 + mind 快照） | 模块内，非世界状态 |
| 2 | `chat.ts:259` | `bumpTurnsSinceEvent()` | 模块级计数，**不持久化** |
| 3 | `chat.ts:260` | `markUserReplied()` | 模块级门控 |
| 4 | `chat.ts:262-263` | `lastReplyRealAt/VirtualAt` | **真实状态变化**（确定性） |
| 5 | `chat.ts:264-266` | 渲染用户气泡 | DOM |
| 6 | `chat.ts:269/418` | `setBusyState` | DOM + 模块态 |
| 7 | `chat.ts:276` | `runAgentPipeline` → 写 mind 三态 + `saveState()` | **真实状态变化**（确定性本地规则） |
| 8 | `chat.ts:292` | `rollEventSeed()` | **概率性**（30% / 3 轮强制，`events.ts:21`） |
| 9 | `chat.ts:294` | `chatWithDeepSeek` | 网络 |
| 10 | `chat.ts:302` | `refineWithModelAnalysis` | **无状态影响**（只进 trace） |
| 11 | `chat.ts:310` | `applyDelta` | **真实状态变化**（AI 数值 + 确定性回归） |
| 12 | `chat.ts:312-315` | `USER_EMOTION_FIX` | **真实状态变化**（确定性本地表） |
| 13 | `chat.ts:322-327` | `storyEvents.push` | **真实状态变化**（AI 描述 → 档案事实） |
| 14 | `chat.ts:329-331` | `storyProgress` | **真实状态变化**（纯 AI 数值，无规则来源） |
| 15 | `chat.ts:333-337` | `activeThread` | **真实状态变化**（AI 文本原文） |
| 16 | `chat.ts:342` | `applyAgendaFromAI` | **真实状态变化**（AI 内容 + `saveState`） |
| 17 | `chat.ts:346-353` | `chatHistory.push` | **真实状态变化** |
| 18 | `chat.ts:356-362` | `memories.push` | **真实状态变化** |
| 19 | `chat.ts:364` | `saveState()` | 持久化 |
| 20 | `chat.ts:367-398` | `typeReply` 渲染 | DOM（TTS 有副作用） |
| 21 | `chat.ts:406` | `maybeDirector` | **概率/条件性**，异步旁路 |
| 22 | `chat.ts:408` | `maybeNpcIntervention` | **概率性**（`min(0.55, 0.2+score/100)`，`intervention.ts:143`） |
| 23 | `chat.ts:410` | `maybeShowEventCard` | **概率性**（35% / 7 轮强制，`event-card.ts:19`） |

**三条旁路都是 `void`（不 await）** —— 它们与主流程并发，没有顺序保证。

### 5.2 哪些是真正的状态变化 / 哪些只是 AI 描述

| 类别 | 内容 |
|---|---|
| **真正的状态变化（Core 写入）** | 38 维情绪（`applyDelta` + `USER_EMOTION_FIX`）、mind 三态、`storyEvents`、`storyProgress`、`activeThread`、`agenda`、`chatHistory`、`memories`、NPC 全字段、`lastReplyRealAt/VirtualAt` |
| **只是 AI 描述（无状态变化）** | `dialogue`、`action`、`thoughts`、`dialogue_ja`、`suggestions`、`stats`（零消费）、`user_analysis`（只进 trace） |
| **边界模糊（AI 描述 = 世界事实）** | `story.event`（既旁白又入档）、Director 的 `reason`（旁白 + `storyEvents` + 回注 prompt） |

### 5.3 确定性 vs 概率性 vs 完全交给 AI

| 变化 | 性质 |
|---|---|
| 每维回归、`fatigue += 0.015` | **确定性** |
| `USER_EMOTION_FIX` | **确定性**（本地表） |
| `finalizeDay` 归档 | **确定性**（每日一次） |
| `tickAgenda` 状态推进 | **确定性**（依赖虚拟时间） |
| `tickNpcWorld` 作息 | **确定性**（纯函数查表） |
| NPC 介入概率 | **概率性** `min(0.55, 0.2+score/100)` |
| 事件种子 | **概率性** 30%（3 轮强制） |
| 事件卡 | **概率性** 35%（7 轮强制） |
| 随机主动开口 | **概率性** 间隔 20–120s，通过率 `min(0.9, 0.6*drive)` |
| `npc.goal` 加分 | **概率性** 0.25；但 `goal` 是死字段 → 实际恒不触发 |
| `relationshipEffect` / `memoryUpdate` | **完全交给 AI**（幅度被夹 `[-10,10]`） |
| `story.progress` | **完全交给 AI** |
| `story.event` / `activeThread` | **完全交给 AI**（原文） |
| 离线回归的一切变化 | **完全交给 AI** |

### 5.4 因果链的断点（关键）

| 环节 | 是否通 | 断在哪 |
|---|---|---|
| 玩家输入 → 主角 38 维 / mind | ✅ | — |
| 玩家输入 → NPC 状态 | ✅ 有条件 | 需 `npcEnabled` + 有 Key + `score>=25` + 概率 |
| NPC 状态 → NPC 未来行为 | ⚠️ 只有一条细线 | 仅 `relToMain > 60 → score += 10`（`intervention.ts:96`） |
| **NPC 行为 → 世界事件** | ❌ **断链** | `runNpcIntervention`（`chat.ts:667-769`）**从不 `storyEvents.push`** |
| **事件 → 剧情进度** | ❌ **断链** | `storyProgress` 唯一写入点 `chat.ts:330`，只吃主模型字段；Director 结构体无此字段 |
| NPC 计划 → 因玩家而变 | ❌ **不存在** | `npc.goal` 无写入点（死字段）；`schedule` 是常量表 |
| 玩家输入 → NPC 计划改变 | ❌ **不存在** | 只影响筛选分数 |

**对照证据（同一层功能，一个写了一个没写）**：`event-card.ts:104` 有 `storyEvents.push`；`chat.ts:667 runNpcIntervention` 没有。

---

## 6. World Simulation

### 6.1 Causality 矩阵

| 玩家行为类型 | 直接结果 | 影响 NPC | 影响情绪 | 影响关系 | 影响未来行为 | 产生事件 |
|---|---|---|---|---|---|---|
| 普通短句 | 38 维 + mind + 历史 | 否 | 是 | 是 | 是 | 概率（种子 0.3 / 卡 0.35） |
| 长句 ≥40 字 | 上述 + Director `long-input` | 仅当 LLM 选 `npc_intervention` | 是 | 是 + Director `relationshipEffect` | 是 + `memoryUpdate` 入 prompt | 上述 + `story_event/world_event` 文本 |
| 情绪关键词 | 上述 + Director `emotion` | 同上 | 是 | 是 | 是 | 同上 |
| 提到 NPC 关键词 | 上述 + Director `npc-mention` + `score+=30` | **是** | 是 | 是（NPC `applyNpcDelta`） | 是（`knownFacts`、冷却） | 概率 `min(0.55,0.2+score/100)`；**不入 storyEvents** |
| 私密词 | 上述 | **被屏蔽**（`intervention.ts:120 score=0`） | 是 | 是 | 是 | 事件卡仍可能（`event-card.ts:70` 无屏蔽） |
| 深夜发言 | 上述 | 屏蔽（`intervention.ts:118`） | 是 | 是 | 是 | 种子/卡均可能 |
| **页面关闭、不说话** | **无任何变化** | 否 | 否 | 否 | 否 | 否 |
| 页面开着挂机 | `tickClock` 每秒推进、时段切换开口、日程推进 | 仅作息位置，**不说话** | **否**（`story.ts:229` 中和冷落） | 否 | 是 | 否 |
| 重开页面（离线 ≥30min） | `directorOnOfflineReturn`（+3s） | LLM 可能指定 | LLM 可能改 `affection/trust` | LLM 可能改 NPC 关系 | 是 | 可能写一条 `reason` 文本 |
| 主动回应 NPC（自动） | `mainReplyToNpc` | **否（不反写 NPC）** | 是 | 是 | 是 | 否 |

### 6.2 NPC Autonomy 清单

| 能力 | 有/无 | 证据 | 触发条件 | 概率常量 |
|---|---|---|---|---|
| 按作息自动改变位置/活动 | ✅ | `npc.ts:189-194` · `intervention.ts:188` · `chat.ts:1181` | 页面开着，每秒 | 无（确定性） |
| 有自己的 schedule 结构 | ✅ | `npc.ts:11-16,30,74-86` | 常量表 | — |
| **计划 / goal 随时间或玩家改变** | ❌ | `npc.ts:171`（唯一写入）· `intervention.ts:108`（只读） | — | — |
| **不等玩家输入就说话** | ❌ **无直接路径** | `chat.ts:408` 是唯一常规入口（`!proactive` 轮次内） | — | — |
| 经 Director 脱离玩家输入介入 | ✅ 有条件 | `chat.ts:536-547` · `627` · `633` | 跨天 / 离线 ≥30min + `npcEnabled`（**默认 false**，`storage.ts:206`）+ LLM 决策 | 无本地概率 |
| 状态驱动的介入概率 | ✅ | `intervention.ts:143-144` | 玩家发消息 + 有候选 | `min(0.55, 0.2+score/100)` |
| 目标驱动加分 | ✅（但 `goal` 是死字段） | `intervention.ts:108` | `npc.goal` 非空 | **0.25**（实际恒不触发） |
| 纯随机扰动 | ✅ | `intervention.ts:115` | 每次筛选 | `Math.random()*8` |
| 参与冷却 | ✅（Director 路径失效） | `intervention.ts:73/147` vs `chat.ts:546` | 上次参与后 | **6 小时**虚拟时间 |
| **情绪/关系随时间衰减** | ❌ | `npc.ts:204`（只在 `applyNpcDelta` 内 5% 回归） | 仅 NPC 发言后 | **0.05**（条件性） |
| 学习新事实 | ✅ | `npc.ts:211-216` ← `intervention.ts:165` | NPC 返回 `learn` | 上限 20 条 / 60 字 |
| 记忆影响后续行为 | ⚠️ 部分（仅自身 prompt 文本） | `ai.ts:850-862` | 下次 NPC 发言 | — |
| **主动拉玩家进日程/剧情** | ❌ | `intervention.ts:160-183` 只处理 `delta/learn/leave` | — | — |

**⚠️ 文档与代码不符**：`intervention.ts:3` 注释宣称「第二层：AI 判断（成本 1 次调用）」，但该文件 import 只有 `storage/npc/time`，**无任何 AI 调用**；`decideIntervention(candidates, recentText, publicRecent)` 的**后两个参数在函数体内从未使用** → 所谓第二层实为一次骰子。

### 6.3 Persistence：离开后世界变化清单

| 系统 | 是否继续 | 机制 | 阈值/常量 | 证据 |
|---|---|---|---|---|
| `store.virtualMs` | **❌ 关页面即冻结** | `dt = Date.now() - lastRealMs; virtualMs += dt*timeRate` | — | `time.ts:353-357,386` |
| NPC 作息 | ❌ | 依赖 `virtualMs` | — | `intervention.ts:188` |
| **NPC 情绪/关系** | **❌ 永不衰减** | 仅 `applyNpcDelta` 内 5% 回归 | `0.05` | `npc.ts:197-208` |
| 38 维 `aiState` | ❌ | 仅每轮 `applyDelta` 的 `regression` | 每维自带 | `state.ts:165-168` |
| `userMind` 衰减 | 仅虚拟时间（**真实离线贡献为 0**） | `base + (before-base)*exp(-rate*hours)` | `HOUR_DECAY 0.04~0.28` | `mind.ts:479-501` |
| `relMind.tension` | ❌ | `applyTimeDecay` 只处理 `user` 组 | — | `mind.ts:480,488` |
| **被冷落反应** | **❌ 不可达** | `turnCount===0` 分支每 tick 重置基准 | — | `story.ts:229-239` |
| 离线 Director | ✅（回页面 +3s） | `runDirector({type:"offline-return"})` | **idleMin ≥ 30** | `chat.ts:1325-1330` |
| 跨天 Director / 归档 / 日程规划 | ✅（需页面开着跨天） | `setDayChangeHandler` | journal 保留 14 天 | `chat.ts:1163-1178` |
| 随机事件种子 / 事件卡 | ❌ | 只在 `sendMessage` 内调用 | `0.3` / `0.35` | `chat.ts:292,410` |
| 随机主动开口 | ✅（页面开着） | `maybeRandomMoment` ← `tickClock` | 间隔 20–120s，通过率 `min(0.9,0.6*drive)` | `story.ts:246-264` |
| 日程状态推进 | ❌（依赖 `virtualMs`）+ **不落盘** | `tickAgenda` 无 `saveState()` | — | `agenda.ts:76-112` |
| Service Worker 后台 | **无** | 仅 `install/activate/fetch` 缓存 | — | `public/sw.js:4-30` |

**重开页面时 `startClock` 把 `lastRealMs = Date.now()`（`time.ts:385`），不把关闭期间的真实时长计入 `dt`。**

### 6.4 Emergence：8 条真实回路

1. **NPC 关系 → 出现频率（自增强）**：`intervention.ts:162 → npc.ts:206` → `intervention.ts:96`（+10） → `intervention.ts:143`（chance 上升）→ 更常出现。**玩家只是闲聊，NPC 会自己越混越熟。**
2. **被冷落 → 好感 → 剧情阶段 → 主动频率**：`story.ts:314-319` → `story.ts:37-46` → `story.ts:66` → `time.ts:567`。（因 §7-P0.1 **断在第一步**）
3. **剧情线 → NPC 介入**：`chat.ts:334` → `intervention.ts:102-105`（+15）+ `story.ts:71`（drive +0.2）
4. **事件卡文本 → 未来 AI 行为**：`event-card.ts:104` → `journalText()` → `ai.ts:105` + `director.ts:103` + `agenda.ts:216`
5. **事件卡内容依赖 NPC 在场**：`event-card.ts:114-117` + `:120 mode: multi|single`
6. **NPC 位置 → Director 的介入模式**：`chat.ts:544 nearby` → `mode = "join" | "message"`
7. **Director 文本 → Director 上下文（自喂环）**：`chat.ts:520-521` → `director.ts:103`
8. **事件种子时点 → 剧情进度 → 世界频率**：`chat.ts:292` → `chat.ts:330` → `story.ts:68`

**性质**：全部经「AI 文本」或「单一分数」中转。**没有一条是规则系统互推。**

---

## 7. Critical Issues

### P0（结构性，必须先决定再动手）

**P0.1 · 「被冷落」子系统整体不可达，且送给 AI 的提示词在说谎**
- 证据：`store.turnCount` 全仓无自增点（唯一赋值 `chat.ts:974 = 0`）→ `story.ts:229` 恒真 → `triggerNeglectReaction`（`story.ts:330`）永不执行；同时该分支在**每个 tick** 重置 `lastReplyRealAt`（`story.ts:234-235`）→ `realIdleMin` 恒 < 3 分钟 → `ai.ts:167 neglectContext()` 恒返回「他/她刚刚还在和你说话」。
- 影响：① 一条完整的情感回路（冷落 → 负面情绪 → 主动质问）**不存在**；② **AI 收到关于玩家行为的事实错误陈述**；③ `menu.ts:111` 的「对话 N 轮」恒 0。
- 关联：`GAMEPLAY_REVIEW.md` **G-1**（已冻结，未改）。

**P0.2 · 双心理状态的分叉（同一 prompt 两套矛盾数值）**
- 证据：§4.6。`mind.ts:966-970`（提交 mind）与 `ai.ts:508`（读 38 维）时序错位；`chat.ts:310`（写 38 维）在 prompt 之后。
- 影响：模型在同一 system message 里收到 `💕好感38` 与 `familiarity .38`；NPC/剧情/事件/UI 只看 38 维；「被冷落」只写 38 维而策略用 neutral 分析。
- 关联：见 §4.9，**需要"哪一份是权威"的产品决策**。

**P0.3 · 模型输出的 `user_analysis` 完全无效（死输入）**
- 证据：`chat.ts:276`（`runAgentPipeline` 内部 `mind.ts:966-970` 已提交并 `saveState()`）→ `chat.ts:294`（prompt 已发出）→ `chat.ts:302`（`refineWithModelAnalysis`）。其消费者只有 `mind.ts:1035`（trace）与 `mind-debug.ts:85/170`（显示）。
- 影响：「模型语义微调本地规则」这个设计**当前不存在**。AI 在 `user_analysis` 里表达的一切对状态零影响。
- 注：这是**被浪费的能力**，不是越权。修复它需要改变玩法语义（本地规则 vs 模型谁优先），属决策范围。

### P1（真实问题，修复方向清晰）

| # | 问题 | 证据 | 影响 |
|---|---|---|---|
| P1.1 | **`normalizeDecision` 只保护 Director 一条通道** | §2.4 的 9 条绕过路径 | 8 个状态维度中 5 个的落地各自为政，校验强度逐站点不同 |
| P1.2 | **无单步幅度限制** | `state.ts:156-173` 无步长检查；`response-template.ts:14` 的「每维 ±15」**未实现** | AI 返回值量级直接决定世界漂移速度 |
| P1.3 | **Director 的 NPC 介入绕过全部风险守卫** | `chat.ts:546` `score: 100` 直调；`intervention.ts:73/118/120/143` 全部失效 | 深夜/私密话题/冷却/概率 4 道守卫生效范围只剩常规路径 |
| P1.4 | **NPC 介入不写 `storyEvents`（断链）** | `chat.ts:667-769` 无 `storyEvents.push`；对照 `event-card.ts:104` | NPC 事件不进世界档案、不进 `journalText()`，下轮 AI 只能从 `chatHistory` 读到 |
| P1.5 | **剧情进度无规则来源** | `storyProgress` 唯一写入点 `chat.ts:330`（AI 字段） | Director/NPC/事件卡都推不动剧情；进度条与「事件」是互不相关的两个量 |
| P1.6 | **AI 自由文本成为世界档案** | `chat.ts:520-521`（`reason`）· `chat.ts:325`（`story.event`）· `chat.ts:334`（`activeThread`） | 叙述即事实，且回注下一轮 prompt → 自喂环，无 Core 校验 |
| P1.7 | **3 处 `fetch` 之外的错误语义差异** 已收敛，但 `ai.ts` 内 5 处 `fetch` 仍未走 `ai/client` | `ai.ts:438/536/804/895/1000` | 非阻塞（同模块内共用 headers/解析），整洁项 |
| P1.8 | **`decideIntervention` 的两个参数未使用、注释与代码不符** | `intervention.ts:136` 签名 vs 函数体；`intervention.ts:3` 注释 | 文档说「第二层 AI 判断」，实为一次骰子；维护者会被误导 |
| P1.9 | **`priority` 校验后丢弃** | `director.ts:266-268` 是唯一读取点 | AI 表达的重要度零效果；跨领域优先级无实现 |

### P2（整洁 / 死代码 / 类型盲区）

| # | 问题 | 证据 |
|---|---|---|
| P2.1 | `AIState` 是开放索引签名，**编译期不防拼错维度** | `state.ts:4-6`；`chat.ts:314` 的 `aiState[k]` 依赖本地表正确 |
| P2.2 | 死字段 `npc.goal`（创建后永不变，却参与 0.25 概率加分） | `npc.ts:171`（唯一写入）· `intervention.ts:108` |
| P2.3 | 死字段 `store.userLocation` / `pendingOvernight`（注释称「深夜延迟送达」但无实现） | `storage.ts:212/214` |
| P2.4 | `ChatResult.stats` **零消费点** | `ai.ts:32` |
| P2.5 | `chatWithDeepSeekStream` **全仓无调用方** | `ai.ts:414` |
| P2.6 | `tickAgenda` 改状态**不落盘** | `agenda.ts:76-112` 无 `saveState()` |
| P2.7 | `present` 生命周期短于一轮 | `chat.ts:672` → `intervention.ts:177-180` |
| P2.8 | **默认值 3 份拷贝**（mind 三态的默认值） | `mind.ts:164-179` · `storage.ts:217-229` · `save-schema.ts:167+`；`save-schema.ts:165` 注释自认 |
| P2.9 | `mind.ts:77` 注释自称「31 维」，实际 38 维 | `mind.ts:77-78` |
| P2.10 | `ai.ts:270-273` 把 delta 当绝对值展开给动作池 | `ai.ts:270-273` + `actions.ts:83-101` |
| P2.11 | Director 路径不消耗 NPC 冷却 | `chat.ts:546` 绕过 `intervention.ts:147` |
| P2.12 | `forget` 用子串匹配批量删除记忆 | `chat.ts:589` |
| P2.13 | `runAgentPipeline` 无条件 `saveState()`（含只读档） | `mind.ts:970`、`mind.ts:499`；每轮至多 3 次写盘 |

---

## 8. Recommended Architecture

> **只提出必要的结构调整。** 不新增系统、不新增维度、不新增 Agent、不新增数据库。
> 每一项都标注「是否改变玩法语义」——标 ✅ 的必须先经需求方决策。

### 8.1 接线（不改变玩法语义）

**R1 · 把「世界档案」与「叙述」分开**（解决 P1.4 / P1.6）
- 现状：`storyEvents` 同时装「AI 叙述」与「世界事实」，且 `reason` 原文即档案。
- 建议：`storyEvents` 加一个来源标记（`narrative` | `fact`），仅 `fact` 类回注 prompt；NPC 介入补上档案写入。
- 是否改玩法：❌ 否（只改变"哪些文本会回流进 prompt"，但需确认——**回流内容变化会影响 AI 行为**，故建议先记录再决策）。

**R2 · 让剧情进度有第二个来源**（解决 P1.5）
- 建议：`storyStage()` 的阈值派生结果（已经是确定性的）作为 `storyProgress` 的下界约束。
- 是否改玩法：✅ **是**（会改变进度条速度）→ 需决策。

**R3 · 把 `normalizeDecision` 的职责一般化**（解决 P1.1）
- 建议：抽出一个纯函数 `clampStateDelta(kind, payload)`，供 `delta` / `story.*` / `memory` / NPC / 访谈 / 日程共用；**不改变任何现有阈值**。
- 是否改玩法：❌ 否（纯重构 + 补齐缺失的 clamp 调用点；但"补上单步上限"会改变行为 → 分两步，先抽函数不动数值）。

**R4 · 给 `delta` 与 `story.progress` 加单步上限**（解决 P1.2）
- 是否改玩法：✅ **是** → 需决策（数值需你定）。

**R5 · `aiState` 键类型收紧**（解决 P2.1）
- 见 `A5_INDEXED_ACCESS.md`：用 `DIMENSIONS` 派生 `DimensionKey` 联合。
- 是否改玩法：❌ 否（纯类型）。

**R6 · mind 三态默认值收敛为单一来源**（解决 P2.8）
- 是否改玩法：❌ 否（前提是**逐字段核对三份拷贝完全相同**；若不同则先报告）。

**R7 · NPC 介入统一走同一套守卫**（解决 P1.3）
- 是否改玩法：✅ **是**（Director 路径当前允许"深夜私密话题介入"，收紧它会改变行为）→ 需决策。

**R8 · 让 `priority` 产生实际效果**（解决 P1.9）
- 是否改玩法：✅ **是**（会改变事件优先级）→ 需决策，或直接删除该字段（❌ 不改玩法）。

**R9 · 世界时间接线（离线推进）**（解决 P0.1 的一半 + §6.3）
- 这不是本次建议项：它会**根本性改变世界模拟的时间语义**（离线期间 NPC 走动、情绪衰减、事件发生），属新玩法设计 → **列入下一阶段议题，本审查不推进**。

### 8.2 明确不建议做的事

| 不建议 | 理由 |
|---|---|
| 给 mind 与 38 维做「双向同步」 | 会让两套动力学互相污染，且需要定义收敛规则 —— 比现在的分叉更难推理 |
| 新增第三套状态 | 现有两套已在分叉，加第三套只会让权威更模糊 |
| 把 Director 降级为纯建议器 | 它是目前唯一做跨领域决策的组件；降级会让世界退回"玩家说一句、AI 回一句" |
| 提高 NPC 介入概率 / 增加 NPC | P1.4 断链未修之前，增加 NPC 只会产生更多"不入档的事件" |
| 打开 `noUncheckedIndexedAccess` | 先做 R5（见 `A5_INDEXED_ACCESS.md`） |

---

## 9. Do Not Change（继续冻结）

本审查**未修改任何代码**。以下系统在本阶段及下一阶段继续冻结，直到需求方逐条决策：

| # | 系统 | 冻结理由 |
|---|---|---|
| 1 | **38 维情绪**：维度集合、初值、`applyDelta` 语义、回归系数、`clamp` 范围 | 玩法内核 |
| 2 | **NPC 行为与 schedule**：作息表内容、时段划分、`updateNpcSchedule` 的选择规则 | 玩法内核 |
| 3 | **时间推进**：`timeRate` 上下限与预设、`tickClock` 的推进公式、`startClock` 的重置语义 | 玩法内核（R9 会改它，故必须先决策） |
| 4 | **人物关系**：`initStateForRelation` 的硬编码值、`relationshipView` 的权重、tension 演化公式 | 玩法内核 |
| 5 | **Memory**：写入条件、60 字上限、30 条上限、回注方式 | 玩法内核 |
| 6 | **Story/Event**：`storyStage` 阈值、`events.ts` 的 30%/3 轮强制、`event-card.ts` 的 35%/7 轮强制 | 玩法内核 |
| 7 | **玩家行动语义**：原文直发、`passOpenEventCards` 的"错过"语义 | 玩法内核 |
| 8 | **World Director 的职责范围与 AI 权限** | 本审查给出评估，但**权限变动一律需决策** |
| 9 | **AI authority**：`delta` 落地路径、`USER_EMOTION_FIX` 表、`normalizeDecision` 的全部阈值 | 玩法内核 |
| 10 | **事件概率**：`intervention.ts:143` 的 `0.55/0.2`、`goal` 的 `0.25`、`random*8`、`replyChance 0.9/0.6` | 玩法内核 |
| 11 | **核心循环**：`sendMessage` 的 28 步顺序、三条 `void` 旁路的并发语义 | 玩法内核 |
| 12 | **游戏结束条件** | **确认不存在胜负/结局判定**（全仓 grep 未找到）。保持现状。 |
| 13 | **存档语义**：`SaveV1` 契约、版本号、迁移链、`SAVE_STATE_FIELDS` | 数据安全 |
| 14 | **G-1 / G-3** | `GAMEPLAY_REVIEW.md` 已冻结；**尤其不要**把 `turnCount` 接到 `events.ts` 的会话级 `turnCounter`（会改变事件频率） |
| 15 | **A-2 / A-5** | 见 `A2_RENDER_MIGRATION.md` / `A5_INDEXED_ACCESS.md`；本审查不推进 |

---

## 10. Phase 4 Readiness

# **READY WITH CONDITIONS**

### 10.1 判定依据

**为什么不是 NOT READY**
- 玩法内核**真的存在且自洽**：38 维 + 决策层 + Director + 存档契约四层都在，且各有测试覆盖（724 断言 / 0 失败）。
- **AI 权限的时间维度完全干净**（写入点已穷举，无 AI 路径）。
- **数值层面有硬约束**（`clamp(0,100)` + 维度白名单），AI 无法写入状态外的键。
- 渲染边界、网络出口、DOM 归属都已收口并可断言（阶段 3 成果）。
- 三处主要缺口（P0.1 / P0.2 / P1.4）**方向明确、修复面清晰**，不是"不知道怎么改"。

**为什么不是 READY**
- **P0.2（双状态分叉）尚未决策**：`AI 看到 A、NPC 看到 B` 会直接污染喂给模型的输入。在权威归属确定之前，任何 AI 侧的增强都会放大这个分叉。
- **P1.4（NPC → 事件断链）未修**：世界档案里缺一半因果，PV4 的"世界模拟"会建立在漏记的事件上。
- **P0.1（冷落不可达）未决策**：它同时是一个**事实错误**（送给 AI 的提示词说谎），不是单纯的缺失功能。

### 10.2 进入 Phase 4 的前置条件（按优先级）

| # | 条件 | 性质 | 是否需要需求方决策 |
|---|---|---|---|
| 1 | 确定 **AI Authority 的最终边界**（尤其 R4 单步上限、R7 守卫统一） | 玩法决策 | ✅ |
| 2 | 确定 **38 维与 mind 的权威归属**（或明确"两者并列、各有分工"并接受分叉） | 玩法决策 | ✅ |
| 3 | 修 **P1.4 断链**（NPC 介入写入世界档案） | 接线 | ⚠️ 轻微（改变回流 prompt 的内容） |
| 4 | 决策 **P0.1 / G-1**（`turnCount` 是否接线；若接线需确认事件频率不变） | 玩法决策 | ✅ |
| 5 | 决策 **P0.3**（`user_analysis` 是启用还是删除） | 玩法决策 | ✅ |
| 6 | 完成 R3 / R5 / R6（纯重构与类型，不改玩法） | 架构整理 | ❌ |

### 10.3 建议的 Phase 4 边界

**Phase 4 若指「AI 层增强」，则建议调整为「AI Authority 定界 + 因果链接线」**，理由是：
本审查的结论是「**缺的不是更多 AI，而是已有系统的连接**」。在这个前提下，先扩 AI 能力会放大分叉而不是产生世界感。

**Phase 4 不应包含**：新增 Agent / 新增状态维度 / 新增 NPC / 引入向量库或后端 / 离线时间推进（R9）。

**Phase 4 可以包含**（前提是上面 1–5 已决策）：AI Authority 边界落实、P1.4 接线、`normalizeDecision` 一般化、`AIState` 类型收紧、默认值收敛。

---

## 附：本审查的取证方式与可信度

| 项 | 说明 |
|---|---|
| 主 agent 直接读证 | `director.ts`（全文 309 行）、`state.ts`（维度表 + `applyDelta`/`clamp`）、`npc.ts`（`NpcState`/`applyNpcDelta`/`updateNpcSchedule`）、`intervention.ts`（`tickNpcWorld`/`applyNpcResult`/`decideIntervention`）、`time.ts`（`tickClock`/`startClock`/`maybeRandomMoment` 链）、`mind.ts`（`runAgentPipeline`/`selectStrategy`/`buildAgentPrompt`/`aiStateView`/`relationshipView`/`refineWithModelAnalysis`）、`story.ts`（`storyStage`/`proactiveDrive`/`neglectLevel`/`triggerNeglectReaction`/`finalizeDay`/`maybeRandomMoment`）、`chat.ts`（`sendMessage`/`executeDirectorDecision`/`reAnswerAt`/`mainReplyToNpc`/`setSaveFailureHandler`/启动段）、`ai.ts`（`SYSTEM_PROMPT`/`chatWithDeepSeek`）、`ui/*.ts`、`storage.ts`（`applyLoadedState`/`saveState` 守卫） |
| 交叉验证的子代理结论 | ① 权限矩阵与绕过路径清单；② 字段对照表与消费者矩阵；③ 因果链断点与持久性矩阵。**主 agent 对其中的关键条目逐条回到代码复核**（`turnCount` 无自增点、`refineWithModelAnalysis` 时序、`storyProgress` 唯一写入点、Director `reason` 直通渲染、`priority` 无消费者、`npc.goal` 无写入点、`goal` 加分恒不触发） |
| 未做的验证 | 未做运行时插桩（结论来自调用图与同步代码顺序）；未运行 e2e（本审查为只读分析，验证基线沿用阶段 3 的 EXIT=0 / 724 断言） |
| 明确标注「未找到」的项 | `stats` 的任何消费者；AI 影响 `virtualMs/timeRate/scheduleIndex/dayIndex/dayBaseMs` 的任何路径；`normalizeDecision` 之外的 NPC/访谈返回值规范化函数；任何胜负/结局判定 |
| 未修改 | **零文件改动**。仅新增本文件。 |
