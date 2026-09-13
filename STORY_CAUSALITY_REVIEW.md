# STORY_CAUSALITY_REVIEW.md —— 剧情进度的因果来源分析

> **4-A6 的产出。** 本文件只做**分析**与**分类**。
> 除已在 `GAMEPLAY_REVIEW.md` 记录的 `G-7`（事实过滤）外，
> **本阶段没有新增任何影响 `storyProgress` 的规则。**
>
> 取证方式：全仓 `grep` 穷举 `storyProgress` / `storyEvents` / `storyStage` / `journal` 的读写点，
> 并逐个判定每个"疑似剧情推进"的 Core 事件**当前是否真的生效**。

---

## 1. 结论摘要

**`store.storyProgress` 是全仓唯一"没有任何 Core 规则来源"的持久化字段。**

- 唯一业务写入点：主模型返回的 `story.progress`（`chat.ts` 的 `sendMessage`）。
- `DirectorDecision` 结构体（`director.ts:115-127`）**没有进度字段** → Director 判断"该推进剧情"却推不动进度。
- `storyStage()`（`story.ts:37-46`）与 `storyProgress` 是**两条互不相交的链**：
  阶段由 `aiState.affection` / `familiarity` 的阈值**派生**，进度由 AI 的数字**累加**。
- 二者**只有并列展示，没有一致性检查** → 「阶段=交心(90) 而这段日子 0%」是代码允许状态。

---

## 2. 全部读写点

| 类型 | 位置 | 用途 |
|---|---|---|
| **写（业务）** | `chat.ts` `sendMessage` | `clamp(Math.round(store.storyProgress + story.progress))` —— **唯一业务写入** |
| 写（重置） | `chat.ts` `reset-state` 回调 | → 0 |
| 写（载入） | `storage.ts` `applyLoadedState` | 读档回填 |
| 写（初值） | `storage.ts` 的 `store` 字面量 | `storyProgress: 0` |
| 持久化 | `storage.ts` `saveState` | 进存档信封 |
| 读（规则） | `story.ts` `proactiveDrive` | `factor += (store.storyProgress - 50) / 200` → 主动开口频率 |
| 读（展示） | `story.ts` `updateStoryUI` | 进度条 width / 文本 / 角色卡进度环 |
| 读（prompt） | `ai.ts` `SYSTEM_PROMPT` | 「这段日子 X%」 |
| 读（prompt） | `director.ts` `worldSnapshot` | Director 提示词 |
| 读（prompt） | `agenda.ts` `scheduleContextText` | 排日程上下文（仅 >0 时输出） |
| 读（菜单） | `menu.ts` `renderSaves` | 存档卡「剧情 N%」（读的是**原始存档 JSON**，不是 store） |
| 契约 | `save-schema.ts` | `SaveV1.storyProgress: number` · 白名单 · `num(src.storyProgress, 0)` |

---

## 3. `storyStage()` 与 `storyProgress` 的错位（"各读各的"清单）

```ts
// story.ts:37-46  —— 纯派生，只读 38 维的两维，5 档阈值
export function storyStage(): { name: string; pct: number; desc: string } {
    const aff = aiState.affection;
    const fam = aiState.familiarity;
    if (aff >= 80 && fam >= 60) return { name: "交心", pct: 90, desc: … };
    if (aff >= 60 || (aff >= 50 && fam >= 50)) return { name: "信任", pct: 70, desc: … };
    if ((aff >= 40 && fam >= 25) || fam >= 40) return { name: "朋友", pct: 50, desc: … };
    if ((aff >= 25 && fam >= 12) || fam >= 20) return { name: "熟稔", pct: 30, desc: … };
    return { name: "初识", pct: 10, desc: … };
}
```

| 位置 | 函数 | 读 `storyStage()` | 读 `storyProgress` | 形态 |
|---|---|---|---|---|
| `story.ts` | `proactiveDrive()` | ✅ `.pct` | ✅ | **同一函数两个加性项**（`(pct-50)/100` 与 `(progress-50)/200`） |
| `ai.ts` | `SYSTEM_PROMPT()` | ✅ name/desc | ✅ | 同一行字符串 |
| `director.ts` | `worldSnapshot()` | ✅ | ✅ | 同一行 |
| `agenda.ts` | `scheduleContextText()` | ✅ | ✅ | 相邻两行 |
| `story.ts` | `updateStoryUI()` | ✅ 阶段名/描述 | ✅ 进度条 + 环 | 同屏并列 |
| `menu.ts` | `renderSaves()` | ❌ | ✅ | 只显示进度 |

**`storyStage().pct` 的全仓唯一消费点是 `story.ts:66`** —— 即使代码里有 5 档 `pct`（10/30/50/70/90），
它们**只用来算主动开口频率**，从未被用作"进度"的基准。

---

## 4. 数值约束现状

| 项 | 现状 |
|---|---|
| 总量范围 | `clamp(0, 100)`（`state.ts:151-153`） |
| **单轮上限** | **无** —— AI 返回 `progress: 100` 可一轮到顶 |
| **单调性** | **无** —— 允许负值，进度会**下降**（"只增不减"是文档误述） |
| 有限性 | **无 `isFinite` 守卫**：`typeof NaN === "number"` 成立，`clamp(NaN)` 返回 `NaN`，会污染会话内 store（存档层 `num()` 有守卫，重读档回落 0） |
| 提示词承诺 | `response-template.ts`：「`story.progress`: 推动剧情程度 **0~5**，普通聊天写 0」 |
| 存档层校验 | 只校验"是有限数"，**不校验范围** → 手工写入 999 / -50 会被原样加载 |

**门槛耦合（重要）**：`sendMessage` 的
`const story = result.story && result.story.event ? result.story : null;`
意味着 **`story.event` 为空字符串时，`progress` 与 `thread: "end"` 全部失效** ——
模型「只加进度不记事件」或「只收尾不记事件」都是无效的。

---

## 5. 事件档案（`store.storyEvents`）的来源分类

| 写入点 | 产出者 | `source` | 判定依据 |
|---|---|---|---|
| `chat.ts` `sendMessage` | 主模型 `story.event` | `narrative` | 文本直接取自模型 JSON |
| `chat.ts` `executeDirectorDecision` | Director `reason` | `director` | 调度器对自己决定的解释 |
| `chat.ts` `recordNpcInterventionEvent`（**4-A5 新增**） | 代码模板 + NPC 资料 | `core` | 介入由代码确认发生；文本是模板拼接 |
| `story.ts` `triggerNeglectReaction` | Core 模板 + 本地时钟 | `core` | 模型不参与 |
| `event-card.ts` ×2 | 模型或内置事件池 | `narrative` | 有 Key 时是模型文本；无 Key 时是内置固定文本（同样只作展示） |

**旧档兼容**：`source` 是**可选**字段；`normalizeToSaveV1` 对缺失值补 `"narrative"`（最保守默认）。
**因此存档版本号没有变化，`SaveV1` 契约的既有字段语义一字未改。**

---

## 6. `finalizeDay` / `journalText` 的读取链

```
store.storyEvents (source: core)          ──┐
store.chatHistory（按 dayKey 过滤）        ──┤ finalizeDay → store.journal（每天 1 条，最多 14 条）
aiState 阈值（aff/trust/sadness/…）        ──┘                        │
                                                                     ▼
                                          journalText() ← store.journal.slice(-3) + 今天的 core 事件
                                                                     │
                                                     ┌───────────────┴───────────────┐
                                                     ▼                               ▼
                                        ai.ts SYSTEM_PROMPT 【剧情档案】   director.ts worldSnapshot
```

**`journal` 不可能直接影响 `storyProgress`**（反证：`finalizeDay` 与 `journalText` 全文不含 `storyProgress`）。
唯一间接通路是 `journal → prompt → 模型 → story.progress`，**必须经过模型**。

---

## 7. 逐个判定：疑似"剧情推进"的 Core 事件

| 事件 | 是否真的推动 `storyProgress` | 性质 | 证据 |
|---|---|---|---|
| 主模型 `story.progress`（用户回合） | ✅ **唯一主源** | AI 叙事 | `chat.ts` `sendMessage` |
| 主模型 `story.progress`（她主动开口） | ✅ 生效 | AI 叙事（触发是概率性） | `time.ts` `onSlotChanged` → `setMessageSender` |
| 主模型 `story.progress`（被冷落强制通道） | ✅ 生效 | AI 叙事（触发是确定性规则） | `story.ts` `triggerNeglectReaction` → `tryProactiveSpeakForce` |
| **演示模式 / 解析降级兜底** | ✅ 生效 | **本地随机**（`fallbackStory` 恒返回非空 event + `progress: 1+random(3)`） | `story.ts` `fallbackStory` |
| 事件种子注入（30%） | ✅ **间接**生效 | 概率性 | `events.ts` `rollEventSeed` → 注入 prompt |
| **重答（redo）** | ✅ 生效 —— **重复累加**（`RedoCheckpoint` 不含进度字段，回滚不回滚它） | 确定性缺陷 | `chat.ts` `reAnswerAt` |
| 跨天 `finalizeDay` | ❌ 不生效 | — | 只写 journal |
| **Director 决策** | ❌ 不生效 | — | 结构体无进度字段 |
| 事件卡 `maybeShowEventCard` | ❌ 不生效 | — | 只写 storyEvents |
| 被冷落 `triggerNeglectReaction` 本体 | ❌ 不生效 | — | 写 38 维 + 事件，不写进度 |
| **NPC 介入** | ❌ 不生效 | — | 丢弃 `result.story` |
| 关系阶段跃迁 | ❌ 不生效 | — | 只改派生阶段标签 |
| 存档读回 / 重置 | ✅ 生效（覆盖 / 归零） | 确定性 | `storage.ts` / reset 回调 |

---

## 8. 本阶段做了什么（以及**没有**做什么）

### 已做（不改玩法数值）

- 事件来源分类（`StoryEvent.source`）与事实过滤 → 见 `GAMEPLAY_REVIEW.md` 的 **G-7**。
- NPC 介入写入档案（修复断链）→ **G-8**。

### 未做（需要决策，**暂停**）

| # | 候选规则 | 为什么暂停 |
|---|---|---|
| P1 | 跨天时按 `storyStage().pct` 抬升 `storyProgress` 下界 | **改变剧情推进速度** = 玩法数值决策 |
| P2 | NPC 介入推进进度（例如 +1） | 同上，且会影响 `proactiveDrive` |
| P3 | 事件卡推进进度 | 同上 |
| P4 | 加单轮上限（例如 `story.progress` 夹到 ±5，落实提示词承诺） | 同上 |
| P5 | 重答时回滚进度（修重复累加） | 这是**缺陷修复**而非规则变更，但会改变"重答后进度值"——需要确认 |

**其中 P5 是最值得优先决策的一条**：它是明确的缺陷（同一轮重答 N 次 = 进度累加 N 次），
修复它只需要把 `storyProgress` 加进 `RedoCheckpoint` 并回滚，**不涉及任何数值设计**。

---

## 9. 复现命令

```bash
cd /root/github/Melody_of_Us
grep -n "storyProgress\|result\.story\|storyEvents.push\|activeThread = \|journal.push\|storyStage()\|progress: 1 + Math.floor" \
  playground/chat.ts playground/story.ts playground/ai.ts playground/director.ts \
  playground/agenda.ts playground/menu.ts playground/storage.ts playground/save-schema.ts playground/event-card.ts
```
