// save-failure.e2e.ts —— P0-3 回归测试：存档失败必须被检测到并上报
//
// 被修复的缺陷：
//   storage.ts 的 saveState() 与 character.ts 的 saveCharacter() 原本是
//       try { localStorage.setItem(...) } catch { /* ignore */ }
//   ——把一切写入失败静默吞掉，且不返回任何成功/失败信息。
//
//   最现实的触发路径是 localStorage 配额：TTS 音色以 base64 data URL 存在同一配额里
//   （tts.ts 允许最大 10MB 文件；base64 膨胀 1.34 倍且按 UTF-16 计费 →
//   1MB 音频约占 5MB 配额的 53%，2MB 即超额）。配额被占满后**所有**存档写入都会失败，
//   用户完全没有感知，一直玩到刷新才发现进度全丢。
//
// 测试手法：真实替换 Storage.prototype.setItem 抛 QuotaExceededError。
// 这比断言"返回值类型"强得多 —— 它走的是真实的 catch 路径与真实的错误判定。

import { saveState, setSaveFailureHandler, getLastSaveFailure, clearSaveFailure, SAVE_KEY } from "../playground/storage";
import { saveCharacter, CHARACTER, setCharacter } from "../playground/character";
import { e2eCheck, e2eLog, e2eRun } from "./e2e-assert";

const proto = Object.getPrototypeOf(localStorage) as Storage;
const originalSetItem = proto.setItem;

/** 让后续所有 setItem 抛出配额错误 */
function breakStorage(errorName = "QuotaExceededError", message = "The quota has been exceeded.") {
    proto.setItem = function () {
        const err = new Error(message);
        err.name = errorName;
        throw err;
    };
}

function restoreStorage() {
    proto.setItem = originalSetItem;
}

const failures: unknown[] = [];
setSaveFailureHandler((f) => failures.push(f));

await e2eRun(() => {
    // ---------- ① 正常情况：返回 true、不触发失败回调 ----------
    restoreStorage();
    clearSaveFailure();
    failures.length = 0;
    const ok = saveState();
    e2eCheck("存储正常时 saveState() 返回 true", ok === true, `${ok}`);
    e2eCheck("存储正常时不触发失败回调", failures.length === 0, `count=${failures.length}`);
    e2eCheck("存储正常时无失败记录", getLastSaveFailure() === null);
    e2eCheck("存储正常时数据确实写入了", !!localStorage.getItem(SAVE_KEY));

    // ---------- ② 配额耗尽：必须返回 false 并上报 ----------
    breakStorage("QuotaExceededError");
    clearSaveFailure();
    failures.length = 0;
    const failed = saveState();
    e2eLog(`配额耗尽：saveState()=${failed}  回调次数=${failures.length}`);

    e2eCheck("【核心】配额耗尽时 saveState() 返回 false（修复前无返回值、静默吞掉）", failed === false, `${failed}`);
    e2eCheck("【核心】配额耗尽时触发失败回调", failures.length === 1, `count=${failures.length}`);
    const f = getLastSaveFailure();
    e2eCheck("【核心】失败记录被保存（可供调试/测试读取）", f !== null);
    e2eCheck("【核心】正确识别为配额耗尽", f?.quotaExceeded === true, `quotaExceeded=${f?.quotaExceeded}`);
    e2eCheck("失败记录带出存储键", f?.key === SAVE_KEY, `${f?.key}`);
    e2eCheck("失败记录带出待写入字节数（用于定位是哪份数据太大）", typeof f?.bytes === "number" && (f?.bytes ?? 0) > 0, `${f?.bytes}`);
    e2eCheck("原始异常被保留", f?.error instanceof Error, `${typeof f?.error}`);

    // ---------- ③ 不抛异常给调用方（存档失败不能让聊天流程崩掉） ----------
    let threw = false;
    try {
        saveState();
    } catch {
        threw = true;
    }
    e2eCheck("【核心】saveState 不向调用方抛异常（失败已被吸收）", threw === false);

    // ---------- ④ 角色卡写入同样被覆盖 ----------
    clearSaveFailure();
    failures.length = 0;
    setCharacter({
        name: "测试角色",
        age: "",
        appearance: "",
        personality: "",
        background: "",
        speechStyle: "",
        likes: "",
        dislikes: "",
        relation: "",
        secrets: "",
    });
    const charOk = saveCharacter();
    e2eCheck("【核心】配额耗尽时 saveCharacter() 返回 false", charOk === false, `${charOk}`);
    e2eCheck("【核心】saveCharacter 也走同一个失败通道", failures.length === 1, `count=${failures.length}`);

    // ---------- ⑤ 非配额类失败：不得误判为配额问题 ----------
    breakStorage("SecurityError", "The operation is insecure.");
    clearSaveFailure();
    failures.length = 0;
    const secFailed = saveState();
    const secRecord = getLastSaveFailure();
    e2eLog(`SecurityError：返回=${secFailed} quotaExceeded=${secRecord?.quotaExceeded}`);
    e2eCheck("存储被禁用时同样返回 false", secFailed === false);
    e2eCheck("【核心】SecurityError 不被误判为配额耗尽", secRecord?.quotaExceeded === false, `${secRecord?.quotaExceeded}`);

    // ---------- ⑥ 通知回调抛错不得影响存档流程 ----------
    breakStorage("QuotaExceededError");
    clearSaveFailure();
    setSaveFailureHandler(() => {
        throw new Error("回调自身炸了");
    });
    let threw2 = false;
    let result2: boolean | null = null;
    try {
        result2 = saveState();
    } catch {
        threw2 = true;
    }
    e2eCheck("【核心】失败回调抛错时，saveState 仍安全返回 false", threw2 === false && result2 === false, `threw=${threw2} ret=${result2}`);

    // ---------- ⑦ 恢复后可正常写入（失败不应留后遗症） ----------
    restoreStorage();
    setSaveFailureHandler((x) => failures.push(x));
    failures.length = 0;
    clearSaveFailure();
    const recovered = saveState();
    e2eCheck("存储恢复后 saveState() 重新返回 true", recovered === true, `${recovered}`);
    e2eCheck("存储恢复后无新的失败记录", getLastSaveFailure() === null);
    e2eCheck("存储恢复后数据写入成功", !!localStorage.getItem(SAVE_KEY));
    void CHARACTER;
});
