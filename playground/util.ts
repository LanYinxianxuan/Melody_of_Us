// util.ts —— 通用工具：HTML 转义等

// 转义 HTML 特殊字符，防止 XSS（用于把用户/AI 文本插入 innerHTML 的场景）
export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
