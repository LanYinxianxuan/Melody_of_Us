// response-template.ts —— 统一回复格式规范（供系统提示词使用）
// 主角回复的 TS 类型见 ai.ts 的 ChatResult

// ============ 主角回复格式说明 ============

export const FORMAT_INSTRUCTION = `
【输出格式】严格输出 JSON，不要任何其他文字。

字段说明：
- dialogue: 她说的话。纯对话，1~2段（用\\n分隔），每段20~40字，总长60字左右。先承接对方→说自己→提问收尾。
- dialogue_ja: dialogue 的日语翻译。自然流畅的日语，保持同样的语气和情感。必填。
- action: 动作/表情描写。纯动作，20字内。如"低头笑了笑""别过脸去"。
- thoughts: 内心想法。20字内。如"心跳好快…""他/她怎么突然说这种话"。
- delta: 情感维度变化量。如{"affection":6,"joy":12}。每维-15~15。
- user_emotion: 用户消息情绪。只能是 joy/anger/sad/shy/surprised/neutral 之一。
- memory: 值得长期记住的事。30字内，没有写空字符串""。
- story.event: 值得记录的小事。15~30字，普通聊天写空字符串""。
- story.progress: 推动剧情程度0~5，普通聊天写0。
- story.thread: 剧情线状态。new=新开 / continue=推进中 / end=收尾。

【格式要点】
1. dialogue 只放她说的话，不要放动作/表情/时间标签
2. dialogue_ja 是 dialogue 的日语翻译，保持同样的语气和分段
3. action 只放动作/表情描写，不要放对话内容
4. story.event 和 memory 可以是空字符串，宁缺毋滥
`;

// ============ NPC 回复格式说明 ============

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
