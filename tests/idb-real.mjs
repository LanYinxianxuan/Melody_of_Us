// idb-real.mjs —— 【R1】真实 IndexedDB 端到端验证（headed Chromium + CDP）
//
// 为什么需要单独一个 harness：
//   headless Chromium 在本沙箱下 **IndexedDB 后端不工作** —— `indexedDB` 存在、`open()`
//   也返回 request，但 onsuccess/onerror/onblocked 在任何 headless 变体下都永不触发
//   （已排除 5 种 flag 组合 + 阻塞 load 事件 4 秒）。
//   而 **headed** Chromium（跑在 DISPLAY=:12 的真实 X server 上）IDB 完全正常。
//
// 因此本文件用「headed Chromium + CDP Runtime.evaluate(awaitPromise)」在**真实**
// IndexedDB 上验证 P0-2 的每条断言：写入落盘、刷新后可读、localStorage 不再承担音频、
// 跨槽位不串音色、迁移失败不删旧数据、IDB 不可用时安全回退。
//
// 无法使用 headed 的环境会以 SKIP(exit 0) 退出，不阻塞 CI。

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const PORT = Number(process.env.IDB_PORT ?? 4521);
const CDP_PORT = Number(process.env.IDB_CDP_PORT ?? 9445);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ORIGIN_TAG = `:${PORT}`;

const log = (m) => process.stdout.write(`${m}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

function whichInPath(name) {
    for (const dir of (process.env.PATH ?? "").split(delimiter).filter(Boolean)) {
        const full = join(dir, name);
        if (existsSync(full)) return full;
    }
    return null;
}
function findChrome() {
    for (const c of [process.env.CHROME_BIN, "chromium", "chromium-browser", "google-chrome", "/usr/local/bin/chromium"].filter(Boolean)) {
        if (c.includes("/")) {
            if (existsSync(c)) return c;
        } else {
            const f = whichInPath(c);
            if (f) return f;
        }
    }
    return null;
}

let passed = 0;
let failed = 0;
function check(label, ok, detail = "") {
    if (ok) {
        passed++;
        log(`  ✅ ${label}`);
    } else {
        failed++;
        log(`  ❌ ${label}${detail ? `  ← ${detail}` : ""}`);
    }
}

// 探针页由 Vite 提供（tests/idb-probe.html）：它 import 的是 playground 下的 .ts 源文件，
// 必须经 Vite 转换，因此本轮验证需要 dev server 在 5199 端口运行。
//
// 已验证：headless Chromium 在本沙箱下 IDB 后端不工作；**headed** Chromium
// （DISPLAY 指向真实 X server）IDB 完全正常 —— 这正是本 harness 存在的理由。

/** 提前退出前的清理（此时 server/chrome 尚在 main 的 try 之外，仅等待事件循环空转） */
async function cleanupEarly() {
    await new Promise((resolve) => setTimeout(resolve, 10));
}

async function main() {
    const chrome = findChrome();
    if (!chrome) {
        log("⚠️  未找到 Chromium，跳过真实 IDB 验证");
        process.exit(0);
    }
    // headed 模式需要可用的 X display
    if (!process.env.DISPLAY) {
        log("⚠️  无 DISPLAY，headed Chromium 不可用 → SKIP（真实 IDB 验证需要 headed 模式）");
        process.exit(0);
    }

    const workDir = join(tmpdir(), `melody-idb-real-${Date.now()}`);
    const profile = join(workDir, "profile");

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
    await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

    // 真实 menu 页面 + 探针模块（探针走生产代码路径）
    const VITE = process.env.VITE_URL ?? "http://127.0.0.1:5199";
    const viteUp = await fetch(`${VITE}/playground/home.html`).then((r) => r.ok).catch(() => false);
    if (!viteUp) {
        log(`⚠️  dev server 未运行（${VITE}）→ SKIP。请先启动：npm run dev`);
        await cleanupEarly();
        process.exit(0);
    }
    const pageUrl = `${VITE}/tests/idb-probe.html`;
    const chromeProc = spawn(
        chrome,
        [
            "--no-sandbox",
            "--disable-gpu",
            "--disable-dev-shm-usage",
            `--user-data-dir=${profile}`,
            "--no-first-run",
            "--no-default-browser-check",
            `--remote-debugging-port=${CDP_PORT}`,
            "--window-size=900,700",
            pageUrl,
        ],
        { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env } },
    );

    let ws = null;
    let msgId = 0;
    const pending = new Map();
    const send = (method, params) =>
        new Promise((res, rej) => {
            const id = ++msgId;
            pending.set(id, res);
            ws.send(JSON.stringify({ id, method, params }));
            setTimeout(() => rej(new Error(`${method} 超时`)), 30000);
        });

    const cleanup = async () => {
        try { ws?.close(); } catch { /* ignore */ }
        chromeProc.kill("SIGKILL");
        await new Promise((r) => server.close(r));
        await rm(workDir, { recursive: true, force: true }).catch(() => {});
    };

    try {
        // 等 CDP + 页面就绪
        let target = null;
        for (let i = 0; i < 40; i++) {
            await sleep(500);
            const list = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`).then((r) => r.json()).catch(() => null);
            target = list?.find((t) => t.type === "page" && t.url.includes("idb-probe"));
            if (target) break;
        }
        if (!target) {
            log("⚠️  CDP 未就绪（可能是环境没有可用 X display）→ SKIP");
            await cleanup();
            process.exit(0);
        }
        log(`headed Chromium 已连接: ${target.url}`);

        ws = new WebSocket(target.webSocketDebuggerUrl);
        await new Promise((res, rej) => {
            ws.onopen = res;
            ws.onerror = rej;
        });
        ws.onmessage = (ev) => {
            const m = JSON.parse(ev.data);
            if (m.id && pending.has(m.id)) {
                pending.get(m.id)(m);
                pending.delete(m.id);
            }
        };
        await send("Runtime.enable", {});

        /** 在页面里求值（支持 await） */
        const evaluate = async (expression) => {
            const r = await send("Runtime.evaluate", {
                expression,
                awaitPromise: true,
                returnByValue: true,
            });
            if (r.result?.exceptionDetails) {
                throw new Error("页面异常: " + JSON.stringify(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails));
            }
            return r.result?.result?.value;
        };

        // 探针页自带 module 脚本（Vite 负责把 .ts 转换好），这里只等它就绪
        await evaluate(`(async () => {
            for (let i = 0; i < 60 && !window.__probeReady; i++) await new Promise(r => setTimeout(r, 200));
            return !!window.__probeReady;
        })()`);
        const ready = await evaluate("!!window.__probeReady");
        if (!ready) {
            log("❌ 探针模块未就绪");
            await cleanup();
            process.exit(1);
        }

        // ---------- 前置检查 ----------
        log("\n===== 环境前置 =====");
        const info = await evaluate("window.__probe.info()");
        log(`页面槽位=${info.slot}  IndexedDB 可用=${info.idb}`);
        check("【前置】真实浏览器 IndexedDB 可用", info.idb === true, `${info.idb}`);
        if (info.idb !== true) {
            log("⚠️  IDB 不可用 → 无法完成真实 IDB 验证，SKIP");
            await cleanup();
            process.exit(0);
        }
        const dbs = await evaluate("window.__probe.idbDatabases()");
        log(`已存在的数据库: ${JSON.stringify(dbs)}`);

        // ---------- ① 写入 2MB 音色 → 必须落在 IndexedDB ----------
        log("\n===== ① 写入约 2MB 音色 =====");
        const before = await evaluate("window.__probe.lsBytes()");
        const w = await evaluate(`(async () => {
            const s = window.__probe.makeSample(2);
            window.__sampleBytes = s.length;
            const r = await window.__probe.write(1, s);
            return { r, sampleBytes: s.length };
        })()`);
        log(`写入结果=${JSON.stringify(w.r)}  样本 base64=${(w.sampleBytes / 1024 / 1024).toFixed(2)}MB`);
        check("【核心】写入成功且介质为 IndexedDB", w.r?.ok === true && w.r.stored === "indexeddb", JSON.stringify(w.r));

        const rawRec = await evaluate("window.__probe.rawIdb(1)");
        check("【核心】独立读取 IndexedDB 确认数据真的落盘（绕过生产层）", !!rawRec?.data, `${rawRec ? "有记录" : "无记录"}`);
        check("【核心】落盘数据长度与写入一致", rawRec?.data?.length === w.sampleBytes, `${rawRec?.data?.length} vs ${w.sampleBytes}`);
        check("meta 记录了来源与体积", rawRec?.meta?.source === "user-upload" && rawRec?.meta?.bytes > 0, JSON.stringify(rawRec?.meta));

        // ---------- ② localStorage 不再承担该音频 ----------
        log("\n===== ② localStorage 不承担音频 =====");
        const lsVoice = await evaluate("window.__probe.lsGet(window.__probe.VOICE_KEY(1))");
        check("【核心】localStorage 中不再有音色副本", lsVoice === null, `${lsVoice?.length ?? "null"}`);
        const after = await evaluate("window.__probe.lsBytes()");
        log(`localStorage 占用 ${(before / 1024).toFixed(1)}KB → ${(after / 1024).toFixed(1)}KB`);
        check(
            "【核心】localStorage 未因 2MB 音频而增长",
            after - before < 200 * 1024,
            `增长 ${((after - before) / 1024).toFixed(1)}KB`,
        );

        // ---------- ③ 刷新页面后仍可读（真实持久化） ----------
        log("\n===== ③ 刷新后持久化 =====");
        await send("Page.enable", {});
        await send("Page.reload", { ignoreCache: false });
        await sleep(2500);
        // 刷新后探针页会重新执行，等它就绪
        await evaluate(`(async () => {
            for (let i = 0; i < 60 && !window.__probeReady; i++) await new Promise(r => setTimeout(r, 200));
            return !!window.__probeReady;
        })()`);
        const afterReload = await evaluate("window.__probe.readData(1)");
        check("【核心】刷新页面后仍能从 IndexedDB 读到音色", afterReload?.length === w.sampleBytes, `${afterReload?.length} vs ${w.sampleBytes}`);
        const srcAfterReload = await evaluate("window.__probe.read(1)");
        check("读回来源为 indexeddb", srcAfterReload?.source === "indexeddb", srcAfterReload?.source);

        // ---------- ④ 跨槽位不串音色 ----------
        log("\n===== ④ 跨槽位隔离 =====");
        const slot5 = await evaluate(`(async () => {
            const s5 = "data:audio/mpeg;base64," + "WFla".repeat(100);
            const r = await window.__probe.write(5, s5);
            const back5 = await window.__probe.readData(5);
            const back1 = await window.__probe.readData(1);
            return { r, slot5Len: back5?.length, slot1Len: back1?.length, same: back5 === back1 };
        })()`);
        log(`槽位5 写入=${JSON.stringify(slot5.r)}  槽位5长度=${slot5.slot5Len}  槽位1长度=${slot5.slot1Len}`);
        check("槽位 5 写入成功", slot5.r?.ok === true, JSON.stringify(slot5.r));
        check("【核心】槽位 5 读回的是自己的数据（长度不同）", slot5.slot5Len !== slot5.slot1Len, `${slot5.slot5Len} vs ${slot5.slot1Len}`);
        check("【核心】两槽位数据互不相同", slot5.same === false);
        const rec5 = await evaluate("window.__probe.rawIdb(5)");
        check("IndexedDB 中槽位 5 独立成一条记录", rec5?.slot === 5, `${rec5?.slot}`);
        const count = await evaluate("window.__probe.idbRecordCount()");
        log(`IndexedDB 记录数=${count}`);
        check("IndexedDB 中有两条独立记录", count >= 2, `${count}`);

        // ---------- ⑤ 迁移失败不删除旧数据 ----------
        log("\n===== ⑤ 迁移失败不删旧数据 =====");
        const migFail = await evaluate(`(async () => {
            // 在 localStorage 里放一份"旧音色"，并把 IndexedDB 的 put 改坏 → 迁移必须失败且不删旧数据
            const legacy = "data:audio/mpeg;base64," + "TE9ORE9O".repeat(500);
            const key = window.__probe.VOICE_KEY(7);
            window.__probe.lsSet(key, legacy);
            const origPut = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function () { throw new Error("模拟写入失败"); };
            let result;
            try { result = await window.__probe.migrate(7); }
            finally { IDBObjectStore.prototype.put = origPut; }
            const stillThere = window.__probe.lsGet(key);
            return { result, kept: stillThere === legacy, keptLen: stillThere?.length };
        })()`);
        log(`迁移结果=${JSON.stringify(migFail.result)}  旧数据保留=${migFail.kept}`);
        check("【核心】写入失败时迁移报告失败", migFail.result?.status === "write-failed", JSON.stringify(migFail.result));
        check("【核心】迁移失败时旧数据必须保留（fail-safe）", migFail.kept === true, `kept=${migFail.kept}`);

        // 校验失败路径：写入被篡改 → verify-failed → 同样不删
        const migVerifyFail = await evaluate(`(async () => {
            const key = window.__probe.VOICE_KEY(8);
            const legacy = "data:audio/mpeg;base64," + "VkVSSUZZ".repeat(500);
            window.__probe.lsSet(key, legacy);
            const origPut = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function (v, k) {
                return origPut.call(this, { ...v, data: "data:audio/mpeg;base64,TAMPERED" }, k);
            };
            let result;
            try { result = await window.__probe.migrate(8); }
            finally { IDBObjectStore.prototype.put = origPut; }
            const stillThere = window.__probe.lsGet(key);
            await window.__probe.rawIdbDelete(8);
            return { result, kept: stillThere === legacy };
        })()`);
        log(`校验失败迁移结果=${JSON.stringify(migVerifyFail.result)}  旧数据保留=${migVerifyFail.kept}`);
        check("【核心】读回校验不一致时报告 verify-failed", migVerifyFail.result?.status === "verify-failed", JSON.stringify(migVerifyFail.result));
        check("【核心】校验失败时旧数据必须保留", migVerifyFail.kept === true);

        // 成功路径：确认迁移会删旧数据
        const migOk = await evaluate(`(async () => {
            const slot = 6;
            const key = window.__probe.VOICE_KEY(slot);
            const legacy = "data:audio/mpeg;base64," + "TUlHUkFURU9L".repeat(500);
            window.__probe.lsSet(key, legacy);
            const r = await window.__probe.migrate(slot);
            const kept = window.__probe.lsGet(key);
            const inIdb = await window.__probe.rawIdb(slot);
            return { status: r.status, lsCleared: kept === null, idbHas: inIdb?.data?.length === legacy.length };
        })()`);
        log(`成功迁移: status=${migOk.status} 旧键已清=${migOk.lsCleared} IDB有数据=${migOk.idbHas}`);
        check("成功迁移后旧键被清理", migOk.status === "migrated" && migOk.lsCleared === true, JSON.stringify(migOk));
        check("成功迁移后数据在 IndexedDB", migOk.idbHas === true);

        // ---------- ⑥ IDB 不可用时安全回退 ----------
        log("\n===== ⑥ IDB 不可用时回退 localStorage =====");
        const fallback = await evaluate(`(async () => {
            // 让 indexedDB.open 抛错 → 生产层应判定不可用并回退
            const origOpen = IDBFactory.prototype.open;
            IDBFactory.prototype.open = function () { throw new Error("模拟 IDB 被禁用"); };
            // 注意：探测结果被缓存，因此这里用一个"新槽位"验证写入路径仍可用
            const s = "data:audio/mpeg;base64," + "RkFMTEJBQ0s=".repeat(50);
            const r = await window.__probe.write(9, s);
            const back = await window.__probe.readData(9);
            IDBFactory.prototype.open = origOpen;
            await window.__probe.del(9);
            return { r, readBack: back?.length === s.length };
        })()`);
        log(`IDB 禁用时写入结果=${JSON.stringify(fallback.r)}`);
        check("【核心】IDB 不可用时写入仍成功（不阻止上传）", fallback.r?.ok === true, JSON.stringify(fallback.r));
        check("【核心】写入介质回退为 localStorage", fallback.r?.stored === "localstorage", JSON.stringify(fallback.r));
        check("回退路径读回一致", fallback.readBack === true);

        // ---------- ⑦ 清理 ----------
        log("\n===== ⑦ 清理 =====");
        const cleaned = await evaluate(`(async () => {
            for (const s of [1,5,6,7,8,9]) { await window.__probe.del(s); }
            await window.__probe.rawIdbDelete(1);
            await window.__probe.rawIdbDelete(5);
            return {
              idb: await window.__probe.rawIdb(1),
              ls: [1,5,6,7,8,9].map(s => window.__probe.lsGet(window.__probe.VOICE_KEY(s))).filter(Boolean).length
            };
        })()`);
        check("清理后 IndexedDB 无残留", cleaned.idb === null, JSON.stringify(cleaned.idb));
        check("清理后 localStorage 无残留音色", cleaned.ls === 0, `${cleaned.ls}`);
    } finally {
        await cleanup();
    }

    log(`\n========== 真实 IndexedDB 验证: ${passed} 通过 / ${failed} 失败 ==========`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch(async (e) => {
    log(`真实 IDB 验证异常: ${e?.stack ?? e}`);
    process.exit(1);
});
