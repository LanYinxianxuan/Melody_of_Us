// ui/state-panel.ts —— 38 维状态面板与情绪曲线（阶段 3，纯渲染搬迁）
//
// 职责：把情感状态画成 DOM / canvas。**不读不写存档，不做任何规则判断**。
//
// 为什么用 getter 注入而不是直接 import `aiState`：
//   `state.ts` 导出的是 `export let aiState`，加载存档时会被**整体重新赋值**
//   （`applyLoadedState` → 重新指向新对象）。ESM 的 live binding 只在**同一个模块图**
//   里可靠；把 `aiState` 直接 import 进本模块，会让"值快照 vs 活绑定"变成一个
//   隐含假设 —— 一旦将来有人把 import 改成解构，就会静默读到旧对象。
//   因此这里显式要求调用方注入 `() => currentAiState`，语义明确、不可误用。

import * as ui from "./dom";
import { DIMENSIONS, describeMood, type AIState } from "../state";
import { MAX_MOOD_ENTRIES, trimContainer } from "./message";

/** 当前情感状态的读取器（由 chat.ts 注入，保证拿到的是最新对象） */
let getState: () => AIState = () => {
    throw new Error("ui/state-panel 未初始化：请先调用 setStateGetter()");
};

/** 由 chat.ts 注入情感状态读取器 */
export function setStateGetter(fn: () => AIState): void {
    getState = fn;
}

/** 与 HTML 中 `.group-title[data-group]` 一致的分组顺序 */
const GROUPS = ["personality", "relation", "emotion", "status", "shadow"] as const;

/** 构建 38 维状态条（每个维度一个 `.meter`，含 `val-<key>` 与 `bar-<key>`） */
export function buildMeters(): void {
    for (const group of GROUPS) {
        const box = ui.el(`group-${group}`);
        box.innerHTML = "";

        for (const dim of DIMENSIONS.filter((d) => d.group === group)) {
            const div = document.createElement("div");
            div.className = "meter";
            div.id = `meter-${dim.key}`;
            div.innerHTML = `
                <div class="label"><span class="name">${dim.label}</span><span class="val" id="val-${dim.key}">0</span></div>
                <div class="bar"><div class="fill" id="bar-${dim.key}" style="width:0%;background:var(--ink)"></div></div>`;
            box.appendChild(div);
        }
    }

    // 分组标题可折叠（点击切换该组显示）
    for (const title of ui.qsa(".group-title")) {
        title.style.cursor = "pointer";
        title.addEventListener("click", () => {
            const group = title.dataset.group!;
            const box = ui.el(`group-${group}`);
            box.style.display = box.style.display === "none" ? "" : "none";
            title.textContent =
                box.style.display === "none"
                    ? title.textContent.replace(/^▸ /, "▾ ")
                    : title.textContent.replace(/^▾ /, "▸ ");
        });
    }
}

/** 刷新 38 维数值 + 心情摘要 + 曲线 */
export function updateStateUI(): void {
    const state = getState();
    for (const dim of DIMENSIONS) {
        const v = state[dim.key];
        ui.el(`val-${dim.key}`).textContent = v.toFixed(0);
        ui.el(`bar-${dim.key}`).style.width = `${v}%`;
    }
    ui.el("mood-text").textContent = describeMood();
    drawChart();
}

// 情绪历史曲线（最近 40 个采样点）
const chartHistory: { affection: number; joy: number; anger: number }[] = [];

/** 清空曲线历史（"重置故事"时调用；原来直接写 `chartHistory.length = 0`） */
export function resetChartHistory(): void {
    chartHistory.length = 0;
}

/**
 * 绘制情绪曲线。导出是必要的：打开「全部情感」浮层时会**单独**重绘一次曲线
 * （原 `chat.ts` 里就是直接调 `drawChart()`），语义上必须保持"仅重绘曲线"，
 * 换成 `updateStateUI()` 会多推一个采样点并重算全部 38 个状态条。
 */
export function drawChart(): void {
    const state = getState();
    chartHistory.push({ affection: state.affection, joy: state.joy, anger: state.anger });
    if (chartHistory.length > 40) chartHistory.shift();

    const canvas = ui.el<HTMLCanvasElement>("emotion-chart");
    const ctx = canvas.getContext("2d")!;
    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    ctx.strokeStyle = "rgba(0,0,0,0.08)";
    for (let i = 1; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(0, (H / 4) * i);
        ctx.lineTo(W, (H / 4) * i);
        ctx.stroke();
    }

    const drawLine = (key: "affection" | "joy" | "anger", color: string) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();

        for (let i = 0; i < chartHistory.length; i++) {
            const x = (i / Math.max(1, chartHistory.length - 1)) * W;
            const y = H - (chartHistory[i]![key] / 100) * H;

            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    };

    drawLine("affection", "#111111");
    drawLine("joy", "#555555");
    drawLine("anger", "#8a8a8a");

    ctx.font = "9px sans-serif";
    ctx.fillStyle = "#111111";
    ctx.fillText("—好感", 6, 10);
    ctx.fillStyle = "#555555";
    ctx.fillText("—喜悦", 50, 10);
    ctx.fillStyle = "#8a8a8a";
    ctx.fillText("—愤怒", 92, 10);
}

// ============ 情绪日志 ============

/** 追加一条情绪日志。`maxEntries` 默认 200，超出则从头部裁剪（【P0-4】视图有界）。 */
export function logEmotion(
    who: "user" | "ai",
    text: string,
    extra?: string,
    maxEntries: number = MAX_MOOD_ENTRIES,
): void {
    const box = ui.el("mood-history");
    const div = document.createElement("div");
    div.className = "entry";
    const whoSpan = document.createElement("span");
    whoSpan.className = `who ${who === "ai" ? "ai" : ""}`;
    whoSpan.textContent = who === "ai" ? "AI" : "你";
    const emoSpan = document.createElement("span");
    emoSpan.className = "emo";
    emoSpan.textContent = extra ?? "";
    const textSpan = document.createElement("span");
    textSpan.style.cssText =
        "color:var(--ink-soft);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:110px;";
    textSpan.textContent = text;
    div.append(whoSpan, emoSpan, textSpan);
    box.appendChild(div);
    trimContainer(box, maxEntries); // 【P0-4】视图有界
    box.scrollTop = box.scrollHeight;
}
