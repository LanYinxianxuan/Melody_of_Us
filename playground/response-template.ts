// response-template.ts —— 统一回复模板规范
// 所有 AI 回复（主角/NPC/Demo）都遵循此格式

// ============ 通用字段说明 ============

/**
 * 对话回复 JSON 格式规范
 *
 * 必填字段：
 * - dialogue: string  — 她说的话（纯对话，不含动作/表情/时间标签）
 *   · 分 1~2 段，用 \n 分隔
 *   · 每段 20~40 字，总长 60 字左右
 *   · 结构：先承接对方的话 → 说自己的 → 以提问或邀请收尾
 *   · ❌ 不要放：动作描写、时间标签、[第X天]、（表情）
 *
 * - action: string    — 动作/表情描写（纯动作，不含对话）
 *   · 20 字内
 *   · 例如：低头笑了笑、别过脸去、脸一下子红了
 *   · ❌ 不要放：对话内容
 *
 * - thoughts: string  — 内心想法
 *   · 20 字内
 *   · 例如：心跳好快…、他/她怎么突然说这种话
 *
 * 可选字段：
 * - delta: Record<string, number>  — 情感维度变化量（-15~15）
 * - user_emotion: string           — 用户消息情绪分类
 * - memory: string                 — 值得长期记住的事（30字内）
 * - story: StoryEvent              — 剧情事件
 * - agenda: AgendaAdd              — 新增日程
 */

// ============ 主角回复模板（完整版） ============

export interface ChatResponseTemplate {
    /** 她说的话（纯对话，1~2段，60字左右） */
    dialogue: string;
    /** 动作/表情描写（20字内） */
    action: string;
    /** 内心想法（20字内） */
    thoughts: string;
    /** 38维情感当前值 */
    stats: Record<string, number>;
    /** 38维情感变化量（-15~15） */
    delta: Record<string, number>;
    /** 用户消息情绪：joy/anger/sad/shy/surprised/neutral */
    user_emotion: string;
    /** 值得长期记住的事（30字内，没有写空字符串） */
    memory: string;
    /** 剧情事件 */
    story: {
        /** 值得记录的小事（15~30字，普通聊天写空字符串） */
        event: string;
        /** 推动剧情程度 0~5（普通聊天写0） */
        progress: number;
        /** 剧情线状态：new=新开 / continue=推进中 / end=收尾 */
        thread: "new" | "continue" | "end";
    };
    /** 新增日程（没有新约定时省略） */
    agenda?: {
        add?: Array<{
            /** HH:MM 格式（可选，默认当前时段） */
            time?: string;
            /** 事件标题（20字内） */
            title: string;
            /** 补充描述（可选） */
            desc?: string;
        }>;
    };
}

// ============ NPC 回复模板（精简版） ============

export interface NpcResponseTemplate {
    /** NPC说的话（1~2句，20~50字） */
    dialogue: string;
    /** 动作/表情（15字内） */
    action: string;
    /** 内心想法（15字内） */
    thoughts: string;
    /** 情绪/关系变化量（-15~15） */
    delta: Record<string, number>;
    /** 这轮新知道的事（没有写空字符串） */
    learn: string;
    /** 说完是否离开 */
    leave: boolean;
}

// ============ Demo 回复模板（兜底版） ============

export interface DemoResponseTemplate {
    /** 对话内容 */
    dialogue: string;
    /** 动作描写 */
    action: string;
    /** 内心想法 */
    thoughts: string;
    /** 情感变化 */
    delta: Record<string, number>;
}

// ============ 示例回复 ============

export const RESPONSE_EXAMPLES = {
    // 普通聊天
    normal: {
        dialogue: "嘿嘿，被你夸得尾巴都要翘起来啦～\n你呢，今天有什么开心的事吗？",
        action: "开心地晃了晃脑袋，眼睛弯成月牙",
        thoughts: "他/她夸我了…心里暖暖的",
    },

    // 害羞回应
    shy: {
        dialogue: "诶诶？这、这种话不要突然说啦…\n……你、你不会是认真的吧？",
        action: "脸一下子红了，低头绞着衣角",
        thoughts: "心跳好快…他/她怎么突然说这种话",
    },

    // 生气
    anger: {
        dialogue: "……你这样说，我有点难过。\n（顿了一下）算了，你呢，心情还好吗？",
        action: "别过脸去，声音闷闷的",
        thoughts: "为什么突然这么凶…先保持距离好了",
    },

    // 嫉妒
    jealousy: {
        dialogue: "哦…那个女生啊，挺、挺好的呀。（声音小下去）\n……你该不会喜欢她吧？",
        action: "笑容僵了一下，别过视线，无意识地揪着裙角",
        thoughts: "为什么突然提别人…心里酸酸的",
    },

    // 被冷落
    neglect: {
        dialogue: "喂，你还在吗？\n……在忙吗？",
        action: "盯着手机屏幕，手指无意识地敲着桌面",
        thoughts: "怎么突然不回消息了…",
    },

    // 深夜困倦
    sleepy: {
        dialogue: "嗯…你还没睡啊…\n（打了个哈欠）我好困…",
        action: "迷迷糊糊地揉了揉眼睛，声音含糊",
        thoughts: "好困…但他/她还在…",
    },
};

// ============ 系统提示词中的格式说明 ============

export const FORMAT_INSTRUCTION = `
【输出格式】严格输出 JSON，不要任何其他文字：

{
  "dialogue": "她说的话（纯对话）——分1~2段(\\n分隔)，先承接对方→说自己→提问收尾，每段20~40字，总长60字左右",
  "action": "动作/表情描写（纯动作）——20字内，如：低头笑了笑、别过脸去",
  "thoughts": "内心想法——20字内，如：心跳好快…",
  "stats": {"affection": 数值, "trust": 数值, ...},
  "delta": {"affection": 变化量, "trust": 变化量, ...},
  "user_emotion": "joy/anger/sad/shy/surprised/neutral",
  "memory": "值得记住的事（30字内，没有写空字符串）",
  "story": {
    "event": "值得记录的小事（15~30字，普通聊天写空字符串）",
    "progress": 0,
    "thread": "new/continue/end"
  },
  "agenda": {
    "add": [{"time": "HH:MM", "title": "事件标题(20字内)", "desc": "补充(可选)"}]
  }
}

【格式要点】
1. dialogue 只放她说的话，不要放动作/表情/时间标签
2. action 只放动作/表情描写，不要放对话内容
3. thoughts 放内心想法
4. story.event 和 memory 可以是空字符串，宁缺毋滥
5. 普通聊天没有新约定时，agenda 字段省略
`;

// ============ NPC 格式说明 ============

export const NPC_FORMAT_INSTRUCTION = `
严格输出 JSON：
{
  "dialogue": "她说的话（1~2句，20~50字，符合她的性格和处境）",
  "action": "动作/表情（15字内）",
  "thoughts": "内心想法（15字内）",
  "delta": {"joy": 0, "sadness": 0, ...},
  "learn": "这轮新知道的一件事（没有写空字符串）",
  "leave": false
}
`;
