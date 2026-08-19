// actions.ts —— 动作补全库
// 若 AI 返回的 action 为空或过于泛泛（"坐着""点头"），
// 按当前主导情感从动作库中选取一个具体、有画面感的动作补全。

// 按情感分组的具体动作（5~15 字，可读性强，避免重复用词）
const ACTION_LIBRARY: Record<string, string[]> = {
    joy: [
        "开心地晃了晃脑袋，嘴角止不住上翘",
        "眼睛亮起来，笑意藏都藏不住",
        "忍不住笑出声，随即又有点不好意思",
    ],
    sadness: [
        "低下头，声音轻轻软下来",
        "捏了捏衣角，眼眶有点发热",
        "别过脸去，声音闷闷的",
    ],
    anger: [
        "别过脸，语气硬邦邦的",
        "皱着眉，手里的笔被转得飞快",
        "咬着嘴唇，压着火没发作",
    ],
    fear: [
        "下意识攥紧了手指，声音有点抖",
        "缩了缩肩膀，往你身边靠近一点",
        "紧张地咽了咽口水",
    ],
    shyness: [
        "脸一红，目光躲开去",
        "小声嘟囔着，手指绞在一起",
        "耳朵尖悄悄红了，低头不看你",
    ],
    embarrassment: [
        "窘得耳根发烫，连忙摆手",
        "尴尬地笑了笑，眼神躲闪",
        "恨不得找个地缝钻进去，声音越来越小",
    ],
    jealousy: [
        "瞥了你一眼，酸溜溜地别过脸",
        "笑容淡了淡，语气带着试探",
        "低头摆弄着东西，声音闷闷的",
    ],
    loneliness: [
        "看着你，欲言又止，往你身边挪了挪",
        "声音低低的，像在确认你还在",
        "抱着膝盖，轻轻说了句什么",
    ],
    anxiety: [
        "坐立不安地换了换姿势，指尖敲着桌面",
        "眉头微蹙，心不在焉地摆弄手里的东西",
        "咬了咬下唇，像是下了什么决心",
    ],
    anticipation: [
        "眼睛亮亮的，整个人往前倾了倾",
        "兴奋地搓了搓手，语速不自觉变快",
        "唇角压不住地翘起来，期待地看着你",
    ],
    fatigue: [
        "打了个哈欠，眼皮有点沉",
        "声音懒懒的，往椅背上靠了靠",
        "揉了揉眉心，说话慢悠悠的",
    ],
    nervousness: [
        "紧张地搓着手指，声音发紧",
        "咽了咽口水，眼神有点飘忽",
        "指尖不自觉地绞着衣角",
    ],
    confidence: [
        "抬起头，语气笃定",
        "微微扬起下巴，眼神坚定",
        "利落地应了一声，带着点自信的劲儿",
    ],
};

const GENERIC_ACTIONS: string[] = [
    "抬头看你一眼，笑了笑",
    "偏过头想了想，才开口",
    "指尖轻轻敲了敲桌面",
    "整理了一下头发，继续说着",
];

// ============ 主导情感判定 ============

function dominantEmotion(emotions: Record<string, number>): string {
    const candidates: Array<[string, number]> = [
        ["joy", emotions.joy ?? 0],
        ["sadness", emotions.sadness ?? 0],
        ["anger", emotions.anger ?? 0],
        ["fear", emotions.fear ?? 0],
        ["shyness", emotions.shyness ?? 0],
        ["embarrassment", emotions.embarrassment ?? 0],
        ["jealousy", emotions.jealousy ?? 0],
        ["loneliness", emotions.loneliness ?? 0],
        ["anxiety", emotions.anxiety ?? 0],
        ["anticipation", emotions.anticipation ?? 0],
        ["fatigue", emotions.fatigue ?? 0],
        ["nervousness", emotions.nervousness ?? 0],
        ["confidence", emotions.confidence ?? 0],
    ];
    candidates.sort((a, b) => b[1] - a[1]);
    return candidates[0]![1] > 45 ? candidates[0]![0] : "generic";
}

// 轮转下标：保证同情感下动作不连续重复
let actionCursor = 0;

/** 按情感选取补全动作 */
export function fallbackAction(emotions: Record<string, number>): string {
    const group = dominantEmotion(emotions);
    const pool = group === "generic" ? GENERIC_ACTIONS : ACTION_LIBRARY[group] ?? GENERIC_ACTIONS;
    const item = pool[actionCursor % pool.length]!;
    actionCursor++;
    return item;
}

/**
 * 判断 action 是否过于泛泛（需要补全）。
 * 空、过短、或命中"坐着/站着/看着她/点头"等空泛表述 → true。
 */
export function isGenericAction(action: string): boolean {
    const a = action.trim();
    if (!a || a.length < 4) return true;
    return /^(她|他|我)?(坐着|站着|看着她|看着他|看了看|点了点头|笑了笑|笑了笑说|嗯|点头|沉默|顿了一下)$/.test(a);
}
