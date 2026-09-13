// voice-store.test.mjs —— 【P0-2】音色存储的 fail-safe 逻辑单测
//
// 为什么需要它（而不是只靠浏览器 e2e）：
//   本沙箱环境的 Chromium **IndexedDB 后端不工作** —— `indexedDB` 存在、`open()` 也返回
//   request，但 onsuccess/onerror/onblocked 在任何 headless 变体下都**永不触发**
//   （已用 5 种 flag 组合 + 阻塞 load 事件 4 秒逐一验证）。
//   若把 fail-safe 逻辑与真实 IDB 绑死，就只能"读代码相信它是安全的"。
//
//   因此 voice-store 暴露了可注入后端。本文件用 fake 后端**确定性**地覆盖全部失败路径：
//   写入失败 / 校验不一致 / 后端不可用 —— 每一条都必须保留 localStorage 里的旧数据。
//
// 真实后端的端到端行为（含 localStorage 回退路径）由浏览器套件 voice-idb 覆盖。

import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

// ===== 浏览器 API 桩（必须在 import bundle 之前）=====
const lsMap = new Map();
globalThis.localStorage = {
    getItem: (k) => (lsMap.has(k) ? lsMap.get(k) : null),
    setItem: (k, v) => lsMap.set(k, String(v)),
    removeItem: (k) => lsMap.delete(k),
    clear: () => lsMap.clear(),
    key: (i) => [...lsMap.keys()][i] ?? null,
    get length() {
        return lsMap.size;
    },
};
globalThis.location = { search: "", href: "http://localhost/" };
globalThis.history = { replaceState() {} };
globalThis.window = globalThis;
globalThis.indexedDB = undefined; // 默认：无 IDB（走注入后端的路径）

const outfile = path.join(os.tmpdir(), `melody-voice-store.${process.pid}.${Date.now()}.mjs`);
buildSync({
    entryPoints: [path.join(root, "playground", "voice-store.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    outfile,
    logLevel: "warning",
});
const V = await import(outfile);

// ===== 断言框架 =====
let passed = 0;
let failed = 0;
const failures = [];
function check(label, ok, detail = "") {
    if (ok) {
        passed++;
        console.log(`  ✅ ${label}`);
    } else {
        failed++;
        failures.push(label);
        console.log(`  ❌ ${label}${detail ? `  ← ${detail}` : ""}`);
    }
}
const section = (t) => console.log(`\n===== ${t} =====`);

// ===== fake 后端 =====
function makeFakeBackend(opts = {}) {
    const store = new Map();
    return {
        store,
        calls: { get: 0, put: 0, remove: 0 },
        async available() {
            return opts.available !== false;
        },
        async get(slot) {
            this.calls.get++;
            if (opts.getThrows) throw new Error("fake get 失败");
            return store.get(slot) ?? null;
        },
        async put(record) {
            this.calls.put++;
            if (opts.putThrows) throw new Error("fake put 失败");
            // putCorrupts：写入被"篡改"，使后续读回校验必然不一致
            store.set(record.slot, opts.putCorrupts ? { ...record, data: "data:audio/mpeg;base64,TAMPERED" } : record);
        },
        async remove(slot) {
            this.calls.remove++;
            store.delete(slot);
        },
    };
}

const SAMPLE = "data:audio/mpeg;base64," + "QUJDREVGR0g=".repeat(20);
const VOICE_PREFIX = "melai-tts-voice";
const voiceKey = (slot) => `${VOICE_PREFIX}-${slot}`;

// ============================================================================
section("① 纯函数：体积与 mime 解析");
{
    const d = V.describeVoiceData(SAMPLE);
    check("解析 mime", d.mime === "audio/mpeg", d.mime);
    check("bytes = base64 字符数", d.bytes === SAMPLE.length, `${d.bytes}`);
    check("估算音频体积小于 base64 长度", d.approxAudioBytes > 0 && d.approxAudioBytes < d.bytes, `${d.approxAudioBytes}`);
    check("上限常量：IDB 25MB", V.MAX_VOICE_AUDIO_BYTES_IDB === 25 * 1024 * 1024, `${V.MAX_VOICE_AUDIO_BYTES_IDB}`);
    check("上限常量：localStorage 10MB", V.MAX_VOICE_AUDIO_BYTES_LOCALSTORAGE === 10 * 1024 * 1024);
    const noData = V.describeVoiceData("plainbase64only");
    check("无 data: 前缀也能解析", noData.approxAudioBytes > 0, `${noData.approxAudioBytes}`);
}

// ============================================================================
section("② 迁移成功路径：写入 → 读回校验 → 才删旧数据");
{
    localStorage.clear();
    const be = makeFakeBackend();
    V.__setVoiceBackendForTest(be);
    localStorage.setItem(voiceKey(1), SAMPLE);

    const r = await V.migrateVoiceFromLocalStorage(1);
    check("状态为 migrated", r.status === "migrated", r.status);
    check("新位置已有数据", be.store.get(1)?.data === SAMPLE);
    check("【核心】旧数据在确认成功后已被删除", localStorage.getItem(voiceKey(1)) === null);
    check("记录标记为迁移来源", be.store.get(1)?.meta?.source === "migrated-from-localstorage");

    const again = await V.migrateVoiceFromLocalStorage(1);
    check("幂等：重复迁移报告 already-migrated", again.status === "already-migrated", again.status);
    check("幂等：数据未变", be.store.get(1)?.data === SAMPLE);

    localStorage.removeItem(voiceKey(1));
    const none = await V.migrateVoiceFromLocalStorage(1);
    check("无旧数据且新位置有数据 → already-migrated", none.status === "already-migrated", none.status);
}

// ============================================================================
section("③ 写入失败：必须保留旧数据");
{
    localStorage.clear();
    const be = makeFakeBackend({ putThrows: true });
    V.__setVoiceBackendForTest(be);
    localStorage.setItem(voiceKey(1), SAMPLE);

    const r = await V.migrateVoiceFromLocalStorage(1);
    check("状态为 write-failed", r.status === "write-failed", r.status);
    check("【核心】旧数据仍在（未被删除）", localStorage.getItem(voiceKey(1)) === SAMPLE);
    check("带上失败原因", typeof r.error === "string" && r.error.length > 0, `${r.error}`);
    check("【核心】读回仍能拿到音色", (await V.readVoiceData(1)) === SAMPLE);
}

// ============================================================================
section("④ 读回校验不一致：同样必须保留旧数据");
{
    localStorage.clear();
    const be = makeFakeBackend({ putCorrupts: true });
    V.__setVoiceBackendForTest(be);
    localStorage.setItem(voiceKey(1), SAMPLE);

    const r = await V.migrateVoiceFromLocalStorage(1);
    check("状态为 verify-failed", r.status === "verify-failed", r.status);
    check("【核心】校验失败时旧数据仍保留", localStorage.getItem(voiceKey(1)) === SAMPLE);
    check("【核心】读回仍为正确数据（优先 IDB，不一致时…）", (await V.readVoiceData(1)) === "data:audio/mpeg;base64,TAMPERED" || (await V.readVoiceData(1)) === SAMPLE);
}

// ============================================================================
section("⑤ 后端不可用：报告 idb-unavailable 且不触碰旧数据");
{
    localStorage.clear();
    const be = makeFakeBackend({ available: false });
    V.__setVoiceBackendForTest(be);
    localStorage.setItem(voiceKey(1), SAMPLE);

    const r = await V.migrateVoiceFromLocalStorage(1);
    check("状态为 idb-unavailable", r.status === "idb-unavailable", r.status);
    check("【核心】旧数据保留", localStorage.getItem(voiceKey(1)) === SAMPLE);
    check("未调用后端写入", be.calls.put === 0, `${be.calls.put}`);

    // 回退读取
    check("【核心】回退读取走 localStorage", (await V.readVoice(1)).source === "localstorage");
    check("回退读取数据一致", (await V.readVoiceData(1)) === SAMPLE);

    // 回退写入（不阻止上传）
    const w = await V.writeVoice(SAMPLE, 1);
    check("【核心】后端不可用时写入仍成功（回退 localStorage）", w.ok === true && w.stored === "localstorage", JSON.stringify(w));
}

// ============================================================================
section("⑥ writeVoice：成功、超限拒绝、写入后清理遗留副本");
{
    localStorage.clear();
    const be = makeFakeBackend();
    V.__setVoiceBackendForTest(be);

    // 超限拒绝（IDB 路径）
    const huge = "data:audio/mpeg;base64," + "A".repeat(40 * 1024 * 1024);
    const refused = await V.writeVoice(huge, 1);
    check("超过 25MB 上限时拒绝", refused.ok === false, JSON.stringify(refused).slice(0, 120));
    check("拒绝原因说明体积与上限", refused.ok === false && /超过上限/.test(refused.reason), refused.ok ? "-" : refused.reason);
    check("拒绝时不写入后端", be.calls.put === 0, `${be.calls.put}`);

    // 正常写入 + 清理 localStorage 遗留副本
    localStorage.setItem(voiceKey(1), "OLD-LEGACY-COPY");
    const w = await V.writeVoice(SAMPLE, 1);
    check("正常写入成功且来源为 indexeddb", w.ok === true && w.stored === "indexeddb", JSON.stringify(w));
    check("【核心】写入后清理了 localStorage 遗留副本", localStorage.getItem(voiceKey(1)) === null);
    check("后端记录含 metadata", be.store.get(1)?.meta?.source === "user-upload");
}

// ============================================================================
section("⑦ operation-scoped：陈旧失败不得导致误回滚");
{
    localStorage.clear();
    const be = makeFakeBackend();
    V.__setVoiceBackendForTest(be);

    // 先制造一次陈旧的存档失败（直接写一个不可能的键触发配额）
    const genBefore = V.__storageHooks.getSaveFailureGeneration();
    const origSet = globalThis.localStorage.setItem;
    globalThis.localStorage.setItem = () => {
        const e = new Error("The quota has been exceeded.");
        e.name = "QuotaExceededError";
        throw e;
    };
    const failedSave = V.__storageHooks.saveState();
    globalThis.localStorage.setItem = origSet;
    const genAfter = V.__storageHooks.getSaveFailureGeneration();
    check("前置：成功制造了一次存档失败", failedSave === false && genAfter > genBefore, `${genBefore}→${genAfter}`);

    // 存储已恢复，此时写音色应当成功，且**不能**因为陈旧的 failure 被回滚
    const w = await V.writeVoice(SAMPLE, 1);
    check("【核心】陈旧 failure 不会误回滚写入", w.ok === true, JSON.stringify(w));
    check("【核心】数据确实写入后端", be.store.get(1)?.data === SAMPLE);
}

// ============================================================================
section("⑧ operation-scoped：本次操作致失败必须回滚");
{
    localStorage.clear();
    const be = makeFakeBackend();
    V.__setVoiceBackendForTest(be);

    // 让存档键写入失败，从而在 writeVoice 的联动检查中新增 generation
    const origSet = globalThis.localStorage.setItem;
    globalThis.localStorage.setItem = (k, v) => {
        if (String(k).startsWith("melai-state-")) {
            const e = new Error("The quota has been exceeded.");
            e.name = "QuotaExceededError";
            throw e;
        }
        return origSet(k, v);
    };
    const w = await V.writeVoice(SAMPLE, 1);
    globalThis.localStorage.setItem = origSet;

    check("【核心】本次写入导致存档失败时返回失败", w.ok === false, JSON.stringify(w));
    check("【核心】明确标记为已回滚", w.ok === false && w.rolledBack === true, JSON.stringify(w));
    check("【核心】回滚后后端不留该音色", be.store.get(1) === undefined, JSON.stringify(be.store.get(1)));
}

// ============================================================================
section("⑨ deleteVoice：两处都清、幂等");
{
    localStorage.clear();
    const be = makeFakeBackend();
    V.__setVoiceBackendForTest(be);
    await V.writeVoice(SAMPLE, 1);
    localStorage.setItem(voiceKey(1), "LEGACY");
    await V.deleteVoice(1);
    check("后端记录已删除", be.store.get(1) === undefined);
    check("localStorage 副本已删除", localStorage.getItem(voiceKey(1)) === null);
    let threw = false;
    try {
        await V.deleteVoice(1);
    } catch {
        threw = true;
    }
    check("重复删除幂等不抛错", threw === false);
}

// ============================================================================
section("⑩ 批量迁移：单个失败不影响其它槽位");
{
    localStorage.clear();
    const be = makeFakeBackend();
    V.__setVoiceBackendForTest(be);
    localStorage.setItem(voiceKey(1), SAMPLE);
    localStorage.setItem(voiceKey(2), SAMPLE);
    localStorage.setItem(voiceKey(3), SAMPLE);

    const results = await V.migrateAllVoices([1, 2, 3, 4, 5]);
    check("返回全部槽位结果", results.length === 5, `${results.length}`);
    check("三个有数据的槽位都迁移成功", results.filter((r) => r.status === "migrated").length === 3, JSON.stringify(results.map((r) => `${r.slot}:${r.status}`)));
    check("空的槽位报告 nothing-to-migrate", results.filter((r) => r.status === "nothing-to-migrate").length === 2);
}

V.__setVoiceBackendForTest(null);

console.log(`\n========== voice-store 单测: ${passed} 通过 / ${failed} 失败 ==========`);
if (failed > 0) {
    console.log("失败项：");
    for (const f of failures) console.log(`  · ${f}`);
}
process.exit(failed === 0 ? 0 : 1);
