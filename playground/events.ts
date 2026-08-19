// events.ts —— 随机事件触发器（只负责“何时触发”，事件内容由 AI 生成）
// 依据：日程(agenda) / 对话上下文 / 38维情绪 / 剧情线 —— 这些都已注入系统提示词，
// 这里仅在合适时机给 AI 一条“此刻自然发生一件小事”的指令，让 AI 依据当下情境自行生成事件。
//
// 触发规则：
// - 每轮用户消息前 30% 概率触发；连续 3 轮未触发则强制触发
// - 触发后至少间隔 2 轮；保证每 5~8 轮对话至少出现一次，单次对话不连续刷屏

// ============ 触发指令（措辞多变，避免 AI 模式化应对） ============

const TRIGGER_DIRECTIVES: string[] = [
    "【此刻的小事】结合你正在做的事、今日日程、当前情绪和剧情线，此刻自然发生一件具体鲜活的小事（天气或环境变化、手机消息、突然想起的事、注意到对方的一个细节等）。自然地把它带进这轮回应里——可以一句话带过，也可以展开成小插曲。不要生硬汇报，不要压过主线话题，更不要为写而写：没有合适的小事就轻轻略过。",
    "【情境插曲】现在依据你的处境自然发生一件小小的日常事件（周围的声音/光线的变化、收到一条消息、脑海里闪过一个念头、对方身上的小细节等），把它自然融入这轮回复。要贴合此刻的时间、地点、你在做的事和心情，别打断主线，别硬凑。",
    "【随机小插曲】此刻，一件与当下情境相符的小事悄然发生（可能和环境有关，也可能和你此刻的心情、正在推进的事有关）。自然地提及它，让它成为对话的一部分，不刻意、不抢戏。",
];

// ============ 触发状态（防重复/防过频） ============

const MIN_GAP = 2;             // 触发后至少间隔 2 轮
const FORCE_AFTER = 3;         // 连续 3 轮未触发 → 强制触发
const INJECT_CHANCE = 0.3;     // 每轮触发概率

let turnCounter = 0;
let lastTriggeredTurn = -99;
let directiveCursor = 0;

/** 重置（新会话/重置存档时调用） */
export function resetEventTracker() {
    turnCounter = 0;
    lastTriggeredTurn = -99;
}

/**
 * 掷一次事件触发骰子。
 * @returns 触发时返回给 AI 的“生成事件”指令文本；未触发返回 null。
 */
export function rollEventSeed(): string | null {
    turnCounter++;

    // 强制条件：连续 3 轮未触发
    const forced = turnCounter - lastTriggeredTurn > FORCE_AFTER;
    // 最小间隔：触发后 2 轮内不重复触发（强制除外）
    if (!forced && turnCounter - lastTriggeredTurn <= MIN_GAP) return null;
    // 概率判定
    if (!forced && Math.random() > INJECT_CHANCE) return null;

    lastTriggeredTurn = turnCounter;
    // 轮转指令措辞，避免每轮指令文本完全相同
    const directive = TRIGGER_DIRECTIVES[directiveCursor % TRIGGER_DIRECTIVES.length]!;
    directiveCursor++;

    console.log(`[事件触发] ✅ 注入生成指令 (turn=${turnCounter}${forced ? ", 强制" : ""})`);
    return directive;
}
