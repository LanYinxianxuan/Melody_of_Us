# Melody of Us · 玩法契约（GAMEPLAY CONTRACT）

> **这份文件的目的不是设计新玩法，而是防止后续重构误改玩法。**
>
> 任何重构（包括架构、性能、视觉、测试）都必须在本文的边界内进行。
> 需要越过边界时，先改这份契约 —— 而不是先改代码。
>
> 配套文件：
> - `REVIEW_NOTES.md` —— 已发现但**按契约不得擅自修改**的问题清单（问题/影响/证据/当前行为/建议/风险）
> - `PHASE3_RENDER_BOUNDARY.md` —— 阶段 3 的架构搬迁方案
> - `REFACTOR_AUDIT.md` —— 只读审计报告

---

## 0. 第一原则

```
规则决定「发生什么」    ——  Core
AI  决定「怎么表达」    ——  AI
```

**AI 不是游戏规则的最终裁判。**

- AI 可以决定一句话怎么说、用什么语气、要不要提到某个细节。
- AI **不能**决定时间推进多少、情绪加多少、NPC 会不会出现、关系是否变化、
  事件是否触发、游戏是否结束。
- 当 AI 的输出里包含"改变世界"的意图（例如 Director 决策）时，
  该意图必须经过 **Core 的归一化与边界校验**（`normalizeDecision` 等）之后才能落地。

---

## 1. 权责表

| 系统 | 负责什么 | 实现位置 | 谁可以修改 | 谁不可以修改 |
|---|---|---|---|---|
| **Time** 时间 | 虚拟时钟推进、作息表、时段切换、跨天、离线回归 | `time.ts` · `storage.ts`（`virtualMs`/`dayBaseMs`/`timeRate`） | Core | UI、AI、测试夹具（只读） |
| **Emotion** 38 维情绪 | 维度定义、初值、增量应用、时间衰减、上下限、主导特质 | `state.ts` · `mind.ts`（decay） | Core | UI、AI 直接写值 |
| **NPC** NPC 状态 | 角色档案、作息、学习、离场/在场、支线关系 | `npc.ts` · `intervention.ts` | Core | UI、AI |
| **Relationship** 关系 | 关系类型、好感、关系张力 | `storage.ts`（`affection` 等）· `mind.ts`（`relMind`） | Core | 直接由 AI 决定 |
| **Memory** 记忆 | 记忆条目写入、上限、注入提示词 | `chat.ts`（写入点）· `ai.ts`（注入） | Core | AI 自行决定是否落库 |
| **Story/Event** 故事/事件 | 剧情阶段、进度、事件种子掷点、事件卡 | `story.ts` · `events.ts` · `event-card.ts` | Core | AI 决定触发与否 |
| **Player Action** 玩家行动 | 动作与语言原文直发、预判动作条、重答回滚 | `chat.ts`（`sendMessage`）· `action-suggest.ts` | Core | AI 改写玩家输入语义 |
| **World Director** 世界调度 | 触发检测、决策归一化、落地执行 | `director.ts` + `chat.ts`（`executeDirectorDecision`） | **Core/AI 边界**：AI 提决策，Core 校验并执行 | AI 直接改世界状态 |
| **AI** 叙事表达 | 提示词组装、网络调用、响应解析、表达风格 | `ai.ts` | AI | AI 修改规则数值 |
| **Save** 持久化 | 存档契约、版本、迁移、槽位、导入导出 | `storage.ts` · `save-schema.ts` · `save-io.ts` | Save | UI 直接拼存档字段 |
| **UI** 展示 | 状态 → DOM、消息渲染、面板、弹层 | `chat.ts`（待拆）· `menu.ts` · `ui/` | UI | UI 承担 fetch / localStorage / 游戏规则 |

---

## 2. 冻结清单（改动 = 需要重新决策，不是重构）

以下系统的**语义与数值**在重构期间一律冻结：

1. 38 维情绪体系：维度集合、初值、`applyDelta` 语义、衰减曲线、上下限
2. NPC 行为与 `schedule`（作息表内容与时段划分）
3. 时间推进规则（`timeRate`、跨天阈值、离线回归处理）
4. 人物关系语义（关系类型判定、好感变化条件）
5. memory（写入条件、上限、注入方式）
6. Story / Event（阶段划分、进度计算、事件种子概率与"连续 N 轮强制"）
7. 玩家行动语义（原文直发、`passOpenEventCards` 的"错过"语义）
8. World Director 的职责范围与 AI 权限
9. 事件触发规则（`events.ts` 的最小间隔 / 强制触发）
10. 游戏结束条件（若有）与核心游戏循环

> 核心游戏循环：
> `角色 → 情绪 → 时间 → 故事 → 用户选择 → 世界变化 → AI 反馈`

---

## 3. 允许在重构中做的事（无需重新决策）

- 文件拆分与 import 调整（保持模块图无环、行为不变）
- 类型补全（把 `(store as any)` 换成真实字段声明，**不改变运行时结构**）
- DOM 查询收口（`el()` / `qs()`），把 `getElementById(x)!` 换成可诊断的查询
- 把 UI 从领域模块里**搬走**（不改变领域模块对外语义）
- 把散落的 `fetch` 收口到 `ai/`（不改变请求参数与解析语义）
- 测试补充与测试基础设施修复
- CSS/HTML 重构（须有声明级等价证明）
- 无行为变化的架构调整

---

## 4. 必须暂停并征询的情况

1. 需要改变已有存档的语义
2. 需要删除用户数据
3. 需要改变玩法规则或数值
4. 需要改变全局 / slot 数据作用范围
5. 发现无法安全兼容旧存档
6. 架构重构必须改变核心玩法行为才能继续
7. 存在不可逆的数据风险

---

## 5. 边界规则（架构层如何保证契约）

| 层 | 允许依赖 | 禁止 |
|---|---|---|
| `ui/` | `core/` 的只读导出、`ui/dom.ts` | fetch、localStorage、游戏规则计算 |
| `core/` | 领域模块（`mind`/`time`/`story`/`npc`/`director`） | 直接操作 DOM |
| `ai/` | 无（唯一网络出口） | 修改 `store`、决定规则数值 |
| `save/` | `save-schema`/`save-io` | 依赖 UI 或 AI |
| `app/` | 全部（唯一允许直接 `querySelector` 之外还负责装配顺序） | 承载业务规则 |

**当前状态与目标状态的差距**记录在 `REVIEW_NOTES.md` 的 A-1 / A-2 / A-3 / A-4。
