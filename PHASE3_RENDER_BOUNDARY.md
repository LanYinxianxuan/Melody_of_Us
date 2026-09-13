# 阶段 3 · Render Boundary（渲染边界）实施方案

> 目标：把 `playground/chat.ts`（1920 行、100 个 DOM 查询点、32 处 import 期副作用）
> 拆成职责清晰的模块，让"谁渲染了什么"成为可验证的边界，而不是一坨散落在业务流程里的
> `document.getElementById(...)!`。
>
> **游戏性冻结**：本阶段是**纯结构变更**。38 维情感、公式、NPC 规则与作息、时间规则、
> 关系与记忆、剧情/事件生成、玩家动作语义、世界状态语义、Director 职责、AI 修改世界状态的
> 权限、胜负条件、主循环 —— 一律不得改动。任何"顺手改一下"的冲动都必须记进
> `GAMEPLAY_REVIEW` 而不是直接动手。

---

## 0. 为什么需要"边界"，而不是"拆文件"

`chat.ts` 现在的问题不是"太长"，而是**三件事混在同一层**：

1. **世界状态与它的一致性**（`store`、`aiState`、`agenda`、`turnCheckpoints`）
2. **业务流程**（sendMessage → AI → 应用 delta → 落盘 → Director/NPC 检查 → 随机事件）
3. **DOM 装配**（appendMessage / typeReply / updateStateUI / updateScheduleUI / …）

混在一起导致两个具体后果：

- **32 处 import 期副作用**（DOM 绑定、时钟启动、门控注册、向导调度）散落在文件各处，
  初始化顺序只能靠"读完整文件"来保证。阶段 2 已经因此踩过一次 TDZ 白屏（menu.ts）。
- **100 个 DOM 查询点**里有 12 个在业务函数内部，意味着"渲染"这件事没有单一入口，
  任何一次重构都可能悄悄改变渲染输出的形状。这正是本阶段先补
  `tests/render-boundary.e2e.ts` 的原因。

---

## 1. 目标模块映射

```
playground/
  app/
    boot.ts          ← chat.ts 的 import 期副作用集中处（唯一入口，顺序显式）
    wiring.ts        ← 事件绑定（按钮/输入/键盘/菜单链接），全部集中
  ui/
    dom.ts           ← 查询点的唯一收口：qs/qsAll/el + 启动期存在性断言
    message.ts       ← appendMessage / appendSystemMessage / typeReply / trimContainer
    state-panel.ts   ← buildMeters / updateStateUI / renderAgentDebug 调用
    schedule.ts      ← updateScheduleUI / agenda 渲染 / story-line
    modals.ts        ← 角色弹层 / 聊天记录 / 情感明细 / 向导入口
    suggest.ts       ← renderActionSuggestBar（预判动作条）
  core/
    turn.ts          ← 一轮对话的检查点（RedoCheckpoint / trimTurnCheckpoints / 重答）
    world.ts         ← Director / NPC / 随机事件的编排（只做编排，不含规则）
  ai/
    client.ts        ← 唯一网络出口（fetch 调用集中；当前 ai.ts/director.ts/tts.ts/menu.ts 各自 fetch）
  save/
    persist.ts       ← saveState 的调用点收口 + 只读档守卫
  chat.ts            ← 仅保留：模块级状态声明 + 装配 app/boot.ts
```

**硬约束**

- `chat.ts` 拆分后**必须仍然可以单独 import**（`tests/*.e2e.ts` 与生产 HTML 都这么做）。
  因此 `chat.ts` 保留为"薄装配层"，而不是把入口改成 `app/boot.ts`。
- 不得引入循环依赖。分层方向固定为 `ui → core → ai/save → 领域模块（mind/time/story/…）`，
  反方向只能通过既有回调注入模式（`setXxxSender` / `setYyyGate`）实现。
- 领域模块（`mind/time/story/agenda/npc/director/…`）**不参与**本次搬迁。它们里面确实有
  渲染函数（`story.ts` / `time.ts` / `agenda.ts` 各有一处），但那是既有设计，
  搬迁属于"顺手改架构"，记 `AI_ARCH_REVIEW`，不在本阶段做。

---

## 2. 迁移顺序（每一步都必须单独可回滚）

每一步结束时**必须**满足：`npm run verify` 全绿（含 `test:css`、`renderboundary` 套件）。

| 步 | 动作 | 为什么是这个顺序 | 回归风险 |
|---|---|---|---|
| 3.1 ✅ | 建 `ui/dom.ts`：`el()` / `optEl()` / `qs()` / `qsa()` + `MissingNodeError` | 收口是后面所有搬迁的前提 | 极低 |
| 3.2 ✅ | `chat.ts` **全部 100 个查询点**迁到 `ui/dom.ts`（0 残留）；`action-suggest.ts` / `event-card.ts` / `mind-debug.ts` 一并迁完 | 业务函数内部的查询是"渲染无单一入口"的根因 | 低（过程中 codemod 引入过 1 处真实类型 bug，见下） |
| 3.3 ✅ | 抽 `ui/message.ts`（MAX_* / trimContainer / scrollMessagesToBottom / appendMessage / appendSystemMessage / attachTimeStamp / typeReply） | renderboundary 套件覆盖最密的区域，先动它收益最大 | 中（打字机 rAF + 看门狗时序逐字保留） |
| 3.4a ✅ | 抽 `ui/state-panel.ts`（buildMeters / updateStateUI / drawChart / logEmotion / resetChartHistory） | 纯渲染搬迁 | 低 |
| 3.4b | 抽 `ui/modals.ts`（openHistory / renderHistoryToChat / fillCharForm / readCharForm） | 纯渲染搬迁 | 低 |
| 3.4b ✅ | 抽 `ui/modals.ts`（历史面板 + 角色弹层 + 表单读写；226 行） | 纯渲染搬迁 | 低（新增 phase 3 断言 15 条 + 缺陷注入验证） |
| 3.5 ⏸ | `core/turn.ts` —— **不抽**，理由见下 | — | — |
| 3.6 ⏸ | `core/world.ts` —— **不抽**，理由同 3.5 | — | — |
| 3.7 ⏸ | `save/persist.ts` —— **不新建**，理由见下 | — | — |
| 3.8 ⏸ | `app/boot.ts` —— **不做迁移**，分析见 `BOOT_SIDE_EFFECTS.md` | — | — |
| 3.9 ✅ | 安全边界（架构断言 + 文档）见下 | — | 低 |

### 3.5 / 3.6 为什么不抽

这两步的目标模块本质上都是"**内联的过程**"，不是可独立编译的模块：

- `RedoCheckpoint` 的字段直接引用 `typeof store.agenda` 与
  `ReturnType<typeof snapshotAgentMind>`（`mind.ts`）。要抽成 `core/turn.ts`，
  要么让 core 依赖 store/mind（方向仍然正确，但只搬走约 45 行），
  要么把 10 个字段全部参数化 —— 后者会让调用点从 1 处变成 1 处 + 10 个实参，
  **可读性变差，而没有任何行为收益**。本次采用前者之外的第三种选择：不抽。
- `core/world.ts` 要抽的是 `maybeDirector` / `maybeNpcIntervention` / `maybeShowEventCard`
  三处**编排**，它们每一个都闭包引用了 chat.ts 的私有状态（`directorBusy` / `npcBusy` /
  `demoMode` / `hasApiKey` / `ui.*` 渲染调用）。抽出去等于把"世界编排"和"页面状态"
  强行分离，反而增加参数传递面。

**共同判断依据**：纯搬迁的收益是"文件更短"，成本是"参数面变大 + 每步都要重验"。
在这两处，成本大于收益。真正的边界收益已经由 3.2–3.4b 拿到
（渲染出口已收口、网络出口已唯一、DOM 归属已可断言）。

### 3.7 为什么不新建 `save/persist.ts`

落盘路径**已经**是单一出口，而且规格比要新建的包装层更强：

- `storage.ts` 的 `saveState()` 内部已经包含只读守卫
  （`lastLoadOutcome` 为 损坏/未来版本/读取失败 时**拒绝写入**并走 `reportFailure`）。
- `chat.ts` 里 11 处 `saveState()` 调用点全部走它，**没有一处**自己拼 `writeKey`。
- 失败上报由 `setSaveFailureHandler` 全局注册一次，用户可见。

新建一个 `persist.ts` 只能做到"再导出一次"，属于纯增加间接层。
`save/persist.ts` 的名字可以用在**将来**把 `saveState` 的调用点从 chat.ts 移出时，
但不应该为了这个名字先造一个空壳。

**顺带记录的观察**（不构成问题）：11 处调用点都忽略了 `saveState()` 的布尔返回值。
这是刻意的 —— 失败由全局 handler 统一呈现给用户（`tests/save-failure.e2e.ts` 覆盖），
逐个调用点分支处理会产生 11 份重复的失败 UI。

### 3.2 的教训：codemod 会引入**真实的类型 bug**

机械替换 `document.getElementById(x) as T \| null` → `ui.el<T \| null>(x)` 时，
`el<T>` 的返回类型是 `T`（非空），于是 `?.` 变成"永远不会短路"，一次缺节点就从
"优雅跳过"变成"运行时崩溃"。本次替换里出现 1 处 `agent-toggle`、1 处 `chat-input`。

**结论**：涉及 `\| null` / 可选链的机械替换必须逐个复核，不能只看 `tsc` 是否通过
（这两处 `tsc` 都是通过的 —— `T \| null` 也满足 `T`）。

**3.8 的顺序陷阱（已踩过一次，写在这里）**：
`menu.ts` 因为 `loadSlotSettings(activeSlot)` 写在 `const ttsApiKeyInput = …` 之前，
在 import 期抛 `ReferenceError: Cannot access 'ttsApiKeyInput' before initialization` ——
整个页面白屏，而 422 条 e2e 断言**全部通过**（因为它们不装载真实菜单页）。
所以 3.8 之后必须跑 `tests/smoke.mjs`（真实页面装载 + 未捕获错误检查），
只跑 e2e 是不够的。

---

## 3. 安全网（已完成）

`tests/render-boundary.e2e.ts`（入口即 `chat.ts` 的真实装配）17 条断言：

| 类别 | 断言 | 捕捉什么退化 |
|---|---|---|
| ① DOM 形状契约 | 本轮新增节点里有 user 且 ai、user 在 ai 之前、都带 `msg` 基类、时间戳在消息内部 | 装配点被搬错（把 `msg-ts` 挪到外层、把 user/ai 顺序调换） |
| ① DOM 形状契约 | AI 消息内部首个块是 `.msg-avatar`；必须含 `.dialogue`；不得出现契约外的类名 | 消息内部装配顺序漂移 |
| ② 零网络出口 | 演示模式启动阶段 + 完整一轮：`fetch` 调用数必须为 0 | 重构时漏掉某个 `demoMode` 早退 |
| ③ 门控活绑定 | `busy=true` 时 live gate 返回 `false`；`busy=false` 时返回 `true`（**同一段里同时观察两种结果**） | 把 `busy` 读成注册时快照 / 恒 false 的门控蒙混过关 |
| ④ 收口器契约 | `el()` 取到真实节点；缺节点时抛 `MissingNodeError` 且带 nodeId；`optEl()` 返回 null；`qsa()` 返回空数组 | 把 `getElementById(x)!` 换成"静默返回 null"的伪收口器 |

**灵敏度已用"故意还原缺陷"证明**（不是只看绿灯）：

- 把 `setProactiveGate(() => !busy && !userIsTyping())` 改成读注册时快照
  → 断言 ③ 立即变红，`observed=[{"result":true,"busy":true},…]`，2 条失败。
- 把 `.btn` 的 `text-decoration` 删掉、`.agenda-item` 的 `flex-wrap` 删掉、
  `.meter .bar` 高度改错 → `test:css` 立即变红，3 处全部报出。

配套设施（本阶段为支撑上述断言而修的真实缺陷，见第 4 节）：
- `tests/e2e.mjs` 新增 `suite.prelude`：允许套件在 `/bundle.js` **之前**注入经典脚本，
  用来在 `chat.ts` 模块求值前植入 localStorage（"是否演示模式"是模块求值期定下的）。
- `tests/e2e.mjs` 失败时会打印页面标题与已写入的结果节点 —— 定位"跑到一半停住"这类
  问题从"只能猜"变成"看得见"。

---

## 4. 本阶段修掉的两个**测试基础设施真实缺陷**

实施安全网的过程中，测试自身暴露了两个真 bug。它们都属于"测试假装在保护你"这一类，
比被测代码的 bug 更危险。

### 4.1 注入的兜底报错脚本**一直是语法错误**（从未生效）

`buildFixtureHtml()` 用模板字面量拼注入脚本，里面写了：

```js
pre.textContent = "E2E_FATAL|模块加载期抛错\n" + window.__e2eLoadError;
```

模板字面量会把 `\n` 解释成**真的换行**，于是生成的 HTML 里那个内联脚本变成
`"...抛错<换行>"` —— 字符串未闭合，**整个 `<script>` 报 `SyntaxError` 并被丢弃**。

后果：夹具里"模块加载期抛错时兜底显示"的机制从来没工作过。
表现是本阶段排查中"页面脚本抛错"的诊断信息全部指向别处，浪费了大量时间。

修法：改成 `"…抛错" + String.fromCharCode(10) + window.__e2eLoadError`，
彻底绕开模板字面量转义陷阱（而不是再加一层 `\\n` 去赌解析层数）。

### 4.2 虚拟时间预算过大反而让测试"跑到一半停住"

`--virtual-time-budget` 不是"给多少都更安全"：

- 太小 → 页面脚本还没写完结果，`--dump-dom` 就退出了（原来的注释记录的正是这个）。
- 太大（例如 180000）→ 虚拟时间被快进后，`chat.ts` 的常驻定时器（1s 时钟、随机事件轮播、
  打字机看门狗）持续消耗预算，**`--dump-dom` 可能已经发生、套件却还在跑**。
  这时结果节点里只剩最后一条 `E2E_BEAT`，而 `e2e.mjs` 会把它误报成
  "未产出结果节点 / 页面脚本可能抛错" —— 与真实原因完全无关。

结论：预算给 20–60s，**需要更长等待的套件自己用次数（而不是挂钟时间）做上限**。
`waitFor()` 因此显式用 `maxAttempts` 而不是 `Date.now()`：定时器回调与 `Date.now()`
在虚拟时钟下不是同一个节奏。

**另一个同源陷阱**：用"永久挂起的 fetch"钉住 `busy` 会让浏览器一直有未完成工作，
虚拟时钟随之停摆，后续步骤全部不执行。因此"门控活绑定"这组断言改成**同步主线**
（`click()` 是同步派发，`busy` 与门控都能立刻读到），只在最后用一个可放行的响应收尾。

---

## 5. 验收标准

1. `npm run verify` 全绿（typecheck + build + unit + **css** + dist + e2e + smoke）。
2. `node tests/e2e.mjs` 断言数 ≥ 440 且 0 失败。
3. `renderboundary` 套件 22 条断言全绿，且**故意还原缺陷时必定变红**（灵敏度已复现：
   把 `busy` 读成注册时快照 → 2 条核心断言变红）。
4. `chat.ts` 行数显著下降，且 `ui/dom.ts` 之外的裸 `document.getElementById` 为 0。
5. 游戏性零变化：主循环、情感公式、NPC 规则、时间规则、Director 权限、胜负条件全部未动。

---

## 6. 本阶段不做（记入 `GAMEPLAY_REVIEW` / `AI_ARCH_REVIEW`）

- `director.ts:213`、`tts.ts:376/426`、`menu.ts:423` 也各自直接 `fetch`，
  因此"`ai/` 是唯一网络出口"目前**不成立** —— 收敛它们属于架构变更，本阶段只搬迁 chat.ts。
- `story.ts` / `time.ts` / `agenda.ts` 内含渲染函数（领域层反向依赖 UI）。
- `mind.ts` 用 `(store as any).x =` 绕过类型检查写入 store。
- `store.turnCount` 有读无写（无自增点）、`userLocation` / `pendingOvernight` 是死字段。
- `.ico-lg` 是死规则、`home.html` 的 `ic-logo` 是孤儿类（阶段 2 已记录）。
- `noUncheckedIndexedAccess` 仍关闭（实测 +108 错误，约 100 条来自 `AIState` 索引签名）。
