# PHASE4C_REPORT.md

> 阶段：**Phase 4-C「Gameplay Decision Closure」** —— 收口 Phase 4-B 的全部 `DECISION_REQUIRED`
> 验证基线：`npm run verify` **EXIT=0**，**868 断言 / 0 失败**
> `npm run typecheck` EXIT=0 ｜ `npm run build` EXIT=0
> 本阶段**只收口决策**，未扩大功能范围；未触碰 38D 公式 · 衰减 · 关系公式 · NPC schedule ·
> Story 概率 · 既有阈值 · 结束条件 · Save Schema 语义

---

## 0. 断言数对照（用户要求）

| 项 | 值 |
|---|---|
| **before assertions** | **839** |
| **after assertions** | **868** |
| **new assertions** | **+29** |
| **failures** | **0** |

拆分：`状态闸门单测 37 → 43`（+6，决策 3 的 ±15 边界）｜`e2e 541 → 564`（+23，决策 4 的 Redo/turnCount 与决策 2 的 NPC 主动门）

---

## 1. 九项决策逐项结果

| 决策 | 结论 | 是否改行为 | 实现位置 |
|---|---|---|---|
| **1 · priority** | ❌ **不参与玩法**。保留字段 + 校验 + 写入 `StoryEvent.priority` 供追溯。**未发明新算法** | ❌ | `director.ts` / `save-schema.ts` / `chat.ts` |
| **2 · NPC 主动开口** | ✅ **批准并实现**（最小可控）。复用既有门与既有常量，**零新增 cooldown/probability** | ✅ | `chat.ts` 的 `npcProactiveReady()` / `maybeNpcProactiveInteraction()` |
| **3 · 单步上限** | ✅ **25 → 15**，与 Prompt 承诺逐字一致 | ⚠️ 仅拦异常值 | `state-gate.ts` 的 `MAX_SINGLE_STEP` |
| **4 · Redo 不增 turnCount** | ✅ 实现，并修复了过程中暴露的"迟到回调重复计数"缺陷 | ✅ | `chat.ts` 的 `turnCountSnap` + `countCompletedTurn(serial)` |
| **5 · G-7 Core Fact** | ✅ 确认并冻结：档案与回注只接受 `source === "core"` | ❌（4-A7 已实现） | `save-schema.ts` / `story.ts` |
| **6 · Mind / Emotion** | ✅ **暂不合并**。不删字段、不改 Save Schema、不改量纲 | ❌ | `MIND_EMOTION_CONTRACT.md` |
| **7 · npc.goal** | ⚠️ **暂不接线，也不移除其影响** → 新增 `DECISION_REQUIRED: C-1` | ❌（原样保留） | `intervention.ts`（就地写清事实） |
| **8 · story.progress** | ✅ 全部既有规则冻结；只确保 Redo 不重复累加 | ❌ | 4-B 已实现 |
| **9 · 世界规则 / Director 调度规则** | ✅ 最终冻结 | ❌ | `DIRECTOR_INTENT_CONTRACT.md` |

---

## 2. 实际代码修改

| 文件 | 修改 |
|---|---|
| `playground/state-gate.ts` | `MAX_SINGLE_STEP` 25 → **15**；注释改为"契约一致性"说明 |
| `playground/chat.ts` | ① `RedoCheckpoint` 新增 `turnCountSnap` ② `reAnswerAt` 回滚它 ③ `countCompletedTurn(serial)` 改为**按回合序号幂等** ④ 新增 `npcProactiveReady()` / `maybeNpcProactiveInteraction()` ⑤ 接入既有每秒回调 ⑥ 7 个测试出口 |
| `playground/intervention.ts` | 在 `npc.goal` 分支就地写清"恒生效 +12 分"的事实（**未改行为**） |
| `tests/state-gate.test.mjs` | 决策 3 的 6 条边界断言（±15 / ±16 / 极端值 / 夹取≠拒绝） |
| `tests/render-boundary.e2e.ts` | 决策 4 的 6 条 + 决策 2 的 17 条（新增 phase 8） |
| `tests/e2e.mjs` | 注册 phase 8 |
| `DIRECTOR_INTENT_CONTRACT.md` | priority 最终裁决（决策 1） |
| `GAMEPLAY_REVIEW.md` | 新增「§七 Phase 4-C：9 项决策收口」 |

**未改**：Save Schema（`SAVE_VERSION` 未变）· 38D 公式 · 衰减 · 关系公式 · NPC schedule ·
Story/Event 概率 · 阈值 · 结束条件 · 核心循环顺序 · UI · CSS · Prompt 规模 · 模型 · Provider。

---

## 3. NPC proactive interaction 最终规则（决策 2）

### 3.1 触发点

`startClock` 的**既有每秒回调**（与 `tickNpcWorld` / `maybeRandomMoment` 同一节奏）。
**未新增定时器。**

### 3.2 Core 前置门（全部复用既有规则，零新增常量）

| # | 门 | 判据 | 复用的是哪条既有规则 |
|---|---|---|---|
| ① | 不打断玩家交互 | `busy \|\| userIsTyping()` | 与 `setProactiveGate` 同一判据 |
| ② | 聊天能力 | `hasApiKey() && !demoMode` | 与既有能力门控（P0-8）一致 |
| ③ | 多人模式 | `store.npcEnabled` | 与既有 NPC 介入同一开关 |
| ④ | 新档保护期 | `store.turnCount >= 1` | 复用决策 4 定义的 `turnCount` 语义 |
| ⑤ | 深夜保护 | `currentSchedule().label !== "深夜"` | 与既有规则一致 |
| ⑥ | 冷却 | `virtualMs - lastActiveAt < 6h`（在 `screenNpcCandidates` 内） | **复用既有 6 小时常量**；`lastActiveAt` 由 `decideIntervention` 在**任何**介入后写入 |

其后：`screenNpcCandidates`（关键词/地点/关系/剧情线/**私密话题 score=0**/深夜 score=0）
→ `decideIntervention`（**既有**概率门 `min(0.55, 0.2 + score/100)`）
→ `checkInterventionSafety`（Core 世界安全守卫）
→ `runNpcIntervention`（NPC 发言 → `Core Fact` 入档 → 主角可能回应）。

### 3.3 一个关键技术细节：门的判定改为「收集全部原因」

初版用短路返回，于是**能力门遮蔽了后面所有判定** —— 演示模式下永远只看到
`no-chat-capability`，"深夜保护是否生效"这类断言会**因为错误的原因通过或失败**
（实测：两条断言以误导性的原因变红）。

现返回 `{ ready, reason, reasons[] }`，每个门都可被独立断言：

```
✅ 演示模式 / 无聊天能力 → no-chat-capability
✅ 多人模式关闭 → multiplayer-disabled
✅ 新档保护期阻断（turnCount = 0）
✅ 深夜保护阻断（用虚拟时间真的推进到 02:30，label 变为"深夜"）
✅ 多重阻塞被同时报告（收集式判定，不被能力门遮蔽）
✅ 回到白天后深夜保护消失（证明该门随世界状态变化，不是恒定拒绝）
✅ 能力门是硬门（即使多人开启也不放行）
✅ 单人模式关闭时不再出现在阻塞原因里（证明该门确实随状态变化）
✅ 门关闭时的主动尝试不产生任何世界事件
```

### 3.4 约束遵守情况（对照用户列出的 8 项）

| 用户要求考虑的因素 | 实现 |
|---|---|
| NPC 当前是否存在 | `checkInterventionSafety` 的 `unknown-npc` |
| NPC 当前状态是否允许交互 | `npc-present` / `npc-asleep` / 冷却 |
| 是否处于深夜保护时间 | 门 ⑤ |
| 是否涉及私密话题 | `screenNpcCandidates` 的 score=0 + `checkInterventionSafety` 的 `private-topic` |
| NPC 是否已经在近期主动过 | 门 ⑥（复用既有 6 小时 `lastActiveAt`） |
| 当前是否已经存在玩家交互 | 门 ①（`busy \|\| userIsTyping()`）+ `npcBusy` |
| 是否有必要打断当前状态 | 门 ① 与 ④（新档保护期） |
| **不新增复杂 cooldown / probability 数值** | ✅ 零新增；6 小时与 0.55/0.2 都是既有常量 |

---

## 4. ±15 enforcement（决策 3）

`MAX_SINGLE_STEP = 15`，与 `response-template.ts` 的「每维 -15~15」**逐字一致**。

**语义边界**：只夹取**单笔 AI 提议的增量**；绝对值区间（0–100）仍由 `state.ts:clamp` 负责。
**未改**：38D 公式 · 衰减系数 · 关系公式 · 初值 · 任何阈值。

**测试（用户要求的四条 + 边界）**

```
✅ 上限就是提示词承诺的 15（契约一致性）
✅ +16 → 夹到 +15          ✅ -16 → 夹到 -15
✅ +15 → 合法，逐字保留     ✅ -15 → 合法，逐字保留
✅ 被夹取的条目仍会落地（夹取 ≠ 拒绝）   ✅ 被夹取的条目不出现在 rejected
✅ 极端正值夹到 +15        ✅ 极端负值夹到 -15
✅ 正常对话量级（±1~±8）逐值不变        ✅ 正常量级不产生任何 rejected
```

---

## 5. Redo / turnCount 行为（决策 4）

### 5.1 语义

**一次玩家输入产生的最终有效回答 = 一个历史有效回合。**

| 场景 | 行为 |
|---|---|
| 首次回答 | `turnCount + 1` |
| Redo | 回滚到该回答的检查点 → 重新生成 → **不额外增加**（净变化 0） |
| 正常新一轮 | 照常 `+1` |

### 5.2 实现过程中暴露并修复的**真实缺陷**

初版只做"回滚 `turnCount`"，结果 e2e 报 `0 → 6`。根因：

`typeReply` 的完成回调在**多种时序**下触发 —— 包括 **rAF 被限流时上一轮的回调迟到触发**。
无条件 `turnCount++` 会让"一轮"被记成多轮（一次 Redo 后计数从 0 跳到 6）。

**修法**：`countCompletedTurn(serial)` **按回合序号幂等**：

```ts
let turnSerial = 0;
let lastCountedTurn = 0;

function countCompletedTurn(serial: number): void {
    if (serial <= lastCountedTurn) return;               // 迟到的旧回调：忽略
    const cpSnap = turnCheckpoints[turnCheckpoints.length - 1]?.turnCountSnap;
    if (typeof cpSnap === "number" && store.turnCount !== cpSnap) {
        store.turnCount = cpSnap;                        // 以快照为基准重算，避免叠加
    }
    lastCountedTurn = serial;
    store.turnCount = (Number.isFinite(store.turnCount) ? store.turnCount : 0) + 1;
    saveState();
}
```

### 5.3 未改动

`events.turnCounter`（仍为会话级、刷新即归零）→ **随机事件频率不变**。
`store.turnCount` 的持久化语义不变（仍是"随存档往返的累计有效回合数"）。

### 5.4 观测数据

```
决策 4：重答前 turnCount=0，重答后=0
✅ 【核心】检查点保存了该轮开始前的 turnCount（回滚源正确）
✅ 【核心】Redo 不额外增加 turnCount（11 → 11，而不是 11 → 12 → 13）
✅ 【核心】正常新回合仍然 +1（决策 4 只影响 Redo）
```

---

## 6. G-7 冻结（决策 5）

正式确认并冻结：

| 来源 | 含义 | 进世界档案 | 进回注上下文 |
|---|---|---|---|
| `core` | **Core 确认发生的世界事实** | ✅ | ✅ |
| `narrative` | AI 叙述，**不是**世界事实 | ❌ | ❌ |
| `director` | Director 对自己决策的解释，**不是**世界事实 | ❌ | ❌ |

判定规则：`isFactualStoryEvent(e) === ((e.source ?? "narrative") === "core")`，
常量 `STORY_EVENT_FACT_SOURCES = new Set(["core"])`。

回归断言（保持并全部通过）：
`narrative ≠ fact` · `director ≠ fact` · `core = fact` · 既成事实集合 = `core` 子集 ·
剧情档案不含 narrative 文本。

**未修改此设计。**

---

## 7. Mind / Emotion 冻结（决策 6）

**暂不合并。** 维持：

```
38D Emotion = 主角可计算的定量心理状态
Mind        = 认知 / 想法 / 信念 / 意图
```

未合并字段 · 未删除字段 · 未改 Save Schema · 未改已有存档 · 未改量纲 ·
未强合并 `familiarity` / `affection` / `trust`。

规则保留在 `MIND_EMOTION_CONTRACT.md`（R1/R2/R3）。
继续遵守：「**只有发现真实运行时冲突，才重新讨论存档语义。**」

---

## 8. npc.goal 最终状态（决策 7）

### 8.1 审查结果（比预期更严重）

`npc.goal` **不是"半接线"，而是恒生效**：

| 事实 | 证据 |
|---|---|
| 唯一写入点是 `createNpcState()` 的 `profile.goal ?? null` | `npc.ts` |
| **全部 2 个内置 NPC 都带 `goal`** | `npc.ts` 的 `NPCS` |
| 因此 `npc.goal` **恒为真** | 推论 |
| → `if (npc.goal && Math.random() < 0.25) score += 12` 恒被求值 | `intervention.ts` |
| **"目标"文本内容从不参与判断** | 该分支只判断真值，不读内容 |

**净效果**：每个 NPC 每次筛选有 **25% 概率得到固定 +12 分**（等价于把介入概率整体抬高）。

### 8.2 影响面

- ✅ 影响**概率**（抬高候选通过率：score 13 → 25，跨过阈值 25 时会被计入候选）
- ❌ 不影响任何**数值**（情绪/关系/时间/进度）· 不影响 Director · 不影响 Core 规则

### 8.3 本阶段处置

**原样保留，未接线，未移除影响。** 理由：移除它会让 score 从 25 掉到 13
→ **直接跌破候选阈值 25** → NPC 介入基本失效 → **属玩法行为变更**。
按用户要求"如果移除该影响会改变现有游戏行为，暂停并记录"，
已在 `intervention.ts` 就地写清事实，并记录：

```
DECISION_REQUIRED: npc.goal gameplay semantics
```

---

## 9. 测试结果

```
npm run verify  →  EXIT=0        868 断言 / 0 失败
npm run typecheck → EXIT=0
npm run build     → EXIT=0

  save-schema 单测        88  │ voice-store 单测       44
  状态闸门单测             43  │ agent-smoke            50
  CSS 等价性              12  │ 架构边界               11
  产物检查                 47  │ e2e                   564
  页面冒烟                  9
```

**对照 4-C 要求的测试覆盖**

| 类别 | 覆盖 |
|---|---|
| Regression · D4 | phase 6（7 条） |
| Regression · turnCount | phase 4（9 条）+ phase 6（3 条，决策 4） |
| Regression · Redo | phase 6（检查点回滚源 + 净变化 0 + 正常回合仍 +1） |
| Regression · State Gate | phase 5（6 条）+ 单测（43 条） |
| Regression · G-7 | phase 5（5 条：narrative/director/core 三分） |
| Regression · NPC Core boundary | phase 5（8 条，6 种 reason） |
| Regression · Director boundary | phase 7（10 条：端到端通路） |
| Regression · priority | phase 5（3 条）+ phase 7（1 条端到端） |
| Regression · existing event cadence | `events.ts` 零改动；phase 4 断言 `turnCount` 与 `events.turnCounter` 分离 |
| **NPC proactive interaction** | phase 8（17 条）：trigger condition · valid/invalid NPC · night protection · private topic protection · repeated interaction protection（`lastActiveAt` 冷却）· player interaction coexistence（`busy`/`userIsTyping` 门） |

---

## 10. Defect Injection

### 10.1 本阶段新增的两组

| # | 注入的破坏 | 捕获它的断言 | 结果 |
|---|---|---|---|
| **A** | **移除 Redo 的 `turnCount` 回滚** | `Redo 不额外增加 turnCount` | ✅ 变红 |
| **B** | **移除 NPC 主动门的多人模式判定 + 深夜保护** | `多人模式关闭 → 门关闭` · `深夜保护阻断` · `多重阻塞被同时报告` | ✅ 变红 ×3 |

### 10.2 Phase 4-B 的 8 类（保持可复现，未回退）

| # | 注入的破坏 | 结果 |
|---|---|---|
| 1 | Director 直接写 store | ✅ 变红 |
| 2 | Director 绕过 NPC Core Guard | ✅ 变红 ×2 |
| 3 | priority 被完全忽略 | ✅ 变红 |
| 4 | NPC intervention 不进入 story archive | ✅ 变红 ×3 |
| 5 | narrative 被错误加入 factual context | ✅ 变红 ×3 |
| 6 | D4 re-answer 重复累加 | ✅ 变红 ×3 |
| 7 | 非法 NPC participant 被放行 | ✅ 变红 ×3 |
| 8 | 非法数值修改（去单步夹取） | ✅ 变红 ×4 |

### 10.3 过程中的两次工程改进（值得留档）

1. **「只测函数、不测通路」的陷阱**（4-B 发现）：断言 `checkInterventionSafety` 的返回值
   无法捕获"删掉调用点"这类注入。为此补了一条**不依赖守卫函数是否被调用**的独立判据
   （`decision.npcId === null → npc-not-participable`）。
2. **「短路判定被硬门遮蔽」的陷阱**（4-C 发现）：短路返回让能力门遮蔽所有后续门，
   导致断言以**误导性的原因**通过/失败。改为收集式判定后每个门都可独立断言。

全部注入已 `grep -rn '🧪' playground/ tests/` 确认清除（0 处残留）；`tsc --noEmit` 零错误。

---

## 11. 剩余 DECISION_REQUIRED

| # | 议题 | 影响 | 本阶段处置 |
|---|---|---|---|
| **C-1 · npc.goal gameplay semantics** | `npc.goal` 恒真 → `Math.random() < 0.25` 恒被求值 → 固定 +12 分。是否改成**真正的目标驱动**（每条 goal 有不同权重/条件），还是降级为**纯观察字段**（移除 +12，会让介入基本失效）？ | 玩法概率 | **未动**，就地写清事实 |
| **C-2 · NPC 主动开口对新档的放宽** | 当前要求 `turnCount >= 1`（新档保护期）。若希望"第一次见面后她就能主动"，需要放宽门 ④ | 玩法触发条件 | **未动**，保持现状 |
| **B2-1 / B2-2** | `priority` 参与事件竞争排序 / 影响叙事侧重 | **新增玩法** | 决策 1 已裁定**不参与**并冻结 |
| **B8-1** | `story.progress` 单轮上限（提示词承诺 0~5） | 玩法数值 | 决策 8 已裁定**冻结** |
| **B8-3** | `narrative` 是否也能进档案（`G-7` 松绑） | 模型可见历史量 | 决策 5 已裁定**冻结** |
| **B8-5** | Mind/Emotion 的 P1–P5（字段合并 / 量纲统一） | **存档语义** | 决策 6 已裁定**暂不合并** |
| **U1–U10** | `ai.ts` 内 5 处 fetch · `AIState` 开放索引签名 · mind 默认值 3 份拷贝 · 死字段 | P2 整洁项 | 未动 |

---

## 12. Phase 5 readiness

### 12.1 结构现状（本阶段完成后的最终形态）

```
┌──────────────────────────────┐
│       AI / World Director    │
│  observe → analyze → intent  │   ✅ 只提议，无强制力
└──────────────┬───────────────┘
               ↓
┌──────────────────────────────┐
│             Core             │
│  validate → apply → confirm  │   ✅ 白名单/类型/NaN/±15/记忆净化/NPC 世界安全守卫
└──────────────┬───────────────┘
               ↓
┌──────────────────────────────┐
│          World State         │
│  Emotion / NPC / Event / Story│  ✅ 38D 与 Mind 各守其位
└──────────────┬───────────────┘
               ↓
        Core-confirmed Fact      ✅ source === "core" 才算事实
               ↓
      Future World Context       ✅ 只读 core，narrative/director 被隔离
               ↓
              AI                 ✅ 表达，不改世界
               ↓
           Narration
               ↓
             Player
```

### 12.2 判定

# **READY**

**理由**

1. Phase 4-B 的全部 `DECISION_REQUIRED` 中，**7 项已裁定并落地**（决策 1、3、4、5、6、8、9），
   1 项（决策 2）已批准并实现，1 项（决策 7）经审查升级为新的具体决策且**未擅自改动**。
2. 三层边界（Director / Core / Narration）**全部有可执行断言**，
   且 10 类缺陷注入**全部可被测试捕获**。
3. `npm run verify` EXIT=0 / 868 断言 / 0 失败；`typecheck` 与 `build` 均成功。
4. 未减少任何既有测试覆盖；新增 29 条断言全部针对本阶段的行为改变。

### 12.3 进入 Phase 5 前的建议（不改本阶段结论）

| 建议 | 说明 |
|---|---|
| 先决策 **C-1**（`npc.goal`） | 它是唯一"恒生效但语义未定义"的玩法影响，趁现在语义还小的时候定义清楚 |
| 可选决策 **C-2** | 只影响"新档多久后她可以主动"，一行常量 |
| Phase 5 若涉及 UI / 新系统 | 建议先确认 UI 改动不会重新引入"渲染边界"问题（阶段 3 的 `renderboundary` 套件已覆盖形状契约） |

---

**Phase 4-C 完成。按用户要求立即停止，不进入 Phase 5。**
