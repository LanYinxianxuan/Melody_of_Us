// e2e.mjs —— 真实浏览器端到端测试（阶段 0 建立，阶段 1 扩展为多套件）
//
// 为什么需要它：tests/agent-smoke.mjs 用 Map 桩替代了 localStorage 与 DOM，
// 因此以下路径从未被验证过：
//   · 状态能否跨越会话持久化（agent-smoke 的 localStorage 是 Map，刷新即丢）
//   · 角色卡路径能否让 AI system prompt 真正看到角色信息（需要真实模块图）
// 本套件用真实 Chromium + 真实 localStorage + 真实 ESM 语义运行测试模块。
//
// 用法：node tests/e2e.mjs [suite ...]     默认跑全部
// 无需任何新增 npm 依赖：内置 Node http 静态服务 + headless Chromium dump-dom。
// 产物全部在内存/临时目录，仓库保持干净。找不到 Chromium 时 SKIP（exit 0）。

import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { build } from "esbuild";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const PORT = Number(process.env.E2E_PORT ?? 4319);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PAGE = "/tests/e2e.html";
const BUNDLE_ROUTE = "/bundle.js";

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".ts": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".json": "application/json; charset=utf-8",
    ".webmanifest": "application/manifest+json",
};

/**
 * 测试套件清单。每个套件是一个浏览器模块，通过 ?phase=N 分阶段运行。
 * 阶段之间共享同一个 user-data-dir ⇒ localStorage 保留（用于跨会话验证）。
 * 断言由模块内 e2eCheck() 输出 `E2E_CHECK|<ok>|<label>|<detail>`，本文件统一解析。
 */
const SUITES = [
    {
        // 【P0-2】TTS 音色 IndexedDB 迁移：fail-safe 路径 + operation-scoped 存档安全联动
        id: "voiceidb",
        title: "TTS 音色 IndexedDB 迁移（fail-safe）",
        entry: "tests/voice-idb.e2e.ts",
        page: "storage.html",
        phases: [
            { phase: 1, query: "slot=1&scenario=data-shape" },
            { phase: 2, query: "slot=1&scenario=migrate-happy" },
            { phase: 3, query: "slot=1&scenario=migrate-failsafe" },
            { phase: 4, query: "slot=1&scenario=save-safety" },
            { phase: 5, query: "slot=1&scenario=legacy-fallback" },
        ],
    },
    {
        // 【P0-13 / G6】TTS 键作用域：显式 slot vs 页面冻结槽位 + 旧全局键迁移
        id: "ttsscope",
        title: "TTS 键作用域与旧开关迁移",
        entry: "tests/tts-scope.e2e.ts",
        page: "storage.html",
        phases: [
            { phase: 1, query: "slot=1&scenario=explicit-slot" },
            { phase: 2, query: "slot=1&scenario=legacy-migration" },
        ],
    },
    {
        // 导出 / 导入（P0-12 步骤 3+4）：四阶段 + 原子提交 + 回滚
        id: "saveio",
        title: "存档导出 / 导入（含 commit 回滚）",
        entry: "tests/save-io.e2e.ts",
        page: "storage.html",
        phases: [
            { phase: 1, query: "slot=1&scenario=export" },
            { phase: 2, query: "slot=1&scenario=import-reject" },
            { phase: 3, query: "slot=1&scenario=commit-rollback" },
            { phase: 4, query: "slot=1&scenario=corrupt-json" },
        ],
    },
    {
        // 存档契约（P0-12）浏览器端回归：每个 phase 用 ?scenario= 指定要植入的存档夹具，
        // 由 storage.html 的经典脚本在模块加载**之前**写入 localStorage。
        id: "saveschema",
        title: "SaveV1 加载契约（旧档/损坏档/未知版本/脏档）",
        entry: "tests/save-v1.e2e.ts",
        page: "storage.html",
        phases: [
            { phase: 1, query: "slot=1&scenario=real-v0" },
            { phase: 2, query: "slot=1&scenario=legacy-v0" },
            { phase: 3, query: "slot=1&scenario=corrupt-json" },
            { phase: 4, query: "slot=1&scenario=future-version" },
            { phase: 5, query: "slot=1&scenario=dirty-fields" },
            { phase: 6, query: "slot=1&scenario=only-aistate" },
            { phase: 7, query: "slot=1&scenario=empty" },
            { phase: 8, query: "slot=1&scenario=missing-aistate" },
        ],
    },
    {
        id: "mind",
        title: "Agent Mind 情绪跨会话持久化",
        entry: "tests/mind-persistence.e2e.ts",
        phases: [1, 2],
    },
    {
        id: "character",
        title: "自定义角色 → AI system prompt（P0-1 回归）",
        entry: "tests/character-prompt.e2e.ts",
        phases: [1],
    },
    {
        id: "effort",
        title: "思考等级设置真正生效（P0-7 回归）",
        entry: "tests/settings-effort.e2e.ts",
        phases: [1],
    },
    {
        id: "proactive",
        title: "主动开口的聊天能力门控（P0-8 回归）",
        entry: "tests/proactive-gate.e2e.ts",
        phases: [1],
    },
    {
        id: "daychange",
        title: "跨天回调的 oldDay/newDay 正确性（P0-10 回归）",
        entry: "tests/day-change.e2e.ts",
        phases: [1],
    },
    {
        id: "viewcaps",
        title: "视图层 DOM/检查点必须是有界的（P0-4 回归）",
        entry: "tests/view-caps.e2e.ts",
        phases: [1],
    },
    {
        id: "typewriter",
        title: "打字机帧驱动 + 自动滚动不与 smooth 打架（P0-5 回归）",
        entry: "tests/typewriter.e2e.ts",
        phases: [1],
    },
    {
        id: "savefail",
        title: "存档失败必须被检测并上报（P0-3 回归）",
        entry: "tests/save-failure.e2e.ts",
        phases: [1],
    },
    {
        // 【阶段 3 安全网】渲染边界三断言：DOM 形状契约 / 演示模式零网络 / 门控活读 busy。
        // 用默认夹具（真实 playground/chat.html）—— 本项目所有 DOM 查询都是
        // getElementById("...")! 的硬引用，只有真实页面才不会漏节点。`apikey-1` 由测试模块
        // 在顶层写入（模块顶层语句晚于所有 import，但早于任何断言）。
        id: "renderboundary",
        title: "渲染边界契约（阶段 3 拆分安全网）",
        entry: "tests/render-boundary.e2e.ts",
        // prelude 是最后一块拼图：套件模块自己的顶层语句晚于 import chat.ts，
        // 无法决定"是否演示模式"；用一个经典脚本在 bundle 之前写 apikey 才能确定性控制。
        prelude: `
  (function () {
    var q = new URLSearchParams(location.search);
    var slot = q.get("slot") || "1";
    // 每个 phase 都是独立的浏览器进程，但共用同一 user-data-dir ⇒ localStorage 会在
    // phase 之间残留。存档夹具必须整体清掉，否则 phase 2 会看到 phase 1 写下的
    // 存档与聊天记录，断言前提就不成立了。
    ["melai-state-", "melai-character-", "apikey-", "provider-", "model-",
     "custom-url-", "models-cache-", "melai-tts-enabled-", "melai-tts-voice-",
     "melai-tts-apikey-", "melai-tts-style-", "melai-tts-lang-"].forEach(function (p) {
      localStorage.removeItem(p + slot);
    });
    if (q.get("demo") === "0") {
      localStorage.setItem("apikey-" + slot, "e2e-dummy-key");
    }
  })();
`,
        phases: [
            { phase: 1, query: "slot=1&demo=1" }, // 演示模式：DOM 形状契约 + 零网络出口
            { phase: 2, query: "slot=1&demo=0" }, // 非演示模式：门控活读 busy
            { phase: 3, query: "slot=1&demo=1" }, // 弹层装配契约（历史 / 角色设定）
            { phase: 4, query: "slot=1&demo=1" }, // 【4-A2】回合计数与冷落门
            { phase: 5, query: "slot=1&demo=1" }, // 【4-A3/4-A4/4-A7】闸门与事实过滤
            { phase: 6, query: "slot=1&demo=1" }, // 【D4】重答不重复累加 storyProgress
            { phase: 7, query: "slot=1&demo=1" }, // 【4-B1/4-B6】Director 不能绕过 Core
            { phase: 8, query: "slot=1&demo=1" }, // 【决策 2】NPC 主动开口的门
            { phase: 9, query: "slot=1&demo=1" }, // 【Phase 4-D C-1】NPC goal 语义
            // 【Phase 5-A】World Surface（含 360/390/412/768/1024 的 iframe 视口检查）
            { phase: 10, query: "slot=1&demo=1" },
            { phase: 11, query: "slot=1&demo=1" }, // 【Phase 5-A4/A5】Story Log 来源与空状态
        ],
    },
    {
        // 该缺陷依赖「多次页面载入」才能复现（标记是 localStorage 持久状态），
        // 因此本套件用多个 phase + 每个 phase 自己的查询串来真实复现用户进入流程。
        id: "newsave",
        title: "?new=1 真正清空旧档且不再残留标记（P0-11 回归）",
        entry: "tests/new-save.e2e.ts",
        phases: [
            { phase: 1, query: "slot=9" }, // 写入旧档（模拟该槽位已有玩家数据）
            { phase: 2, query: "new=1&slot=9" }, // 第一次点「新建」
            { phase: 3, query: "slot=9" }, // 玩家又攒了数据
            { phase: 4, query: "new=1&slot=9" }, // 再次点「新建」——缺陷在此显形
            { phase: 5, query: "slot=9" }, // 刷新（无 new）：不得清空
        ],
    },
];

const log = (msg) => process.stdout.write(`${msg}\n`);

/** 在 PATH 里找一个可执行文件（不经过 shell，避免注入与 DEP0190） */
function whichInPath(name) {
    const dirs = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
    for (const dir of dirs) {
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
    "google-chrome-stable",
    "/usr/local/bin/chromium",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

function findChrome() {
    for (const candidate of CHROME_CANDIDATES) {
        if (candidate.includes("/")) {
            if (existsSync(candidate)) return candidate;
            continue;
        }
        const found = whichInPath(candidate);
        if (found) return found;
    }
    return null;
}

function runChrome(bin, url, userDataDir, windowSize) {
    const args = [
        "--headless=new",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-software-rasterizer",
        "--use-gl=swiftshader",
        "--hide-scrollbars",
        // 【Phase 5-A】响应式检查：phase 可声明 windowSize 以在指定视口宽度下运行
        // 【Phase 5-A】响应式检查需要真实视口宽度。
        // headless=new 下 `--window-size` **不生效**（实测恒为 500px），
        // 必须用 `--window-size` + 等价的默认视口覆盖：`--force-device-scale-factor=1`
        // 配合下面的 `--window-size` 只在有头模式生效，所以这里改用
        // Chromium 支持的 `--window-size` 与 `--window-position` 之外的方式 ——
        // 直接在页面里用 `<meta name=viewport>` 无法改变桌面视口。
        // 结论：改用 **CDP 不可用** 的前提下，唯一可靠做法是给不同宽度各跑一份夹具，
        // 用 CSS 媒体查询驱动布局（见 `tests/narrow-fixture` 说明）。
        `--window-size=${windowSize ?? "1280,900"}`, 
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-extensions",
        // chat.ts 初始化会启动 1s 间隔的时钟与若干 setTimeout；虚拟时间会因此被大量消耗，
        // 8s 预算下 --dump-dom 可能在套件写完结果之前就退出。给足预算。
        // 虚拟时间预算：页面被判定 idle 后 Chrome 会快进定时器。
        // ⚠ 这个值不能随意放大：`--dump-dom` 在**预算耗尽时**输出 DOM，而虚拟时间被快进后
        // 常驻定时器（chat.ts 的时钟 / 轮播 / 随机事件）会持续消耗预算 —— 预算给得越大，
        // 越可能"dump 已经发生、套件却还在跑"，表现就是结果节点只剩最后一条 E2E_BEAT，
        // 而 e2e.mjs 会把这误报成"未产出结果节点 / 页面脚本可能抛错"，极难定位。
        // 需要更长等待的套件应当自己用**次数**做上限（见 render-boundary.e2e.ts 的 waitFor）。
        "--virtual-time-budget=60000",
        `--user-data-dir=${userDataDir}`,
        "--enable-logging=stderr",
        "--v=0",
        "--dump-dom",
        url,
    ];
    return new Promise((resolvePromise, reject) => {
        const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
        let out = "";
        let err = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (err += d));
        child.on("error", reject);
        child.on("close", (code) => resolvePromise({ code, out, err }));
    });
}

const unescapeHtml = (s) =>
    s.replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&amp;/g, "&");

/** 从 dump-dom 输出里取结果节点 */
function extractResults(dom) {
    const m = dom.match(/<pre id="e2e-results">([\s\S]*?)<\/pre>/);
    return m ? unescapeHtml(m[1]).trim() : null;
}

/**
 * 用真实的 playground/chat.html 作为浏览器测试的 DOM 夹具。
 *
 * 为什么不用手写的最小页面：
 *   测试要运行真实模块（chat.ts / time.ts / story.ts …），它们用 getElementById("...")!
 *   直接访问 chat 页的节点，还会动态生成 id（如 `group-${group}`、`meter-${key}`）。
 *   手写夹具永远追不上这些引用 —— 每次漏一个就在 import 期抛错，而且静态检查也发现不了。
 *   直接用生产页面作为骨架，夹具与生产**零漂移**。
 *
 * 处理内容：
 *   ① 在 <head> 顶部插入 <base>，让页面里的 ./assets/... 引用有确定的解析基准；
 *   ② 移除生产入口 <script type="module" src="./chat.ts">（绝不能让它执行真实聊天逻辑）；
 *   ③ 追加两段测试脚本：早期错误捕获 + 加载期错误兜底上报。
 */
function buildFixtureHtml(chatHtml, prelude = "") {
    let html = chatHtml;
    html = html.replace(
        /<head([^>]*)>/i,
        (m, attrs) => `<head${attrs}>\n<base href="${ORIGIN}/playground/">`,
    );
    // 去掉生产入口脚本（开发态是 ./chat.ts，构建态是 assets/*.js）
    html = html.replace(/<script[^>]*src="\.\/chat\.ts"[^>]*>\s*<\/script>/gi, "");
    const injected = `
<script>
  window.__e2eLoadError = null;
  window.addEventListener("error", function (e) {
    if (window.__e2eLoadError) return;
    window.__e2eLoadError = (e.error && e.error.stack) || String(e.message || "unknown error");
  });
  window.addEventListener("unhandledrejection", function (e) {
    if (window.__e2eLoadError) return;
    var r = e.reason;
    window.__e2eLoadError = (r && r.stack) || String(r || "unhandled rejection");
  });
</script>
${prelude}
<script type="module" src="/bundle.js"></script>
<script>
  (function () {
    function report() {
      if (!window.__e2eLoadError) return;
      if (document.getElementById("e2e-results")) return;
      var pre = document.createElement("pre");
      pre.id = "e2e-results";
      pre.textContent = "E2E_FATAL|模块加载期抛错" + String.fromCharCode(10) + window.__e2eLoadError;
      document.body.appendChild(pre);
    }
    report();
    document.addEventListener("DOMContentLoaded", report);
  })();
</script>
`;
    return html.replace(/<\/body>/i, `${injected}</body>`);
}

async function serve(activeBundle, fixtureHtml, suitePages) {
    let bundle = activeBundle;
    if (process.env.E2E_LOG_REQUESTS) {
        process.stderr.write("[serve] requests will be logged\n");
    }
    // suitePages: Map<页面路径, html 内容>；用于让不同套件运行在不同的宿主页上
    const pages = suitePages ?? new Map();
    const server = createServer(async (req, res) => {
        try {
            const url = new URL(req.url, ORIGIN);
            if (process.env.E2E_LOG_REQUESTS) {
                process.stderr.write(`[serve] ${req.method} ${url.pathname}${url.search}\n`);
            }
            if (pages.has(url.pathname)) {
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
                res.end(pages.get(url.pathname));
                return;
            }
            if (url.pathname === PAGE || url.pathname === "/tests/e2e.html") {
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
                res.end(fixtureHtml);
                return;
            }
            if (url.pathname === BUNDLE_ROUTE) {
                res.writeHead(200, {
                    "Content-Type": "text/javascript; charset=utf-8",
                    "Cache-Control": "no-store",
                });
                res.end(bundle.source);
                return;
            }
            const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
            const file = join(ROOT, rel);
            if (!file.startsWith(ROOT)) {
                res.writeHead(403).end("forbidden");
                return;
            }
            const info = await stat(file).catch(() => null);
            if (!info || !info.isFile()) {
                res.writeHead(404).end("not found");
                return;
            }
            const body = await readFile(file);
            // no-store 很重要：每个 phase 是独立的浏览器进程，但共用同一 user-data-dir，
            // 静态脚本（如 scenarios.js，无缓存破坏参数）若被缓存，夹具就不会重新植入，
            // 导致 phase 之间互相污染、测试假过/假失败。
            res.writeHead(200, {
                "Content-Type": MIME[extname(file)] ?? "application/octet-stream",
                "Cache-Control": "no-store, no-cache, must-revalidate",
            });
            res.end(body);
        } catch (e) {
            res.writeHead(500).end(String(e));
        }
    });
    return {
        server: await new Promise((resolvePromise) => server.listen(PORT, "127.0.0.1", () => resolvePromise(server))),
        setBundle(source) {
            bundle = { source };
        },
    };
}

let passed = 0;
let failed = 0;

function reportCheck(ok, label, detail = "") {
    if (ok) {
        passed++;
        log(`  ✅ ${label}`);
    } else {
        failed++;
        log(`  ❌ ${label}${detail ? `  ← ${detail}` : ""}`);
    }
}

const dump = (text) => text.split("\n").map((l) => `    ${l}`).join("\n");

async function main() {
    const wanted = process.argv.slice(2);
    const suites = wanted.length ? SUITES.filter((s) => wanted.includes(s.id)) : SUITES;
    if (!suites.length) {
        log(`未匹配到套件。可用：${SUITES.map((s) => s.id).join(", ")}`);
        process.exit(1);
    }

    const chrome = findChrome();
    if (!chrome) {
        log("⚠️  未找到 Chromium/Chrome，跳过 e2e（可用 CHROME_BIN=/path/to/chrome 指定）");
        process.exit(0);
    }
    log(`使用浏览器: ${chrome}`);
    log(`套件: ${suites.map((s) => s.id).join(", ")}`);

    const workDir = await mkdtemp(join(tmpdir(), "melody-e2e-"));

    let server;
    let setBundle = () => {};
    try {
        const chatHtmlPath = join(ROOT, "playground", "chat.html");
        const chatHtmlSource = await readFile(chatHtmlPath, "utf8");
        const fixtureHtml = buildFixtureHtml(chatHtmlSource);
        log(`默认 DOM 夹具: playground/chat.html（与生产零漂移）`);

        // 套件自带的宿主页 / prelude：prelude 是**经典脚本**，比 /bundle.js 更早执行，
        // 因此可以在 chat.ts 模块求值前植入 localStorage 夹具（module 的 import 提升
        // 让套件模块自己做不到这件事）。每个 prelude 生成一份独立的宿主页。
        const preludePages = new Map();
        for (const suite of suites) {
            if (!suite.prelude) continue;
            const pagePath = `/prelude-${suite.id}.html`;
            preludePages.set(pagePath, buildFixtureHtml(chatHtmlSource, `<script>\n${suite.prelude}\n</script>`));
            log(`套件 ${suite.id} 使用 prelude 宿主页: ${pagePath}`);
        }

        // 允许套件声明自己的宿主页（例如 storage 套件用极简页避开 chat.ts 的模块级副作用）
        const suitePages = new Map();
        for (const suite of suites) {
            if (!suite.page) continue;
            const pagePath = `/${suite.page}`;
            let pageHtml = await readFile(join(ROOT, "tests", suite.page), "utf8");
            // 页面被服务在根路径 /storage.html，而它内部的相对引用（./scenarios.js）
            // 会解析到 /scenarios.js → 404。注入 <base> 保持相对路径语义与文件同目录一致。
            pageHtml = pageHtml.replace(/<head([^>]*)>/i, `<head$1>\n<base href="/tests/">`);
            suitePages.set(pagePath, pageHtml);
            log(`套件 ${suite.id} 使用宿主页: tests/${suite.page}`);
        }

        for (const [k, v] of preludePages) suitePages.set(k, v);
        const handle = await serve({ source: "" }, fixtureHtml, suitePages);
        server = handle.server;
        setBundle = handle.setBundle;
        log(`静态服务: ${ORIGIN}`);

        for (const suite of suites) {
            log(`\n${"=".repeat(58)}\n套件 ${suite.id}：${suite.title}\n${"=".repeat(58)}`);

            const built = await build({
                entryPoints: [join(ROOT, suite.entry)],
                bundle: true,
                write: false,
                format: "esm",
                platform: "browser",
                target: "es2022",
                logLevel: "warning",
            });
            setBundle(built.outputFiles[0].text);

            // 每个套件独立 profile，避免套件间通过 localStorage 互相污染
            const userDataDir = join(workDir, `profile-${suite.id}`);

            for (const entry of suite.phases) {
                // phases 元素既可以是数字，也可以是 { phase, query }
                const phaseNo = typeof entry === "object" ? entry.phase : entry;
                const extraQuery = typeof entry === "object" && entry.query ? `&${entry.query}` : "";
                log(`\n----- phase ${phaseNo}${extraQuery ? ` (+${extraQuery})` : ""} -----`);
                const pagePath = suite.page ? `/${suite.page}` : suite.prelude ? `/prelude-${suite.id}.html` : PAGE;
                const url = `${ORIGIN}${pagePath}?b=${suite.id}&phase=${phaseNo}${extraQuery}`;
                const run = await runChrome(chrome, url, userDataDir, entry.windowSize);
                const text = extractResults(run.out);
                if (text === null) {
                    log("❌ 未产出结果节点（页面脚本可能抛错）。");
                    // 把完整 DOM 落盘，便于在页面加载期抛错时排查（否则只剩"没有结果"这一条信息）
                    // 固定路径：便于失败后直接查看（workDir 会被清理）
                    const dumpPath = join(tmpdir(), `melody-e2e-failed-${suite.id}-phase${phaseNo}.html`);
                    await writeFile(dumpPath, run.out, "utf8");
                    log(`   完整 DOM 已保存: ${dumpPath}`);
                    // 优先展示页面自己捕获到的加载期错误（最有诊断价值）
                    const captured = run.out.match(/__e2eLoadError\s*[=:]\s*([^<]*)/);
                    const errText = (captured && captured[1] && captured[1] !== "null")
                        ? captured[1]
                        : "（页面未捕获到错误 —— 也可能 --dump-dom 早于结果写入）";
                    log(`   捕获到的加载期错误: ${errText.slice(0, 400)}`);
                    log(`   是否含结果元素: ${run.out.includes('<pre id="e2e-results">')}`);
                    const titleMatch = run.out.match(/<title>([^<]*)<\/title>/);
                    log(`   页面标题（套件可用于同步追踪进度）: ${titleMatch ? titleMatch[1] : "(无)"}`);
                    const pres = run.out.match(/<pre id="e2e-results">[\s\S]*?<\/pre>/g) ?? [];
                    if (pres.length) {
                        log(`   已写入的结果节点 ${pres.length} 个，最后一个的内容:`);
                        log(unescapeHtml(pres[pres.length - 1]).split("\n").map((l) => `     ${l}`).join("\n"));
                    }
                    const consoleLines = run.err
                        .split("\n")
                        .filter((l) => l.includes("CONSOLE") || /Uncaught|TypeError|ReferenceError/.test(l))
                        .slice(0, 15);
                    if (consoleLines.length) {
                        log("   浏览器控制台（前 15 条）:");
                        for (const l of consoleLines) log(`     ${l.replace(/^\[[^\]]*\]\s*/, "")}`);
                    }
                    failed++;
                    continue;
                }
                const lines = text.split("\n");
                let phaseFailed = 0;
                for (const line of lines) {
                    if (line.startsWith("E2E_BEAT|")) {
                        const [, seq, label] = line.split("|");
                        log(`    · 步骤 ${seq}: ${label}`);
                    } else if (line.startsWith("E2E_CHECK|")) {
                        const [, okFlag, label, detail = ""] = line.split("|");
                        if (okFlag !== "1") phaseFailed++;
                        reportCheck(okFlag === "1", label, detail);
                    } else if (line.trim()) {
                        log(`    ${line}`);
                    }
                }
                // 有失败时把 DOM 落盘：夹具/宿主页问题往往只能从 DOM 看出来
                if (phaseFailed > 0) {
                    const dumpPath = join(tmpdir(), `melody-e2e-failed-${suite.id}-phase${phaseNo}.html`);
                    await writeFile(dumpPath, run.out, "utf8");
                    log(`   （本 phase 有失败，完整 DOM 已保存: ${dumpPath}）`);
                    if (process.env.E2E_VERBOSE) {
                        const cl = run.err
                            .split("\n")
                            .filter((l) => l.includes("CONSOLE") || /Uncaught|TypeError|ReferenceError|404/.test(l))
                            .slice(0, 10);
                        for (const l of cl) log(`     [console] ${l.replace(/^\[[^\]]*\]\s*/, "")}`);
                    }
                }
                if (lines.some((l) => l.startsWith("E2E_FATAL|"))) {
                    failed++;
                }
            }
        }
    } finally {
        if (server) await new Promise((r) => server.close(r));
        await rm(workDir, { recursive: true, force: true });
    }

    log(`\n========== e2e 结果: ${passed} 通过 / ${failed} 失败 ==========`);
    process.exit(failed === 0 ? 0 : 1);
}

void dump;
main().catch((e) => {
    log(`e2e 执行异常: ${e?.stack ?? e}`);
    process.exit(1);
});
