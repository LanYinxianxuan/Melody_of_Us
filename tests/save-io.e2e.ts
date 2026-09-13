// save-io.e2e.ts —— P0-12 步骤 3+4 回归：导出 / 导入（四阶段 + 原子提交 + 回滚）
//
// 宿主页：tests/storage.html（极简页）；夹具：tests/scenarios.js
//
// 重点验证：
//   · 导出**不含** API Key / TTS Key / 音色（G4）
//   · 导入四阶段：parse / validate / migrate / commit，任一失败都不破坏当前存档
//   · commit 是原子的：写入中途失败必须回滚到导入前的状态（混合档是最危险的结果）
//   · 导入文件必须带版本信息，且 bundle.version 与 state.version 必须一致

import { exportSlot, exportSlotToJson, importSave, isImportFailure, isExportFailure, SAVE_BUNDLE_FORMAT } from "../playground/save-io";
import { SAVE_KEY, CHAR_KEY, readSlotState, loadState } from "../playground/storage";
import { e2eCheck, e2eLog, e2eParams, e2eRun } from "./e2e-assert";

const scenario = e2eParams().get("scenario") ?? "";
const rawSlot1State = localStorage.getItem("melai-state-1");
const rawSlot1Char = localStorage.getItem("melai-character-1");
const rawSlot3State = localStorage.getItem("melai-state-3");
const rawSlot3Char = localStorage.getItem("melai-character-3");

/** 构造一个可导入的 bundle（基于当前 slot1 的存档） */
function makeBundle(over: Record<string, unknown> = {}): string {
    const read = readSlotState(1);
    if (read.status !== "ok") throw new Error("slot1 无可用存档，无法构造 bundle");
    return JSON.stringify({
        format: SAVE_BUNDLE_FORMAT,
        version: read.state.version,
        exportedAt: Date.now(),
        slot: 1,
        character: { name: "导入角色", age: "1", appearance: "", personality: "", background: "", speechStyle: "", likes: "", dislikes: "", relation: "", secrets: "" },
        state: read.state,
        summary: {},
        ...over,
    });
}

await e2eRun(() => {
    e2eLog(`scenario=${scenario}`);
    loadState(); // 建立 baseline（并让只读状态对当前槽位生效）

    // =====================================================================
    if (scenario === "export") {
        // ---------- 导出 ----------
        const res = exportSlot(1);
        e2eCheck("导出成功", res.ok === true, JSON.stringify(res).slice(0, 160));
        if (res.ok) {
            const b = res.bundle;
            e2eCheck("格式标识正确", b.format === SAVE_BUNDLE_FORMAT, b.format);
            e2eCheck("带版本号", b.version === 1, `${b.version}`);
            e2eCheck("state.version 与 bundle.version 一致", b.state.version === b.version);
            e2eCheck("含角色卡", b.character.name === "林晚秋", b.character.name);
            e2eCheck("摘要含角色名", b.summary.characterName === "林晚秋", b.summary.characterName);
            e2eCheck("摘要含天数", b.summary.dayIndex === 8, `${b.summary.dayIndex}`);
            e2eCheck("摘要含好感", b.summary.affection === 55, `${b.summary.affection}`);
            e2eCheck("存档核心字段完整", b.state.turnCount === 42 && b.state.memories.length === 2);
            e2eCheck("场景保留", b.state.scene.place === "咖啡店", b.state.scene.place);
            e2eCheck("aiState 38 维", Object.keys(b.state.aiState).length === 38);

            // ---------- G4：导出不得包含敏感数据 ----------
            const json = JSON.stringify(b);
            e2eCheck("【G4】导出不含 apikey", !json.includes("apikey"));
            e2eCheck("【G4】导出不含 API Key 值", !json.includes("sk-"));
            e2eCheck("【G4】导出不含 TTS 音色字段", !json.includes("melai-tts-voice") && !json.includes("voiceBase64"));
            e2eCheck("【G4】导出不含 TTS Key 字段", !json.includes("melai-tts-apikey"));
            e2eCheck("【G4】导出不含 provider/model 设置", !json.includes('"provider"') && !json.includes('"custom-url"'));
            e2eCheck("【G4】导出不含任何 base64 大字段", !/"data:audio/.test(json));

            const toJson = exportSlotToJson(1);
            e2eCheck("导出为 JSON 文本成功", toJson.ok === true);
            e2eCheck("文件名含角色名", toJson.ok === true && toJson.filename.includes("林晚秋"), toJson.ok ? toJson.filename : "");
            e2eCheck("JSON 可被重新解析", toJson.ok === true && JSON.parse(toJson.json).format === SAVE_BUNDLE_FORMAT);
        }

        // ---------- 导入到空槽位 ----------
        const before = { s3: localStorage.getItem("melai-state-3") };
        const imp = importSave(makeBundle(), 3);
        e2eCheck("导入到空槽位成功", imp.ok === true, JSON.stringify(imp).slice(0, 200));
        e2eCheck("导入前槽位 3 是空的", before.s3 === null);
        e2eCheck("导入后槽位 3 有存档", localStorage.getItem("melai-state-3") !== null);
        e2eCheck("导入后槽位 3 有角色卡", localStorage.getItem("melai-character-3") !== null);

        const read3 = readSlotState(3);
        e2eCheck("导入内容可被契约读出", read3.status === "ok", JSON.stringify(read3).slice(0, 160));
        if (read3.status === "ok") {
            e2eCheck("导入后 turnCount 保留", read3.state.turnCount === 42, `${read3.state.turnCount}`);
            e2eCheck("导入后 version 为当前版本", read3.state.version === 1);
            e2eCheck("导入后场景保留", read3.state.scene.place === "咖啡店");
        }
        e2eCheck("导入不会影响源槽位 1", localStorage.getItem("melai-state-1") === rawSlot1State);

        // =================================================================
    } else if (scenario === "import-reject") {
        // ---------- 各类非法输入必须被拒绝，且不破坏现有存档 ----------
        const cases: { name: string; text: string; stage: string }[] = [
            { name: "非 JSON", text: "这不是 json", stage: "parse" },
            { name: "顶层是数组", text: "[1,2,3]", stage: "parse" },
            { name: "顶层是字符串", text: '"hello"', stage: "parse" },
            { name: "bundle 缺 version", text: makeBundle({ version: undefined }), stage: "validate" },
            { name: "bundle 缺 state", text: makeBundle({ state: undefined }), stage: "validate" },
            { name: "state 缺 version", text: makeBundle({ state: {} }), stage: "validate" },
            { name: "版本不一致", text: makeBundle({ version: 2 }), stage: "validate" },
            { name: "未知高版本", text: makeBundle({ version: 99, state: { aiState: {}, version: 99 } }), stage: "migrate" },
            { name: "缺 aiState", text: JSON.stringify({ aiState: undefined, version: 1 }), stage: "migrate" },
        ];

        for (const c of cases) {
            const r = importSave(c.text, 1);
            e2eLog(`  ${c.name} → ok=${r.ok} stage=${isImportFailure(r) ? r.stage : "-"}`);
            e2eCheck(`${c.name}：被拒绝`, r.ok === false, JSON.stringify(r).slice(0, 140));
            e2eCheck(`${c.name}：阶段正确（${c.stage}）`, isImportFailure(r) && r.stage === c.stage, isImportFailure(r) ? r.stage : "-");
            e2eCheck(`${c.name}：原存档字节级未变`, localStorage.getItem("melai-state-1") === rawSlot1State);
            e2eCheck(`${c.name}：原角色卡字节级未变`, localStorage.getItem("melai-character-1") === rawSlot1Char);
        }

        // ---------- 合法裸存档（不带 bundle 外壳）也应可导入 ----------
        const read = readSlotState(1);
        if (read.status === "ok") {
            const bare = importSave(JSON.stringify(read.state), 4);
            e2eCheck("裸 SaveV1 存档可导入（便于手工恢复）", bare.ok === true, JSON.stringify(bare).slice(0, 160));
        }

        // =================================================================
    } else if (scenario === "commit-rollback") {
        // ---------- 【核心】commit 阶段失败必须回滚 ----------
        // 先给槽位 3 造一份"导入前"的数据，以便验证回滚能还原它
        const seed = importSave(makeBundle(), 3);
        e2eCheck("准备：槽位 3 已有数据", seed.ok === true, JSON.stringify(seed).slice(0, 140));
        const slot3StateBefore = localStorage.getItem("melai-state-3");
        const slot3CharBefore = localStorage.getItem("melai-character-3");
        e2eLog(`准备完成：state=${slot3StateBefore?.length}B char=${slot3CharBefore?.length}B`);

        const proto = Object.getPrototypeOf(localStorage) as Storage;
        const originalSetItem = proto.setItem;
        const STATE3 = "melai-state-3";
        const CHAR3 = "melai-character-3";

        // 场景 A：存档写入失败 → 角色卡写入已成功，必须被回滚
        proto.setItem = function (k: string, v: string) {
            if (k === STATE3) {
                const err = new Error("The quota has been exceeded.");
                err.name = "QuotaExceededError";
                throw err;
            }
            return originalSetItem.call(this, k, v);
        };
        const rA = importSave(makeBundle({ character: { name: "回滚角色A" } }), 3);
        proto.setItem = originalSetItem;

        e2eLog(`场景 A（存档写入失败）→ ok=${rA.ok} stage=${isImportFailure(rA) ? rA.stage : "-"}`);
        e2eCheck("【核心】写入存档失败时导入返回失败", rA.ok === false, JSON.stringify(rA).slice(0, 160));
        e2eCheck("【核心】失败阶段为 commit", isImportFailure(rA) && rA.stage === "commit", isImportFailure(rA) ? rA.stage : "-");
        e2eCheck(
            "【核心】角色卡被回滚（不留「新角色+旧进度」混合档）",
            localStorage.getItem(CHAR3) === slot3CharBefore,
            `now=${localStorage.getItem(CHAR3)?.slice(0, 40)}`,
        );
        e2eCheck("【核心】存档保持导入前内容", localStorage.getItem(STATE3) === slot3StateBefore);

        // 场景 B：角色卡写入失败 → 存档都不该被写
        proto.setItem = function (k: string, v: string) {
            if (k === CHAR3) {
                const err = new Error("The quota has been exceeded.");
                err.name = "QuotaExceededError";
                throw err;
            }
            return originalSetItem.call(this, k, v);
        };
        const rB = importSave(makeBundle(), 3);
        proto.setItem = originalSetItem;

        e2eLog(`场景 B（角色卡写入失败）→ ok=${rB.ok} stage=${isImportFailure(rB) ? rB.stage : "-"}`);
        e2eCheck("【核心】角色卡写入失败时导入返回失败", rB.ok === false);
        e2eCheck("【核心】失败阶段为 commit", isImportFailure(rB) && rB.stage === "commit", isImportFailure(rB) ? rB.stage : "-");
        e2eCheck("【核心】存档未被改动", localStorage.getItem(STATE3) === slot3StateBefore);
        e2eCheck("【核心】角色卡未被改动", localStorage.getItem(CHAR3) === slot3CharBefore);

        // 场景 C：恢复后导入必须成功（确认回滚没有留下坏状态）
        const rC = importSave(makeBundle({ character: { name: "回滚角色C" } }), 3);
        e2eCheck("恢复后导入成功", rC.ok === true, JSON.stringify(rC).slice(0, 160));
        e2eCheck("恢复后角色卡已更新", (localStorage.getItem(CHAR3) ?? "").includes("回滚角色C"));

        // ---------- 不影响其它槽位 ----------
        e2eCheck("回滚过程未触碰槽位 1", localStorage.getItem("melai-state-1") === rawSlot1State);

        // =================================================================
    } else if (scenario === "corrupt-json") {
        // ---------- 损坏的源存档不可导出（但也不能被破坏） ----------
        const res = exportSlot(1);
        e2eLog(`损坏源导出 → ok=${res.ok} reason=${isExportFailure(res) ? res.reason : "-"}`);
        e2eCheck("损坏源存档导出被拒绝", res.ok === false, JSON.stringify(res).slice(0, 160));
        e2eCheck("拒绝原因可诊断", isExportFailure(res) && res.reason.length > 0);
        e2eCheck("损坏数据未被导出过程改动", localStorage.getItem("melai-state-1") === rawSlot1State);

        const toJson = exportSlotToJson(1);
        e2eCheck("导出为 JSON 同样被拒绝", toJson.ok === false);

        // 空槽位导出
        const empty = exportSlot(5);
        e2eCheck("空槽位导出被拒绝并说明原因", isExportFailure(empty) && empty.reason.includes("空"), isExportFailure(empty) ? empty.reason : "-");
    } else {
        e2eCheck(`未知 scenario: ${scenario}`, false);
    }

    // 公共：不得破坏本次测试未主动改动的槽位。
    // 例外：export 场景会**故意**把数据导入槽位 3，commit-rollback 也会写槽位 3。
    const touchesSlot3 = scenario === "export" || scenario === "commit-rollback";
    e2eCheck("槽位 1 存档未被本次测试改动", localStorage.getItem("melai-state-1") === rawSlot1State);
    e2eCheck("槽位 1 角色卡未被本次测试改动", localStorage.getItem("melai-character-1") === rawSlot1Char);
    if (!touchesSlot3) {
        e2eCheck("槽位 3 保持原样（本场景不涉及它）", localStorage.getItem("melai-state-3") === rawSlot3State);
        e2eCheck("槽位 3 角色卡保持原样（本场景不涉及它）", localStorage.getItem("melai-character-3") === rawSlot3Char);
    }
    e2eLog(`SAVE_KEY=${SAVE_KEY} CHAR_KEY=${CHAR_KEY}`);
});
