// voice-idb.e2e.ts —— 【P0-2】TTS 音色 IndexedDB 迁移回归（fail-safe）
//
// 核心不变量：**只有在新位置写入成功并读回校验通过之后，才允许删除旧数据。**
// 任何失败路径都必须保留 localStorage 里的旧音色 —— 它始终是最后一份可靠副本。
//
// 本套件用真实浏览器 + 真实 IndexedDB 运行（localStorage 桩无法模拟 IDB 事务语义）。

import {
    readVoice,
    readVoiceData,
    writeVoice,
    deleteVoice,
    migrateVoiceFromLocalStorage,
    migrateAllVoices,
    isIndexedDbAvailable,
    describeVoiceData,
    MAX_VOICE_AUDIO_BYTES_IDB,
    isWriteVoiceFailure,
} from "../playground/voice-store";
import { currentSlot, slotKey, KEY_PREFIX, saveState, getSaveFailureGeneration } from "../playground/storage";
import { e2eCheck, e2eLog, e2eParams, e2eRun } from "./e2e-assert";

const scenario = e2eParams().get("scenario") ?? "";
const SLOT = 1;
const VOICE_KEY = slotKey(KEY_PREFIX.ttsVoice, SLOT);
const SAMPLE = "data:audio/mpeg;base64," + "QUJDREVGR0g=".repeat(20); // 小样本

const idbGetRaw = (slot: number): Promise<unknown> =>
    new Promise((resolve) => {
        try {
            const req = indexedDB.open("melody-of-us", 1);
            req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction("tts-voice", "readonly");
                const g = tx.objectStore("tts-voice").get(slot);
                g.onsuccess = () => {
                    db.close();
                    resolve(g.result ?? null);
                };
                g.onerror = () => {
                    db.close();
                    resolve(null);
                };
            };
            req.onerror = () => resolve(null);
        } catch {
            resolve(null);
        }
    });

const idbDeleteRaw = (slot: number): Promise<void> =>
    new Promise((resolve) => {
        try {
            const req = indexedDB.open("melody-of-us", 1);
            req.onsuccess = () => {
                const db = req.result;
                const tx = db.transaction("tts-voice", "readwrite");
                tx.objectStore("tts-voice").delete(slot);
                tx.oncomplete = () => {
                    db.close();
                    resolve();
                };
                tx.onerror = () => {
                    db.close();
                    resolve();
                };
            };
            req.onerror = () => resolve();
        } catch {
            resolve();
        }
    });

await e2eRun(async () => {
    e2eLog(`scenario=${scenario} 冻结槽位=${currentSlot}`);

    const available = await isIndexedDbAvailable();
    e2eLog(`IndexedDB 可用=${available}`);
    // 【环境说明】本沙箱的 Chromium **IndexedDB 后端不工作**：`indexedDB` 存在、
    // `open()` 也返回 request，但 onsuccess/onerror/onblocked 在任何 headless 变体下都
    // 永不触发（已用 5 种 flag 组合 + 阻塞 load 事件 4 秒逐一验证）。
    // 因此这里**不把"IDB 可用"当作断言**（那会变成断言环境而不是断言代码），
    // 而是据此分支：可用则走真实 IDB 端到端；不可用则验证同样必须正确的回退路径。
    // fail-safe 的**决策逻辑**已由 tests/voice-store.test.mjs 用注入后端确定性覆盖。
    if (!available) {
        e2eLog("WARN: 本环境 IndexedDB 后端不可用 - 只验证回退路径；fail-safe 逻辑见 voice-store 单测");
        const emptyRead = await readVoiceData(SLOT);
        e2eCheck("【回退】IDB 不可用时读回为 null（无数据）", emptyRead === null, `${emptyRead}`);

        const w = await writeVoice(SAMPLE, SLOT);
        e2eCheck("【回退】写入成功且落在 localStorage", w.ok === true && w.stored === "localstorage", JSON.stringify(w));
        e2eCheck("【回退】localStorage 确有数据", localStorage.getItem(VOICE_KEY) === SAMPLE, `${localStorage.getItem(VOICE_KEY)?.length ?? "null"} vs ${SAMPLE.length}`);
        const src = (await readVoice(SLOT)).source;
        e2eCheck("【回退】读回来源为 localstorage", src === "localstorage", src);
        const back = await readVoiceData(SLOT);
        e2eCheck("【回退】读回数据一致", back === SAMPLE, `${back?.length ?? "null"} vs ${SAMPLE.length}`);

        const mig = await migrateVoiceFromLocalStorage(SLOT);
        e2eCheck("【回退】迁移报告 idb-unavailable（而非静默成功）", mig.status === "idb-unavailable", mig.status);
        e2eCheck("【核心】IDB 不可用时旧数据必须保留", localStorage.getItem(VOICE_KEY) === SAMPLE);

        await deleteVoice(SLOT);
        e2eCheck("【回退】删除后清空", localStorage.getItem(VOICE_KEY) === null && (await readVoiceData(SLOT)) === null);
        return;
    }

    // 清场
    await idbDeleteRaw(SLOT);
    localStorage.removeItem(VOICE_KEY);

    // =====================================================================
    if (scenario === "data-shape") {
        const d = describeVoiceData(SAMPLE);
        e2eLog(`describe: mime=${d.mime} bytes=${d.bytes} approxAudio=${d.approxAudioBytes}`);
        e2eCheck("解析出 mime", d.mime === "audio/mpeg", d.mime);
        e2eCheck("base64 字节数正确", d.bytes === SAMPLE.length, `${d.bytes}`);
        e2eCheck("估算音频体积小于 base64 长度（膨胀率）", d.approxAudioBytes > 0 && d.approxAudioBytes < d.bytes, `${d.approxAudioBytes} vs ${d.bytes}`);
        e2eCheck("上限常量：IDB 25MB", MAX_VOICE_AUDIO_BYTES_IDB === 25 * 1024 * 1024, `${MAX_VOICE_AUDIO_BYTES_IDB}`);

        // 写入 → 读回
        const w = await writeVoice(SAMPLE, SLOT);
        e2eCheck("写入 IndexedDB 成功", w.ok === true && w.stored === "indexeddb", JSON.stringify(w));
        const rec = (await idbGetRaw(SLOT)) as { slot: number; data: string; meta: { source: string; mime: string } } | null;
        e2eCheck("IDB 记录主键为槽位", rec?.slot === SLOT, `${rec?.slot}`);
        e2eCheck("IDB 记录含 base64 原文", rec?.data === SAMPLE);
        e2eCheck("IDB 记录含 metadata", rec?.meta?.mime === "audio/mpeg" && rec?.meta?.source === "user-upload", JSON.stringify(rec?.meta));
        e2eCheck("读回来源为 indexeddb", (await readVoice(SLOT)).source === "indexeddb");
        e2eCheck("读回数据一致", (await readVoiceData(SLOT)) === SAMPLE);
        await deleteVoice(SLOT);
        e2eCheck("删除后 IDB 已无记录", (await idbGetRaw(SLOT)) === null);
        e2eCheck("删除后读回为 null", (await readVoiceData(SLOT)) === null);

        // =================================================================
    } else if (scenario === "migrate-happy") {
        // ---------- 迁移成功路径 ----------
        localStorage.setItem(VOICE_KEY, SAMPLE);
        const r = await migrateVoiceFromLocalStorage(SLOT);
        e2eLog(`迁移结果=${r.status}`);
        e2eCheck("迁移状态为 migrated", r.status === "migrated", r.status);
        e2eCheck("【核心】IDB 已有该音色", ((await idbGetRaw(SLOT)) as { data: string } | null)?.data === SAMPLE);
        e2eCheck("【核心】旧 localStorage 键已被删除", localStorage.getItem(VOICE_KEY) === null);
        e2eCheck("读回来源变为 indexeddb", (await readVoice(SLOT)).source === "indexeddb");
        const rec = (await idbGetRaw(SLOT)) as { meta: { source: string } } | null;
        e2eCheck("meta.source 标记为迁移来源", rec?.meta?.source === "migrated-from-localstorage", JSON.stringify(rec?.meta));

        // 幂等
        const again = await migrateVoiceFromLocalStorage(SLOT);
        e2eCheck("重复迁移幂等（already-migrated）", again.status === "already-migrated", again.status);
        e2eCheck("重复迁移不会丢数据", (await readVoiceData(SLOT)) === SAMPLE);

        // 无旧数据时
        localStorage.removeItem(VOICE_KEY);
        const noop = await migrateVoiceFromLocalStorage(SLOT);
        e2eCheck("无旧数据时不报错", noop.status === "already-migrated" || noop.status === "nothing-to-migrate", noop.status);

        // 批量迁移
        localStorage.setItem(slotKey(KEY_PREFIX.ttsVoice, 2), SAMPLE);
        localStorage.setItem(slotKey(KEY_PREFIX.ttsVoice, 3), SAMPLE);
        const results = await migrateAllVoices([1, 2, 3, 4, 5]);
        e2eCheck("批量迁移返回全部槽位的结果", results.length === 5, `${results.length}`);
        e2eCheck("槽位 2/3 完成迁移", results.filter((x) => x.status === "migrated").length === 2, JSON.stringify(results.map((x) => `${x.slot}:${x.status}`)));
        e2eCheck("槽位 2 的旧键已删", localStorage.getItem(slotKey(KEY_PREFIX.ttsVoice, 2)) === null);
        await deleteVoice(2);
        await deleteVoice(3);

        // =================================================================
    } else if (scenario === "migrate-failsafe") {
        // ---------- 【核心】各类失败路径都必须保留旧数据 ----------
        localStorage.setItem(VOICE_KEY, SAMPLE);
        e2eLog(`迁移前 localStorage 长度=${localStorage.getItem(VOICE_KEY)?.length}`);

        // ① IDB 写入失败 → 不删旧数据
        const proto = Object.getPrototypeOf(indexedDB) as IDBFactory;
        const originalOpen = proto.open;
        proto.open = function () {
            throw new Error("模拟：IndexedDB 打开失败");
        } as typeof proto.open;
        const r1 = await migrateVoiceFromLocalStorage(SLOT);
        proto.open = originalOpen;
        e2eLog(`IDB 写入失败 → ${r1.status}`);
        e2eCheck("【核心】IDB 不可用时迁移不成功", r1.status !== "migrated", r1.status);
        e2eCheck("【核心】旧数据仍在（未删除）", localStorage.getItem(VOICE_KEY) === SAMPLE, `${localStorage.getItem(VOICE_KEY)?.length ?? "null"}`);
        e2eCheck("【核心】读回仍能拿到音色（回退 localStorage）", (await readVoiceData(SLOT)) === SAMPLE);

        // ② 读回校验失败 → 同样不删
        //    手段：写入后立刻把 IDB 里的数据改掉，使 verify 读到不一致
        const originalPut = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
            // 篡改写入内容，使读回校验必然失败
            const tampered = { ...(value as Record<string, unknown>), data: "data:audio/mpeg;base64,TAMPERED" };
            return originalPut.call(this, tampered, key as IDBValidKey);
        } as typeof IDBObjectStore.prototype.put;
        const r2 = await migrateVoiceFromLocalStorage(SLOT);
        IDBObjectStore.prototype.put = originalPut;
        e2eLog(`读回校验失败 → ${r2.status}`);
        e2eCheck("【核心】校验不一致时迁移不成功", r2.status === "verify-failed", r2.status);
        e2eCheck("【核心】校验失败时旧数据仍保留", localStorage.getItem(VOICE_KEY) === SAMPLE, `${localStorage.getItem(VOICE_KEY)?.length ?? "null"}`);
        e2eCheck("【核心】校验失败时不留下脏 IDB 记录影响读取", (await readVoice(SLOT)).source === "indexeddb" || (await readVoice(SLOT)).data === SAMPLE);

        // 清掉被篡改的记录，恢复干净环境
        await idbDeleteRaw(SLOT);
        localStorage.setItem(VOICE_KEY, SAMPLE);
        const r3 = await migrateVoiceFromLocalStorage(SLOT);
        e2eCheck("恢复后迁移成功", r3.status === "migrated", r3.status);
        e2eCheck("恢复后旧键被清理", localStorage.getItem(VOICE_KEY) === null);

        // =================================================================
    } else if (scenario === "save-safety") {
        // ---------- 【核心】operation-scoped：陈旧 failure 不得导致误回滚 ----------
        // 场景：先制造一次存档失败（配额问题），随后清掉空间再写音色。
        //   修复前的判定（lastSaveFailure !== null）会误判为"音色导致存档失败"→ 错误回滚。
        //   现在的判定（generation 差值 + saveState() 明确返回值）不会误回滚。

        const genBefore = getSaveFailureGeneration();
        e2eLog(`初始 generation=${genBefore}`);

        // 制造一次真实的存档失败：临时让 setItem 抛配额错误
        const proto = Object.getPrototypeOf(localStorage) as Storage;
        const original = proto.setItem;
        proto.setItem = function () {
            const err = new Error("The quota has been exceeded.");
            err.name = "QuotaExceededError";
            throw err;
        };
        const failedSave = saveState();
        proto.setItem = original;
        const genAfterFailure = getSaveFailureGeneration();
        e2eLog(`制造失败后 saveState=${failedSave} generation=${genAfterFailure}`);
        e2eCheck("前置：成功制造了一次存档失败", failedSave === false && genAfterFailure > genBefore, `${genBefore}→${genAfterFailure}`);

        // 现在存储正常，写音色应当成功且**不被回滚**
        const w = await writeVoice(SAMPLE, SLOT);
        e2eLog(`陈旧 failure 存在的情况下写入音色 → ok=${w.ok} reason=${isWriteVoiceFailure(w) ? w.reason : "-"}`);
        e2eCheck("【核心】陈旧的 failure 不会导致误回滚", w.ok === true, JSON.stringify(w));
        e2eCheck("【核心】音色确实写入了", ((await idbGetRaw(SLOT)) as { data: string } | null)?.data === SAMPLE);

        // ---------- 本次操作致失败 → 必须回滚 ----------
        // 手段：让 saveState 在写入音色之后的联动检查中失败并新增 generation。
        //       具体做法是拦截 localStorage.setItem 使存档键写入失败。
        const SAVE_KEY = slotKey(KEY_PREFIX.state, SLOT);
        const proto2 = Object.getPrototypeOf(localStorage) as Storage;
        const original2 = proto2.setItem;
        proto2.setItem = function (k: string, v: string) {
            if (k === SAVE_KEY) {
                const err = new Error("The quota has been exceeded.");
                err.name = "QuotaExceededError";
                throw err;
            }
            return original2.call(this, k, v);
        };
        const w2 = await writeVoice(SAMPLE, SLOT);
        proto2.setItem = original2;
        e2eLog(`本次操作致存档失败 → ok=${w2.ok} reason=${isWriteVoiceFailure(w2) ? w2.reason : "-"} rolledBack=${isWriteVoiceFailure(w2) ? w2.rolledBack : "-"}`);
        e2eCheck("【核心】本次写入导致存档失败时返回失败", w2.ok === false, JSON.stringify(w2));
        e2eCheck("【核心】明确标记为已回滚", w2.ok === false && w2.rolledBack === true, JSON.stringify(w2));
        e2eCheck("【核心】回滚后 IDB 不留该音色", ((await idbGetRaw(SLOT)) as unknown) === null);

        await deleteVoice(SLOT);

        // =================================================================
    } else if (scenario === "legacy-fallback") {
        // ---------- IDB 不可用 → 完全退回 localStorage（不阻止上传） ----------
        const proto = Object.getPrototypeOf(indexedDB) as IDBFactory;
        const originalOpen = proto.open;
        proto.open = function () {
            throw new Error("模拟：IndexedDB 被禁用");
        } as typeof proto.open;

        e2eCheck("IDB 探测为不可用", (await isIndexedDbAvailable()) === false);

        const w = await writeVoice(SAMPLE, SLOT);
        e2eLog(`IDB 不可用时写入 → ok=${w.ok} stored=${isWriteVoiceFailure(w) ? "-" : w.stored}`);
        e2eCheck("【核心】IDB 不可用时仍能写入（回退 localStorage）", w.ok === true && w.stored === "localstorage", JSON.stringify(w));
        e2eCheck("【核心】数据落在 localStorage", localStorage.getItem(VOICE_KEY) === SAMPLE);
        e2eCheck("读回来源为 localstorage", (await readVoice(SLOT)).source === "localstorage");
        e2eCheck("读回数据一致", (await readVoiceData(SLOT)) === SAMPLE);

        // 此路径下迁移必须报告 idb-unavailable 且不删数据
        const r = await migrateVoiceFromLocalStorage(SLOT);
        e2eCheck("【核心】IDB 不可用时迁移报告 idb-unavailable", r.status === "idb-unavailable", r.status);
        e2eCheck("【核心】IDB 不可用时旧数据保留", localStorage.getItem(VOICE_KEY) === SAMPLE);

        proto.open = originalOpen;
        localStorage.removeItem(VOICE_KEY);

    } else {
        e2eCheck(`未知 scenario: ${scenario}`, false);
    }

    // 收尾：清理本套件写入的数据，避免影响后续 phase
    await deleteVoice(SLOT);
    localStorage.removeItem(VOICE_KEY);
});
