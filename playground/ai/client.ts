// ai/client.ts —— 网络出口收口（阶段 3，对应 GAMEPLAY_REVIEW A-1）
//
// 缺陷原貌：除 ai.ts 外，director.ts / tts.ts / menu.ts 各自直接 `fetch`，
// 于是"超时、重试、错误分类、用量统计"没有任何一处可以统一实现的地方，
// 测试里"零网络出口"这类断言也只能覆盖 ai.ts 走的那条路径。
//
// 收敛原则（**关键**）：本模块只统一「传输层」——URL 拼接、请求体序列化、响应解析。
// **不统一错误语义**。四个调用点的失败行为本来就不同，把它们"顺手统一"会改变
// 用户可感知的失败表现（错误文案、是否抛异常、是否回退），属于行为变更：
//
//   · ai.ts       → 解析 choices[0].message.content
//   · director.ts → 不检查 resp.ok，只在 data.error 时抛（保持原样！）
//   · tts.ts      → 检查 resp.ok，抛 `TTS 请求失败: HTTP <status>`，且需要读流
//   · menu.ts     → 检查 resp.ok，抛 `HTTP <status>`，再取 data.data[].id
//
// 因此这里提供的是**薄传输层**，每个调用点保留自己的错误判定。

/**
 * 拼接 `baseUrl` 与路径，并对斜杠做归一（`https://x/v1` + `/chat/completions`）。
 * 原代码各写各的模板字符串，`baseUrl` 末尾是否带 `/` 决定了会不会出现 `//`。
 */
export function joinUrl(baseUrl: string, path: string): string {
    return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/** 一次 JSON 请求的传输结果：原始 Response + 解析后的 JSON */
export interface JsonResponse<T = any> {
    resp: Response;
    data: T;
}

/**
 * 发一次 POST JSON 请求并解析响应体。
 *
 * 注意：**不检查 `resp.ok`**。是否把非 2xx 视为失败由调用方决定 ——
 * 这正是四个调用点行为不同的地方，收口时不能替它们做决定。
 *
 * 解析失败时返回 `{}`（与原代码 `resp.json().catch(() => ({}))` 的容错一致），
 * 便于调用方继续读 `data.error?.message`。
 */
export async function postJson<T = any>(
    url: string,
    headers: Record<string, string>,
    body: unknown,
): Promise<JsonResponse<T>> {
    const resp = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
    });
    return { resp, data: await parseJson<T>(resp) };
}

/** 发一次带自定义方法的请求（当前用于 `GET /models`） */
export async function requestJson<T = any>(
    url: string,
    init: RequestInit = {},
): Promise<JsonResponse<T>> {
    const resp = await fetch(url, init);
    return { resp, data: await parseJson<T>(resp) };
}

/**
 * 读取响应体为 JSON。
 *
 * 与原代码的 `.catch(() => ({}))` 语义一致：解析不了就给空对象，
 * 让调用方继续走 `data.error?.message ?? 兜底文案` 的分支，而不是在这里抛错。
 */
export async function parseJson<T = any>(resp: Response): Promise<T> {
    try {
        return (await resp.json()) as T;
    } catch {
        return {} as T;
    }
}

/**
 * 从 OpenAI 兼容响应里提取助手文本。
 *
 * 四个调用点里有三个是同一套形状（`choices[0].message.content`），
 * 但**只有 ai.ts 的解析规则被收敛到这里**：Director 需要自己的 JSON 容错解析，
 * TTS 需要 audio 数据，它们各自保留。
 */
export function extractAssistantText(data: any): string {
    const content = data?.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : "";
}
