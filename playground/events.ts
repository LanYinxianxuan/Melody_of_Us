// events.ts —— 随机事件种子池（代码层主动注入，不依赖 AI 自觉）
// 每轮用户发送消息前，由 chat.ts 调用 rollEventSeed()：
// - 30% 概率注入一个事件种子；连续 3 轮未注入则强制注入
// - 同一事件 5 轮内不重复；注入后至少间隔 2 轮
// 事件种子作为"情境插曲"拼入系统提示词，引导 AI 自然融入，不打断对话主线。

export interface EventSeed {
    id: string;
    type: "env" | "behavior" | "interaction";
    /** 注入给 AI 的情境描述（具体、有画面感，15~40 字） */
    text: string;
}

// ============ 事件池 ============

const EVENT_POOL: EventSeed[] = [
    // —— 环境变化 ——
    { id: "env-rain", type: "env", text: "窗外忽然暗下来像要下雨，一阵风裹着凉意吹进来，她下意识拢了拢衣领。" },
    { id: "env-sound", type: "env", text: "不远处传来一阵不小的动静，她好奇地偏头看了一眼，又转回来。" },
    { id: "env-msg", type: "env", text: "她的手机震了一下，屏幕亮起一条消息，她扫了一眼没点开。" },
    { id: "env-melody", type: "env", text: "远处飘来一段熟悉的旋律，她跟着轻轻哼了两句。" },
    { id: "env-lights", type: "env", text: "头顶的灯闪了一下，光线暗了一瞬又恢复，两人相视一愣。" },
    // —— 角色行为 ——
    { id: "bhv-remember", type: "behavior", text: "她忽然想起什么，从口袋里摸出一个小东西在手里转了转。" },
    { id: "bhv-sneeze", type: "behavior", text: "她打了个喷嚏，揉了揉鼻子，小声嘟囔好像有点着凉。" },
    { id: "bhv-clock", type: "behavior", text: "她低头看了一眼时间，轻声说都这个点了。" },
    { id: "bhv-daydream", type: "behavior", text: "她盯着窗外出了会儿神，才回过神来看向你。" },
    { id: "bhv-doodle", type: "behavior", text: "她随手在纸上画了个什么东西，画完又赶紧划掉了。" },
    // —— 互动提议 ——
    { id: "act-earphone", type: "interaction", text: "她把耳机分出一只递给你，问要不要一起听她最近循环的歌。" },
    { id: "act-hungry", type: "interaction", text: "她摸了摸肚子说有点饿了，问你要不要一起去弄点吃的。" },
    { id: "act-story", type: "interaction", text: "她忽然笑着说想到个有意思的事，想讲给你听。" },
    { id: "act-cold-hand", type: "interaction", text: "她小声说手有点冷，问能不能借你焐一下，就一下。" },
    { id: "act-plan", type: "interaction", text: "她提议周末要不要一起去某个地方走走，问你怎么想。" },
];

// ============ 注入状态（防重复/防过频） ============

const MAX_REPEAT_WINDOW = 5;   // 最近 5 轮内不重复同一事件
const MIN_GAP = 2;             // 注入后至少间隔 2 轮
const FORCE_AFTER = 3;         // 连续 3 轮未注入 → 强制注入
const INJECT_CHANCE = 0.3;     // 每轮注入概率（25%~40% 区间取 30%）

let turnCounter = 0;
let lastInjectedTurn = -99;
let lastEventIds: string[] = [];

/** 重置（新会话/重置存档时调用） */
export function resetEventTracker() {
    turnCounter = 0;
    lastInjectedTurn = -99;
    lastEventIds = [];
}

/** 选取一个未在最近窗口内用过的事件种子 */
function pickSeed(): EventSeed | null {
    const candidates = EVENT_POOL.filter((e) => !lastEventIds.includes(e.id));
    const pool = candidates.length ? candidates : EVENT_POOL;
    return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

/**
 * 掷一次事件注入骰子。
 * @returns 注入的事件种子文本；未注入返回 null。
 */
export function rollEventSeed(): string | null {
    turnCounter++;

    // 强制条件：连续 3 轮未注入
    const forced = turnCounter - lastInjectedTurn > FORCE_AFTER;
    // 最小间隔：注入后 2 轮内不重复注入（强制除外）
    if (!forced && turnCounter - lastInjectedTurn <= MIN_GAP) return null;
    // 概率判定
    if (!forced && Math.random() > INJECT_CHANCE) return null;

    const seed = pickSeed();
    if (!seed) return null;

    // 记录使用
    lastInjectedTurn = turnCounter;
    lastEventIds.push(seed.id);
    if (lastEventIds.length > MAX_REPEAT_WINDOW) lastEventIds.shift();

    console.log(`[事件注入] ✅ type=${seed.type} id=${seed.id} (turn=${turnCounter}${forced ? ", 强制" : ""})`);
    return seed.text;
}
