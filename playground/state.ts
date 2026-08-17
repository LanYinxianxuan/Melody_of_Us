// state.ts —— 38 维情感状态机：维度定义、数值管理、状态描述
// 纯数据/逻辑层，不操作 DOM。

export interface AIState {
    [k: string]: number;
}

export type DimGroup = "personality" | "relation" | "emotion" | "status" | "shadow";

export interface DimMeta {
    key: string;
    label: string;
    color: string;
    group: DimGroup;
    baseline: number;
    regression: number; // 每轮向基线回归比例（人格≈0，情绪高）
}

export const DIMENSIONS: DimMeta[] = [
    // 🎭 人格
    { key: "openness", label: "🌌 开放", color: "#818cf8", group: "personality", baseline: 60, regression: 0 },
    { key: "conscientiousness", label: "📋 尽责", color: "#60a5fa", group: "personality", baseline: 65, regression: 0 },
    { key: "extraversion", label: "🎤 外向", color: "#fbbf24", group: "personality", baseline: 55, regression: 0 },
    { key: "agreeableness", label: "🕊 宜人", color: "#34d399", group: "personality", baseline: 70, regression: 0 },
    { key: "neuroticism", label: "🌧 敏感", color: "#94a3b8", group: "personality", baseline: 45, regression: 0 },
    // ❤️ 关系（初始是刚认识的陌生人，基线低，靠对话慢慢积累）
    { key: "affection", label: "💕 好感", color: "#ff6b9d", group: "relation", baseline: 25, regression: 0.02 },
    { key: "trust", label: "🤝 信任", color: "#5b8def", group: "relation", baseline: 15, regression: 0.02 },
    { key: "intimacy", label: "💞 亲密", color: "#c084fc", group: "relation", baseline: 5, regression: 0.02 },
    { key: "loyalty", label: "🛡 忠诚", color: "#4ade80", group: "relation", baseline: 10, regression: 0.015 },
    { key: "dependence", label: "🧲 依赖", color: "#f472b6", group: "relation", baseline: 5, regression: 0.02 },
    { key: "familiarity", label: "👋 熟悉", color: "#38bdf8", group: "relation", baseline: 5, regression: 0.01 },
    // 💭 情绪
    { key: "joy", label: "😊 喜悦", color: "#facc15", group: "emotion", baseline: 40, regression: 0.25 },
    { key: "sadness", label: "😢 悲伤", color: "#60a5fa", group: "emotion", baseline: 10, regression: 0.22 },
    { key: "anger", label: "😠 愤怒", color: "#ef4444", group: "emotion", baseline: 0, regression: 0.3 },
    { key: "fear", label: "😨 恐惧", color: "#8b5cf6", group: "emotion", baseline: 5, regression: 0.2 },
    { key: "surprise", label: "😲 惊讶", color: "#fb923c", group: "emotion", baseline: 10, regression: 0.35 },
    { key: "disgust", label: "🤢 厌恶", color: "#84cc16", group: "emotion", baseline: 0, regression: 0.28 },
    { key: "shyness", label: "😳 害羞", color: "#f472b6", group: "emotion", baseline: 30, regression: 0.2 },
    { key: "embarrassment", label: "😅 尴尬", color: "#fdba74", group: "emotion", baseline: 8, regression: 0.3 },
    { key: "jealousy", label: "🍋 嫉妒", color: "#a3e635", group: "emotion", baseline: 3, regression: 0.25 },
    { key: "loneliness", label: "🌙 孤独", color: "#7dd3fc", group: "emotion", baseline: 12, regression: 0.18 },
    { key: "anxiety", label: "🌫 焦虑", color: "#94a3b8", group: "emotion", baseline: 15, regression: 0.15 },
    { key: "anticipation", label: "✨ 期待", color: "#fde047", group: "emotion", baseline: 25, regression: 0.25 },
    // 🫀 状态
    { key: "fatigue", label: "🥱 疲惫", color: "#fbbf24", group: "status", baseline: 10, regression: 0.05 },
    { key: "energy", label: "🔋 精力", color: "#4ade80", group: "status", baseline: 70, regression: 0.06 },
    { key: "stress", label: "🔥 压力", color: "#f87171", group: "status", baseline: 15, regression: 0.12 },
    { key: "nervousness", label: "😰 紧张", color: "#f59e0b", group: "status", baseline: 20, regression: 0.25 },
    { key: "confidence", label: "💪 自信", color: "#34d399", group: "status", baseline: 45, regression: 0.05 },
    // 🖤 阴影
    { key: "greed", label: "💰 贪婪", color: "#f59e0b", group: "shadow", baseline: 15, regression: 0.15 },
    { key: "lust", label: "💋 色欲", color: "#e11d48", group: "shadow", baseline: 20, regression: 0.15 },
    { key: "vanity", label: "🪞 虚荣", color: "#d946ef", group: "shadow", baseline: 25, regression: 0.12 },
    { key: "possessiveness", label: "🔒 占有欲", color: "#be123c", group: "shadow", baseline: 20, regression: 0.1 },
    { key: "pride", label: "👑 傲慢", color: "#a78bfa", group: "shadow", baseline: 20, regression: 0.12 },
    { key: "ambition", label: "🎯 野心", color: "#f97316", group: "shadow", baseline: 40, regression: 0.05 },
    { key: "selfishness", label: "🍰 自私", color: "#fb7185", group: "shadow", baseline: 15, regression: 0.12 },
    { key: "laziness", label: "🛋 懒惰", color: "#9ca3af", group: "shadow", baseline: 30, regression: 0.08 },
    { key: "shame", label: "🙈 羞耻", color: "#f472b6", group: "shadow", baseline: 5, regression: 0.2 },
    { key: "guilt", label: "💔 内疚", color: "#64748b", group: "shadow", baseline: 5, regression: 0.2 },
];

export const INITIAL_STATE: AIState = Object.fromEntries(DIMENSIONS.map((d) => [d.key, d.baseline]));

export let aiState: AIState = { ...INITIAL_STATE };

// 重置（不重新绑定，保持 import 引用有效）
export function resetState() {
    Object.assign(aiState, INITIAL_STATE);
    for (const k of Object.keys(aiState)) {
        if (!(k in INITIAL_STATE)) delete aiState[k];
    }
}

export function clamp(v: number): number {
    return Math.max(0, Math.min(100, v));
}

// 应用 AI 返回的 delta + 惯性回归
export function applyDelta(delta: Record<string, number | undefined>) {
    for (const dim of DIMENSIONS) {
        const key = dim.key;
        const d = delta[key];

        if (typeof d === "number") {
            aiState[key] = clamp(aiState[key] + d);
        }

        // 人格不回归，其余按半衰期回归
        if (dim.regression > 0) {
            aiState[key] += (dim.baseline - aiState[key]) * dim.regression;
        }
    }

    // 每轮消耗：疲惫微增
    aiState["fatigue"] = clamp(aiState["fatigue"] + 0.015);
}

// 用户情绪兜底修正
export const USER_EMOTION_FIX: Record<string, Partial<AIState>> = {
    joy: { affection: 1, joy: 2, energy: 1, nervousness: -1 },
    anger: { affection: -2, trust: -1, anger: 2, stress: 1 },
    sad: { affection: 1, sadness: 2, joy: -2, energy: -1 },
    shy: { affection: 1, shyness: 2, embarrassment: 1 },
    surprised: { surprise: 3, anticipation: 1 },
    neutral: {},
};

// 状态 → 文字描述
export function describeMood(): string {
    const parts: string[] = [];
    const p = (key: string, high: string, low: string, th: number) => {
        if (aiState[key] > 60) parts.push(high);
        else if (aiState[key] < 35 && low) parts.push(low);
    };

    p("affection", "很喜欢你，亲近感十足", "对你没什么好感，保持距离", 60);
    p("trust", "非常信任你", "不太信任你，话留三分", 60);
    p("intimacy", "和你很亲密", "", 60);
    p("loyalty", "认定你这个人了", "", 60);
    p("dependence", "有点离不开你了", "", 55);
    p("familiarity", "和你已经很熟了", "", 55);
    p("joy", "心情明朗", "心里闷闷的", 55);
    p("sadness", "心里难过", "", 50);
    p("anger", "很生气，压着火", "情绪平和", 55);
    p("fear", "有点害怕", "", 45);
    p("surprise", "惊讶还没缓过来", "", 50);
    p("disgust", "有点嫌弃", "", 40);
    p("shyness", "动不动就害羞脸红", "", 55);
    p("embarrassment", "尴尬得想躲起来", "", 45);
    p("jealousy", "在吃醋", "", 40);
    p("loneliness", "觉得孤单", "", 45);
    p("anxiety", "心里很不安", "", 50);
    p("anticipation", "很期待接下来", "", 55);
    p("fatigue", "很疲惫，想休息", "", 55);
    p("energy", "", "没什么精神", 45);
    p("stress", "压力很大", "", 50);
    p("nervousness", "紧张得说话打结", "", 50);
    p("confidence", "自信满满", "没什么自信，说话小声", 55);

    // 阴影层（平时潜伏，浮现时体现人性的复杂面）
    p("greed", "心里偷偷想要更多", "", 45);
    p("lust", "对你有种特别的渴望", "", 40);
    p("vanity", "在意自己在你眼里的样子", "", 50);
    p("possessiveness", "不想你眼里有别人", "", 40);
    p("pride", "有点端着小架子", "", 45);
    p("ambition", "暗暗有自己想做的事", "", 60);
    p("selfishness", "有点先顾着自己", "", 40);
    p("laziness", "能躺着绝不坐着", "", 55);
    p("shame", "羞得想找个洞钻进去", "", 40);
    p("guilt", "心里觉得对不起你", "", 40);

    return parts.join("；") || "状态平稳";
}

// 主导特质
export function dominantTrait(): string {
    const list: [string, number][] = Object.entries(aiState)
        .filter(([k]) => DIMENSIONS.some((d) => d.key === k && d.group === "emotion" || d.key === k && d.group === "relation"))
        .map(([k, v]) => [k, v as number]);
    list.sort((a, b) => b[1] - a[1]);
    const [key, val] = list[0]!;
    if (val < 30) return "平稳";
    const labels: Record<string, string> = {
        affection: "心动", anger: "生气", shyness: "害羞", fear: "不安", joy: "喜悦",
        sadness: "悲伤", jealousy: "吃醋", loneliness: "孤独", fatigue: "疲惫",
        anxiety: "焦虑", nervousness: "紧张", confidence: "自信", anticipation: "期待",
        embarrassment: "尴尬",
    };
    return labels[key] ?? key;
}

export const EMOTION_NAMES: Record<string, string> = {
    joy: "😊 开心", anger: "😠 生气", sad: "😢 难过", shy: "😳 害羞", surprised: "😲 惊讶", neutral: "😐 平静",
    jealousy: "😒 吃醋", greed: "🤑 心动礼物", guilt: "😔 内疚", lazy: "😴 想偷懒",
};
