// ui/world/npc-surface.ts —— 【Phase 5-A3】NPC Surface：把"世界里的其他人"渲染出来
//
// 职责：`WorldViewModel.npcs` → DOM（`.npc-row`）。**只渲染。**
//
// 三条硬约束：
//   ① **不编造活动**：`activity` / `location` 只取自 `NpcState`（由 `updateNpcSchedule`
//      按 NPC 自己的作息表 + 虚拟时间推进）。若 Core 没有这个事实，这里**不会**生成它。
//      因此当 `activity` 为空时渲染成"（还没有活动记录）"，而不是编一句"正在休息"。
//   ② **每秒不重建整个列表**：用 `.npc-row` 的 key 做**就地复用**（文本只在变化时写入），
//      避免 `tickClock` 每秒 destroy/recreate 一堆 DOM（Phase 5 §17）。
//   ③ **不写世界**：不 import store / 不 import core 的可变导出 / 不 fetch / 不碰 localStorage。

import * as ui from "../dom";
import type { WorldNpcVm } from "./world-view-model";

/** 渲染容器 id（与 `chat.html` 的 `#world-npcs` 对应） */
const CONTAINER_ID = "world-npcs";

/** 每行内部结构固定，便于就地更新 */
interface Row {
    root: HTMLElement;
    avatar: HTMLElement;
    name: HTMLElement;
    state: HTMLElement;
    /** 上一次写入的文本，用于"只在变化时写 DOM" */
    last: string;
}

const rows = new Map<string, Row>();

/**
 * 把 NPC 的「活动 + 地点 + 时段」组合成一句自然表达。
 *
 * ⚠️ 这里的组合规则**只用 Core 已有的字段**：
 *    `present`  → 在场状态（`NpcState.present`）
 *    `activity` → 她在做什么（`NpcState.activity`）
 *    `location` → 她在哪（`NpcState.location`）
 *    `label`    → 当前时段（`NpcState.label`）
 * 不会根据时间/关系去**推断**任何新事实。
 */
function describeNpcState(n: WorldNpcVm): string {
    const activity = (n.activity || "").trim();
    const location = (n.location || "").trim();

    if (!activity && !location) {
        // Core 还没有她的作息信息（极早期）——如实说明，不编造
        return "（还没有她的消息）";
    }
    // 「在场」时强调她就在这儿；否则给出"在哪 + 在做什么"
    if (n.present) {
        return activity ? `就在这儿，${activity}` : "就在这儿";
    }
    if (activity && location) return `在${location}，${activity}`;
    if (location) return `在${location}`;
    return activity;
}

function createRow(n: WorldNpcVm): Row {
    const root = document.createElement("div");
    root.className = "npc-row";
    root.dataset.npc = n.id;

    const avatar = document.createElement("span");
    avatar.className = "npc-row-avatar";
    avatar.textContent = n.avatar;

    const body = document.createElement("div");
    body.className = "npc-row-body";

    const name = document.createElement("span");
    name.className = "npc-row-name";
    name.textContent = n.name;

    const state = document.createElement("span");
    state.className = "npc-row-state";

    body.append(name, state);
    root.append(avatar, body);
    return { root, avatar, name, state, last: "" };
}

/**
 * 渲染（或就地更新）NPC 列表。
 *
 * @returns 是否发生了任何 DOM 写入（便于测试断言"没变化时不重建"）
 */
export function renderNpcSurface(npcs: WorldNpcVm[]): boolean {
    const container = ui.optEl(CONTAINER_ID);
    if (!container) return false; // 页面没有这块区域时静默跳过（不抛错）

    let wrote = false;
    const seen = new Set<string>();

    // 不在场/不在列表里的 NPC：移除其行（NPC 集合是常量表，但保持这段逻辑以防将来变化）
    for (const [id, row] of rows) {
        if (npcs.some((n) => n.id === id)) continue;
        row.root.remove();
        rows.delete(id);
        wrote = true;
    }

    for (const n of npcs) {
        seen.add(n.id);
        let row = rows.get(n.id);
        if (!row) {
            row = createRow(n);
            rows.set(n.id, row);
            container.appendChild(row.root);
            wrote = true;
        }

        // 只在文本真正变化时写 DOM（这是"每秒不重建"的关键）
        const stateText = describeNpcState(n);
        const nameText = `${n.avatar} ${n.name}`;
        const signature = `${nameText}|${stateText}|${n.present}`;
        if (row.last === signature) continue;
        row.last = signature;

        if (row.avatar.textContent !== n.avatar) row.avatar.textContent = n.avatar;
        if (row.name.textContent !== n.name) row.name.textContent = n.name;
        if (row.state.textContent !== stateText) row.state.textContent = stateText;
        row.root.classList.toggle("present", n.present);
        wrote = true;
    }

    void seen;
    return wrote;
}

/** 测试用：清空缓存（换页/夹具复用同一容器时需要） */
export function __resetNpcSurfaceForTest(): void {
    for (const row of rows.values()) row.root.remove();
    rows.clear();
}

/** 测试用：当前已渲染的行数 */
export function npcRowCount(): number {
    return rows.size;
}
