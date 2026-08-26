// playground/state.ts
var DIMENSIONS = [
  // 🎭 人格
  { key: "openness", label: "\u{1F30C} \u5F00\u653E", group: "personality", baseline: 60, regression: 0 },
  { key: "conscientiousness", label: "\u{1F4CB} \u5C3D\u8D23", group: "personality", baseline: 65, regression: 0 },
  { key: "extraversion", label: "\u{1F3A4} \u5916\u5411", group: "personality", baseline: 55, regression: 0 },
  { key: "agreeableness", label: "\u{1F54A} \u5B9C\u4EBA", group: "personality", baseline: 70, regression: 0 },
  { key: "neuroticism", label: "\u{1F327} \u654F\u611F", group: "personality", baseline: 45, regression: 0 },
  // ❤️ 关系（初始是刚认识的陌生人，基线低，靠对话慢慢积累）
  { key: "affection", label: "\u{1F495} \u597D\u611F", group: "relation", baseline: 25, regression: 0.02 },
  { key: "trust", label: "\u{1F91D} \u4FE1\u4EFB", group: "relation", baseline: 15, regression: 0.02 },
  { key: "intimacy", label: "\u{1F49E} \u4EB2\u5BC6", group: "relation", baseline: 5, regression: 0.02 },
  { key: "loyalty", label: "\u{1F6E1} \u5FE0\u8BDA", group: "relation", baseline: 10, regression: 0.015 },
  { key: "dependence", label: "\u{1F9F2} \u4F9D\u8D56", group: "relation", baseline: 5, regression: 0.02 },
  { key: "familiarity", label: "\u{1F44B} \u719F\u6089", group: "relation", baseline: 5, regression: 0.01 },
  // 💭 情绪
  { key: "joy", label: "\u{1F60A} \u559C\u60A6", group: "emotion", baseline: 40, regression: 0.25 },
  { key: "sadness", label: "\u{1F622} \u60B2\u4F24", group: "emotion", baseline: 10, regression: 0.22 },
  { key: "anger", label: "\u{1F620} \u6124\u6012", group: "emotion", baseline: 0, regression: 0.3 },
  { key: "fear", label: "\u{1F628} \u6050\u60E7", group: "emotion", baseline: 5, regression: 0.2 },
  { key: "surprise", label: "\u{1F632} \u60CA\u8BB6", group: "emotion", baseline: 10, regression: 0.35 },
  { key: "disgust", label: "\u{1F922} \u538C\u6076", group: "emotion", baseline: 0, regression: 0.28 },
  { key: "shyness", label: "\u{1F633} \u5BB3\u7F9E", group: "emotion", baseline: 30, regression: 0.2 },
  { key: "embarrassment", label: "\u{1F605} \u5C34\u5C2C", group: "emotion", baseline: 8, regression: 0.3 },
  { key: "jealousy", label: "\u{1F34B} \u5AC9\u5992", group: "emotion", baseline: 3, regression: 0.25 },
  { key: "loneliness", label: "\u{1F319} \u5B64\u72EC", group: "emotion", baseline: 12, regression: 0.18 },
  { key: "anxiety", label: "\u{1F32B} \u7126\u8651", group: "emotion", baseline: 15, regression: 0.15 },
  { key: "anticipation", label: "\u2728 \u671F\u5F85", group: "emotion", baseline: 25, regression: 0.25 },
  // 🫀 状态
  { key: "fatigue", label: "\u{1F971} \u75B2\u60EB", group: "status", baseline: 10, regression: 0.05 },
  { key: "energy", label: "\u{1F50B} \u7CBE\u529B", group: "status", baseline: 70, regression: 0.06 },
  { key: "stress", label: "\u{1F525} \u538B\u529B", group: "status", baseline: 15, regression: 0.12 },
  { key: "nervousness", label: "\u{1F630} \u7D27\u5F20", group: "status", baseline: 20, regression: 0.25 },
  { key: "confidence", label: "\u{1F4AA} \u81EA\u4FE1", group: "status", baseline: 45, regression: 0.05 },
  // 🖤 阴影
  { key: "greed", label: "\u{1F4B0} \u8D2A\u5A6A", group: "shadow", baseline: 15, regression: 0.15 },
  { key: "lust", label: "\u{1F48B} \u8272\u6B32", group: "shadow", baseline: 20, regression: 0.15 },
  { key: "vanity", label: "\u{1FA9E} \u865A\u8363", group: "shadow", baseline: 25, regression: 0.12 },
  { key: "possessiveness", label: "\u{1F512} \u5360\u6709\u6B32", group: "shadow", baseline: 20, regression: 0.1 },
  { key: "pride", label: "\u{1F451} \u50B2\u6162", group: "shadow", baseline: 20, regression: 0.12 },
  { key: "ambition", label: "\u{1F3AF} \u91CE\u5FC3", group: "shadow", baseline: 40, regression: 0.05 },
  { key: "selfishness", label: "\u{1F370} \u81EA\u79C1", group: "shadow", baseline: 15, regression: 0.12 },
  { key: "laziness", label: "\u{1F6CB} \u61D2\u60F0", group: "shadow", baseline: 30, regression: 0.08 },
  { key: "shame", label: "\u{1F648} \u7F9E\u803B", group: "shadow", baseline: 5, regression: 0.2 },
  { key: "guilt", label: "\u{1F494} \u5185\u759A", group: "shadow", baseline: 5, regression: 0.2 }
];
var INITIAL_STATE = Object.fromEntries(DIMENSIONS.map((d) => [d.key, d.baseline]));
var aiState = { ...INITIAL_STATE };

// playground/npc.ts
var NPC_EMOTION_DIMS = DIMENSIONS.filter(
  (d) => ["joy", "sadness", "anger", "shyness", "jealousy", "loneliness", "anxiety", "fatigue"].includes(d.key)
).map((d) => d.key);

// playground/storage.ts
var slotParams = new URLSearchParams(location.search);
var currentSlot = Math.max(
  1,
  Math.min(9, parseInt(slotParams.get("slot") ?? localStorage.getItem("melai-current-slot") ?? "1", 10) || 1)
);
var newKey = `melai-did-new-${currentSlot}`;
if (slotParams.get("new") === "1" && !localStorage.getItem(newKey)) {
  localStorage.removeItem(`melai-state-${currentSlot}`);
  localStorage.removeItem(`melai-character-${currentSlot}`);
  localStorage.setItem(newKey, "1");
}
if (slotParams.has("new")) {
  const url = new URL(location.href);
  url.searchParams.delete("new");
  history.replaceState(null, "", url.toString());
}
localStorage.setItem("melai-current-slot", String(currentSlot));
var SAVE_KEY = `melai-state-${currentSlot}`;
var CHAR_KEY = `melai-character-${currentSlot}`;
if (currentSlot === 1) {
  if (!localStorage.getItem(`melai-state-1`) && localStorage.getItem("melai-state")) {
    localStorage.setItem(`melai-state-1`, localStorage.getItem("melai-state"));
    localStorage.removeItem("melai-state");
  }
  if (!localStorage.getItem(`melai-character-1`) && localStorage.getItem("melai-character")) {
    localStorage.setItem(`melai-character-1`, localStorage.getItem("melai-character"));
    localStorage.removeItem("melai-character");
  }
}
var DEFAULT_SCENE = {
  name: "\u5B66\u6821",
  place: "\u5B66\u6821",
  routine: "\u4E0A\u8BFE",
  others: "\u540C\u5B66",
  busyLabel: "\u4E0A\u8BFE",
  restLabel: "\u8BFE\u95F4"
};
var store = {
  turnCount: 0,
  storyEvents: [],
  storyProgress: 0,
  chatHistory: [],
  journal: [],
  activeThread: null,
  scheduleIndex: -1,
  timeRate: 1,
  virtualMs: Date.now(),
  dayBaseMs: (/* @__PURE__ */ new Date()).setHours(0, 0, 0, 0),
  dayIndex: 1,
  // 她的长期记忆（跨天/跨对话记住的重要事情）
  memories: [],
  // 用户最后一次回复：真实时间戳 + 虚拟时间戳（用于"被冷落"反应）
  lastReplyRealAt: Date.now(),
  lastReplyVirtualAt: Date.now(),
  // 上次触发"被冷落"反应的时刻（避免短时间重复轰炸）
  lastNeglectAt: 0,
  lastNeglectRealAt: 0,
  lastNeglectLevel: 0,
  // 支线 NPC 世界（主角之外的其他角色）
  npcs: {},
  // 当前在场者（主角之外的参与者 id 列表，用于主角感知在场变化）
  presentNpcs: [],
  // 多人模式开关：默认关闭（NPC 动态介入不启用；主角 prompt 也不注入在场者）
  npcEnabled: false,
  // 场景配置（创建角色时询问；默认校园兼容旧存档）
  scene: { ...DEFAULT_SCENE },
  // 日程时间线（AI 规划的一天流程 + 对话中用户创建的事件）
  agenda: [],
  // 用户当前方位（家 / 学校 / 路上 / 打工处）——决定面对面还是手机聊天
  userLocation: "\u5BB6",
  // 深夜发出去、她睡着没看到的消息（等她醒来再送达）
  pendingOvernight: [],
  // ===== Agent Mind（情感判断与对话决策系统）持久化状态 =====
  // 用户持续状态（情绪维度 0~1，跨消息持续演化，含惯性/衰减）
  userMind: {
    happiness: 0.42,
    sadness: 0.1,
    anger: 0.06,
    fear: 0.06,
    anxiety: 0.2,
    disappointment: 0.12,
    loneliness: 0.18,
    embarrassment: 0.06,
    interest: 0.4,
    energy: 0.55,
    social_need: 0.32,
    willingness_to_talk: 0.6,
    stress: 0.25,
    tension: 0.1
  },
  // AI 对话引擎状态（兴趣/耐心/意愿…，受对话动态影响）
  aiMind: {
    interest: 0.55,
    patience: 0.75,
    willingness_to_talk: 0.62,
    social_need: 0.35,
    curiosity: 0.6,
    energy: 0.62,
    topicFatigue: 0,
    defensiveness: 0.15,
    comfortCount: 0,
    lastTopic: ""
  },
  // 关系张力状态（trust/familiarity 仍由 38 维推导，这里只存张力与最近重大事件）
  relMind: { tension: 0.08, lastMajorLabel: "", lastMajorTurn: 0, lastMajorVirtualAt: 0 },
  // Agent Mind 上次结算的虚拟时间（用于跨消息/离线后的情绪衰减计算）
  lastAgentVirtualAt: 0
};
function saveState() {
  try {
    localStorage.setItem(
      SAVE_KEY,
      JSON.stringify({
        aiState,
        ...store,
        savedAt: Date.now()
      })
    );
  } catch {
  }
}

// playground/time.ts
function getSchedule() {
  const s = store.scene;
  const busyL = s.busyLabel;
  const restL = s.restLabel;
  return [
    { time: "00:00", label: "\u6DF1\u591C", activity: "\u5DF2\u7ECF\u7761\u7740\u4E86", speakChance: 0, busy: true },
    { time: "06:30", label: "\u6E05\u6668", activity: "\u88AB\u95F9\u949F\u5435\u9192\uFF0C\u8D56\u5728\u5E8A\u4E0A\u4E0D\u60F3\u8D77", speakChance: 0.2, busy: false },
    { time: "07:10", label: "\u51FA\u95E8", activity: `\u5728\u53BB${s.place}\u7684\u8DEF\u4E0A\uFF0C\u8033\u673A\u91CC\u653E\u7740\u6B4C`, speakChance: 0.25, busy: false },
    { time: "07:30", label: "\u5F00\u5DE5", activity: `\u5230\u4E86${s.place}\uFF0C\u51C6\u5907\u5F00\u59CB\u4ECA\u5929`, speakChance: 0.15, busy: true },
    { time: "08:45", label: busyL, activity: `\u5728${s.place}${s.routine}\uFF0C\u5076\u5C14\u8D70\u795E`, speakChance: 0.08, busy: true },
    { time: "09:45", label: restL, activity: `\u6B47\u4E00\u4F1A\u513F\uFF0C${s.others}\u91CC\u6709\u4EBA\u8DDF\u4F60\u642D\u4E86\u4E24\u53E5`, speakChance: 0.45, busy: false },
    { time: "10:00", label: busyL, activity: `\u7EE7\u7EED${s.routine}\uFF0C\u5076\u5C14\u8D70\u795E`, speakChance: 0.08, busy: true },
    { time: "11:00", label: restL, activity: "\u62BD\u7A7A\u559D\u53E3\u6C34\uFF0C\u653E\u677E\u4E00\u4E0B", speakChance: 0.45, busy: false },
    { time: "11:15", label: busyL, activity: "\u5728\u5FD9\uFF0C\u809A\u5B50\u997F\u5F97\u5495\u5495\u53EB", speakChance: 0.1, busy: true },
    { time: "12:15", label: "\u5348\u4F11", activity: "\u4F11\u606F\u5403\u996D\uFF0C\u8033\u673A\u5206\u4E86\u4E00\u53EA\u8033\u6735", speakChance: 0.6, busy: false },
    { time: "13:30", label: busyL, activity: `\u4E0B\u5348\u7EE7\u7EED${s.routine}`, speakChance: 0.08, busy: true },
    { time: "14:30", label: restL, activity: "\u9760\u5728\u6905\u5B50\u4E0A\u5C0F\u61A9\u4E00\u4F1A\u513F", speakChance: 0.4, busy: false },
    { time: "14:45", label: busyL, activity: "\u5FD9\u7740\u6536\u5C3E\u4ECA\u5929\u7684\u4E8B", speakChance: 0.08, busy: true },
    { time: "15:45", label: "\u6536\u5DE5", activity: `\u5FD9\u5B8C\u4ECA\u5929\u7684${s.routine}`, speakChance: 0.55, busy: false },
    { time: "17:30", label: "\u508D\u665A", activity: "\u5728\u56DE\u5BB6\u7684\u8DEF\u4E0A\uFF0C\u60F3\u7740\u4ECA\u665A\u505A\u4EC0\u4E48", speakChance: 0.5, busy: false },
    { time: "20:00", label: "\u665A\u4E0A", activity: "\u5728\u81EA\u5DF1\u7684\u623F\u95F4\u91CC\u653E\u677E\uFF0C\u653E\u7740\u559C\u6B22\u7684\u6B4C", speakChance: 0.5, busy: false },
    { time: "22:30", label: "\u7761\u524D", activity: "\u6D17\u6F31\u5B8C\u8EBA\u5728\u5E8A\u4E0A\uFF0C\u8FD8\u6CA1\u7761\u7740", speakChance: 0.55, busy: false }
  ];
}
var lastRealMs = Date.now();
var relationGetter = null;
function isFirstMeeting() {
  const rel = (relationGetter?.() ?? "").toLowerCase();
  if (/恋人|女朋友|男朋友|对象|老婆|老公|青梅竹马|家人|一起生活|同居|结婚|挚友|最好的朋友|多年/.test(rel))
    return false;
  if (/刚认识|初识|陌生|第一次见|还不熟|刚见面|不了解/.test(rel))
    return true;
  return false;
}
function slotMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function scheduleIndexFor(ms) {
  const schedule = getSchedule();
  const d = new Date(ms);
  const mins = d.getHours() * 60 + d.getMinutes();
  let idx = 0;
  for (let i = 1; i < schedule.length; i++) {
    if (mins >= slotMinutes(schedule[i].time))
      idx = i;
    else
      break;
  }
  return idx;
}
function currentSchedule() {
  const schedule = getSchedule();
  const slot = schedule[store.scheduleIndex] ?? schedule[0];
  if (store.dayIndex === 1 && slot.label === "\u5F00\u5DE5" && isFirstMeeting()) {
    return { ...slot, activity: "\u7B2C\u4E00\u5929\uFF0C\u4F60\u4EEC\u7B2C\u4E00\u6B21\u89C1\u9762" };
  }
  return slot;
}

// playground/mind.ts
var CONTEXT_WINDOW = 24;
var MAX_TRACE = 60;
function defaultUserMind() {
  return {
    happiness: 0.42,
    sadness: 0.1,
    anger: 0.06,
    fear: 0.06,
    anxiety: 0.2,
    disappointment: 0.12,
    loneliness: 0.18,
    embarrassment: 0.06,
    interest: 0.4,
    energy: 0.55,
    social_need: 0.32,
    willingness_to_talk: 0.6,
    stress: 0.25,
    tension: 0.1
  };
}
function defaultAiMind() {
  return {
    interest: 0.55,
    patience: 0.75,
    willingness_to_talk: 0.62,
    social_need: 0.35,
    curiosity: 0.6,
    energy: 0.62,
    topicFatigue: 0,
    defensiveness: 0.15,
    comfortCount: 0,
    lastTopic: ""
  };
}
function defaultRelMind() {
  return { tension: 0.08, lastMajorLabel: "", lastMajorTurn: 0, lastMajorVirtualAt: 0 };
}
var agentTrace = [];
var traceSeq = 0;
var imperfectionRate = 0.06;
function setImperfectionRate(v) {
  imperfectionRate = Math.max(0, Math.min(1, v));
}
function imperfectionChance() {
  return Math.random() < imperfectionRate;
}
var clamp01 = (v) => Math.max(0, Math.min(1, v));
var EMOTION_BASE = {
  joy: { valence: 0.65, arousal: 0.65 },
  sadness: { valence: -0.6, arousal: 0.3 },
  anger: { valence: -0.5, arousal: 0.72 },
  fear: { valence: -0.5, arousal: 0.6 },
  anxiety: { valence: -0.45, arousal: 0.52 },
  disappointment: { valence: -0.55, arousal: 0.35 },
  loneliness: { valence: -0.5, arousal: 0.25 },
  embarrassment: { valence: -0.35, arousal: 0.5 },
  stress: { valence: -0.4, arousal: 0.45 },
  interest: { valence: 0.2, arousal: 0.45 },
  neutral: { valence: 0, arousal: 0.2 }
};
var NEG_DIMS = /* @__PURE__ */ new Set([
  "sadness",
  "anger",
  "anxiety",
  "disappointment",
  "fear",
  "loneliness",
  "embarrassment",
  "stress",
  "tension"
]);
var EMOTION_DIMS = /* @__PURE__ */ new Set([
  "happiness",
  "sadness",
  "anger",
  "fear",
  "anxiety",
  "disappointment",
  "loneliness",
  "embarrassment",
  "stress",
  "tension"
]);
var EMOTION_RULES = [
  { re: /考砸|考糊|没考好|考差了|挂科|不及格|落榜|没发挥好|搞砸|砸了|失败|被拒|拒绝了我|落选|没被选上|差一点|差几分|面试.{0,3}(挂|失败)|成绩.{0,4}(低|差|退)/, emotion: "disappointment", intensity: 0.65, secondary: ["sadness"] },
  { re: /气死|生气|气到|好气|恼火|火大|愤怒|他妈|他妈的|玛德|凭什么|太过分|恶心死了|烦死|烦透|讨厌死了|气得|气哭/, emotion: "anger", intensity: 0.66, secondary: ["stress"] },
  { re: /难过|伤心|失落|委屈|想哭|哭了|要哭|心碎|心里堵|难受|不开心|闷闷|唉|呜|呜呜|眼泪|哭/, emotion: "sadness", intensity: 0.6, secondary: ["disappointment"] },
  { re: /焦虑|担心|不安|慌|紧张|睡不着|失眠|压力(大|好大|山大)|怎么办|不知道怎么办|好难|很怕|害怕|怕|吓|恐怖|噩梦/, emotion: "anxiety", intensity: 0.58, secondary: ["fear"] },
  { re: /孤独|孤单|寂寞|没人陪|一个人|没人理|没人懂|想找人说话|没有朋友/, emotion: "loneliness", intensity: 0.55, secondary: [] },
  { re: /尴尬|丢人|社死|出丑|难堪|羞死|脸红|不好意思/, emotion: "embarrassment", intensity: 0.5, secondary: [] },
  { re: /累死|好累|太累|累炸|撑不住|忙死|忙疯了|加班(到|到)?(死|爆)?|疲惫|虚脱/, emotion: "stress", intensity: 0.55, secondary: [] },
  { re: /终于|过了|通过了|考过|成功|做到了|达成|晋级|赢了|拿(到)?offer|上岸|中了|太棒|太好了|好耶|开心死|高兴死|爽|耶|哈哈|哈哈哈|笑死|嘿嘿|惊喜|哇塞/, emotion: "joy", intensity: 0.64, secondary: [] },
  { re: /好奇|想知道|有意思|有趣|好玩|啥|什么情况/, emotion: "interest", intensity: 0.38, secondary: [] },
  { re: /好烦|烦|不爽|讨厌|恶心|反感|不行了|烦人/, emotion: "anger", intensity: 0.45, secondary: ["stress"] }
];
var INTENSITY_UP = /好|真|特别|极其|超级|非常|巨|太|很|死|爆|疯了/;
var INTENSITY_DOWN = /有点|稍微|一点点|略微|不算|没那么/;
var INTENT_RULES = [
  // 高置信 退出交流
  { re: /想静静|静一静|一个人待会|一个人待着|别理我|走开|离我远点|让我一个人|别烦我/, intent: "withdraw", score: 0.9 },
  { re: /别管我|不用管我|不用管|不要管我|别管|你走开/, intent: "withdraw", score: 0.86 },
  { re: /算了|不想说了|不想聊|不想说话|不想理(人|你|我)|谁都不想理|别说了|别提了|不说了|聊不下去了|没什么好说的/, intent: "withdraw", score: 0.82 },
  { re: /不用了|不了|先挂了|去睡了|拜拜|再见|我先忙|我先走了/, intent: "withdraw", score: 0.7 },
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
  { re: /哈哈.*(你|笨|傻|呆|单身狗)|开玩笑|逗你|骗你的|逗你玩|你就是个/, intent: "tease", score: 0.6 },
  // 岔开（表面平静）
  { re: /我没事|没事|没关系|无所谓啦|还好|还行|没什么|没怎么|算了算了/, intent: "deflect", score: 0.5 }
];
var NEED_CLUES = {
  space: {
    re: /一个人|静静|别理|走开|想自己|让我一个人|别管/
  },
  companionship: { re: /陪我|聊聊天|说说话|好无聊|想找人|你在吗|理理我|陪我一会儿/ },
  reassurance: { re: /对吗|是吗|会不会|是不是|没问题.*吧|能行吗|我会不会|我是不是.*(没|不|做错)/ },
  comfort: { re: /安慰|抱抱|想哭|难过|委屈|好惨|可怜/ },
  validation: { re: /厉害吧|做得好吧|还不错吧|夸夸我|你看我/ },
  guidance: { re: /怎么办|怎么做|选哪个|该不该|要不要|出主意|帮我想想/ },
  distraction: { re: /不想了|换个话题|陪我玩|说点别的|逗逗我/ }
};
var TOPIC_BUCKETS = {
  exam: /考|成绩|分数|复习|作业|题目|挂科|课|试卷|学考|老师|考试|绩点|考研|升学/,
  work: /班|工作|老板|同事|项目|加班|开会|面试|offer|入职|绩效|客户|上班/,
  love: /对象|女朋友|男朋友|喜欢|表白|分手|吵架|闺蜜|兄弟|暗恋|前任|心动|恋爱|相亲/,
  family: /爸|妈|父母|家人|弟弟|妹妹|哥哥|姐姐|家里|家事/,
  health: /病|疼|痛|医院|吃药|感冒|发烧|失眠|困|晕|难受|身体|体检|牙|胃/,
  food: /吃|饭|面|拉面|火锅|奶茶|蛋糕|零食|外卖|好吃|饿|夜宵|点心/,
  game: /游戏|打游戏|上分|排位|王者|原神|switch|steam|主机|电脑|手机游戏/,
  music: /歌|音乐|听歌|专辑|演唱会|livehouse|live|乐队|吉他|贝斯|鼓/,
  money: /钱|工资|贵|便宜|买|购物|花|红包|省钱|攒|信用卡|房租/,
  fun: /玩|逛街|散步|电影|剧|综艺|番|漫画|小说|旅游|旅行|拍照/
};
var TURN_DECAY = {
  happiness: 0.18,
  sadness: 0.1,
  anger: 0.3,
  fear: 0.16,
  anxiety: 0.12,
  disappointment: 0.07,
  loneliness: 0.05,
  embarrassment: 0.32,
  interest: 0.12,
  energy: 0.04,
  social_need: 0.07,
  willingness_to_talk: 0.06,
  stress: 0.1,
  tension: 0.14
};
var HOUR_DECAY = {
  happiness: 0.14,
  sadness: 0.1,
  anger: 0.22,
  fear: 0.16,
  anxiety: 0.1,
  disappointment: 0.05,
  loneliness: 0.06,
  embarrassment: 0.28,
  interest: 0.1,
  energy: 0.04,
  social_need: 0.08,
  willingness_to_talk: 0.06,
  stress: 0.12,
  tension: 0.16
};
var STATE_BASE = {
  happiness: 0.35,
  sadness: 0.08,
  anger: 0.05,
  fear: 0.05,
  anxiety: 0.12,
  disappointment: 0.08,
  loneliness: 0.12,
  embarrassment: 0.05,
  interest: 0.4,
  energy: 0.55,
  social_need: 0.3,
  willingness_to_talk: 0.58,
  stress: 0.2,
  tension: 0.08
};
function analyzeMessage(text) {
  const t = text || "";
  let primary = {
    primary_emotion: "neutral",
    secondary_emotions: [],
    intensity: 0,
    valence: 0,
    arousal: 0.2,
    confidence: 0.2,
    calmMask: false
  };
  let best = 0;
  for (const rule of EMOTION_RULES) {
    if (!rule.re.test(t))
      continue;
    let intensity = rule.intensity;
    if (INTENSITY_UP.test(t))
      intensity = Math.min(0.95, intensity + 0.1);
    if (INTENSITY_DOWN.test(t))
      intensity = Math.max(0.15, intensity - 0.15);
    if (!(rule.emotion === "joy" || rule.emotion === "interest") && /哈哈|嘻嘻|哈哈哈哈/.test(t))
      intensity = Math.max(0.2, intensity - 0.3);
    if (intensity > best) {
      best = intensity;
      const base = EMOTION_BASE[rule.emotion] ?? EMOTION_BASE.neutral;
      primary = {
        primary_emotion: rule.emotion,
        secondary_emotions: rule.secondary ?? [],
        intensity,
        valence: base.valence,
        arousal: base.arousal + (IntensityUpAroma(rule.emotion, t) ? 0.12 : 0),
        confidence: Math.min(0.95, 0.55 + intensity * 0.45),
        calmMask: false
      };
    }
  }
  let calmMask = false;
  if (/我没事|没事|没关系|无所谓|还好|还行|没什么|算了算了/.test(t)) {
    calmMask = true;
    primary = {
      ...primary,
      secondary_emotions: primary.primary_emotion === "neutral" ? ["calm_mask"] : primary.secondary_emotions,
      intensity: primary.primary_emotion === "neutral" ? 0.25 : primary.intensity,
      valence: primary.primary_emotion === "neutral" ? -0.15 : primary.valence,
      confidence: Math.min(primary.confidence, 0.5),
      calmMask
    };
  }
  const intents = [];
  for (const rule of INTENT_RULES) {
    if (rule.re.test(t))
      intents.push({ surface_intent: rule.intent, score: rule.score });
    if (intents.length >= 5)
      break;
  }
  intents.sort((a, b) => b.score - a.score);
  const seen = /* @__PURE__ */ new Set();
  const intentList = intents.filter((i) => {
    if (i.surface_intent === "deflect" && /没事|我没事|没关系/.test(t) && i.score > 0.55)
      return true;
    if (seen.has(i.surface_intent))
      return false;
    seen.add(i.surface_intent);
    return true;
  });
  if (!intentList.length)
    intentList.push({ surface_intent: "neutral", score: 0.2 });
  const needs = [];
  for (const [need, clue] of Object.entries(NEED_CLUES)) {
    let conf = 0;
    if (clue.re?.test(t))
      conf = 0.45;
    if (need === "space" && intentList.some((i) => i.surface_intent === "withdraw"))
      conf = Math.max(conf, 0.51);
    if (need === "space" && /别管我|不用管我|想静静|一个人/.test(t))
      conf = Math.max(conf, 0.8);
    if (need === "comfort" && (primary.primary_emotion === "sadness" || primary.primary_emotion === "disappointment" || /想哭|难过|委屈/.test(t)))
      conf = Math.max(conf, 0.4);
    if (need === "companionship" && /别管我|不用管我|想静静|一个人/.test(t))
      conf = Math.max(conf, 0.28);
    if (conf > 0.24)
      needs.push({ need, confidence: clamp01(conf) });
  }
  needs.sort((a, b) => b.confidence - a.confidence);
  return { emotion: primary, intents: intentList, needs: needs.slice(0, 4), rawText: t };
}
function IntensityUpAroma(emotion, t) {
  return /终于|哈哈|好耶|哇|太棒|成功|过了/.test(t) && (emotion === "joy" || emotion === "interest");
}
function findIntent(intents, name) {
  return intents.find((i) => i.surface_intent === name)?.score ?? 0;
}
function buildContext(opts) {
  const history2 = store.chatHistory.slice(-CONTEXT_WINDOW);
  const userMsgs = history2.filter((e) => e.role === "user" && e.content !== "\uFF08\u5979\u4E3B\u52A8\u627E\u4F60\u8BF4\u8BDD\uFF09").map((e) => e.content);
  const topicCount = {};
  let topTopic = "";
  for (const m of userMsgs) {
    for (const [key, re] of Object.entries(TOPIC_BUCKETS)) {
      if (re.test(m)) {
        topicCount[key] = (topicCount[key] ?? 0) + 1;
        if (topicCount[key] > (topicCount[topTopic] ?? 0))
          topTopic = key;
      }
    }
  }
  const topics = Object.entries(topicCount).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const halves = [userMsgs.slice(0, Math.max(1, userMsgs.length >> 1)), userMsgs.slice(userMsgs.length >> 1)];
  const negRe = /难过|伤心|失落|委屈|烦|气|哭|焦虑|担心|累|惨|崩|差|失败|挂了|考砸|不想|算了|压力/;
  const posRe = /开心|高兴|哈哈|太好了|终于|成功|过了|棒|快乐|好耶|爽/;
  const n1 = countMatch(halves[0], negRe, posRe);
  const n2 = countMatch(halves[1], negRe, posRe);
  let emotionalTrend = "stable";
  if (userMsgs.length >= 4) {
    if (n2 - n1 >= 1.5)
      emotionalTrend = "falling";
    else if (n1 - n2 >= 1.5)
      emotionalTrend = "rising";
    else if (Math.abs(n2 - n1) < 0.6 && n1 > 0.4)
      emotionalTrend = "unstable";
  }
  const avgLen = userMsgs.length ? userMsgs.reduce((s, m) => s + m.length, 0) / userMsgs.length : 0;
  const qCount = userMsgs.filter((m) => /[?？]/.test(m)).length;
  const conversationEnergy = clamp01(
    Math.min(avgLen, 60) / 60 * 0.6 + (userMsgs.length ? qCount / userMsgs.length : 0) * 0.4
  );
  const eventRe = /考砸|挂了|被拒|分手|吵架|面试.{0,3}(挂|失败)|落榜|住院|受伤|吵架|被骂|辞了|被裁|成功了|通过了|上岸|中了/;
  const recentEvents = store.storyEvents.slice(-3).map((e) => e.text);
  for (const m of userMsgs.slice(-3)) {
    const ev = m.match(eventRe)?.[0];
    if (ev && !recentEvents.some((r) => r.includes(ev)))
      recentEvents.push(`\uFF08${ev}\uFF09`);
  }
  const unresolvedEvents = [];
  if (store.activeThread)
    unresolvedEvents.push(store.activeThread);
  const unresolvedRe = /(算了|不想说|没事|没怎么|改天|下次|回头再说|再说吧)/;
  for (const m of userMsgs.slice(-4)) {
    if (unresolvedRe.test(m) && negRe.test(m))
      unresolvedEvents.push(m.slice(0, 18));
  }
  const idleVirtualMin = (store.virtualMs - store.lastReplyVirtualAt) / 6e4;
  return { windowSize: CONTEXT_WINDOW, recentEvents, topics, topTopic, emotionalTrend, conversationEnergy, unresolvedEvents, userInputCount: userMsgs.length, idleVirtualMin };
}
function countMatch(arr, neg, pos) {
  let n = 0;
  for (const m of arr) {
    if (neg.test(m))
      n += 1;
    else if (pos.test(m))
      n -= 0.6;
  }
  return n;
}
function loadMindState() {
  return {
    user: store.userMind && typeof store.userMind === "object" ? { ...defaultUserMind(), ...store.userMind } : defaultUserMind(),
    ai: store.aiMind && typeof store.aiMind === "object" ? { ...defaultAiMind(), ...store.aiMind } : defaultAiMind(),
    rel: store.relMind && typeof store.relMind === "object" ? { ...defaultRelMind(), ...store.relMind } : defaultRelMind()
  };
}
function persistMindState() {
  saveState();
}
function applyTimeDecay(elapsedVirtualMs) {
  const user = loadMindState().user;
  const rel = loadMindState().rel;
  const hours = Math.max(0, elapsedVirtualMs / 36e5);
  if (hours < 0.02)
    return [];
  const majorRecent = rel.lastMajorVirtualAt && store.virtualMs - rel.lastMajorVirtualAt < 6 * 36e5;
  const transitions = [];
  for (const key of Object.keys(user)) {
    const rate = HOUR_DECAY[key] * (majorRecent && (key === "sadness" || key === "disappointment") ? 0.35 : 1);
    const f = Math.exp(-rate * hours);
    const base = STATE_BASE[key];
    const before = user[key];
    const after = base + (before - base) * f;
    user[key] = after;
    if (Math.abs(after - before) >= 0.04)
      transitions.push(`${key} ${fmt(before)}\u2192${fmt(after)}`);
  }
  store.userMind = user;
  store.lastAgentVirtualAt = store.virtualMs;
  saveState();
  return transitions;
}
function fmt(v) {
  return v.toFixed(2).replace(/^0/, "");
}
function updateUserState(prev, analysis, ctx, opts) {
  const next = { ...prev };
  const emo = analysis.emotion;
  const trends = ctx.emotionalTrend;
  const negBoost = trends === "falling" ? 1.25 : 1;
  const calmFactor = emo.calmMask ? 0.6 : 1;
  const push = (key, signal, influence) => {
    let s = signal;
    if (s > 0 && NEG_DIMS.has(key) && trends === "falling")
      s *= negBoost;
    if (s > 0 && NEG_DIMS.has(key) && emo.calmMask)
      s *= calmFactor;
    if (EMOTION_DIMS.has(key)) {
      next[key] = clamp01(next[key] * (1 - TURN_DECAY[key]) + s * influence);
    } else {
      next[key] = clamp01(next[key] + (STATE_BASE[key] - next[key]) * 0.1 + s * influence);
    }
  };
  const emoDim = {
    joy: "happiness",
    sadness: "sadness",
    anger: "anger",
    fear: "fear",
    anxiety: "anxiety",
    disappointment: "disappointment",
    loneliness: "loneliness",
    embarrassment: "embarrassment",
    stress: "stress",
    interest: "interest"
  };
  const dom = emoDim[emo.primary_emotion];
  if (dom)
    push(dom, emo.intensity, 0.55);
  for (const sec of emo.secondary_emotions) {
    const d = emoDim[sec];
    if (d)
      push(d, emo.intensity * 0.5, 0.28);
  }
  if (emo.primary_emotion === "sadness" || emo.primary_emotion === "disappointment")
    push("loneliness", emo.intensity * 0.3, 0.18);
  if (emo.primary_emotion === "disappointment" || emo.primary_emotion === "stress")
    push("energy", -emo.intensity * 0.7, 0.14);
  if (emo.primary_emotion === "joy") {
    push("energy", emo.intensity, 0.12);
  }
  if (emo.primary_emotion === "anger")
    push("stress", emo.intensity * 0.5, 0.25);
  const w = findIntent(analysis.intents, "withdraw");
  const share = findIntent(analysis.intents, "share") + findIntent(analysis.intents, "happy_share") + findIntent(analysis.intents, "vent") * 0.4;
  const ask = findIntent(analysis.intents, "ask");
  const blame = findIntent(analysis.intents, "blame_ai");
  const deflect = findIntent(analysis.intents, "deflect");
  push("willingness_to_talk", -w * 0.9, 0.3);
  push("willingness_to_talk", share * 0.4 + ask * 0.2, 0.18);
  push("social_need", share * 0.6 + Math.max(0, next.loneliness - 0.3) * 0.4, 0.16);
  push("tension", blame * 0.8 + (emo.primary_emotion === "anger" ? 0.3 : 0), 0.2);
  push("stress", blame * 0.8, 0.22);
  if (deflect > 0.5 && emo.calmMask)
    push("willingness_to_talk", -0.15, 0.2);
  const lastAiTopic = opts?.lastAiTopic ?? "";
  if (ctx.topTopic && ctx.topTopic !== lastAiTopic && ask > 0)
    push("interest", 0.12 + ask * 0.1, 0.2);
  else if (ctx.topTopic && ctx.topTopic === lastAiTopic)
    push("interest", -0.12, 0.2);
  let majorEventLabel;
  const majorRe = /考砸|挂了|被拒|分手|吵架|落榜|考试|面试|辞职|被裁|住院|受伤|成功|通过|上岸|offer/;
  const m = analysis.rawText.match(majorRe);
  if (m)
    majorEventLabel = m[0];
  const transitions = [];
  for (const key of Object.keys(next)) {
    if (Math.abs(next[key] - prev[key]) >= 0.06)
      transitions.push(`${key} ${fmt(prev[key])}\u2192${fmt(next[key])}`);
  }
  return { next, transitions, majorEventLabel };
}
function topicAffinity(topic, likesText) {
  if (!topic || !likesText)
    return false;
  const re = TOPIC_BUCKETS[topic];
  return re ? re.test(likesText) : false;
}
function updateAiMind(prev, analysis, ctx, opts) {
  const next = { ...prev };
  const int = (id) => findIntent(analysis.intents, id);
  const sameTopic = ctx.topTopic && ctx.topTopic === prev.lastTopic && ctx.topTopic !== "";
  if (sameTopic)
    next.topicFatigue = clamp01(next.topicFatigue + 0.16);
  else
    next.topicFatigue = clamp01(next.topicFatigue * 0.6);
  if (topicAffinity(ctx.topTopic, opts.likes ?? ""))
    next.interest = clamp01(next.interest * 0.9 + 0.12);
  else if (next.topicFatigue > 0.45)
    next.interest = clamp01(next.interest * 0.9 - 0.06);
  if (int("happy_share") > 0)
    next.interest = clamp01(next.interest + 0.06);
  if (analysis.emotion.primary_emotion === "sadness" && int("vent") > 0)
    next.patience = clamp01(next.patience + 0.05);
  if (ctx.topTopic)
    next.lastTopic = ctx.topTopic;
  const share = int("share") + int("happy_share") + int("vent");
  if (share > 0.4)
    next.willingness_to_talk = clamp01(next.willingness_to_talk * 0.88 + 0.15);
  if (int("withdraw") > 0.5)
    next.willingness_to_talk = clamp01(next.willingness_to_talk * 0.75 - 0.1);
  const blame = int("blame_ai");
  if (blame > 0.5) {
    next.willingness_to_talk = clamp01(next.willingness_to_talk - 0.22);
    next.patience = clamp01(next.patience - 0.14);
    next.defensiveness = clamp01(next.defensiveness + 0.18);
  } else {
    next.defensiveness = clamp01(next.defensiveness * 0.7);
  }
  next.patience = clamp01(next.patience * 0.97 + 0.02);
  if (analysis.emotion.primary_emotion === "loneliness" || int("share") > 0)
    next.social_need = clamp01(next.social_need * 0.9 + 0.1);
  if (ctx.idleVirtualMin > 60)
    next.social_need = clamp01(next.social_need + 0.05);
  if (int("ask") > 0.4 || ctx.topTopic && ctx.topTopic !== prev.lastTopic)
    next.curiosity = clamp01(next.curiosity * 0.92 + 0.08);
  if (next.topicFatigue > 0.5)
    next.curiosity = clamp01(next.curiosity * 0.85);
  if (next.topicFatigue > 0.45)
    next.energy = clamp01(next.energy - 0.06);
  if (int("share") > 0 || int("happy_share") > 0)
    next.energy = clamp01(next.energy + 0.04);
  if (blame > 0.5)
    next.energy = clamp01(next.energy - 0.05);
  next.energy = clamp01(next.energy * 0.99 + 0.01);
  const transitions = [];
  const keys = ["interest", "patience", "willingness_to_talk", "social_need", "curiosity", "energy", "topicFatigue", "defensiveness"];
  for (const k of keys) {
    if (Math.abs(next[k] - prev[k]) >= 0.09)
      transitions.push(`${k} ${fmt(prev[k])}\u2192${fmt(next[k])}`);
  }
  return { next, transitions };
}
function updateRelationship(prev, analysis) {
  const next = { ...prev };
  const blame = findIntent(analysis.intents, "blame_ai");
  const anger = analysis.emotion.primary_emotion === "anger";
  const calm = /对不起|我错了|别生气|抱歉|原谅|是我不好|好啦/.test(analysis.rawText);
  if (blame > 0.5)
    next.tension = clamp01(next.tension + 0.12 + blame * 0.06);
  if (anger && blame < 0.3)
    next.tension = clamp01(next.tension + 0.06);
  if (calm)
    next.tension = clamp01(next.tension - 0.14);
  next.tension = clamp01(next.tension * 0.92 + 8e-3);
  const transitions = [];
  if (Math.abs(next.tension - prev.tension) >= 0.05)
    transitions.push(`tension ${fmt(prev.tension)}\u2192${fmt(next.tension)}`);
  return { next, transitions };
}
function relationshipView(rel) {
  const familiarity = aiState.familiarity / 100;
  const trust = aiState.trust / 100;
  const closeness = Math.min(1, aiState.intimacy / 100 * 0.5 + aiState.affection / 100 * 0.5);
  const tension = rel.tension;
  const comfort = clamp01(trust * 0.4 + closeness * 0.35 + familiarity * 0.25 - tension * 0.35);
  return { familiarity, trust, comfort, closeness, tension };
}
function aiStateView(mind) {
  const mood = clamp01(
    (aiState.joy * 0.5 - aiState.sadness * 0.42 - aiState.anger * 0.5 - aiState.anxiety * 0.25 - aiState.fatigue * 0.15 + 30) / 100
  );
  const energy = clamp01(aiState.energy / 100 * 0.7 + mind.energy * 0.3);
  const confidence = clamp01(aiState.confidence / 100 * 0.7 + mind.willingness_to_talk * 0.3);
  const arousal = clamp01((aiState.joy + aiState.anger + aiState.surprise) / 300 + aiState.energy / 100 * 0.2);
  return { mood, energy, confidence, arousal };
}
function selectStrategy(args) {
  const { user, ai, aiView, rel, ctx, analysis, proactive } = args;
  const score = {
    short_response: 0,
    ask_question: 0,
    show_presence: 0,
    comfort: 0,
    encourage: 0,
    playful: 0,
    continue_topic: 0,
    change_topic: 0,
    give_space: 0,
    apologize: 0,
    acknowledge: 0,
    admit_uncertainty: 0,
    share_self: 0,
    deflect_light: 0,
    greet: 0
  };
  const reasons = {};
  const add = (id, v, why) => {
    score[id] += v;
    if (!reasons[id])
      reasons[id] = why;
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
  const freshNews = share > 0 || vent > 0 || happyShare > 0;
  add(
    "short_response",
    Math.max(0, 1 - user.willingness_to_talk) * 0.6 + Math.max(0, 1 - aiView.energy) * 0.35,
    "\u610F\u613F/\u7CBE\u529B\u4E00\u822C\uFF0C\u8BF4\u77ED\u4E00\u70B9"
  );
  if (!proactive && withdrawal <= 0.3) {
    add("continue_topic", ctx.topTopic ? 0.5 : 0.2, "\u6709\u8BDD\u9898\u5EF6\u7EED");
    const askBase = (ask * 0.4 + ai.curiosity * 0.25) * (1 - withdrawal) * user.willingness_to_talk + 0.05;
    add("ask_question", askBase * (1 - Math.min(0.8, neg)), "\u53EF\u8FFD\u95EE");
    if (ctx.conversationEnergy > 0.55 && ai.willingness_to_talk > 0.5)
      add("share_self", 0.25, "\u8BDD\u5934\u6B63\u70ED\uFF0C\u53EF\u4EE5\u5206\u4EAB\u81EA\u5DF1");
  }
  if (withdrawal > 0.45 || user.willingness_to_talk < 0.32) {
    add("show_presence", withdrawal * 0.55 + (1 - user.willingness_to_talk) * 0.4, "\u7528\u6237\u60F3\u9000\uFF0C\u5728\u573A\u5C31\u597D");
    add("give_space", withdrawal * 0.5 + (spaceNeed(user, analysis) - companionshipNeed(user, analysis)) * 0.3 + (withdrawal > 0.75 ? 0.25 : 0), "\u7ED9\u7A7A\u95F4");
    if (deflect <= 0.6)
      add("acknowledge", 0.2, "\u5148\u627F\u8BA4\u4ED6\u4E0D\u60F3\u8BF4");
  }
  const closeEnough = rel.trust > 0.45 && rel.comfort > 0.4;
  if (neg > 0.28) {
    const roomToComfort = user.willingness_to_talk > 0.28 && !analysis.emotion.calmMask;
    const antiOveruse = ai.comfortCount >= 2 ? 0.28 : 0;
    add("comfort", neg * (roomToComfort ? 0.5 : 0.22) * (closeEnough ? 1.15 : 0.5) - antiOveruse, "\u6709\u4F4E\u843D\u53EF\u8F7B\u629A\uFF0C\u4F46\u770B\u5206\u5BF8");
    add("admit_uncertainty", neg * (0.5 + 0.45 * (1 - rel.trust)) + (analysis.emotion.calmMask ? 0.22 : 0) + (aiView.confidence < 0.4 ? 0.12 : 0), "\u4E0D\u786E\u5B9A\u600E\u4E48\u63A5\uFF0C\u53EF\u4EE5\u8BF4\u5B9E\u8BDD");
    add("encourage", Math.max(0, user.disappointment - 0.35) * 0.55 * (user.energy > 0.35 ? 1 : 0.45), "\u5931\u671B\u4F46\u6709\u6C14\u529B\u65F6\u53EF\u4EE5\u63A8\u4E00\u628A");
    if (withdrawal > 0.6)
      add("give_space", 0.35, "\u8D1F\u9762 + \u9000\u610F");
  }
  if (analysis.emotion.primary_emotion === "joy" || happyShare > 0.4) {
    add("playful", (user.happiness * 0.35 + user.energy * 0.25) * (closeEnough ? 1.3 : 0.7) + 0.2, "\u60C5\u7EEA\u9AD8\u6DA8\u53EF\u4FCF\u76AE");
    add("ask_question", 0.35, "\u5F00\u5FC3\u5206\u4EAB \u2192 \u987A\u52BF\u63A5\u4E00\u53E5");
    add("continue_topic", 0.2, "\u628A\u8BDD\u9898\u804A\u5F00");
    if (aiView.mood > 0.5)
      add("share_self", 0.2, "\u5979\u81EA\u5DF1\u4E5F\u5F00\u5FC3");
  }
  if (blame > 0.4) {
    add("acknowledge", blame * 0.6 + 0.25, "\u88AB\u8D23\u602A\uFF0C\u5148\u627F\u8BA4");
    add("deflect_light", trustLow ? 0.45 : 0.05, "\u5173\u7CFB\u751F\u758F\uFF0C\u8F7B\u5E26\u8FC7\u4E0D\u8FA9\u89E3");
    add("apologize", blame * 0.35 * (rel.trust > 0.4 ? 1 : 0.4) + (ai.defensiveness > 0.4 ? 0.1 : 0), "\u719F\u6089\u624D\u9053\u6B49\uFF0C\u4E14\u514B\u5236");
    add("short_response", 0.2, "\u4E0D\u8FA9\u89E3\u3001\u4E0D\u591A\u8BF4");
    score.continue_topic *= 0.3;
    score.ask_question *= 0.2;
    score.change_topic *= 0.3;
  }
  const meaningfulMsg = freshNews || analysis.emotion.intensity >= 0.5;
  if (ai.topicFatigue > 0.5 || !meaningfulMsg && ctx.conversationEnergy < 0.35 && ctx.topTopic && !analysis.rawText.includes(ctx.topTopic)) {
    add("change_topic", 0.4 + Math.min(0.3, ai.topicFatigue * 0.5) - (user.willingness_to_talk < 0.4 ? 0.3 : 0), "\u8BDD\u9898\u7D2F\u4E86\uFF0C\u8F7B\u8F7B\u6362\u4E00\u4E2A");
  }
  if (withdrawal > 0.5)
    score.change_topic *= 0.3;
  if (proactive) {
    score.give_space = 0;
    score.apologize = 0;
    score.acknowledge = 0;
    add("share_self", 0.5, "\u5979\u4E3B\u52A8\u627E\u8BDD\u9898/\u5206\u4EAB\u81EA\u5DF1");
    add("ask_question", 0.35, "\u4E3B\u52A8\u2192\u629B\u4E2A\u8BDD\u5934");
    add("continue_topic", ctx.topTopic ? 0.3 : 0, "\u63A5\u7740\u804A");
  }
  const slot = currentSchedule();
  if (slot.label === "\u6DF1\u591C") {
    add("short_response", 0.4, "\u6DF1\u591C\uFF0C\u8BDD\u77ED");
    score.ask_question *= 0.3;
  }
  if (slot.busy) {
    add("short_response", 0.3, "\u5FD9\uFF0C\u538B\u4F4E\u58F0\u97F3\u77ED\u8BF4");
  }
  if (imperfectionChance()) {
    if (aiView.energy < 0.4 && neg > 0.2) {
      add("admit_uncertainty", 0.5, "\u5979\u4E5F\u7D2F\u4E86\uFF0C\u8BF4\u4E0D\u51FA\u6F02\u4EAE\u8BDD");
    } else if (aiView.mood > 0.6 && Math.random() < 0.5) {
      add("playful", 0.3, "\u5FC3\u60C5\u597D\uFF0C\u5FCD\u4E0D\u4F4F\u63D2\u79D1\u6253\u8BE8");
    } else {
      add("change_topic", 0.2, "\u8F7B\u5FAE\u8DD1\u9898\uFF08\u5141\u8BB8\u4E0D\u5B8C\u7F8E\uFF09");
    }
  }
  const ranked = Object.keys(score).map((id) => ({ id, v: score[id] })).filter((x) => x.v > 0.12).sort((a, b) => b.v - a.v).slice(0, 3);
  const choices = ranked.map((r, i) => ({ id: r.id, priority: i + 1, reason: reasons[r.id] ?? "" }));
  const directives = [];
  if (withdrawal > 0.5 || user.willingness_to_talk < 0.35)
    directives.push("do_not_push");
  if (withdrawal > 0.5 || choices.some((c) => c.id === "short_response") && aiView.energy < 0.4)
    directives.push("keep_short");
  if (neg > 0.25 && !choices.some((c) => c.id === "comfort"))
    directives.push("no_forced_comfort");
  if (analysis.emotion.calmMask || analysis.needs.length === 0)
    directives.push("don_t_read_mind");
  if (trustLow)
    directives.push("subtle");
  if (neg > 0.35 && choices.some((c) => c.id === "comfort") && !closeEnough)
    directives.push("no_psychoanalysis");
  if (choices.some((c) => c.id === "comfort"))
    directives.push("not_a_counselor");
  return { choices, directives: directives.slice(0, 5), text: StrategyPromptText(choices, directives) };
}
function spaceNeed(user, a) {
  const s = a.needs.find((n) => n.need === "space")?.confidence ?? 0;
  return clamp01(s * 0.7 + (1 - user.willingness_to_talk) * 0.3);
}
function companionshipNeed(user, a) {
  const c = a.needs.find((n) => n.need === "companionship")?.confidence ?? 0;
  return clamp01(c * 0.7 + user.loneliness * 0.3);
}
function StrategyPromptText(choices, directives) {
  const nameMap = {
    short_response: "\u7B80\u77ED\u56DE\u5E94",
    ask_question: "\u8FFD\u95EE\u4E00\u53E5",
    show_presence: "\u8868\u793A\u5728\u573A",
    comfort: "\u8F7B\u58F0\u5B89\u6170",
    encourage: "\u9F13\u52B1",
    playful: "\u8F7B\u677E\u4FCF\u76AE",
    continue_topic: "\u5EF6\u7EED\u8BDD\u9898",
    change_topic: "\u6362\u4E2A\u8BDD\u9898",
    give_space: "\u7ED9\u7A7A\u95F4",
    apologize: "\u9053\u6B49",
    acknowledge: "\u627F\u8BA4\u4E8B\u5B9E",
    admit_uncertainty: "\u627F\u8BA4\u4E0D\u4F1A\u63A5",
    share_self: "\u5206\u4EAB\u81EA\u5DF1",
    deflect_light: "\u8F7B\u63CF\u6DE1\u5199\u5E26\u8FC7",
    greet: "\u6253\u62DB\u547C"
  };
  const ruleMap = {
    short_response: "\u672C\u8F6E\u6781\u77ED\uFF1A\u6700\u591A\u4E00\u53E5\uFF08\u226415\u5B57\uFF09\uFF0C\u4E0D\u5C55\u5F00\u3002",
    ask_question: "\u629B\u4E00\u4E2A\u5177\u4F53\u3001\u597D\u56DE\u7B54\u7684\u95EE\u9898\uFF08\u8DDF\u7740\u5F53\u524D\u8BDD\u9898\u8D70\uFF09\uFF0C\u4E0D\u8981\u8FDE\u73AF\u95EE\u3002",
    show_presence: "\u8868\u8FBE'\u6211\u5728'\u5373\u53EF\uFF1A1~2\u53E5\uFF0C\u4E0D\u505A\u5206\u6790\u3001\u4E0D\u50AC\u4FC3\u3001\u4E0D\u633D\u7559\u3002",
    comfort: "\u53EF\u4EE5\u8F7B\u58F0\u5B89\u629A\uFF0C\u53EA1~2\u53E5\uFF1B\u7EDD\u4E0D\u957F\u7BC7\u8BF4\u6559\uFF0C\u7EDD\u4E0D'\u6211\u7406\u89E3\u4F60\u73B0\u5728\u7684\u611F\u53D7'\u8FD9\u79CD\u5957\u8BDD\u3002",
    encourage: "\u7ED9\u4E00\u70B9\u5C0F\u800C\u5B9E\u5728\u7684\u5E0C\u671B\u6216\u9F13\u52B1\uFF0C\u4E0D\u7A7A\u558A\u52A0\u6CB9\u3002",
    playful: "\u8BED\u6C14\u53EF\u4EE5\u8F7B\u677E\u4FCF\u76AE\uFF0C\u5F00\u4E2A\u5C0F\u73A9\u7B11\uFF0C\u4F46\u522B\u8131\u7EBF\u3002",
    continue_topic: "\u987A\u7740\u5F53\u524D\u8BDD\u9898\u81EA\u7136\u5EF6\u5C55\uFF0C\u5148\u63A5\u4F4F\u5BF9\u65B9\u7684\u8BDD\u3002",
    change_topic: "\u7528\u4E00\u4E2A\u81EA\u7136\u8FC7\u6E21\uFF08\u300E\u5BF9\u4E86\u2026\u300F\u300E\u8BDD\u8BF4\u56DE\u6765\u2026\u300F\uFF09\u628A\u8BDD\u9898\u5E26\u5F97\u8F7B\u677E\u4E00\u70B9\u3002",
    give_space: "\u5141\u8BB8\u5BF9\u65B9\u6C89\u9ED8/\u79BB\u5F00\uFF1A\u4E00\u53E5\u8BDD\u8868\u793A\u5C0A\u91CD\uFF0C\u4E0D\u8FFD\u95EE\u3001\u4E0D\u633D\u7559\u3001\u4E0D'\u4F60\u662F\u4E0D\u662F\u6709\u60C5\u7EEA'\u3002",
    apologize: "\u53EF\u4EE5\u9053\u6B49\uFF08\u6309\u5173\u7CFB\u9009\u62E9\u8BA4\u771F\u6216\u8F7B\u63CF\u6DE1\u5199\uFF09\uFF0C\u4E0D\u5351\u4E0D\u4EA2\uFF0C\u4E0D\u53CD\u590D\u9053\u6B49\u3002",
    acknowledge: "\u5148\u627F\u8BA4\u5BF9\u65B9\u521A\u624D\u7684\u8BDD\uFF08\u300E\u4F60\u521A\u624D\u8BF4\u7684\u2026\u300F\u300E\u4F60\u8BF4\u5F97\u5BF9\u2026\u300F\uFF09\uFF0C\u4E0D\u8FA9\u89E3\u3001\u4E0D\u53CD\u9A73\u3002",
    admit_uncertainty: "\u5141\u8BB8\u8BF4\u300E\u6211\u4E5F\u4E0D\u592A\u4F1A\u63A5\u300F\u300E\u4E0D\u77E5\u9053\u600E\u4E48\u5B89\u6170\u300F\u8FD9\u79CD\u771F\u5B9E\u7684\u8BDD\u2014\u2014\u6BD4\u5957\u8BDD\u66F4\u81EA\u7136\u3002",
    share_self: "\u4EE5\u81EA\u5DF1\u7684\u5C0F\u4E8B/\u771F\u5B9E\u611F\u53D7\u56DE\u5E94\uFF0C\u628A\u5BF9\u8BDD\u53D8\u6210\u53CC\u5411\uFF0C1~2\u53E5\u3002",
    deflect_light: "\u8F7B\u8F7B\u5E26\u8FC7\uFF0C\u4E0D\u8FA9\u89E3\u4E5F\u4E0D\u6DF1\u7A76\uFF0C\u53EF\u4EE5\u81EA\u7136\u5730\u8F6C\u79FB\u8BDD\u9898\u3002",
    greet: "\u81EA\u7136\u6253\u4E2A\u62DB\u547C\uFF0C1\u53E5\u3002"
  };
  const dmMap = {
    do_not_push: "\u7981\u6B62\u63D0\u95EE\u3001\u8FFD\u95EE\u4E0E\u529D\u6170\u957F\u6587\u2014\u2014\u5BF9\u65B9\u4E0D\u518D\u60F3\u8BF4\u4E86\u3002",
    keep_short: "\u5168\u7BC7\u4FDD\u6301\u7B80\u77ED\u3002",
    no_forced_comfort: "\u7981\u6B62\u5FC3\u7406\u54A8\u8BE2\u5F0F\u5B89\u6170\uFF08\u300E\u6211\u7406\u89E3\u4F60\u7684\u611F\u53D7\u300F\u300E\u4F60\u4E00\u5B9A\u5F88\u4E0D\u5BB9\u6613\u300F\u8FD9\u7C7B\u53E5\u5B50\u4E0D\u8981\u51FA\u73B0\uFF09\u3002",
    don_t_read_mind: "\u4E0D\u8981\u66FF\u5BF9\u65B9\u8BF4\u51FA\u300E\u4F60\u5176\u5B9E\u60F3\u2026\u300F\u2014\u2014\u731C\u6D4B\u53EA\u80FD\u4F5C\u4E3A\u89C2\u5BDF\uFF0C\u4E0D\u80FD\u5F53\u4E8B\u5B9E\u3002",
    subtle: "\u4F60\u4EEC\u8FD8\u4E0D\u719F/\u6709\u5F20\u529B\uFF0C\u8BED\u6C14\u4FDD\u6301\u5206\u5BF8\u4E0E\u8DDD\u79BB\u3002",
    no_psychoanalysis: "\u5BF9\u65B9\u6CA1\u6709\u5F00\u53E3\u6C42\u52A9\u65F6\u4E0D\u505A\u5FC3\u7406\u5206\u6790\uFF0C\u4E0D\u8981\u81EA\u52A8\u5F53\u5FC3\u7406\u533B\u751F\u3002",
    not_a_counselor: "\u4F60\u4E0D\u662F\u5FC3\u7406\u54A8\u8BE2\u5E08\uFF1A\u5BF9\u65B9\u6CA1\u6C42\u52A9\u5C31\u4E0D\u505A\u6CBB\u7597\u6027\u957F\u6587\uFF1B\u5141\u8BB8\u666E\u901A\u3001\u7B28\u62D9\u3001\u771F\u5B9E\u7684\u56DE\u5E94\u3002"
  };
  const list = choices.map((c, i) => `${i + 1}. ${nameMap[c.id]}${c.reason ? `\uFF08${c.reason}\uFF09` : ""}\uFF1A${ruleMap[c.id]}`).join("\n");
  const dm = directives.map((d) => `- ${dmMap[d] ?? d}`).join("\n");
  return `\u3010STRATEGY\uFF08\u672C\u8F6E\u5BF9\u8BDD\u7B56\u7565\uFF0C\u5FC5\u987B\u9075\u5B88\u3002\u8FD9\u662F\u51B3\u7B56\u5C42\u7ED9\u4F60\u7684\u6307\u4EE4\uFF0C\u4E0D\u662F\u5EFA\u8BAE\uFF09\u3011
${list}
${dm ? `\u3010\u7981\u6B62\u9879\u3011
${dm}` : ""}`;
}
function buildAgentPrompt(args) {
  const { user, ai, aiView, rel, ctx, analysis, strategy } = args;
  const p = (v) => v.toFixed(2);
  const moodName = ["\u5F88\u4F4E\u843D", "\u4F4E\u843D", "\u6709\u4E9B\u4F4E", "\u5E73\u7A33", "\u8FD8\u4E0D\u9519", "\u633A\u597D", "\u5F88\u597D"][Math.round(aiView.mood * 6)] ?? "\u5E73\u7A33";
  const topEmo = analysis.emotion.primary_emotion === "neutral" ? "\u5E73\u9759" : analysis.emotion.primary_emotion;
  const intents = analysis.intents.filter((i) => i.surface_intent !== "neutral").map((i) => `${i.surface_intent} ${p(i.score)}`).join(" / ") || "\u666E\u901A\u4EA4\u6D41";
  const needs = analysis.needs.length ? analysis.needs.map((n) => `${n.need} ${p(n.confidence)}`).join(" / ") : "\uFF08\u4E0D\u786E\u5B9A\uFF09";
  const recent = ctx.recentEvents.length ? ctx.recentEvents.slice(-3).join("\uFF1B") : "\uFF08\u6CA1\u6709\u7279\u522B\u7684\u4E8B\uFF09";
  const unresolved = ctx.unresolvedEvents.length ? ctx.unresolvedEvents.slice(-2).join("\uFF1B") : "\uFF08\u65E0\uFF09";
  const trendZh = { rising: "\u56DE\u6696", falling: "\u8D70\u4F4E", stable: "\u5E73\u7A33", unstable: "\u8D77\u4F0F" }[ctx.emotionalTrend];
  return [
    `\u3010CURRENT CONTEXT\u2014\u2014\u5185\u90E8\u72B6\u6001\u6458\u8981\uFF08\u8FD9\u662F\u51B3\u7B56\u5C42\u7ED3\u8BBA\uFF0C\u4E0D\u8981\u81EA\u5DF1\u91CD\u7B97\uFF1B\u6839\u636E\u5B83\u81EA\u7136\u8868\u8FBE\uFF09\u3011`,
    `USER`,
    `  emotion: ${topEmo} ${p(analysis.emotion.intensity)} (${analysis.emotion.calmMask ? "\u8868\u9762\u5E73\u9759\uFF0C\u53EF\u80FD\u6709\u6240\u4FDD\u7559" : ""})`,
    `  intent: ${intents}`,
    `  willingness_to_talk: ${p(user.willingness_to_talk)}`,
    `  possible_needs: ${needs}\uFF08\u53EA\u662F\u5047\u8BBE\uFF0C\u4E0D\u8981\u76F4\u63A5\u6233\u7834\uFF09`,
    `  recent: ${recent}`,
    `  context: \u8BDD\u9898[${ctx.topTopic || "\u65E0"}] \xB7 \u60C5\u7EEA\u8D70\u5411${trendZh} \xB7 \u5BF9\u8BDD\u80FD\u91CF${p(ctx.conversationEnergy)}`,
    `  unresolved: ${unresolved}`,
    `AI`,
    `  mood: ${moodName}(${p(aiView.mood)}) \xB7 energy ${p(aiView.energy)} \xB7 curiosity ${p(ai.curiosity)}`,
    `  willingness_to_talk: ${p(ai.willingness_to_talk)} \xB7 interest ${p(ai.interest)}`,
    `RELATIONSHIP`,
    `  familiarity ${p(rel.familiarity)} \xB7 trust ${p(rel.trust)} \xB7 comfort ${p(rel.comfort)} \xB7 tension ${p(rel.tension)}`,
    ``,
    strategy.text
  ].join("\n");
}
function runAgentPipeline(text, opts) {
  const proactive = opts?.proactive ?? false;
  const lastAgentAt = store.lastAgentVirtualAt || 0;
  if (lastAgentAt > 0) {
    const elapsed = store.virtualMs - lastAgentAt;
    if (elapsed > 0)
      applyTimeDecay(elapsed);
  }
  const mind = loadMindState();
  const analysis = proactive ? { emotion: { primary_emotion: "neutral", secondary_emotions: [], intensity: 0, valence: 0, arousal: 0.2, confidence: 0.2, calmMask: false }, intents: [{ surface_intent: "neutral", score: 0.2 }], needs: [], rawText: "" } : analyzeMessage(text);
  const ctx = buildContext({ proactive });
  const u = updateUserState(mind.user, analysis, ctx, { lastAiTopic: mind.ai.lastTopic });
  const ai = updateAiMind(mind.ai, analysis, ctx, { likes: opts?.likes });
  const rel = updateRelationship(mind.rel, analysis);
  if (u.majorEventLabel) {
    rel.next.lastMajorLabel = u.majorEventLabel;
    rel.next.lastMajorTurn = store.turnCount;
    rel.next.lastMajorVirtualAt = store.virtualMs;
    if (!ctx.recentEvents.some((r) => r.includes(u.majorEventLabel))) {
      ctx.recentEvents.push(u.majorEventLabel);
    }
  }
  const aiView = aiStateView(ai.next);
  const relView = relationshipView(rel.next);
  const strategy = selectStrategy({ user: u.next, ai: ai.next, aiView, rel: relView, ctx, analysis, proactive });
  if (strategy.choices.some((c) => c.id === "comfort"))
    ai.next.comfortCount += 1;
  else
    ai.next.comfortCount = Math.max(0, ai.next.comfortCount - 1);
  store.userMind = u.next;
  store.aiMind = ai.next;
  store.relMind = rel.next;
  store.lastAgentVirtualAt = store.virtualMs;
  saveState();
  traceSeq += 1;
  const trace = {
    id: traceSeq,
    realAt: Date.now(),
    virtualAt: store.virtualMs,
    userText: proactive ? "\uFF08\u5979\u4E3B\u52A8\u5F00\u53E3\uFF09" : text,
    detectedSignal: `${analysis.emotion.primary_emotion} ${fmt(analysis.emotion.intensity)}${analysis.emotion.calmMask ? " [calm_mask]" : ""}` + (analysis.intents.filter((i) => i.surface_intent !== "neutral").length ? " / " + analysis.intents.filter((i) => i.surface_intent !== "neutral").map((i) => `${i.surface_intent} ${fmt(i.score)}`).join(" / ") : ""),
    stateTransition: u.transitions.concat(ai.transitions, rel.transitions).slice(0, 4).join(" \xB7 "),
    strategySummary: strategy.choices.map((c) => c.id).join(" + ") + (strategy.directives.length ? ` [${strategy.directives.join(", ")}]` : ""),
    response: "",
    refined: "",
    proactive
  };
  agentTrace.push(trace);
  if (agentTrace.length > MAX_TRACE)
    agentTrace.shift();
  const prompt = buildAgentPrompt({
    user: u.next,
    ai: ai.next,
    aiView,
    rel: relView,
    ctx,
    analysis,
    strategy
  });
  return {
    analysis,
    context: ctx,
    userBefore: mind.user,
    userAfter: u.next,
    aiBefore: mind.ai,
    aiAfter: ai.next,
    relTensionBefore: mind.rel.tension,
    relTensionAfter: rel.next.tension,
    strategy,
    prompt,
    trace,
    proactive
  };
}
function refineWithModelAnalysis(turn, refined) {
  if (!refined || typeof refined !== "object")
    return;
  const analysis = turn.analysis;
  const emo = analysis.emotion;
  const upd = [];
  if (typeof refined.primary_emotion === "string" && EMOTION_BASE[refined.primary_emotion]) {
    emo.primary_emotion = refined.primary_emotion;
    upd.push("emotion\u2192" + refined.primary_emotion);
  }
  if (typeof refined.intensity === "number" && refined.intensity >= 0 && refined.intensity <= 1 && Math.abs(refined.intensity - emo.intensity) >= 0.12) {
    emo.intensity = refined.intensity;
    upd.push("intensity\u2192" + fmt(refined.intensity));
  }
  if (typeof refined.intents === "object" && refined.intents) {
    for (const [k, v] of Object.entries(refined.intents)) {
      if (typeof v === "number" && v > 0.3) {
        const existing = analysis.intents.find((i) => i.surface_intent === k);
        if (existing)
          existing.score = (existing.score + v) / 2;
        else
          analysis.intents.push({ surface_intent: k, score: v });
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
  if (upd.length)
    turn.trace.refined = upd.join(" / ");
}
function finishAgentTurn(turn, response) {
  turn.trace.response = (response || "").slice(0, 80);
}
function getAgentTrace() {
  return agentTrace.slice();
}
function snapshotAgentMind() {
  const m = loadMindState();
  return { user: m.user, ai: m.ai, rel: m.rel, traceLen: agentTrace.length };
}
function restoreAgentMind(snap) {
  store.userMind = { ...snap.user };
  store.aiMind = { ...snap.ai };
  store.relMind = { ...snap.rel };
  store.lastAgentVirtualAt = store.virtualMs;
  agentTrace.length = snap.traceLen;
}
function resetAgentMind() {
  store.userMind = defaultUserMind();
  store.aiMind = defaultAiMind();
  store.relMind = defaultRelMind();
  store.lastAgentVirtualAt = store.virtualMs;
  agentTrace.length = 0;
  saveState();
}
function debugSnapshot() {
  const mind = loadMindState();
  const aiView = aiStateView(mind.ai);
  const rel = relationshipView(mind.rel);
  return { user: mind.user, ai: mind.ai, aiView, rel, trace: getAgentTrace() };
}
var mindTestHooks = {
  store,
  aiState,
  scheduleIndexFor,
  getTrace: getAgentTrace
};
export {
  CONTEXT_WINDOW,
  MAX_TRACE,
  StrategyPromptText,
  aiStateView,
  analyzeMessage,
  applyTimeDecay,
  buildAgentPrompt,
  buildContext,
  debugSnapshot,
  defaultAiMind,
  defaultRelMind,
  defaultUserMind,
  finishAgentTurn,
  getAgentTrace,
  imperfectionChance,
  loadMindState,
  mindTestHooks,
  persistMindState,
  refineWithModelAnalysis,
  relationshipView,
  resetAgentMind,
  restoreAgentMind,
  runAgentPipeline,
  selectStrategy,
  setImperfectionRate,
  snapshotAgentMind,
  updateAiMind,
  updateRelationship,
  updateUserState
};
