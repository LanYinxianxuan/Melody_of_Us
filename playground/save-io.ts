// save-io.ts —— 【P0-12】存档导出 / 导入（四阶段 + 原子提交 + 失败回滚）
//
// 设计要点（对应 P0-12_plan.md §B.6）：
//   · 导出：**不含** API Key / TTS Key / 音色 base64（G4 已确认）—— 只导出世界状态 + 角色卡；
//   · 导入四阶段：parse → validate → migrate → commit，任一步失败都不触碰现有存档；
//   · commit 是**一次事务式**写入：先备份原始字符串，任一写入失败即回滚（storage.commitSlotState）；
//   · 导入文件必须带版本信息：`bundle.version` 与 `state.version` 都要校验且必须一致。
//
// 本模块放在数据层：它需要 storage（读写）与 character（角色卡形状），
// 但 **storage 不反向依赖它**（storage 只提供原语），因此不会形成循环。

import {
    commitSlotState,
    readSlotState,
    isLoadReadOnly,
    getLastLoadOutcome,
    slotKey,
    KEY_PREFIX,
    type LoadOutcome,
} from "./storage";
import { migrateToCurrent, SAVE_VERSION, type SaveV1 } from "./save-schema";
import { emptyCharacter, type CharacterProfile } from "./character";

/** 导出文件的格式标识（用于导入时识别） */
export const SAVE_BUNDLE_FORMAT = "melody-of-us.save";

export interface SaveBundleSummary {
    characterName: string;
    dayIndex: number;
    affection: number;
    npcCount: number;
    chatTurns: number;
    exportedFromSlot: number;
}

export interface SaveBundle {
    /** 固定标识，导入时校验 */
    format: typeof SAVE_BUNDLE_FORMAT;
    /** 与 state.version 一致 */
    version: number;
    exportedAt: number;
    /** 导出时的槽位（仅供参考，导入可重定向到其它槽位） */
    slot: number;
    character: CharacterProfile;
    state: SaveV1;
    summary: SaveBundleSummary;
}

export type ExportFailure = { ok: false; reason: string };
export type ExportSuccess = { ok: true; bundle: SaveBundle };

export type ExportResult = ExportSuccess | ExportFailure;

/** 类型守卫（同上：跨模块消费联合类型时更可靠） */
export function isExportFailure(r: ExportResult): r is ExportFailure {
    return r.ok === false;
}

export type ImportStage = "parse" | "validate" | "migrate" | "commit";

export type ImportFailure = { ok: false; stage: ImportStage; reason: string };
export type ImportSuccess = { ok: true; applied: SaveBundleSummary & { slot: number } };

export type ImportResult = ImportSuccess | ImportFailure;

/** 类型守卫：TS 在跨模块消费这个联合时不会自动收窄，显式守卫更可靠也更好用 */
export function isImportFailure(r: ImportResult): r is ImportFailure {
    return r.ok === false;
}

// ============ 导出 ============

/**
 * 导出指定槽位（默认当前槽位）。
 *
 * 角色卡从 `melai-character-{slot}` 读取；存档经 readSlotState 归一化为当前版本，
 * 因此导出的文件永远是"可被当前及未来版本导入"的规范形状。
 */
export function exportSlot(slot: number): ExportResult {
    const read = readSlotState(slot);
    if (read.status === "empty") {
        return { ok: false, reason: `存档 ${slot} 是空的，没有可导出的内容` };
    }
    if (read.status === "unusable") {
        return { ok: false, reason: `存档 ${slot} 无法读出：${read.reason}` };
    }

    const character = readCharacterForSlot(slot);
    const state = read.state;

    const bundle: SaveBundle = {
        format: SAVE_BUNDLE_FORMAT,
        version: state.version,
        exportedAt: Date.now(),
        slot,
        character,
        state,
        summary: summarize(state, character, slot),
    };
    return { ok: true, bundle };
}

/** 导出为可直接下载的 JSON 文本（缩进 2 空格，便于人工查看与排错） */
export function exportSlotToJson(slot: number): { ok: true; json: string; filename: string } | { ok: false; reason: string } {
    const result = exportSlot(slot);
    if (result.ok === false) return result;
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const safeName = (result.bundle.summary.characterName || "未命名").replace(/[\\/:*?"<>|\s]/g, "_");
    return {
        ok: true,
        json: JSON.stringify(result.bundle, null, 2),
        filename: `melody-save-${safeName}-${stamp}.json`,
    };
}

function summarize(state: SaveV1, character: CharacterProfile, slot: number): SaveBundleSummary {
    return {
        characterName: character.name || "未命名",
        dayIndex: state.dayIndex,
        affection: Math.round(state.aiState.affection ?? 0),
        npcCount: Object.keys(state.npcs).length,
        chatTurns: state.chatHistory.length,
        exportedFromSlot: slot,
    };
}

/** 读取任意槽位的角色卡（复用 character 的空模板语义，避免污染） */
function readCharacterForSlot(slot: number): CharacterProfile {
    try {
        const raw = localStorage.getItem(slotKey(KEY_PREFIX.character, slot));
        if (!raw) return emptyCharacter();
        const data = JSON.parse(raw);
        const c: CharacterProfile = { ...emptyCharacter(), ...data };
        delete (c as { scene?: unknown }).scene; // 与 loadCharacter 的约定一致：角色卡不含 scene
        return c;
    } catch {
        return emptyCharacter();
    }
}

// ============ 导入 ============

/**
 * 导入存档（四阶段）。
 *
 * 阶段 ①parse：解析 JSON，识别两种输入形状（SaveBundle / 裸 SaveV1）
 * 阶段 ②validate：格式标识 + 版本存在性 + 版本一致性 + 必需字段
 * 阶段 ③migrate：把存档迁移到当前版本（复用 save-schema 的迁移链）
 * 阶段 ④commit：事务式写入（失败自动回滚）
 *
 * **任何一步失败都不会修改现有存档**（不改内存、不写 localStorage）。
 */
export function importSave(text: string, targetSlot: number): ImportResult {
    // ---------- ① parse ----------
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (e) {
        return { ok: false, stage: "parse", reason: `不是合法的 JSON：${(e as Error)?.message ?? "未知"}` };
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return { ok: false, stage: "parse", reason: "顶层结构必须是对象" };
    }

    const obj = parsed as Record<string, unknown>;
    const isBundle = obj.format === SAVE_BUNDLE_FORMAT;
    // 裸存档（直接放一份 melai-state 的内容）也允许导入，便于手工恢复
    const rawState = isBundle ? obj.state : obj;
    const rawCharacter = isBundle ? obj.character : undefined;

    // ---------- ② validate ----------
    if (isBundle) {
        if (typeof obj.version !== "number" || !Number.isInteger(obj.version)) {
            return { ok: false, stage: "validate", reason: "导出文件缺少合法的 version 字段" };
        }
        if (typeof rawState !== "object" || rawState === null) {
            return { ok: false, stage: "validate", reason: "导出文件缺少 state 字段" };
        }
        const stateVersion = (rawState as Record<string, unknown>).version;
        if (stateVersion === undefined) {
            return { ok: false, stage: "validate", reason: "state 缺少 version 字段（导入文件必须带版本信息）" };
        }
        if (stateVersion !== obj.version) {
            return {
                ok: false,
                stage: "validate",
                reason: `版本不一致：文件 version=${obj.version}，state.version=${String(stateVersion)}`,
            };
        }
    }
    if (typeof rawState !== "object" || rawState === null) {
        return { ok: false, stage: "validate", reason: "找不到可导入的存档内容" };
    }

    // ---------- ③ migrate ----------
    const migrated = migrateToCurrent(rawState);
    if (migrated.ok === false) {
        if (migrated.kind === "future-version") {
            return {
                ok: false,
                stage: "migrate",
                reason: `存档来自更新的版本（version ${migrated.version}），当前版本无法导入`,
            };
        }
        const reason =
            migrated.kind === "invalid-version"
                ? `版本号非法：${JSON.stringify(migrated.raw)}`
                : migrated.kind === "migration-failed"
                  ? `迁移失败：${migrated.error}`
                  : `存档结构不完整：${migrated.reason}`;
        return { ok: false, stage: "migrate", reason };
    }

    // 角色卡：以空模板为底，只填导入文件里给的字段（与 loadCharacter 同语义）
    const character: CharacterProfile =
        rawCharacter && typeof rawCharacter === "object" && !Array.isArray(rawCharacter)
            ? { ...emptyCharacter(), ...(rawCharacter as Partial<CharacterProfile>) }
            : emptyCharacter();
    delete (character as { scene?: unknown }).scene;

    // ---------- ④ commit（事务 + 回滚） ----------
    // 写回时把版本改为当前版本（migrateToCurrent 已保证），并以紧凑格式写入
    const stateToWrite: SaveV1 = { ...migrated.state, version: SAVE_VERSION, savedAt: Date.now() };
    const commit = commitSlotState(targetSlot, JSON.stringify(stateToWrite), JSON.stringify(character));
    if (commit.ok === false) {
        return {
            ok: false,
            stage: "commit",
            reason:
                commit.stage === "state"
                    ? `写入存档失败（已回滚）：${(commit.error as Error)?.message ?? "未知"}`
                    : `写入角色卡失败（已回滚）：${(commit.error as Error)?.message ?? "未知"}`,
        };
    }

    return {
        ok: true,
        applied: { ...summarize(stateToWrite, character, targetSlot), slot: targetSlot },
    };
}

// ============ 与内存状态的衔接 ============

/**
 * 判断导入后是否需要刷新页面。
 *
 * 导入总是写到 `targetSlot`。若 targetSlot === 当前槽位，内存中的 store / aiState /
 * CHARACTER 仍是旧值 —— 最省事且最安全的做法是让调用方提示用户刷新（而不是在这里
 * 悄悄改内存，那会绕过 contract 校验路径，也容易与正在进行的对话产生竞态）。
 */
export function shouldReloadAfterImport(targetSlot: number, activeSlot: number): boolean {
    return targetSlot === activeSlot;
}

/**
 * 当前槽位是否处于「不可写」状态（损坏 / 未知版本 / 读取失败）。
 * 供 UI 决定是否禁用保存类操作。
 */
export function currentSlotIsReadOnly(outcome?: LoadOutcome | null): boolean {
    const o = outcome ?? getLastLoadOutcome();
    return o !== null && isLoadReadOnly(o);
}
