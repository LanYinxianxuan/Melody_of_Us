// agenda.ts —— 日程时间线系统
// AI 是"世界导演"：每天规划当天日程（基于场景/关系/剧情线），随时间流逝事件推进；
// 对话中用户/主角创建的约定也会加入时间线，由 AI 之后自然推动它发生。
// 左侧面板渲染"今日日程"，当前进行中的事件高亮，已完成的打勾。

import { store, saveState, type AgendaDay, type AgendaItem } from "./storage";
import { currentDayIndex, currentSchedule, getSchedule, fmtVirtualTime, slotMinutes } from "./time";
import { aiState, describeMood } from "./state";
import { storyStage } from "./story";

// ============ 日程读写 ============

// 获取某天的日程（没有则返回空）
export function agendaFor(day: number): AgendaDay | undefined {
    return store.agenda.find((d) => d.day === day);
}

// 确保某天日程存在
function ensureAgenda(day: number): AgendaDay {
    let d = agendaFor(day);
    if (!d) {
        d = { day, items: [] };
        store.agenda.push(d);
        store.agenda.sort((a, b) => a.day - b.day);
        if (store.agenda.length > 14) store.agenda = store.agenda.slice(-14);
    }
    return d;
}

// 今天是否还没有任何日程（用于决定是否让 AI 规划）
export function todayHasNoAgenda(): boolean {
    const today = currentDayIndex();
    const d = agendaFor(today);
    return !d || d.items.length === 0;
}

// ============ 添加事件 ============

// 添加事件到某天（AI 规划 / 用户约定）
export function addAgendaItem(day: number, item: { time?: string; title: string; desc?: string; source?: "ai" | "user" }): AgendaItem {
    const d = ensureAgenda(day);
    const ai: AgendaItem = {
        time: item.time ?? fmtVirtualTime(),
        title: item.title.trim().slice(0, 30),
        desc: item.desc?.trim().slice(0, 60),
        status: "todo",
        source: item.source ?? "ai",
    };
    // 去重：标题相近且时间相近的不重复添加
    const dup = d.items.find(
        (x) => x.title === ai.title && Math.abs(slotMinutes(x.time) - slotMinutes(ai.time)) < 30,
    );
    if (!dup) {
        d.items.push(ai);
        d.items.sort((a, b) => slotMinutes(a.time) - slotMinutes(b.time));
    }
    saveState();
    return ai;
}

// 对话中产生的约定 → 加到今天（AI 通过 agenda.add 返回）
export function applyAgendaFromAI(agenda: { add?: { time?: string; title: string; desc?: string }[] } | undefined) {
    if (!agenda?.add?.length) return;
    const today = currentDayIndex();
    for (const a of agenda.add) {
        if (a.title?.trim()) {
            addAgendaItem(today, { time: a.time, title: a.title, desc: a.desc, source: "user" });
        }
    }
}

// ============ 状态推进 ============

// 根据当前虚拟时间更新事件状态：
// 事件时间 < 当前时段起点 → done；事件时间 == 当前时段 → active；未来 → todo
export function tickAgenda() {
    const today = currentDayIndex();
    const slot = currentSchedule();
    const nowMin = slotMinutes(fmtVirtualTime());
    // 当前时段起点（该时段的最小分钟数）
    const curStartMin = slotMinutes(slot.time);

    for (const dayEntry of store.agenda) {
        // 过去的日期：全部标记 done
        if (dayEntry.day < today) {
            for (const it of dayEntry.items) {
                if (it.status !== "done") it.status = "done";
            }
            continue;
        }
        if (dayEntry.day === today) {
            for (const it of dayEntry.items) {
                const tMin = slotMinutes(it.time);
                if (tMin < curStartMin) {
                    it.status = "done"; // 已经过去的时段
                } else if (tMin <= nowMin) {
                    it.status = "active"; // 当前时段
                } else {
                    it.status = "todo"; // 未来
                }
            }
        }
    }

    // 深夜：当天所有 todo 清为 done（一天结束）
    if (slot.label === "深夜") {
        const d = agendaFor(today);
        if (d) {
            for (const it of d.items) if (it.status !== "done") it.status = "done";
        }
    }
}

// 生成"今天日程"给 AI 的上下文（喂进 prompt，让 AI 知道今天安排了什么、推进到哪了）
export function agendaContext(): string {
    const today = currentDayIndex();
    const d = agendaFor(today);
    if (!d || !d.items.length) return "";
    const lines = d.items.map((it) => {
        const mark = it.status === "done" ? "✓已完成" : it.status === "active" ? "▶进行中" : "○待进行";
        return `  ${it.time} ${mark} ${it.title}${it.desc ? `（${it.desc}）` : ""}`;
    });
    return `【今日日程】\n${lines.join("\n")}\n当前是 ${fmtVirtualTime()}，你正处在这些安排之中——随着时间流逝，推进它们；该发生的事自然发生。\n`;
}

// ============ 左侧面板 UI ============

// 渲染时间线（左侧面板"今日日程"区）
export function renderAgendaUI() {
    const box = document.getElementById("agenda-list");
    if (!box) return;

    const today = currentDayIndex();
    const d = agendaFor(today);

    const dayEl = document.getElementById("agenda-day");
    if (dayEl) dayEl.textContent = `第 ${today} 天`;
    box.innerHTML = "";

    if (!d || !d.items.length) {
        const empty = document.createElement("div");
        empty.className = "agenda-empty";
        empty.textContent = "今天还没有安排……让故事自然发生吧。";
        box.appendChild(empty);
        return;
    }

    for (const it of d.items) {
        const row = document.createElement("div");
        row.className = `agenda-item ${it.status}`;
        row.dataset.status = it.status;

        const time = document.createElement("span");
        time.className = "agenda-time";
        time.textContent = it.time;

        const title = document.createElement("span");
        title.className = "agenda-title";
        title.textContent = it.title;

        const mark = document.createElement("span");
        mark.className = "agenda-mark";
        mark.textContent = it.status === "done" ? "✓" : it.status === "active" ? "▶" : "○";

        row.appendChild(mark);
        row.appendChild(time);
        row.appendChild(title);

        if (it.desc) {
            const desc = document.createElement("div");
            desc.className = "agenda-desc";
            desc.textContent = it.desc;
            row.appendChild(desc);
        }

        box.appendChild(row);
    }
}

// 角色上下文回调（chat.ts 注入：名字/性格/背景/关系，用于规划贴合角色的日程）
let characterGetter: (() => { name: string; personality: string; background: string; relation: string }) | null = null;
export function setAgendaCharacterGetter(fn: () => { name: string; personality: string; background: string; relation: string }) {
    characterGetter = fn;
}

// 历史里的内部说明性占位符（她主动开口 / NPC 转述）不应被当作真实用户消息喂给日程规划
function isInternalHistoryPlaceholder(e: { role: string; content: string }): boolean {
    return e.role === "user" && (
        e.content === "（她主动找你说话）" ||
        /^（.+对你说）$/.test(e.content) ||
        /^（.+和她说了话）$/.test(e.content)
    );
}

// 构建“当前故事/情绪上下文”，让 AI 排日程时不是凭空生成，而是承接最近发生过的事
function scheduleContextText(): string {
    const parts: string[] = [];

    const recent = store.chatHistory.slice(-6).filter((e) => !isInternalHistoryPlaceholder(e));
    if (recent.length) {
        parts.push(
            "最近对话：" + recent.map((e) =>
                `${e.role === "user" ? "对方" : "她"}：${e.content.slice(0, 40)}`,
            ).join(" ｜ "),
        );
    }

    if (store.memories.length) {
        parts.push("她记得的事：" + store.memories.slice(-4).join("；"));
    }

    if (store.activeThread) {
        parts.push(`进行中的剧情线：${store.activeThread}`);
    }

    const recentEvents = store.storyEvents.slice(-4).map((e) => e.text);
    if (recentEvents.length) {
        parts.push("最近发生：" + recentEvents.join("；"));
    }

    const stage = storyStage();
    parts.push(`当前剧情阶段：${stage.name}（${stage.desc}）`);
    if (store.storyProgress > 0) parts.push(`剧情总进度：${store.storyProgress}%`);

    // 用几个关键情绪维度简要描述，避免把整段 describeMood 塞进去太长
    const moodBits: string[] = [];
    if (aiState.joy > 55) moodBits.push("心情不错");
    if (aiState.sadness > 45) moodBits.push("有点低落");
    if (aiState.anger > 40) moodBits.push("在闹别扭");
    if (aiState.loneliness > 40) moodBits.push("有点孤单");
    if (aiState.anxiety > 45) moodBits.push("有些不安");
    if (aiState.fatigue > 50) moodBits.push("有点累");
    if (aiState.anticipation > 50) moodBits.push("有些期待");
    parts.push(`她现在的状态：${moodBits.join("，") || "情绪平稳"}（${describeMood()}）`);

    return parts.join("\n");
}

// 跨天时由 AI 规划当天日程（走主角 AI 一次调用；无 key 时用作息表兜底）
export async function planTodayAgenda(chatFn: (text: string) => Promise<{ agenda?: { add?: { time?: string; title: string; desc?: string }[] } }>): Promise<void> {
    const today = currentDayIndex();
    if (!todayHasNoAgenda()) return;

    // 角色上下文：让日程贴合"她是谁"
    const ch = characterGetter?.() ?? { name: "她", personality: "", background: "", relation: "" };
    const charBrief = [
        ch.name ? `她叫${ch.name}` : "",
        ch.personality ? `性格：${ch.personality.slice(0, 40)}` : "",
        ch.background ? `背景：${ch.background.slice(0, 50)}` : "",
        ch.relation ? `你们的关系：${ch.relation.slice(0, 40)}` : "",
        `她平时在${store.scene.place}${store.scene.routine}，身边是${store.scene.others}。`,
    ].filter(Boolean).join("；");

    try {
        const context = scheduleContextText();
        const result = await chatFn(
            `（请以${ch.name || "她"}的视角，为今天规划一份贴合她本人的日程。\n` +
            `关于她：${charBrief}\n` +
            `你们此刻在${store.scene.name}。今天是第 ${today} 天，当前虚拟时间 ${fmtVirtualTime()}。\n` +
            `【必须参考的上下文】\n${context}\n` +
            `要求：\n` +
            `1. 从早到晚排 8~12 个具体时段，时间粒度要细（每段建议 15~40 分钟），不要只写"上午/中午/晚上"这种大块概括；\n` +
            `2. 时间精确到 HH:MM，并且严格按当天时间顺序；可以精确到 07:15、08:40、12:20、18:35 这种程度；\n` +
            `3. 要承接上面的上下文：最近聊过的事、她记得的事、进行中的剧情线、最近发生的事件、当前情绪，都会影响她今天想做什么、和你怎么相处；\n` +
            `4. 可以包含她自己的安排（工作/爱好/心事）、和你的相处（见面、一起做的事）、以及可能发生的小插曲，但都要具体到某个时间段；\n` +
            `5. 不要写通用模板，要像她真实的一天。直接输出完整 JSON 中的 agenda.add 数组：每项 time 用 HH:MM，title 一句话事件（20字内），desc 可选补充具体细节。）`,
        );
        if (result?.agenda?.add?.length) {
            for (const a of result.agenda.add) {
                if (a.title?.trim()) addAgendaItem(today, { time: a.time, title: a.title, desc: a.desc, source: "ai" });
            }
        } else {
            // AI 没返回日程（demo/无key/失败）→ 用作息表兜底
            fallbackPlanToday();
        }
    } catch {
        fallbackPlanToday();
    }

    renderAgendaUI();
}

// 兜底：把当前场景作息表转成今天的日程（无 AI key 时也能显示时间线）
export function fallbackPlanToday() {
    const today = currentDayIndex();
    for (const slot of getSchedule()) {
        const activity = slot.activity.replace(/你/g, "她");
        addAgendaItem(today, { time: slot.time, title: slot.label, desc: activity, source: "ai" });
    }
}
