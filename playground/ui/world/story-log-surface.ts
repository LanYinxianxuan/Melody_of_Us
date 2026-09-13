// ui/world/story-log-surface.ts —— 【Phase 5-A4】Story Log：完整叙事记录（含来源标记）
//
// 与 `event-surface.ts` 的分工（这是本阶段的核心设计决定）：
//
//   Recent Core Events（`event-surface.ts` / `#world-events`）
//     = 「世界最近**真正**发生了什么」
//       **只**显示 `source === "core"`（Core 确认的事实）
//
//   Story Log（本文件 / `#story-events`）
//     = 「完整叙事记录」
//       保留 core / narrative / director **全部**历史，但**每条都标出来源**
//
//   两者允许部分重叠。**不为了去重而删信息**。
//
// 硬约束：
//   ① 只渲染，不判断"谁算事实"：`source` 与 `factual` 由 VM / 存档契约给出
//   ② 不伪造时间：`StoryEvent` 只有 `day`（没有 `HH:MM`），因此这里**只显示"第 N 天"**。
//      **绝不**用 `Date.now()` 或当前虚拟时间去冒充事件发生时刻（Phase 5-D3 明确禁止）
//   ③ 不改世界：无 store 写入 / 无 fetch / 无 localStorage
//   ④ 每秒不重建：按行复用 + 文本签名比对

import * as ui from "../dom";

/**
 * Story Log 只需要的字段（**故意不依赖 `WorldEventVm`**）。
 *
 * 为什么：本表面要能被**领域层**（`story.ts` 的 `updateStoryUI`）调用，
 * 而 `story.ts` 不能 import `world-view-model.ts` —— 后者 import 了 `storyStage()`，
 * 会形成模块级循环。把入参收窄成一个结构性最小类型（`WorldEventVm` 可结构兼容地传进来），
 * 依赖方向就是干净的 `story.ts → ui/world/story-log-surface`。
 */
export interface StoryLogRow {
    day: number;
    text: string;
    /** core | narrative | director（未识别时按 narrative 展示，绝不默认成 core） */
    source: string;
    today: boolean;
}

const CONTAINER_ID = "story-events";
/** 保留的最近条数（与既有 `updateStoryUI` 的 `slice(-6)` 一致，未改变展示量） */
const MAX_ROWS = 6;

/** 来源 → 展示标记（**纯展示语义**，不改变任何数据含义） */
const SOURCE_META: Record<string, { label: string; cls: string; title: string }> = {
    core: { label: "事实", cls: "story-event-source-core", title: "世界里已经被确认发生过的事" },
    narrative: { label: "叙述", cls: "story-event-source-narrative", title: "她当时的讲述，不一定是世界事实" },
    director: { label: "调度", cls: "story-event-source-director", title: "世界调度层当时的判断理由" },
};

const EMPTY_TEXT = "还没有值得记下的事。";

interface Row {
    root: HTMLElement;
    badge: HTMLElement;
    day: HTMLElement;
    text: HTMLElement;
    last: string;
}

const rows: Row[] = [];

function createRow(): Row {
    const root = document.createElement("div");
    root.className = "story-event";

    const badge = document.createElement("span");
    badge.className = "story-event-source";

    const day = document.createElement("span");
    day.className = "story-event-day";

    const text = document.createElement("span");
    text.className = "story-event-text";

    root.append(badge, day, text);
    return { root, badge, day, text, last: "" };
}

/**
 * 渲染（或就地更新）Story Log。
 *
 * @param events 全量档案（`WorldViewModel.allEvents`）—— 本表面**有意**接收全部来源。
 * @param currentDay 当前是第几天（用于"今天"不显示天数）
 * @returns 是否发生任何 DOM 写入
 */
export function renderStoryLog(events: StoryLogRow[], currentDay: number): boolean {
    const container = ui.optEl(CONTAINER_ID);
    if (!container) return false;

    const list = events.slice(-MAX_ROWS);

    if (!list.length) {
        if (container.dataset.empty === "1") return false;
        container.innerHTML = "";
        rows.length = 0;
        const empty = document.createElement("div");
        empty.className = "story-event-empty";
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

    while (rows.length < list.length) {
        const row = createRow();
        rows.push(row);
        container.appendChild(row.root);
        wrote = true;
    }
    while (rows.length > list.length) {
        const row = rows.pop()!;
        row.root.remove();
        wrote = true;
    }

    for (let i = 0; i < list.length; i++) {
        const e = list[i]!;
        const row = rows[i]!;
        const meta = SOURCE_META[e.source] ?? SOURCE_META["narrative"]!;
        // 同一天不重复标天数（今天则完全不标，避免每行都是"第 1 天"）
        const dayText = e.today ? "" : `第 ${e.day} 天`;
        const signature = `${e.source}|${dayText}|${e.text}`;
        if (row.last === signature) continue;
        row.last = signature;
        wrote = true;

        if (row.badge.textContent !== meta.label) row.badge.textContent = meta.label;
        row.badge.className = `story-event-source ${meta.cls}`;
        row.badge.title = meta.title;
        row.day.textContent = dayText;
        row.text.textContent = e.text;
    }

    return wrote;
}

/** 测试用 */
export function __resetStoryLogForTest(): void {
    for (const row of rows) row.root.remove();
    rows.length = 0;
    const c = ui.optEl(CONTAINER_ID);
    if (c) {
        c.innerHTML = "";
        delete c.dataset.empty;
    }
}

export function storyLogRowCount(): number {
    return rows.length;
}

/** 只读：某个来源的展示标记（供测试断言"来源映射没有被混淆"） */
export function sourceBadgeLabel(source: string): string {
    return (SOURCE_META[source] ?? SOURCE_META["narrative"]!).label;
}
