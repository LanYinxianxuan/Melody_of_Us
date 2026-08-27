// mind.ts —— 情感判断与对话决策系统（Agent Mind）
//
// 职责：在每次回复之前，先像有持续心理状态的角色一样走完整个决策链：
//   用户消息 → 分析（情绪/意图/潜在需求） → 上下文 → 用户状态更新（惯性/衰减/事件影响）
//   → AI 自身状态更新 → 关系状态更新 → 行为策略决策 → （LLM 只负责最终生成语言）
//
// 设计约束：
//   - 纯逻辑层，不操作 DOM（调试渲染在 mind-debug.ts）。
//   - 全部判断为本地规则 + 状态机 + 轻量计算：0 次额外 LLM 调用。
//     只有最终回复生成调用 LLM（每轮 1 次，与改造前相同）。
//   - LLM 可选择性回传 user_analysis 修正信号（同一次调用内融合），仅作语义微调。
//   - 潜在心理状态一律是 hypothesis 不是 fact：需求带置信度，证据不足 → 保持不确定。
//   - 不允许"每次负面情绪就心理咨询式安慰"：策略层按用户/AI/关系/上下文共同决定。

import { store, saveState } from "./storage";
import { aiState } from "./state";
import { currentSchedule, scheduleIndexFor } from "./time";

// ============ 数据结构 ============

// 用户当前消息分析（一层）
export interface EmotionSignal {
    primary_emotion: string;      // joy | sadness | anger | fear | anxiety | disappointment | loneliness | embarrassment | stress | interest | neutral
    secondary_emotions: string[];
    intensity: number;            // 0~1
    valence: number;              // -1~1
    arousal: number;              // 0~1
    confidence: number;           // 规则置信度 0~1
    calmMask: boolean;            // 表面平静但可能掩盖负面（"没事""算了"）——只作假设，不读心
}

export interface IntentSignal {
    surface_intent: string;       // share | vent | ask | withdraw | blame_ai | happy_share | request | tease | deflect | neutral
    score: number;                // 0~1 置信度
}

export interface NeedSignal {
    need: string;                 // companionship | space | reassurance | comfort | validation | guidance | distraction
    confidence: number;           // 0~1（永远是假设）
}

export interface MessageAnalysis {
    emotion: EmotionSignal;
    intents: IntentSignal[];
    needs: NeedSignal[];
    rawText: string;
}

// LLM 在同一次调用内返回的可选语义修正（可信时仅微调本地信号）
export interface RefinedAnalysis {
    primary_emotion?: string;
    intensity?: number;
    valence?: number;
    arousal?: number;
    intents?: Record<string, number>;
    needs?: Record<string, number>;
}

// 用户持续状态（0~1 连续值，跨消息/跨存档持续）
export interface UserMindState {
    happiness: number;
    sadness: number;
    anger: number;
    fear: number;
    anxiety: number;
    disappointment: number;
    loneliness: number;
    embarrassment: number;
    interest: number;
    energy: number;
    social_need: number;
    willingness_to_talk: number;
    stress: number;
    tension: number;
}

// AI 对话引擎状态（与 38 维 aiState 分离：31 维是情感状态，这里是"此刻想聊/能聊"的决策状态）
export interface AiMindState {
    interest: number;             // 对当前话题的兴趣
    patience: number;             // 耐心
    willingness_to_talk: number;  // 想不想聊
    social_need: number;          // 想互动的需求
    curiosity: number;            // 好奇
    energy: number;               // 对话精力（长时间重复话题会掉）
    topicFatigue: number;         // 话题疲劳（同一话题重复度）
    defensiveness: number;        // 被责怪后的防御性
    comfortCount: number;         // 连续安慰次数（防"每次负面都安慰"）
    lastTopic: string;            // 上一轮主要话题
}

// 关系状态（tension 独立演化；familiarity/trust/closeness/comfort 由 38 维关系层推导）
export interface RelMindState {
    tension: number;              // 0~1 关系张力（别扭/冲突/防备）
    lastMajorLabel: string;       // 最近一次重大事件（影响情绪衰减速度）
    lastMajorTurn: number;        // 最近一次重大事件所在轮次
    lastMajorVirtualAt: number;   // 虚拟时间戳
}

// 上下文（四层）
export interface ConversationContext {
    windowSize: number;
    recentEvents: string[];              // 最近值得记住的事（剧情档案 + 本窗口事件）
    topics: string[];                    // 本窗口话题（按频率降序）
    topTopic: string;                    // 主要话题或 ""
    emotionalTrend: "rising" | "falling" | "stable" | "unstable";
    conversationEnergy: number;          // 0~1（消息密度/长度/提问度）
    unresolvedEvents: string[];          // 未了结的事（剧情线 + 低意愿前提到的负面话题）
    userInputCount: number;              // 窗口内用户消息数
    idleVirtualMin: number;              // 距离上次用户回复的虚拟分钟
}

// 策略（五层）
export type StrategyId =
    | "short_response" | "ask_question" | "show_presence" | "comfort" | "encourage"
    | "playful" | "continue_topic" | "change_topic" | "give_space" | "apologize"
    | "acknowledge" | "admit_uncertainty" | "share_self" | "deflect_light" | "greet";

export interface StrategyChoice {
    id: StrategyId;
    priority: number;   // 1 = 最高
    reason: string;     // 为什么选它（调试用）
}

export interface ConversationStrategy {
    choices: StrategyChoice[];
    directives: string[];   // do_not_push / keep_short / no_forced_comfort / don_t_read_mind / subtle
    text: string;           // 注入 LLM 的紧凑策略描述
}

// 一次决策的完整轨迹（调试用）
export interface AgentTraceEntry {
    id: number;
    realAt: number;
    virtualAt: number;
    userText: string;
    detectedSignal: string;      // 检测到的信号
    stateTransition: string;     // 状态转移（重要维度 before→after）
    strategySummary: string;     // 策略 + 约束
    response: string;            // 生成后的回复（生成后回填）
    refined: string;             // LLM 语义修正（如有）
    proactive: boolean;
}

export interface AgentTurn {
    analysis: MessageAnalysis;
    context: ConversationContext;
    userBefore: UserMindState;
    userAfter: UserMindState;
    aiBefore: AiMindState;
    aiAfter: AiMindState;
    relTensionBefore: number;
    relTensionAfter: number;
    strategy: ConversationStrategy;
    prompt: string;              // 注入 LLM 的紧凑上下文块
    trace: AgentTraceEntry;
    proactive: boolean;
}

// ============ 常量与默认值 ============

export const CONTEXT_WINDOW = 24;         // 最近 10~30 条消息窗口（取 24）
export const MAX_TRACE = 60;               // 调试轨迹保留条数

export function defaultUserMind(): UserMindState {
    return {
        happiness: 0.42, sadness: 0.10, anger: 0.06, fear: 0.06, anxiety: 0.20,
        disappointment: 0.12, loneliness: 0.18, embarrassment: 0.06, interest: 0.40,
        energy: 0.55, social_need: 0.32, willingness_to_talk: 0.60, stress: 0.25, tension: 0.10,
    };
}
export function defaultAiMind(): AiMindState {
    return {
        interest: 0.55, patience: 0.75, willingness_to_talk: 0.62, social_need: 0.35,
        curiosity: 0.60, energy: 0.62, topicFatigue: 0, defensiveness: 0.15, comfortCount: 0, lastTopic: "",
    };
}
export function defaultRelMind(): RelMindState {
    return { tension: 0.08, lastMajorLabel: "", lastMajorTurn: 0, lastMajorVirtualAt: 0 };
}

// 会话内存：调试轨迹（不持久化）
const agentTrace: AgentTraceEntry[] = [];
let traceSeq = 0;

// 不完美的概率（允许 AI"不会接话/走神"），调试时可置 0
let imperfectionRate = 0.06;
export function setImperfectionRate(v: number) { imperfectionRate = Math.max(0, Math.min(1, v)); }
export function imperfectionChance() { return Math.random() < imperfectionRate; }

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// ============ 情绪信号基础表 ============

const EMOTION_BASE: Record<string, { valence: number; arousal: number }> = {
    joy: { valence: 0.65, arousal: 0.65 },
    sadness: { valence: -0.60, arousal: 0.30 },
    anger: { valence: -0.50, arousal: 0.72 },
    fear: { valence: -0.50, arousal: 0.60 },
    anxiety: { valence: -0.45, arousal: 0.52 },
    disappointment: { valence: -0.55, arousal: 0.35 },
    loneliness: { valence: -0.50, arousal: 0.25 },
    embarrassment: { valence: -0.35, arousal: 0.50 },
    stress: { valence: -0.40, arousal: 0.45 },
    interest: { valence: 0.20, arousal: 0.45 },
    neutral: { valence: 0.00, arousal: 0.20 },
};

// 負面情绪维度（用于"情绪走低"时的信号增强与 calmMask 时的信号削弱）
const NEG_DIMS = new Set<keyof UserMindState>([
    "sadness", "anger", "anxiety", "disappointment", "fear", "loneliness", "embarrassment", "stress", "tension",
]);
// 情绪型维度：以"衰减 + 信号"演化；状态型维度：以"基线回归 + 信号"演化
const EMOTION_DIMS = new Set<keyof UserMindState>([
    "happiness", "sadness", "anger", "fear", "anxiety", "disappointment", "loneliness",
    "embarrassment", "stress", "tension",
]);

// 情绪规则（按"最匹配"取最高强度；顺序即优先级）
const EMOTION_RULES: { re: RegExp; emotion: string; intensity: number; secondary?: string[] }[] = [
    { re: /考砸|考糊|没考好|考差了|挂科|不及格|落榜|没发挥好|搞砸|砸了|失败|被拒|拒绝了我|落选|没被选上|差一点|差几分|面试.{0,3}(挂|失败)|成绩.{0,4}(低|差|退)/, emotion: "disappointment", intensity: 0.65, secondary: ["sadness"] },
    { re: /气死|生气|气到|好气|恼火|火大|愤怒|他妈|他妈的|玛德|凭什么|太过分|恶心死了|烦死|烦透|讨厌死了|气得|气哭/, emotion: "anger", intensity: 0.66, secondary: ["stress"] },
    { re: /难过|伤心|失落|委屈|想哭|哭了|要哭|心碎|心里堵|难受|不开心|闷闷|唉|呜|呜呜|眼泪|哭/, emotion: "sadness", intensity: 0.60, secondary: ["disappointment"] },
    { re: /焦虑|担心|不安|慌|紧张|睡不着|失眠|压力(大|好大|山大)|怎么办|不知道怎么办|好难|很怕|害怕|怕|吓|恐怖|噩梦/, emotion: "anxiety", intensity: 0.58, secondary: ["fear"] },
    { re: /孤独|孤单|寂寞|没人陪|一个人|没人理|没人懂|想找人说话|没有朋友/, emotion: "loneliness", intensity: 0.55, secondary: [] },
    { re: /尴尬|丢人|社死|出丑|难堪|羞死|脸红|不好意思/, emotion: "embarrassment", intensity: 0.50, secondary: [] },
    { re: /累死|好累|太累|累炸|撑不住|忙死|忙疯了|加班(到|到)?(死|爆)?|疲惫|虚脱/, emotion: "stress", intensity: 0.55, secondary: [] },
    { re: /终于|过了|通过了|考过|成功|做到了|达成|晋级|赢了|拿(到)?offer|上岸|中了|太棒|太好了|好耶|开心死|高兴死|爽|耶|哈哈|哈哈哈|笑死|嘿嘿|惊喜|哇塞/, emotion: "joy", intensity: 0.64, secondary: [] },
    { re: /好奇|想知道|有意思|有趣|好玩|啥|什么情况/, emotion: "interest", intensity: 0.38, secondary: [] },
    { re: /好烦|烦|不爽|讨厌|恶心|反感|不行了|烦人/, emotion: "anger", intensity: 0.45, secondary: ["stress"] },
];

// 强度修饰
const INTENSITY_UP = /好|真|特别|极其|超级|非常|巨|太|很|死|爆|疯了/;
const INTENSITY_DOWN = /有点|稍微|一点点|略微|不算|没那么/;

// ============ 意图规则 ============

const INTENT_RULES: { re: RegExp; intent: string; score: number }[] = [
    // 高置信 退出交流
    { re: /想静静|静一静|一个人待会|一个人待着|别理我|走开|离我远点|让我一个人|别烦我/, intent: "withdraw", score: 0.90 },
    { re: /别管我|不用管我|不用管|不要管我|别管|你走开/, intent: "withdraw", score: 0.86 },
    { re: /算了|不想说了|不想聊|不想说话|不想理(人|你|我)|谁都不想理|别说了|别提了|不说了|聊不下去了|没什么好说的/, intent: "withdraw", score: 0.82 },
    { re: /不用了|不了|先挂了|去睡了|拜拜|再见|我先忙|我先走了/, intent: "withdraw", score: 0.70 },
    { re: /随便|都行|无所谓|你定吧|随你/, intent: "withdraw", score: 0.45 },
    // 责怪 AI（"你刚才真的很烦"）
    { re: /你刚才|你昨天|你之前|你一直|你总是|你老是这样|你怎么这样|你什么意思|你这个?AI|你这?机器人|你在敷衍|你(好|很|真|太)?(烦|讨厌|吵|气人|无聊|没意思|离谱|有病|敷衍|凶|冷|虚伪|假)/, intent: "blame_ai", score: 0.85 },
    { re: /你(到底|能不能|可不可以)不(要|许|要再)|你闭嘴|你住口/, intent: "blame_ai", score: 0.75 },
    // 喜悦分享
    { re: /终于|过了|通过了|考过|成功|达成|赢了|晋级|上岸|中了|offer|做到了|拿下了/, intent: "happy_share", score: 0.78 },
    // 倾诉
    { re: /唉|烦死|压力好大|真的(受够|没办法|不行了)|我好(累|难过|难受|委屈|惨)|又(是|被|要|得)|还(是|要)|今天(真|太|又)|跟你说|跟你讲|你知道吗|我跟你讲|我跟你说哦|你听我说/, intent: "vent", score: 0.62 },
    // 分享日常
    { re: /今天我|今天(去|吃|买|看|玩|遇到|发现|做了)|我(刚|才|去|在|跟|被|买了|吃了|玩了|看了一|遇到|发现|学会|做了一)|你猜|你看|看这个|拍了一/, intent: "share", score: 0.66 },
    // 提问
    { re: /[?？]|吗|呢|什么|怎么|怎么办|哪里|哪个|为啥|为什么|是不是|有没有|可不可以|能不能|会不会|多少|几点|几号/, intent: "ask", score: 0.55 },
    // 请求
    { re: /帮我|教教|求求|拜托|能不能(帮|教|陪)|可以(帮|陪|一起)|陪我|给我.*(看看|讲讲)|教我/, intent: "request", score: 0.68 },
    // 玩笑/调侃
    { re: /哈哈.*(你|笨|傻|呆|单身狗)|开玩笑|逗你|骗你的|逗你玩|你就是个/, intent: "tease", score: 0.60 },
    // 岔开（表面平静）
    { re: /我没事|没事|没关系|无所谓啦|还好|还行|没什么|没怎么|算了算了/, intent: "deflect", score: 0.50 },
];

// 潜在需求（永远只是 hypothesis）：给出"线索权重"，翻译成 0~1 置信度
const NEED_CLUES: Record<string, { re?: RegExp; base?: (a: MessageAnalysis, ctx: ConversationContext) => number }> = {
    space: {
        re: /一个人|静静|别理|走开|想自己|让我一个人|别管/,
    },
    companionship: { re: /陪我|聊聊天|说说话|好无聊|想找人|你在吗|理理我|陪我一会儿/ },
    reassurance: { re: /对吗|是吗|会不会|是不是|没问题.*吧|能行吗|我会不会|我是不是.*(没|不|做错)/ },
    comfort: { re: /安慰|抱抱|想哭|难过|委屈|好惨|可怜/ },
    validation: { re: /厉害吧|做得好吧|还不错吧|夸夸我|你看我/ },
    guidance: { re: /怎么办|怎么做|选哪个|该不该|要不要|出主意|帮我想想/ },
    distraction: { re: /不想了|换个话题|陪我玩|说点别的|逗逗我/ },
};

// 话题桶
const TOPIC_BUCKETS: Record<string, RegExp> = {
    exam: /考|成绩|分数|复习|作业|题目|挂科|课|试卷|学考|老师|考试|绩点|考研|升学/,
    work: /班|工作|老板|同事|项目|加班|开会|面试|offer|入职|绩效|客户|上班/,
    love: /对象|女朋友|男朋友|喜欢|表白|分手|吵架|闺蜜|兄弟|暗恋|前任|心动|恋爱|相亲/,
    family: /爸|妈|父母|家人|弟弟|妹妹|哥哥|姐姐|家里|家事/,
    health: /病|疼|痛|医院|吃药|感冒|发烧|失眠|困|晕|难受|身体|体检|牙|胃/,
    food: /吃|饭|面|拉面|火锅|奶茶|蛋糕|零食|外卖|好吃|饿|夜宵|点心/,
    game: /游戏|打游戏|上分|排位|王者|原神|switch|steam|主机|电脑|手机游戏/,
    music: /歌|音乐|听歌|专辑|演唱会|livehouse|live|乐队|吉他|贝斯|鼓/,
    money: /钱|工资|贵|便宜|买|购物|花|红包|省钱|攒|信用卡|房租/,
    fun: /玩|逛街|散步|电影|剧|综艺|番|漫画|小说|旅游|旅行|拍照/,
};

// 情绪维度衰减率：per-turn（每轮惯性衰减）与 per-hour（时间衰减）
const TURN_DECAY: Record<keyof UserMindState, number> = {
    happiness: 0.18, sadness: 0.10, anger: 0.30, fear: 0.16, anxiety: 0.12,
    disappointment: 0.07, loneliness: 0.05, embarrassment: 0.32, interest: 0.12,
    energy: 0.04, social_need: 0.07, willingness_to_talk: 0.06, stress: 0.10, tension: 0.14,
};
const HOUR_DECAY: Record<keyof UserMindState, number> = {
    happiness: 0.14, sadness: 0.10, anger: 0.22, fear: 0.16, anxiety: 0.10,
    disappointment: 0.05, loneliness: 0.06, embarrassment: 0.28, interest: 0.10,
    energy: 0.04, social_need: 0.08, willingness_to_talk: 0.06, stress: 0.12, tension: 0.16,
};
// 时间衰减的回归基线（情绪向基线回落，不是机械归零）
const STATE_BASE: Record<keyof UserMindState, number> = {
    happiness: 0.35, sadness: 0.08, anger: 0.05, fear: 0.05, anxiety: 0.12,
    disappointment: 0.08, loneliness: 0.12, embarrassment: 0.05, interest: 0.40,
    energy: 0.55, social_need: 0.30, willingness_to_talk: 0.58, stress: 0.20, tension: 0.08,
};

// ============ 第一层：用户消息分析（本地规则，0 成本） ============

export function analyzeMessage(text: string): MessageAnalysis {
    const t = text || "";

    // —— 情绪 ——
    let primary: EmotionSignal = {
        primary_emotion: "neutral", secondary_emotions: [], intensity: 0,
        valence: 0, arousal: 0.2, confidence: 0.2, calmMask: false,
    };
    let best = 0;
    for (const rule of EMOTION_RULES) {
        if (!rule.re.test(t)) continue;
        let intensity = rule.intensity;
        if (INTENSITY_UP.test(t)) intensity = Math.min(0.95, intensity + 0.10);
        if (INTENSITY_DOWN.test(t)) intensity = Math.max(0.15, intensity - 0.15);
        if (!(rule.emotion === "joy" || rule.emotion === "interest") && /哈哈|嘻嘻|哈哈哈哈/.test(t)) intensity = Math.max(0.2, intensity - 0.3);
        if (intensity > best) {
            best = intensity;
            const base = EMOTION_BASE[rule.emotion] ?? EMOTION_BASE.neutral!;
            primary = {
                primary_emotion: rule.emotion,
                secondary_emotions: rule.secondary ?? [],
                intensity,
                valence: base.valence,
                arousal: base.arousal + (IntensityUpAroma(rule.emotion, t) ? 0.12 : 0),
                confidence: Math.min(0.95, 0.55 + intensity * 0.45),
                calmMask: false,
            };
        }
    }

    // 表面平静（掩盖负面）——只作假设
    let calmMask = false;
    if (/我没事|没事|没关系|无所谓|还好|还行|没什么|算了算了/.test(t)) {
        calmMask = true;
        primary = {
            ...primary,
            secondary_emotions: primary.primary_emotion === "neutral" ? ["calm_mask"] : primary.secondary_emotions,
            intensity: primary.primary_emotion === "neutral" ? 0.25 : primary.intensity,
            valence: primary.primary_emotion === "neutral" ? -0.15 : primary.valence,
            confidence: Math.min(primary.confidence, 0.5),
            calmMask,
        };
    }

    // —— 意图（可多个，带置信度） ——
    const intents: IntentSignal[] = [];
    for (const rule of INTENT_RULES) {
        if (rule.re.test(t)) intents.push({ surface_intent: rule.intent, score: rule.score });
        if (intents.length >= 5) break;
    }
    // 责怪与吐槽互斥去重：只有"你…"开头/含"你"才是 blame_ai
    intents.sort((a, b) => b.score - a.score);
    const seen = new Set<string>();
    const intentList = intents.filter((i) => {
        if (i.surface_intent === "deflect" && /没事|我没事|没关系/.test(t) && i.score > 0.55) return true;
        if (seen.has(i.surface_intent)) return false;
        seen.add(i.surface_intent);
        return true;
    });
    if (!intentList.length) intentList.push({ surface_intent: "neutral", score: 0.2 });

    // —— 潜在需求（假设 + 置信度） ——
    const needs: NeedSignal[] = [];
    for (const [need, clue] of Object.entries(NEED_CLUES)) {
        let conf = 0;
        if (clue.re?.test(t)) conf = 0.45;
        if (need === "space" && intentList.some((i) => i.surface_intent === "withdraw")) conf = Math.max(conf, 0.51);
        if (need === "space" && /别管我|不用管我|想静静|一个人/.test(t)) conf = Math.max(conf, 0.80);
        if (need === "comfort" && (primary.primary_emotion === "sadness" || primary.primary_emotion === "disappointment" || (/想哭|难过|委屈/.test(t)))) conf = Math.max(conf, 0.40);
        // 反着来的信号：嘴上"别管我"时陪伴需求自然低一点（避免读心成"其实你想要"）
        if (need === "companionship" && /别管我|不用管我|想静静|一个人/.test(t)) conf = Math.max(conf, 0.28);
        if (conf > 0.24) needs.push({ need, confidence: clamp01(conf) });
    }
    needs.sort((a, b) => b.confidence - a.confidence);

    return { emotion: primary, intents: intentList, needs: needs.slice(0, 4), rawText: t };
}

function IntensityUpAroma(emotion: string, t: string): boolean {
    return /终于|哈哈|好耶|哇|太棒|成功|过了/.test(t) && (emotion === "joy" || emotion === "interest");
}

function findIntent(intents: IntentSignal[], name: string): number {
    return intents.find((i) => i.surface_intent === name)?.score ?? 0;
}

// ============ 第三层：上下文分析（轻量，0 成本） ============

export function buildContext(opts: { proactive: boolean }): ConversationContext {
    const history = store.chatHistory.slice(-CONTEXT_WINDOW);
    const userMsgs = history.filter((e) => e.role === "user" && e.content !== "（她主动找你说话）").map((e) => e.content);

    // 话题
    const topicCount: Record<string, number> = {};
    let topTopic = "";
    for (const m of userMsgs) {
        for (const [key, re] of Object.entries(TOPIC_BUCKETS)) {
            if (re.test(m)) {
                topicCount[key] = (topicCount[key] ?? 0) + 1;
                if (topicCount[key] > (topicCount[topTopic] ?? 0)) topTopic = key;
            }
        }
    }
    const topics = Object.entries(topicCount).sort((a, b) => b[1] - a[1]).map(([k]) => k);

    // 情绪走向：窗口前半 vs 后半的负面词密度
    const halves = [userMsgs.slice(0, Math.max(1, userMsgs.length >> 1)), userMsgs.slice(userMsgs.length >> 1)];
    const negRe = /难过|伤心|失落|委屈|烦|气|哭|焦虑|担心|累|惨|崩|差|失败|挂了|考砸|不想|算了|压力/;
    const posRe = /开心|高兴|哈哈|太好了|终于|成功|过了|棒|快乐|好耶|爽/;
    const n1 = countMatch(halves[0]!, negRe, posRe);
    const n2 = countMatch(halves[1]!, negRe, posRe);
    let emotionalTrend: ConversationContext["emotionalTrend"] = "stable";
    if (userMsgs.length >= 4) {
        if (n2 - n1 >= 1.5) emotionalTrend = "falling";
        else if (n1 - n2 >= 1.5) emotionalTrend = "rising";
        else if (Math.abs(n2 - n1) < 0.6 && n1 > 0.4) emotionalTrend = "unstable";
    }

    // 对话能量：消息长度 + 提问/分享密度（越长越有劲，越短越没电）
    const avgLen = userMsgs.length ? userMsgs.reduce((s, m) => s + m.length, 0) / userMsgs.length : 0;
    const qCount = userMsgs.filter((m) => /[?？]/.test(m)).length;
    const conversationEnergy = clamp01(
        (Math.min(avgLen, 60) / 60) * 0.6 + (userMsgs.length ? qCount / userMsgs.length : 0) * 0.4,
    );

    // 最近事件：剧情档案最近几条 + 用户消息里的明显事件（考砸了/被拒…）
    const eventRe = /考砸|挂了|被拒|分手|吵架|面试.{0,3}(挂|失败)|落榜|住院|受伤|吵架|被骂|辞了|被裁|成功了|通过了|上岸|中了/;
    const recentEvents: string[] = store.storyEvents.slice(-3).map((e) => e.text);
    for (const m of userMsgs.slice(-3)) {
        const ev = m.match(eventRe)?.[0];
        if (ev && !recentEvents.some((r) => r.includes(ev))) recentEvents.push(`（${ev}）`);
    }

    // 未了结的事：剧情线 + 负面开头却草草收场的话题
    const unresolvedEvents: string[] = [];
    if (store.activeThread) unresolvedEvents.push(store.activeThread);
    const unresolvedRe = /(算了|不想说|没事|没怎么|改天|下次|回头再说|再说吧)/;
    for (const m of userMsgs.slice(-4)) {
        if (unresolvedRe.test(m) && negRe.test(m)) unresolvedEvents.push(m.slice(0, 18));
    }

    const idleVirtualMin = (store.virtualMs - store.lastReplyVirtualAt) / 60000;

    return { windowSize: CONTEXT_WINDOW, recentEvents, topics, topTopic, emotionalTrend, conversationEnergy, unresolvedEvents, userInputCount: userMsgs.length, idleVirtualMin };
}

function countMatch(arr: string[], neg: RegExp, pos: RegExp): number {
    let n = 0;
    for (const m of arr) { if (neg.test(m)) n += 1; else if (pos.test(m)) n -= 0.6; }
    return n;
}

// ============ 状态更新：用户（惯性 + 衰减 + 事件影响 + 上下文修正） ============

export function loadMindState(): { user: UserMindState; ai: AiMindState; rel: RelMindState } {
    // 从 store 读取（store 由 storage.ts 初始化并兼容旧存档）
    return {
        user: (store as any).userMind && typeof (store as any).userMind === "object" ? { ...defaultUserMind(), ...(store as any).userMind } : defaultUserMind(),
        ai: (store as any).aiMind && typeof (store as any).aiMind === "object" ? { ...defaultAiMind(), ...(store as any).aiMind } : defaultAiMind(),
        rel: (store as any).relMind && typeof (store as any).relMind === "object" ? { ...defaultRelMind(), ...(store as any).relMind } : defaultRelMind(),
    };
}

export function persistMindState() {
    saveState();
}

// 时间衰减（跨消息/离线后）：elapsedVirtualMs 为虚拟时间流逝
export function applyTimeDecay(elapsedVirtualMs: number): string[] {
    const user = loadMindState().user;
    const rel = loadMindState().rel;
    const hours = Math.max(0, elapsedVirtualMs / 3600000);
    if (hours < 0.02) return [];

    const majorRecent = rel.lastMajorVirtualAt && store.virtualMs - rel.lastMajorVirtualAt < 6 * 3600000;
    const transitions: string[] = [];

    for (const key of Object.keys(user) as (keyof UserMindState)[]) {
        const rate = (HOUR_DECAY[key] ?? 0) * (majorRecent && (key === "sadness" || key === "disappointment") ? 0.35 : 1);
        const f = Math.exp(-rate * hours);
        const base = STATE_BASE[key] ?? 0;
        const before = user[key] ?? 0;
        const after = base + (before - base) * f;
        user[key] = after;
        if (Math.abs(after - before) >= 0.04) transitions.push(`${key} ${fmt(before)}→${fmt(after)}`);
    }
    (store as any).userMind = user;
    (store as any).lastAgentVirtualAt = store.virtualMs;
    saveState();
    return transitions;
}

function fmt(v: number): string { return v.toFixed(2).replace(/^0/, ""); }

// 每轮：用户状态更新（含惯性、衰减、事件影响、上下文修正）
export function updateUserState(prev: UserMindState, analysis: MessageAnalysis, ctx: ConversationContext, opts?: { lastAiTopic?: string }): { next: UserMindState; transitions: string[]; majorEventLabel?: string } {
    const next: UserMindState = { ...prev };
    const emo = analysis.emotion;
    const trends = ctx.emotionalTrend;

    // 上下文修正：情绪走低 → 负面信号增强（事件累积感）；表面平静 → 负面信号削弱（不读心）
    const negBoost = trends === "falling" ? 1.25 : 1;
    const calmFactor = emo.calmMask ? 0.6 : 1;

    const push = (key: keyof UserMindState, signal: number, influence: number) => {
        let s = signal;
        if (s > 0 && NEG_DIMS.has(key) && trends === "falling") s *= negBoost;
        if (s > 0 && NEG_DIMS.has(key) && emo.calmMask) s *= calmFactor;
        const cur = next[key] ?? 0;
        if (EMOTION_DIMS.has(key)) {
            // 情绪型：先惯性衰减，再加信号（衰减≠归零；重大事件经 lastMajor 拉低衰减率）
            next[key] = clamp01(cur * (1 - (TURN_DECAY[key] ?? 0)) + s * influence);
        } else {
            // 状态型：向基线回归 + 信号
            next[key] = clamp01(cur + ((STATE_BASE[key] ?? 0) - cur) * 0.10 + s * influence);
        }
    };

    // —— 情绪信号 → 维度（primary 大影响，secondary 小影响） ——
    const emoDim: Record<string, keyof UserMindState> = {
        joy: "happiness", sadness: "sadness", anger: "anger", fear: "fear",
        anxiety: "anxiety", disappointment: "disappointment", loneliness: "loneliness",
        embarrassment: "embarrassment", stress: "stress", interest: "interest",
    };
    const dom = emoDim[emo.primary_emotion];
    if (dom) push(dom, emo.intensity, 0.55);
    for (const sec of emo.secondary_emotions) {
        const d = emoDim[sec];
        if (d) push(d, emo.intensity * 0.5, 0.28);
    }
    // 伴随关系：伤心/失望 → 孤独爬升、能量下跌；开心 → 能量上涨；生气 → 张力和压力
    if (emo.primary_emotion === "sadness" || emo.primary_emotion === "disappointment") push("loneliness", emo.intensity * 0.3, 0.18);
    if (emo.primary_emotion === "disappointment" || emo.primary_emotion === "stress") push("energy", -emo.intensity * 0.7, 0.14);
    if (emo.primary_emotion === "joy") { push("energy", emo.intensity, 0.12); }
    if (emo.primary_emotion === "anger") push("stress", emo.intensity * 0.5, 0.25);

    // —— 意图 → 聊意愿 / 社交需求 / 张力 ——
    const w = findIntent(analysis.intents, "withdraw");
    const share = findIntent(analysis.intents, "share") + findIntent(analysis.intents, "happy_share") + findIntent(analysis.intents, "vent") * 0.4;
    const ask = findIntent(analysis.intents, "ask");
    const blame = findIntent(analysis.intents, "blame_ai");
    const deflect = findIntent(analysis.intents, "deflect");
    push("willingness_to_talk", -w * 0.9, 0.30);
    push("willingness_to_talk", share * 0.4 + ask * 0.2, 0.18);
    push("social_need", share * 0.6 + Math.max(0, next.loneliness - 0.3) * 0.4, 0.16);
    push("tension", blame * 0.8 + (emo.primary_emotion === "anger" ? 0.3 : 0), 0.2);
    push("stress", blame * 0.8, 0.22);
    if (deflect > 0.5 && emo.calmMask) push("willingness_to_talk", -0.15, 0.2);

    // 兴趣：新话题/提问 → 涨；话题重复 → 微降
    const lastAiTopic = opts?.lastAiTopic ?? "";
    if (ctx.topTopic && ctx.topTopic !== lastAiTopic && ask > 0) push("interest", 0.12 + ask * 0.1, 0.2);
    else if (ctx.topTopic && ctx.topTopic === lastAiTopic) push("interest", -0.12, 0.2);

    // —— 事件影响：重大事件标记（供 slower decay 使用）——
    let majorEventLabel: string | undefined;
    const majorRe = /考砸|挂了|被拒|分手|吵架|落榜|考试|面试|辞职|被裁|住院|受伤|成功|通过|上岸|offer/;
    const m = analysis.rawText.match(majorRe);
    if (m) majorEventLabel = m[0];

    // 记录转移（供调试/测试）
    const transitions: string[] = [];
    for (const key of Object.keys(next) as (keyof UserMindState)[]) {
        const before = prev[key] ?? 0;
        const after = next[key] ?? 0;
        if (Math.abs(after - before) >= 0.06) transitions.push(`${key} ${fmt(before)}→${fmt(after)}`);
    }
    return { next, transitions, majorEventLabel };
}

// ============ AI 自身状态：受对话影响（兴趣/耐心/意愿/好奇心…） ============

function topicAffinity(topic: string, likesText: string): boolean {
    if (!topic || !likesText) return false;
    const re = TOPIC_BUCKETS[topic];
    return re ? re.test(likesText) : false;
}

export function updateAiMind(prev: AiMindState, analysis: MessageAnalysis, ctx: ConversationContext, opts: { likes?: string }): { next: AiMindState; transitions: string[] } {
    const next = { ...prev };
    const int = (id: string) => findIntent(analysis.intents, id);

    // 话题疲劳：重复话题 → 涨；换了话题 → 降
    const sameTopic = ctx.topTopic && ctx.topTopic === prev.lastTopic && ctx.topTopic !== "";
    if (sameTopic) next.topicFatigue = clamp01(next.topicFatigue + 0.16);
    else next.topicFatigue = clamp01(next.topicFatigue * 0.6);

    // 兴趣：契合角色喜好 → 涨；话题疲劳 → 降
    if (topicAffinity(ctx.topTopic, opts.likes ?? "")) next.interest = clamp01(next.interest * 0.9 + 0.12);
    else if (next.topicFatigue > 0.45) next.interest = clamp01(next.interest * 0.9 - 0.06);
    if (int("happy_share") > 0) next.interest = clamp01(next.interest + 0.06);
    if (analysis.emotion.primary_emotion === "sadness" && int("vent") > 0) next.patience = clamp01(next.patience + 0.05); // 愿意陪
    if (ctx.topTopic) next.lastTopic = ctx.topTopic;

    // 用户分享/倾诉 → 她更想聊；用户冷/责 → 意愿降、防御升
    const share = int("share") + int("happy_share") + int("vent");
    if (share > 0.4) next.willingness_to_talk = clamp01(next.willingness_to_talk * 0.88 + 0.15);
    if (int("withdraw") > 0.5) next.willingness_to_talk = clamp01(next.willingness_to_talk * 0.75 - 0.1);
    const blame = int("blame_ai");
    if (blame > 0.5) {
        next.willingness_to_talk = clamp01(next.willingness_to_talk - 0.22);
        next.patience = clamp01(next.patience - 0.14);
        next.defensiveness = clamp01(next.defensiveness + 0.18);
    } else {
        next.defensiveness = clamp01(next.defensiveness * 0.7);
    }
    next.patience = clamp01(next.patience * 0.97 + 0.02);

    // 社会需求：用户孤单/用户分享 → 涨；被冷落 → 涨（想找人说话）
    if (analysis.emotion.primary_emotion === "loneliness" || int("share") > 0) next.social_need = clamp01(next.social_need * 0.9 + 0.1);
    if (ctx.idleVirtualMin > 60) next.social_need = clamp01(next.social_need + 0.05);

    // 好奇：提问/新话题 → 涨；话题疲劳 → 降
    if (int("ask") > 0.4 || (ctx.topTopic && ctx.topTopic !== prev.lastTopic)) next.curiosity = clamp01(next.curiosity * 0.92 + 0.08);
    if (next.topicFatigue > 0.5) next.curiosity = clamp01(next.curiosity * 0.85);

    // 对话精力：长时间重复话题 → 掉；用户带来的新鲜内容 → 涨
    if (next.topicFatigue > 0.45) next.energy = clamp01(next.energy - 0.06);
    if (int("share") > 0 || int("happy_share") > 0) next.energy = clamp01(next.energy + 0.04);
    if (blame > 0.5) next.energy = clamp01(next.energy - 0.05);
    next.energy = clamp01(next.energy * 0.99 + 0.01); // 缓慢回复

    // 连续安慰计数器在本轮结束后由策略层调整（选择 comfort 时 +1，否则回退）

    const transitions: string[] = [];
    // 显式字面量联合：避免 keyof 含 lastTopic(string) 导致 number|string 类型错误
    const keys = ["interest", "patience", "willingness_to_talk", "social_need", "curiosity", "energy", "topicFatigue", "defensiveness"] as const;
    for (const k of keys) {
        const before = prev[k] ?? 0;
        const after = next[k] ?? 0;
        if (Math.abs(after - before) >= 0.09) transitions.push(`${k} ${fmt(before)}→${fmt(after)}`);
    }
    return { next, transitions };
}

// ============ 关系状态更新 ============

export function updateRelationship(prev: RelMindState, analysis: MessageAnalysis): { next: RelMindState; transitions: string[] } {
    const next = { ...prev };
    const blame = findIntent(analysis.intents, "blame_ai");
    const anger = analysis.emotion.primary_emotion === "anger";
    const calm = /对不起|我错了|别生气|抱歉|原谅|是我不好|好啦/.test(analysis.rawText);

    if (blame > 0.5) next.tension = clamp01(next.tension + 0.12 + blame * 0.06);
    if (anger && blame < 0.3) next.tension = clamp01(next.tension + 0.06); // 对世界生气也会带来一点距离感
    if (calm) next.tension = clamp01(next.tension - 0.14);
    // 长期积累：关系值本身走 38 维 applyDelta（缓慢），这里只做张力
    next.tension = clamp01(next.tension * 0.92 + 0.008); // 轻微自然回落与漂移

    const transitions: string[] = [];
    if (Math.abs(next.tension - prev.tension) >= 0.05) transitions.push(`tension ${fmt(prev.tension)}→${fmt(next.tension)}`);
    return { next, transitions };
}

// 关系集合（从 38 维推导 + 张力）
export function relationshipView(rel: RelMindState): { familiarity: number; trust: number; comfort: number; closeness: number; tension: number } {
    const familiarity = (aiState.familiarity ?? 0) / 100;
    const trust = (aiState.trust ?? 0) / 100;
    const closeness = Math.min(1, ((aiState.intimacy ?? 0) / 100) * 0.5 + ((aiState.affection ?? 0) / 100) * 0.5);
    const tension = rel.tension;
    const comfort = clamp01((trust * 0.4 + closeness * 0.35 + familiarity * 0.25) - tension * 0.35);
    return { familiarity, trust, comfort, closeness, tension };
}

// ============ AI 状态视图（38 维 → 决策状态；参与策略决策） ============

export function aiStateView(mind: AiMindState): { mood: number; energy: number; confidence: number; arousal: number } {
    const g = (k: string) => aiState[k] ?? 0;
    const mood = clamp01(
        (g("joy") * 0.5 - g("sadness") * 0.42 - g("anger") * 0.5 - g("anxiety") * 0.25 - g("fatigue") * 0.15 + 30) / 100,
    );
    const energy = clamp01(g("energy") / 100 * 0.7 + mind.energy * 0.3);
    const confidence = clamp01(g("confidence") / 100 * 0.7 + mind.willingness_to_talk * 0.3);
    const arousal = clamp01((g("joy") + g("anger") + g("surprise")) / 300 + (g("energy") / 100) * 0.2);
    return { mood, energy, confidence, arousal };
}

// ============ 第五层：策略选择（不是简单 IF ELSE） ============

// 依赖：用户状态 + AI 状态 + 关系 + 近期事件 + 当前意图 + 对话历史（上下文）
export function selectStrategy(args: {
    user: UserMindState;
    ai: AiMindState;
    aiView: ReturnType<typeof aiStateView>;
    rel: ReturnType<typeof relationshipView>;
    ctx: ConversationContext;
    analysis: MessageAnalysis;
    proactive: boolean;
}): ConversationStrategy {
    const { user, ai, aiView, rel, ctx, analysis, proactive } = args;
    const score: Record<StrategyId, number> = {
        short_response: 0, ask_question: 0, show_presence: 0, comfort: 0, encourage: 0,
        playful: 0, continue_topic: 0, change_topic: 0, give_space: 0, apologize: 0,
        acknowledge: 0, admit_uncertainty: 0, share_self: 0, deflect_light: 0, greet: 0,
    };
    const reasons: Partial<Record<StrategyId, string>> = {};
    const add = (id: StrategyId, v: number, why: string) => {
        score[id] += v;
        if (!reasons[id]) reasons[id] = why;
    };

    const withdrawal = findIntent(analysis.intents, "withdraw");
    const blame = findIntent(analysis.intents, "blame_ai");
    const share = findIntent(analysis.intents, "share");
    const happyShare = findIntent(analysis.intents, "happy_share");
    const vent = findIntent(analysis.intents, "vent");
    const ask = findIntent(analysis.intents, "ask");
    const deflect = findIntent(analysis.intents, "deflect");
    const tease = findIntent(analysis.intents, "tease");
    const neg = user.sadness * 0.5 + user.disappointment * 0.4 + user.anxiety * 0.3 + user.anger * 0.25;
    const trustLow = rel.trust < 0.35;

    // —— 基础：人设 + 交流能量 ——
    const freshNews = share > 0 || vent > 0 || happyShare > 0; // 用户刚带来新内容（话题不陈旧）
    add("short_response",
        Math.max(0, 1 - user.willingness_to_talk) * 0.6 + Math.max(0, 1 - aiView.energy) * 0.35,
        "意愿/精力一般，说短一点");
    if (!proactive && withdrawal <= 0.3) {
        add("continue_topic", ctx.topTopic ? 0.5 : 0.2, "有话题延续");
        // 追问要克制：用户明显低落时收窄（避免心理咨询式连环提问）
        const askBase = (ask * 0.4 + ai.curiosity * 0.25) * (1 - withdrawal) * user.willingness_to_talk + 0.05;
        add("ask_question", askBase * (1 - Math.min(0.8, neg)), "可追问");
        if (ctx.conversationEnergy > 0.55 && ai.willingness_to_talk > 0.5) add("share_self", 0.25, "话头正热，可以分享自己");
    }

    // —— 用户正在退 → 在场/给空间（退避时不做"换话题/追问"）——
    if (withdrawal > 0.45 || user.willingness_to_talk < 0.32) {
        add("show_presence", withdrawal * 0.55 + (1 - user.willingness_to_talk) * 0.4, "用户想退，在场就好");
        add("give_space", withdrawal * 0.5 + (spaceNeed(user, analysis) - companionshipNeed(user, analysis)) * 0.3 + (withdrawal > 0.75 ? 0.25 : 0), "给空间");
        if (deflect <= 0.6) add("acknowledge", 0.2, "先承认他不想说");
    }

    // —— 负面情绪（但绝不自动"安慰"，看关系/意愿/最近是否已安慰过） ——
    const closeEnough = rel.trust > 0.45 && rel.comfort > 0.4;
    if (neg > 0.28) {
        const roomToComfort = user.willingness_to_talk > 0.28 && !analysis.emotion.calmMask;
        const antiOveruse = ai.comfortCount >= 2 ? 0.28 : 0;
        add("comfort", neg * (roomToComfort ? 0.5 : 0.22) * (closeEnough ? 1.15 : 0.5) - antiOveruse, "有低落可轻抚，但看分寸");
        add("admit_uncertainty", neg * (0.5 + 0.45 * (1 - rel.trust)) + (analysis.emotion.calmMask ? 0.22 : 0) + (aiView.confidence < 0.4 ? 0.12 : 0), "不确定怎么接，可以说实话");
        add("encourage", Math.max(0, user.disappointment - 0.35) * 0.55 * (user.energy > 0.35 ? 1 : 0.45), "失望但有气力时可以推一把");
        if (withdrawal > 0.6) add("give_space", 0.35, "负面 + 退意");
    }

    // —— 开心/兴奋：顺势互动 ——
    if (analysis.emotion.primary_emotion === "joy" || happyShare > 0.4) {
        add("playful", (user.happiness * 0.35 + user.energy * 0.25) * (closeEnough ? 1.3 : 0.7) + 0.2, "情绪高涨可俏皮");
        add("ask_question", 0.35, "开心分享 → 顺势接一句");
        add("continue_topic", 0.2, "把话题聊开");
        if (aiView.mood > 0.5) add("share_self", 0.2, "她自己也开心");
    }

    // —— 被责怪 ——
    if (blame > 0.4) {
        // 无论关系：先承认（不辩解、不机械"我理解你"）
        add("acknowledge", blame * 0.6 + 0.25, "被责怪，先承认");
        add("deflect_light", trustLow ? 0.45 : 0.05, "关系生疏，轻带过不辩解");
        add("apologize", blame * 0.35 * (rel.trust > 0.4 ? 1 : 0.4) + (ai.defensiveness > 0.4 ? 0.1 : 0), "熟悉才道歉，且克制");
        add("short_response", 0.2, "不辩解、不多说");
        // 被责怪时不再"延续话题/追问"——那像在转移责任
        score.continue_topic *= 0.3;
        score.ask_question *= 0.2;
        score.change_topic *= 0.3;
    }

    // —— 话题疲劳/能量低 → 换话题或缩回（用户刚带来重要内容时绝不换）——
    const meaningfulMsg = freshNews || analysis.emotion.intensity >= 0.5; // 这条消息有分量 → 话题不陈旧
    if (ai.topicFatigue > 0.5 || (!meaningfulMsg && ctx.conversationEnergy < 0.35 && ctx.topTopic && !analysis.rawText.includes(ctx.topTopic))) {
        add("change_topic", 0.4 + Math.min(0.3, ai.topicFatigue * 0.5) - (user.willingness_to_talk < 0.4 ? 0.3 : 0), "话题累了，轻轻换一个");
    }
    // 退避时不做"换话题"
    if (withdrawal > 0.5) score.change_topic *= 0.3;

    // —— 主动开口（AI 自己起头）：不适用给空间/承认 ——
    if (proactive) {
        score.give_space = 0; score.apologize = 0; score.acknowledge = 0;
        add("share_self", 0.5, "她主动找话题/分享自己");
        add("ask_question", 0.35, "主动→抛个话头");
        add("continue_topic", ctx.topTopic ? 0.3 : 0, "接着聊");
    }

    // —— 深夜/忙碌场景（时间系统） ——
    const slot = currentSchedule();
    if (slot.label === "深夜") { add("short_response", 0.4, "深夜，话短"); score.ask_question *= 0.3; }
    if (slot.busy) { add("short_response", 0.3, "忙，压低声音短说"); }

    // —— 允许"不完美"：随意、跑题、开小差 ——
    if (imperfectionChance()) {
        if (aiView.energy < 0.4 && neg > 0.2) {
            add("admit_uncertainty", 0.5, "她也累了，说不出漂亮话");
        } else if (aiView.mood > 0.6 && Math.random() < 0.5) {
            add("playful", 0.3, "心情好，忍不住插科打诨");
        } else {
            add("change_topic", 0.2, "轻微跑题（允许不完美）");
        }
    }

    // —— 排序取前 3 ——
    const ranked = (Object.keys(score) as StrategyId[])
        .map((id) => ({ id, v: score[id] }))
        .filter((x) => x.v > 0.12)
        .sort((a, b) => b.v - a.v)
        .slice(0, 3);

    const choices: StrategyChoice[] = ranked.map((r, i) => ({ id: r.id, priority: i + 1, reason: reasons[r.id] ?? "" }));

    // —— 指令约束 ——
    const directives: string[] = [];
    if (withdrawal > 0.5 || user.willingness_to_talk < 0.35) directives.push("do_not_push");
    if (withdrawal > 0.5 || choices.some((c) => c.id === "short_response") && aiView.energy < 0.4) directives.push("keep_short");
    if (neg > 0.25 && !choices.some((c) => c.id === "comfort")) directives.push("no_forced_comfort");
    if (analysis.emotion.calmMask || analysis.needs.length === 0) directives.push("don_t_read_mind");
    if (trustLow) directives.push("subtle");
    if (neg > 0.35 && choices.some((c) => c.id === "comfort") && !closeEnough) directives.push("no_psychoanalysis");
    if (choices.some((c) => c.id === "comfort")) directives.push("not_a_counselor");

    return { choices, directives: directives.slice(0, 5), text: StrategyPromptText(choices, directives) };
}

function spaceNeed(user: UserMindState, a: MessageAnalysis): number {
    const s = a.needs.find((n) => n.need === "space")?.confidence ?? 0;
    return clamp01(s * 0.7 + (1 - user.willingness_to_talk) * 0.3);
}
function companionshipNeed(user: UserMindState, a: MessageAnalysis): number {
    const c = a.needs.find((n) => n.need === "companionship")?.confidence ?? 0;
    return clamp01(c * 0.7 + user.loneliness * 0.3);
}

// 策略 → 紧凑文本（注入 LLM）
export function StrategyPromptText(choices: StrategyChoice[], directives: string[]): string {
    const nameMap: Record<StrategyId, string> = {
        short_response: "简短回应", ask_question: "追问一句", show_presence: "表示在场", comfort: "轻声安慰",
        encourage: "鼓励", playful: "轻松俏皮", continue_topic: "延续话题", change_topic: "换个话题",
        give_space: "给空间", apologize: "道歉", acknowledge: "承认事实", admit_uncertainty: "承认不会接",
        share_self: "分享自己", deflect_light: "轻描淡写带过", greet: "打招呼",
    };
    const ruleMap: Record<StrategyId, string> = {
        short_response: "本轮极短：最多一句（≤15字），不展开。",
        ask_question: "抛一个具体、好回答的问题（跟着当前话题走），不要连环问。",
        show_presence: "表达'我在'即可：1~2句，不做分析、不催促、不挽留。",
        comfort: "可以轻声安抚，只1~2句；绝不长篇说教，绝不'我理解你现在的感受'这种套话。",
        encourage: "给一点小而实在的希望或鼓励，不空喊加油。",
        playful: "语气可以轻松俏皮，开个小玩笑，但别脱线。",
        continue_topic: "顺着当前话题自然延展，先接住对方的话。",
        change_topic: "用一个自然过渡（『对了…』『话说回来…』）把话题带得轻松一点。",
        give_space: "允许对方沉默/离开：一句话表示尊重，不追问、不挽留、不'你是不是有情绪'。",
        apologize: "可以道歉（按关系选择认真或轻描淡写），不卑不亢，不反复道歉。",
        acknowledge: "先承认对方刚才的话（『你刚才说的…』『你说得对…』），不辩解、不反驳。",
        admit_uncertainty: "允许说『我也不太会接』『不知道怎么安慰』这种真实的话——比套话更自然。",
        share_self: "以自己的小事/真实感受回应，把对话变成双向，1~2句。",
        deflect_light: "轻轻带过，不辩解也不深究，可以自然地转移话题。",
        greet: "自然打个招呼，1句。",
    };
    const dmMap: Record<string, string> = {
        do_not_push: "禁止提问、追问与劝慰长文——对方不再想说了。",
        keep_short: "全篇保持简短。",
        no_forced_comfort: "禁止心理咨询式安慰（『我理解你的感受』『你一定很不容易』这类句子不要出现）。",
        don_t_read_mind: "不要替对方说出『你其实想…』——猜测只能作为观察，不能当事实。",
        subtle: "你们还不熟/有张力，语气保持分寸与距离。",
        no_psychoanalysis: "对方没有开口求助时不做心理分析，不要自动当心理医生。",
        not_a_counselor: "你不是心理咨询师：对方没求助就不做治疗性长文；允许普通、笨拙、真实的回应。",
    };
    const list = choices.map((c, i) => `${i + 1}. ${nameMap[c.id]}${c.reason ? `（${c.reason}）` : ""}：${ruleMap[c.id]}`).join("\n");
    const dm = directives.map((d) => `- ${dmMap[d] ?? d}`).join("\n");
    return `【STRATEGY（本轮对话策略，必须遵守。这是决策层给你的指令，不是建议）】\n${list}\n${dm ? `【禁止项】\n${dm}` : ""}`;
}

// ============ 组装紧凑上下文（第十五节格式，压缩后给 LLM） ============

export function buildAgentPrompt(args: {
    user: UserMindState;
    ai: AiMindState;
    aiView: ReturnType<typeof aiStateView>;
    rel: ReturnType<typeof relationshipView>;
    ctx: ConversationContext;
    analysis: MessageAnalysis;
    strategy: ConversationStrategy;
}): string {
    const { user, ai, aiView, rel, ctx, analysis, strategy } = args;
    // prompt 用两位小数的完整形式（0.38 比 .38 更清晰）
    const p = (v: number) => v.toFixed(2);
    const moodName = ["很低落", "低落", "有些低", "平稳", "还不错", "挺好", "很好"][Math.round(aiView.mood * 6)] ?? "平稳";
    const topEmo = analysis.emotion.primary_emotion === "neutral" ? "平静" : analysis.emotion.primary_emotion;
    const intents = analysis.intents.filter((i) => i.surface_intent !== "neutral").map((i) => `${i.surface_intent} ${p(i.score)}`).join(" / ") || "普通交流";
    const needs = analysis.needs.length
        ? analysis.needs.map((n) => `${n.need} ${p(n.confidence)}`).join(" / ")
        : "（不确定）";
    const recent = ctx.recentEvents.length ? ctx.recentEvents.slice(-3).join("；") : "（没有特别的事）";
    const unresolved = ctx.unresolvedEvents.length ? ctx.unresolvedEvents.slice(-2).join("；") : "（无）";
    const trendZh = { rising: "回暖", falling: "走低", stable: "平稳", unstable: "起伏" }[ctx.emotionalTrend];

    return [
        `【CURRENT CONTEXT——内部状态摘要（这是决策层结论，不要自己重算；根据它自然表达）】`,
        `USER`,
        `  emotion: ${topEmo} ${p(analysis.emotion.intensity)} (${analysis.emotion.calmMask ? "表面平静，可能有所保留" : ""})`,
        `  intent: ${intents}`,
        `  willingness_to_talk: ${p(user.willingness_to_talk)}`,
        `  possible_needs: ${needs}（只是假设，不要直接戳破）`,
        `  recent: ${recent}`,
        `  context: 话题[${ctx.topTopic || "无"}] · 情绪走向${trendZh} · 对话能量${p(ctx.conversationEnergy)}`,
        `  unresolved: ${unresolved}`,
        `AI`,
        `  mood: ${moodName}(${p(aiView.mood)}) · energy ${p(aiView.energy)} · curiosity ${p(ai.curiosity)}`,
        `  willingness_to_talk: ${p(ai.willingness_to_talk)} · interest ${p(ai.interest)}`,
        `RELATIONSHIP`,
        `  familiarity ${p(rel.familiarity)} · trust ${p(rel.trust)} · comfort ${p(rel.comfort)} · tension ${p(rel.tension)}`,
        ``,
        strategy.text,
    ].join("\n");
}

// ============ 管线：分析 → 上下文 → 状态更新 → 策略 → 组装 ============

export function runAgentPipeline(text: string, opts: { proactive?: boolean; likes?: string }): AgentTurn {
    const proactive = opts?.proactive ?? false;

    // 先做时间衰减（离线/跨时段后情绪自然回落；主动开口同样结算时间）
    const lastAgentAt = (store as any).lastAgentVirtualAt || 0;
    if (lastAgentAt > 0) {
        const elapsed = store.virtualMs - lastAgentAt;
        if (elapsed > 0) applyTimeDecay(elapsed);
    }

    const mind = loadMindState();
    const analysis: MessageAnalysis = proactive
        ? { emotion: { primary_emotion: "neutral", secondary_emotions: [], intensity: 0, valence: 0, arousal: 0.2, confidence: 0.2, calmMask: false }, intents: [{ surface_intent: "neutral", score: 0.2 }], needs: [], rawText: "" }
        : analyzeMessage(text);

    const ctx = buildContext({ proactive });

    // 用户状态
    const u = updateUserState(mind.user, analysis, ctx, { lastAiTopic: mind.ai.lastTopic });
    const ai = updateAiMind(mind.ai, analysis, ctx, { likes: opts?.likes });
    const rel = updateRelationship(mind.rel, analysis);
    // 重大事件标记 → 关系状态（放慢后续情绪衰减）+ 注入上下文 recent
    // 注意：先取出常量再收窄，箭头函数回调内属性收窄会失效（TS2345）
    const majorLabel = u.majorEventLabel;
    if (majorLabel) {
        rel.next.lastMajorLabel = majorLabel;
        rel.next.lastMajorTurn = store.turnCount;
        rel.next.lastMajorVirtualAt = store.virtualMs;
        if (!ctx.recentEvents.some((r) => r.includes(majorLabel))) {
            ctx.recentEvents.push(majorLabel);
        }
    }

    // 策略（依赖全部状态）
    const aiView = aiStateView(ai.next);
    const relView = relationshipView(rel.next);
    const strategy = selectStrategy({ user: u.next, ai: ai.next, aiView, rel: relView, ctx, analysis, proactive });

    // 连续安慰防沉迷：选择 comfort 计数器 +1，否则回落
    if (strategy.choices.some((c) => c.id === "comfort")) ai.next.comfortCount += 1;
    else ai.next.comfortCount = Math.max(0, ai.next.comfortCount - 1);

    // 持久化
    (store as any).userMind = u.next;
    (store as any).aiMind = ai.next;
    (store as any).relMind = rel.next;
    (store as any).lastAgentVirtualAt = store.virtualMs;
    saveState();

    // 轨迹
    traceSeq += 1;
    const trace: AgentTraceEntry = {
        id: traceSeq,
        realAt: Date.now(),
        virtualAt: store.virtualMs,
        userText: proactive ? "（她主动开口）" : text,
        detectedSignal: `${analysis.emotion.primary_emotion} ${fmt(analysis.emotion.intensity)}${analysis.emotion.calmMask ? " [calm_mask]" : ""}` +
            (analysis.intents.filter((i) => i.surface_intent !== "neutral").length ? " / " + analysis.intents.filter((i) => i.surface_intent !== "neutral").map((i) => `${i.surface_intent} ${fmt(i.score)}`).join(" / ") : ""),
        stateTransition: u.transitions.concat(ai.transitions, rel.transitions).slice(0, 4).join(" · "),
        strategySummary: strategy.choices.map((c) => c.id).join(" + ") + (strategy.directives.length ? ` [${strategy.directives.join(", ")}]` : ""),
        response: "",
        refined: "",
        proactive,
    };
    agentTrace.push(trace);
    if (agentTrace.length > MAX_TRACE) agentTrace.shift();

    const prompt = buildAgentPrompt({
        user: u.next, ai: ai.next, aiView, rel: relView, ctx, analysis, strategy,
    });

    return {
        analysis, context: ctx,
        userBefore: mind.user, userAfter: u.next,
        aiBefore: mind.ai, aiAfter: ai.next,
        relTensionBefore: mind.rel.tension, relTensionAfter: rel.next.tension,
        strategy, prompt, trace, proactive,
    };
}

// LLM 在同一轮回传 user_analysis → 语义微调（只作小幅修正，不推翻本地信号）
export function refineWithModelAnalysis(turn: AgentTurn, refined: RefinedAnalysis | null | undefined) {
    if (!refined || typeof refined !== "object") return;
    const analysis = turn.analysis;
    const emo = analysis.emotion;
    const upd: string[] = [];
    if (typeof refined.primary_emotion === "string" && EMOTION_BASE[refined.primary_emotion]) {
        emo.primary_emotion = refined.primary_emotion;
        upd.push("emotion→" + refined.primary_emotion);
    }
    if (typeof refined.intensity === "number" && refined.intensity >= 0 && refined.intensity <= 1 && Math.abs(refined.intensity - emo.intensity) >= 0.12) {
        emo.intensity = refined.intensity;
        upd.push("intensity→" + fmt(refined.intensity));
    }
    if (typeof refined.intents === "object" && refined.intents) {
        for (const [k, v] of Object.entries(refined.intents)) {
            if (typeof v === "number" && v > 0.3) {
                const existing = analysis.intents.find((i) => i.surface_intent === k);
                if (existing) existing.score = (existing.score + v) / 2;
                else analysis.intents.push({ surface_intent: k, score: v });
                upd.push("intent+" + k);
            }
        }
    }
    if (typeof refined.needs === "object" && refined.needs) {
        for (const [k, v] of Object.entries(refined.needs)) {
            if (typeof v === "number" && v > 0.2 && !analysis.needs.some((n) => n.need === k)) {
                analysis.needs.push({ need: k, confidence: v });
            }
        }
        analysis.needs.sort((a, b) => b.confidence - a.confidence);
    }
    if (upd.length) turn.trace.refined = upd.join(" / ");
}

// 回复生成后回填轨迹
export function finishAgentTurn(turn: AgentTurn, response: string) {
    turn.trace.response = (response || "").slice(0, 80);
}

export function getAgentTrace(): AgentTraceEntry[] {
    return agentTrace.slice();
}

// 快照/恢复（重答回滚用）
export function snapshotAgentMind(): { user: UserMindState; ai: AiMindState; rel: RelMindState; traceLen: number } {
    const m = loadMindState();
    return { user: m.user, ai: m.ai, rel: m.rel, traceLen: agentTrace.length };
}
export function restoreAgentMind(snap: { user: UserMindState; ai: AiMindState; rel: RelMindState; traceLen: number }) {
    (store as any).userMind = { ...snap.user };
    (store as any).aiMind = { ...snap.ai };
    (store as any).relMind = { ...snap.rel };
    (store as any).lastAgentVirtualAt = store.virtualMs;
    agentTrace.length = snap.traceLen;
}

// 重置（新档）
export function resetAgentMind() {
    (store as any).userMind = defaultUserMind();
    (store as any).aiMind = defaultAiMind();
    (store as any).relMind = defaultRelMind();
    (store as any).lastAgentVirtualAt = store.virtualMs;
    agentTrace.length = 0;
    saveState();
}

// 调试/测试钩子数据
export function debugSnapshot() {
    const mind = loadMindState();
    const aiView = aiStateView(mind.ai);
    const rel = relationshipView(mind.rel);
    return { user: mind.user, ai: mind.ai, aiView, rel, trace: getAgentTrace() };
}

// 测试辅助（不参与正式流程）：暴露底层引用供控制台/自动化验证
export const mindTestHooks = {
    store,
    aiState,
    scheduleIndexFor,
    getTrace: getAgentTrace,
};
