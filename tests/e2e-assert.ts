// e2e-assert.ts —— 浏览器端 e2e 断言工具
//
// 断言在浏览器里执行（这样才在真实 localStorage / 真实模块图 / 真实 ESM 语义下运行），
// 结果以 `E2E_CHECK|1|<label>|<detail>` 单行协议输出，由 tests/e2e.mjs 解析汇总。
// 这样测试文件本身不需要关心「怎么退出 / 怎么报告」，只关心「断言什么」。

const out: string[] = [];

/** 记录一条断言结果 */
export function e2eCheck(label: string, ok: boolean, detail: string = ""): void {
    out.push(`E2E_CHECK|${ok ? 1 : 0}|${label}|${detail}`);
}

/** 记录一条普通日志（不参与判定） */
export function e2eLog(message: string): void {
    out.push(message);
}

/**
 * 心跳：把当前进度立刻写进 DOM。
 *
 * 为什么需要：套件卡在某个 await 上时（例如 IndexedDB 在无头环境下的某些操作），
 * e2eRun 永远走不到 flush，页面就"没有结果节点"，排查时毫无线索。
 * 心跳让最后一步进度在 --dump-dom 里可见。
 */
let stepSeq = 0;
export function e2eBeat(label: string): void {
    stepSeq++;
    out.push(`E2E_BEAT|${stepSeq}|${label}`);
    let pre = document.getElementById("e2e-results");
    if (!pre) {
        pre = document.createElement("pre");
        pre.id = "e2e-results";
        document.body.appendChild(pre);
    }
    pre.textContent = out.join("\n");
}

/** 读取 URL 参数 */
export function e2eParams(): URLSearchParams {
    return new URLSearchParams(location.search);
}

/** 把结果写进 DOM（#e2e-results），供 --dump-dom 抓取 */
function flush(): void {
    const pre = document.createElement("pre");
    pre.id = "e2e-results";
    pre.textContent = out.join("\n");
    document.body.appendChild(pre);
    document.title = "E2E_COMPLETE";
}

/**
 * 包裹一个测试主体：捕获异常并输出致命标记，最后必定 flush 结果。
 * 用法：await e2eRun(async () => { ... })
 */
export async function e2eRun(body: () => void | Promise<void>): Promise<void> {
    try {
        await body();
    } catch (e) {
        const err = e as Error;
        out.push(`E2E_FATAL|${err?.message ?? String(e)}`);
        out.push(`E2E_CHECK|0|测试主体未抛异常|${err?.message ?? String(e)}`);
        // 保留栈信息便于排查（dump-dom 会一起带出来）
        out.push(String(err?.stack ?? "").split("\n").slice(0, 6).join("\n"));
    } finally {
        flush();
    }
}
