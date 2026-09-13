// ui/dom.ts —— 渲染边界的第一步：把 DOM 查询收口成**一个**可验证的入口。
//
// 为什么需要它（阶段 3 的前置，见 PHASE3_RENDER_BOUNDARY.md）：
//   chat.ts 里有约 100 个 DOM 查询点（92 个 getElementById + 8 个 querySelector），
//   散落在业务流程中间。带来三个具体问题：
//     ① 拼错 id 只能等运行时才知道（`getElementById("x")!` 会把 null 静默断言成元素，
//        第一次读属性时才炸，栈已经离现场很远）；
//     ② "这一页需要哪些节点"没有清单，重构时无法证明没漏；
//     ③ 同一次操作里重复查询同一个节点，既啰嗦又容易写成两个不同的来源。
//
// 本模块只做三件事，**不承载任何业务语义**：
//   · el(id)    —— 断言存在（缺失时抛出可诊断的错误，而不是 null 传播）
//   · optEl(id) —— 允许缺失，调用方自己处理
//   · qs/qsa    —— 选择器版本的 el/optEl
//
// 迁移策略（重要）：先**并存**。旧写法不急着改，逐步替换即可随时停下。
// 每一步都要求 `npm run verify` 全绿，其中 `tests/render-boundary.e2e.ts`
// 负责盯住"渲染输出的形状契约"不被这次搬迁改坏。

/** 查询失败时的统一错误类型，便于测试断言"是缺节点而不是别的错误" */
export class MissingNodeError extends Error {
    constructor(readonly nodeId: string) {
        super(
            `渲染边界：页面缺少必需的节点 #${nodeId}。` +
                `这通常意味着 HTML 被改动而 JS 没跟上（或页面装错了）。`,
        );
        this.name = "MissingNodeError";
    }
}

/**
 * 取必需节点；缺失即抛错。
 *
 * 与 `document.getElementById(id)!` 的区别：后者把 null 断言成元素，
 * 错误会推迟到「第一次读写属性」时才出现，栈里看不到真正的原因。
 * 这里在查询点立刻给出节点 id，排错时不需要猜。
 */
export function el<T extends HTMLElement = HTMLElement>(id: string, root: ParentNode = document): T {
    const node = root.querySelector<T>(`#${cssEscape(id)}`);
    if (!node) throw new MissingNodeError(id);
    return node;
}

/** 取可选节点；缺失返回 null，由调用方决定跳过还是报错 */
export function optEl<T extends HTMLElement = HTMLElement>(id: string, root: ParentNode = document): T | null {
    return root.querySelector<T>(`#${cssEscape(id)}`);
}

/** 选择器版本的必需节点（支持复合选择器） */
export function qs<T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T {
    const node = root.querySelector<T>(selector);
    if (!node) throw new MissingNodeError(selector);
    return node;
}

/** 选择器版本的清单（可能为空数组，不会抛错） */
export function qsa<T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T[] {
    return Array.from(root.querySelectorAll<T>(selector));
}

/**
 * id 转义：本项目所有 id 都是 `[a-z0-9-]`，但 `CSS.escape` 在部分老 WebView
 * （Capacitor 打包的 Android 环境）里可能不存在，因此给一个最小回退。
 */
function cssEscape(id: string): string {
    const native = (globalThis as { CSS?: { escape?: (s: string) => string } }).CSS?.escape;
    if (typeof native === "function") return native(id);
    return id.replace(/[^a-zA-Z0-9_-]/g, (c) => `\\${c}`);
}
