# 🧠 Melody AI 项目架构分析

## 一、项目概况

**定位**：纯前端 AI 数字人情感陪伴应用（PWA + Capacitor Android APK）
**规模**：12 个 TS 模块，共约 4400 行
**技术栈**：Vite 5 + TypeScript（esbuild 转换）+ 原生 DOM + DeepSeek API + localStorage 存档

## 二、模块架构图

```mermaid
graph TD
    subgraph 入口层
        home[home.html 首页入口]
        menu[menu.html+menu.ts 存档列表/设置]
        chat[chat.html+chat.ts 聊天主界面]
    end

    subgraph 核心数据层
        state[state.ts<br/>38维情感状态机<br/>人格/关系/情绪/状态/阴影]
        storage[storage.ts<br/>5槽存档/NPC世界/场景配置]
        character[character.ts<br/>角色卡/预设/防污染加载]
    end

    subgraph 世界系统层
        time[time.ts<br/>虚拟时钟/场景作息/面对面]
        story[story.ts<br/>剧情阶段/档案/随机事件]
        npc[npc.ts<br/>支线角色/记忆/作息/关系]
        intervention[intervention.ts<br/>NPC介入-规则筛选层]
        director[director.ts<br/>World Director 世界调度]
        wizard[wizard.ts<br/>角色创建向导/场景询问]
    end

    subgraph AI 层
        ai[ai.ts<br/>DeepSeek直连/提示词/解析<br/>主角/NPC/访谈/Director共用]
    end

    chat --> state
    chat --> storage
    chat --> character
    chat --> ai
    chat --> director
    chat --> intervention
    chat --> wizard

    menu --> storage
    home --> chat

    ai --> state
    ai --> storage
    ai --> character
    ai --> time
    ai --> story

    time --> state
    time --> storage
    story --> state
    story --> storage
    story --> time

    npc --> state
    intervention --> storage
    intervention --> npc
    intervention --> time
    director --> storage
    director --> state
    director --> time
    director --> story
    director --> ai

    wizard --> character
    wizard --> ai
    wizard --> storage
    wizard --> state

    storage --> state
    storage --> npc
    character --> storage
```

## 三、核心设计：三层架构

| 层 | 职责 | 关键模块 |
|---|---|---|
| **界面层** | DOM 渲染、用户交互、打字机效果 | chat.ts / menu.ts |
| **世界系统层** | 时间/剧情/NPC/调度的"世界模拟" | time / story / npc / intervention / director |
| **数据层** | 38 维情感、存档、角色卡 | state / storage / character |

**AI 层是共用引擎**（ai.ts）——主角、NPC、角色访谈、World Director 四条调用链全部走它，只是提示词不同。

## 四、聊天主流程（用户发一条消息）

```mermaid
flowchart TD
    A[用户输入文本] --> B{sendMessage}
    B --> C[记录最后回复时间<br/>渲染用户消息+时间戳]
    C --> D{深夜?}
    D -- 是 --> D1[她睡着了→迷迷糊糊被吵醒<br/>prompt注入睡意]
    D -- 否 --> E[调 chatWithDeepSeek<br/>DeepSeek 直连]
    E --> F[SYSTEM_PROMPT 组装<br/>角色卡+38维数值+场景描述+在场者+记忆+档案]
    F --> G[AI 返回 JSON<br/>dialogue/delta/stats/memory/story]
    G --> H[parseAIResponse 容错解析<br/>提取{}块→dialogue兜底→重试]
    H --> I[applyDelta 应用情感变化<br/>+回归衰减]
    I --> J[写历史/记忆/剧情事件<br/>saveState 存档]
    J --> K[typeReply 打字机渲染]
    K --> L{主角回复完成}
    L --> M[maybeDirector<br/>代码层trigger判断]
    L --> N[maybeNpcIntervention<br/>规则筛选NPC介入]
```

## 五、World Director 世界调度（按需调用，非每轮）

```mermaid
flowchart TD
    A[用户消息/跨天/离线回归/关系变化] --> B{detectTrigger 代码层}
    B -- 普通聊天:短句/无情绪/无NPC --> X[✗ 不调用 Director<br/>0成本]
    B -- 命中:长输入/情绪词/提NPC/跨天/离线30分 --> C[callDirector<br/>1次API]
    C --> D[世界快照<br/>时间/场景/剧情/在场者/主角状态]
    D --> E[AI 决策 JSON<br/>needEvent/eventType/priority/npcId/relationshipEffect/memoryUpdate]
    E --> F{normalizeDecision 校验}
    F -- 非法字段 --> F1[拦截:不存在的NPC/非法维度/超范围delta]
    F -- 合法 --> G[executeDirectorDecision]
    G --> G1[story_event→剧情旁白+记档案]
    G --> G2[npc_intervention→走runNpcIntervention渲染]
    G --> G3[relationshipEffect→改38维/NPC关系]
    G --> G4[memoryUpdate→记忆save/forget]
```

## 六、NPC 动态介入（两层机制）

```mermaid
flowchart TD
    A[主角回复完成] --> B{多人模式开关<br/>store.npcEnabled}
    B -- 关(默认) --> X[✗ 不介入<br/>纯二人世界]
    B -- 开 --> C[第一层:screenNpcCandidates 规则筛选 0成本]
    C --> C1[已在场?跳过]
    C --> C2[深夜/睡着?跳过]
    C --> C3[6小时冷却?跳过]
    C --> C4[打分:提她+30/同场景+20/关系好+10/剧情相关+15/随机]
    C --> C5[私密话题?分数归零]
    C --> D[候选≥25分]
    D -- 无候选 --> X2[✗ 不介入]
    D -- 有候选 --> E[第二层:decideIntervention<br/>概率=min(55%, 20%+分数/100) 最多1个]
    E -- 未命中 --> X3[✗ 不介入]
    E -- 命中 --> F[runNpcIntervention]
    F --> F1[标记入场 presentNpcs]
    F --> F2[npcSpeak 独立上下文<br/>只给knownFacts+公开对话+场景]
    F --> F3[渲染NPC消息 蓝灰底+名字标签]
    F --> F4[写历史:主角不失忆]
    F --> F5[applyNpcResult<br/>情绪/记忆/关系/离场]
    F --> G[主角自然回应NPC<br/>消息90%/现场60%概率]
```

## 七、时间/场景驱动（面对面 + 作息）

```mermaid
flowchart LR
    A[虚拟时钟 tickClock<br/>速率0.01~100000] --> B[scheduleIndexFor<br/>按场景作息表定位时段]
    B --> C{时段}
    C -- 深夜 --> C1[她睡着<br/>被吵醒迷糊回应]
    C -- 忙时段(开店/上班/上课) --> C2[场景描述:压低声音说悄悄话<br/>周围有顾客/同事/同学]
    C -- 空闲/午休/晚上 --> C3[场景描述:放松相处]
    B --> D[sceneDescription<br/>场景驱动:咖啡店/公司/学校…]
    D --> E[注入 SYSTEM_PROMPT<br/>你此刻的方位与交流方式]
    A --> F[onSlotChanged<br/>按speakChance主动开口]
```

## 八、数据流全景

```
角色创建向导(wizard)               聊天交互(chat)
    │ 询问场景+关系                     │
    ▼                                  ▼
角色卡(character) + 场景配置(storage.scene)
    │                                  │
    ▼                                  ▼
38维情感(state) ←── AI决策/对话delta ←── DeepSeek(ai)
    │                                  │
    ▼                                  ▼
存档(storage 5槽) ──→ 时间线(time) ──→ 剧情(story)
    │                                  │
    ▼                                  ▼
NPC世界(npc) ←── 规则筛选(intervention) ←── Director调度(director)
```

## 九、关键设计亮点

1. **回调注入解耦**：ai↔character、time↔character 用 `setCharacterGetter`/`setRelationGetter` 避免循环依赖
2. **成本控制**：Director 只按 trigger 调用（普通聊天 0 成本）；NPC 先规则筛选（0 成本）再概率决定
3. **信息边界**：NPC 只知道 `knownFacts`（显式告知/在场听到），prompt 注入 `presentContext` 收敛亲密话
4. **防污染**：角色加载以空模板为底，自定义创建不继承预设；关系驱动情感初始化（恋人≠陌生人）
5. **场景系统**：所有"学校"硬编码抽象为场景配置，创建角色时询问"在哪生活/她平时做什么"
