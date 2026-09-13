// ui/modals.ts —— 聊天页的弹层与面板渲染（阶段 3.4b）
//
// 覆盖三块（原先散在 chat.ts 的三处）：
//   ① 聊天记录面板：renderHistoryToChat / openHistory
//   ② 角色设定弹层：charFields / fillCharForm / readCharForm / matchCurrentPreset
//
// **只管渲染与表单读写**：不 fetch、不碰 localStorage、不做规则判断。
// `saveCharacter()` 这类落盘动作留给调用方（chat.ts），本模块只负责"把表单写进角色对象"。
//
// 依赖方向（无环）：
//   ui/modals.ts → ui/dom.ts（DOM 收口）
//                → character.ts（PRESETS 常量 + CharacterProfile 类型，纯数据）
//   chat.ts      → ui/modals.ts（并通过 setCharacterRef 注入角色对象的读写）

import * as ui from "./dom";
import { PRESETS, type CharacterProfile } from "../character";

/**
 * 「她主动开口」时喂给 AI 的 user 侧占位符。
 *
 * 为什么放在这里而不是 chat.ts：它同时被**渲染过滤**（历史面板与聊天区重新载入历史时
 * 必须把这条伪用户消息藏起来）和**业务流程**（sendMessage 写入历史）使用。
 * 渲染过滤是本模块的职责，因此常量归这里；chat.ts 反过来 import 它 —— 方向单一，不会各写一份。
 */
export const PROACTIVE_PLACEHOLDER = "（她主动找你说话）";

// ============ 角色对象读写注入 ============
//
// `CHARACTER_REF` 是 chat.ts 里的一个可变引用（向导/预设切换会整体改写它的字段）。
// 这里注入 getter/setter 而不是 import：避免 ui/ 反向依赖 chat.ts 形成循环，
// 同时保证每次读写拿到的都是**当前**那个对象（而不是 import 时的快照）。
let getCharacter: () => CharacterProfile = () => {
    throw new Error("ui/modals 未初始化：请先调用 setCharacterRef()");
};
let assignCharacter: (patch: Partial<CharacterProfile>) => void = () => {
    throw new Error("ui/modals 未初始化：请先调用 setCharacterRef()");
};

/**
 * 由 chat.ts 注入角色对象的读取与写入。
 * @param get 读取当前角色对象
 * @param assign 就地写入字段（对应 chat.ts 的 `Object.assign(CHARACTER_REF, patch)`）
 */
export function setCharacterRef(
    get: () => CharacterProfile,
    assign: (patch: Partial<CharacterProfile>) => void,
): void {
    getCharacter = get;
    assignCharacter = assign;
}

// ============ 角色设定弹层 ============

const charFields: { id: string; key: keyof CharacterProfile }[] = [
    { id: "char-name", key: "name" },
    { id: "char-age", key: "age" },
    { id: "char-appearance", key: "appearance" },
    { id: "char-personality", key: "personality" },
    { id: "char-background", key: "background" },
    { id: "char-speech", key: "speechStyle" },
    { id: "char-likes", key: "likes" },
    { id: "char-dislikes", key: "dislikes" },
    { id: "char-relation", key: "relation" },
    { id: "char-secrets", key: "secrets" },
];

/** 把当前角色对象写进表单 */
export function fillCharForm(): void {
    const character = getCharacter();
    for (const f of charFields) {
        ui.el<HTMLInputElement | HTMLTextAreaElement>(f.id).value = character[f.key];
    }
}

/**
 * 把表单内容写回角色对象（**只写对象，不落盘**）。
 * 落盘由调用方显式调用 `saveCharacter()` —— 保持"UI 不负责持久化"的边界。
 */
export function readCharForm(): void {
    const patch: Partial<CharacterProfile> = {};
    for (const f of charFields) {
        patch[f.key] = ui.el<HTMLInputElement | HTMLTextAreaElement>(f.id).value.trim();
    }
    assignCharacter(patch);
}

/** 当前角色属于哪个预设（匹配 name + 关键背景）；不匹配 → 自定义 */
export function matchCurrentPreset(): string {
    const character = getCharacter();
    const name = (character.name ?? "").trim();
    const bg = (character.background ?? "").trim().slice(0, 20);
    for (const [key, p] of Object.entries(PRESETS)) {
        if ((p.name ?? "").trim() === name && (p.background ?? "").trim().slice(0, 20) === bg) {
            return key;
        }
    }
    return ""; // 自定义/已修改
}

/** 打开 / 关闭角色设定弹层 */
export function showCharModal(): void {
    ui.el("char-modal").classList.remove("hidden");
}

export function hideCharModal(): void {
    ui.el("char-modal").classList.add("hidden");
}

// ============ 聊天记录面板 ============

/**
 * 把最近的历史回填到聊天区（启动时调用一次，接在当前对话上方）。
 *
 * 注意：这里直接用 `container.scrollTop = container.scrollHeight` 而不是
 * `scrollMessagesToBottom()` —— 它是**启动期一次性**的回填，不在动画路径上，
 * 不属于 P0-5 要修的"每 55ms 重启平滑滚动"问题。
 */
export function renderHistoryToChat(
    history: { role: string; content: string }[],
    avatar: () => string,
): void {
    // 过滤掉"她主动开口"的 user 侧占位符，避免刷新后把它渲染成伪用户消息
    const visibleHistory = history.filter(
        (e) => !(e.role === "user" && e.content === PROACTIVE_PLACEHOLDER),
    );
    if (!visibleHistory.length) return;

    const container = ui.el("chat-messages");
    const divider = document.createElement("div");
    divider.className = "history-divider";
    divider.textContent = `—— 上次的聊天记录（共 ${visibleHistory.length} 条）——`;
    container.appendChild(divider);

    for (const entry of visibleHistory.slice(-20)) {
        const div = document.createElement("div");
        div.className = `msg ${entry.role === "user" ? "user" : "ai"}`;
        if (entry.role === "assistant") {
            const av = document.createElement("div");
            av.className = "msg-avatar";
            av.textContent = avatar();
            div.appendChild(av);
        }
        const content = document.createElement("div");
        content.className = "dialogue";
        content.textContent = entry.content;
        div.appendChild(content);
        container.appendChild(div);
    }

    container.scrollTop = container.scrollHeight;
}

/**
 * 打开「聊天记录」浮层：按虚拟日分组渲染全部历史。
 * @param history 聊天历史（调用方传 `store.chatHistory`）
 * @param dayBaseMs 第一天零点（用于把 ts 换算成"第 N 天"）
 * @param charName 角色名（渲染说话人）
 */
export function openHistory(
    history: { role: string; content: string; ts?: number }[],
    dayBaseMs: number,
    charName: string,
): void {
    const modal = ui.el("history-modal");
    const list = ui.el("history-list");
    list.innerHTML = "";

    // 和聊天区一样，不显示"她主动开口"的 user 侧占位符
    const visibleHistory = history.filter(
        (e) => !(e.role === "user" && e.content === PROACTIVE_PLACEHOLDER),
    );

    if (!visibleHistory.length) {
        list.innerHTML =
            '<div style="color:var(--ink-faint);font-size:12px;text-align:center;padding:20px;">还没有聊天记录。</div>';
    } else {
        const groups = new Map<string, typeof visibleHistory>();

        for (const e of visibleHistory) {
            const key = e.ts ? `第 ${Math.floor((e.ts - dayBaseMs) / 86400000) + 1} 天` : "过去";
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key)!.push(e);
        }

        for (const [day, entries] of groups) {
            const dayTitle = document.createElement("div");
            dayTitle.className = "history-day";
            dayTitle.textContent = `📅 ${day}`;
            list.appendChild(dayTitle);

            for (const e of entries) {
                const div = document.createElement("div");
                div.className = `history-msg ${e.role}`;
                const time = e.ts ? new Date(e.ts) : null;
                const timeStr = time
                    ? `${String(time.getHours()).padStart(2, "0")}:${String(time.getMinutes()).padStart(2, "0")}`
                    : "";
                // 用 textContent 渲染内容，防止聊天内容中的 HTML 被注入执行（XSS）
                const roleSpan = document.createElement("span");
                roleSpan.className = "h-role";
                roleSpan.textContent = e.role === "user" ? "你" : charName;
                const timeSpan = document.createElement("span");
                timeSpan.className = "h-time";
                timeSpan.textContent = timeStr;
                const contentDiv = document.createElement("div");
                contentDiv.className = "h-content";
                contentDiv.textContent = e.content;
                div.append(roleSpan, timeSpan, contentDiv);
                list.appendChild(div);
            }
        }
    }

    modal.classList.remove("hidden");
}

/** 关闭聊天记录浮层 */
export function hideHistoryModal(): void {
    ui.el("history-modal").classList.add("hidden");
}

/** 清空后把列表替换成提示文案（清空动作本身由调用方负责） */
export function showHistoryCleared(): void {
    ui.el("history-list").innerHTML =
        '<div style="color:var(--ink-faint);font-size:12px;text-align:center;padding:20px;">已清空。</div>';
}
