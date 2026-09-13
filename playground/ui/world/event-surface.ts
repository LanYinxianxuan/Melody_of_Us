// ui/world/event-surface.ts —— 【Phase 5-A4 地基】Recent Core Events
//
// 职责：`WorldViewModel.coreFacts` → DOM（`.world-event`）。**只渲染。**
//
// 核心约束（Phase 5 §9 / §14）：
//   只展示 `source === "core"` 的**既成事实**。
//   `narrative`（AI 叙述）与 `director`（调度器解释）**不得**出现在这里 ——
//   它们最多出现在"剧情进展"节的档案列表里（`.story-event`，那是回顾而非"世界事件流"）。
//
//   本模块不判断"谁算事实"：判定由 `isFactualStoryEvent`（Core 的存档契约）完成，
//   VM 已经把结论放在 `factual` 字段上。这里**只消费**那个布尔值，不重新推导规则。
//
// 与 `npc-surface.ts` 相同的三条硬约束：不编造事件、每秒不重建、不写世界。

import * as ui from "../dom";
import type { WorldEventVm } from "./world-view-model";

const CONTAINER_ID = "world-events";
/** 超过这个条数就截断（世界表面只表达"最近"，不做完整历史） */
const MAX_ROWS = 6;

interface Row {
    root: HTMLElement;
    text: HTMLElement;
    last: string;
}

const rows: Row[] = [];

/** 当没有既成事实时的占位文案（如实说明，不编造事件） */
const EMPTY_TEXT = "还没有发生什么——日子正安静地过着。";

function createRow(): Row {
    const root = document.createElement("div");
    root.className = "world-event";
    const dot = document.createElement("span");
    dot.className = "world-event-dot";
    dot.textContent = "·";
    const text = document.createElement("span");
    text.className = "world-event-text";
    root.append(dot, text);
    return { root, text, last: "" };
}

/**
 * 渲染（或就地更新）"最近发生"列表。
 *
 * @param events **已经**是既成事实（调用方传 `vm.coreFacts`）。
 *               本模块刻意**不**接收全量档案，避免"不小心把 narrative 混进来"。
 * @returns 是否发生任何 DOM 写入
 */
export function renderEventSurface(events: WorldEventVm[]): boolean {
    const container = ui.optEl(CONTAINER_ID);
    if (!container) return false;

    // 二次防线：即使调用方误传了全量列表，也只渲染 factual 的条目。
    // 这是"narrative 不得进入世界事件流"这条约束的**结构性保证**，
    // 而不是仅靠调用方自觉。
    const factual = events.filter((e) => e.factual).slice(-MAX_ROWS);

    if (!factual.length) {
        if (rows.length === 0 && container.dataset.empty === "1") return false;
        container.innerHTML = "";
        rows.length = 0;
        const empty = document.createElement("div");
        empty.className = "world-event-empty";
        empty.textContent = EMPTY_TEXT;
        container.appendChild(empty);
        container.dataset.empty = "1";
        return true;
    }

    let wrote = false;
    if (container.dataset.empty === "1") {
        container.innerHTML = "";
        rows.length = 0;
        delete container.dataset.empty;
        wrote = true;
    }

    // 行数不足则补足
    while (rows.length < factual.length) {
        const row = createRow();
        rows.push(row);
        container.appendChild(row.root);
        wrote = true;
    }
    // 行数过多则截断（从尾部移除，保持前面对应的顺序）
    while (rows.length > factual.length) {
        const row = rows.pop()!;
        row.root.remove();
        wrote = true;
    }

    for (let i = 0; i < factual.length; i++) {
        const e = factual[i]!;
        const row = rows[i]!;
        // 同一天不重复标日期，避免每行都出现"第 1 天"
        const prefix = e.today ? "" : `第 ${e.day} 天 · `;
        const line = `${prefix}${e.text}`;
        if (row.last === line) continue;
        row.last = line;
        row.text.textContent = line;
        wrote = true;
    }

    return wrote;
}

/** 测试用 */
export function __resetEventSurfaceForTest(): void {
    for (const row of rows) row.root.remove();
    rows.length = 0;
    const c = ui.optEl(CONTAINER_ID);
    if (c) {
        c.innerHTML = "";
        delete c.dataset.empty;
    }
}

export function eventRowCount(): number {
    return rows.length;
}
