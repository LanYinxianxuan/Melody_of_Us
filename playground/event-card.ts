// event-card.ts —— 随机事件卡（全局：单人/多人模式均触发）
// 原则（与本项目"事件系统"一致）：代码层只管【何时触发】，事件内容由 AI（DS）生成。
// 事件卡只做场景呈现（细致描写：环境/感官/站位/氛围），不包含"预判动作"——
// 预判动作是独立常驻功能（见 action-suggest.ts），与随机事件无关。
//
// 需求点对照：
// ① 全局模式：单人与多人模式都走随机事件提示词（多人时有在场 NPC，单人时只写你们两人+主角反应）
// ② 触发概率 30%~40%（CARD_CHANCE=0.35）；连续 7 轮未触发 → 强制触发（保证弹出来）
// ③ 场景描写由 DS 生成：环境细节/感官/角色站位/氛围（见 ai.ts RANDOM_EVENT_PROMPT）
// ⑤ 推送给 DS 的消息为严格 JSON（task + context，见 generateRandomEvent）

import { generateRandomEvent, type RandomEventResult } from "./ai";
import { store, currentSlot, saveState, slotKey, KEY_PREFIX } from "./storage";
import { currentSchedule, fmtVirtualTime, currentDayIndex } from "./time";
import * as ui from "./ui/dom";

// ============ 触发状态（自身轮次计数，避免依赖 store.turnCount） ============

const CARD_CHANCE = 0.35;    // 30%~40% 区间
const CARD_MIN_GAP = 4;      // 触发后至少间隔 4 轮
const CARD_FORCE_AFTER = 7;  // 连续 7 轮未触发 → 强制触发（保证一定会弹出来）

let callCount = 0;          // 每轮（主回复完成后检查一次）
let lastTriggerCall = -99;  // 上次触发所在轮

export function resetEventCardTracker() {
    callCount = 0;
    lastTriggerCall = -99;
    dismissAllEventCards();
}

// ============ 内置事件池（无 API Key / 模型生成失败时的兜底） ============
// 保证任何情况下事件卡都能弹出来（演示模式同样可见）

export function pickDemoEvent(): RandomEventResult | null {
    if (!DEMO_EVENTS.length) return null;
    return DEMO_EVENTS[Math.floor(Math.random() * DEMO_EVENTS.length)]!;
}

const DEMO_EVENTS: RandomEventResult[] = [
    {
        title: "一阵风",
        scene: "窗外的风忽然大了起来，桌上的作业纸被吹得哗啦作响，有一张飘到了地上。阳光在扬起的灰尘里打着转，空气里有雨前潮湿的味道。",
        npc: "她先弯下腰捡起纸，抬眼看向你，像在等你的反应。",
    },
    {
        title: "饮料泼了",
        scene: "隔壁桌的人起身时碰翻了你的杯子，饮料在桌面上漫开，顺着桌沿往下滴。周围几桌的人抬起头看了一眼又转回去，旁人似乎还没注意到这边的动静。",
        npc: "她愣了一下，手已经伸到一半，似乎在犹豫要不要递纸巾。",
    },
    {
        title: "广播声",
        scene: "墙上的广播忽然响了，先是一段电流的白噪音，然后传出断断续续的通知声，声音在走廊里回荡。谁也不说话了，等广播结束后，四周安静得能听见窗外树叶摩擦的声音。",
        npc: "她侧头听了两秒，等广播结束后看向你，嘴角带着一点才回过神来的笑意。",
    },
    {
        title: "路过的猫",
        scene: "一只橘猫从墙根慢吞吞地走过来，在你们脚边停下，仰头看了看，然后旁若无人地蹲下来舔爪子。午后的阳光把它的毛晒得发亮，周围安静得只剩它吧唧吧唧舔毛的声音。",
        npc: "她蹲下来，伸出一根手指试探着靠近猫，然后抬眼看你，像是想让你也来。",
    },
    {
        title: "忽然降温",
        scene: "一阵穿堂风扫过来，天色暗了半个度，空气一下凉了下来。桌上的纸边被吹起又落下，远处有人哆嗦着加快了脚步，刚才还在聊天的热闹似乎也被这阵风带走了几分。",
        npc: "她下意识缩了缩肩膀，呵出一口白气，皱着鼻子看向你。",
    },
];

// ============ 主入口：主角回复完成后调用 ============

export async function maybeShowEventCard(mainName: string): Promise<void> {
    callCount++;

    // 连续 7 轮未触发 → 强制触发（保证一定会弹出来）
    const forced = callCount - lastTriggerCall > CARD_FORCE_AFTER;
    if (!forced && callCount - lastTriggerCall <= CARD_MIN_GAP) {
        console.log("[随机事件卡] 跳过：冷却中");
        return;
    }
    // ② 30%~40% 触发
    if (!forced && Math.random() > CARD_CHANCE) {
        console.log("[随机事件卡] 跳过：未命中概率");
        return;
    }

    lastTriggerCall = callCount;

    // 优先模型生成；无 Key / 生成失败 → 内置事件池兜底（任何情况下都能弹出来）
    const hasKey = !!localStorage.getItem(slotKey(KEY_PREFIX.apikey, currentSlot));
    let result: RandomEventResult | null = null;
    if (hasKey) {
        try {
            result = await generateRandomEvent(buildEventContext(mainName));
        } catch (e) {
            console.warn("[随机事件卡] 模型生成失败，降级内置事件：", e);
        }
    }
    if (!result || !result.scene) {
        result = pickDemoEvent();
        if (result) console.log(`[随机事件卡] 内置事件：${result.title}`);
    }
    if (!result) return;

    // 事件入剧情档案（AI 后续对话能读到，前后连贯）
    store.storyEvents.push({ day: currentDayIndex(), text: `🎲 随机事件「${result.title}」：${result.scene.slice(0, 36)}`, source: "narrative" });
    if (store.storyEvents.length > 100) store.storyEvents.shift();
    saveState();
    renderEventCard(result);
}

// ============ 上下文组装（推给 DS 的 JSON 消息体，纯数据） ============

function buildEventContext(mainName: string): Record<string, unknown> {
    const slot = currentSchedule();
    const npcs = store.presentNpcs
        .map((id) => store.npcs[id])
        .filter(Boolean)
        .map((n) => ({ name: n!.profile.name, title: n!.profile.title, activity: n!.activity, location: n!.location }));
    const recent = store.chatHistory.slice(-4).map((e) => ({ role: e.role, content: e.content.slice(0, 40) }));
    return {
        mode: store.npcEnabled && npcs.length ? "multi" : "single", // 单/多人模式：事件中"站位/反应"描写对象不同
        time: { day: currentDayIndex(), virtual: fmtVirtualTime(), schedule_label: slot.label },
        place: store.scene.place,
        activity: slot.activity,
        busy: !!slot.busy,
        main_character: mainName,
        present_npcs: npcs,
        recent_dialogue: recent,
        active_thread: store.activeThread,
        previous_events: store.storyEvents.slice(-5).map((e) => e.text), // 避免重复同类事件
    };
}

// ============ 事件卡渲染（纯场景呈现；反应由预判动作条/输入框处理） ============

function renderEventCard(result: RandomEventResult): void {
    const container = ui.optEl("chat-messages");
    if (!container) return;

    const card = document.createElement("div");
    card.className = "event-card";

    const head = document.createElement("div");
    head.className = "event-card-head";
    head.innerHTML = `<span class="event-card-dice">🎲</span><span class="event-card-title">${escapeHtml(result.title)}</span>`;
    card.appendChild(head);

    const scene = document.createElement("div");
    scene.className = "event-card-scene";
    scene.textContent = result.scene;
    card.appendChild(scene);

    if (result.npc) {
        const npc = document.createElement("div");
        npc.className = "event-card-npc";
        npc.textContent = result.npc;
        card.appendChild(npc);
    }

    container.appendChild(card);
    container.scrollTop = container.scrollHeight;
}

// 用户从主输入框继续聊天 → 事件卡视为"错过"（淡出）
export function passOpenEventCards(): void {
    for (const card of ui.qsa(".event-card")) {
        card.classList.add("passed");
    }
}

export function dismissAllEventCards(): void {
    for (const card of ui.qsa(".event-card")) card.remove();
}

// 预览模式：不调用模型、不触发概率，直接渲染一张样例事件卡
// 用途：UI 预览/test（URL 带 ?eventdemo=1 或控制台 __debug.eventDemo()）
export function previewEventCard(): void {
    renderEventCard({
        title: "一阵风",
        scene: "窗外的风忽然大了起来，桌上的作业纸被吹得哗啦作响，有一张飘到了地上。阳光在扬起的灰尘里打着转，空气里有雨前潮湿的味道。",
        npc: "她先弯下腰捡起纸，抬眼看向你，像在等你的反应。",
    });
    const container = ui.optEl("chat-messages");
    if (container) container.scrollTop = container.scrollHeight;
}

// 强制触发一次真实的随机事件卡（跳过概率与冷却，仍需 API Key；单/多人模式均可用）
// 用途：__debug.eventReal() —— 用真实模型查看事件卡效果
export async function forceShowEventCard(mainName: string): Promise<void> {
    lastTriggerCall = callCount; // 消耗冷却
    const result = await generateRandomEvent(buildEventContext(mainName));
    if (!result.scene) return;
    store.storyEvents.push({ day: currentDayIndex(), text: `🎲 随机事件「${result.title}」：${result.scene.slice(0, 36)}`, source: "narrative" });
    if (store.storyEvents.length > 100) store.storyEvents.shift();
    saveState();
    renderEventCard(result);
}

function escapeHtml(s: string): string {
    return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
