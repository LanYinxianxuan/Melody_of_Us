# 🧠 Melody AI 架构

> 纯前端 AI 情感数字人：38 维情感 · 剧情 · 时间 · 多存档 · 世界调度

| 项目 | 说明 |
|---|---|
| 技术栈 | Vite 5 · TypeScript · 原生 DOM · DeepSeek API |
| 存储 | localStorage（5 槽存档） |
| 部署 | PWA 静态站 · Capacitor Android APK |
| 代码量 | 12 个 TS 模块，约 4400 行 |

---

## 🏗 一、分层总览

```
┌─────────────────────────────────────────────┐
│  界面层    chat.html/ts · menu.html/ts       │  渲染、交互、打字机
├─────────────────────────────────────────────┤
│  世界系统层 time · story · npc ·             │  时间/剧情/NPC/调度
│            intervention · director · wizard │  （世界的"模拟"）
├─────────────────────────────────────────────┤
│  数据层    state · storage · character       │  38维情感 / 存档 / 角色卡
├─────────────────────────────────────────────┤
│  AI 引擎   ai.ts                             │  DeepSeek 直连 · 提示词 · 解析
└─────────────────────────────────────────────┘
        ↑ 主角 / NPC / 访谈 / Director 四条调用链共用 ai.ts
```

---

## 🧩 二、核心模块速查

### 数据层（3）

| 模块 | 职责 | 关键数据/接口 |
|---|---|---|
| `state.ts` | 38 维情感状态机 | `aiState` · `DIMENSIONS` · `applyDelta` · `initStateForRelation` |
| `storage.ts` | 存档中心 | `store` 单例 · `saveState/loadState` · 5 槽 · `scene` 场景配置 |
| `character.ts` | 角色卡 | `CHARACTER` · `PRESETS` · `loadCharacter`（空模板防污染） |

### 世界系统层（6）

| 模块 | 职责 | 关键接口 |
|---|---|---|
| `time.ts` | 虚拟时钟 + 场景作息 | `getSchedule` · `currentSchedule` · `sceneDescription` · `isFirstMeeting` |
| `story.ts` | 剧情阶段 / 档案 / 随机事件 | `worldSetting` · `journalText` · `maybeRandomMoment` |
| `npc.ts` | 支线角色 | `NpcState` · `createNpcState` · `applySceneToProfile` · `npcLearn` |
| `intervention.ts` | NPC 介入·规则筛选 | `screenNpcCandidates` · `decideIntervention` · `applyNpcResult` |
| `director.ts` | 世界调度（AI 决策） | `detectTrigger` · `callDirector` · `normalizeDecision` |
| `wizard.ts` | 角色创建向导 | 预设 / 自定义介绍 + AI 访谈 / 场景询问 |

### 界面层（2）

| 模块 | 职责 |
|---|---|
| `chat.ts` | 聊天主流程：sendMessage → AI → 渲染 → Director/NPC 检查（最重，约 1150 行） |
| `menu.ts` | 存档列表 + 设置（API Key / 模型 / 思考等级） |

### AI 引擎（1）

| 模块 | 职责 | 提供 |
|---|---|---|
| `ai.ts` | DeepSeek 直连 | `chatWithDeepSeek`（主角）· `npcSpeak`（NPC）· `interviewWithAI`（向导）· `thinkingParams`（Director 共用） |

---

## 📐 三、依赖关系

```
state ← storage ← character
  ↑        ↑          ↑
 time ─────┼──────────┼──→ (注入回调避免循环: setCharacterGetter / setRelationGetter)
 story ────┼──────────┘
 ai ───────┘
  ↑
director / intervention / wizard / chat  →  都依赖 ai + storage + state
```

- **无循环依赖**：ai↔character、time↔character 之间用回调注入解耦
- **单向依赖**：界面层 → 世界系统层 → 数据层 → AI 引擎

---

## 💬 四、聊天主流程

```
用户输入
   │
   ▼
┌────────────┐  记录时间 / 渲染消息 + 时间戳
│ sendMessage │───────────────┐
└────────────┘               │
   │                         ▼
   │                    深夜？ ──是──► "被吵醒，迷迷糊糊回应"（prompt 注入睡意）
   ▼                        │否
┌──────────────┐            ▼
│ chatWithDeepSeek │  组装 SYSTEM_PROMPT：
└──────────────┘  角色卡 + 38维数值 + 场景描述 + 记忆 + 剧情档案
   │
   ▼
AI 返回 JSON → 容错解析（提取{}块 → dialogue兜底 → 重试）
   │
   ▼
applyDelta 更新情感 → 写历史/记忆/事件 → saveState
   │
   ▼
typeReply 打字机渲染
   │
   ▼
┌──────────────┬──────────────┐
│ maybeDirector  │ maybeNpcIntervention│
│ (代码层trigger) │ (规则筛选NPC介入)   │
└──────────────┴──────────────┘
```

---

## 🎬 五、World Director（世界调度）

**原则**：不是聊天角色 · 只做决策 · 不每轮调用

```
触发源：长输入 / 情绪词 / 提到NPC / 跨天 / 离线30分钟 / 关系变化
   │
   ▼
detectTrigger（代码层，0成本）──普通聊天──► ✗ 不调用
   │ 命中
   ▼
callDirector（1次API）→ 世界快照 → AI 返回决策 JSON
   │
   ▼
normalizeDecision 校验（拦截非法NPC/维度/超范围delta）
   │
   ▼
executeDirectorDecision：
   ├─ story_event        → 剧情旁白 + 记档案
   ├─ npc_intervention   → 走 runNpcIntervention 渲染
   ├─ relationshipEffect → 改 38 维 / NPC 关系
   └─ memoryUpdate       → 记忆 save / forget
```

**输出格式**（严格 JSON）：
```json
{
  "needEvent": false,
  "eventType": "npc_intervention | story_event | world_event | none",
  "priority": "main | supporting | world",
  "npcId": "xiaoyu | null",
  "reason": "为什么",
  "relationshipEffect": { "target": "main|user|npc", "delta": 3 },
  "memoryUpdate": { "action": "save|forget", "content": "…" }
}
```

---

## 👥 六、NPC 介入（两层）

```
主角回复完成
   │
   ▼
多人模式开关？──关(默认)──► ✗ 纯二人世界
   │ 开
   ▼
① 规则筛选（0成本）：
   已在场? / 深夜睡着? / 6小时冷却? → 跳过
   打分：提到她+30 · 同场景+20 · 关系好+10 · 剧情相关+15 · 随机
   私密话题 → 分数归零
   │
   ▼
候选 ≥25分？
   ├─ 无 → ✗
   └─ 有 ──► ② 概率决定：min(55%, 20%+分数/100)，最多1个
                │ 命中
                ▼
          runNpcIntervention：
          入场 → npcSpeak（独立上下文：只给knownFacts+公开对话）
          → 渲染NPC消息（名字标签）→ 写历史（主角不失忆）
          → 情绪/记忆/关系/离场
          → 主角自然回应（消息90% / 现场60%）
```

---

## ⏰ 七、时间与场景

```
虚拟时钟 tickClock（速率可调）
   │
   ▼
scheduleIndexFor → 定位当前时段（作息表由场景驱动）
   │
   ▼
场景配置 store.scene：{ place, routine, others, busyLabel, restLabel }
   │
   ├─ 深夜     → 她睡着了，被吵醒迷糊回应
   ├─ 忙时段   → "在{place}{routine}，周围有{others}，压低声音说悄悄话"
   └─ 空闲     → 放松相处
   │
   ▼
sceneDescription → 注入 SYSTEM_PROMPT（你此刻的方位与交流方式）
```

---

## 🎭 八、角色创建向导

```
① 选预设（仁菜/小鲸）或 自定义
② 介绍她（自由文本）
③ 你们在哪里生活？她平时在做什么？（场景询问 → store.scene）
④ AI 访谈追问 / 降级补缺（无Key时只问基本信息）
⑤ 确认角色卡 → 保存
   └─ 按关系初始化情感（恋人≠陌生人）：initStateForRelation
```

---

## 💡 九、关键设计

| # | 设计 | 说明 |
|---|---|---|
| 1 | 回调注入解耦 | `setCharacterGetter` / `setRelationGetter` 避免循环依赖 |
| 2 | 成本控制 | Director 按 trigger 调用（0成本普通聊天）；NPC 先规则后概率 |
| 3 | 信息边界 | NPC 只知 `knownFacts`，prompt 注入 `presentContext` 收敛亲密话 |
| 4 | 防污染 | 角色加载以空模板为底，自定义不继承预设 |
| 5 | 场景化 | 学校等硬编码抽象为场景配置，创建角色时询问 |
| 6 | 关系驱动 | 恋人/朋友等关系有对应初始情感，恋人不会说"第一次见面" |
