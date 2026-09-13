# Melody of Us · 系统级审计报告与重构路线

> 审计日期：2026-09-12 ｜ 审计对象：`melody-ai` 分支（HEAD `990491c`，工作区干净，领先 `origin/melody-ai` 6 个提交）
> 审计方式：逐行阅读 + 全仓 grep + 依赖图环检测 + 真实构建 + 真实浏览器渲染 + 真实跑测试 + 像素级截图核对。**本阶段未修改任何代码。**
> 实测环境：`npx vite build` ✅ 2.52s ／ `npm test` ✅ 50 通过 0 失败 ／ dev server `:5199` 三页 200 ／ headless Chromium 桌面 1440×900 + 移动 390×844 截图

---

## 0. 一句话结论

**Melody of Us 已经有了一个真正的「世界」，但它被装进了一个「聊天页」的壳里。**

设计层（38 维情感、时间、场景、剧情、Director、Agent Mind）是这个项目最值钱的资产，深度和完整性远超同类个人项目；
问题全部集中在 **交付层**：没有类型检查、没有构建后的公共资产、状态直接 mutate、DOM 与业务逐句交替、视觉令牌三页三份、世界状态被埋在侧栏 320px 里、以及一批「写好了但没接线」的功能。

因此本次重构的主轴不是「重写」，而是 **把已有的世界抬到台前，把交付层补齐**。

---

## 1. 基线事实

| 维度 | 实测值 |
|---|---|
| 源码 | 22 个 TS（**8,819 行 / 408.6 KB**）+ 3 个 HTML（**3,481 行 / 144.2 KB**）= 12,300 行 / 552.8 KB |
| 最大文件 | `chat.ts` 1,667 行 ／ `chat.html` 1,658 行 ／ `mind.ts` 1,085 行 ／ `ai.ts` 986 行 |
| CSS | 全部内联在 HTML `<style>` 中，共 **58,276 B / 420 条规则**（chat 39.2 KB / 265 条） |
| 图标 | 40 个 Lucide symbol，**每页内联一份 13,853 B**（三份逐字节相同，合计 41,562 B = HTML 总量 28.8%） |
| 构建 | `vite build` ✅ 2.52s，29 模块；chat 单 chunk **129.46 KB**（gzip 67.84 KB），无代码分割 |
| 依赖 | 运行时仅 3 个 `@capacitor/*`；devDeps **只有 `vite@^5`** |
| 测试 | `node tests/agent-smoke.mjs` ✅ 50 断言 / 11 场景（其中 **4 条是 `\|\| true` 恒真**）；`tests/browser-e2e.ts` **不可运行**（宿主页 `tests/e2e.html` 不存在，puppeteer 不是依赖） |
| 类型检查 | ❌ **无 `tsconfig.json`、未安装 `typescript`**；`vite build` 用 esbuild 只擦除类型不校验；CI 也不跑 |
| CI | 单个 workflow：`npm ci` → `npm run build` → `cap sync` → `gradlew assembleRelease`。**从不跑测试** |
| 存档 | localStorage，5 槽（`storage.ts` 允许 1–9，menu 只认 5，文档写 5） |
| 满量存档体积 | 实测合成档 **63.7 KB**；9 槽 ≈ 0.7 MB / 5 MB 配额 |
| 单轮主请求 | system 6,731 字符 + 16 条历史 744 字符 = **8,448 字符 ≈ 4.5–5.3k tokens**，其中静态指令 6,041 字符（38 维指南 3,130 字符） |

---

## 2. 值得保留的资产（重构中不可丢失）

必须在重构中被明确保护、迁移而非重写的东西：

1. **38 维情感词典与五层结构**（`state.ts` 人格/关系/情绪/状态/阴影）。这是产品差异化的根，`baseline`/`regression` 双参数的设计（人格不回归、情绪强回归）是正确的建模选择。
2. **Agent Mind 五层状态分离**（`mind.ts`：UserState / AI 决策态 / RelState / Context / Strategy）。**每轮 0 次额外 LLM 调用**完成完整决策链，只把压缩摘要注入最终调用 —— 这是整个项目最高明的一处工程决策，成本与深度兼得。
3. **回调注入的依赖倒置**（14 个 setter 钩子）。虽然形式笨重，但运行时依赖图是**真正的 DAG，0 环**（已用脚本验证）。`storage.ts:6` 的「类型导入避免 storage↔mind 运行时循环」注释说明作者清楚边界在哪。
4. **Director 的「代码层 trigger → AI 决策」两级门控**（`director.ts`）。普通聊天 0 成本不调用，命中 trigger 才 1 次 API。
5. **NPC 介入的两层筛选**（规则 0 成本打分 ≥25 → 概率 min(55%, 20%+score/100)）。信息边界（`knownFacts` + 公开对话）设计正确。
6. **黑白灰设计令牌本身**（`--ink/--ink-soft/--ink-faint/--bg/--bg-soft/--line/--line-strong/--danger/--r`）。取值克制、对比度算过、`--danger` 是唯一彩色且限定危险操作。**这套令牌是对的，问题只是它被抄了三份且有两处漂移。**
7. **`UI_STYLE.md`**：罕见地写清了「禁止渐变色/玻璃拟态/发光/胶囊按钮/大圆角」和「必须支持 prefers-reduced-motion」，全站实测 **0 个 `box-shadow`、0 个 `backdrop-filter`、0 处发光、8 处渐变全是 1px 发丝网格线**。规范被真正执行了。
8. **实测性能良好的背景流体场**（home/menu 内联脚本）：预分配 Float32Array、无每帧分配、静默 1.2s 自动停帧、`prefers-reduced-motion` 下完全不注册。

---

## 3. 十二个根因（所有表层症状都归到这 12 条）

| # | 根因 | 症状面 |
|---|---|---|
| R1 | **没有类型层**（无 tsconfig/tsc） | 51 处非空断言 + 33 处 `as` + 25 处 `any` 全部未经校验；`AIState` 用索引签名导致 38 个 key 零静态保障 |
| R2 | **没有「构建产物」概念**（源码目录 = 部署目录） | public 资产进不了 `dist/playground`；`cp -r dist/assets dist/playground/assets` 是死代码；dev 下 SW/图标 404 被 `.catch(()=>{})` 吞掉 |
| R3 | **没有状态容器**（模块级 `let` + 直接 mutate） | 55 个模块级可变变量；`store` 被 10 个模块直接改；`CHARACTER` 重绑定导致角色不生效；跨标签 last-write-wins |
| R4 | **没有渲染边界**（业务与 DOM 逐句交替） | `sendMessage` 182 行内状态变更与 DOM 写入交错；`executeDirectorDecision`/`runNpcIntervention` 同病 |
| R5 | **没有设计系统层**（令牌三份 + 组件各写） | `--line-strong` 两值；9 种按钮高度、5 种输入框、4 种反馈机制、4 套断点；30 处 `--ink-faint` 10–11px 全部不达 AA |
| R6 | **没有世界视图**（世界状态埋在 320px 侧栏） | 时间/场景是面板里的一小段；38 维在弹窗里；首页是营销页而非世界；进来第一眼是空聊天区 |
| R7 | **没有 AI 抽象层**（fetch 打在业务里） | 6 个 `fetch(chat/completions)` 硬编码；Claude/Gemini 必然 404；DeepSeek 专有参数 spread 给所有供应商 |
| R8 | **没有提示词组装层**（巨型字符串拼接 + 字符串替换插入） | 9 条独立提示词；1,277 token 静态指令里 3,130 字符是 `DIMENSIONS` 的重复转述；`replace("【最关键：输出格式】", …)` 做注入 |
| R9 | **没有存档契约**（无 version、逐字段 `??`、静默 catch） | 存档损坏 = 静默开新档；配额耗尽 = 静默停止存档；`aiState` 只增不删 |
| R10 | **没有生命周期**（模块顶层副作用 + 无 visibilitychange） | `chat.ts` 184 行模块级副作用依赖 import 顺序；后台标签仍每秒 tick；无 `beforeunload` 丢虚拟时间 |
| R11 | **没有错误与日志策略**（56 处 console + 静默 catch 并存） | 生产环境把完整 prompt/响应/用户情绪打进控制台；同时 `saveState` 失败无声无息 |
| R12 | **有一批「写完没接线」的功能** | 22/84 个死导出、`.panel-open`/`.proactive`/`.scene-card`/`.ic-logo` 未定义类名、`faceToFace()` 恒 true、`getSceneAtmosphere` 里 `${s.place}` 写死在普通字符串里 |

---

## 4. 分维度审计

### 4.1 目录结构与工程化

- 只有一个 `playground/` 平铺 24 个文件，UI 层（`chat/menu/home`）与逻辑层（`state/storage/time/…`）混在同一目录，靠命名约定而非目录结构区分。
- **缺 `tsconfig.json`、缺 `typescript`、缺 lint、缺 format、缺 `preview` 脚本**（README 里写了 `npm run preview`，`package.json` 里没有）。
- `playground/` 下残留 5 个空 `.tmpdir` 目录（`git status --ignored` 显示未被忽略，只是空目录所以 git 不报）。
- 分支污染：本地 6 个 + 远程 9 个分支，含两次历史重构尝试（`redesign/monochrome`、`rewrite/vue-version`）与一个 `feat/3d-scene-mode`。`melody-ai` 是唯一活跃分支。
- **不存在任何架构文档与代码的一致性保障**：`ARCHITECTURE.md` 写「12 个 TS 模块约 4400 行」，实际 22 个模块 8,819 行；写「44 项断言覆盖 8 种情况」，实际 50 项 11 场景。
- `vite.config.ts` 的 `/api/chat` DeepSeek 代理（含 `model: "deepseek-v4-flash"` 硬编码）**前端从不调用** → 死代码。且它在 `apply: "serve"` 下把浏览器传来的 key 转发出去，与 README 宣称的「生产环境应服务端持有」相反 —— 生产构建里根本没有服务端。

### 4.2 页面与信息架构（**这是产品层最大的问题**）

三个页面承担的角色与产品定位错位：

| 页面 | 现状 | 应该是 |
|---|---|---|
| `home.html` (805 行) | 营销落地页：品牌 + hero + 3 条特性 + 2 个 CTA + 页脚 | **世界界面**：进入即看到「世界正在运行」 |
| `menu.html` (1018 行) | 5 张存档卡 + 右侧 420px 设置面板 | 设置 + 存档管理（保留），但需要重做 IA |
| `chat.html` (1658 行) | 主玩法 = 聊天 + 左侧 320px 状态栏 | 世界 + 对话是世界的一部分 |

具体症状：

- **世界状态被降级为侧栏的附属品**。时间胶囊（`08:00` 用 24–30px 显示）、场景卡（8 个字段：标题/地点/氛围/天气/人/声音/光/她正在做）、剧情卡、日程时间线、情绪日志、Agent 调试面板 —— 6 个板块全部挤在 320px 里纵向堆叠，超出视口后需要滚动，而右侧聊天区在空档状态下是**整片空白**。
- **38 维情感被藏进弹窗**（`#emotions-modal`，全屏不透明），入口是侧栏底部一个 `#emotions-toggle`。产品最独特的资产是「点开才看得见」的。
- **头栏 9 个纯图标按钮**（面板/TTS/多人/历史/角色/决策/演示/重置/菜单）挤在 52px 高的一行，移动端换行成两行。
- **`menu.html` 移动端 10 个同款黑色按钮**：5 个存档 × (新建 + API 设置)，全部同权重、同视觉，滚动一屏看不到底。
- **运行期标题是占位符**：`#chat-title-text` 初始为「情感 AI」，`setBusyState` 在第一次回复后才写成角色名。截图可见顶栏显示「情感 AI」而侧栏显示角色卡。
- 空状态（新档 / 未配置 Key）没有任何引导，只有一片空白 + 底部输入框。
- 「全部情感」弹窗里 `canvas width="1000" height="200"` + CSS `width:100%` → 手机上 9px canvas 字号被缩放到约 **3.2px**，图例不可读。

### 4.3 组件与状态管理

- **无状态容器**：55 个模块级可变变量。三个互不相关的布尔锁 `busy` / `directorBusy` / `npcBusy` 靠约定而非状态机协调并发路径。
- **14 个 setter 注入钩子**（`setCharacterGetter` 被注册两次；`setNpcNameGetters` 定义了但全仓无人调用 → NPC 历史文案永远用默认「她」「你」）。
- **`chat.ts` 模块顶层 184 行副作用**（`1483–1666`）：自动进演示模式 → 载入角色 → 建 38 个 meter → loadState → 初始化头像 → tick NPC → tick 日程 → `startClock` → 恢复折叠态 → 挂 `__debug` → 读 URL 参数 → 延时开向导 → 判移动端收起面板。**无 `init()` 入口，依赖 import 顺序，不可测试。**
- **移动端/桌面端用 CSS 语义相反的 `.hidden`**：桌面 `#state-panel.hidden{display:none}`，移动 `#state-panel.hidden{display:block}`（靠 transform 位移）。
- 4 个无效类名：`.panel-open`（6 处 add/remove，CSS 零定义）、`.proactive`（2 处）、`.scene-card`（HTML 用了但无规则）、`.ic-logo`（3 处）。

### 4.4 数据流（一条消息走过的路）

```
用户输入
 └─ handleSend → passOpenEventCards() → sendMessage()
     ├─ 建 RedoCheckpoint（含 aiState 38 值 + snapshotAgentMind + agenda 深拷贝 + DOM 节点引用）
     ├─ store.lastReply* = now（直接 mutate）
     ├─ appendMessage("user") + attachTimeStamp  ← DOM
     ├─ setBusyState(true)                        ← DOM
     ├─ runAgentPipeline()                        ← 0 成本本地决策链 ✅
     ├─ logAgentTurnToConsole()                   ← 生产环境默认开启的 console 输出 ⚠
     ├─ chatWithDeepSeek()                        ← 1 次 fetch（无超时/无 abort）
     ├─ setReplySuggestions + renderActionSuggestBar   ← DOM
     ├─ applyDelta() + USER_EMOTION_FIX           ← 直接改 aiState
     ├─ updateStateUI()                           ← 77 次 getElementById + 重绘画布
     ├─ logEmotion ×2                             ← DOM
     ├─ storyEvents.push / storyProgress / activeThread
     ├─ applyAgendaFromAI + renderAgendaUI        ← DOM
     ├─ chatHistory.push ×2 + memories.push
     ├─ saveState()                               ← 同步写整个存档（~64 KB）
     ├─ 建 .story-line 节点                        ← DOM
     ├─ appendMessage("ai") + addReanswerBtn + typeReply + attachTimeStamp + 建 .emotion-tag  ← DOM
     ├─ finishAgentTurn + logAgentTurnResponseToConsole + updateAgentDebugAfterTurn
     └─ void maybeDirector() / void maybeNpcIntervention() / void maybeShowEventCard()
         └─ 三条 fire-and-forget 异步链，各自可能再改状态 + 各自 saveState
```

**182 行里状态变更与 DOM 写入逐句交替，没有任何「先算后渲」的边界。** 这是全部 UI/业务耦合问题的具体形态。

### 4.5 AI 调用

- **6 处 `fetch(\`${baseUrl}/chat/completions\`)`**：`ai.ts:398`（流式，死代码）、`:495`（主角主力）、`:762`（访谈）、`:853`（NPC）、`:958`（随机事件）、`director.ts:212`。
- **无 `AbortController`（全仓 0 处）、无超时、无退避、无网络重试**。重试只针对「内容为空/解析失败」，且是**递归重试**（`chatWithDeepSeek` 最多 3 次调用）。
  → **直接后果：请求挂起时 `busy` 永久为 `true`（`chat.ts:349,351-364`），输入框永久禁用，用户无法中断**（没有「停止生成」按钮，也没有 abort 能力）。
- **`max_tokens` 六处不一致**：主回复 16384 / 访谈 2048 / NPC 2048 / 事件 900 / Director 1024；而仓库自带的 dev 代理写的是 8192（`vite.config.ts:46`）。同一个 `model-${slot}` 同时承担这五种截然不同的输出需求。
- **仅 1 处检查 `resp.ok`**（`ai.ts:404` 流式路径）。其余 5 处直接 `await resp.json()` → 5xx/HTML 响应抛原始 `SyntaxError`，经 `chat.ts:565` 渲染成角色的「话」。
- **供应商表重复四份且互相漂移**：`ai.ts:334`、`director.ts:162`、`menu.ts:13`、`tts.ts:209`。**`director.ts` 版本缺 claude/gemini**，并用 `?? PROVIDERS["deepseek"]` 兜底 → 用户选 Claude/Gemini 时，Director **静默把请求打到 api.deepseek.com**（带着 Claude 的 key），失败被 `chat.ts:770 console.warn` 吞掉 → 世界调度彻底静默失效。
- **Claude 打 `/v1/chat/completions`（Anthropic 无此路由，应为 `POST /v1/messages`，请求体/响应体字段完全不同）、Gemini 打 `/chat/completions` + `Bearer`（应为 `POST /v1beta/models/{model}:generateContent` + `x-goog-api-key`）→ 两家「双重错误」必然 404。**
- **DeepSeek 专有参数 spread 进所有供应商**：`thinking:{type}`（6 个调用点全部）与 `reasoning_effort`（`ai.ts:317/322-323`）；`response_format:{type:"json_object"}` 在 6 个调用点硬编码（Claude/Gemini 不支持，OpenAI 还要求提示词中出现 "json" 字样 —— 当前靠「提示词里刚好有 JSON」侥幸通过）。
- **根因是 `getProviderConfig()` 未导出**（`ai.ts:328`），导致 `director.ts` 被迫复制一份表并漂移。这是「AI 层没有对外契约」最直接的证据。
- **API Key 明文存 localStorage 并由浏览器直连**（`apikey-${slot}`）。TTS 的 voice-clone 音色也以 base64 存在同一个 5 MB 配额里。
- **调试输出进生产**：`ai.ts:488/504` 无保护地 `console.group` 出完整 requestBody 与完整响应；`mind-debug.ts:126` 默认开启（`localStorage["melai-agent-console"] !== "off"`），每轮把情绪判断、策略、注入摘要全部打印。实测首屏就打出 `[随机事件] 跳过：proactiveEnabled=false` ×8，无 key 时**每秒 1 条**。

### 4.6 提示词与解析

- **9 条独立提示词**：`SYSTEM_PROMPT` 6,041 字符 / `DIRECTOR_PROMPT` 1,354 / `FORMAT_INSTRUCTION` 1,203 / `RANDOM_EVENT_PROMPT` 712 / `INTERVIEW_PROMPT` 634 / `NPC_FORMAT` 208，+ mind 动态块 916，+ agenda 复用 `chatWithDeepSeek`（**白白带上整个角色系统提示词 + 16 条历史去排日程**，`agenda.ts:257` → `chat.ts:1531`）。
- `SYSTEM_PROMPT` 里 **3,130 字符是 `state.ts` 的 `DIMENSIONS` 的中文转述重复 —— 占主系统提示词的 51.8%**，且是手写字符串：新增/修改一个维度必须同时改两处，否则提示词与状态机脱节。
- **情绪关键词判定有 4 套并存且口径不同**：`ai.ts:576`（8 正则）、`mind.ts:219 EMOTION_RULES`（10 条）、`director.ts:26 EMOTION_WORDS`（7 条）、`state.ts:176 USER_EMOTION_FIX`（6 类 delta）→ 同一句话在三条链路里得到三种判定。
- **默认情绪值两处**：`mind.ts:164-179 default*Mind()` 与 `storage.ts:141-152` 的字面量完全重复（14/9/4 个键）。
- 注入方式：`baseSys.replace("【最关键：输出格式】", agentPrompt + "\n\n【最关键：输出格式】")` —— 用中文标记字符串做锚点替换。
- **JSON 大括号切片解析重复 3 份**（`ai.ts:237`、`ai.ts:971`、`director.ts:226`）。参与解析模型输出的正则 6 条。
- `parseAIResponse` 对**任何**结构都强注入 `dialogue`/`action` 默认值 → **实测：访谈返回的干净 JSON `{"insight":…,"question":…}` 被注入 `"dialogue":"（她张了张嘴…）"` 与一个动作**，再经 `ai.ts:784` 双重 `as unknown as InterviewResult` 污染整个访谈流程。
- 字段类型不校验：`memory: 5`、`delta: "big"`、`story: "none"`、`agenda: {add: "明天见面"}` 全部原样放行 → **`chat.ts:506 result.memory.trim()` 抛 `TypeError`，此时历史已写入、回复已丢失，catch 只把英文错误显示给用户**。（其余几项靠下游 `typeof` 侥幸安全，属「碰巧没崩」。）
- 截断 JSON（`{"dialogue":"被截断的话","actio`）**无法修复**：`indexOf("{")`/`lastIndexOf("}")` 切片对截断无效 → 直接 throw → 触发整轮重发（多一次全额 token 消耗）。
- `refineWithModelAnalysis`（`chat.ts:452`）在回复**生成之后**才执行，且只写 `turn.trace.refined`（`mind.ts:1035`）→ **LLM 的语义修正信号永远只出现在调试面板，不影响任何状态、策略或提示词**。加上 `user_analysis` 与正文来自同一次调用，这条链在结构上不可能生效 —— 这是一条「看起来实现了、实际是装饰」的功能。
- **XSS 面（自我注入）**：`mind-debug.ts:88` 用 `el.innerHTML = blocks.join("")` 直接拼接 `t.userText`（用户原始输入）与 `t.response`（**模型生成的 dialogue**），未走项目既有的 `util.ts escapeHtml`；`#agent-debug` 在 `chat.html:1590` 常驻 DOM。
- **`dialogue_ja`（日语翻译）被 `FORMAT_INSTRUCTION` 标为「必填」** → 每轮都生成一份日语翻译，只为 TTS 使用。**不开 TTS 的用户每轮都在为一份永远不播放的翻译付 token 与延迟。**

### 4.7 故事系统

- 阶段（`storyStage`）是纯阈值模板（aff/fam 5 档），**与 `storyProgress` 无关**；`storyProgress` 由 AI 累加、只增不减、到 100 永久饱和。
- `fallbackStory().thread` 只可能是 `"continue"|"new"`，**联合类型里的 `"end"` 永不产生**。
- 随机事件：代码只掷骰子 + 给 AI 一句模板指令，内容 100% 由 AI 生成（这个选择是对的）。但 `lastTriggeredTurn = -99` 导致**每次页面加载后第一轮必被强制触发**，实际节奏恒为 3–4 轮一次，与注释「每 5–8 轮」不符，且 30% 概率几乎不起作用。
- `finalizeDay` 是纯模板拼接（非 AI），且 `setVirtualTime` 跳时只归档「被跳过的前一天」→ 跳到第 30 天，journal 里第 2–29 天全是空洞。
- 冷落系统（4 级双通道阈值 + 情境注入）设计细致，是很好的「世界主动感」来源。

### 4.8 时间系统

- 虚拟时钟 = `setInterval(tickClock, 1000)`，`virtualMs += dt * timeRate`。**关闭页面期间时间不推进**（无离线补偿）。
- `RATE_MAX = 100000` → 1 实秒 ≈ 27.8 虚拟小时 → **每个 tick（每秒）跨天一次** → `finalizeDay` + `directorOnDayChange` + `planTodayAgenda`（LLM）= **每秒一次 LLM 请求**。1440× 时每秒 2 次 `saveState`（每次 ~64 KB 同步写 localStorage）。
- `tickClock:329` 与 `setVirtualTime:291` 的 `dayChangeHandler` 调用顺序**相反**：前者先回调后赋值（handler 里读 `store.dayIndex` 得到的是旧值 → Director 文案变成「第 X 天 → 第 X 天」）。
- `jumpToToday()` 实际是 `setVirtualTime(1, nowHHMM)` —— **把故事倒回第 1 天**，且不清理后续 journal/agenda。
- `__debug.next()` 硬编码 `% 16`，而 `getSchedule()` 有 **17** 段 → 永远到不了 index 16（睡前 22:30）。
- 全链路本地时区 + 以 `86400000` 为一天 → DST 或换时区会静默错 1 天 / 错 1 时段。
- 每个 tick 调用 `getSchedule()` 8–12 次，**每次都新建 17 个对象**。

### 4.9 情绪系统

- `applyDelta` 的回归是**按回合**而非按时间：挂机不衰减，刷消息才衰减；emotion 组 regression 0.2–0.35 → 一轮就把 delta 削掉 20–35%。且 delta 与回归**同轮内先加后拉**。
- `describeMood()` 的阈值参数 `th` 声明了但**从未使用**，函数体硬编码 `>60 / <35` → 33 个调用点传的阈值全是装饰；5 个人格维永不出现。
- `clamp(NaN) === NaN` → 脏存档永久污染该维度。
- `USER_EMOTION_FIX` 只有 6 键而 `EMOTION_NAMES`/`detectUserEmotion` 有 10 键 → jealousy/greed/guilt/lazy 四个情绪**没有数值兜底**。
- 两处绕过回归直接写 `aiState`（`story.ts:345` 冷落、`chat.ts:464`）。
- 情绪阈值→中文短语有 **5–6 份实现且阈值互不相同**（state/story×2/agenda/director）→ 同一个「喜悦」在不同面板判定不同。

### 4.10 NPC / 角色系统

- `applySceneToProfile` 用 8 条正则给校园 NPC 换皮，非校园场景残留「上学路上/早自习/社团活动」。
- `npcScheduleAt(npc, virtualMs, dayBaseMs)` 的 `dayBaseMs` **完全未使用**；`schedule[0]!` 空数组即崩；23:00–23:59 会卡在 `22:30 睡前`。
- 场景词汇表 **3 份且取值域不一致**：`wizard.parseSceneText` 产出 place ∈ {咖啡店,酒吧,便利店,公司,学校,医院,工作室,排练室,书店,小镇}，预设用 {诊所,画室} 且 busyLabel ∈ {看诊,画画} → **自由描述路径无法复现预设场景**；`time.ts` 的 11 个 `label === "…"` 分支只认硬编码字面量。
- **`setCharacter()` 重绑定 `CHARACTER`，而 `chat.ts:114` 持有旧对象快照** → 走「自定义创建」路径时，AI 系统提示词、问候语、角色名**在刷新前全是空模板**；预设路径用 `Object.assign` 原地改所以正常。两条路径语义不一致。
- 角色头像是一个 `charAvatar()` 正则表（名字里含「桃/仁菜/鲸/洛/影/熠/安黎/苏晚」→ emoji），在 4 处分别写入 DOM。

### 4.11 存档系统

- **无 `version` 字段、无迁移框架**。4 处一次性迁移靠 `?? 默认值` 堆叠。
- `Object.assign(aiState, INITIAL_STATE, data.aiState)` **只增不删** → 旧版本删掉的维度永久残留在存档里继续落盘（对照 `resetState` 会 `delete`）；`data.aiState` 值不做类型校验。
- **全部静默 catch**：`saveState` 空 catch → 配额耗尽后**静默停止存档，用户无感直到刷新丢档**。
- **存档损坏 = 静默开新档**（`chat.ts:1494` 把 `loadState()===false` 当新游戏 → 虚拟时间重置到 08:00），旧数据仍占着 localStorage 但永不读取。
- **多标签 last-write-wins**，无 `storage` 事件监听 / 无 BroadcastChannel / 无 IndexedDB。且 `ai.ts:329`、`director.ts:157`、`wizard.ts:480` **每次请求都重新读全局键 `melai-current-slot`**，而 `storage.currentSlot` 是加载时冻结的 → 另一标签切槽后，本标签会**用别的槽位的 API Key 发请求、却存回本槽**。
- **`melai-did-new-${slot}` 只在向导完成时清除**（`chat.ts:1458`）→ 取消过一次「新建存档」后，再次点新建该槽会**拿到旧档**。
- 只写不读的持久化字段：`userLocation`、`pendingOvernight`、`lastNeglectAt`。
- `clearSlot` 不清 `melai-did-new-N` 与 `melai-tts-*-N`；`menu.ts:288` 的 `localStorage.clear()` 清空**同源全部数据**（含所有槽位与所有 Key）。
- 无 `beforeunload`/`pagehide` → 关闭标签丢失自上次 `saveState` 起的虚拟时间（1× 下最坏约 15 分钟，因为只有跨时段才存）。

### 4.12 设置系统

- **Key 命名分裂成两套**：`apikey-${slot}`（per-slot）vs `melai-effort`/`deepseek-effort`/`melai-provider`（全局）。同一个「思考模式」有两个键：`menu.ts:276` 写 `melai-effort`，`ai.ts:520` 与 `chat.ts:357` 读 `deepseek-effort` → **关闭思考模式无效，且 UI 永远显示「思考中…」**。
- `ai.ts:489` 读 `melai-provider`（无人写入，恒 undefined）→ 调试日志的供应商永远是 deepseek。
- `time.ts:531` 读 `deepseek-key`（**全仓无任何写入点**）→ `onSlotChanged` 的 `hasChatCapability` 恒 false → **时段切换的主动开口永不触发**。
- `tts.ts:211` 默认 provider 是 `xiaomi`，`ai.ts:330` 默认是 `deepseek` —— 同一个键两套默认值。
- `menu.ts:204` 注释写「effort 全局共享」—— 这是有意的设计决定，但它是「设置项作用域」从未被定义的症状。
- 存档槽范围不一致：`storage.ts` 1–9 / `menu.ts` 5 / 文档 5。

### 4.13 UI 层与 CSS

**令牌漂移（实测）**

| 令牌 | home | menu | chat |
|---|---|---|---|
| `--line-strong` | **#c9c9c9** | #bdbdbd | #bdbdbd |
| `--danger*` | **缺失** | ✅ | ✅ |
| `--font-mono` | **缺失** | **缺失** | ✅ |

无间距 / 字号 / 行高 / z-index / 动效时长令牌 —— 只有 1 个圆角令牌。

**碎片化（实测）**

- 字号去重值：home 6 / menu 5 / **chat 12**（9、10、10.5、11、12、13、14、15、16、17、24、30px）。10–11px 级别有 4 个并存，肉眼不可区分。
- 过渡时长：home 3 / menu 2 / **chat 7**（`0.1s/0.15s/.15s/0.2s/0.25s/0.6s/0.8s`），同文件内 `.15s` 与 `0.15s` 并存。
- 颜色字面量：`#333` vs `#333333`、`#000` vs `#000000`、`#fff` vs `#ffffff` 混用；chat 内 24 处硬编码 hex。
- **9 种按钮高度**：home `.btn` 42px / menu `.btn` 30px / chat 的 `.tc-btn` 25、`.rate-btn` 24、`.icon-mini` 30→28、`.icon-btn` 34、`.wiz-nav` 36、`.row button` 34、`#emotions-toggle` 32。
- **5 种输入框**、**4 种弹窗关闭方式**、**4 种反馈机制**（定时条 / 塞进聊天流 / `alert()` / `confirm()`）、**3 种头像尺寸**。
- **4 套断点**：520 / 640 / 767 / 900，无一个跨页复用；chat 有两个相邻的同值 `767px` 块。
- 跨文件逐字节重复：home↔menu **约 3,579 B CSS**（含整段背景层 1,587 B）+ **7,902 B / 8,275 B 两份几乎相同的背景 Canvas 脚本**。

**做对了的**：0 `box-shadow`、0 `backdrop-filter`、0 发光、渐变全是 1px 网格线、圆角只有 `var(--r)` + 2 处例外、动画只动 `background/color/border-color/transform/opacity/width`（无布局抖动）。

### 4.14 无障碍（最弱的一环）

- `chat.html` 全部 `aria-*` 只有 **1 处**（雪碧图 `aria-hidden`）；`role=` **0 处**。
- **`#chat-messages` 无 `role="log"` / 无 `aria-live`** → 屏幕阅读器不播报任何新消息、旁白、系统提示。
- 10 个按钮仅靠 `title` 提供名字（`title` 不显示在触屏）；`#emotions-close` **完全无名**（38 维浮层唯一出口）。
- 38 个 `.meter` 是纯 div + width%，无 `role="progressbar"` / `aria-valuenow`。
- **4 个浮层 + 移动抽屉全部无 `role="dialog"` / 无 `aria-modal` / 无焦点陷阱 / 无 Esc 关闭 / 无焦点归还**。
- 12 个 div 点击目标键盘不可达（5 个 `.group-title`、`#panel-mask`、`#emotions-modal`、5 张 `.save-card`）。
- `<label for>` 全仓 **0 个** → 26 个表单控件无程序化标签。
- `chat.html` **无 `<h1>`、无 `<main>` 地标**。
- **对比度**：`--ink-faint #8a8a8a` 对白底 **3.45:1**、对 `--bg-soft` **3.19:1** —— 全站约 **30 处 10–11px 辅助文字全部不达 AA**。`--line-strong #bdbdbd` 对白底 **1.88:1** —— 所有输入框的唯一边框（未达非文本 3:1）。`.agenda-item.done` 2.61:1、`.event-card.passed` 2.32:1。

### 4.15 移动端

- 三页都用 `overflow-x: hidden` 兜底 —— 溢出被**静默裁掉**而非修复。
- chat 顶栏在 390px 下换行成两行（9 个图标 + 头像 + 标题），28px 图标按钮密集排列。
- **触控目标 < 28px**：`.msg-reanswer` 22×22 且 `opacity:0` 仅 `:hover` 显示（**触屏上既小又不可见**）、`.rate-btn` ≈24、`.as-chip` ≈23、`.as-refresh` ≈20、`.tc-btn` ≈25、`.tc-field-row input` 26。
- `.rate-row` 6 个按钮 `min-width:44px` 需 284px，桌面面板内容区 288px（**仅余 4px**），抽屉态 274px 时依赖换行。
- 无 `visualViewport` 处理 → 软键盘弹出时输入框可能被遮挡。
- `#emotion-chart` 在手机上字号缩到 ~3.2px。
- home/menu 的 Canvas 分辨率仍按 `W/8` 计算（`QUALITY` 只降低注入强度），移动端跑同样的 32,400 格计算；且 JS **不认 640px CSS 断点**（CSS 隐藏了 `.bg-fluid`，JS 仍全速跑）。

### 4.16 性能（实测与静态分析）

| 问题 | 位置 | 量化 |
|---|---|---|
| 打字机每 55ms 强制布局 + 写 `scrollTop` | `chat.ts:327-343` | 叠加 `scroll-behavior: smooth`（`chat.html:840`）→ **滚动动画每 55ms 被重启**，一条 200 字回复持续 ~3.7s 抖动 |
| `updateStateUI()` 77 次 `getElementById` | `chat.ts:147-155` | 一轮对话触发 2–3 次 → **150–230 次 DOM 查询** |
| `renderAgendaUI()` 每秒重建整棵列表 | `chat.ts:1430` → `agenda.ts:138` | `box.innerHTML=""` 每秒 1 次 |
| `tickClock` → `updateScheduleUI` → `updateSceneUI` | `time.ts:340` | 每秒写 13 个节点 + `getSchedule()` 新建 17 对象 ×8–12 次 |
| `#chat-messages` 无界 | `chat.ts` 唯一清空点是 reset | **15–20 个节点/轮**，200 轮后 3–4 千节点 |
| `#mood-history` 无界 | `chat.ts:209` | 每轮 2 条 ×3 span，仅 reset 清空 |
| `turnCheckpoints` 无界 + 持有 DOM 引用 | `chat.ts:387-407` | 每轮含 `{...aiState}` + `snapshotAgentMind()` + **`JSON.parse(JSON.stringify(store.agenda))` 深拷贝** + `domStart` DOM 节点 → detached DOM 泄漏 |
| 12 处 `scrollTop = scrollHeight` | `chat.ts` 9 处 + 其他 | 经典强制同步布局 |
| `saveState()` 整档同步写 | 24 个写入点 | 满量 ~64 KB；1440× 时 **2 次/秒** |
| 背景 Canvas 每帧 | `home.html:699-751` | 1920×1080 → 32,400 格 / **≈138,900 次迭代/帧** + 全屏 `blur(2px)` 合成 pass |
| `resize` 无防抖 | `home.html:664`、`menu.html:877` | 重建 canvas + 3 个 typed array |
| 无 `visibilitychange` | 全仓 0 命中 | 后台标签仍每秒 tick + `saveState` |
| `console.*` 56 处 | 其中 `ai.ts` 17 处无保护 | 生产环境打印完整 prompt/响应 |

### 4.17 错误处理

- **两极化**：`saveState`/`saveCharacter`/`loadSlotCharacterName` 是空 catch（静默丢数据）；而 `ai.ts` 只有 1/6 处检查 `resp.ok`（错误裸奔到用户面前，还被渲染成角色台词）。
- 用户可见错误只有一种形态：`chat.ts:565` 把 `(e as Error).message` 塞进聊天流当一条 AI 消息（且因为双 `appendMessage` bug，它**丢了 `.sys` 样式、带上了角色头像**）。
- 无全局 `window.onerror`/`unhandledrejection`；无 ErrorBoundary 概念。
- 无「离线 / 无 Key / 配额满 / 存档损坏」四类可预期失败的用户提示。

### 4.18 死代码与「没接线」

- **22 / 84 个导出是死导出（26.2%）**。全仓零引用 4 个：`TTS_LANGS`、`generateAudioTags`（整套「情感→音频标签」从未接线）、`ttsStatusText`、`NPC_EMOTION_DIMS`（注释自承「保留引用避免未使用告警」）。
- **导出面严重过宽**：`mind.ts` 有 **43 条 export**，其中 **21 条只是「内部函数被 export」**（`updateUserState`/`updateAiMind`/`updateRelationship`/`relationshipView`/`aiStateView`/`selectStrategy`/`StrategyPromptText`/`buildAgentPrompt`/`defaultUserMind` 等）。`ai.ts` 24 条、`mind.ts` 43 条合计 100 条 export 定义了 AI 层的对外形象，但真正被外部使用的不到一半。
- **全仓零调用 4 个**（连自身文件内也不用）：`tts.ts:19 TTS_LANGS`、`tts.ts:128 generateAudioTags`（整套「情感→音频标签」从未接线）、`tts.ts:501 ttsStatusText`、`npc.ts:234 NPC_EMOTION_DIMS`（注释自承「保留引用避免未使用告警」）。
- **`mind.ts:474 persistMindState` 是真正的死函数**：全仓唯一出现即定义处（函数体只有一行 `saveState()`）。
- **`intervention.ts:27 setNpcNameGetters` 从未被调用** → `applyNpcResult` 写入的 NPC 历史恒为「对她」「对你」，而非真实角色名。
- **死字段 `ChatResult.stats`**：全仓 `.stats` 读取 0 命中，但 `ai.ts:554/710` 与 `demoReply` 仍在写入。
- **死参数**：`decideIntervention(candidates, recentText, publicRecent)`（`intervention.ts:134`）后两个参数函数体内未使用。
- 未定义类名 4 个；重复解析器 3 份；`escapeHtml` 2 份；预设应用逻辑 2 份；`storyEvents` 入档块 3 份；数组裁剪无助手（`chatHistory>200` 抄 3 处、`storyEvents>100` 抄 5 处、`memories>30` 抄 3 处）。
- `chatWithDeepSeekStream` + `StreamChunk`（完整的流式实现）**从未被调用**。
- `vite.config.ts` 的 `/api/chat` 代理**从未被调用**。
- `tests/browser-e2e.ts` 是孤儿（依赖不存在的 `tests/e2e.html`）。
- `faceToFace()` 恒返回 `true`（伪接口）；`getSceneAtmosphere` 里 `"一天的忙碌终于结束，${s.place}里渐渐安静下来。"` 用了普通字符串 → `${s.place}` **字面显示**。
- `home.html` 内联 40 个 symbol 只用 5 个（87% 浪费），且页头 GitHub 图标**另写了一份内联 path** 而不用 `#i-github`。

### 4.19 性能与 PWA / SW

- `public/sw.js`（32 行）：install **无 precache**；`fetch` 网络优先，失败才查缓存，**miss 时 `respondWith(undefined)`**（`caches.match` 未命中是 resolve `undefined`）→ 浏览器抛 `Failed to convert value to 'Response'`，**离线首访不是正常网络错误而是请求被 SW 破坏**。
- `cache.put` 既未 await 也无 catch（游离 promise）；缓存 key 含 query string → `?slot=1..5`、`?eventdemo=1` 各存一份完整 HTML；无容量上限、无 TTL。
- 版本靠手改 `"melody-ai-v5"` 常量，与 `package.json version` 无关。
- **dev 模式下 `./sw.js` 与 `./icons/icon-192.png` 解析到 `/playground/…` → 404**，被 `.catch(()=>{})` 吞掉；`manifest.start_url = ./home.html` 在 dev 下也 404。
- `manifest.webmanifest` 缺 `id`/`lang`/`shortcuts`/`screenshots`；`purpose: "any maskable"` 同一张 PNG 兼任两职（缺安全边距）。
- **Capacitor `webDir = "dist/playground"` 时 `../manifest.webmanifest` 越出 web 根**；`dist/playground` 缺 `sw.js`/`icons/`/`assets/`（要靠 `npm run build` 的 `cp -r`，而 `cp -r dist/assets dist/playground/assets` 是死代码因为 Vite 已把 assets 放在 `dist/assets` 并被 `sed` 重写引用到 `../assets/`）。

---

## 5. P0 缺陷清单（功能性 / 正确性，共 21 条）

| # | 缺陷 | 位置 | 影响 |
|---|---|---|---|
| P0-1 | `setCharacter()` 重绑定 `CHARACTER`，`chat.ts` 持有旧快照 | `character.ts:161,165` / `chat.ts:114,1386` / `wizard.ts:519` | **自定义角色在刷新前对 AI 完全不可见**（system prompt 是空模板、问候语无名） |
| P0-2 | TTS 音色 base64 写入 localStorage（守卫 10 MB）与存档共用 5 MB 配额 | `tts.ts:45,190` + `storage.ts:159-172` | 实际可存上限 ≈3.75 MiB（宽 2.67×）→ 配额被吃满后 **`saveState` 静默失败，刷新丢档** |
| P0-3 | `saveState` 空 catch | `storage.ts:169-171` | 存档失败无任何日志与用户提示 |
| P0-4 | `#chat-messages` / `#mood-history` / `turnCheckpoints` 无界 | `chat.ts:387,209,526,1265` | 内存与 DOM 随轮数线性增长；检查点持有 detached DOM 节点 + 每轮 agenda 深拷贝 |
| P0-5 | 打字机 55ms 强制布局 × `scroll-behavior: smooth` | `chat.ts:327-343` + `chat.html:840` | 每次回复滚动持续抖动/追赶，主线程压力最大的一处 |
| P0-6 | 双 `appendMessage` 导致提示丢失 `.sys` 样式且带角色头像 | `chat.ts:565,1272,1372` | **API 错误文本被渲染成角色的「话」**；重置/角色更新提示样式错误 |
| P0-7 | 思考模式键分裂（写 `melai-effort`，读 `deepseek-effort`） | `menu.ts:276` / `ai.ts:520` / `chat.ts:357` | 关闭思考模式**完全无效**；UI 永远显示「思考中…」 |
| P0-8 | `deepseek-key` 死键 | `time.ts:531` | **时段切换的主动开口永不触发**（世界主动感少了一条腿） |
| P0-9 | Claude / Gemini 请求形状错误 | `ai.ts:328,398,495,…` | 两家供应商必然 404；Director 静默回落 deepseek |
| P0-10 | 跨天回调传错 `newDay` | `time.ts:329` vs `:291` | Director 文案「第 X 天 → 第 X 天」 |
| P0-11 | `melai-did-new-${slot}` 未在取消向导时清除 | `chat.ts:1458` / `wizard.ts:567` / `storage.ts:272` | 取消过一次「新建」后，再点新建该槽**拿到旧档** |
| P0-12 | 存档无 version、`Object.assign(aiState,…)` 只增不删、值不校验 | `storage.ts:181` | 旧维度永久残留；NaN 永久污染；存档损坏静默开新档 |
| P0-13 | 多标签：无同步 + `melai-current-slot` 全局键每次重读 | `ai.ts:329` / `director.ts:157` / `storage.ts:13` | last-write-wins 丢档；**用错槽位的 Key 发请求、存回本槽** |
| P0-14 | `RATE_MAX=100000` 时每秒一次跨天 LLM 调用 | `time.ts:48,328` + `chat.ts:1413` | **LLM 风暴**；1440× 时每秒 2 次 64 KB 同步写 |
| P0-15 | SW 离线 miss 时 `respondWith(undefined)` + 无 precache | `sw.js:4-6,30` | 离线首访请求被破坏；PWA 离线承诺不成立 |
| P0-16 | 无超时/无 abort → 请求挂起时 `busy` 永久为真 | `chat.ts:349,351-364` | **输入框永久禁用，用户无法中断生成**（无「停止」按钮） |
| P0-17 | `mind-debug.ts:88` 用 `innerHTML` 拼接用户输入与模型输出 | `mind-debug.ts:54,80,88` | 自我 XSS / 模型输出注入；与项目 `escapeHtml` 惯例不一致 |
| P0-18 | Claude/Gemini 时 Director 静默回落到 api.deepseek.com | `director.ts:156-179` | 世界调度**静默彻底失效**，被 `console.warn` 吞掉 |
| P0-19 | `memory` 等字段零类型校验 → `TypeError` 丢回复 | `ai.ts:232-278` → `chat.ts:506` | 用户看到英文报错且该轮回复丢失 |
| P0-20 | `parseAIResponse` 污染访谈结果 | `ai.ts:784` | 访谈 JSON 被注入 `dialogue`/`action` |
| P0-21 | `refineWithModelAnalysis` 结构性无效 | `chat.ts:452` → `mind.ts:1035` | 装饰性功能：永远只写调试轨迹，不影响任何状态 |

---

## 6. 产品气质评估：距离「可以生活在里面的数字世界」有多远

用户提出的核心体验循环是：

```
角色 → 情绪 → 时间 → 故事 → 用户选择 → 世界变化 → AI 反馈
```

**这条循环在代码里是通的，而且比大多数同类产品更完整。** 逐环核对：

| 环节 | 代码实现 | 是否在 UI 上被看见 |
|---|---|---|
| 角色 | ✅ 10 字段角色卡 + 8 预设 + AI 访谈向导 | 侧栏一张小卡（名字 + 阶段 + 圆环%） |
| 情绪 | ✅ 38 维 + Agent Mind 五层状态 | ❌ 埋在弹窗里 |
| 时间 | ✅ 虚拟时钟 + 17 段作息 + 场景驱动 | ⚠️ 侧栏一个 24px 数字 |
| 故事 | ✅ 5 阶段 + 剧情线 + 档案 + 日程 | ⚠️ 折叠面板里的一行进度条 |
| 用户选择 | ✅ 主动动作 + 预判动作条 + 事件卡选项 | ⚠️ 输入框上方一排 chip |
| 世界变化 | ✅ Director + NPC 介入 + 随机事件 | ❌ 只有一条灰色旁白 `<div class="story-line">` |
| AI 反馈 | ✅ 打字机 + 动作 + 心声 + 情感标签 | ✅ 聊天流 |

**结论：7 个环节里，4 个在 UI 上几乎不可见或严重降级。** 世界在后台真实运转，但玩家看不见它运转 —— 这正是「像一个 AI 工具」而非「像进入一个世界」的根因。

第二个气质问题是**层级倒置**：屏幕 70% 的面积给了聊天消息区（空档时是一片空白），30% 给了一个需要滚动的信息栏。而产品最独特的东西（时间在走、她就某个地方做某件事、你们的关系在变化）全部挤在那 30% 里。

第三个问题是**缺少「世界在我不在时也在运行」的表现**。`virtualMs` 关闭页面即冻结，`lastReplyRealAt` 的冷落判定用的是真实时间 —— 回来时看到的是「暂停后继续」，不是「我离开时世界发生了什么」。

---

## 7. 重构原则（对标用户提出的六条）

| 用户原则 | 本项目的具体含义 |
|---|---|
| **体验 > 视觉炫技** | 把世界抬到台前（时间/地点/她在做什么/关系变化），而不是加动效 |
| **稳定性 > 炫技** | 先修 15 条 P0，再谈视觉。尤其：存档不能丢、角色必须生效、思考模式必须生效 |
| **可维护性 > 复杂架构** | 不引入框架。引入的只有：tsconfig + 类型、一个渲染边界、一个令牌文件、一个 AI 适配层 |
| **产品气质 > 模板化 UI** | 保持黑白灰 + 2px 圆角 + 0 阴影 + 1px 发丝网格。不引入渐变/玻璃/发光/胶囊 |
| **不过度工程化** | 不引入 React/Vue/状态库/DI 容器。用 Vite 原生能力：CSS `@import`、多入口、`import.meta.glob` |
| **不大规模重写** | 逻辑层（`state/mind/story/npc/time/storage` 的算法）**一行不改**，只改它的接口边界与调用方式 |

**明确不做的事**：
- ❌ 不迁移到 React/Vue（历史分支 `rewrite/vue-version` 已是前车之鉴）
- ❌ 不引入 Tailwind / CSS-in-JS（现有令牌体系已经够用，只是需要收口）
- ❌ 不引入状态管理库（`store` 的问题是没有边界，不是没有库）
- ❌ 不引入 IndexedDB 封装库（只在 TTS 音色这一处需要，直接写）
- ❌ 不重写提示词系统（只做抽出与去重，不动内容）
- ❌ 不引入 Service Worker 框架（`sw.js` 只有 32 行，改对就行）
- ❌ 不做 3D / Live2D（`feat/3d-scene-mode` 分支上另算）

---

## 8. 目标架构

### 8.1 目录

```
melody-of-us/
├── tsconfig.json                 ← 新增：strict，含 noUncheckedIndexedAccess
├── package.json                  ← 新增 typescript / typecheck / test:ui / preview
├── public/                       ← 保持：sw.js / manifest / icons（会被 Vite 原样复制到 dist 根）
├── src/
│   ├── app/                      ← 页面装配层（唯一允许 querySelector 的地方）
│   │   ├── world.ts              ← 世界界面（新首页）
│   │   ├── conversation.ts       ← 对话界面
│   │   ├── settings.ts           ← 设置界面
│   │   └── shell.ts              ← 共享：顶栏 / 抽屉 / 浮层 / toast / 焦点管理
│   ├── ui/                       ← 渲染层（纯函数：state → HTMLElement）
│   │   ├── dom.ts                ← h() / mount() / patchText() 极简渲染助手
│   │   ├── components/           ← Button / Input / Dialog / Toast / Avatar / Timeline / Meter
│   │   └── views/                ← world / character / timeline / conversation 的视图
│   ├── core/                     ← 领域层（**现有算法整体迁移，不改逻辑**）
│   │   ├── character/            ← character.ts
│   │   ├── emotion/              ← state.ts（38 维）
│   │   ├── time/                 ← time.ts（拆出纯时钟 + 场景描述）
│   │   ├── story/                ← story.ts + events.ts + agenda.ts
│   │   ├── world/                ← npc.ts + intervention.ts + director.ts
│   │   └── mind/                 ← mind.ts（Agent Mind）
│   ├── ai/                       ← AI 层（**唯一允许 fetch 的地方**）
│   │   ├── client.ts             ← 统一请求：超时 / abort / resp.ok / 重试 / 脱敏日志
│   │   ├── providers/            ← deepseek / openai / claude / gemini / custom 各自的 encode/decode
│   │   ├── prompts/              ← system / format / director / npc / interview / agenda
│   │   ├── parse.ts              ← 唯一的 JSON 容错解析 + 字段校验
│   │   └── index.ts              ← 对外只暴露语义方法：reply() / npcSpeak() / interview() / planDay()
│   ├── save/                     ← 存档层
│   │   ├── schema.ts             ← SaveV1 类型 + version + 校验 + 迁移链
│   │   ├── store.ts              ← 唯一可写状态容器（subscribe/emit）
│   │   └── storage.ts            ← localStorage 适配 + 配额处理 + 多标签锁
│   └── state/                    ← 跨层共享的只读派生（可选，避免组件各自算）
├── styles/
│   ├── tokens.css                ← 唯一令牌源
│   ├── base.css                  ← reset / 字体 / focus-visible / 无障碍工具类
│   ├── components.css            ← Button/Input/Dialog/Toast/Card/Avatar/Timeline/Meter
│   └── pages/{world,conversation,settings}.css
└── tests/
    ├── unit/                     ← 现有 agent-smoke 拆细 + 补 tts/wizard/agenda/story 覆盖
    └── e2e/                      ← 用 chromium --headless --dump-dom 驱动（已有可用二进制）
```

### 8.2 分层与依赖方向（单向，禁止反向）

```
app/*  (装配、事件接线)
  ↓ 只能 import
ui/*   (纯渲染：state → DOM，无副作用、无 fetch、无 localStorage)
  ↓
core/* (领域逻辑：纯函数为主，只依赖 save/store 的读接口)
  ↓
save/* (唯一状态容器 + 持久化)
  ↓
ai/*   (唯一网络出口；被 core 调用，不反向依赖 core)

共享叶子：styles/*、ui/dom.ts、core/util
```

**硬规则（用 lint 或 CI grep 强制）**：
1. `src/ai/**` 之外不得出现 `fetch(`
2. `src/app/**` 之外不得出现 `document.querySelector` / `getElementById`
3. `src/save/**` 之外不得出现 `localStorage`
4. `core/**` 不得 import `ui/**` 或 `app/**`
5. `ui/**` 不得 import `ai/**` 或 `save/**`（只接受传入的数据）

### 8.3 状态流（对照现状）

```
现状：任意模块 → 直接 mutate store / aiState → 各自 saveState()（24 处）→ 各自刷 DOM

目标：action() → store.commit(mutator) → emit(change)
                                    ├→ save（debounce 400ms + 关键点立即）
                                    └→ 订阅者按 change.kind 局部更新 DOM
```

`store.commit` 是唯一写入口（保留现有 `store` 对象的字段形状以兼容存档），`saveState` 从 24 个调用点收敛为 1 处订阅。关键点（跨天、用户消息落盘、重置、切页）用 `flush()` 立即写。

### 8.4 AI 层接口（对照现状）

```ts
// 目标：UI 永远不 import fetch，也不知道供应商存在
interface AiClient {
  reply(input: ReplyInput): Promise<ChatResult>          // 主角
  npcSpeak(npc, ctx): Promise<NpcResult>                 // 支线
  interview(intro, turns): Promise<InterviewResult>      // 向导
  planDay(ctx): Promise<AgendaItem[]>                    // 日程
  randomEvent(ctx): Promise<RandomEventResult>           // 事件卡
  testConnection(cfg): Promise<TestResult>               // 设置页测试
}

// providers/<id>.ts 负责形状差异（这是现在 404 的根因）
interface Provider {
  id: string
  buildRequest(req: CanonicalRequest): { url, headers, body }
  parseResponse(res: unknown): CanonicalResponse
  supports: { jsonMode, thinking, maxTokens }
}
```

CanonicalRequest/Response 是内部标准形状；DeepSeek 专有参数只在 deepseek 适配器里出现。

---

## 9. Design System 提案

### 9.1 令牌（唯一文件 `styles/tokens.css`）

在现有 9 个令牌基础上**只增不改值**（除 `--line-strong` 统一为 `#bdbdbd`）：

```css
:root {
  /* 现有（保留原值） */
  --ink:#111; --ink-soft:#555; --bg:#fff; --bg-soft:#f6f6f6;
  --line:#e3e3e3; --line-strong:#bdbdbd; --r:2px;
  --danger:#a32119; --danger-soft:rgba(163,33,25,.06); --danger-line:rgba(163,33,25,.4);
  --font-mono: ui-monospace,"SF Mono","JetBrains Mono",Consolas,monospace;

  /* 新增：修复对比度（不改视觉基调，只把第三级文字压深） */
  --ink-mute:#6b6b6b;        /* AA 5.1:1 替代 #8a8a8a 用于 ≤12px 正文 */
  --line-field:#9a9a9a;      /* 3.0:1 用于表单边框（分隔线继续用 --line） */

  /* 新增：字号阶梯（收敛 12 → 6 档） */
  --fs-micro:11px; --fs-sm:12px; --fs-base:13px;
  --fs-md:15px; --fs-lg:20px; --fs-xl:34px;

  /* 新增：间距（现有 4/6/8/10/12/14/16/18/20/24/32 → 6 档） */
  --sp-1:4px; --sp-2:8px; --sp-3:12px; --sp-4:16px; --sp-5:24px; --sp-6:32px;

  /* 新增：动效（现有 7 档 → 3 档） */
  --t-fast:.12s; --t-base:.2s; --t-slow:.32s;
  --ease: cubic-bezier(.4,0,.2,1);

  /* 新增：层级 */
  --z-drawer:40; --z-mask:39; --z-dialog:100; --z-toast:200;

  /* 新增：控件尺寸（解决 9 种按钮高度） */
  --ctl-h-sm:26px; --ctl-h-md:32px; --ctl-h-lg:40px;
  --touch-min:32px;   /* 移动端下限，≥28px 无障碍要求 */
}
```

### 9.2 组件（收敛到 12 个，全部在 `styles/components.css` + `ui/components/`）

| 组件 | 取代现有 | 关键约束 |
|---|---|---|
| `Button` | 9 套按钮 | 3 尺寸 × 3 变体（primary/ghost/danger），四态齐全，图标 gap 5–7px |
| `IconButton` | `.icon-mini` / `.s-del` / `.tc-btn` / `.em-close` | 统一 32px（移动 32px 不低于触控下限），必须有 `aria-label` |
| `Input` / `Textarea` / `Select` | 5 套输入框 | 高 32px，边框 `--line-field`，`<label for>` 强制关联 |
| `Dialog` | 4 个浮层 | `<dialog>` 原生元素：自带 Esc、焦点陷阱、`::backdrop`、`aria-modal` |
| `Drawer` | 移动侧栏 | 同 Dialog 语义 + `aria-expanded`/`aria-controls` |
| `Toast` | `#save-hint` / 塞聊天流 / alert / confirm | 唯一反馈通道；非阻断、可关闭、`role="status"` |
| `Card` | `.panel` / `.save-card` / `.story-card` / `.scene-card` / `.event-card` | 只有 3 个变体：surface / row / emphasis |
| `Avatar` | 3 种尺寸 | 3 档（28/40/56），`<img>` 或 emoji + 可选状态环 |
| `Timeline` | `#agenda-list` + `#story-events` + journal | 见 §9.3 |
| `Meter` | 38 个 `.meter` | `role="progressbar"` + `aria-valuenow`；用 CSS 变量驱动宽度，不写内联 style |
| `SectionTitle` | `.panel-title` / `.panel-section-toggle` | 一种规格 |
| `EmptyState` | 各处空文案 | 一行文字 + 一个可选动作，不配插图 |

### 9.3 视觉语言：从「面板堆叠」到「空间层次」

用户要的是「安静、有空间感、信息有层次、不要一屏全是卡片」。具体手法：

1. **层级靠排版与留白，不靠容器**。现状 chat 侧栏 6 个板块全是描边盒 + 标题栏。改为：主要信息用字号/字重/灰度分层，块与块之间用 **1px `--line` 全宽分隔 + 16–24px 呼吸**，只有「确实需要分组对照」的内容（存档列表、事件卡）才用边框盒。
2. **半透明层只在浮层使用**，遮罩统一 `rgba(17,17,17,.5)`（现状两种：.5 与 .4）。
3. **发丝网格作为唯一「数字世界」暗示**，chat 已有 `background-attachment: local` 的双层网格（40px + 200px），保留并作为三页统一背景层（现在只有 chat 有，home/menu 是自己的 canvas）。
4. **动效只表达状态变化**：消息淡入 0.22s（保留）、时间跨时段的一次极淡亮度变化、情绪变化时对应 Meter 的 0.12s 宽度过渡、页面切换的 0.2s 交叉淡入。**不加循环动画、不加粒子、不加缩放弹跳。**
5. **数字只在真正有意义时出现**：好感/信任/亲密等关系维用**文字短语 + 一条极细的进度线**（如「她开始主动找你了」+ 细线），不显示「82」；`%` 只在剧情进度这种「有明确终点」的地方显示。

### 9.4 响应式策略（统一 2 个断点）

```
--bp-compact: 768px    手机（纵向优先：世界 → 对话 → 输入）
--bp-medium: 1080px    平板（世界可折叠为顶部条）
桌面 >1080px：世界常驻左侧，对话为第二栏
```

现状 4 套断点收敛为 2 个 + 容器查询（世界卡片按自身宽度而非视口响应）。

---

## 10. 关键页面新设计

### 10.1 世界界面（新首页，取代现在的营销 home.html）

进入应用第一眼必须让人感到「世界正在运行」。结构（自上而下，桌面双栏）：

```
┌─ 顶栏（52px）───────────────────────────────────────────────┐
│ Melody of Us          第 12 天 · 周三 09:42 ［时间倍率］  设置 │
├──────────────────────────────┬──────────────────────────────┤
│  世界区（自适应）             │  对话区                      │
│                              │                              │
│  · 背景：发丝网格 + 极淡的     │  （最近 3–5 条消息，          │
│    时段色调（清晨冷 / 午后暖   │    或空状态引导）             │
│    / 夜晚深，只改 ≤4% 明度）   │                              │
│                              │                              │
│  · 场景行（一行，不装盒子）     │                              │
│    📍 学校 · 教室             │                              │
│    她正在听课，偶尔走神        │                              │
│                              │                              │
│  · 她的状态（文字优先）        │                              │
│    「今天话比平常多」          │                              │
│    关系：她开始主动找你了 ────  │                              │
│                              │                              │
│  · 此刻（时间线的前 3 条）      │                              │
│    09:45 课间 · 她跟你说了一句话│                              │
│    08:00 她走进教室            │                              │
│    昨天 22:30 她说睡不着       │                              │
│                              │                              │
│                              ├──────────────────────────────┤
│                              │  输入条（非悬浮）             │
└──────────────────────────────┴──────────────────────────────┘
```

- **对话不再是首页主体**，而是「世界区右侧的一段最近的痕迹 + 输入入口」。用户点对话区或输入后进入对话视图（同一页，世界区收窄为顶部一行）。
- 38 维情感不再需要弹窗：**只有"此刻主导的 2–3 个情绪"以文字出现**，全量在角色页按需查看。
- 时间胶囊从 24px 数字改为顶栏一行中等字重文字（第 12 天 · 周三 09:42），时间仍在走，但不抢视觉重心。

### 10.2 角色界面

重点表现「当前情绪 / 关系 / 最近记忆 / 当前活动 / 变化」，**不做数字 Dashboard**：

```
┌───────────────────────────────────────────┐
│  ［头像 56］  仁菜（Nina）                  │
│              17 岁 · 你的同桌              │
│                                           │
│  此刻                                      │
│  她在教室听课，偶尔走神。心情有点闷，       │
│  因为你刚才那句话。                        │
│                                           │
│  你们之间                                  │
│  她开始主动找你了            ────────      │
│  她愿意跟你说心里话了         ──────        │
│  （变化箭头 + 「比昨天更亲近」这类短语）    │
│                                           │
│  她记得的事                                │
│  · 你答应陪她去书店                        │
│  · 她不喜欢被敷衍                          │
│  · 三天前你提到的桃子汽水                   │
│                                           │
│  最近                                     │
│  （时间线，重要事件加重，小事弱化）         │
│                                           │
│  ［查看全部 38 维状态 →］  低频出口          │
└───────────────────────────────────────────┘
```

### 10.3 对话界面

原则：**对话是世界的一部分，不是整个世界。**

- 每条 AI 消息后附带的**不只是一行灰字标签**，而是「世界变化的痕迹」：她说了什么 → 一行极淡的 `她的话比刚才软了一些` / `窗外的风停了` 。保持克制，不强加。
- 情绪变化**不弹提示**，只让侧栏/顶栏的关系短语与色调有 0.12s 的细微变化。
- 打字机改为 **rAF 驱动 + `scrollTo({behavior:'auto'})`**，并把「逐字符」改为「逐字块」（每帧 2–4 字），减少 55ms 定时器的强制布局。
- 系统消息、错误、重置提示走统一 `Toast`（不再塞进聊天流，也不再丢失 `.sys` 样式）。

### 10.4 时间 / 故事（Timeline）

**不是表格，是「人生记录」。** 三个时间尺度共用一个组件：

| 尺度 | 展示内容 | 视觉权重 |
|---|---|---|
| 今天（日程） | 8–12 个时段条目，`·` `▶` `✓` 前缀 + HH:MM + 标题 | 现行/已过用灰度区分 |
| 这段日子（剧情） | 阶段名 + 进度细线 + 事件条目 | 阶段名加重，事件弱化 |
| 更早（档案/记忆） | 按天折叠的日记摘要 | 默认收起 |

- 事件节点用**左侧一条 1px 竖线 + 圆点**，重要事件（`story.progress ≥ 3` 或 Director 判定）圆点变实心黑、文字加粗；普通小事用 `--ink-mute` 弱化。
- **不加图标、不加卡片、不加连接线装饰**。
- 支持「过去 / 现在 / 未来」三段：日程的 `todo` 条目即「未来可能发生」，用虚线点表示。

### 10.5 设置界面

- 移动端把「5 存档 × 2 按钮」的 10 个同款黑按钮改为：**一行一个存档（名字 + 关系阶段 + 最后活跃时间），点进去再操作**。新建存档提升为顶栏唯一主按钮。
- 设置分 3 组：**连接**（供应商/Key/模型/思考等级/测试）｜**声音**（TTS 开关/音色/语言/风格）｜**数据**（导出/导入/清空）。分组用 SectionTitle + 分隔线，不用卡片。
- 所有设置项的**作用域必须显式标注**（「此存档」/「全局」），并在 UI 上可见 —— 这是 P0-7 类 bug 的根本预防。

---

## 11. 性能方案

| 问题 | 方案 | 预期 |
|---|---|---|
| 打字机 55ms 强制布局 | rAF + `scrollTo({behavior:'auto'})`，每帧写一次文本；去掉 `scroll-behavior: smooth`（改由用户手势触发时用 smooth） | 主线程长任务消失，滚动不抖 |
| `updateStateUI` 77 次查询 | 启动时一次性缓存元素引用到 `Map<string, HTMLElement>`；38 个 Meter 改用 **CSS 自定义属性** `--v: 62` + `transform: scaleX(var(--v)/100)`，只写 1 个 style 属性 | DOM 查询 230 → 0 |
| `renderAgendaUI` 每秒重建 | 只在 `agenda` 内容或 `status` 变化时重建（比较签名）；时间推进只更新 `active` 类 | 每秒重建 → 事件驱动 |
| `#chat-messages` 无界 | 保留最近 **60** 条 DOM，更早的折叠为「查看更早」按需渲染（数据层已有 200 条上限） | 数千节点 → ~600 |
| `turnCheckpoints` 无界 | 环形缓冲（最近 10 轮）；`agendaSnap` 改为写时复制（只在 agenda 变化时快照）；`domStart` 改存索引而非节点 | 消除 detached DOM 泄漏 |
| `saveState` 24 处同步写 | 收敛为 store 订阅 + **debounce 400ms**，关键点 `flush()`；用 `requestIdleCallback` 写 | 1440× 时 2 次/秒 → ≤2.5 次/分钟 |
| `tickClock` 每秒全量刷 UI | 时间显示单独 1 个节点按秒更新；场景/日程/情绪只在**时段变化**时刷（现在已经在跨时段才 save，把 UI 刷新也改成同样条件） | 每秒 13+ 次写 → 1 次 |
| 后台标签空转 | `visibilitychange` 暂停 clock 与背景 canvas；恢复时用真实时间差补算虚拟时间 | 后台 CPU ≈ 0 |
| 背景 canvas | 分辨率按 `min(W,1200)/8` 封顶；`blur(2px)` 改为对 canvas 元素预设 `filter`（不每帧计算）；`resize` 加 200ms 防抖；`pointer: coarse` 下完全禁用 | 移动端可省 ~10 MB/s 计算 |
| 129 KB 单 chunk | 按页面入口分割：menu 不需要 `mind/director/intervention`；世界页不需要 `wizard`。用动态 `import()` 懒加载向导与 TTS | 首屏 −40~60 KB |
| 三份内联 sprite (41 KB) | 抽成 `styles/icons.svg` 单文件 + `<use href="./icons.svg#i-x">`（同源 SVG 引用，浏览器原生支持）；每页按需内联常用 15 个 | −28 KB HTML |
| `console.*` 56 处 | 引入 `debug.ts`（`import.meta.env.DEV` 或 `?debug=1` 才输出）；`ai.ts` 的请求/响应打印与 `mind-debug` 默认关闭 | 生产控制台干净 |

---

## 12. 分阶段执行计划

**每一步都必须：`npm run typecheck` ✅ + `npm run build` ✅ + 三页桌面/移动截图核对 ✅ + 关键路径手工走通 ✅。**

### 阶段 0 · 安全网（不改行为，只加保障）— 预计 0.5 天
1. 加 `tsconfig.json`（`strict: true`，先 `noImplicitAny: false` 过渡）+ `typescript` 依赖 + `typecheck` 脚本。
2. 加 `npm run preview`（README 已写但不存在）。
3. `tests/browser-e2e.ts` 二选一：补 `tests/e2e.html` 让它可跑，或删除并改为 `tests/e2e.mjs`（用已有 chromium `--headless --dump-dom`）。
4. CI 加 `npm run typecheck && npm test`。
5. 清理 `playground/*.tmpdir` 5 个空目录 + gitignore 补 `*.tmpdir`。

**风险**：低。唯一风险是 `strict` 首次开启会暴露大量错误 → 分批：先 `strictNullChecks: false`，每阶段收紧一档。

### 阶段 1 · P0 修复（21 条，不做架构改动）— 预计 2 天
按 §5 清单逐条修。其中 P0-1/7/8/10/11 是单行级修复；P0-2/3/12 需要一起设计（存档配额 + 版本 + 校验）；P0-16/17/19/20/21 属于 AI 层契约问题，建议与阶段 4 合并处理。

**建议顺序**：P0-1 → P0-7 → P0-8 → P0-10 → P0-6 → P0-11 → P0-15 → P0-9 → P0-13 → P0-2/3/12 → P0-4 → P0-5 → P0-14

**风险**：中。P0-12（存档 schema）会触碰 `loadState`，必须先写「旧档 → 新档」的兼容测试（用当前真实存档采样）。

### 阶段 2 · Design System 抽取（视觉不变）— 预计 1.5 天
1. 建 `styles/tokens.css`（统一 `--line-strong`，补字号/间距/时长/层级令牌）。
2. 建 `styles/base.css`（reset + 字体 + `:focus-visible` + reduced-motion 工具类）。
3. 抽 `styles/components.css`（12 个组件）。
4. 三页改为 `@import`，**视觉零变化**（用像素级截图 diff 验证）。
5. 修无障碍基础项：对比度（`--ink-mute`/`--line-field`）、`<label for>`、图标按钮 `aria-label`、`#chat-messages` 加 `role="log" aria-live="polite"`、Meter 加 `role="progressbar"`、`<dialog>` 替换 4 个浮层。

**风险**：低（有截图 diff 兜底）。

### 阶段 3 · 渲染边界与状态容器 — 预计 2 天
1. 建 `ui/dom.ts`（`h()` 极简助手）+ `save/store.ts`（`commit` + `subscribe`）。
2. `saveState` 从 24 个调用点收敛到 1 个订阅（**这是收益最大的一步**）。
3. `chat.ts` 拆解：`sendMessage` 拆为 `runTurn()`（纯逻辑，返回 `TurnOutcome`）+ `renderTurn(outcome)`（纯渲染）。
4. `time.ts` 拆出「纯时钟 + 场景描述」与「世界 UI 渲染」（现状 `time.ts` 有 19 处 DOM 查询，违反它自己的分层声明）。
5. 统一 `Toast` 替换 4 种反馈机制。

**风险**：中高。`sendMessage` 的拆分需要逐段比对行为，建议先加「同一输入 → 同一状态变更序列」的快照测试。

### 阶段 4 · AI 层独立 — 预计 1.5 天
1. `ai/client.ts`：统一超时（30s）+ `AbortController` + `resp.ok` 检查 + 指数退避 + 脱敏日志。
2. `ai/providers/*`：形状适配（修 Claude `/v1/messages`、Gemini `:generateContent`），DeepSeek 专有参数下沉。
3. `ai/parse.ts`：合并 3 份 JSON 解析器，加字段类型校验。
4. `ai/prompts/*`：抽出 9 条提示词；`DIMENSIONS` 指南由数据生成而非手写。
5. 设置页「测试连接」改为对每个 provider 真实探测。

**风险**：中（有真实 API 才能全测；无 Key 时用 mock 验证请求形状）。

### 阶段 5 · 世界界面（产品体验核心）— 预计 2.5 天
1. 新 `app/world.ts`：顶栏 + 世界区 + 对话区（§10.1）。
2. 新的「此刻」时间线组件（§10.4）。
3. 关系状态从数字改为文字短语 + 细线（§9.3.5）。
4. home.html 从营销页改为世界界面（或把营销内容降级为 `/about`）。
5. 移动端重新排布（§9.4）。

**风险**：中（视觉与交互大改，需用户确认方向后再动手）。

### 阶段 6 · 性能与清理 — 预计 1.5 天
§11 全部条目 + 删除 22 个死导出 + 移除 4 个未定义类名 + 合并 3 份 SW 注册 + 重写 `sw.js`（precache 应用外壳 + 离线兜底页 + 上限淘汰 + 构建注入 hash）+ 修正 manifest + 修正 `vite.config.ts`（移除死代理）。

**风险**：低。

### 阶段 7 · 文档同步 — 预计 0.5 天
`ARCHITECTURE.md` / `UI_STYLE.md` / `README.md` 与新结构对齐（当前三份文档的行数、模块数、断言数全部过时）。

**总预计：约 12 个工作日**（按每阶段独立可交付、可中断计算）。

---

## 13. 明确不建议做的重构

| 不建议 | 原因 |
|---|---|
| 迁移 React / Vue | 历史分支 `rewrite/vue-version`（2026-04）已证明代价；本项目 DOM 结构简单，问题在没有渲染边界而非没有框架 |
| 引入 Tailwind / CSS-in-JS | 现有令牌体系只需要**收口**，不需要替换；引入会破坏「1px 发丝网格 + 2px 圆角」的精确控制 |
| 引入状态管理库（Redux/Zustand） | `store` 的问题是缺少唯一写入口，加库不解决 |
| 引入 IndexedDB 封装（Dexie 等） | 只有 TTS 音色一处需要，直接写 30 行即可 |
| 重写提示词系统 / 换模型 | 提示词内容质量是这个项目的强项，只做抽出与去重 |
| 拆成多个 npm package / monorepo | 单应用单仓库，拆包只增加构建复杂度 |
| 引入测试框架全家桶 | 现有 `node --test` + esbuild 打包 + chromium `--dump-dom` 已足够；先把 test 接进 CI |
| 做 3D / Live2D 场景 | `feat/3d-scene-mode` 是独立的探索分支，不应与本次重构耦合 |

---

## 14. 风险与需要用户决策的点

1. **`home.html` 的定位**（阶段 5 阻塞项）：把营销落地页改成世界界面，意味着**去掉现有的项目介绍页**。三个选项：
   - A. 世界界面取代 home，营销内容移到 `about.html`（推荐）
   - B. 保留 home 营销页，世界界面成为新的 `/world.html`，用户的「进入」按钮指向它
   - C. home 上半屏是营销简介 + 下半屏是世界的静态快照，点「进入」进世界
2. **存档 schema 迁移**（阶段 1 阻塞项）：加 `version` 后，是否需要「导出/导入存档」以保护现有用户数据？（当前 localStorage 数据在浏览器里，重构无法触达，但用户可能希望有迁移工具）
3. **TTS 音色的存储介质**（阶段 1 阻塞项）：改 IndexedDB 是明确的技术选择，但会**丢失现有 localStorage 里的音色**（需要迁移逻辑或要求重新上传）。
4. **多供应商的真实可用范围**：Claude/Gemini 需要改成正确端点才可用，但**未经真实 Key 验证**。是否先只保证 DeepSeek/OpenAI 兼容端点 + 自定义 URL 三家，把 Claude/Gemini 标注为「实验」？
5. **`RATE_MAX`**（P0-14）：100000× 的意义是「1 秒过一天」，会让日程/剧情/事件全部失控。建议收到 **1440×**（1 分钟过一天），需要用户确认是否接受能力缩减。

---

## 附录 A · 全部量化指标

| 指标 | 值 |
|---|---|
| 源码总量 | 12,300 行 / 552.8 KB |
| TS | 22 文件 / 8,819 行 / 408.6 KB |
| HTML | 3 文件 / 3,481 行 / 144.2 KB |
| 内联 CSS | 58,276 B / 420 规则 |
| 内联 SVG sprite | 13,853 B × 3 页 = 41,562 B（HTML 总量 28.8%） |
| 导出符号 | 257 个（另 AI 层 8 文件 100 条 export，其中 22 个死导出 / 21 个「内部函数被 export」） |
| 无引用导出 | 13 个（全仓扫描）+ 4 个连自身文件都不用 |
| 模块级可变变量 | 55 个 |
| setter 注入钩子 | 14 个（`setCharacterGetter` 注册 2 次，`setNpcNameGetters` 从未调用） |
| `saveState` 写入点 | 24 处 / 10 个模块 |
| localStorage 键 | 20+ 个，两套命名（`apikey-${slot}` vs `melai-*`） |
| `fetch` 调用点 | 6 处（全部 `chat/completions`，无 timeout/abort） |
| 独立提示词 | 9 条 |
| 单轮 tokens | ≈4.5–5.3k |
| `console.*` | 56 处 |
| 非空断言 `!` | ≈51 处 |
| `as` 断言 | ≈33 处 |
| `any` | 25 处（mind.ts 18 处是多余的 `(store as any)`） |
| DOM 查询（chat.ts） | 92 次 `getElementById` + 8 次 `querySelector(All)` |
| `innerHTML` 赋值 | chat 12 + wizard 6 + menu 5 + 其他 3 = 26 处 |
| `addEventListener` | chat 31 / menu 14 / home 内联 7 / menu 内联 8 = 60 处 |
| `removeEventListener` | **0 处** |
| `aria-*`（chat） | **1 处** |
| `role=` | **0 处** |
| `<label for>` | **0 个**（26 个控件无程序化标签） |
| `:root` 令牌 | home 8 / menu 11 / chat 12（不统一，`--line-strong` 两值） |
| 字号去重值 | home 6 / menu 5 / chat 12 |
| 过渡时长去重值 | home 3 / menu 2 / chat 7 |
| 按钮变体 | 9 种高度 |
| 输入框变体 | 5 套 |
| 弹窗关闭方式 | 3 种 |
| 反馈机制 | 4 种 |
| 断点 | 4 个（520/640/767/900） |
| `box-shadow` | **0** |
| `backdrop-filter` | **0** |
| 对比度不达 AA 处 | ≈30（`--ink-faint`）+ 2（`--line*` 非文本）+ 2（opacity 弱化态） |
| 触控目标 <28px | 6 类元素 |
| 键盘不可达点击目标 | 12 个 |
| 构建 | ✅ 2.52s，chat chunk 129.46 KB（gzip 67.84） |
| 测试 | ✅ 50 断言（4 条恒真）/ 11 场景；browser-e2e 不可运行 |
| 类型检查 | ❌ 不存在 |
| CI 跑测试 | ❌ 从不 |

## 附录 B · 缺陷索引（按文件）

| 文件 | P0 | P1/P2 要点 |
|---|---|---|
| `chat.ts` (1667) | 1,4,5,6,11,13,14 | 184 行模块级副作用；3 个布尔锁；`sendMessage` 182 行；`turnCheckpoints` 泄漏；`updateStateUI` 77 次查询 |
| `chat.html` (1658) | 5,6 | 39 KB 内联 CSS；12 种字号；`#emotions-modal` 无 dialog 语义；canvas 1000×200；`.scene-card` 未定义 |
| `mind.ts` (1085) | — | 18 处多余 `(store as any)`；死导出 12 个 |
| `ai.ts` (986) | 7,9 | 6,041 字符 system prompt 含 3,130 字符重复；3 份 JSON 解析；无保护的 debug 输出；`resp.ok` 仅 1/6 |
| `menu.html` (1018) | — | 移动端 10 个同款黑按钮；`#save-hint` 双 `display` |
| `home.html` (805) | — | 营销页而非世界；40 symbol 只用 5；`.ic-logo` 未定义 |
| `wizard.ts` (578) | 1,11 | 7/10 字段在降级路径不可达；`finishInterview` 可存空名角色；访谈仅内存 |
| `time.ts` (571) | 8,10,14 | 19 处 DOM 查询（违反自身分层声明）；4 个死判定函数；`${s.place}` 字面显示；`% 16` 硬编码 |
| `tts.ts` (513) | 2 | `play()` reject 时 blob URL 泄漏；无法停止朗读；每次重传音色；`generateAudioTags` 死代码 |
| `storage.ts` (302) | 3,12,13 | `loadState` 90 行；`Object.assign` 只增不删；3 个只写不读字段 |
| `story.ts` (399) | — | 5–6 份情绪阈值实现；`"end"` 永不产生；跳时产生 journal 空洞 |
| `event-card.ts` (199) | — | `DEMO_EVENTS[0]` 逐字复制 2 份；`escapeHtml` 2 份；`storyEvents` 块重复 3 份 |
| `agenda.ts` (290) | — | 每秒重建列表；`planTodayAgenda` 复用主角 prompt |
| `intervention.ts` (190) | — | `setNpcNameGetters` 从未调用 |
| `character.ts` (190) | 1 | `export let CHARACTER` 重绑定 |
| `npc.ts` (236) | — | `dayBaseMs` 未使用；`schedule[0]!` 可崩；23:00–23:59 卡在 22:30 |
| `public/sw.js` (32) | 15 | 无 precache；`respondWith(undefined)`；`cache.put` 游离 promise |
| `vite.config.ts` (54) | — | `/api/chat` 死代理；`model` 硬编码 `deepseek-v4-flash` |
| `tests/*` | — | 4 条恒真断言；browser-e2e 不可运行；esbuild 未声明依赖；CI 不跑测试 |

---

*审计完成，未修改任何代码文件（`git status --porcelain` 为空）。本报告为新增文档。*
