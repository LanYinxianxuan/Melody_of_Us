# A2_RENDER_MIGRATION.md —— 领域层渲染函数上移的可行性分析

> 对应 `GAMEPLAY_REVIEW.md` 的 **A-2**：`story.ts` / `time.ts` / `agenda.ts` 内含渲染函数，
> 领域层因此反向依赖 UI。
>
> **本文只做分析，不改代码。**结论在第 7 节。
>
> 分析方法：对三个模块做 `grep 'document\.'` 全量清单 + 逐个渲染函数反查调用方
> （含**模块内部**的隐式调用）+ 逐一判断调用时机是否在任何条件分支内。

---

## 1. 当前哪些 Core 函数负责渲染

| 模块 | 渲染函数 | 行号 | 它读的 DOM | 它读的世界状态 |
|---|---|---|---|---|
| `story.ts` | `updateStoryUI()` | 367–399 | `#story-stage-name` `#story-stage-desc` `#story-progress-bar` `#story-progress-val` `#panel-char-name` `#panel-char-stage` `#stage-ring` `#panel-char-pct` `#story-events` | `store.storyProgress` · `storyStage()` · `CHARACTER_REF`（经 getter 注入）· `store.storyEvents` |
| `story.ts` | `maybeRandomMoment()` **内部**的输入框读取 | 189 | `#chat-input` | —（用于判断"用户是否正在输入"） |
| `time.ts` | `updateScheduleUI()` | 389–415 | `#clock-time` `#clock-date` `#clock-label` `#clock-activity` `#clock-day` `#clock-scene` 以及 `.rate-btn`（切 active） | `currentSchedule()` · `store.virtualMs` · `store.timeRate` · `store.scheduleIndex` |
| `time.ts` | `renderScene()`（同函数体内，紧跟其后） | 417–460+ | `#scene-title` `#scene-location` `#scene-atmosphere` `#scene-weather` `#scene-people` `#scene-sound` `#scene-light` `#scene-activity` | `sceneDescription()` 一族 |
| `agenda.ts` | `renderAgendaUI()` | 129–180 | `#agenda-list` `#agenda-day` | `store.agenda` · `currentDayIndex()` |

> `story.ts:189` 与 `time.ts` 的 `clockTimer` 是**另外两类**问题，见第 5 节。

---

## 2. 谁调用它们

### 2.1 外部调用（`chat.ts`，共 17 处）

| 函数 | chat.ts 调用点 |
|---|---|
| `updateStoryUI()` | L339 · L479 · L531 · L1008 · L1205 · L1255 |
| `updateScheduleUI()` | L1009 · L1158 · L1256 · L1274 · L1320 · L1381 |
| `renderAgendaUI()` | L343 · L480 · L1183 · L1297 |

### 2.2 ⚠️ 模块**内部**的隐式调用 —— 这才是真正的难点

| 位置 | 所在函数 | 说明 |
|---|---|---|
| `time.ts:312` | `setTimeRate(rate)` | 设置倍率后刷新 clock + 倍率按钮 active |
| `time.ts:328` | `setVirtualTime(day, hhmm)` | 设置虚拟时间后刷新时间显示 |
| `time.ts:343` | `setStartDate(iso)` | 设置起始日期后刷新 |
| `time.ts:378` | `tickClock()` | **每 1 秒**经由 `updateScheduleUI()` 写一次 DOM；`startClock()` 用 `setInterval(tickClock, 1000)` 驱动 |
| `story.ts:357` | `onNeglectEscalation()`（被冷落升级） | 写完 `store.storyEvents` 后立即 `updateStoryUI()` |
| `agenda.ts:280` | `planTodayAgenda()` 的收尾 | 规划完成/失败兜底后立即渲染 |

**结论：渲染不是"被上层调用"，而是"领域逻辑执行到一半顺手刷新"。**
这意味着任何"把渲染摘出去、由调用方在拿到返回值后显式渲染"的方案，
**都必须把调用点插回这 6 个内部位置**，否则会漏刷新 —— 而漏刷新在功能断言里几乎看不出来
（数据是对的，只是界面停在旧值，直到下一次别的什么动作触发刷新）。

---

## 3. 调用时机（是否在条件分支内）

| 内部调用 | 是否在分支内 | 遗漏的后果 |
|---|---|---|
| `time.ts:312`（`setTimeRate`） | 否，直线 | 调倍率后 UI 不更新 → 用户以为没生效 |
| `time.ts:328`（`setVirtualTime`）/ `:343`（`setStartDate`） | 否，直线 | 改完时间/日期后 UI 不更新 |
| **`time.ts:378`（`tickClock` 每秒）** | 否，但**每秒执行一次** | 时间显示停住；**且这是唯一的"秒级驱动"** |
| `story.ts:357` | 否（写在 `store.storyEvents.push` 之后） | 被冷落事件进了数据但面板不显示，直到下次其它刷新 |
| `agenda.ts:280` | 否，但在 `try/catch` 之后（两条分支都汇到这里） | 首次进入日程为空，且不会再自动补渲染 |

**共同点：全部是无条件调用**。因此搬迁时"在同样的位置调用渲染"是可做到的 ——
难点不在条件，而在**位置的数量（6 处内部 + 17 处外部）与其中一处的频率（每秒）**。

---

## 4. UI 状态依赖

| 渲染函数 | 依赖的 UI 侧状态 | 是否只在渲染层 |
|---|---|---|
| `updateStoryUI` | 无（纯派生自 store） | ✅ |
| `updateScheduleUI` | `.rate-btn` 的 `active` 类需要与 `store.timeRate` 对齐 | ✅（但读的是世界状态，不是 UI 私有状态） |
| `renderAgendaUI` | 无 | ✅ |

**好消息**：三个渲染函数都**没有**读取"UI 私有状态"（例如折叠状态、滚动位置、
上次渲染的缓存）。它们都是 `世界状态 → DOM` 的纯映射。
这一点决定了搬迁在**语义上是可行的**，代价只在调用点的数量。

---

## 5. 是否存在隐式副作用（除渲染之外的）

| 位置 | 副作用 | 是否属于 A-2 范围 |
|---|---|---|
| `time.ts` 的 `startClock()` → `window.setInterval(tickClock, 1000)` | **启动定时器**；`tickClock` 内部会推进虚拟时间并调用 `updateScheduleUI` | ⚠️ **部分是**。定时器本身属于「时间推进」（Gameplay，冻结），但它**顺带**做了渲染 |
| `story.ts:189` `document.getElementById("chat-input")` | 「用户是否正在输入」的判断被用来决定**要不要主动开口** | ❌ 不属于 A-2（那是**玩家输入状态**，但它的读取被放在了领域模块里） |
| `agenda.ts` 的 `planTodayAgenda` | **会发起 AI 请求**（经注入的 sender） | ❌ 不属于 A-2 |
| `time.ts` 的 `applyTimeDecay` 链 | 修改 Agent Mind 状态 | ❌ 世界规则，冻结 |

**结论**：`tickClock` 是"规则 + 渲染"交织最紧的一处 ——
它既推进时间（规则，冻结），又刷新 DOM（渲染，A-2 的目标）。
搬渲染必须**保留**每秒的调用位置，而这个调用位置就在规则函数体内。

---

## 6. 搬迁后的调用链（两个候选方案）

### 方案 A：注入渲染回调（改动最小，方向正确）

```ts
// time.ts
let onScheduleChanged: () => void = () => {};
export function setScheduleRenderHook(fn: () => void) { onScheduleChanged = fn; }

// 原来 updateScheduleUI() 的 4 个内部调用点 → onScheduleChanged()
// updateScheduleUI / renderScene 的**函数体**搬到 ui/schedule.ts
```

- **优点**：调用位置与频率**逐字不变**（仍是 6 处，仍每秒一次）；
  领域模块不再操作 DOM；方向与既有 `set*Getter` / `set*Sender` 模式一致。
- **缺点**：`time.ts` 仍然"知道"有个渲染要做（但不知道怎么做）——
  这是**依赖倒置**，不是彻底解耦，但符合本项目已有的回调注入风格。
- **风险**：低。渲染函数体是纯映射，搬运不改语义。
- **需要的额外工作**：`ui/schedule.ts` 要注入 `store` 读值（`updateScheduleUI` 读
  `store.virtualMs/timeRate/scheduleIndex`）与 `sceneDescription()` 一族 —— 两项都已是只读导出。

### 方案 B：让 Core 返回数据、由 chat.ts 渲染（更"干净"，但改动面大）

- 需要把 `setTimeRate` / `setVirtualTime` / `jumpToToday` / `tickClock` /
  `onNeglectEscalation` / `planTodayAgenda` 的**签名与返回类型**全部改掉，
  让调用方拿到"需要刷新"的信号。
- `tickClock` 是 `setInterval` 的回调，**没有调用方**可以接返回值 ——
  因此这条路对 `tickClock` 走不通，必须为它单独引入事件或回调。
- **结论**：方案 B 在 `tickClock` 这一处无法自洽，除非引入事件总线（新增机制）。

### 推荐：方案 A

理由：它保持"调用时机与频率"这个**唯一真正影响行为的变量**不变，
同时达成 A-2 的目标（领域模块不再操作 DOM）。

---

## 7. 行为变化风险

| 风险 | 等级 | 说明与对策 |
|---|---|---|
| 漏掉某个内部调用点 → 界面停在旧值 | **高** | 6 处内部调用必须逐一替换并复核；建议为此加断言：调用 `setTimeRate(2)` 后 `.rate-btn.active` 与 `#clock-time` 必须变化 |
| `tickClock` 每秒一次的渲染被改成"按需" | **高** | 频率变化会让时间显示从"每秒跳"变成"事件驱动跳"，用户可感知。**必须保持每秒** |
| 渲染时机从"同步紧跟"变成"下一微任务/下一帧" | 中 | 方案 A 是同步调用，天然规避；若引入 `requestAnimationFrame` 就会改变可观测顺序 |
| `ui/schedule.ts` 反向依赖 `time.ts` 造成环 | 中 | `ui/` 只 import `time.ts` 的**只读**导出；`time.ts` 不 import `ui/`（只用注入的回调） |
| `story.ts:189` 读 `#chat-input` 被误当成渲染一起搬走 | 中 | 它是**玩家输入状态判断**，不是渲染。搬走会让"她要不要主动开口"的逻辑失去输入源 —— 必须留在原处或改为注入 |
| 折叠状态 / 滚动位置等 UI 私有状态被引入 | 低 | 已核实：三个渲染函数都不读 UI 私有状态 |

---

## 8. 结论

1. **A-2 在语义上可行**：三个渲染函数都是 `世界状态 → DOM` 的纯映射，
   不读 UI 私有状态，因此搬迁不会改变"渲染出什么"。

2. **但真正的约束是"何时渲染"，而它有 23 个调用点（17 外部 + 6 内部），
   其中 `tickClock` 是每秒一次。**

3. **本阶段不做**（用户明确要求先完成 3.9 的安全边界、A-2 单独处理）。理由：
   - 它需要同时改动 `time.ts` / `story.ts` / `agenda.ts` **三个**核心模块的调用位置，
     违反"不要一次性重写多个核心模块"；
   - 而它的收益（领域层不再碰 DOM）目前**没有对应的具体缺陷** ——
     `tests/boundaries.test.mjs` 已经把这四个模块登记为 `entry` 层并锁定了查询数预算，
     继续增长会被拦住。

4. **如果要做，先做这一步**：6 处内部调用点已全部精确定位（见 §2.2 表，
   `time.ts` 的四处分别属于 `setTimeRate` / `setVirtualTime` / `setStartDate` / `tickClock`），
   搬迁时按方案 A 逐模块进行，每个模块一次 `npm run verify`，
   并为"每秒刷新"专门加一条断言（`tickClock` 的调用频率是本次搬迁最容易改坏的变量）。

5. **不做的事**：不引入事件总线；不把 `tickClock` 改成非每秒；不动 `time.ts:189`
   的输入状态判断（那是另一类问题，见 `GAMEPLAY_REVIEW.md`）。
