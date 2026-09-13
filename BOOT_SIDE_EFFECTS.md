# BOOT_SIDE_EFFECTS.md —— import 期副作用清单与初始化顺序

> 目的：在动 `chat.ts` 的装配顺序之前，先把**当前真实存在的**顺序写清楚。
> 结论写在最后（第 5 节），那一节是本文件的核心。
>
> 采集方式：逐行阅读 `playground/chat.ts`（1595 行）+ 对全部 `playground/**/*.ts` 做
> `grep` 交叉核对，标出所有**在模块求值期执行**的语句。行号为本次采集时的工作区状态。

---

## 1. 三类 import 期副作用

### A 类：跨模块回调注册（22 处）

| # | 位置 | 注册内容 | 依赖什么必须是就绪的 |
|---|---|---|---|
| 1 | L156 | `setCharacterGetter(() => CHARACTER_REF)` | `CHARACTER_REF` 已声明（L154） |
| 2 | L161 | `setAvatarTextGetter(() => charAvatar())` | `ui/message` 已 import；`charAvatar` 是函数声明（提升） |
| 3 | L162 | `setStateGetter(() => aiState)` | `ui/state-panel` 已 import |
| 4 | L164–167 | `setCharacterRef(read, assign)` | `ui/modals` 已 import；`CHARACTER_REF` 已声明 |
| 5 | L168 | `setBusyChangeHandler(b => setBusyState(b))` | `setBusyState` 是函数声明（提升） |
| 6 | L1116–1127 | `setSaveFailureHandler(...)` | `storage` 已 import；回调体在**触发时**才执行 |
| 7 | L1129 | `setCharacterGetter(...)`（二次注册，与 #1 同值） | 同上 |
| 8 | L1130 | `setRelationGetter(() => CHARACTER_REF.relation ?? "")` | `time` 已 import |
| 9 | L1131 | `setStoryCharNameGetter(() => CHARACTER_REF.name)` | `story` 已 import |
| 10 | L1133 | `setProactiveDriveGetter(() => proactiveDrive())` | `time` 已 import |
| 11 | L1135–1140 | `setAgendaCharacterGetter(() => ({...}))` | `agenda` 已 import |
| 12 | L1142–1145 | `setTimeMessageSender(...)` | `time` 已 import；回调体延迟执行 |
| 13 | **L1148** | `setProactiveGate(() => !busy && !userIsTyping())` | `busy` 绑定（L171，早于此处）—— **必须活绑定** |
| 14 | **L1155** | `setChatCapabilityGetter(() => hasApiKey() && !demoMode)` | `demoMode`（L207）—— **必须活绑定** |
| 15 | L1157–1161 | `setSlotChangeHandler(...)` | 回调体延迟执行 |
| 16 | L1163–1178 | `setDayChangeHandler(...)` | 同上（P0-10 的 `oldDay/newDay` 显式参数） |
| 17 | L1180–1185 | `setRandomMomentHook(...)` | 同上 |
| 18 | L1187–1232 | `setWizardSavedCallback(...)` | 同上（向导完成后打招呼） |
| 19 | L1353 | `installMindDebugHooks()` | 挂 `window.__mind` |
| 20 | L1469–1472 | 无角色卡 → `setProactiveEnabled(false)` + `setTimeout(openWizard, 800)` | `CHAR_KEY` 已定义 |
| 21 | L935 | `initTts()` | `tts` 已 import |
| 22 | L938 | `void migrateVoice(currentSlot)` | `currentSlot` 已求值（`storage` 模块期） |

**A 类共同特征**：注册动作本身是同步的；**回调体全部延迟到触发时才执行**。
因此 A 类的顺序风险只在于「注册时读到的绑定是否已初始化」，而不在于回调内容。

### B 类：DOM 绑定（约 30 处）

`chat-send` / `chat-input`（keydown·input·focus）/ `menu-link` / `panel-toggle` / `panel-mask` /
`emotions-toggle`·`emotions-close`·`emotions-modal` / `demo-btn` / `npc-toggle` / `tts-toggle` /
`agent-toggle` / `reset-state` / `history-btn`·`history-close`·`history-clear` /
`char-btn`·`char-cancel`·`char-save`·`char-reset-preset` / `clock-more` 等（`bindTimeControls`）。
以及 `ui.qsa(".panel-section-toggle")` 的折叠交互（L1333–1350）。

**特征**：**不做任何状态判断**，只是 `addEventListener`。读取的节点由 `ui.el()` 保证存在
（缺失即抛 `MissingNodeError`，`tests/smoke.mjs` 会捕获）。

### C 类：真实初始化（一次性、有状态、有顺序要求）

| 序 | 位置 | 动作 | 为什么必须在这个位置 |
|---|---|---|---|
| C1 | L1237 | `if (!hasApiKey()) demoMode = true; refreshDemoBtn();` | 决定后续所有 `demoMode` 分支；必须在任何可能开口的动作之前 |
| C2 | L1243 | `Object.assign(CHARACTER_REF, loadCharacter())` | 角色必须在渲染任何"与她有关"的东西之前就位 |
| C3 | L1246 | `buildMeters()` | 创建 `#val-*` / `#bar-*` 节点，后续 `updateStateUI` 依赖它们存在 |
| C4 | **L1250** | `loadState()` → `hadSave` / `readOnly` / `hasChar` | **世界状态的唯一入口**，必须早于一切 UI 刷新 |
| C5 | L1254–1257 | `updateStateUI()` / `updateStoryUI()` / `updateScheduleUI()` / `refreshNpcToggle()` | 必须在 C4 之后（否则渲染的是默认值） |
| C6 | L1260–1263 | 头像回填（`.chat-avatar` / `.char-card-avatar`） | 依赖 C2 |
| C7 | L1267–1276 | **仅新档**：时间归位到"开工"起点 + `initNpcWorld()` | 依赖 C4 的 `hadSave` / `readOnly` |
| C8 | L1279 | `tickNpcWorld()` | 依赖 C7（新档）或 C4（老档）已定好虚拟时间 |
| C9 | **L1280** | `saveState()` | 把 C7/C8 的结果落盘。**这是唯一一处"启动期主动写档"** |
| C10 | L1283 | `tickAgenda()` | 依赖虚拟时间 |
| C11 | L1284–1296 | 有角色且今天无日程 → `planTodayAgenda(...)`（**异步，可能调 AI**） | 依赖 C4 的 `hasChar`；`void` 触发不阻塞 |
| C12 | L1297 | `renderAgendaUI()` | 必须在 C10、C11 触发之后 |
| C13 | L1302–1304 | 老档 → `renderHistoryToChat(...)` | 依赖 C4 的 `hadSave` 与 `store.chatHistory` |
| C14 | L1307–1315 | `readOnly` → 追加只读提示（**不写档**） | 依赖 C4 的 `readOnly` |
| C15 | L1318–1320 | `scheduleIndex` / `dayIndex` 重算 + `updateScheduleUI()` | 时间开始流动前的最后一次对齐 |
| C16 | **L1321** | `startClock()` | **时钟启动**。早于此的所有时间计算都不受 tick 影响 |
| C17 | L1322 | `bindTimeControls()` | 只绑事件（B 类），但必须早于用户可点击 |
| C18 | L1325–1330 | 老档且离线 ≥30min → `setTimeout(directorOnOfflineReturn, 3000)` | 依赖 C4 + `startClock` 的时间基准 |
| C19 | L1355 | `renderActionSuggestBar()` | 依赖 C4 |
| C20 | L1356–1368 | `updateAgentDebugAfterTurn` 首屏 → `applyMindTimeDecay()` | 依赖 C4 + C16 |
| C21 | L1371–1431 | `window.__debug` 挂载（调试出口） | 依赖以上全部（它闭包引用了很多函数） |
| C22 | L1441–1465 | `?eventdemo=1` 预览分支 | 独立调试路径，要求显式指定 `slot=9` |
| C23 | L1475–1479 | `window.innerWidth < 768` → 收起状态面板 | 纯展示，无依赖 |

---

## 2. 模块求值期的隐式依赖（不在 chat.ts 里，但同样在 import 期发生）

| 模块 | 求值期动作 | 影响 |
|---|---|---|
| `storage.ts` | 解析 `?slot=` / `?new=1`；`?new=1` 时**删除**该槽的 state 与 character 键；随后 `history.replaceState` 移除参数；执行 legacy 单档迁移 | **有写操作**。必须在任何读档之前完成 |
| `character.ts` | 提供 `CHARACTER` 默认模板 | 纯常量 |
| `time.ts` | 注册 `proactiveGate` / `hasChatCapability` 的默认值（未注册时视为"具备能力"） | 默认值必须**先**存在，chat.ts 的注册后**覆盖**它 |
| `voice-store.ts` | 无求值期副作用（探测与超时都在函数内） | — |
| `ui/*.ts` | 仅声明；三个 `set*` 注入器都有"未初始化即抛错"的默认实现 | **默认实现是刻意的**：让"忘了注入"立刻可见，而不是静默用默认值 |

---

## 3. 依赖它的模块（谁依赖 chat.ts 的求值）

- `playground/chat.html` —— 唯一生产入口（`<script type="module" src="./chat.ts">`）。
- `tests/*.e2e.ts` —— 通过**副作用 import** 触发真实装配（`import "../playground/chat"`）。
  这是刻意的：套件要断言的是**生产装配**，不是自己重搭一份。
- 没有任何模块 `import chat.ts`。它是一个**叶子入口**。

---

## 4. 允许的初始化顺序（当前真实的顺序，逐段等价）

```
[0] 模块图求值：storage(槽位/清档/迁移) → state/character/time/story/mind/agenda/director/npc
                 → ai → tts/voice-store → ui/dom → ui/message → ui/state-panel → ui/modals
[1] 注入 UI 依赖（A 类 #1–#5）           ← 必须早于任何渲染调用
[2] DOM 事件绑定（B 类）
[3] refreshNpcToggle() / refreshTtsToggle()
[4] initTts() / void migrateVoice(currentSlot)          ← 异步，不阻塞
[5] 跨模块回调注册（A 类 #6–#18）        ← 必须早于 [7] 之后任何可能触发它们的路径
[6] demoMode 决策（C1）
[7] 角色载入（C2）→ buildMeters（C3）→ **loadState（C4）** → 全部 UI 刷新（C5–C6）
[8] 新档时间归位 + NPC 世界（C7–C8）→ saveState（C9）
[9] 日程（C10–C12）→ 历史回填（C13）→ 只读提示（C14）
[10] 时间基准对齐（C15）→ startClock（C16）→ bindTimeControls（C17）→ 离线回归（C18）
[11] 折叠交互 / 调试钩子 / 建议条 / Mind 衰减 / __debug（C19–C21）
[12] 调试预览分支（C22）→ 移动端收起（C23）
```

**不可交换的关键相邻对**（交换即改变行为）：

| 对 | 为什么不能换 |
|---|---|
| `buildMeters` → `loadState` → `updateStateUI` | 换序会让 38 维状态条渲染默认值（且 `#val-*` 可能还不存在） |
| `[5] 回调注册` → `[7] loadState` | `loadState` 会触发 `setSlotChangeHandler` 之外的读路径；且 `saveState`（C9）依赖 `setSaveFailureHandler` 已注册，否则失败无人上报 |
| `[6] demoMode` → `[7] loadState` | `loadState` 之后 C11 的 `planTodayAgenda` 会检查 `demoMode`（若为演示模式必须不发请求） |
| `C15 时间对齐` → `C16 startClock` | 反了会让时钟从错误的基准起跳 |
| `C16 startClock` → `C18 离线回归` | 反了会让 3 秒后的 Director 调用基于过期的时间基准 |

---

## 5. 结论：**不做 3.8 的 `app/boot.ts` 迁移**（本阶段）

### 5.1 为什么

1. **顺序已经是显式的。**`chat.ts` 的装配段是**一条从 L1237 到 L1479 的直线**，
   没有任何函数包裹、没有 `if` 分支之外的跳转、没有 `await`（C11 是 `void` 触发）。
   顺序就是书写顺序 —— 这一点已经满足"明确初始化顺序"这个目标。
   把这段搬进 `app/boot.ts` 不会让它**更**明确，只会让它**离**那些被它初始化的模块更远。

2. **搬迁的真实收益接近于零，风险却很高。**当前 1595 行里，装配段之外的
   152 处 import 期语句绝大部分是 A 类（注册回调）与 B 类（绑事件），它们**必须**在
   `chat.ts` 里，因为回调体闭包引用了 `chat.ts` 的私有函数（`handleSend`、`openWizard`、
   `directorOnOfflineReturn`、`sendMessage`…）。要搬走它们就得把这些函数一并搬走 ——
   那已经不是"装配层搬迁"，而是"整个 chat.ts 搬迁"，与"不要一次性重写多个核心模块"直接冲突。

3. **`menu.ts` 的白屏事故说明真正的风险在别处。**那次事故的原因是
   `loadSlotSettings(activeSlot)` 写在 `const ttsApiKeyInput = …` **之前**（TDZ），
   而 422 条 e2e 断言全绿 —— 因为它们不装载真实菜单页。
   真正的防线是 `tests/smoke.mjs`（真实装载三页 + 未捕获错误检查），**不是**把代码换个文件。

4. **验收标准里"检查白屏 / demo mode / 存档加载 / 首次启动 / 已有存档启动"
   现在已经被覆盖**（见 5.3），也就是说这一小步要防的风险已经有防线了。

### 5.2 已经做了什么来替代（同样的目标，更低的风险）

- 把装配段**逐段注释 + 编号**（本文件第 4 节），并列出"不可交换的关键相邻对"。
- 把 UI 侧的**依赖注入**全部改成"未注入即抛错"的默认实现（`ui/modals.ts`、
  `ui/state-panel.ts`、`ui/message.ts` 的 `onBusyChange`）——
  这样"忘了注入"会立刻炸，而不是静默用默认值。
- 顺序敏感的两个活绑定（`busy` 门控、`demoMode` 能力门控）已有专门断言：
  `tests/render-boundary.e2e.ts` 的 phase 2 会同时观察 `busy=true/false` 两种结果，
  快照化会立即变红。

### 5.3 五个必查项当前各自的防线

| 必查项 | 防线 | 现状 |
|---|---|---|
| 白屏 | `tests/smoke.mjs`（真实装载 home/menu/chat + 未捕获错误） | ✅ 9/9 |
| demo mode | `tests/render-boundary.e2e.ts` phase 1（零网络出口 + 文案契约） | ✅ |
| 存档加载 | `tests/save-v1.e2e.ts`（8 个 phase：旧档/损坏/未来版本/脏字段/空档） | ✅ |
| 首次启动 | `renderboundary` phase 3（无角色卡时向导路径 + 表单闭环）；prelude 每次清槽 | ✅ |
| 已有存档启动 | `renderboundary` 的 settle 循环观察 `history-divider`（老档才会渲染历史分隔线） | ✅ 实测出现 |

### 5.4 如果将来仍要做，先满足这三个前置条件

1. 先把 `chat.ts` 里被回调闭包引用的函数搬进 `app/`（3.4b–3.7 的剩余部分 + 一个
   `app/actions.ts`），否则装配段无法独立。
2. 为装配顺序写一条**可执行断言**（例如给每段加一个 `BOOT_STEP` 标记，
   由 e2e 断言实际执行顺序与 `BOOT_SIDE_EFFECTS.md` 第 4 节一致）。
3. 把 `tests/smoke.mjs` 的覆盖面扩到"启动期抛错"之外：至少增加
   "启动后 2 秒内不得出现 `MissingNodeError` / 未捕获拒绝"这一条。
