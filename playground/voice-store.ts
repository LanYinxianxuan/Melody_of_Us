// voice-store.ts —— 【P0-2】TTS 音色的 IndexedDB 存储层（fail-safe 迁移）
//
// 目标：解除 TTS 音色与 localStorage 5MB 配额的竞争。
//   实测：满量存档仅 73KB，而 **1MB 音频的 base64 就占掉约 53% 配额，2MB 直接超额**，
//   而 tts.ts 原先允许上传 10MB —— 一次正常长度的音色样本就能让此后所有存档写入静默失败。
//
// 边界（严格执行"不重构音频系统"）：
//   · 只改**音色的存放介质**，不改合成/播放链路、不改请求格式；
//   · `data` 保持 base64 data URL（消费方现在直接把它塞进请求体，改成 Blob 会牵动请求构造）；
//   · 三个入口：readVoice / writeVoice / deleteVoice，其余逻辑一概不动。
//
// fail-safe 的核心不变量：**新位置确认写入并读回校验成功后，才允许删除旧数据**。

import { currentSlot, slotKey, KEY_PREFIX } from "./storage";
import { getSaveFailureGeneration, saveState } from "./storage";

/**
 * 测试出口：把"存档安全联动"所依赖的两个原语集中暴露。
 *
 * 为什么需要：operation-scoped 判定是本模块最关键的逻辑（误判会错误回滚用户的音色），
 * 而它只有在能**确定性地**制造"存档失败"时才能被验证。暴露这两个原语让单测可以
 * 精确控制失败时机，而不必依赖真实配额耗尽。
 */
export const __storageHooks = { getSaveFailureGeneration, saveState };

// ============ IndexedDB 基本参数 ============

const DB_NAME = "melody-of-us";
const DB_VERSION = 1;
const STORE_VOICE = "tts-voice";

/**
 * IndexedDB 探测超时（毫秒）。
 *
 * 为什么必须有：探测本身是异步的，而某些环境下 `indexedDB.open()` 返回的 request
 * **永远不会触发任何回调**（实测：本仓库 CI/沙箱的 headless Chromium 就是如此 ——
 * `indexedDB` 存在、`open()` 也返回 request，但 onsuccess/onerror/onblocked 全部不触发）。
 * 若不设超时，`isIndexedDbAvailable()` 会返回一个永不 settle 的 Promise，
 * 于是每一个音色操作（读/写/删/迁移）都会**永久挂起** —— 比"不支持 IDB"严重得多。
 *
 * 超时后按"不可用"处理：功能退回 localStorage，一切照常工作，只是没有配额优势。
 */
const IDB_PROBE_TIMEOUT_MS = 1500;

/** IndexedDB 可用性（隐私模式 / 浏览器禁用 / 无该 API / 探测超时 时为 false） */
let idbProbe: Promise<boolean> | null = null;

export function isIndexedDbAvailable(): Promise<boolean> {
    if (idbProbe) return idbProbe;
    idbProbe = new Promise<boolean>((resolve) => {
        let settled = false;
        const finish = (ok: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(ok);
        };
        const timer = setTimeout(() => finish(false), IDB_PROBE_TIMEOUT_MS);

        try {
            if (typeof indexedDB === "undefined" || indexedDB === null) {
                finish(false);
                return;
            }
            // 只有真正能 open 才算可用（某些环境存在 API 但调用即抛）
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                try {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(STORE_VOICE)) {
                        db.createObjectStore(STORE_VOICE, { keyPath: "slot" });
                    }
                } catch {
                    finish(false);
                }
            };
            req.onsuccess = () => {
                try {
                    req.result.close();
                } catch {
                    /* ignore */
                }
                finish(true);
            };
            req.onerror = () => finish(false);
            req.onblocked = () => finish(false);
        } catch {
            finish(false);
        }
    });
    return idbProbe;
}

/**
 * 操作超时（毫秒）。
 *
 * 与探测超时同理：在某些环境里 IDB 的 request/transaction **永远不触发回调**。
 * 若不给每个操作设超时，一次音色读写就会让整个页面永久挂起
 * （表现为"点了上传/朗读之后毫无反应"）。超时后按失败处理 → 上层回退或报错，
 * 用户至少能继续使用应用。
 */
const IDB_OP_TIMEOUT_MS = 3000;

/** 给一个 promise 套上超时；超时按失败处理 */
function withTimeout<T>(p: Promise<T>, label: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${label} 超时（IndexedDB 无响应）`)), IDB_OP_TIMEOUT_MS);
        p.then(
            (v) => {
                clearTimeout(timer);
                resolve(v);
            },
            (e) => {
                clearTimeout(timer);
                reject(e);
            },
        );
    });
}

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            fn();
        };
        const timer = setTimeout(() => finish(() => reject(new Error("IndexedDB open 超时"))), IDB_OP_TIMEOUT_MS);
        try {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                try {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(STORE_VOICE)) {
                        db.createObjectStore(STORE_VOICE, { keyPath: "slot" });
                    }
                } catch (e) {
                    finish(() => reject(e));
                }
            };
            req.onsuccess = () => finish(() => resolve(req.result));
            req.onerror = () => finish(() => reject(req.error ?? new Error("IndexedDB open 失败")));
            req.onblocked = () => finish(() => reject(new Error("IndexedDB 被其它连接阻塞")));
        } catch (e) {
            finish(() => reject(e));
        }
    });
}

// ============ 记录形状 ============

export interface VoiceRecord {
    /** 主键：槽位 */
    slot: number;
    /** base64 data URL —— 与既有 localStorage 内容**完全一致**，避免改动消费方 */
    data: string;
    meta: {
        mime: string;
        /** base64 字符数 */
        bytes: number;
        /** 估算的解码后音频字节数，用于展示与限额 */
        approxAudioBytes: number;
        savedAt: number;
        source: "user-upload" | "migrated-from-localstorage";
    };
}

/** 音色大小上限：IDB 25MB（G8），localStorage 回退时保持原有 10MB 守卫 */
export const MAX_VOICE_AUDIO_BYTES_IDB = 25 * 1024 * 1024;
export const MAX_VOICE_AUDIO_BYTES_LOCALSTORAGE = 10 * 1024 * 1024;

/** 从 data URL 前缀解析 mime 与估算体积 */
export function describeVoiceData(data: string): { mime: string; bytes: number; approxAudioBytes: number } {
    const bytes = data.length;
    const m = data.match(/^data:([^;,]+)[;,]/);
    // base64 膨胀率 4/3；去掉前缀与填充后估算解码字节
    const b64 = data.startsWith("data:") ? data.slice(data.indexOf(",") + 1) : data;
    const padding = (b64.match(/=+$/) ?? [""])[0].length;
    const approxAudioBytes = Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
    return { mime: m?.[1] ?? "audio/mpeg", bytes, approxAudioBytes };
}

// ============ 基本读写 ============

function idbGet(slot: number): Promise<VoiceRecord | null> {
    return withTimeout(openDb().then(
        (db) =>
            new Promise<VoiceRecord | null>((resolve, reject) => {
                const tx = db.transaction(STORE_VOICE, "readonly");
                const req = tx.objectStore(STORE_VOICE).get(slot);
                req.onsuccess = () => {
                    db.close();
                    resolve((req.result as VoiceRecord | undefined) ?? null);
                };
                req.onerror = () => {
                    db.close();
                    reject(req.error ?? new Error("IndexedDB 读取失败"));
                };
            }),
    ), "读取音色");
}

function idbPut(record: VoiceRecord): Promise<void> {
    return withTimeout(openDb().then(
        (db) =>
            new Promise<void>((resolve, reject) => {
                const tx = db.transaction(STORE_VOICE, "readwrite");
                tx.objectStore(STORE_VOICE).put(record);
                tx.oncomplete = () => {
                    db.close();
                    resolve();
                };
                tx.onerror = () => {
                    db.close();
                    reject(tx.error ?? new Error("IndexedDB 写入失败"));
                };
                tx.onabort = () => {
                    db.close();
                    reject(tx.error ?? new Error("IndexedDB 写入被中止"));
                };
            }),
    ), "写入音色");
}

function idbDelete(slot: number): Promise<void> {
    return withTimeout(openDb().then(
        (db) =>
            new Promise<void>((resolve, reject) => {
                const tx = db.transaction(STORE_VOICE, "readwrite");
                tx.objectStore(STORE_VOICE).delete(slot);
                tx.oncomplete = () => {
                    db.close();
                    resolve();
                };
                tx.onerror = () => {
                    db.close();
                    reject(tx.error ?? new Error("IndexedDB 删除失败"));
                };
            }),
    ), "删除音色");
}

// ============ 可注入的后端（唯一目的：让决策逻辑可被确定性测试） ============
//
// 为什么需要它：本仓库的 CI/沙箱环境里 Chromium 的 IndexedDB **后端不工作**
// （实测 `indexedDB` 存在、`open()` 也返回 request，但 onsuccess/onerror/onblocked
//  在任何 headless 变体下都永不触发）。若把 fail-safe 逻辑与真实 IDB 绑死，
// 就只能"靠读代码相信它是安全的"。
//
// 因此把「存储后端」抽成一个接口：生产用真实 IDB，测试注入 fake 后可**确定性**地
// 验证每一条失败路径（写入失败 / 校验不一致 / 回滚）都保留旧数据。
export interface VoiceBackend {
    available(): Promise<boolean>;
    get(slot: number): Promise<VoiceRecord | null>;
    put(record: VoiceRecord): Promise<void>;
    remove(slot: number): Promise<void>;
}

/** 真实 IndexedDB 后端 */
const idbBackend: VoiceBackend = {
    available: () => isIndexedDbAvailable(),
    get: (slot) => idbGet(slot),
    put: (record) => idbPut(record),
    remove: (slot) => idbDelete(slot),
};

let backend: VoiceBackend = idbBackend;

/** 注入后端（仅测试使用；传 null 恢复默认 IDB 后端） */
export function __setVoiceBackendForTest(b: VoiceBackend | null): void {
    backend = b ?? idbBackend;
}

// ============ 对外：读取（IDB 优先，回退 localStorage） ============

export type VoiceSource = "indexeddb" | "localstorage" | "none";

/** 读取音色；返回数据与来源，便于 UI 提示与调试 */
export async function readVoice(slot: number = currentSlot): Promise<{ data: string | null; source: VoiceSource }> {
    if (await backend.available()) {
        try {
            const rec = await backend.get(slot);
            if (rec?.data) return { data: rec.data, source: "indexeddb" };
        } catch {
            /* 读失败 → 回退到 localStorage */
        }
    }
    // 回退（同时覆盖"迁移尚未完成"的场景）
    const legacy = localStorage.getItem(slotKey(KEY_PREFIX.ttsVoice, slot));
    return legacy ? { data: legacy, source: "localstorage" } : { data: null, source: "none" };
}

/** 便捷版：只要数据 */
export async function readVoiceData(slot: number = currentSlot): Promise<string | null> {
    return (await readVoice(slot)).data;
}

// ============ 对外：写入（含与存档安全的联动） ============

export type WriteVoiceFailure = { ok: false; reason: string; rolledBack?: boolean };
export type WriteVoiceSuccess = { ok: true; stored: "indexeddb" | "localstorage" };

export type WriteVoiceResult = WriteVoiceSuccess | WriteVoiceFailure;

/** 类型守卫（跨模块消费联合类型时比依赖 ok 收窄更可靠） */
export function isWriteVoiceFailure(r: WriteVoiceResult): r is WriteVoiceFailure {
    return r.ok === false;
}

/**
 * 写入音色。
 *
 * 两条路径：
 *   · IDB 可用 → 写 IDB，并**清理同槽位的 localStorage 遗留副本**（迁移完成语义）；
 *   · IDB 不可用 → 回退 localStorage（保持现状可用，不阻止上传）。
 *
 * 【P0-2 / D.9】与存档安全的联动使用 **operation-scoped 判定**：
 *   记录写入前后的 SaveFailure generation，只有"本次写入期间新增了失败 且 saveState() 明确返回 false"
 *   才回滚。仅凭 `lastSaveFailure !== null` 会把很久以前的失败算到本次操作头上，
 *   从而错误回滚一次成功的写入。
 */
export async function writeVoice(data: string, slot: number = currentSlot): Promise<WriteVoiceResult> {
    const described = describeVoiceData(data);

    // ---- ① IDB 路径（可用时优先）----
    if (await backend.available()) {
        if (described.approxAudioBytes > MAX_VOICE_AUDIO_BYTES_IDB) {
            return {
                ok: false,
                reason: `音频约 ${(described.approxAudioBytes / 1024 / 1024).toFixed(1)}MB，超过上限 ${MAX_VOICE_AUDIO_BYTES_IDB / 1024 / 1024}MB`,
            };
        }

        // operation-scoped：记录操作前的失败序号
        const genBefore = getSaveFailureGeneration();

        let idbFailed: string | null = null;
        try {
            await backend.put({
                slot,
                data,
                meta: { ...described, savedAt: Date.now(), source: "user-upload" },
            });
            // 读回校验（确认真的落盘，而不只是事务 resolve）
            const verify = await backend.get(slot);
            if (verify?.data !== data) idbFailed = "写入后校验不一致";
        } catch (e) {
            idbFailed = (e as Error)?.message ?? "未知错误";
        }

        if (idbFailed === null) {
            // 确认落盘后才清理 localStorage 遗留副本
            try {
                localStorage.removeItem(slotKey(KEY_PREFIX.ttsVoice, slot));
            } catch {
                /* 清不掉只是多占一点空间，不影响正确性 */
            }

            // 联动检查：本次操作是否把存档推到了失败状态
            const saveOk = saveState();
            const producedNewFailure = getSaveFailureGeneration() > genBefore;
            if (!saveOk && producedNewFailure) {
                try {
                    await backend.remove(slot);
                } catch {
                    /* 尽力而为 */
                }
                saveState();
                return { ok: false, reason: "写入音色后存档失败，已回滚音色以保护存档", rolledBack: true };
            }
            // saveOk 为 false 但本次没有新增失败 → 存档本来就存不进去，与音色无关 → 不回滚
            return { ok: true, stored: "indexeddb" };
        }

        // ---- ② IDB 运行时失败 → **自动降级到 localStorage** ----
        //
        // 为什么必须降级而不是直接报错：探测通过只说明"那一刻 IDB 可打开"。
        // 之后仍可能失败 —— 配额被其它数据库占满、磁盘错误、浏览器中途禁用存储等。
        // 若此时直接返回失败，用户会**完全无法上传音色**，等于把一个"存储优化"
        // 变成了功能倒退。降级路径与"IDB 本来就不可用"完全同构，因此安全。
        console.warn("[TTS] IndexedDB 写入失败，降级到 localStorage：", idbFailed);
        // 清掉可能写入了一半的脏记录，避免 readVoice 读到不一致的数据
        try {
            await backend.remove(slot);
        } catch {
            /* 尽力而为 */
        }
    }

    // ---- ③ 回退路径（IDB 不可用，或 IDB 运行时失败后降级）----
    if (described.approxAudioBytes > MAX_VOICE_AUDIO_BYTES_LOCALSTORAGE) {
        return {
            ok: false,
            reason: `音频约 ${(described.approxAudioBytes / 1024 / 1024).toFixed(1)}MB，超过上限 ${MAX_VOICE_AUDIO_BYTES_LOCALSTORAGE / 1024 / 1024}MB`,
        };
    }
    const genBefore = getSaveFailureGeneration();
    try {
        localStorage.setItem(slotKey(KEY_PREFIX.ttsVoice, slot), data);
    } catch (e) {
        return { ok: false, reason: `本地存储写入失败：${(e as Error)?.message ?? "未知"}` };
    }
    const saveOk = saveState();
    const producedNewFailure = getSaveFailureGeneration() > genBefore;
    if (!saveOk && producedNewFailure) {
        try {
            localStorage.removeItem(slotKey(KEY_PREFIX.ttsVoice, slot));
        } catch {
            /* 尽力而为 */
        }
        saveState();
        return { ok: false, reason: "写入音色后存档失败，已回滚音色以保护存档", rolledBack: true };
    }
    return { ok: true, stored: "localstorage" };
}

/** 删除音色（两处都删，幂等） */
export async function deleteVoice(slot: number = currentSlot): Promise<void> {
    if (await backend.available()) {
        try {
            await backend.remove(slot);
        } catch {
            /* 忽略：下面还会清 localStorage */
        }
    }
    try {
        localStorage.removeItem(slotKey(KEY_PREFIX.ttsVoice, slot));
    } catch {
        /* ignore */
    }
}

// ============ 旧数据迁移（fail-safe） ============

export type MigrateVoiceStatus =
    | "nothing-to-migrate"
    | "idb-unavailable"
    | "already-migrated"
    | "migrated"
    | "write-failed"
    | "verify-failed";

export interface MigrateVoiceResult {
    status: MigrateVoiceStatus;
    slot: number;
    error?: string;
}

/**
 * 把某个槽位的音色从 localStorage 迁移到 IndexedDB。
 *
 * **核心不变量：只有在新位置写入成功且读回一致之后，才删除旧数据。**
 * 任何失败路径都不删 —— 旧数据始终是最后一份可靠副本。
 *
 * 幂等：重复调用安全。
 */
export async function migrateVoiceFromLocalStorage(slot: number = currentSlot): Promise<MigrateVoiceResult> {
    const legacyKey = slotKey(KEY_PREFIX.ttsVoice, slot);
    let legacy: string | null = null;
    try {
        legacy = localStorage.getItem(legacyKey);
    } catch {
        return { status: "nothing-to-migrate", slot };
    }

    if (!(await backend.available())) return { status: "idb-unavailable", slot };

    // ① 旧数据不存在：确认新位置是否已有（可能是重复调用）
    if (legacy === null) {
        try {
            const existing = await backend.get(slot);
            return { status: existing ? "already-migrated" : "nothing-to-migrate", slot };
        } catch {
            return { status: "nothing-to-migrate", slot };
        }
    }

    // ② 新位置已有**相同**数据 → 迁移其实已完成，直接清旧数据即可
    try {
        const existing = await backend.get(slot);
        if (existing?.data === legacy) {
            localStorage.removeItem(legacyKey);
            return { status: "already-migrated", slot };
        }
    } catch {
        /* 读不到就继续走正常写入流程 */
    }

    // ③ 写入 IndexedDB（失败 → 什么都不删）
    const described = describeVoiceData(legacy);
    try {
        await backend.put({
            slot,
            data: legacy,
            meta: { ...described, savedAt: Date.now(), source: "migrated-from-localstorage" },
        });
    } catch (e) {
        return { status: "write-failed", slot, error: (e as Error)?.message ?? "未知" };
    }

    // ④ 读回校验（不一致 → 同样不删）
    try {
        const verify = await backend.get(slot);
        if (verify?.data !== legacy) return { status: "verify-failed", slot };
    } catch {
        return { status: "verify-failed", slot };
    }

    // ⑤ 双重确认成功 → 才删除旧数据
    try {
        localStorage.removeItem(legacyKey);
    } catch {
        /* 删不掉不影响正确性（readVoice 会优先命中 IDB） */
    }
    return { status: "migrated", slot };
}

/** 批量迁移（菜单页初始化时用；单个失败不影响其它槽位） */
export async function migrateAllVoices(slots: readonly number[]): Promise<MigrateVoiceResult[]> {
    const out: MigrateVoiceResult[] = [];
    for (const slot of slots) {
        out.push(await migrateVoiceFromLocalStorage(slot));
    }
    return out;
}
