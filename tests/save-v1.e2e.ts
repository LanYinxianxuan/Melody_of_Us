// save-v1.e2e.ts —— P0-12 步骤 2 回归：loadState 的 SaveV1 加载契约
//
// 宿主页：tests/storage.html（极简页，避开 chat.ts 的模块级副作用）
// 夹具：tests/scenarios.js 按 ?scenario= 在模块加载**之前**写入 localStorage
//
// 被修复的缺陷（D4）：原 `loadState(): boolean` 把"没有存档"和"存档损坏"都返回 false，
// 调用方一律当成新游戏 → 后续任何 saveState 都会把那份损坏（但可能可修复）的数据永久覆盖。
// 现在 loadState 返回可诊断的 LoadOutcome，损坏/未知高版本进入**只读**状态并拒绝写回。

import {
    loadState,
    saveState,
    isLoadReadOnly,
    getLastLoadOutcome,
    SAVE_KEY,
    CHAR_KEY,
    SAVE_VERSION,
    store,
} from "../playground/storage";
import { aiState } from "../playground/state";
import { loadCharacter } from "../playground/character";
import { e2eCheck, e2eLog, e2eParams, e2eRun } from "./e2e-assert";

const scenario = e2eParams().get("scenario") ?? "";
const rawBefore = localStorage.getItem(SAVE_KEY);

await e2eRun(() => {
    const outcome = loadState();
    e2eLog(`scenario=${scenario}  status=${outcome.status}`);

    // =====================================================================
    if (scenario === "real-v0") {
        e2eCheck("标准 V0 存档加载成功", outcome.status === "loaded", JSON.stringify(outcome));
        e2eCheck("识别为 V0（from=0）", outcome.status === "loaded" && outcome.from === 0, JSON.stringify(outcome).slice(0, 120));
        e2eCheck("非只读状态", !isLoadReadOnly(outcome));

        // 字段逐一核对：迁移不得丢失任何既有数据
        e2eCheck("turnCount 保留", store.turnCount === 42, `${store.turnCount}`);
        e2eCheck("storyProgress 保留", store.storyProgress === 35, `${store.storyProgress}`);
        e2eCheck("activeThread 保留", store.activeThread === "一起去书店", `${store.activeThread}`);
        e2eCheck("dayIndex 保留", store.dayIndex === 8, `${store.dayIndex}`);
        e2eCheck("chatHistory 2 条", store.chatHistory.length === 2, `${store.chatHistory.length}`);
        e2eCheck("memories 2 条", store.memories.length === 2, `${store.memories.length}`);
        e2eCheck("journal 保留", store.journal.length === 1);
        e2eCheck("agenda 保留", store.agenda.length === 1 && store.agenda[0]!.items.length === 1);
        e2eCheck(
            "场景保留（未被默认校园覆盖）",
            store.scene.place === "咖啡店" && store.scene.busyLabel === "开店",
            JSON.stringify(store.scene),
        );
        e2eCheck("aiState 已给值保留", aiState.affection === 55, `${aiState.affection}`);
        e2eCheck("aiState 恰好 38 维", Object.keys(aiState).length === 38, `${Object.keys(aiState).length}`);
        e2eCheck("aiState 缺失维回落基线", aiState.trust === 40 && aiState.anger === 0);
        e2eCheck("NPC 世界已重建（2 个）", Object.keys(store.npcs).length === 2, Object.keys(store.npcs).join(","));
        e2eCheck("NPC 使用存档场景重建", Object.values(store.npcs)[0] !== undefined);
        e2eCheck("角色卡可读", loadCharacter().name === "林晚秋", loadCharacter().name);
        e2eCheck("notes 包含 V0 迁移记录", outcome.status === "loaded" && outcome.notes.some((n) => n.includes("V0")));

        // 关键：不能有 npcEnabled / userMind 之类字段变成 undefined
        e2eCheck("userMind 补齐为 14 维", Object.keys(store.userMind).length === 14, `${Object.keys(store.userMind).length}`);
        e2eCheck("aiMind 补齐（lastTopic 保留）", store.aiMind.lastTopic === "书店", `${store.aiMind.lastTopic}`);
        e2eCheck("relMind 保留", store.relMind.tension === 0.12, `${store.relMind.tension}`);

        // =================================================================
    } else if (scenario === "legacy-v0") {
        e2eCheck("早期形状旧档加载成功", outcome.status === "loaded", JSON.stringify(outcome));
        e2eCheck("storyEvents 字符串被转为对象", store.storyEvents.every((e) => typeof e === "object" && "day" in e), JSON.stringify(store.storyEvents));
        e2eCheck("storyEvents 内容不丢", store.storyEvents.length === 2 && store.storyEvents[0]!.text === "旧式事件一");
        e2eCheck("缺失 scene → 默认校园", store.scene.place === "学校", JSON.stringify(store.scene));
        e2eCheck("缺失 mind 三态 → 默认值", store.userMind.happiness === 0.42 && store.aiMind.interest === 0.55);
        e2eCheck("缺失 storyProgress → 0", store.storyProgress === 0);
        e2eCheck("缺失 npcEnabled → false", store.npcEnabled === false);
        e2eCheck("NPC 世界已按默认场景重建", Object.keys(store.npcs).length === 2);
        e2eCheck("非只读（可以继续游玩）", !isLoadReadOnly(outcome));

        // =================================================================
    } else if (scenario === "corrupt-json") {
        e2eCheck("【核心】损坏 JSON → corrupt（不是 empty）", outcome.status === "corrupt", JSON.stringify(outcome));
        e2eCheck("【核心】corrupt 被判定为只读", isLoadReadOnly(outcome));
        e2eCheck("原因可诊断", outcome.status === "corrupt" && outcome.reason.length > 0, JSON.stringify(outcome).slice(0, 160));

        // 【核心】写回必须被拒绝，且原始数据保持字节级不变
        const saveResult = saveState();
        const rawAfter = localStorage.getItem(SAVE_KEY);
        e2eLog(`corrupt 下 saveState()=${saveResult}`);
        e2eCheck("【核心】损坏档下 saveState() 返回 false", saveResult === false, `${saveResult}`);
        e2eCheck("【核心】原始损坏数据未被覆盖（字节级一致）", rawAfter === rawBefore, `before=${rawBefore?.length}B after=${rawAfter?.length}B`);

        // =================================================================
    } else if (scenario === "future-version") {
        e2eCheck("【核心】version 99 → future（不是 empty/corrupt）", outcome.status === "future", JSON.stringify(outcome));
        e2eCheck("【核心】带出实际版本号", outcome.status === "future" && outcome.version === 99, JSON.stringify(outcome));
        e2eCheck("【核心】future 被判定为只读", isLoadReadOnly(outcome));

        const saveResult = saveState();
        const rawAfter = localStorage.getItem(SAVE_KEY);
        e2eCheck("【核心】未知高版本下 saveState() 返回 false", saveResult === false, `${saveResult}`);
        e2eCheck("【核心】高版本存档未被覆盖", rawAfter === rawBefore);
        e2eCheck(
            "【核心】高版本存档仍保留 version:99（未被改写为 1）",
            !!rawAfter && JSON.parse(rawAfter).version === 99,
            rawAfter ? String(JSON.parse(rawAfter).version) : "null",
        );

        // =================================================================
    } else if (scenario === "dirty-fields") {
        e2eCheck("脏档仍能加载（不阻塞启动）", outcome.status === "loaded", JSON.stringify(outcome));
        e2eCheck("【D1】字符串 affection 回落基线而非 NaN", aiState.affection === 25 && Number.isFinite(aiState.affection), `${aiState.affection}`);
        e2eCheck("【D1】null trust 回落基线", aiState.trust === 15, `${aiState.trust}`);
        e2eCheck("【D1】NaN joy 回落基线", Number.isFinite(aiState.joy) && aiState.joy === 40, `${aiState.joy}`);
        e2eCheck("【D1】Infinity sadness 回落基线", Number.isFinite(aiState.sadness) && aiState.sadness === 10, `${aiState.sadness}`);
        e2eCheck("【D2】多余维度未进入 aiState", !("obsolete_dim" in aiState), Object.keys(aiState).join(","));
        e2eCheck("【D2】aiState 恰好 38 维", Object.keys(aiState).length === 38, `${Object.keys(aiState).length}`);
        e2eCheck("【D3】字符串 turnCount 回落 0", store.turnCount === 0, `${store.turnCount}`);
        e2eCheck("【D3】对象 storyProgress 回落 0", store.storyProgress === 0, `${JSON.stringify(store.storyProgress)}`);
        e2eCheck("【D3】字符串 timeRate 回落 1", store.timeRate === 1, `${store.timeRate}`);
        e2eCheck("非数组 memories 回落 []", Array.isArray(store.memories) && store.memories.length === 0);
        e2eCheck("非法 userLocation 回落「家」", store.userLocation === "家", `${store.userLocation}`);
        // 脏档修复后应当可以正常写回，且写回内容合法
        const ok = saveState();
        e2eCheck("脏档修复后可正常写回", ok === true);
        const written = JSON.parse(localStorage.getItem(SAVE_KEY)!);
        e2eCheck("写回内容带 version", written.version === SAVE_VERSION, `${written.version}`);
        e2eCheck("写回内容不再含多余维度", !("obsolete_dim" in written.aiState));
        e2eCheck("写回内容不再含 NaN/Infinity", Object.values(written.aiState).every((v) => typeof v === "number" && Number.isFinite(v)));

        // =================================================================
    } else if (scenario === "only-aistate") {
        e2eCheck("仅含 aiState 也能加载", outcome.status === "loaded", JSON.stringify(outcome));
        const required = [
            "turnCount", "storyEvents", "storyProgress", "chatHistory", "journal", "activeThread",
            "scheduleIndex", "timeRate", "virtualMs", "dayBaseMs", "dayIndex", "memories",
            "lastReplyRealAt", "lastReplyVirtualAt", "lastNeglectAt", "lastNeglectRealAt",
            "lastNeglectLevel", "npcs", "presentNpcs", "npcEnabled", "scene", "agenda",
            "userLocation", "pendingOvernight", "userMind", "aiMind", "relMind", "lastAgentVirtualAt",
        ];
        const missing = required.filter((k) => (store as Record<string, unknown>)[k] === undefined);
        e2eCheck("27 个 store 字段全部就位（无 undefined）", missing.length === 0, missing.join(","));
        e2eCheck("aiState 已给值保留（77，区别于基线 25）", aiState.affection === 77, `${aiState.affection}`);

        // =================================================================
    } else if (scenario === "empty") {
        e2eCheck("无存档 → empty（新游戏）", outcome.status === "empty", JSON.stringify(outcome));
        e2eCheck("empty 不是只读（允许开新档写入）", !isLoadReadOnly(outcome));
        const ok = saveState();
        e2eCheck("新档可以正常写回", ok === true);
        const written = JSON.parse(localStorage.getItem(SAVE_KEY)!);
        e2eCheck("新档写回带 version:1", written.version === 1, `${written.version}`);
        e2eCheck("新档写回含 38 维 aiState", Object.keys(written.aiState).length === 38);

        // =================================================================
    } else if (scenario === "missing-aistate") {
        e2eCheck("缺 aiState → corrupt（非本应用存档）", outcome.status === "corrupt", JSON.stringify(outcome));
        e2eCheck("被判定为只读", isLoadReadOnly(outcome));
        e2eCheck("原因包含结构不完整", outcome.status === "corrupt" && outcome.reason.includes("aiState"), JSON.stringify(outcome).slice(0, 160));
        const saveResult = saveState();
        e2eCheck("只读下拒绝写回", saveResult === false);
        e2eCheck("原始数据未被覆盖", localStorage.getItem(SAVE_KEY) === rawBefore);

        // =================================================================
    } else {
        e2eCheck(`未知 scenario: ${scenario}`, false);
    }

    // 公共：确认 CHAR_KEY 常量与实际使用一致
    e2eLog(`SAVE_KEY=${SAVE_KEY} CHAR_KEY=${CHAR_KEY}`);
    e2eCheck("SAVE_KEY 与槽位一致", SAVE_KEY === "melai-state-1", SAVE_KEY);
    e2eCheck("CHAR_KEY 与槽位一致", CHAR_KEY === "melai-character-1", CHAR_KEY);
    e2eCheck("getLastLoadOutcome 可读", getLastLoadOutcome() !== null);
});
