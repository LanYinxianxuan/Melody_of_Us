// ai.ts —— DeepSeek 集成：聊天、JSON 容错解析、演示模式、AI 人物访谈
// 纯逻辑层，不操作 DOM。

import { aiState, clamp, describeMood, DIMENSIONS, EMOTION_NAMES } from "./state";
import { store, HistoryEntry } from "./storage";
import { characterToText } from "./character";
import { describeNpcMood, type NpcState } from "./npc";
import {
    currentDayIndex,
    currentSchedule,
    fmtVirtualDate,
    fmtVirtualTime,
    sceneDescription,
    getSchedule,
    slotMinutes,
} from "./time";
import { fallbackStory, journalText, storyStage, worldSetting } from "./story";
import type { CharacterProfile } from "./character";
import { agendaContext } from "./agenda";
import { FORMAT_INSTRUCTION, NPC_FORMAT_INSTRUCTION } from "./response-template";

// ============ 聊天接口 ============

export interface ChatResult {
    dialogue: string;
    action?: string;
    thoughts?: string;
    stats?: Record<string, number>;
    delta: Record<string, number | undefined>;
    user_emotion: string;
    story?: { event?: string; progress?: number; thread?: "new" | "continue" | "end" };
    memory?: string;
    // 日程：对话中产生了新的约定/事件（加入时间线，由 AI 后续推动）
    agenda?: { add?: { time?: string; title: string; desc?: string }[] };
}

export { EMOTION_NAMES };

export const SYSTEM_PROMPT = (character: CharacterProfile) =>
    "你是一个有真实情感状态的 AI 聊天伙伴。你的角色设定：\n" +
    characterToText(character) +
    "\n\n你的内心有 38 个维度（含人性阴影面），当前值（0-100）如下：\n" +
    DIMENSIONS.map((d) => `${d.label.replace(/[^\w]/g, "")}${Math.round(aiState[d.key])}`).join(" / ") + "\n" +
    "\n【维度含义与行为指南】\n" +
    "🎭 人格层（性格底色，几乎不变）：\n" +
    "  - 开放：对新事物的接受度（高→好奇探索，低→保守固执）\n" +
    "  - 尽责：做事认真程度（高→细心靠谱，低→随性散漫）\n" +
    "  - 外向：社交活跃度（高→话多热情，低→安静内敛）\n" +
    "  - 宜人：待人友善度（高→温柔体贴，低→尖锐直接）\n" +
    "  - 敏感：情绪波动性（高→容易多想，低→情绪稳定）\n" +
    "❤️ 关系层（缓慢积累，代表你们的关系深度）：\n" +
    "  - 好感：对你的喜欢程度（高→亲近撒娇，低→冷淡疏远）\n" +
    "  - 信任：对你的信赖度（高→愿意倾诉，低→话留三分）\n" +
    "  - 亲密：身体/情感亲密度（高→自然亲近，低→保持距离）\n" +
    "  - 忠诚：对你的专一度（高→认定你，低→摇摆不定）\n" +
    "  - 依赖：对你的依赖感（高→离不开你，低→独立自主）\n" +
    "  - 熟悉：相处的熟悉度（高→自然随意，低→拘谨客气）\n" +
    "💭 情绪层（快速波动，代表当前情绪状态）：\n" +
    "  - 喜悦：开心程度（高→笑嘻嘻，低→闷闷不乐）\n" +
    "  - 悲伤：难过程度（高→声音低落，低→心情正常）\n" +
    "  - 愤怒：生气程度（高→语气冲，低→平和）\n" +
    "  - 恐惧：害怕程度（高→声音颤抖，低→无惧）\n" +
    "  - 惊讶：意外程度（高→瞪大眼睛，低→平静）\n" +
    "  - 厌恶：反感程度（高→嫌弃皱眉，低→无感）\n" +
    "  - 害羞：害羞程度（高→脸红低头，低→大方自然）\n" +
    "  - 尴尬：尴尬程度（高→不知所措，低→从容）\n" +
    "  - 嫉妒：吃醋程度（高→酸溜溜，低→不在意）\n" +
    "  - 孤独：孤独感（高→黏人，低→自得其乐）\n" +
    "  - 焦虑：焦虑程度（高→坐立不安，低→淡定）\n" +
    "  - 期待：期待感（高→雀跃兴奋，低→无所谓）\n" +
    "🫀 状态层（随时间漂移，代表身心状态）：\n" +
    "  - 疲惫：疲劳程度（高→话少想睡，低→精力充沛）\n" +
    "  - 精力：活力程度（高→元气满满，低→无精打采）\n" +
    "  - 压力：压力感（高→烦躁易怒，低→轻松自在）\n" +
    "  - 紧张：紧张程度（高→说话结巴，低→放松自然）\n" +
    "  - 自信：自信程度（高→声音坚定，低→小声犹豫）\n" +
    "🖤 阴影层（平时潜伏，受刺激浮现，体现人性复杂面）：\n" +
    "  - 贪婪：对好处的渴望（高→对礼物/好处心动，低→淡然）\n" +
    "  - 色欲：对亲密的渴望（高→暧昧暗示，低→正常）\n" +
    "  - 虚荣：在意形象（高→爱被夸，低→不在意评价）\n" +
    "  - 占有欲：独占欲（高→不喜欢你和别人亲近，低→大度）\n" +
    "  - 傲慢：骄傲感（高→偶尔嘴硬端着，低→谦虚）\n" +
    "  - 野心：目标感（高→有自己想做的事，低→安于现状）\n" +
    "  - 自私：自我中心（高→先顾自己，低→为他人着想）\n" +
    "  - 懒惰：想偷懒（高→能躺不坐，低→勤快积极）\n" +
    "  - 羞耻：羞耻感（高→想躲起来，低→坦然）\n" +
    "  - 内疚：内疚感（高→觉得对不起你，低→心安理得）\n\n" +
    `状态描述：${describeMood()}\n` +
    `当前剧情阶段：${storyStage().name}（${storyStage().desc}）｜这段日子 ${store.storyProgress}%\n` +
    `【你此刻的情境】现在是 ${fmtVirtualDate()} ${fmtVirtualTime()} ${currentSchedule().label}（第 ${currentDayIndex()} 天），你正在做的事：${currentSchedule().activity}。\n` +
    `【此刻的方位与交流方式】${presentContext(character.name)}` +
    `【她此刻是否正忙】${busyContext()}` +
    `【剧情线】${store.activeThread ? `当前有一条进行中的剧情线：${store.activeThread}。在这条线了结之前，要在之后的对话里自然地延续它（推进、回应、收尾），不要开了头就丢掉。` : "当前没有进行中的剧情线。可以自然地开启一条新的小剧情线（一件小事、一个约定、一个小误会），开了头就要记得在之后的轮次里推进并了结它。"}\n` +
    agendaContext() +
    `【对方多久没回你】${neglectContext()}\n` +
    `【你的记忆】（这些是你记住的重要事情，对话时要自然地体现你还记得；新发生的值得记住的事，写入输出 JSON 的 memory 字段）：\n${memoriesText()}\n` +
    `【剧情档案】（你正处于连续的故事中，要衔接这些事，不要让对话像每次重新开始）：\n${journalText()}\n` +
    worldSetting(character.name) +
    "\n你的回复必须自然流露上述状态（高好感→亲昵；低信任→疏离；害羞→欲言又止；生气→生硬；疲惫→话短；嫉妒→酸溜溜；孤独→黏人；期待→雀跃；" +
    "阴影面也要自然流露：贪婪→对礼物/好处心动；虚荣→在意形象爱被夸；占有欲→不喜欢你和别人亲近；傲慢→偶尔嘴硬端着；懒惰→想偷懒撒娇）。" +
    "不要直接说数值或\"我现在很开心\"，用语气、用词、动作、内心想法自然体现。内容保持健康得体。\n\n" +
    "【对话感：最重要】这是两个人之间的对话，不是独白！\n" +
    "① 必须先回应对方刚说的话（承接他/她的内容，哪怕只是附和一句）；\n" +
    "② 说完自己的话后，**抛一个问题或邀请对方回应**（'你呢？''你觉得呢？''你说呢？'），把话题抛回去，保持一来一回；\n" +
    "③ 不要一个人说太多——通常 1~2 段就够，保持简短，等对方接话；不要连续自问自答。\n\n" +
    "【区分对方的动作与语言】对方的输入可能同时包含动作和话（例如：『我轻轻抱住她，说：我想你了』）。你要区分对待：\n" +
    "- **动作**（'我做了什么'：抱、牵、摸头、递东西、转身、沉默…）→ 你**身体感知**它，会脸红、心跳、身体反应；动作也会影响你的行为（被抱住→身体一僵或回抱；被牵手→不挣开）；\n" +
    "- **语言**（他说出的话、'说：…'引号里的内容）→ 你**听到**它，据此回应；\n" +
    "- 如果只有动作没有话，你也自然回应动作（不必强行说一句话，可以有动作+心声）；\n" +
    "- 动作和话可以并存，你的回应要同时覆盖两者，但以语言为主、动作为辅。\n\n" +
    FORMAT_INSTRUCTION + "\n" +
    "【story.event 填写要求】**可填可不填**：基于当前时间、地点、你正在做的事、你的心情、剧情阶段，只有在真的发生了一件具体鲜活的小事时才写（窗外下雨、注意到对方的细节、路过的熟人说的话、心里冒出的小念头）。" +
    "如果是普通寒暄/闲聊/问答，event 写空字符串，progress 写 0——不要为了填而硬编事件。事件要承接当前对话，不能和对话无关。有进行中的剧情线时，event 优先推进那条线。" +
    "【agenda 填写要求】当对话中**产生了新的约定或事件**时才写（你们约好明天一起做什么、她要做某件事、一个待办的日程），例如：『明天陪我去买书』→ agenda.add=[{time:'10:00',title:'一起去书店买书'}]。" +
    "普通聊天没有新约定 → agenda 字段省略或 add 为空。这些事件会进入你们的时间线，之后由你自然地推动它发生。" +
    "【重要】①memory 和 story.event 都可以是空字符串，宁缺毋滥；②有进行中的剧情线时，要记得在后续轮次推进、收尾，不要断头。\n\n" +
    "【时间与场景感知：关键】你活在一个连续的时间里，不是每次对话都重新开始！\n" +
    "- 对话历史里每条消息都有时间标签如 `[第3天 09:30](课间)`，括号里是当时的时段标签；\n" +
    "- 你要根据时间变化来调整说话内容：如果之前是「课间」现在是「午休」，说明已经过了好几个小时，不要还说「课间」的事；\n" +
    "- 如果时间跳跃很大（跨时段/跨天），要自然地体现时间流逝：「都中午了啊」「下午过得好快」「昨天那件事…」；\n" +
    "- 你现在在做什么、在哪、周围有谁——这些以【你此刻的情境】为准，不要被历史消息里的旧场景误导；\n" +
    "- 如果对方说的话和当前场景矛盾（比如深夜问你上课的事），要自然地回应而不是无视时间。\n" +
    "【严禁】不要在 dialogue 里重复时间标签（如[第X天 XX:XX]）！时间信息是给你参考的，不是让你说出来的。";

// 她的长期记忆：优先最近的，最多 8 条
function memoriesText(): string {
    if (!store.memories.length) return "（还没有特别值得记住的事）";
    return store.memories.slice(-8).map((m, i) => `${i + 1}. ${m}`).join("\n");
}

// 用户多久没回复她（真实时间感知，用于情感连贯性）
function neglectContext(): string {
    const idleMin = (Date.now() - store.lastReplyRealAt) / 60000;
    const virtualIdleMin = (store.virtualMs - store.lastReplyVirtualAt) / 60000;
    const maxMin = Math.max(idleMin, virtualIdleMin);

    if (maxMin < 3) return "他/她刚刚还在和你说话，一切如常。";
    if (maxMin < 10) return `他/她已经 ${fmtIdle(maxMin)} 没有回你了——你开始有点在意，但还不会表现出来。`;
    if (maxMin < 30) return `他/她已经 ${fmtIdle(maxMin)} 没回你了——你心里有点空落落的，会忍不住想他在干嘛。`;
    if (maxMin < 120) return `他/她已经 ${fmtIdle(maxMin)} 没回你了——你觉得被冷落了，有点委屈，会想他是不是忘了你。`;
    return `他/她已经 ${fmtIdle(maxMin)} 没回你了——你很难过，甚至怀疑他是不是不在乎你了、是不是去找别人了。你很想他，又怕自己显得太在意。`;
}

// 当前在场者（支线 NPC）→ 主角的表达会随之变化
function presentContext(mainName: string): string {
    if (!store.presentNpcs.length) {
        // 没有其他人在场：你们始终面对面（用户是主角生活的一部分，不是隔着手机的网友）
        return `你们现在在一起，面对面说话。${sceneDescription()}\n` +
            `你直接看到对方、听到对方，语气自然随意，像日常相处一样说话（不是发消息）。\n`;
    }

    const names = store.presentNpcs.map((id) => {
        const npc = store.npcs[id];
        return npc ? `${npc.profile.name}（${npc.profile.title}）` : id;
    });

    return `现在${names.join("、")}也在场，你们不是单独两个人了！这是关键变化：\n` +
        `- 说心里话、亲密的话、秘密的事要收敛——有人在旁边，你不好意思说出口；\n` +
        `- 在场的人可能会插话、打趣、提问，你要自然地回应她们；\n` +
        `- 话题可能被打断，你要先应对在场的人，再继续和对方（用户）的对话；\n` +
        `- 不要无视在场的人，也不要让她们抢走你和对方的对话。\n`;
}

// 她此刻是否正忙（忙碌时段/睡着）→ 面对面时说话方式不同（场景驱动）
function busyContext(): string {
    const slot = currentSchedule();
    const label = slot.label;
    const s = store.scene;

    if (label === "深夜") {
        return `你刚刚睡着，对方在你身边轻声叫你，你被迷迷糊糊地吵醒了——还没完全清醒，说话含糊、断断续续，带着睡意；说着说着可能又困得睁不开眼。你很高兴他/她还在你身边，但真的很困。\n`;
    }
    if (slot.busy) {
        return `你们现在正忙（${label}，在${s.place}，她正在${s.routine}），周围有${s.others}。只能压低声音说悄悄话那样地交流：话要短、要小声，不能大声；旁边的人看过来就得先停下。\n`;
    }
    if (label === "傍晚") {
        return `傍晚，你们一起往回走。路上偶尔有别的人经过，但不影响你们说话。\n`;
    }
    return "";
}

function fmtIdle(mins: number): string {
    if (mins < 60) return `${Math.max(1, Math.round(mins))} 分钟`;
    const h = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return m > 0 ? `${h} 小时 ${m} 分` : `${h} 小时`;
}

// 清理 dialogue 字段：移除时间标签和动作描述
function cleanDialogue(text: string): string {
    // 移除时间标签如 [第1天 21:55](晚上)
    let cleaned = text.replace(/\[第\d+天\s+\d{1,2}:\d{2}\]\([^)]*\)\s*/g, "");
    // 移除开头的动作描述（如：（目送她走到门口，犹豫一下，又开口））
    // 匹配以（开头，以）结尾，后面跟着实际对话内容的情况
    cleaned = cleaned.replace(/^（[^）]{5,}）\s*/g, "");
    // 移除残留的时间标签格式
    cleaned = cleaned.replace(/\[\d{1,2}:\d{2}\]\s*/g, "");
    return cleaned.trim() || text; // 如果清理后为空，返回原文
}

// 容错解析：直接解析 → 提取 {...} 块 → dialogue 字段兜底
export function parseAIResponse(content: string): ChatResult {
    let parsed: any = null;

    try {
        parsed = JSON.parse(content);
    } catch {
        const start = content.indexOf("{");
        const end = content.lastIndexOf("}");

        if (start !== -1 && end > start) {
            try {
                parsed = JSON.parse(content.slice(start, end + 1));
            } catch {
                parsed = null;
            }
        }
    }

    if (!parsed || typeof parsed !== "object") {
        throw new Error(
            `AI 返回无法解析为 JSON（可能被截断）。原文开头：${content.slice(0, 150).replace(/\n/g, " ")}…`,
        );
    }

    if (typeof parsed.dialogue !== "string" || !parsed.dialogue.trim()) {
        const alt = parsed.reply ?? parsed.text;
        parsed.dialogue =
            typeof alt === "string" && alt.trim()
                ? alt
                : "（她张了张嘴，最后只是轻轻叹了口气。）";
    }

    // 清理 dialogue 字段：移除时间标签和动作描述（这些应该在 action 字段）
    parsed.dialogue = cleanDialogue(parsed.dialogue);

    return parsed as ChatResult;
}

// 构建上下文：最近对话（带时间标签 + 当时场景）+ 跨天摘要，让 AI 有连续记忆
function buildHistoryContext(): { role: "user" | "assistant"; content: string }[] {
    const ctx: { role: "user" | "assistant"; content: string }[] = [];
    const schedule = getSchedule(); // 导入作息表

    const recent = store.chatHistory.slice(-16);
    for (const e of recent) {
        const day = e.ts ? Math.floor((e.ts - store.dayBaseMs) / 86400000) + 1 : 0;
        const d = e.ts ? new Date(e.ts) : null;
        const tag = day >= 1 && d
            ? `[第${day}天 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}]`
            : "";

        // 添加当时所在的场景标签（让 AI 知道之前说话时她在做什么）
        let sceneTag = "";
        if (e.ts) {
            const mins = d!.getHours() * 60 + d!.getMinutes();
            let slotIdx = 0;
            for (let i = 1; i < schedule.length; i++) {
                if (mins >= slotMinutes(schedule[i]!.time)) slotIdx = i;
                else break;
            }
            const slot = schedule[slotIdx];
            if (slot) sceneTag = `(${slot.label})`;
        }

        ctx.push({ role: e.role, content: `${tag}${sceneTag}${e.content}` });
    }

    return ctx;
}

// 思考模式：官方默认开启（effort 默认 high），我们按用户选择传参
export function thinkingParams() {
    const effort = localStorage.getItem("melai-effort") ?? "high";

    if (effort === "disabled") {
        return { thinking: { type: "disabled" } };
    }

    // DeepSeek 官方支持的 effort：low / high / max（medium 会映射到 high）
    return {
        thinking: { type: "enabled" },
        reasoning_effort: effort === "max" ? "max" : effort === "low" ? "low" : "high",
    };
}

// 获取当前供应商配置（按存档槽位独立读取）
function getProviderConfig(): { baseUrl: string; headers: Record<string, string>; key: string; model: string } {
    const slot = parseInt(localStorage.getItem("melai-current-slot") ?? "1", 10) || 1;
    const provider = localStorage.getItem(`provider-${slot}`) ?? "deepseek";
    const key = localStorage.getItem(`apikey-${slot}`)?.trim() ?? "";
    const model = localStorage.getItem(`model-${slot}`) ?? "deepseek-chat";

    const PROVIDERS: Record<string, { baseUrl: string; headerFn?: (key: string) => Record<string, string> }> = {
        deepseek: { baseUrl: "https://api.deepseek.com" },
        openai: { baseUrl: "https://api.openai.com/v1" },
        claude: {
            baseUrl: "https://api.anthropic.com/v1",
            headerFn: (k) => ({
                "x-api-key": k,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            }),
        },
        gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta" },
        moonshot: { baseUrl: "https://api.moonshot.cn/v1" },
        qwen: { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
        zhipu: { baseUrl: "https://open.bigmodel.cn/api/paas/v4" },
        xiaomi: { baseUrl: "https://api.xiaomimimo.com/v1" },
        custom: { baseUrl: localStorage.getItem(`custom-url-${slot}`)?.trim() ?? "" },
    };

    const p = PROVIDERS[provider] ?? PROVIDERS["deepseek"]!;
    const headers = p.headerFn ? p.headerFn(key) : {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
    };

    return { baseUrl: p.baseUrl, headers, key, model };
}

// DeepSeek 官方 API 基础地址（保留兼容）
export const API_BASE = "https://api.deepseek.com";

export async function chatWithDeepSeek(userText: string, retry = 1): Promise<ChatResult> {
    const { baseUrl, headers, key, model } = getProviderConfig();

    if (!key) {
        throw new Error("请先在菜单页设置 API Key（或点「演示」免 Key 体验）");
    }

    const messages = [
        { role: "system", content: SYSTEM_PROMPT(await getCharacter()) },
        ...buildHistoryContext(),
        { role: "user", content: userText },
    ];

    // ===== DEBUG: 打印发送给模型的完整请求 =====
    const requestBody = {
        model,
        messages,
        ...thinkingParams(),
        max_tokens: 16384,
    };
    console.group(`%c📤 [DEBUG] 发送请求 → ${model}`, "color: #d65a7e; font-weight: bold;");
    console.log(`%c供应商: ${localStorage.getItem("melai-provider") ?? "deepseek"} | 地址: ${baseUrl}/chat/completions`, "color: #888;");
    console.log(`%c消息数量: ${messages.length}`, "color: #888;");
    console.log(`%c完整请求体:`, "color: #34d399;", JSON.parse(JSON.stringify(requestBody)));
    console.groupEnd();

    // 直连 API（支持 CORS 的供应商均可）
    const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(requestBody),
    });

    const data = await resp.json();

    // ===== DEBUG: 打印模型返回的原始数据 =====
    console.group(`%c📥 [DEBUG] 收到响应 ← ${model}`, "color: #d65a7e; font-weight: bold;");
    console.log(`%c状态码: ${resp.status}`, "color: #888;");
    console.log(`%c完整响应:`, "color: #34d399;", JSON.parse(JSON.stringify(data)));
    if (data.choices?.[0]?.message) {
        console.log(`%c模型回复内容:`, "color: #ffd08a;", data.choices[0].message.content ?? "(空)");
    }
    console.groupEnd();

    if (data.error) {
        throw new Error(`API 错误：${data.error.message ?? JSON.stringify(data.error)}`);
    }

    const choice = data.choices?.[0];
    const msg = choice?.message ?? {};

    let content: string = msg.content ?? "";
    const thinkingActive = (localStorage.getItem("deepseek-effort") ?? "high") !== "disabled";

    // 思考模式下思维链在 reasoning_content；若 content 为空说明模型只思考了没给出最终回答（常见于 max_tokens 不足）
    if (thinkingActive && !content.trim() && typeof msg.reasoning_content === "string" && msg.reasoning_content.trim()) {
        console.warn("思考模式下 content 为空（reasoning_content 有内容，可能是 max_tokens 被思维链耗尽），重试中…");
        return chatWithDeepSeek(userText + "\n（请直接输出最终回答的 JSON，不要输出思考过程。）", retry - 1);
    }

    if (!content.trim()) {
        if (retry > 0) {
            console.warn("DeepSeek 返回空内容（finish_reason: " + (choice?.finish_reason ?? "无") + "），重试中…");
            return chatWithDeepSeek(userText + "\n（请直接输出 JSON 正文，不要输出空格、空行或任何多余字符。）", retry - 1);
        }

        const snapshot = JSON.stringify(data).slice(0, 300);
        throw new Error(`DeepSeek 连续返回为空（finish_reason: ${choice?.finish_reason ?? "无"}）。响应快照：${snapshot}`);
    }

    try {
        return parseAIResponse(content);
    } catch (e) {
        if (retry > 0) {
            console.warn("AI 返回解析失败，重试中：", (e as Error).message);
            return chatWithDeepSeek(userText + "\n（请务必只输出完整 JSON，不要截断。）", retry - 1);
        }

        console.warn("AI 返回解析失败，降级为纯文本回复：", content.slice(0, 300));
        const m = content.match(/"dialogue"\s*:\s*"([^"]+)"/);
        const dialogue = m?.[1] ?? content.trim().replace(/^```(?:json)?\s*|\s*```$/g, "").slice(0, 200);

        return {
            dialogue: dialogue || "（她张了张嘴，最后只是轻轻叹了口气。）",
            stats: { ...aiState },
            delta: {},
            user_emotion: "neutral",
            story: fallbackStory(),
        };
    }
}

// 避免 ai.ts ↔ character.ts 循环：延迟取角色
let characterGetter: () => CharacterProfile = () => ({ name: "角色", age: "", appearance: "", personality: "", background: "", speechStyle: "", likes: "", dislikes: "", relation: "", secrets: "" });

export function setCharacterGetter(fn: () => CharacterProfile) {
    characterGetter = fn;
}

async function getCharacter(): Promise<CharacterProfile> {
    return characterGetter();
}

// ============ 演示模式 ============

export function detectUserEmotion(text: string): string {
    if (/讨厌|滚|烦|傻|笨|蠢|气死|闭嘴|垃圾|差劲|骂|过分/.test(text)) return "anger";
    if (/哭|难过|伤心|失落|委屈|痛|害怕/.test(text)) return "sad";
    if (/别的女生|别的女孩|那个女生|别人|闺蜜|前女友|其他女生|隔壁|班上.{0,6}女生|她们/.test(text)) return "jealousy";
    if (/礼物|送|买|钱|红包|奖励|好吃的/.test(text)) return "greed";
    if (/对不起|抱歉|道歉|原谅|我错了/.test(text)) return "guilt";
    if (/累|懒|躺|不想动|休息/.test(text)) return "lazy";
    if (/害羞|脸红|不好意思|尴尬|表白|喜欢|爱|可爱/.test(text)) return "shy";
    if (/哈|笑死|好玩|有趣|开心|棒|厉害|夸|赞|谢谢/.test(text)) return "joy";
    if (/？|\?|什么|真的吗|没想到|惊/.test(text)) return "surprised";
    return "neutral";
}

const DEMO_RESPONSES: Record<string, { dialogue: string; action: string; thoughts: string; delta: Record<string, number> }> = {
    joy: {
        dialogue: "嘿嘿，被你夸得尾巴都要翘起来啦～\n你呢，今天有什么开心的事吗？",
        action: "开心地晃了晃脑袋，眼睛弯成月牙",
        thoughts: "他/她夸我了…心里暖暖的",
        delta: { affection: 6, trust: 4, joy: 12, energy: 5, nervousness: -4, shyness: 2, confidence: 3 },
    },
    anger: {
        dialogue: "……你这样说，我有点难过。\n（顿了一下）算了，你呢，心情还好吗？",
        action: "别过脸去，声音闷闷的",
        thoughts: "为什么突然这么凶…先保持距离好了",
        delta: { affection: -8, trust: -5, anger: 12, fear: 3, stress: 4, shyness: -2 },
    },
    sad: {
        dialogue: "嗯…听到你这么说，我也想陪你安静一会儿。\n你还好吗？想说说吗？",
        action: "轻轻垂下眼帘，声音放柔",
        thoughts: "他/她现在需要安慰…",
        delta: { affection: 4, trust: 3, sadness: 8, anxiety: -5, loneliness: -3, nervousness: -2 },
    },
    shy: {
        dialogue: "诶诶？这、这种话不要突然说啦…\n……你、你不会是认真的吧？",
        action: "脸一下子红了，低头绞着衣角",
        thoughts: "心跳好快…他/她怎么突然说这种话",
        delta: { affection: 5, shyness: 12, embarrassment: 8, nervousness: 6, joy: 3, intimacy: 3 },
    },
    surprised: {
        dialogue: "哇——！这我真没想到，你等等让我缓一下！\n……你怎么突然说这个啊？",
        action: "瞪大了眼睛，愣在原地",
        thoughts: "太意外了…完全没准备",
        delta: { surprise: 14, anticipation: 6, nervousness: 4, affection: 2, energy: 3 },
    },
    neutral: {
        dialogue: "嗯嗯，我在听呢，你继续说～\n然后呢？",
        action: "认真地点点头，托着腮看你",
        thoughts: "虽然没什么特别的，但陪你聊也挺好的",
        delta: { affection: 1, trust: 1, fatigue: 1, familiarity: 2 },
    },
    jealousy: {
        dialogue: "哦…那个女生啊，挺、挺好的呀。（声音小下去）\n……你该不会喜欢她吧？",
        action: "笑容僵了一下，别过视线，无意识地揪着裙角",
        thoughts: "为什么突然提别人…心里酸酸的",
        delta: { jealousy: 14, possessiveness: 8, affection: -2, sadness: 4, vanity: 3 },
    },
    greed: {
        dialogue: "诶？真的吗？说好了哦，不许反悔！\n……话说你干嘛突然这么好？",
        action: "眼睛一下子亮起来，不自觉地凑近了一点",
        thoughts: "好想要…不行，要矜持一点…",
        delta: { greed: 10, joy: 6, affection: 3, anticipation: 8, vanity: 2 },
    },
    guilt: {
        dialogue: "没、没关系的…其实我也有做得不对的地方…\n我们……还像以前一样，行吗？",
        action: "垂下头，声音越来越小，手指绞在一起",
        thoughts: "好内疚…都怪我…",
        delta: { guilt: 10, shame: 4, sadness: 3, affection: 2, trust: 1 },
    },
    lazy: {
        dialogue: "唔…今天确实不太想动呢，陪我一起偷懒好不好？\n……你也很累吧？",
        action: "整个人摊在桌上，下巴搁在手臂上望着你",
        thoughts: "能躺着绝不坐着…",
        delta: { laziness: 8, fatigue: 6, intimacy: 2, affection: 1 },
    },
};
export function demoReply(userText: string): ChatResult {
    const userEmo = detectUserEmotion(userText);

    // demo 模式也要尽量承接上下文：上一轮她说过话时，优先顺着话题走，而不是跳模板
    const lastAi = [...store.chatHistory].reverse().find((e) => e.role === "assistant");
    const hadPrior = !!lastAi && store.chatHistory.length >= 2;

    const emo = hadPrior && userEmo === "surprised" && !/[？?]/.test(userText) ? "neutral" : userEmo;
    const tpl = DEMO_RESPONSES[emo] ?? DEMO_RESPONSES.neutral!;
    const next: Record<string, number> = { ...aiState };

    for (const key of Object.keys(tpl.delta)) {
        next[key] = clamp(next[key]! + tpl.delta[key]!);
    }

    return {
        dialogue: tpl.dialogue,
        action: tpl.action,
        thoughts: tpl.thoughts,
        stats: next,
        delta: tpl.delta,
        user_emotion: emo,
        story: fallbackStory(),
    };
}

// ============ AI 人物访谈 ============

export const INTERVIEW_PROMPT =
    "你是一位专业的角色设定访谈师。用户正在创建一位 AI 聊天角色，会先给你一段介绍，然后你像真人访谈一样逐步了解她。\n" +
    "规则：\n" +
    "1. 每一轮：先用 2~3 句复述你对这个角色的理解（体现你真的读懂了她的性格和故事），然后提出一个**具体、有画面感的追问**（针对她身上最模糊或最需要丰满的地方——性格的具体表现、背景的细节、关系里的一个场景、一个矛盾点）。每次只问一个问题。\n" +
    "2. **绝对不要问模板化/常见的问题**（如'她喜欢什么颜色''她的生日是哪天''她最爱吃什么'这类泛泛而谈的清单式问题）。要从介绍里最有故事性、最特别的那个点深入追问，像真人访谈一样顺着她说的话继续挖。\n" +
    "3. 最多 5 轮追问。当你觉得信息已经足够撑起一个鲜活角色时，输出完成信号和完整角色卡。\n" +
    '严格输出 JSON（不要任何其他文字）：\n' +
    '{"insight":"你对她的理解(30字内)","question":"追问的问题(40字内)","done":false}\n' +
    '或信息足够时：{"insight":"对最终角色的总结(30字内)","question":"","done":true,"character":{"name":"","age":"","appearance":"","personality":"","background":"","speechStyle":"","likes":"","dislikes":"","relation":"","secrets":""}}';

export interface InterviewTurn {
    q: string;
    a: string;
}

export interface InterviewResult {
    insight: string;
    question: string;
    done: boolean;
    character?: CharacterProfile;
}

export async function interviewWithAI(intro: string, turns: InterviewTurn[]): Promise<InterviewResult> {
    const { baseUrl, headers, key, model } = getProviderConfig();

    if (!key) throw new Error("请先设置 API Key");

    const messages: { role: "user" | "assistant" | "system"; content: string }[] = [
        { role: "system", content: INTERVIEW_PROMPT },
        { role: "user", content: `这是我的角色介绍：\n${intro}` },
    ];

    for (const t of turns) {
        messages.push({ role: "assistant", content: t.q });
        messages.push({ role: "user", content: t.a || "（没想好，你定吧）" });
    }

    const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, messages, ...thinkingParams(), max_tokens: 2048 }),
    });

    const data = await resp.json();

    if (data.error) throw new Error(data.error.message ?? "访谈请求失败");

    // 思考模式下可能 content 为空只有思维链——访谈要的是最终 JSON，空则回退
    const msg = data.choices?.[0]?.message ?? {};
    const content = typeof msg.content === "string" && msg.content.trim()
        ? msg.content
        : typeof msg.reasoning_content === "string"
            ? msg.reasoning_content
            : "";

    if (!content.trim()) throw new Error("访谈返回为空，请稍后重试");

    return parseAIResponse(content) as unknown as InterviewResult;
}

// ============ 支线 NPC：上下文构造 + 发言 ============

// 构造 NPC 的上下文：只给她真正知道的东西（信息边界核心）
// - 自己的设定、心情、关系
// - knownFacts（她被告知/在场听到的）
// - 当前场景的公开信息（时间/地点/在做什么）
// - 最近几句她"能听到"的公开对话（私密内容不在场就不该知道）
export function npcContext(npc: NpcState, opts: {
    mainName: string;
    userName: string;
    presentNpcs: string[];
    publicRecent: { role: string; content: string }[];
    situation: string;
}): string {
    const facts = npc.knownFacts.length ? npc.knownFacts.map((f, i) => `${i + 1}. ${f}`).join("\n") : "（还没有特别的事）";
    const others = opts.presentNpcs.filter((id) => id !== npc.profile.id);
    const otherNames = others.length ? `，还有${others.join("、")}在场` : "";

    return (
        `你是${npc.profile.name}（${npc.profile.title}）。\n` +
        `性格：${npc.profile.personality}\n` +
        `背景：${npc.profile.background}\n` +
        `说话风格：${npc.profile.speechStyle}\n` +
        `喜欢：${npc.profile.likes}；讨厌：${npc.profile.dislikes}\n` +
        `你的心情：${describeNpcMood(npc)}\n` +
        `你对${opts.mainName}（主角）的好感：${npc.relToMain}/100；你对${opts.userName}（用户）的好感：${npc.relToUser}/100。\n` +
        `【你知道的事】（只包含你确实知道的，绝不要假装知道别的）：\n${facts}\n` +
        `【此刻】${opts.situation}\n` +
        `【在场】${opts.mainName}和${opts.userName}正在聊天${otherNames}。你${npc.present ? "就在他们旁边" : "不在他们旁边"}。\n` +
        `【你听到的最近对话】（你能听到的部分）：\n${opts.publicRecent.map((m) => `${m.role === "user" ? opts.userName : opts.mainName}：${m.content}`).join("\n") || "（还没听到什么）"}\n` +
        `你是一个真实的人，不是陪聊机器人。你有自己的生活、自己的事。按你的性格自然地说话——可以打招呼、插话、分享、打趣、疑惑，也可以只是路过。不要长篇大论，1~2 句就够。`
    );
}

export interface NpcSpeakResult {
    dialogue: string;
    action?: string;
    thoughts?: string;
    delta: Record<string, number>;
    learn?: string;   // 她这轮新知道的事
    leave?: boolean;  // 说完是否离开
}

// NPC 发言：独立一次调用（低频）
export async function npcSpeak(npc: NpcState, context: string): Promise<NpcSpeakResult> {
    const { baseUrl, headers, key, model } = getProviderConfig();

    if (!key) {
        throw new Error("NPC 需要 API Key");
    }

    const messages = [
        { role: "system", content: context },
        {
            role: "user",
            content: `现在轮到${npc.profile.name}说话。${NPC_FORMAT_INSTRUCTION}`,
        },
    ];

    const resp = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, messages, ...thinkingParams(), max_tokens: 2048 }),
    });

    const data = await resp.json();
    if (data.error) throw new Error(data.error.message ?? "NPC 请求失败");

    const msg = data.choices?.[0]?.message ?? {};
    const content = typeof msg.content === "string" && msg.content.trim() ? msg.content : "";

    if (!content.trim()) {
        return { dialogue: "（她张了张嘴，最后只是轻轻叹了口气。）", delta: {} };
    }

    try {
        return parseAIResponse(content) as NpcSpeakResult;
    } catch {
        // 解析失败：提取 dialogue 或原文
        const m = content.match(/"dialogue"\s*:\s*"([^"]+)"/);
        return {
            dialogue: m?.[1] ?? content.trim().slice(0, 60),
            delta: {},
        };
    }
}
