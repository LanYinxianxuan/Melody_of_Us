// tts-scope.e2e.ts —— 【P0-13 / G6】TTS 键作用域回归
//
// 本套件由子代理审计发现的真实缺陷驱动：
//   tts.ts 的槽位来自 storage 的**冻结值**。菜单页是"一页多槽"——
//   点存档 5 的「API 设置」后切到槽位 5 写 TTS 设置，但冻结值仍是 1，
//   于是面板写着"存档 5"，音色/专用 Key/风格/语言/开关却全部写进了 *-1。
//   259 条既有断言没有覆盖到，因为它需要"同一页面内切换槽位"这一菜单页专有行为。
//
// 覆盖两条路径：
//   ① 显式传 slot 的访问器（菜单页用法）—— 键必须落在传入的槽位上
//   ② 默认参数（chat 页用法）—— 必须落在页面冻结槽位
//   同时验证 G6 的旧全局键一次性迁移。

import {
    getVoiceBase64,
    setVoiceBase64,
    clearVoice,
    getTtsStyle,
    setTtsStyle,
    getTtsApiKey,
    setTtsApiKey,
    getTtsLang,
    setTtsLang,
    isTtsEnabledForSlot,
    setTtsEnabled,
    migrateTtsEnabledScope,
} from "../playground/tts";
import { currentSlot, slotKey, KEY_PREFIX } from "../playground/storage";
import { isIndexedDbAvailable } from "../playground/voice-store";
import { e2eCheck, e2eLog, e2eParams, e2eRun } from "./e2e-assert";

const scenario = e2eParams().get("scenario") ?? "";
const read = (prefix: string, slot: number) => localStorage.getItem(slotKey(prefix, slot));

await e2eRun(async () => {
    e2eLog(`scenario=${scenario} 页面冻结槽位=${currentSlot}`);
    // 音色读写现在经 voice-store（IndexedDB 优先）。先等探测有结论，
    // 否则在"IDB 后端无响应"的环境里，随后的读断言会在探测超时前执行而读到 null。
    const idbOk = await isIndexedDbAvailable();
    e2eLog(`IndexedDB 可用=${idbOk}${idbOk ? "" : "（读回将走 localStorage 回退）"}`);

    if (scenario === "explicit-slot") {
        // ---------- ① 显式 slot：模拟菜单页为"另一个槽位"写设置 ----------
        const target = 5;
        e2eCheck("页面冻结槽位是 1（测试前提）", currentSlot === 1, `${currentSlot}`);

        setTtsApiKey("tts-key-for-slot-5", target);
        await setVoiceBase64("data:audio/mpeg;base64,AAAA", target);
        setTtsStyle("温柔轻声", target);
        setTtsLang("ja", target);
        setTtsEnabled(true, target);

        e2eCheck("【核心】TTS 专用 Key 写入目标槽位 5", read(KEY_PREFIX.ttsApiKey, 5) === "tts-key-for-slot-5", `${read(KEY_PREFIX.ttsApiKey, 5)}`);
        e2eCheck("【核心】音色写入目标槽位 5", read(KEY_PREFIX.ttsVoice, 5) === "data:audio/mpeg;base64,AAAA");
        e2eCheck("【核心】风格写入目标槽位 5", read(KEY_PREFIX.ttsStyle, 5) === "温柔轻声");
        e2eCheck("【核心】语言写入目标槽位 5", read(KEY_PREFIX.ttsLang, 5) === "ja");
        e2eCheck("【核心】开关写入目标槽位 5", read(KEY_PREFIX.ttsEnabled, 5) === "true");

        // ---------- ② 绝不能污染页面冻结槽位（这正是修复前的错误行为） ----------
        e2eCheck("【核心】槽位 1 的 TTS Key 未被污染", read(KEY_PREFIX.ttsApiKey, 1) === null, `${read(KEY_PREFIX.ttsApiKey, 1)}`);
        e2eCheck("【核心】槽位 1 的音色未被污染", read(KEY_PREFIX.ttsVoice, 1) === null, `${read(KEY_PREFIX.ttsVoice, 1)}`);
        e2eCheck("【核心】槽位 1 的风格未被污染", read(KEY_PREFIX.ttsStyle, 1) === null);
        e2eCheck("【核心】槽位 1 的语言未被污染", read(KEY_PREFIX.ttsLang, 1) === null);
        e2eCheck("【核心】槽位 1 的开关未被污染", read(KEY_PREFIX.ttsEnabled, 1) === null);

        // ---------- ③ 读回一致 ----------
        e2eCheck("读回槽位 5 的 Key", getTtsApiKey(5) === "tts-key-for-slot-5");
        e2eCheck("读回槽位 5 的语言", getTtsLang(5) === "ja");
        e2eCheck("读回槽位 5 的音色", (await getVoiceBase64(5)) !== null);
        e2eCheck("槽位 1 仍为空（读到 null）", (await getVoiceBase64(1)) === null, `${await getVoiceBase64(1)}`);
        e2eCheck("isTtsEnabledForSlot(5)=true", isTtsEnabledForSlot(5) === true);
        e2eCheck("isTtsEnabledForSlot(1)=false", isTtsEnabledForSlot(1) === false);

        // ---------- ④ 清除也只影响目标槽位 ----------
        await clearVoice(5);
        e2eCheck("清除槽位 5 音色后为空", read(KEY_PREFIX.ttsVoice, 5) === null);

        // ---------- ⑤ 默认参数 = 页面冻结槽位（chat 页用法） ----------
        setTtsStyle("默认槽位风格");
        e2eCheck("【核心】不传 slot 时写入页面冻结槽位（1）", read(KEY_PREFIX.ttsStyle, 1) === "默认槽位风格", `${read(KEY_PREFIX.ttsStyle, 1)}`);
        e2eCheck("不传 slot 时不会写到槽位 5", read(KEY_PREFIX.ttsStyle, 5) === "温柔轻声", `${read(KEY_PREFIX.ttsStyle, 5)}`);

    } else if (scenario === "legacy-migration") {
        // ---------- G6 旧全局开关的一次性迁移 ----------
        e2eLog(`迁移前：全局键=${localStorage.getItem("melai-tts-enabled")}`);
        e2eCheck("准备：旧全局键存在且为 true", localStorage.getItem("melai-tts-enabled") === "true");

        const res = migrateTtsEnabledScope([1, 2, 3, 4, 5]);
        e2eLog(`迁移结果：migrated=${res.migrated} appliedTo=${res.appliedTo.join(",")}`);

        e2eCheck("迁移执行成功", res.migrated === true);
        e2eCheck("旧全局键已删除（不再有孤儿键）", localStorage.getItem("melai-tts-enabled") === null);
        for (const slot of [1, 2, 3, 4, 5]) {
            e2eCheck(`槽位 ${slot} 继承了旧开关`, read(KEY_PREFIX.ttsEnabled, slot) === "true", `${read(KEY_PREFIX.ttsEnabled, slot)}`);
        }
        e2eCheck("迁移后各槽位可独立读取", isTtsEnabledForSlot(3) === true);

        // 幂等：再调一次不应报错、也不应复活旧键
        const again = migrateTtsEnabledScope([1, 2, 3, 4, 5]);
        e2eCheck("重复迁移幂等（旧键不存在 → 不动）", again.migrated === false);
        e2eCheck("重复迁移不会复活旧键", localStorage.getItem("melai-tts-enabled") === null);

        // 用户已单独设置过的槽位不被覆盖
        localStorage.setItem(slotKey(KEY_PREFIX.ttsEnabled, 2), "false");
        localStorage.setItem("melai-tts-enabled", "true");
        migrateTtsEnabledScope([1, 2, 3]);
        e2eCheck("【核心】迁移不覆盖用户已单独设置的槽位", read(KEY_PREFIX.ttsEnabled, 2) === "false", `${read(KEY_PREFIX.ttsEnabled, 2)}`);
        e2eCheck("未设置的槽位仍会继承", read(KEY_PREFIX.ttsEnabled, 3) === "true");

    } else {
        e2eCheck(`未知 scenario: ${scenario}`, false);
    }
});
