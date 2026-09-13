# PHASE5A_REPORT.md

> 阶段：**Phase 5-A「World Surface」** —— 5-A1 WorldViewModel + 5-A2 World Surface + 5-A3 NPC Surface
> 验证基线：`npm run verify` **EXIT=0**，**931 断言 / 0 失败**
> `npm run typecheck` EXIT=0 ｜ `npm run build` EXIT=0
>
> **按 §22 停止条件：完成 5-A1/A2/A3 后立即停止，未做 5-A4 / 5-A5。**
> 未改 Save Schema · 38D 公式 · Story 规则 · NPC schedule · 概率 · cooldown · Core loop

---

## 0. 断言数对照

| 项 | 值 |
|---|---|
| **before assertions**（Phase 4-D） | **887** |
| **after assertions** | **931** |
| **new assertions** | **+44** |
| **failures** | **0** |

拆分：`e2e 583 → 626`（+43，新增 phase 10「World Surface」，含 5 个精确视口宽度的响应式检查）｜
`架构边界 11 → 12`（+1，新增「ui/ 不得修改世界状态」）。其余套件断言数**全部持平**。

---

## 1. 当前 World State 审计（§3 的五个问题）

### 1.1 哪些数据已经存在（可直接给 UI）

| 数据 | Core 的只读出口 | 形态 |
|---|---|---|
| 当前时间 | `fmtVirtualTime()` / `fmtVirtualDate()` | 字符串 |
| 当前时段 | `currentSchedule()` → `{ label, activity, busy }` | 对象 |
| 第几天 | `currentDayIndex()` | number |
| 她在哪 | `herLocation()` | 字符串 |
| 场景描述 | `sceneDescription()` | 多行字符串 |
| NPC 状态 | `store.npcs[*]` → `{ name, avatar, title, location, activity, label, present, relToMain, goal, lastActiveAt }` | 对象 |
| NPC 作息表 | `npc.profile.schedule`（静态） + `npcScheduleAt()` | 纯函数 |
| 剧情阶段 | `storyStage()` → `{ name, desc, pct }` | 对象 |
| 剧情进度 | `store.storyProgress` | 0–100 |
| 剧情线 | `store.activeThread` | string \| null |
| 世界档案 | `store.storyEvents` + `isFactualStoryEvent()` | 数组 |
| 主角心情 | `describeMood()` | 定性字符串 |
| 回合数 | `store.turnCount` | number |

### 1.2 哪些已经可以直接渲染

**全部**都可以 —— 上表每一项都有稳定的只读出口，无需新增任何 Core 数据。

### 1.3 哪些目前只有 Core 使用（UI 缺失）

| 数据 | 现状 |
|---|---|
| **NPC 的 location / activity / label / present / relToMain** | **完全没有渲染**。`#state-panel` 有 剧情 / 日程 / 情绪日志 / 决策调试 四节，但**没有任何一处显示"世界里的其他人"** |
| **Core Fact 与 narrative 的区分** | `#story-events` 把 `store.storyEvents.slice(-6)` **不加区分**地全渲染（`story.ts` 的 `updateStoryUI`），既没有来源标记，也没有"最近发生"的事件流 |
| `npc.goal` | 只有 Core 的评分在用（Phase 4-D 已语义化），UI 不可见 |
| `StoryEvent.priority` | Phase 4-B 写入后**无任何消费者** |

### 1.4 哪些数据已经存在 UI，但只是隐藏在聊天逻辑里

| 数据 | 隐藏在哪 |
|---|---|
| 时间 / 场景 / 她的活动 | `time.ts` 的 `updateScheduleUI()`（直接写 `#clock-*` / `#scene-*`） |
| 剧情阶段 / 进度 / 档案 | `story.ts` 的 `updateStoryUI()`（直接写 `#story-*`） |
| 日程 | `agenda.ts` 的 `renderAgendaUI()`（直接写 `#agenda-*`） |
| 情绪日志 | `chat.ts` 的 `logEmotion()` |

**注意**：这些都是**领域模块自己在渲染**（`GAMEPLAY_REVIEW.md` A-2 记录的既有设计），
Phase 5-A **没有搬动它们**（那属于 A-2 的独立议题）。本阶段新增的是**它们没覆盖的部分**。

### 1.5 哪些数据缺少稳定的只读 ViewModel

**此前全部缺失** —— 领域模块直接 `document.getElementById` 写 DOM，
没有"Core State → VM → UI"这一层。本阶段为**世界表面所需的那部分**建立了 VM（见 §2）。

---

## 2. WorldViewModel 设计（5-A1）

`playground/ui/world/world-view-model.ts`

### 2.1 形状（全部可序列化）

```ts
interface WorldViewModel {
    time:  { clock; date; day; label; activity };
    npcs:  { id; name; avatar; title; location; activity; label;
             present; relToMain; goal; lastActiveAt }[];
    coreFacts:  WorldEventVm[];   // 只有 source === "core"
    allEvents:  WorldEventVm[];   // 全量（含 narrative / director），必须能区分
    story: { stageName; stageDesc; progress; activeThread; mood };
    turnCount: number;
}

interface WorldEventVm { day; text; source; factual; today; priority }
```

### 2.2 六条契约（§4）

| 契约 | 实现方式 |
|---|---|
| **只读** | 只 import `store` 的读取；静态守卫断言 `ui/` 不出现任何对 `store` / `aiState` 的赋值 |
| **可序列化** | 返回值是纯字面量对象；e2e 断言 `JSON.stringify(JSON.parse(JSON.stringify(vm))) === JSON.stringify(vm)` |
| **不持有 DOM** | 本文件不 import `ui/dom`，只 import core 的只读导出 |
| **不 fetch** | 静态守卫（既有）断言 `ui/` 全层零 `fetch` |
| **不 localStorage** | 静态守卫（既有）断言 `ui/` 全层零 `localStorage` |
| **不执行游戏规则** | 阶段名/时间文案**全部**取自 Core 现成导出；`story.progress` **直接读 store**（刻意**不**用 `storyStage().pct` 推算 —— 那是"UI 重新计算规则"） |

### 2.3 「不造假日世界」的实现（§14）

VM 里**每一个字段**都能对应到 `store` 上的一个既有字段或 Core 的一个既有导出。
`WORLD_VM_DEBUG.topLevelKeys()` 让"没有意外字段被加进来"成为可断言的事实
（e2e 断言顶层键**恰好**是 `allEvents/coreFacts/npcs/story/time/turnCount`）。

---

## 3. World Surface（5-A2）

`playground/ui/world/world-surface.ts`

### 3.1 组合入口

```ts
refreshWorldSurface(force?) → { rendered, wrote, skipped, fingerprint }
invalidateWorldSurface()   // 载入存档 / 重置后强制失效
currentWorldViewModel()    // 只读
```

### 3.2 接入了哪些时机（`app/` 侧，共 5 处）

| 时机 | 调用 | 为什么 |
|---|---|---|
| 初始化末尾（所有状态就绪后） | `refreshWorldSurface(true)` | 首屏就要看到世界 |
| 时钟每秒回调（既有 `setRandomMomentHook`） | `refreshWorldSurface()` | 时间/NPC 作息会变；**靠指纹短路避免重建** |
| NPC 介入写入 Core Fact 之后 | `refreshWorldSurface()` | 新事实出现 |
| 「重置故事」 | `invalidateWorldSurface()` | 强制下一帧重建 |
| 测试出口 | `worldSurfaceRefresh(true/false)` | 断言指纹短路 |

### 3.3 性能（§17）：指纹短路

```ts
const fp = worldViewModelFingerprint(vm);
if (!force && lastFingerprint === fp) { skippedRefreshes++; return { skipped: true, … }; }
```

指纹只包含**会影响渲染**的字段（时钟 / 时段 / 活动 / 天数 / 每个 NPC 的
location+activity+label+present+relToMain / Core Facts / 剧情三元组），
**刻意不含 38 维**（它每帧都在动，但世界表面不渲染它）。

**e2e 实测**：内容未变化时连续 30 次刷新 → `applied 7→7`，`skipped 0→30`（**30 次全部被短路**）。

---

## 4. NPC Surface（5-A3）

`playground/ui/world/npc-surface.ts` + `chat.html` 新增「其他角色」折叠节（`#section-world` → `#world-npcs`）

### 4.1 「活着感」的表达（§8）

```
NpcState.activity + NpcState.location + NpcState.present
        ↓  （只做组合，不推断）
「在图书馆，正在阅读」 / 「就在这儿，在整理书架」
```

组合规则的**全部**分支：

| Core 的事实 | 渲染 |
|---|---|
| `present === true` 且有 activity | `就在这儿，${activity}` |
| 有 activity 且有 location | `在${location}，${activity}` |
| 只有 location | `在${location}` |
| 只有 activity | `${activity}` |
| **两者都没有** | `（还没有她的消息）` ← **如实说明，绝不编造** |

**没有任何一处**根据时间/关系/情绪去**推断**新事实。

### 4.2 每秒不重建 DOM

按 `id` 做 key 复用：行只创建一次，之后**只在文本签名变化时**写 `textContent`；
`present` 用 `classList.toggle`。e2e 断言了这条路径（连续 30 次刷新零 DOM 重建）。

---

## 5. UI boundary（§2）

### 5.1 静态守卫（`tests/boundaries.test.mjs`，已入 `verify`）

本阶段**新增一条**：

```
✅ ui/ 层不修改 store / aiState（世界状态只由 Core 与 Director 经闸门修改）
```

它扫描 `ui/` 全层，检出 `store.X =` / `store.X +=` / `Object.assign(store, …)` /
`aiState[...] =` / `aiState.X =` 这类**赋值**（跳过注释行）。

**新增的 4 个模块已登记为 `strict` 层**（不得绕过 `ui/dom` 收口器）。

### 5.2 既有守卫仍然全绿

```
✅ strict 层（渲染层）不得绕过收口器直接 querySelector
✅ forbidden 层（规则/网络/持久化）零 DOM 访问
✅ ui/ 层（8 个模块）不碰 localStorage / fetch / indexedDB
✅ fetch 只出现在 ai/ 目录
✅ 除 storage.ts 外，无人直接写 melai-state-* 存档键
✅ 全仓零 (store as any)
```

---

## 6. Responsive 结果（§12）

### 6.1 方法：为什么不用 `--window-size`

**实测**（本次新增的探针脚本输出）：

```
--window-size=360,780  → 实际视口 500x693   ← 被 Chromium 钳到 500px 下限
--window-size=390,844  → 实际视口 500x757
--window-size=1280,900 → 实际视口 1280x813
```

即：headless 下 `--window-size` 对小于 500px 的宽度**不生效**，
若直接用它做响应式断言，会在**错误的宽度**上通过 —— 这正是"假绿"。

### 6.2 改用 **iframe 视口夹具**

同一份生产页面被装入 5 个精确宽度的 iframe（同源，可访问 `contentDocument`）。
iframe 的 CSS 媒体查询**按 iframe 自身宽度求值**，布局约束也随之生效。

### 6.3 实测结果

```
响应式报告：
  360px :overflow=0, npcW=273, panelW=302, input=true
  390px :overflow=0, npcW=291, panelW=320, input=true
  412px :overflow=0, npcW=291, panelW=320, input=true
  768px :overflow=0, npcW=287, panelW=320, input=true
  1024px:overflow=0, npcW=287, panelW=320, input=true
```

每个宽度三条断言，共 15 条：无横向溢出 ｜ 世界表面未超出其容器 ｜ 输入行仍可见。

> `npcW` 在 360px 下是 273（面板 302），说明世界表面在窄屏会跟着面板收缩，不撑破布局。
> 768px 以上面板固定 320px，NPC 表面 287 —— 与既有面板宽度一致，未引入新的宽度体系。

---

## 7. Performance（§17）

| 关注点 | 措施 | 断言 |
|---|---|---|
| World Surface 每秒重建 | **指纹短路** | ✅ 30 次连续刷新全部被跳过（`applied` 不变、`skipped` +30） |
| NPC 列表 | 按 id key 复用 + 文本签名比对 | ✅ 复用逻辑有单点断言（`npcRowCount()` 稳定） |
| 事件列表 | 行数按需增减 + 文本签名比对 | ✅ 同上（`eventRowCount()`） |
| 聊天消息 | **未触碰**（本阶段不涉及 `ui/message.ts`） | 既有 `typewriter` / `viewcaps` 套件全绿 |
| 时钟 tick | 不触发整页重渲染（只在既有 `updateScheduleUI` 之外**增加一次指纹比对**） | ✅ 冒烟 + 指纹断言 |

---

## 8. 新增 assertions（+44）

| 套件 | 新增 | 内容 |
|---|---|---|
| `架构边界` | **+1** | `ui/` 层不修改 store / aiState |
| `e2e`（phase 10） | **+43** | VM 契约 6 条 · 时间映射 4 条 · NPC 表面 4 条 · 不编造 2 条 · Core Fact 隔离 6 条 · 性能 2 条 · 响应式 15 条 · 前置事实 2 条 · 其它 2 条 |

---

## 9. Defect Injection（§16 的五项，全部可捕获）

| # | 注入内容 | 捕获它的断言 | 结果 |
|---|---|---|---|
| **A** | 让 UI 直接读/修改 `store`（`world-surface.ts` 里 `store.storyProgress += 0`） | `ui/ 层不修改 store / aiState` | ✅ 变红 |
| **B** | 让 UI 直接 `fetch`（`world-surface.ts` 里 `void fetch("/api/chat")`） | `ui/ 层不碰 localStorage / fetch / indexedDB` + `fetch 只出现在 ai/ 目录` | ✅ 变红 ×2 |
| **C** | 让 narrative 进入 Recent Events（`event-surface.ts` 去掉 `factual` 过滤） | `narrative 事件**没有**出现在世界事件流里` | ✅ 变红 |
| **D** | 让 UI 自动生成不存在的 NPC activity（把"（还没有她的消息）"换成编造的"正在安静地休息"） | `Core 没有 activity/location 时如实显示「还没有她的消息」，不编造活动` | ✅ 变红 |
| **E** | 破坏 mobile layout（`.npc-row { min-width: 520px }`） | `360px：无横向溢出`（iframe 夹具） | ✅ 变红 |

### 9.1 过程中一次「守卫空转」的发现与修正

Injection A 第一次**没有被捕获**：既有的 `ui/` 职责守卫只检查
`localStorage` / `fetch` / `indexedDB` 三类，**没有任何一条覆盖"UI 改世界状态"**。

这暴露的是一个真实盲区（而不是注入没写好）：`ui/` 完全可以在不碰 localStorage、
不发网络请求的情况下**直接改 store**，而当时所有静态守卫都会放过它。
为此新增了 §5.1 的那条守卫，随后 Injection A 立即被捕获。

> **注**：`tests/boundaries.test.mjs:260` 保留了一行**故意的**跳过规则
> （跳过带缺陷注入标记的注释行），这是设计的一部分，不是残留。

全部注入已验证恢复；`grep -rn "🧪" playground/ styles/ tests/` → **0 处**；`tsc --noEmit` 零错误。

---

## 10. verify / typecheck / build

```
npm run verify    → EXIT=0        931 断言 / 0 失败
npm run typecheck → EXIT=0
npm run build     → EXIT=0        ✓ built in 2.13s
                                    chat chunk 92.75 kB (gzip 42.20 kB)
```

`npm run test:css` 仍为 **12 通过 / 0 失败** —— 本阶段新增的 `.npc-row*` / `.world-event*`
规则是**纯新增**，未修改任何既有声明，所以声明级等价证明继续成立。

---

## 11. 剩余问题

| # | 问题 | 现状 |
|---|---|---|
| U1 | `#story-events` 仍然**不分来源**地渲染全部档案（`story.ts` 的 `updateStoryUI`） | 本阶段**未改** —— 它属于 5-A4（Recent Core Events）的范围，且修改它需要动 `story.ts`（领域层渲染，A-2 议题） |
| U2 | `StoryEvent.priority` 仍无 UI 消费者 | 只在 VM 里暴露（`WorldEventVm.priority`），未上屏 |
| U3 | `npc.goal` 仍未上屏 | VM 里有（`WorldNpcVm.goal`），未渲染 |
| U4 | 领域模块自渲染（`time.ts` / `story.ts` / `agenda.ts` 直接写 DOM） | 既有设计，`GAMEPLAY_REVIEW.md` A-2 记录；本阶段未搬动 |
| U5 | 「其他角色」节默认展开状态沿用既有折叠逻辑（localStorage `panel.section.*`） | 未改 |
| U6 | `--window-size` 在 headless 下不可用于 <500px | 已用 iframe 夹具绕过；e2e 注释记录了原因 |
| U7 | U1–U10（Phase 4 遗留 P2 整洁项） | 按要求未动 |

---

## 12. 下一阶段建议

### 12.1 立即可做（5-A4 / 5-A5）

| 项 | 内容 | 注意 |
|---|---|---|
| **5-A4** | Recent Core Events 正式化 | VM 的 `coreFacts` 与 `event-surface` 已就位；剩下的是**决定**是否把 `#story-events` 改为只显示 Core Fact，或保留"全量回顾 + 区分标记"。后者需要一次**有意的**设计决定（因为它会改变"剧情进展"节的语义） |
| **5-A5** | 视觉打磨 | 目前 `.npc-row` / `.world-event` 只用既有 token 做了最小表达（细边框 + 小圆角 + 灰度层级）。打磨方向应是：**在场者的层次、事件流的时间感、窄屏的呼吸感** |
| — | 把 `npc.goal` / `priority` 上屏 | 数据已在 VM 里，属纯渲染 |

### 12.2 需要决策的点（不算 DECISION_REQUIRED，但有设计取舍）

| # | 取舍 |
|---|---|
| D1 | `#story-events`（剧情进展节的档案列表）要不要改成"只显示 Core Fact"？<br>**改成只 Core** = 与"最近发生"重复且信息变少；**保留全量** = 需要来源标记（本阶段已把 `source` 放进 VM） |
| D2 | 世界表面要不要显示 NPC 的 `relToMain`？<br>它是既有标量（不是 38 维），但暴露它会让关系变成"可刷的数值" |
| D3 | 事件流要不要带时间（`HH:MM`）？<br>当前 `StoryEvent` **没有时刻字段**（只有 `day`），要显示时刻就必须改存档契约 → **属禁止项**，因此本阶段**未做** |

### 12.3 不建议做

- ❌ 世界地图 / 大仪表盘 / 侧边栏重构（Phase 5 §6 明确避免）
- ❌ 把 38 维整体搬上屏（§7 明确避免）
- ❌ 为"看起来更活"而新增任何 UI 侧的推断/占位数据（§14）

---

**Phase 5-A（5-A1 ～ 5-A3）完成。按 §22 停止条件立即停止，未做 5-A4 / 5-A5，等待下一条指令。**
