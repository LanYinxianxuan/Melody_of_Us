# Melody of Us · 玩法复核记录（GAMEPLAY_REVIEW）

> 冻结原则与权责表见 `GAMEPLAY_CONTRACT.md`。
> 本文件只做一件事：**记录**在重构过程中发现、但按契约不得擅自修改的问题。
>
> 每条必须包含六项：**问题 / 影响 / 证据 / 当前行为 / 建议方案 / 风险**。
> 证据必须可复核（文件 + 行号 + grep 结果）；行号会随重构变化，
> 因此每条同时给出可重新定位的函数名或字段名。
>
> ⚠️ 本文件中的任何一条都**不是**"待办事项"，而是**待决策事项**。
> 决策权在需求方；未经确认不得动代码。

---

## 一、GAMEPLAY（玩法语义 / 世界真实性）

### G-1 · 存档里的"对话轮数"永远是 0（两个计数器没有接线）

| 项 | 内容 |
|---|---|
| **问题** | `store.turnCount` 是存档字段，但全仓**没有任何自增点**；它与 `events.ts` 的会话级 `turnCounter` 是两套独立计数器。 |
| **影响** | ① 菜单页存档卡"对话 N 轮"恒显示 0（用户可见的显示错误）；② 无法据此判断玩家进度。 |
| **证据** | `playground/storage.ts:181` `turnCount: 0`（初值）；`playground/chat.ts:1400` `store.turnCount = 0`（仅"重置故事"时归零）；`playground/menu.ts:110` 读取渲染 `对话 ${save.turnCount ?? 0} 轮`；`playground/events.ts:23` `let turnCounter = 0`、`:38` `turnCounter++`、`:41` 用于事件节奏判定。定位锚点：`store.turnCount` / `turnCounter`。 |
| **当前行为** | 显示恒为 `对话 0 轮`。随机事件节奏**完全由** `events.ts` 的模块级 `turnCounter` 决定：每次 `sendMessage` 后自增，`turnCounter - lastTriggeredTurn > FORCE_AFTER` 时强制触发，否则要求间隔超过 `MIN_GAP`；该计数器是**会话级**的（刷新页面即归零）。 |
| **建议方案** | 先明确"存档里的轮数"的用途：<br>· 若**仅用于展示** → 在 `sendMessage` 成功路径补一个 `store.turnCount++` 写入点，**不触碰** `events.ts`，玩法零变化；<br>· 若**参与节奏**（例如跨会话延续事件强度）→ 属于规则变更，需要单独设计。 |
| **风险** | ⚠️ 若把 `events.ts` 的节奏判定改读 `store.turnCount`（持久级），事件触发频率会随游玩历史累积而改变 —— **直接改变玩法**。这正是本条目冻结、不擅自修的原因。 |

### G-2 · `userLocation` / `pendingOvernight` 无玩法读取方（但**不是**死字段）

| 项 | 内容 |
|---|---|
| **问题** | 这两个字段没有任何玩法逻辑读取，容易被误判为"死字段应删除"。**本条已撤回原判断**，保留在此以免后人重复误判。 |
| **影响** | 若误删，会破坏存档契约（导出/导入往返、白名单校验都会受影响）。 |
| **证据** | `playground/save-schema.ts:108-109` 声明为 SaveV1 契约字段；`:144-145` 列入 `SAVE_STATE_FIELDS`；`:183` 定义 `USER_LOCATIONS` 白名单；`:305` 迁移时对 `userLocation` 做白名单收敛；`playground/storage.ts:212/214` 初始化；`:460-461` 在 `applyLoadedState` 中恢复。定位锚点：`userLocation` / `pendingOvernight` / `SAVE_STATE_FIELDS`。 |
| **当前行为** | 它们是**存档契约的一部分**：会随导出/导入完整往返、会被校验与白名单收敛，但当前玩法不读它们的值。 |
| **建议方案** | **不动**。它们的存在保证老存档的字段含义稳定。 |
| **风险** | 删除会改变存档语义（属于必须暂停征询的第 1 类情况）。 |

### G-3 · 演示模式的说明只在"手动切换"时出现

| 项 | 内容 |
|---|---|
| **问题** | 启动即演示模式（无 API Key 的默认路径）时不输出任何解释；只有**手动点开关**时才会看到说明。 |
| **影响** | 首次进入的用户面对的是预设模板而不是 AI，却没有任何提示 —— 影响"世界真实性"的表达，属于产品语义而非样式。 |
| **证据** | `playground/chat.ts` 中 `demoBtn.addEventListener("click", …)` 分支内 `if (demoMode) { appendSystemMessage("当前是演示模式——回复是预设模板…") }`；启动路径 `if (!hasApiKey()) { demoMode = true; refreshDemoBtn(); demoBtn.classList.add("active"); }` 不输出该说明。定位锚点：`refreshDemoBtn` / `appendSystemMessage`。 |
| **当前行为** | 无 Key 启动 → 按钮显示"演示中"，副标题显示"演示模式（不会思考）"，但消息流里**没有**解释性提示。 |
| **建议方案** | 把说明改成"进入演示模式时输出一次（含启动期）"。改动很小，但会改变既有行为，需确认。 |
| **风险** | 低。`tests/render-boundary.e2e.ts` 已把**当前行为记录**为日志（不断言），因此将来改成"启动也提示"不会造成误报。 |

### G-4 · `#save-hint` 的两条互相覆盖的 `display` 声明

| 项 | 内容 |
|---|---|
| **问题** | 同一规则里先写 `display: inline-flex`、末尾又写 `display: none`，后者胜出；`menu.ts` 再用内联样式覆盖。 |
| **影响** | 那条 `inline-flex` 是**永远不生效**的死声明（作者原意可能是由 `.show` 类控制显示）。当前行为正确，但语义含糊、易被后人误改。 |
| **证据** | 抽取前 menu 内联 CSS 的 `#save-hint` 规则；`playground/menu.ts:261-262` `saveHint.style.display = "block"` / `setTimeout(… = "none", 1500)`。定位锚点：`#save-hint` / `saveHint`。 |
| **当前行为** | 默认隐藏；每次"保存"时以 `display:block` 显示 1.5 秒后隐藏。 |
| **建议方案** | 后续整理为 `#save-hint{display:none}` + `#save-hint.show{display:inline-flex}`，并让 `menu.ts` 切类而不是写内联样式。**属于代码整洁，不属于玩法。** |
| **风险** | 极低。阶段 2 的 CSS 抽取已**逐字保留**这两条声明（含注释说明），以保证"抽取 = 零行为变化"；`tests/css-equivalence.mjs` 会盯住这件事。 |

---

## 二、AI_ARCH（架构 / 边界问题）

### A-1 · ~~"`ai/` 是唯一网络出口"目前不成立~~ ✅ 已解决（阶段 3）

| 项 | 内容 |
|---|---|
| **问题** | 除 `ai.ts` 外，还有 3 个模块各自直接调用 `fetch`。 |
| **影响** | ① 无法在一处统一实现超时 / 重试 / 错误分类 / 用量统计；② 测试里"零网络出口"这类断言只能覆盖 `ai.ts` 走的路径。 |
| **证据** | `playground/director.ts:213`、`playground/tts.ts:376` 与 `:426`、`playground/menu.ts:423`（`grep -rn 'fetch(' playground/`）。定位锚点：`callDirector` / `speak` / `testTtsVoice` / `loadModels`。 |
| **当前行为** | **已收敛**：新增 `ai/client.ts` 作为共享传输层（`joinUrl` / `postJson` / `requestJson` / `parseJson`），`director.ts` / `tts.ts` / `menu.ts` 全部改为经它发起请求。全仓 `fetch` 现只出现在 `ai.ts`（原 AI 引擎，仍是主角对话出口）与 `ai/client.ts`。 |
| **建议方案** | ✅ 已完成。收敛时**刻意只统一传输层，不统一错误语义** —— 四个调用点的失败行为本来就不同（`director.ts` 不检查 `resp.ok`、`tts.ts` 抛 `TTS 请求失败: HTTP n`、`menu.ts` 抛 `HTTP n`），顺手统一会改变用户可感知的失败表现。 |
| **风险** | 已用静态断言兜住：`tests/boundaries.test.mjs` 的"fetch 只出现在 ai/ 目录" + 三条 import 检查；缺陷注入（把 `tts.ts` 改回直接 `fetch`）立即变红。 |
| **遗留** | `ai.ts` 内部仍有 5 处直接 `fetch`（主角对话 / NPC / 访谈等）。它们同在一个模块内、共用同一套 headers 与解析，收敛到 `client.ts` 收益较小；若要彻底统一，可作为后续整洁项。 |

### A-2 · 领域层反向依赖 UI：`story.ts` / `time.ts` / `agenda.ts` 内含渲染函数

| 项 | 内容 |
|---|---|
| **问题** | 领域模块内部直接操作 DOM，与 `chat.ts` 的渲染职责重叠。 |
| **影响** | 世界模拟层不能脱离浏览器运行；纯逻辑测试必须依赖 DOM 夹具。 |
| **证据** | `grep -n 'document\.' playground/story.ts playground/time.ts playground/agenda.ts` 各有命中。定位锚点：`journalText` / `currentSchedule` / `renderAgenda` 附近的 DOM 操作。 |
| **当前行为** | 渲染逻辑与规则逻辑同文件共存；调用方（`chat.ts`）只调用其导出的函数，不感知内部分层。 |
| **建议方案** | 把渲染部分上移到 `ui/`，领域模块只返回数据；调用点改为"取数据 → 渲染"。属于架构变更，单独排期。 |
| **风险** | 中高。搬迁过程中极易改变"何时渲染"（例如原本在领域函数内部顺带刷新，搬迁后变成显式两步），从而改变时序。必须用渲染边界断言兜住。 |

### A-3 · ~~`(store as any)` 绕过类型检查写入未声明字段~~ ✅ 已解决（阶段 3）

| 项 | 内容 |
|---|---|
| **问题** | `mind.ts` 在 `store` 上写入 `userMind` / `aiMind` / `relMind` / `lastAgentVirtualAt` 等字段，而 `storage.ts` 的 `store` 类型里没有这些声明。 |
| **影响** | `store` 结构变化不会被 `tsc` 捕获，是"静默漂移"的来源；也是 `noUncheckedIndexedAccess` 迟迟不能开启的原因之一。 |
| **证据** | 修复前 `grep -rn '(store as any)' playground/` 命中 25 处，集中在 `mind.ts`（24）与 `chat.ts`（1）；修复后为 0。 |
| **当前行为** | **已解决**：`store` 的声明里其实早已包含 `userMind` / `aiMind` / `relMind` / `lastAgentVirtualAt`（`storage.ts` 的 `store` 对象字面量），因此这些 `as any` 纯属历史残留。实测去掉全部 25 处（`mind.ts` 24 + `chat.ts` 1）后 `tsc --noEmit` **零错误**。 |
| **建议方案** | ✅ 已完成，并加静态断言：`tests/boundaries.test.mjs` 的"全仓零 `(store as any)`"。 |
| **风险** | 已消除：本次只删 `as any`（纯类型层面），**未触碰** `SAVE_STATE_FIELDS` / `normalizeToSaveV1`，存档语义零变化。 |

### A-4 · `chat.ts` 的渲染没有单一入口

| 项 | 内容 |
|---|---|
| **问题** | 约 100 个 DOM 查询点散落在业务流程中间，32 处 import 期副作用散落全文。 |
| **影响** | 重构时无法证明"渲染输出没被改坏"；初始化顺序只能靠读完整文件来保证。 |
| **证据** | 92 个 `getElementById` + 8 个 `querySelector`；其中 12 处在业务函数内部。**已发生的真实事故**：`menu.ts` 的同类写法导致 TDZ 白屏（`Cannot access 'ttsApiKeyInput' before initialization`），而当时 422 条 e2e 断言**全绿** —— 因为它们不装载真实菜单页。 |
| **当前行为** | 渲染与业务逐句交替；`getElementById(x)!` 把 `null` 断言成元素，缺节点时错误推迟到首次读取属性。 |
| **建议方案** | 见 `PHASE3_RENDER_BOUNDARY.md`：查询点收口到 `ui/dom.ts` → 渲染模块上移 → `app/` 集中装配顺序。安全网 `tests/render-boundary.e2e.ts` 已就位并通过缺陷注入验证灵敏度。 |
| **风险** | 中。搬迁渲染会改变"何时渲染"，必须逐步进行、每步跑 `npm run verify`（含 `tests/smoke.mjs`，因为它会真实装载三个页面并检查未捕获错误）。 |

### A-5 · `noUncheckedIndexedAccess` 仍关闭

| 项 | 内容 |
|---|---|
| **问题** | 该严格选项未开启，索引访问不会返回 `T \| undefined`。 |
| **影响** | `arr[i]` / `obj[key]` 的越界访问不会被类型系统拦住。 |
| **证据** | `tsconfig.json` 注释记录：开启后实测 **+108 个错误**，其中约 100 条来自 `AIState` 的索引签名。 |
| **当前行为** | 关闭。代码里大量使用 `!` 非空断言与默认值兜底来规避。 |
| **建议方案** | 见"三、A-5 评估结论"一节。 |
| **风险** | 低（纯类型层面）。但若为了消除报错而"顺手"加了运行时兜底逻辑，就会改变行为。 |

### A-6 · 测试基础设施自身的两个缺陷（本次已修，记录以备回看）

| 项 | 内容 |
|---|---|
| **问题** | ① 注入的兜底报错脚本一直是语法错误；② `--virtual-time-budget` 过大反而让套件"跑到一半停住"。 |
| **影响** | ① "模块加载期抛错"的兜底机制**从未生效**，排错时诊断信息全部指向别处；② 失败被误报成"未产出结果节点 / 页面脚本可能抛错"，与真实原因无关。 |
| **证据** | ① `tests/e2e.mjs` 的 `buildFixtureHtml()` 用模板字面量拼注入脚本，`"\n"` 被解析成真换行 → 内联脚本字符串未闭合 → 整段 `<script>` 被丢弃，浏览器报 `Uncaught SyntaxError`。② 虚拟时间被快进后 `chat.ts` 的常驻定时器（1s 时钟、随机事件轮播、打字机看门狗）持续消耗预算，`--dump-dom` 可能在套件写完结果前发生。 |
| **当前行为** | 均已修复：① 改用 `String.fromCharCode(10)` 绕开转义层数；② 预算收敛到 60s，并规定"长等待用**次数**而不是挂钟时间做上限"（见 `render-boundary.e2e.ts` 的 `waitFor`）。另外 `e2e.mjs` 失败时会打印页面标题与已写入的结果节点。 |
| **建议方案** | 已完成，无需进一步动作。保留记录以免后人重复踩坑。 |
| **风险** | 无。 |

### A-7 · 阶段 2 有意的视觉取值统一（非缺陷，记录以免被当成回归）

| 项 | 内容 |
|---|---|
| **问题** | CSS 抽取过程中有三处取值变化是**有意**的。 |
| **影响** | 若无记录，后续看到差异会误判为回归。 |
| **证据** | `tests/css-equivalence.mjs` 的 `INTENTIONAL` 登记表：<br>· `--line-strong` 由 home `#c9c9c9` / menu+chat `#bdbdbd` 统一为 `#bdbdbd`（同名不同值本身是缺陷源，取多数派并与 `UI_STYLE.md` 一致）；<br>· `.ico-lg` 删除（全仓无 `ico-lg` 元素，home 实际写的是孤儿类 `ic-logo`，删除后渲染零变化）；<br>· `--ink-mute-legacy` 删除（抽取期新增的兼容别名，全仓 0 处引用 —— "兼容别名"没有兼容对象）。 |
| **当前行为** | 三处变化均已生效，并由 `npm run test:css` 持续证明"除此之外声明级零差异"。 |
| **建议方案** | 保持。 |
| **风险** | 无。 |

---

## 三、A-5 评估结论（`noUncheckedIndexedAccess`）

| 项 | 结论 |
|---|---|
| **能否直接开启** | ❌ 不能。实测 **+108 个类型错误**。 |
| **错误分布** | 约 100 条来自 `AIState` 的索引签名（`aiState[key]` 形式），其余零散在 `store.agenda` / 数组索引。 |
| **根因** | `AIState` 用的是宽索引签名（`Record<string, number>` 一类），因此"索引访问可能 undefined"的告警会在每一处维度读取上出现，而实际上维度集合是**闭集**（38 个已知 key）。 |
| **建议路径** | ① 先把 `AIState` 的键类型收紧为精确的维度联合（依赖 `state.ts` 的 `DIMENSIONS`）；② 与 A-3 一起补齐 `store` 的字段声明；③ 再开启 `noUncheckedIndexedAccess`，此时剩余报错应是个位数且都有真实价值。 |
| **为什么不是一个独立的阶段** | 它是一个**放大器**：只有在 A-3 与 `AIState` 类型收紧之后开启，才会得到有信息量的报错；现在开启只会得到 108 条噪声，且容易诱使"为了消错而加运行时兜底"，反而制造行为漂移。 |
| **风险（开启时）** | 低（纯类型）。但见上：真正的风险是"为了消错而改运行时"。 |

---

## 四、阶段 3 冻结项确认（本阶段**未修改**，逐条复核）

| 编号 | 内容 | 本阶段处置 |
|---|---|---|
| **G-1** | `store.turnCount` 恒为 0 | **保持冻结**。明确**不**把它接到 `events.ts` 的会话级 `turnCounter` —— 那会改变随机事件的触发频率，属于玩法行为变化。 |
| **G-3** | 无 API Key 启动时不主动显示 Demo Mode 说明 | **保持冻结**。行为未改；`tests/render-boundary.e2e.ts` 的 phase 1 把当前行为记录为日志（不判定），因此将来若改为"启动也提示"，该套件不会误报。 |
| G-2 | `userLocation` / `pendingOvernight` | 未动（存档契约字段）。 |
| G-4 | `#save-hint` 的双 `display` 声明 | 未动（阶段 2 已逐字保留）。 |
| **A-2** | 领域层渲染上移 | **只分析不迁移**，见 `A2_RENDER_MIGRATION.md`。 |
| **A-5** | `noUncheckedIndexedAccess` | **未启用**，见 `A5_INDEXED_ACCESS.md`。 |
| A-6 | 测试基础设施两个缺陷 | 已在阶段 3 修复。 |

---

## 五、Phase 4-A 引入的**行为变化**（必须决策/知悉）

> 本阶段的目标是「修复断链 + 建立 AI Authority 边界」，因此**必然**带来几处行为变化。
> 每一处都按同一结构记录。**没有任何一处修改了公式、概率、维度、NPC 作息或存档版本。**

### G-5 · AI 数值增量现在有**单步上限 25**

| 项 | 内容 |
|---|---|
| **问题** | 修复前，AI 的 delta **没有幅度上限**；提示词里写的「每维 ±15」在代码层从未实现。 |
| **影响** | AI 返回 `{"joy": 100}` 会一次把该维推满。世界状态的漂移速度完全由模型输出量级决定。 |
| **证据** | 修复前 `state.ts:156-173`（`applyDelta`）无任何幅度检查；`response-template.ts` 的提示词含「每维 -15~15」。修复后 `playground/state-gate.ts` 的 `MAX_SINGLE_STEP = 25`。 |
| **当前行为** | 增量被夹到 `[-25, +25]`。**正常对话（模型通常给 ±1~±8）完全不受影响**（有专门断言）。 |
| **建议方案** | 若要让提示词的「±15」成为正式规则，把 `MAX_SINGLE_STEP` 改为 15 即可（一处常量）。 |
| **风险** | 低。25 明显宽于提示词承诺，因此只拦异常值。**但这是一个"新增的数值约束"，需要你确认取值。** |

### G-6 · Director 的 `forget` 由「子串批量删除」收紧为「精确删除单条」

| 项 | 内容 |
|---|---|
| **问题** | 修复前 `store.memories.filter((x) => !x.includes(m))` —— AI 给一个短串会**一次删掉多条记忆**。 |
| **影响** | 记忆是长期档案；批量误删不可恢复（无版本历史）。 |
| **证据** | 修复前 `chat.ts` 的 `executeDirectorDecision` 第 4 段；修复后 `playground/state-gate.ts` 的 `applyMemoryOp`（`x !== op.content`）。单元测试有反例断言：`["约定明天见面","约定明天见面吧"]` 删除前者后必须保留后者。 |
| **当前行为** | 只删除**完全等于**该内容的唯一一条；`save` 的去重逻辑（本就精确匹配）不受影响。 |
| **建议方案** | 保持。这是**安全性收紧**，不改变正常语义。 |
| **风险** | 低。唯一的可感知差异：AI 若依赖"用短串删多条"（不该依赖），会只删掉一条。 |

### G-7 · 剧情档案与回注 prompt 只接受「既成事实」

| 项 | 内容 |
|---|---|
| **问题** | 修复前，`store.storyEvents` 里混着「AI 叙述」与「真实发生」两类文本，且 `journalText()` **不加区分地回注下一轮 prompt** → AI 的自由文本变成了世界历史。 |
| **影响** | 世界档案的可信度被稀释；AI 的措辞可以持续自我强化。 |
| **证据** | 新增 `StoryEvent.source`（`core` / `narrative` / `director`）。`story.ts` 的 `finalizeDay` 与 `journalText` 现在用 `isFactualStoryEvent()` 过滤，只取 `core`。四处 push 点已逐条标记；旧档缺失该字段时归一化为 `narrative`。 |
| **当前行为** | 每日归档与「今天发生的事」只包含 Core 确认的事实。AI 叙述与 Director 解释**仍然照常显示**（`updateStoryUI` 不过滤），只是不再进入"世界历史"。 |
| **建议方案** | 保持。若希望 AI 叙述也能进档案，把 `"narrative"` 加入 `STORY_EVENT_FACT_SOURCES` 即可（一处常量）。 |
| **风险** | 中：**这是本阶段影响最明显的行为变化** —— 剧情档案会变"瘦"，模型能读到的历史事件变少。**需要你确认这是想要的方向。** |

### G-8 · NPC 介入现在写入世界档案（修复断链）

| 项 | 内容 |
|---|---|
| **问题** | 修复前 `runNpcIntervention` 只写 DOM 与 `chatHistory`，**从不写 `storyEvents`** → NPC 介入不进档案、跨天即消失。 |
| **影响** | 世界档案缺一半因果；NPC 的存在感无法沉淀。 |
| **证据** | 对照 `event-card.ts` 有 `storyEvents.push`；`runNpcIntervention` 没有。修复后新增一条 `source: "core"` 的事件（文本 = NPC 名 + 入场方式 + 地点 + 对话前 30 字）。 |
| **当前行为** | 每次成功的 NPC 介入都会在档案里留下一条 Core 事实。 |
| **建议方案** | 保持。注意它同时使 NPC 介入**进入 `journalText()` 回注**（因为标为 core）。 |
| **风险** | 低中：模型能读到的历史变多；文本由代码模板拼接（非自由文本）。**若你希望 NPC 介入只展示不入档，把该处 source 改成 `"narrative"` 即可。** |

### G-9 · 「有效回合」的定义与计数时机

| 项 | 内容 |
|---|---|
| **问题** | `store.turnCount` 修复后需要有明确的"一轮"定义，否则会出现"回复没显示出来却记了一轮"。 |
| **影响** | `turnCount` 是 `lastMajorTurn`、菜单摘要、冷落门判定的输入。 |
| **证据** | `chat.ts` 的 `countCompletedTurn()`；两个条件 —— ① `replyDelivered`（AI 真的产出了对话内容）② 渲染落定（`ui/message.ts` 的 `onFinish`，带 15s 放弃观察）。 |
| **当前行为** | 只有「模型返回了对话 + 打字机真的渲染完成」才 `+1`。API 失败、解析失败、渲染卡住（rAF 被限流）都不计数。 |
| **建议方案** | 保持。副作用：`turnCount` 会比"用户发送次数"略少（失败轮不计数）——这是刻意的（宁可少记一轮，不记假的）。 |
| **风险** | 低。 |

---

## 六、Phase 4-B 的变更与待决策项

> 本阶段的核心成果是**边界**而非新玩法。所有改动都不触碰 38D 公式、衰减、关系公式、
> NPC schedule、Memory 基础规则、事件概率、阈值、结束条件、核心循环顺序、Save Schema 语义。

### 已修复的缺陷（非玩法变更）

| # | 缺陷 | 修复 |
|---|---|---|
| **D4** | 重答不回滚 `storyProgress` → 同一轮重答 N 次 = 进度累加 N 次 | `RedoCheckpoint` 新增 `storyProgressSnap` 并在 `reAnswerAt` 回滚。**未改数值设计/单步上限/阈值** |
| **4-B3** | Director 的 NPC 介入以 `score: 100` 直调，**绕过全部安全检查** | Core 新增 `checkInterventionSafety`：参与者合法性 / 深夜与睡眠保护 / 私密话题限制 |
| **4-A8 遗留** | `priority` 校验后被丢弃 | 保留校验 + 写入 `StoryEvent.priority?` 供追溯（**不参与任何数值计算**） |

### 已记录但仍需决策（`DECISION_REQUIRED`）

| # | 议题 | 类型 |
|---|---|---|
| B2-1 | `priority` 是否参与事件竞争/排序 | **新增玩法**（需要事件队列与竞争规则） |
| B2-2 | `priority` 是否影响叙事长度/侧重 | prompt 规模与叙事权重 |
| B7-1 | NPC 是否要能不等玩家输入就自发开口 | **新增触发规则**（当前唯一常规入口在玩家轮次内） |
| B8-1 | `story.progress` 是否加单轮上限（提示词承诺 0~5） | 玩法数值 |
| B8-2 | 重答是否也应回滚 `turnCount` | 语义选择（当前不回滚 = 重答计为一次新的有效回合） |
| B8-3 | `G-7` 方向确认（剧情档案只收 Core 事实） | 影响模型可见的历史量 |
| B8-4 | `G-5` 单步上限取值（当前 25，提示词承诺 15） | 玩法数值 |
| B8-5 | 4-A1 的 P1–P5（Mind/Emotion 字段合并与量纲统一） | **存档语义** |
| B8-6 | `npc.goal` 是否接线（死字段，却参与 0.25 概率加分） | **新增 NPC 目标系统** |

### 未改动但已记录

- 私密话题正则仍是中缀匹配（`/喜欢你/`），可能出现误判 —— 与既有行为一致，未改。
- `story.progress` 无单调性、无 `isFinite` 守卫、门槛耦合（`story.event` 为空则 progress 失效）。
- `tickAgenda` 改状态不落盘。

---

## 七、Phase 4-C：9 项决策收口

> 本阶段**只收口决策**，不扩大功能范围。未触碰 38D 公式、衰减、关系公式、NPC schedule、
> Story 概率、既有阈值、结束条件、Save Schema 语义。

| 决策 | 结论 | 是否改行为 |
|---|---|---|
| **1 · priority** | ❌ 不参与玩法；保留字段 + 校验 + 写入 `StoryEvent.priority` 供追溯。**未发明新算法** | 否 |
| **2 · NPC 主动开口** | ✅ **批准并实现**（最小可控）。复用既有门与既有常量，**未新增任何 cooldown/probability 数值** | ✅ 是（新行为，见下） |
| **3 · 单步上限** | ✅ 由 **25 收紧为 15**，与 Prompt 承诺逐字一致 | ⚠️ 仅影响"异常巨量增量"（正常 ±1~±8 不受影响） |
| **4 · Redo 不增 turnCount** | ✅ 实现。**一次玩家输入产生的最终有效回答 = 一个历史有效回合** | ✅ 是（重答不再多计一轮） |
| **5 · G-7 Core Fact** | ✅ 确认并冻结：世界档案与回注上下文只接受 `source === "core"` | 否（4-A7 已实现） |
| **6 · Mind / Emotion** | ✅ **暂不合并**。不删字段、不改 Save Schema、不改量纲 | 否 |
| **7 · npc.goal** | ⚠️ **暂不接线，也不移除其影响** → `DECISION_REQUIRED` | 否（原样保留） |
| **8 · story.progress** | ✅ 冻结全部既有规则；只确保 Redo 不重复累加 | 否 |
| **9 · 世界规则与 Director 调度规则** | ✅ 最终冻结（见 `DIRECTOR_INTENT_CONTRACT.md`） | 否 |

### 决策 2 的实现：NPC 主动开口的完整规则

**触发点**：`startClock` 的每秒回调（既有；与 `tickNpcWorld` / `maybeRandomMoment` 同一节奏）。

**Core 前置门（全部复用既有规则，零新增常量）**：

| 门 | 判据 | 复用的是哪条既有规则 |
|---|---|---|
| ① 不打断玩家交互 | `busy || userIsTyping()` | 与 `setProactiveGate` 同一判据 |
| ② 聊天能力 | `hasApiKey() && !demoMode` | 与既有能力门控（P0-8）一致 |
| ③ 多人模式 | `store.npcEnabled` | 与既有 NPC 介入同一开关 |
| ④ 新档保护期 | `store.turnCount >= 1` | 复用决策 4 定义的 `turnCount` 语义 |
| ⑤ 深夜保护 | `currentSchedule().label !== "深夜"` | 与既有规则一致 |
| ⑥ 冷却 | `virtualMs - lastActiveAt < 6h`（`screenNpcCandidates` 内） | **复用既有 6 小时常量**；`lastActiveAt` 由 `decideIntervention` 在**任何**介入后写入 |

**候选与概率**：`screenNpcCandidates`（关键词/地点/关系/剧情线/私密话题/深夜 score=0）
→ `decideIntervention`（**既有**概率门 `min(0.55, 0.2 + score/100)`）
→ `checkInterventionSafety`（Core 世界安全守卫）→ `runNpcIntervention`。

**关键技术细节：门的判定改为"收集全部原因"而非短路返回。**
短路会让能力门遮蔽后面所有判定（演示模式下永远只看到 `no-chat-capability`），
于是"深夜保护是否生效"这类断言会**因为错误的原因通过或失败**。
现在返回 `{ ready, reason, reasons[] }`，每个门都可被独立断言。

**未新增**：新 NPC · 新 Agent · 新 cooldown 常量 · 新概率常量 · 新定时器。

### 决策 3 的实现：±15 enforcement

`MAX_SINGLE_STEP` 由 25 改为 **15**，与 `response-template.ts` 的「每维 -15~15」逐字一致。
只夹取**单笔 AI 提议的增量**；绝对值区间（0–100）仍由 `state.ts:clamp` 负责。
**未改** 38D 公式、衰减系数、关系公式、初值、任何阈值。

### 决策 4 的实现：Redo 与 turnCount

`RedoCheckpoint` 新增 `turnCountSnap`，`reAnswerAt` 回滚它。
**同时修复了一个实现过程中暴露的真实缺陷**：`onFinish` 回调可能在多种时序下触发
（含**上一轮的回调迟到**），无条件 `turnCount++` 会让"一轮"被记成多轮
（实测：一次 Redo 后计数从 0 跳到 6）。
现改为**按回合序号幂等**：`countCompletedTurn(serial)` 在 `serial <= lastCountedTurn` 时直接返回。

**未改** `events.turnCounter`（仍为会话级、刷新即归零），随机事件频率不变。

### 决策 7 的现状澄清（重要）

审计发现 `npc.goal` **不是**"半接线"，而是**恒生效**：

- `NpcState.goal` 的唯一写入点是 `createNpcState()` 的 `profile.goal ?? null`；
- **全部 2 个内置 NPC 都带 `goal`** → `npc.goal` 恒为真；
- 因此 `if (npc.goal && Math.random() < 0.25) score += 12` 实际是一个
  **每个 NPC 每次筛选 25% 概率的固定 +12 分**，"目标"文本内容从不参与判断。

影响面：**只影响概率**（抬高候选通过率），不影响任何数值/情绪/关系/时间。
移除它会让 score 从 25 掉到 13 → **直接跌破候选阈值 25** → NPC 介入基本失效。
**这是玩法行为变更，因此原样保留**，并在代码处写清事实。

### 新增 DECISION_REQUIRED

| # | 议题 | 影响 |
|---|---|---|
| **C-1 · npc.goal gameplay semantics** | `npc.goal` 恒真、使 `Math.random() < 0.25` 恒被求值 = 固定 +12 分。是否要把它变成**真正的目标驱动**（每条 goal 有不同权重/条件），还是把它降级为**纯观察字段**（移除 +12）？后者会显著降低 NPC 介入频率 |
| **C-2 · NPC 主动开口是否也要在"玩家在场但沉默"时触发** | 当前实现把它挂在时钟上（玩家不输入也会尝试），但要求 `turnCount >= 1`。若你希望"新档第一次见面后她就能主动"，需要放宽 ④ |

---

## 八、Phase 4-D：C-1 / C-2 收口

> 本阶段**只解决这两个决策**，未进行任何其他重构。

### C-1 · npc.goal 语义 —— ✅ 已裁定并落地

**缺陷原貌**：`if (npc.goal && Math.random() < 0.25) score += 12`，
而全部内置 NPC 都带 `goal` → 条件**恒为真** → 实际是"每次筛选无条件 25% 概率 +12"，
**goal 的文本内容从不参与判断**。

**最终语义**：保留 `goal`，改为**真正的目标驱动加成**。

| 项 | 结论 |
|---|---|
| goal 存在但**与场景无关** | ❌ 不产生 +12（**根本不掷骰**） |
| goal 存在且**相关** | ✅ 原有的 25% × +12 机制参与评分（**骰子本身未改**） |
| goal = null | ❌ 永远不相关 |
| goal 能否决定"能否介入" | ❌ **不能**。只影响候选评分；关键词/地点/关系/剧情线/阈值全部不变 → 无 goal 的 NPC 照样能介入 |
| goal 能否绕过 Core | ❌ **不能**。相关性判定与 `checkInterventionSafety` 是两条独立判定 |
| goal 能否直接改世界 | ❌ **不能**。不改 store / 不建 Core Fact / 不改情绪 / 不改进度 |

**相关性的精确定义**（`playground/npc-goal.ts`，纯函数、无 NLP、无 LLM）：

| goalKind | 判据 | 语义 |
|---|---|---|
| `connect` | `relationContext \|\| keywordHit` | 目标围绕"你们的关系" |
| `understand` | `nearby \|\| keywordHit` | 需要一个"自然的机会" |

**数据结构影响**：`NpcProfile` 新增可选 `goalKind`（**静态配置，不进存档**）；
`SaveV1` 与 `NpcState` **一字未改**。因此未触发
`DECISION_REQUIRED: npc.goal requires structured schema`。

### C-2 · NPC 主动开口的新档保护 —— ✅ 已裁定

**`turnCount >= 1` 保持不变。**

含义：新建存档 → **第一次玩家有效回合** → NPC 获得主动交互资格。
理由：第一次见面就让 NPC 主动开口会让世界显得"没有建立关系就开始自动演戏"。
**零新增常量 · 零新增 cooldown · 6 小时规则未改。**

### 新增测试（+19）

`e2e 564 → 583`。覆盖用户列出的 5 项 C-1 要求 + C-2 的正反两条。

### Defect Injection（3 组，全部可捕获）

| 注入 | 结果 |
|---|---|
| A · 恢复 `goal != null → +12` | ✅ 变红（`seen=7`） |
| B · `isGoalRelevant` 恒 true | ✅ 变红 ×2 |
| C · goal 相关时 `checkInterventionSafety` 返回 `ok` | ✅ 变红 ×5 |

### 不再有 DECISION_REQUIRED

C-1 与 C-2 均已关闭。前序阶段的其他议题已在 Phase 4-C 裁定并冻结。
剩余 U1–U10 为 P2 整洁项，按要求**未顺手修改**。

---

## 九、Phase 5-A：World Surface

> 本阶段只做「让玩家看见世界」，**未新增任何 AI / 规则 / Agent / 概率**。
> 未改 Save Schema · 38D 公式 · Story 规则 · NPC schedule · 概率 · cooldown · Core loop。

### 新增模块（全部在 `ui/` 层，只读）

| 文件 | 职责 |
|---|---|
| `ui/world/world-view-model.ts` | Core State → 只读、可序列化、无 DOM 的 WorldViewModel |
| `ui/world/world-surface.ts` | 组合入口 + **指纹短路**（内容未变则不重建 DOM） |
| `ui/world/npc-surface.ts` | NPC 表面（按 id key 复用，只写变化的文本） |
| `ui/world/event-surface.ts` | Recent Core Events（**只**渲染 `source === "core"`） |

### 边界新增一条静态守卫

```
✅ ui/ 层不修改 store / aiState（世界状态只由 Core 与 Director 经闸门修改）
```

**为什么加它**：Injection A（让 UI 直接改 store）第一次**没有被任何守卫捕获** ——
既有的 `ui/` 守卫只覆盖 localStorage / fetch / indexedDB，
`ui/` 完全可以在不碰这三样的情况下直接改世界状态。这是真实盲区，已补上。

### 「不造假日世界」的实现

- VM 里每个字段都能对应到 Core 的既有字段或既有导出（顶层键有**精确**断言）
- NPC 的 activity/location 只做**组合**，不做推断；两者都缺失时如实显示「还没有她的消息」
- 有 defect injection 证明"UI 编造活动"会被捕获

### 未解决 / 未动

| # | 项 | 说明 |
|---|---|---|
| U1 | `#story-events` 仍不分来源地渲染全部档案（`story.ts` 的 `updateStoryUI`） | 属 5-A4 范围；改动它需要动领域层渲染（A-2 议题） |
| U2 | `StoryEvent.priority` 仍无 UI 消费者 | VM 已暴露，未上屏 |
| U3 | `npc.goal` 仍未上屏 | VM 已暴露，未渲染 |
| D3 | 事件流**无法**显示 `HH:MM` 时刻 | `StoryEvent` 只有 `day` 字段；要加时刻必须改存档契约 → **禁止项**，故未做 |

---

## 十、Phase 5 Final：World Surface 收尾（Phase 5 DONE）

### 5-A4 · Story Log 来源可视化 —— ✅ 完成

**设计决定（按指令）**：不删除全量历史。`#story-events` 保留为「历史叙事 / Story Log」，
每条增加来源标记：

| source | 标记 | 语义 |
|---|---|---|
| `core` | **事实**（最深灰度） | 世界里已经被 Core 确认发生过的事 |
| `narrative` | **叙述** | 她当时的讲述，不一定是世界事实 |
| `director` | **调度** | 世界调度层当时的判断理由 |

**数据语义完全未变**：`StoryEvent` 字段、存档契约、`SAVE_VERSION` 一字未动。

### 两个表面的分工（明确冻结）

| | Recent Core Events | Story Log |
|---|---|---|
| 数据 | `vm.coreFacts` | `vm.allEvents` |
| 过滤 | **只** `source === "core"`（**两层**：VM + 表面） | 全部来源 |
| 语义 | 世界最近**真正**发生了什么 | 完整叙事记录 |

允许部分重叠。**不为了去重而删信息。**

### D3 · 时间字段 —— 按指令**不解决**

`StoryEvent` 保持 `{ day, text, source?, priority? }`；
未加 timestamp、未改 `SAVE_VERSION`、未加 migration。
Story Log 只显示「第 N 天」，**绝不**用 `Date.now()` 冒充事件时刻（有断言守）。

### goal / relToMain —— 按指令**不上屏**

已由 e2e 直接检查 `#state-panel` 全部文本，确认：
不展示 `npc.goal` · 不展示 38 维原始数值墙 · 不展示 `relToMain`。

### 5-A5 · 视觉打磨 —— ✅ 完成

- 来源标记只用**灰度**（不用颜色）；沿用 `.agenda-item` 的细左边框语言与 `var(--r)`=2px
- 三层信息层级：聊天 > 当前世界状态 > 历史事件；**新增内容全在既有 `#state-panel` 内**，无浮层、不覆盖聊天
- 空状态全部为自然文案（「还没有她的消息」/「还没有发生什么——日子正安静地过着。」/「还没有值得记下的事。」）
- **未新增任何动画**

### 本阶段发现并修复的**三处断言缺陷**（比缺陷本身更重要）

| # | 现象 | 根因 | 修正 |
|---|---|---|---|
| 1 | 来源混淆注入只被 1 条捕获 | `filter(源).every(...)` 在 `filter` 得到**空数组**时**恒真** | 补前置事实断言 + 改为"存在且标对" |
| 2 | Recent Events 接收 narrative 完全没被捕获 | 测试检查的是 VM 的 `coreFacts`（已过滤），注入在表面层 | 补一条直测：把**全量档案**喂给表面，验证其结构性防线 |
| 3 | mobile overflow 完全没被捕获 | `overflow-x:hidden` + `overflow-y:auto` 把溢出**吸收**，`documentElement.scrollWidth` 恒不变 | 改为**逐元素** `scrollWidth > clientWidth` 判据（5 个宽度全部能捕获） |

### 顺带修掉的真实缺陷

**循环依赖**：第一版让 `story.ts` → `world-view-model.ts`，而后者 → `story.ts`，**成环**。
改为注入式（`setStoryLogEventsProvider`）+ 把 `story-log-surface` 的入参收窄为自有的最小类型
`StoryLogRow`，依赖恢复单向。

### Phase 5 交付总览

```
World State → WorldViewModel → World Surface / NPC Surface
                             → Recent Core Events（只 core）
                             → Story Log（全量 + 来源标记）
```

`ui/world/` 共 5 个模块，全部登记为 `strict` 层，全部只读、可序列化、无 DOM 持有、无 fetch、无 localStorage。
