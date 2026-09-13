# DIRECTOR_INTENT_CONTRACT.md

> **4-B1 的产出。** 本文件冻结「World Director 能说什么、Core 能决定什么」的边界。
>
> 核心原则（`GAMEPLAY_CONTRACT.md` 第一原则的具体化）：
> ```
> Director = 世界导演    → 观察 · 分析 · 提议 · 排序 · 调度
> Core     = 世界物理定律 → 是否发生 · 幅度 · 是否合法 · 影响什么 · 是否写入世界
> ```
> **导演可以决定「我觉得现在应该安排一次偶遇」；不能决定「偶遇发生后好感 +17」。**

---

## 0. 完整链路（本阶段的目标形态）

```
AI Output（Director 的 JSON）
        ↓  callDirector（director.ts）
Parse（容错 JSON 解析；失败 → emptyDecision）
        ↓
Intent（normalizeDecision —— 字段级合法化：白名单 / 类型 / 范围 / 存在性）
        ↓
Core validation（executeDirectorDecision 的分支判定 + state-gate 数值闸门 + NPC 世界安全守卫）
        ↓
Apply（真正写入 store / aiState / npc）
        ↓
World State
        ↓
Core Fact（source: "core"）
        ↓
AI Narration（只展示，不回注）
        ↓
玩家
```

**禁止的形态（已封堵）**

```
❌ Director → 直接修改 store（绕过 Core validation）
❌ AI → 直接修改 world state
❌ Narration → 自动成为事实
```

---

## 1. 字段清单与归属

| 字段 | 类型 / 取值 | 谁产出 | Core 做什么 | 能否影响世界 | 用途 |
|---|---|---|---|---|---|
| `needEvent` | `boolean`（强制布尔化） | **AI 建议** | 不校验（只 `!!`） | ❌ 不直接影响 | 与 `eventType` 合用决定是否产生事件 |
| `eventType` | `"none" \| "npc_intervention" \| "story_event" \| "world_event"` | **AI 建议** | **白名单校验**；未命中 → 强制回落 `"none"` | ✅ 决定走哪条分支 | 事件类别 |
| `priority` | `"main" \| "supporting" \| "world"` | **AI 建议** | **白名单校验**；未命中 → 回落 `"world"` | ❌ **不参与任何数值计算**（见 §3） | 调度等级 / 追溯 |
| `npcId` | `string \| null` | **AI 建议** | 三重校验：必须是 `string`、非空、`store.npcs[id]` 存在、且 `!npc.present` | ✅ 决定参与者 | 参与者 |
| `reason` | `string`（`slice(0,30)`） | **AI 解释** | 只截断 | ⚠️ **不直接改世界**；仅作为旁白与档案文本（`source: "director"`，**不回注 prompt**） | 解释 / debug |
| `relationshipEffect.target` | `"main" \| "user" \| "npc"` | **AI 建议** | 白名单校验 | ✅（经闸门） | 关系变化的作用对象 |
| `relationshipEffect.npcId` | `string?` | **AI 建议** | `target === "npc"` 时必须存在 | ✅ | 参与者 |
| `relationshipEffect.delta` | `number`，**Core 既有范围 `[-10, 10]`** | **AI 建议数值** | `Math.max(-10, Math.min(10, Number(δ) \|\| 0))`；`δ === 0` → 整条丢弃 | ✅（经闸门二次夹取） | 关系变化幅度 |
| `memoryUpdate.action` | `"save" \| "forget"` | **AI 建议** | 非 `"forget"` 一律回落 `"save"` | ✅ | 记忆操作 |
| `memoryUpdate.content` | `string`（`trim().slice(0,60)`） | **AI 建议内容** | 空串 → 整条丢弃 | ✅ | 记忆内容 |

### 1.1 分类回答（用户要求的五问）

| 问题 | 答案 |
|---|---|
| **哪些字段是 AI 建议** | 全部。Director 的每一个字段都是"提议"，没有任何字段具有强制力 |
| **哪些字段由 Core 决定** | ① 事件**是否真的发生**（`eventType` 通过白名单之后的实际执行）② 数值**幅度**（`δ∈[-10,10]` + 状态闸门 ±25 + `clamp(0,100)`）③ 参与者**是否合法**（存在性 + 未在场 + 世界安全守卫）④ 记忆操作**是否被接受**（`gateMemoryUpdate`） |
| **哪些字段可以影响世界** | `eventType`（走哪条分支）· `npcId`（参与者）· `relationshipEffect.*`（关系）· `memoryUpdate.*`（记忆） |
| **哪些字段只能用于解释 / debug** | `reason`（只作为旁白与档案文本，且 `source: "director"` → **不回注 prompt**）· `priority`（只做追溯与可见性） |
| **哪些字段必须经过 State Gate** | `relationshipEffect.delta`（→ `gateDimensionDelta`）· `memoryUpdate`（→ `gateMemoryUpdate` + `applyMemoryOp`）· `npcId`（→ `checkInterventionSafety`） |

---

## 2. Core 裁决表（`executeDirectorDecision` 的每个分支）

| Intent | Core 的裁决 | 写入的世界状态 | 事件来源标记 |
|---|---|---|---|
| `eventType: "none"` 或 `needEvent: false` | 允许（但无效果） | 仅 `saveState()` | — |
| `story_event` / `world_event` | 允许 | `store.storyEvents.push({ text: reason, source: "director", priority })` + 旁白 | `director`（**不回注**） |
| `npc_intervention` + 合法 `npcId` + `npcEnabled` + **世界安全守卫通过** | 允许 | `npc.present` / `presentNpcs` / NPC 状态 / `chatHistory` / **`storyEvents`（source: "core"）** | `core`（**回注**） |
| `npc_intervention` 但守卫拒绝 | **拒绝**（`console.log` 记录原因） | 无 | — |
| `npc_intervention` 但 `npcEnabled === false` | **拒绝**（静默） | 无 | — |
| `relationshipEffect.target === "main"` | 允许（`δ` 经闸门） | `aiState.affection` / `aiState.trust` | — |
| `relationshipEffect.target === "user"` | 允许（`δ×0.5` 经闸门） | `aiState.affection` | — |
| `relationshipEffect.target === "npc"` | 允许 | `npc.relToMain` / `npc.history` | — |
| `memoryUpdate.action === "save"` | 允许 | `store.memories` | — |
| `memoryUpdate.action === "forget"` | 允许 | `store.memories`（**精确删除单条**） | — |

---

## 3. `priority` 的最终处理（4-B2 的裁决）

### 3.1 调查结论

- `priority` 在修复前**被 `normalizeDecision` 校验后从未被消费**
  （全仓只有 `director.ts` 内两处命中：写默认值、写校验值）。
- **代码不足以安全确定 `priority` 的语义**：
  - Director 每轮**最多产生一个事件**（`DirectorDecision` 是单事件结构，没有队列）
  - `events.ts` 的随机事件种子与 `event-card.ts` 的事件卡是**独立的并行通道**，各有自己的节奏计数器
  - 没有任何"事件竞争/排序"的现成机制
- 因此"让 priority 决定事件竞争顺序"需要**新增一套事件队列与竞争规则** = **新增玩法** → 属于禁止项。

### 3.2 本阶段的选择（不发明规则）

**把 `priority` 从"校验后丢弃"变为"可见且可追溯"，但绝不让它影响世界。**

| 动作 | 说明 |
|---|---|
| ① 保留 `normalizeDecision` 的白名单校验 | 未命中 → 回落 `"world"`（最保守档） |
| ② `StoryEvent.priority`（**可选字段**） | Director 产出的事件在档案里带上当时的调度等级；旧档缺失 → 归一化为 `"world"`。**存档版本号未变** |
| ③ 明确写进本契约 | `priority` **不参与**任何数值计算：不改情绪、不改关系、不改概率、不改进度、不改分支选择 |

### 3.3 为什么这不违反「priority 不能被完全忽略」

用户在 4-B9 要求"注入 priority 被完全忽略的缺陷时测试必须失败"。
本阶段的实现满足这一点，且**不引入新玩法**：

- `priority` 现在有**可观测的落点**（`StoryEvent.priority`），因此"被忽略"= 该字段恒为默认值 → 可断言。
- 断言方式：`normalizeIntent({ priority: "main" })` 必须返回 `"main"`；
  `normalizeIntent({ priority: "__evil__" })` 必须回落 `"world"`；
  两者都会被 e2e 检查。若把 `priority` 的赋值删掉（= 完全忽略），两条断言立即变红。

### 3.4 最终裁决（Phase 4-C 决策 1）

| 项 | 结论 |
|---|---|
| 是否参与玩法 | ❌ **不参与**。不改情绪、不改概率、不改事件结果、不改时间、不改 StoryProgress、不参与事件竞争 |
| 保留什么 | ✅ 保留字段 · ✅ 校验（白名单，未命中 → `"world"`）· ✅ 写入 `StoryEvent.priority` · ✅ 用于追溯 / debug |
| 是否发明新算法 | ❌ 没有。以后出现事件竞争机制时再重新设计 |

**冻结**：`priority` 的语义在存在事件竞争机制之前不再变更。

---

## 4. Director 的权限边界（4-B6 的裁决）

| Director **可以** | Director **不可以** |
|---|---|
| 观察世界（`worldSnapshot()` 只读） | 直接写 `store` / `aiState`（必须经 `executeDirectorDecision`） |
| 提议事件（`needEvent` / `eventType`） | 决定事件的**最终是否发生**（`npc_intervention` 还要过世界安全守卫；`eventType` 未命中白名单即作废） |
| 指定参与者（`npcId`） | 使用不存在的 NPC（`normalizeDecision` + `checkInterventionSafety` 双重拒绝） |
| 提议关系变化方向与幅度（`δ`） | 决定**实际落地幅度**（`δ∈[-10,10]` 由 Core 夹取；再有状态闸门 ±25；再有 `clamp(0,100)`） |
| 提议记忆操作 | 用短串批量删除记忆（`applyMemoryOp` 已收紧为精确匹配） |
| 表达优先级（`priority`） | 用优先级改变概率/幅度/分支 |
| 解释自己的决定（`reason`） | 让解释变成世界事实（`source: "director"` **不回注 prompt**） |

**Director 明确不负责**：情绪公式 · 关系公式 · 事件概率的最终裁决 · 时间推进 · 存档 · 世界事实确认 · Core rule。

---

## 5. 调度条件 vs 世界安全规则（4-B3 的核心区分）

| 类别 | 例子 | 谁负责 | 是否对 Director 生效 |
|---|---|---|---|
| **世界安全规则** | 深夜保护 · 私密话题限制 · 参与者合法性（存在/未在场/睡眠） | **Core** | ✅ **必须遵守**（`checkInterventionSafety`） |
| **调度条件** | 6 小时冷却 · Director 自己的概率门 · 跨天调度 · 离线调度 | **Director** | ⚠️ **不由 Core 阻断** |

**为什么不把调度条件也交给 Core**：Director 的 NPC 介入**天然只发生在跨天与离线回归这两个时刻**。
若对这两条路径套用 6 小时冷却与概率门，跨天/离线介入会**直接失效** ——
那等于把已批准的功能关掉，而不是"加强 Core 保护"。

---

## 5.1 NPC 主动开口的门（Phase 4-C 决策 2 + 4-D 决策 C-2）

`chat.ts` 的 `npcProactiveReady()` 返回 `{ ready, reason, reasons[] }`（**收集全部原因**，
避免短路让"能力门"遮蔽后面的判定）。门清单：

| # | 门 | 判据 | 复用的既有规则 |
|---|---|---|---|
| ① | 不打断玩家交互 | `busy \|\| userIsTyping()` | 与 `setProactiveGate` 同一判据 |
| ② | 聊天能力（**硬门**） | `hasApiKey() && !demoMode` | P0-8 能力门控 |
| ③ | 多人模式 | `store.npcEnabled` | 既有 NPC 介入开关 |
| ④ | 新档保护期 | `store.turnCount >= 1`（**4-D C-2 裁定：保持不变**） | 复用决策 4 的 `turnCount` 语义 |
| ⑤ | 深夜保护 | `currentSchedule().label !== "深夜"` | 既有规则 |
| ⑥ | 冷却 | `virtualMs - lastActiveAt < 6h` | **复用既有 6 小时常量** |

**零新增常量。**

---

## 6. 复现命令

```bash
cd /root/github/Melody_of_Us
# Intent 契约（字段级合法化）
grep -n "normalizeDecision" playground/director.ts
# Core 裁决（分支判定）
grep -n "executeDirectorDecision\|adjudicateIntentForTest" playground/chat.ts
# 世界安全守卫
grep -n "checkInterventionSafety\|PRIVATE_TOPIC_PATTERN" playground/intervention.ts
# 数值闸门
grep -n "gateDimensionDelta\|gateMemoryUpdate\|applyMemoryOp" playground/state-gate.ts
```
