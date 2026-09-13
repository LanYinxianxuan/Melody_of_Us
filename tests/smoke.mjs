// smoke.mjs —— 三个真实页面的加载冒烟测试
//
// 为什么必须有这一层：既有 e2e 套件都运行在合成宿主页（tests/storage.html 或 chat.html 夹具）上，
// 它们验证的是**模块逻辑**，而不是**真实页面能否加载**。于是这类缺陷会完全漏网：
//   · 模块级初始化顺序错误（TDZ）：`ReferenceError: Cannot access 'x' before initialization`
//   · 元素 id 拼写错误导致的 null 解引用
//   · 新加的 UI 绑定到不存在的节点
// 本文件用真实浏览器打开三个生产页面，断言「零 Uncaught 错误」并且页面确实渲染出了内容。
//
// 教训来源：P0-13/步骤 7 把 `loadSlotSettings(activeSlot)` 放在 tts* 模块级 const 之前，
// menu.html 直接白屏；而当时 422 条 e2e 断言全部通过。

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const PORT = Number(process.env.SMOKE_PORT ?? 4321);
const ORIGIN = `http://127.0.0.1:${PORT}`;

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".ts": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json",
};

const log = (m) => process.stdout.write(`${m}\n`);

function whichInPath(name) {
    for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
        const full = join(dir, name);
        if (existsSync(full)) return full;
    }
    return null;
}

const CHROME_CANDIDATES = [
    process.env.CHROME_BIN,
    "chromium",
    "chromium-browser",
    "google-chrome",
    "/usr/local/bin/chromium",
    "/usr/bin/chromium",
].filter(Boolean);

function findChrome() {
    for (const c of CHROME_CANDIDATES) {
        if (c.includes("/")) {
            if (existsSync(c)) return c;
        } else {
            const found = whichInPath(c);
            if (found) return found;
        }
    }
    return null;
}

function runChrome(bin, url) {
    const args = [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-software-rasterizer",
        "--use-gl=swiftshader",
        "--no-first-run",
        "--no-default-browser-check",
        "--virtual-time-budget=8000",
        "--enable-logging=stderr",
        "--v=0",
        "--dump-dom",
        url,
    ];
    return new Promise((res, rej) => {
        const c = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
        let out = "";
        let err = "";
        c.stdout.on("data", (d) => (out += d));
        c.stderr.on("data", (d) => (err += d));
        c.on("error", rej);
        c.on("close", () => res({ out, err }));
    });
}

/** 从 stderr 里提取页面 JS 未捕获错误（排除 Chromium 自身噪声） */
function extractUncaught(stderr) {
    const noise = /dbus|udev|pcilib|gpu|GPU|Vulkan|egl|Fontconfig|MESA|UPower|inotify|DevTools/i;
    return stderr
        .split("\n")
        .filter((l) => /Uncaught|SyntaxError|ReferenceError|TypeError/i.test(l) && !noise.test(l))
        .map((l) => l.replace(/^\[[^\]]*\]\s*/, "").trim());
}

async function serve() {
    const server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url, ORIGIN);
            const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
            const file = join(ROOT, rel);
            if (!file.startsWith(ROOT)) {
                res.writeHead(403).end("forbidden");
                return;
            }
            const body = await readFile(file).catch(() => null);
            if (body === null) {
                res.writeHead(404).end("not found");
                return;
            }
            res.writeHead(200, {
                "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
                "Cache-Control": "no-store",
            });
            res.end(body);
        } catch (e) {
            res.writeHead(500).end(String(e));
        }
    });
    return new Promise((r) => server.listen(PORT, "127.0.0.1", () => r(server)));
}

let passed = 0;
let failed = 0;

/**
 * 每个页面：入口 HTML + 必须出现的标记（证明页面确实渲染了，而不是白屏）。
 * 标记用页面里稳定存在的元素 id。
 */
const PAGES = [
    // home 是营销落地页，用 class 而非 id 标记结构
    { name: "home", file: "playground/home.html", classes: ["site-header", "hero", "site-footer"] },
    { name: "menu", file: "playground/menu.html", markers: ["save-list", "export-save", "import-save", "io-status", "tts-toggle-status"], entry: "menu.ts" },
    { name: "chat", file: "playground/chat.html", markers: ["chat-header", "chat-messages", "chat-input", "state-panel"], entry: "chat.ts" },
];

async function main() {
    const chrome = findChrome();
    if (!chrome) {
        log("⚠️  未找到 Chromium，跳过页面冒烟测试（可用 CHROME_BIN 指定）");
        process.exit(0);
    }
    log(`使用浏览器: ${chrome}`);

    const server = await serve();
    const vited = await ensureVite();
    void tmpdir;

    try {
        for (const page of PAGES) {
            log(`\n===== ${page.name} =====`);
            const url = vited ? `${vited}/playground/${page.name}.html` : `${ORIGIN}/${page.file}`;
            const { out, err } = await runChrome(chrome, url);

            const uncaught = extractUncaught(err);
            if (uncaught.length === 0) {
                passed++;
                log("  ✅ 无 JS 未捕获错误");
            } else {
                failed++;
                log(`  ❌ 存在 ${uncaught.length} 个未捕获错误：`);
                for (const u of uncaught.slice(0, 5)) log(`     ${u}`);
            }

            // 用 id 或 class 任一标记判断页面结构是否渲染出来
            const markers = page.markers ?? page.classes ?? [];
            const isClass = !page.markers && !!page.classes;
            const missing = markers.filter((m) => !out.includes(isClass ? `class="${m}` : `id="${m}"`));
            if (missing.length === 0) {
                passed++;
                log(`  ✅ 页面渲染完整（${markers.length} 个关键结构就位）`);
            } else {
                failed++;
                log(`  ❌ 缺少关键结构: ${missing.join(", ")}`);
            }

            if (out.length < 3000) {
                failed++;
                log(`  ❌ 页面内容过短（${out.length} 字节），疑似白屏`);
            } else {
                passed++;
                log(`  ✅ 页面内容非空（${out.length} 字节）`);
            }
        }
    } finally {
        await new Promise((r) => server.close(r));
        if (viteProc) viteProc.kill();
    }

    log(`\n========== 页面冒烟: ${passed} 通过 / ${failed} 失败 ==========`);
    process.exit(failed === 0 ? 0 : 1);
}

/**
 * 三个页面都是 .ts 入口，需要 Vite 做 TS→JS 转换。
 * 优先复用已运行的 dev server；否则自己起一个，并在结束时关闭。
 */
let viteProc = null;
async function ensureVite() {
    const existing = await fetch(`http://127.0.0.1:5199/playground/home.html`)
        .then((r) => r.ok)
        .catch(() => false);
    if (existing) {
        log("复用已运行的 dev server: http://127.0.0.1:5199");
        return "http://127.0.0.1:5199";
    }
    log("启动临时 dev server（端口 5199）…");
    viteProc = spawn("npx", ["vite", "--port", "5199", "--host", "127.0.0.1"], {
        cwd: ROOT,
        stdio: "ignore",
        detached: false,
    });
    for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 500));
        const ok = await fetch(`http://127.0.0.1:5199/playground/home.html`)
            .then((r) => r.ok)
            .catch(() => false);
        if (ok) return "http://127.0.0.1:5199";
    }
    log("⚠️  dev server 启动超时，回退到静态服务（.ts 入口将无法转换）");
    return null;
}

main().catch((e) => {
    log(`冒烟测试异常: ${e?.stack ?? e}`);
    if (viteProc) viteProc.kill();
    process.exit(1);
});
