// director.ts —— World Director Agent（世界调度层）
// 不是聊天角色：不生成聊天文本，只做"世界是否该变化"的智能决策。
// 只在代码层 trigger 命中时调用（不每轮调用）；普通聊天完全不经过 Director。
// 保留 intervention.ts 的第一层规则筛选；Director 只负责第二层智能决策。

import { store } from "./storage";
import { aiState, DIMENSIONS, describeMood } from "./state";
import { currentDayIndex, currentSchedule, fmtVirtualDate, fmtVirtualTime, herLocation, inSchool } from "./time";
import { storyStage, journalText } from "./story";
import { thinkingParams, API_BASE } from "./ai";

// ============ 触发条件（代码层，不消耗 API） ============

export type DirectorTrigger =
    | { type: "long-input"; text: string }
    | { type: "emotion"; text: string }
    | { type: "npc-mention"; text: string }
    | { type: "relation-shift" }
    | { type: "day-change"; oldDay: number; newDay: number }
    | { type: "offline-return"; idleMin: number };

// 长输入阈值：超过才认为"可能值得世界响应"
const LONG_INPUT_MIN = 40;

// 情绪关键词（轻量，不依赖 AI）
const EMOTION_WORDS: [RegExp, string][] = [
    [/喜欢|表白|爱|在一起|心动/, "affection"],
    [/生气|讨厌|滚|烦|混蛋|过分/, "anger"],
    [/难过|伤心|哭|委屈|疼|害怕/, "sadness"],
    [/担心|焦虑|怕|不安/, "anxiety"],
    [/开心|高兴|棒|太好|笑死/, "joy"],
    [/别的女生|别的女孩|别人|闺蜜|前女友|她们/, "jealousy"],
    [/礼物|送你|红包|钱|奖励/, "greed"],
];

// 判断某条用户输入是否命中情绪词
export function userInputEmotion(text: string): string | null {
    for (const [re, label] of EMOTION_WORDS) {
        if (re.test(text)) return label;
    }
    return null;
}

// 判断某条用户输入是否提到任何 NPC
export function userInputMentionsNpc(text: string): string | null {
    for (const npc of Object.values(store.npcs)) {
        if (npc.profile.keywords.some((k) => text.includes(k))) {
            return npc.profile.id;
        }
    }
    return null;
}

// 代码层 trigger：返回"这次用户消息是否值得让世界响应"（不消耗 API）
// 普通聊天 → 返回 null → 完全不调用 Director
export function detectTrigger(userText: string): DirectorTrigger | null {
    if (!userText || !userText.trim()) return null;

    const text = userText.trim();

    // 1. 输入超长
    if (text.length >= LONG_INPUT_MIN) return { type: "long-input", text };

    // 2. 情绪关键词命中
    if (userInputEmotion(text)) return { type: "emotion", text };

    // 3. 提到 NPC
    if (userInputMentionsNpc(text)) return { type: "npc-mention", text };

    // 4. 关系数值变化由外部（applyDelta 后）检查 delta 幅度传入
    // 5/6. 跨天 / 离线回归由外部直接构造 trigger 调用

    return null;
}

// ============ 世界状态快照（喂给 Director） ============

export function worldSnapshot(): string {
    const mainMood = describeMood();
    const stage = storyStage();
    const slot = currentSchedule();

    // 主角 38 维中"关系/情绪"层当前值（完整 38 维太长，只挑关键）
    const keyDims = DIMENSIONS.filter((d) =>
        ["relation", "emotion"].includes(d.group),
    ).map((d) => `${d.label}${Math.round(aiState[d.key])}`).join(" ");

    // NPC 简况
    const npcLine = Object.values(store.npcs).map((n) =>
        `${n.profile.name}(对主角${n.relToMain}/对用户${n.relToUser} 在${n.location} ${n.activity}${n.present ? " [在场]" : ""})`,
    ).join("；");

    const recent = store.chatHistory.slice(-6).map((e) =>
        `${e.role === "user" ? "用户" : "主角"}：${e.content.slice(0, 40)}`,
    ).join("\n");

    return [
        `【时间】第${currentDayIndex()}天 ${fmtVirtualDate()} ${fmtVirtualTime()} ${slot.label}，${slot.activity}。你们在一起（在${herLocation()}，面对面）。`,
        `【剧情阶段】${stage.name}（${stage.desc}）｜这段日子 ${store.storyProgress}%`,
        `【进行中的剧情线】${store.activeThread ?? "无"}`,
        `【主角状态】${mainMood}；关系/情绪维度：${keyDims}`,
        `【最近剧情档案】${journalText().split("\n").slice(0, 3).join("；")}`,
        `【在场者】${store.presentNpcs.length ? store.presentNpcs.map((id) => store.npcs[id]?.profile.name ?? id).join("、") : "只有用户和主角"}`,
        `【支线角色】${npcLine || "无"}`,
        `【最近对话】\n${recent}`,
    ].join("\n");
}

// ============ Director 决策 ============

// 事件优先级（从高到低）
export type DirectorPriority = "main" | "supporting" | "world";

export interface DirectorDecision {
    needEvent: boolean;
    eventType: "npc_intervention" | "story_event" | "world_event" | "none";
    priority: DirectorPriority;
    npcId: string | null;          // 参与的支线 NPC（无则 null）
    reason: string;                // 为什么发生/为什么是这位 NPC
    relationshipEffect: {
        target: "main" | "user" | "npc";   // 关系变化作用对象：主角对用户/用户对主角/NPC 与主角
        npcId?: string;                     // target="npc" 时指定
        delta: number;                      // -10 ~ 10
    } | null;
    memoryUpdate: { action: "save" | "forget"; content: string } | null;
}

export const DIRECTOR_PROMPT =
    "你是这个世界背后的【世界调度层】（World Director），不是聊天角色，不直接对用户说话，也不扮演任何角色。\n" +
    "你只负责判断：这个世界是否值得发生一点变化。你的决策必须服务于一个核心：**用户与主角的关系线是绝对主线**。\n\n" +
    "【角色定位铁律】\n" +
    "- 主角是唯一核心陪伴对象；所有 NPC 都是 support character（支线角色）。\n" +
    "- NPC 的作用：展示主角之外的世界、推动事件、提供朋友、熟人、家人关系、制造日常偶然、表现主角性格。\n" +
    "- 禁止：NPC 抢夺主角戏份、NPC 主动追求用户、NPC 与主角竞争用户、多个 NPC 形成恋爱路线、NPC 频繁打断用户与主角的聊天。\n\n" +
    "【关系系统限制】\n" +
    "- 主角与用户：可以完整成长（陌生→熟悉→信任→亲密），这是主要情感线路。\n" +
    "- NPC 与任何人：默认只能走向 陌生→认识→朋友→重要伙伴。\n" +
    "- NPC 可以对用户关心、帮助、开玩笑、普通朋友互动；**绝不能主动制造恋爱竞争或让 NPC 喜欢用户**。\n\n" +
    "【事件优先级】\n" +
    "最高：用户与主角的关系发展；第二：主角个人成长/情绪；第三：支线 NPC 事件；第四：背景世界事件。\n" +
    "NPC 事件若与主线冲突 → 放弃或延后，优先保证主角线。\n\n" +
    "【NPC 出现原则】\n" +
    "NPC 不是每轮出现。只有：与当前话题有关、对主角当前状态有帮助、对剧情有推动、自然符合时间地点——才允许。\n" +
    "最多选一个 NPC，宁缺毋滥；私密/亲密话题绝不介入。\n\n" +
    "【你的判断职责】\n" +
    "1. needEvent：是否值得发生一件事（环境变化/偶遇/日常/剧情推进）。普通寒暄不需要；情绪波动、提到他人、剧情节点、关键选择时才需要。\n" +
    "2. eventType：npc_intervention（NPC 参与）/ story_event（主线剧情事件）/ world_event（背景世界小事）/ none。\n" +
    "3. priority：main（服务主线）/ supporting（支线 NPC 事件）/ world（背景）。\n" +
    "4. relationshipEffect：这件事是否该让某段关系发生变化（delta -10~10）。target 是 main 表示「主角对用户」、user 表示「用户对主角」、npc 表示「指定 NPC 与主角」。默认 null（不变）。\n" +
    "5. memoryUpdate：主角是否该记住这件事（重要约定/秘密/里程碑）。普通聊天不记。\n\n" +
    "严格输出 JSON（不要任何其他文字）：\n" +
    '{"needEvent":false,"eventType":"none|npc_intervention|story_event|world_event","priority":"main|supporting|world","npcId":"角色id或null","reason":"为什么(20字内)",' +
    '"relationshipEffect":{"target":"main|user|npc","npcId":"target为npc时填角色id","delta":0}或null,"memoryUpdate":{"action":"save|forget","content":"记忆内容(20字内)"}或null}';

// 调用 Director（第二层智能决策，1 次 API）
export async function callDirector(trigger: DirectorTrigger): Promise<DirectorDecision> {
    const key = localStorage.getItem("deepseek-key")?.trim() ?? "";
    const model = localStorage.getItem("deepseek-model") ?? "deepseek-v4-flash";

    if (!key) {
        throw new Error("Director 需要 API Key");
    }

    const triggerText = (() => {
        switch (trigger.type) {
            case "long-input": return `触发原因：用户说了一段较长的话（${trigger.text.slice(0, 30)}…）`;
            case "emotion": return `触发原因：用户输入有情绪色彩（${trigger.text.slice(0, 30)}）`;
            case "npc-mention": return `触发原因：用户提到了角色（${trigger.text.slice(0, 30)}）`;
            case "relation-shift": return "触发原因：用户与主角的关系数值发生了明显变化";
            case "day-change": return `触发原因：跨天（第${trigger.oldDay}天 → 第${trigger.newDay}天）`;
            case "offline-return": return `触发原因：用户离开了一段时间（${trigger.idleMin} 分钟）后回来`;
            default: return "触发原因：世界状态变化";
        }
    })();

    const messages = [
        { role: "system", content: DIRECTOR_PROMPT },
        {
            role: "user",
            content:
                `${triggerText}\n\n` +
                `【当前世界状态】\n${worldSnapshot()}\n\n` +
                `请决定这个世界是否值得变化，严格按 JSON 输出你的决策。`,
        },
    ];

    const resp = await fetch(`${API_BASE}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, ...thinkingParams(), max_tokens: 1024 }),
    });

    const data = await resp.json();
    if (data.error) throw new Error(data.error.message ?? "Director 请求失败");

    const msg = data.choices?.[0]?.message ?? {};
    const content = typeof msg.content === "string" && msg.content.trim() ? msg.content : "";

    // 容错解析（与 parseAIResponse 同思路，但 Director 结构不同）
    if (content.trim()) {
        try {
            const parsed = JSON.parse(content);
            return normalizeDecision(parsed);
        } catch {
            const start = content.indexOf("{");
            const end = content.lastIndexOf("}");
            if (start !== -1 && end > start) {
                try {
                    return normalizeDecision(JSON.parse(content.slice(start, end + 1)));
                } catch {
                    /* fallthrough */
                }
            }
        }
    }

    // 解析失败 → 空决策（不改变世界）
    console.warn("Director 返回无法解析，忽略本次决策：", content.slice(0, 120));
    return emptyDecision();
}

// 规范化 + 校验（防止 AI 返回非法字段破坏世界状态）
function normalizeDecision(raw: any): DirectorDecision {
    const d: DirectorDecision = {
        needEvent: !!raw?.needEvent,
        eventType: "none",
        priority: "world",
        npcId: null,
        reason: typeof raw?.reason === "string" ? raw.reason.slice(0, 30) : "",
        relationshipEffect: null,
        memoryUpdate: null,
    };

    // eventType 校验
    if (d.needEvent && ["npc_intervention", "story_event", "world_event"].includes(raw?.eventType)) {
        d.eventType = raw.eventType;
    }

    // priority 校验
    if (["main", "supporting", "world"].includes(raw?.priority)) {
        d.priority = raw.priority;
    }

    // npcId：只允许存在的 NPC，且 NPC 不在场
    if (typeof raw?.npcId === "string" && raw.npcId) {
        const npc = store.npcs[raw.npcId];
        if (npc && !npc.present) {
            d.npcId = raw.npcId;
        }
    }

    // relationshipEffect：校验 target / delta 范围；target="npc" 时 npcId 必须合法
    if (raw?.relationshipEffect && typeof raw.relationshipEffect === "object") {
        const target = raw.relationshipEffect.target;
        const delta = Math.max(-10, Math.min(10, Number(raw.relationshipEffect.delta) || 0));
        if (["main", "user", "npc"].includes(target) && delta !== 0) {
            if (target !== "npc" || (typeof raw.relationshipEffect.npcId === "string" && store.npcs[raw.relationshipEffect.npcId])) {
                d.relationshipEffect = {
                    target,
                    npcId: target === "npc" ? raw.relationshipEffect.npcId : undefined,
                    delta,
                };
            }
        }
    }

    // memoryUpdate：主角记忆（save/forget）
    if (raw?.memoryUpdate && typeof raw.memoryUpdate === "object" && typeof raw.memoryUpdate.content === "string") {
        const content = raw.memoryUpdate.content.trim().slice(0, 60);
        if (content) {
            d.memoryUpdate = {
                action: raw.memoryUpdate.action === "forget" ? "forget" : "save",
                content,
            };
        }
    }

    return d;
}

export function emptyDecision(): DirectorDecision {
    return { needEvent: false, eventType: "none", priority: "world", npcId: null, reason: "", relationshipEffect: null, memoryUpdate: null };
}
