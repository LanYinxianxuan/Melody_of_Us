// action-suggest.ts —— 预判动作/表情快捷条（独立于随机事件，常驻可用）
// 需求④：AI 每次回复后，预判"用户此刻可能的动作+表情"，以快捷按钮展示，
// 用户点选即填入输入框（可改），也可以自己输入任意组合。
//
// 数据来源（0 额外成本）：
// 1. 主回复同一次模型调用回传的 suggestions 字段（语义预判，最优）；
// 2. 未回传 / 演示模式（无 Key）→ 本地规则池（按 38 维情绪/关系给出贴合的反应）。

import { aiState } from "./state";
import * as ui from "./ui/dom";

export interface ActionSuggestion {
    action: string;      // 用户动作（3~10字）
    expression: string;  // 用户表情/神态（3~10字）
}

// ============ 模型回传的建议（由 chat.ts 在每次主角回复后设置） ============

let lastSuggestions: ActionSuggestion[] | null = null;

export function setReplySuggestions(list: ActionSuggestion[] | null): void {
    lastSuggestions = list && list.length >= 2 ? list.slice(0, 5) : null;
}

export function currentSuggestions(): ActionSuggestion[] {
    if (lastSuggestions) return lastSuggestions;
    return ruleSuggestions();
}

// ============ 本地规则池（0 成本兜底） ============

const POOLS: ((s: Record<string, number>) => ActionSuggestion[] | null)[] = [
    // 低落/孤单 → 安静陪伴
    (s) => ((s["sadness"] ?? 0) > 55 || (s["loneliness"] ?? 0) > 50)
        ? [
            { action: "安静地坐在旁边", expression: "什么也没说" },
            { action: "轻轻握住她的手", expression: "声音放柔" },
            { action: "递过去一杯热饮", expression: "假装没在看" },
          ]
        : null,
    // 生气/吃醋 → 先消化情绪
    (s) => ((s["anger"] ?? 0) > 55 || (s["jealousy"] ?? 0) > 45)
        ? [
            { action: "后退半步", expression: "陪她先消化情绪" },
            { action: "认真看着她", expression: "等她自己开口" },
            { action: "把话题岔开一招", expression: "故意说点轻松的" },
          ]
        : null,
    // 开心 → 一起乐
    (s) => ((s["joy"] ?? 0) > 60)
        ? [
            { action: "拍拍她的肩膀", expression: "咧嘴笑" },
            { action: "学她刚才的样子", expression: "逗她笑" },
            { action: "凑近一点", expression: "眼睛亮晶晶" },
          ]
        : null,
    // 亲密关系 → 自然亲近
    (s) => ((s["affection"] ?? 0) > 60 && (s["familiarity"] ?? 0) > 50)
        ? [
            { action: "帮她拢了拢衣领", expression: "若无其事" },
            { action: "抬手揉一下她头发", expression: "嘴角带笑" },
            { action: "并肩走", expression: "步子放慢等她" },
          ]
        : null,
    // 疲惫/深夜 → 轻一点
    (s) => ((s["fatigue"] ?? 0) > 55 || (s["energy"] ?? 0) < 40)
        ? [
            { action: "压低声音", expression: "不吵她" },
            { action: "帮她拢了拢外套", expression: "轻手轻脚" },
            { action: "把话题放轻", expression: "声音柔和" },
          ]
        : null,
];

const DEFAULT_POOL: ActionSuggestion[] = [
    { action: "歪头看她", expression: "等她说下去" },
    { action: "认真听着", expression: "轻轻点头" },
    { action: "凑近半步", expression: "眼里带着笑" },
    { action: "收拾了一下心情", expression: "缓缓开口" },
];

export function ruleSuggestions(): ActionSuggestion[] {
    for (const fn of POOLS) {
        const hit = fn(aiState);
        if (hit) return hit;
    }
    return DEFAULT_POOL;
}

// ============ UI：输入框上方的快捷动作条 ============

export function renderActionSuggestBar(): void {
    const bar = ui.optEl("action-suggest");
    if (!bar) return;
    bar.innerHTML = "";

    const label = document.createElement("span");
    label.className = "as-label";
    label.textContent = "🎬 预判你的反应";
    bar.appendChild(label);

    for (const it of currentSuggestions()) {
        const btn = document.createElement("button");
        btn.className = "as-chip";
        btn.type = "button";
        btn.textContent = `${it.action}，${it.expression}`;
        btn.title = "点击填入输入框（可修改后发送）";
        btn.addEventListener("click", () => {
            const input = ui.optEl<HTMLInputElement>("chat-input");
            if (!input) return;
            input.value = `${it.action}，${it.expression}`;
            input.focus();
        });
        bar.appendChild(btn);
    }

    const refresh = document.createElement("button");
    refresh.className = "as-refresh";
    refresh.type = "button";
    refresh.title = "换一组";
    refresh.textContent = "🔄";
    refresh.addEventListener("click", () => {
        // 本地池轮换：临时清空模型建议 → 换规则池 → 再随机挑一组
        const rule = ruleSuggestions();
        const shifted = [...rule.slice(1), rule[0]!];
        // 用 setReplySuggestions 临时覆盖，下轮回复后自动恢复
        setReplySuggestions(shifted);
        renderActionSuggestBar();
    });
    bar.appendChild(refresh);
}
