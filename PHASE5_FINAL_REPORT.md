# PHASE5_FINAL_REPORT.md

> 阶段：**Phase 5 Final「World Surface 收尾」** —— 5-A4 Story Log 来源可视化 + 5-A5 视觉打磨
> 验证基线：`npm run verify` **EXIT=0**，**964 断言 / 0 失败**
> `npm run typecheck` EXIT=0 ｜ `npm run build` EXIT=0
>
> **# Phase 5 DONE.** 按停止条件立即停止，未进入 Phase 5-B / 5-C / Phase 6。

---

## 0. assertions before / after

| 项 | 值 |
|---|---|
| **before**（Phase 4-D 基线） | **887** |
| Phase 5-A1～A3 后 | 931（+44） |
| **after**（本次） | **964** |
| **本次净新增** | **+33** |
| **failures** | **0** |

拆分：`e2e 626 → 659`（+33，新增 phase 11「Story Log 来源与空状态」＋加强 phase 10 的响应式检测）。
其余套件**全部持平**（save-schema 88 / voice-store 44 / 状态闸门 43 / agent-smoke 50 / CSS 12 / 边界 12 / dist 47 / smoke 9）。

**Phase 4-D 的 887 条基础覆盖未减少任何一条。**

---

## 1. 5-A4 Story Log 来源设计

### 1.1 正式设计决定（按指令执行）

**不删除全量历史。** `#story-events` 保留为「**历史叙事 / Story Log**」，
继续让用户看到过去发生过的叙事 —— 但**每条都增加来源标记**。

### 1.2 来源视觉语义

| `source` | 标记文案 | 灰度 | 语义 |
|---|---|---|---|
| `core` | **事实** | `--ink`（最深） | 世界中已经被 Core 确认发生过的事 |
| `narrative` | **叙述** | `--ink-faint` | 她当时的讲述，不一定是世界事实 |
| `director` | **调度** | `--ink-faint` + `opacity:.8` | 世界调度层当时的判断理由 |

**数据语义完全未变** —— 只加了展示层标记。`StoryEvent` 的字段、存档契约、`SAVE_VERSION` 一字未动。

### 1.3 实现位置与依赖方向

新增 `playground/ui/world/story-log-surface.ts`，`story.ts` 的 `updateStoryUI()` 把**事件列表**这一段交给它：

```
story.ts  →  ui/world/story-log-surface.ts   （渲染助手，单向）
ui/world/world-view-model.ts  →  story.ts    （读 storyStage()，单向）
```

> ⚠️ **过程中发现并修复了一个真实的循环依赖**：
> 第一版让 `story.ts` 直接 `import { buildWorldViewModel }`，而
> `world-view-model.ts` 又 `import { storyStage } from "./story"` —— **成环**。
> 改为**注入式**（`setStoryLogEventsProvider`）并把 `story-log-surface` 的入参
> 收窄成它自己的最小类型 `StoryLogRow`，依赖重新变成单向。
>
> 另外：注入点第一版对 `undefined` 不设防（测试传 `undefined` 恢复默认时会把 provider 弄坏），
> 已修正为"传空即恢复生产数据源"，并在 `story.ts` 侧加了函数性防御。

---

## 2. Recent Core Events 与 Story Log 的区别

| | Recent Core Events | Story Log |
|---|---|---|
| 容器 | `#world-events`（`section-worldfeed`） | `#story-events`（`section-story`） |
| 文件 | `ui/world/event-surface.ts` | `ui/world/story-log-surface.ts` |
| 数据 | `WorldViewModel.coreFacts` | `WorldViewModel.allEvents` |
| 过滤 | **只** `source === "core"` | **全部**来源 |
| 语义 | 「世界最近**真正**发生了什么」 | 「完整叙事记录」 |
| 重叠 | **允许部分重叠**（指令明确：不为了去重而删信息） | 同左 |

### 2.1 Recent Events 有**两层**过滤（结构性防线）

```ts
// ① VM 层：coreFacts = events.filter(e => e.factual)
// ② 表面层（event-surface.ts）：
const factual = events.filter((e) => e.factual).slice(-MAX_ROWS);
```

第二层是刻意的 —— 只依赖"调用方记得传过滤后的列表"会把防线变成**约定**而不是**保证**。

**可执行证明**：e2e 直接调用 `renderEventSurface(allEvents)`（**误传全量档案**），
断言 narrative 仍然不出现。注入 B（去掉第二层过滤）时该断言立即变红。

---

## 3. D3：时间字段为什么不添加

按指令 **D3 不解决**。

| 项 | 状态 |
|---|---|
| `StoryEvent` 结构 | `{ day, text, source?, priority? }` —— **保持不变** |
| `SAVE_VERSION` | **未变**（仍为 1） |
| migration | **未新增** |
| timestamp 字段 | **未添加** |

**因此 Story Log 只显示"第 N 天"**（今天则完全不标天数），
**绝不**用 `Date.now()` 或当前虚拟时间去冒充事件发生时刻。

**可执行证明**：e2e 两条断言 ——
「Story Log 不显示任何时刻（`StoryEvent` 没有 `HH:MM` 字段）」+
「Story Log 的日期只来自事件的 `day` 字段（形如 `第 N 天` 或空）」。
注入 D（把 `dayText` 换成 `new Date().toTimeString().slice(0,5)`）时**两条同时变红**。

---

## 4. 5-A5 UI 最终效果

### 4.1 视觉原则的落实

| 原则 | 落实 |
|---|---|
| 继承既有 Design System | 新规则**全部**走既有 token（`--sp-*` / `--fs-*` / `--ink*` / `--line` / `--r` / `--font-mono`），未引入任何新的颜色或尺寸体系 |
| 黑 / 白 / 低饱和 | 来源标记只用**灰度**表达可信度差异，**不用颜色**（没有彩色 chip / 胶囊 / 图标） |
| 细边框 | NPC 行沿用 `.agenda-item` 的 `border-left: 2px solid` 语言 |
| 小圆角 | `var(--r)` = 2px，全局一致 |
| 大量留白 / 克制 | 空状态只留一行灰字；事件行 `padding: var(--sp-2) var(--sp-4)` |
| 避免 RPG HUD / Dashboard | 没有数值条、没有仪表盘、没有彩色标签、没有阴影 |

### 4.2 信息层级（三层）

| 层 | 内容 | 保证方式 |
|---|---|---|
| 第一层 · 聊天 | `#chat-wrap` / `#chat-messages` / `#chat-input-row` | e2e 断言：聊天区与世界表面**互不包含**、两者宽度均 > 0、输入行可见 |
| 第二层 · 当前世界状态 | 时间胶囊（既有）/ 场景卡（既有）/ **其他角色**（新）/ 剧情进展（既有） | 折叠节，默认展开状态沿用既有逻辑 |
| 第三层 · 历史事件 | **最近发生**（新）/ Story Log（已加来源标记） | 同上 |

**没有让 World Surface 抢过聊天**：所有新增内容都在既有 `#state-panel` 之内，
未新增浮层、未覆盖聊天、未改动 `#chat-*` 的任何结构与样式。

### 4.3 NPC Surface 的显示优先级

```
名字  →  当前活动  →  当前地点
例如：小雨 / 在图书馆，正在看书
```

**未暴露**：38D 数值、`relToMain`、`npc.goal`。
e2e 三条断言直接检查 `#state-panel` 的**全部文本**：

```
✅ 普通界面不展示 npc.goal（内部世界逻辑，非玩家信息）
✅ 普通界面不展示 38 维原始数值墙（valence/arousal/neuroticism 等）
✅ 普通界面不展示 NPC 的关系数值（relToMain）
```

### 4.4 空状态（自然、无开发者味道）

| 位置 | 文案 |
|---|---|
| NPC 无 activity/location | 「（还没有她的消息）」 |
| Recent Events 无 Core Fact | 「还没有发生什么——日子正安静地过着。」 |
| Story Log 无事件 | 「还没有值得记下的事。」 |

e2e 断言这些文案**不含** `ERROR` / `NULL` / `undefined` / `[]` / `No events` / `NaN`。

### 4.5 动画

**本阶段未新增任何动画。** 状态变化仍用既有的 `transition`（`--dur-base` / `--dur-fast`）。
未引入粒子、WebGL、大面积 blur、每秒重建 DOM。

---

## 5. Responsive

### 5.1 方法（沿用 Phase 5-A 的 iframe 视口夹具）

`--window-size` 在 headless 下对 <500px 不生效（实测恒为 500px），因此用 iframe
精确宽度夹具（iframe 的媒体查询按自身宽度求值）。

### 5.2 每个宽度现在有 **5 条**断言（原 3 条 → 5 条）

```
360 / 390 / 412 / 768 / 1024 各：
  ① 无横向溢出（documentElement）
  ② 世界表面未超出其容器
  ③ 聊天输入行仍可见
  ④ 【新】世界表面的每个元素都没有被撑宽（逐元素 scrollWidth 检查）
  ⑤ 【新】「其他角色」折叠节可正常开合
```

### 5.3 ⚠️ 本次发现并修复的**响应式断言盲区**（重要）

Injection F（`min-width: 520px`）**第一次没有被捕获**。根因：

```
html, body { overflow-x: hidden }        ← 把溢出裁掉，scrollWidth 不增长
#state-panel { overflow-y: auto }        ← 变成滚动容器，溢出被"吸收"
→ documentElement.scrollWidth 完全不变
```

也就是说：**"元素被撑宽"这类真实的移动端回归，原有的 `scrollWidth` 断言在结构上就看不见。**

改为**逐元素**判据（`el.scrollWidth > el.clientWidth`，并检查面板自身），
再加一条"行宽不得超过视口"。加强后同一注入**在 5 个宽度全部变红**：

```
❌ 360px：… ← #state-panel(534>301), .npc-row(518>518)
❌ 390px / 412px / 768px / 1024px：同样变红
```

### 5.4 实测结果（加强后，全部通过）

```
360px :overflow=0, npcW=273, panelW=302, input=true, 逐元素=0 溢出, 折叠=可用
390px :overflow=0, npcW=291, panelW=320, input=true, 逐元素=0 溢出, 折叠=可用
412px :overflow=0, npcW=291, panelW=320, input=true, 逐元素=0 溢出, 折叠=可用
768px :overflow=0, npcW=287, panelW=320, input=true, 逐元素=0 溢出, 折叠=可用
1024px:overflow=0, npcW=287, panelW=320, input=true, 逐元素=0 溢出, 折叠=可用
```

**额外确认项**：NPC 文本不溢出（逐元素检查）· Event source badge 不挤压正文
（e2e 断言 badge 宽度 < 行宽一半）· 折叠区域可开合 · 输入框不被遮挡。

---

## 6. Performance

| 项 | 状态 |
|---|---|
| fingerprint short-circuit | **保持**（phase 10 断言：内容未变时连续 30 次刷新全部被短路） |
| Story Log 加入 badge 是否导致整块重建 | **否**：`story-log-surface` 与 `event-surface` / `npc-surface` 一样按**行复用 + 文本签名比对**，只在签名变化时写 `textContent` |
| clock tick → World DOM 重建 | **未发生**（指纹只含影响渲染的字段；`storyEvents`/`coreFacts` 变化才改指纹） |
| chat messages / typing renderer | **完全未触碰** |
| 行数上限 | Story Log 6 行（与既有 `slice(-6)` 一致，**未改变展示量**）· Recent Events 6 行 |

---

## 7. Boundary

### 7.1 静态守卫（`tests/boundaries.test.mjs`，12 条全绿）

```
✅ strict 层（渲染层）不得绕过收口器直接 querySelector
✅ forbidden 层（规则/网络/持久化）零 DOM 访问
✅ entry 层原生查询数不超过已登记预算
✅ 世界规则 / 网络 / 持久化层（16 个模块）零 DOM 访问
✅ chat.ts 已完全迁移到 ui/dom 收口器
✅ 全仓零 (store as any)
✅ ui/ 层（9 个模块）不碰 localStorage / fetch / indexedDB
✅ ui/ 层不修改 store / aiState
✅ 除 storage.ts 外，无人直接写 melai-state-* 存档键
✅ fetch 只出现在 ai/ 目录
✅ ai/ 之外的模块通过 ai/client 的传输层发起请求
```

本阶段新增模块已登记为 `strict`：`ui/world/story-log-surface.ts`。

### 7.2 数据流（严格保持）

```
World State（Core）
      ↓
WorldViewModel（只读、可序列化、无 DOM）
      ↓
World Surface / NPC Surface / Recent Core Events / Story Log
      ↓
DOM
```

**没有反向箭头。** 4 个 `ui/world/*.ts` 中没有任何一处对 `store` / `aiState` 的赋值。

---

## 8. Defect Injection（6 项，全部可捕获）

| # | 注入内容 | 捕获它的断言 | 结果 |
|---|---|---|---|
| **A** | Story Log 来源混淆（所有来源都渲染成「事实」） | `【前置事实】三种来源都存在` + `narrative 被标为「叙述」` | ✅ 变红 ×2 |
| **B** | Recent Events 接收 narrative（去掉表面层过滤） | `即使误传全量档案，Recent Events 也不渲染 narrative` | ✅ 变红 |
| **C** | UI 修改 world state（`story-log-surface` 里写 `store`） | `ui/ 层不修改 store / aiState` | ✅ 变红 |
| **D** | UI 伪造 event timestamp（用 `Date.now()` 冒充时刻） | `Story Log 不显示任何时刻` + `日期只来自 day 字段` | ✅ 变红 ×2 |
| **E** | UI 伪造 NPC activity（编造"正在安静地休息"） | `Core 没有 activity/location 时如实显示「还没有她的消息」` | ✅ 变红 |
| **F** | mobile overflow（`.npc-row { min-width: 520px }`） | `世界表面的每个元素都没有被撑宽` | ✅ **5 个宽度全部变红** |

### 8.1 过程中发现的两处「断言空转」与一处「断言盲区」

| # | 现象 | 根因 | 修正 |
|---|---|---|---|
| 1 | **A 只被 1 条捕获** | 另外两条写的是 `rows.filter(源).every(标签正确)` —— 当 `filter` 得到**空数组**时 `every` **恒真**，断言静默通过 | 补一条**前置事实**断言（三种来源都存在），并把三条改成"存在 **且** 标对" |
| 2 | **B 完全没被捕获** | 测试检查的是 VM 的 `coreFacts`（**已经**过滤过），而注入在**表面层** —— 根本没触到 | 补一条直测：**直接把全量档案喂给表面**，验证表面自身的结构性防线 |
| 3 | **F 完全没被捕获** | `overflow-x:hidden` + `overflow-y:auto` 把溢出**吸收**了，`documentElement.scrollWidth` 恒不变 | 改为**逐元素** `scrollWidth > clientWidth` 判据 |

> 三次都不是"注入写得不好"，而是**断言本身不够强**。
> 这类问题如果在真实回归里发生，表现就是"测试全绿但用户看到坏掉的布局"。

全部注入已验证恢复；`grep -rn "🧪" playground/ styles/` → **0 处**；`tsc --noEmit` 零错误。

---

## 9. verify / typecheck / build

```
npm run verify    → EXIT=0        964 断言 / 0 失败
npm run typecheck → EXIT=0
npm run build     → EXIT=0        ✓ built in 2.99s
                                    chat chunk 92.97 kB (gzip 42.13 kB)

  save-schema 88 │ voice-store 44 │ 状态闸门 43 │ agent-smoke 50
  CSS 等价性  12 │ 架构边界   12 │ 产物检查 47 │ e2e 659 │ 冒烟 9
```

`test:css` 仍为 **12 / 0** —— 本阶段新增的 `.story-event-source*` / `.story-event-day` /
`.story-event-text` / `.story-event-empty` 是**纯新增**规则，未修改任何既有声明，
声明级等价证明继续成立。

---

## 10. 最终架构状态

```
┌─────────────────────────────────────────────┐
│  AI / World Director      观察 → 提议 Intent │   无强制力
└────────────────────┬────────────────────────┘
                     ↓
┌─────────────────────────────────────────────┐
│  Core                     validate → apply  │   白名单 / 类型 / NaN / ±15
│                                               │   / 记忆净化 / NPC 世界安全守卫
└────────────────────┬────────────────────────┘
                     ↓
┌─────────────────────────────────────────────┐
│  World State    Emotion / NPC / Event / Story│   38D 与 Mind 各守其位
└────────────────────┬────────────────────────┘
                     ↓
        Core-confirmed Fact（source === "core"）
                     ↓
          Future World Context（只读 core）
                     ↓
                     AI  →  Narration  →  Player

        ── 并行的只读支路（Phase 5）──
   World State → WorldViewModel → World Surface / NPC Surface
                                → Recent Core Events（只 core）
                                → Story Log（全量 + 来源标记）
```

**World Surface 是这条链末端的一扇窗，不是一个新引擎。**

---

## 11. 后续产品开发建议

> Phase 5 的任务只有一句话：**让已经存在的世界被玩家看见。**
> 它已经完成。**下一步不该是继续重构架构。**

### 11.1 建议回到真实玩家体验

| 方向 | 为什么 |
|---|---|
| **真实试玩与观察**（自己连续玩 5–10 天游戏内时间） | 目前所有结论都来自代码与自动化断言；"世界看起来活着吗"最终只能由人来判断 |
| **文案与节奏**（她的主动开口频率、事件的疏密） | 这些是**产品手感**，不是架构问题；`proactiveDrive` / 概率都是既有旋钮，改它们属产品迭代 |
| **NPC 内容的深度**（每个 NPC 的 goal 内容、关键词、作息） | Phase 4-D 已把 `goalKind` 变成显式配置，新增/修改 NPC 只需声明它 |
| **首启体验**（`G-3`：无 Key 启动是否提示演示模式） | 已冻结待决策，是一个小的产品取舍 |
| **世界表面的信息密度调优** | 现在是克制版（名字/活动/地点 + 来源标记）；是否要再加内容（如她今天做过什么）应由试玩反馈决定 |

### 11.2 明确不建议继续做的事

| ❌ 不建议 | 理由 |
|---|---|
| 继续无限重构架构 | Phase 0–5 已把边界、闸门、因果链、渲染层全部立起来并有 964 条断言守着 |
| Phase 5-B / 5-C（世界地图 / 大仪表盘） | 与「安静的窗户」定位冲突；且当前信息密度已经够用 |
| 新增 Agent / NPC / 情绪维度 / 向量库 / 后端 | 反复被各阶段明确禁止；当前缺的不是系统数量 |
| 为"看起来更活"而新增 UI 侧推断数据 | Phase 5 §14 的红线；已有 defect injection 守着 |
| 顺手清理 U1–U10 | 本阶段按要求未动；它们不阻塞任何验收 |

### 11.3 若将来要做，优先级最高的三项

1. **`G-3` 决策**（无 Key 启动的演示模式提示）—— 一句话改动，影响首启体验
2. **真实试玩一轮后的手感调整** —— 概率/频率/文案，属产品迭代
3. **`A-2` 领域层渲染上移**（`A2_RENDER_MIGRATION.md` 已备好方案）—— 唯一的架构整洁项，但**收益是可维护性而非用户体验**，应排在产品迭代之后

---

**Phase 5 正式收尾。停止所有架构工作，等待新的明确指令。**
