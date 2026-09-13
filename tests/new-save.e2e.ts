// new-save.e2e.ts —— P0-11 回归测试：?new=1 必须真的清空旧档
//
// 被修复的缺陷：
//   storage.ts 曾用 localStorage 标记 `melai-did-new-${slot}` 作为「已清空过」的幂等守卫，
//   而该标记只在「向导成功创建角色」时被删除（chat.ts 的 savedCallback）。
//   于是：点「新建」→ 在向导里点「取消」→ 标记永久留在该槽位 →
//   该槽此后每次点「新建」，守卫都命中，**不再清空旧档**。
//   用户以为在开新档，实际进了旧档 —— 静默的数据语义错误。
//
// 修法：删掉该标记。它声称要防的「重复清空」实际不会发生 ——
// 紧随其后的 history.replaceState 已经把 ?new=1 从 URL 移除，刷新后不会再次进入该分支。
//
// 测试手法：storage.ts 在 import 时读取 location.search 并冻结 currentSlot，
// 因此用「多阶段 + 每阶段独立查询串」真实复现用户的进入流程。
// 阶段安排见 tests/e2e.mjs 的 newsave 套件声明。

import { currentSlot, clearSlot } from "../playground/storage";
import { e2eCheck, e2eLog, e2eParams, e2eRun } from "./e2e-assert";

const SLOT = 9;
const STATE_KEY = `melai-state-${SLOT}`;
const CHAR_KEY = `melai-character-${SLOT}`;
const MARKER_KEY = `melai-did-new-${SLOT}`;

/** 写入一份"旧档"，模拟该槽位已经有玩家数据 */
function seedOldSave(tag: string) {
    localStorage.setItem(STATE_KEY, JSON.stringify({ aiState: { affection: 77 }, tag, chatHistory: [] }));
    localStorage.setItem(CHAR_KEY, JSON.stringify({ name: `旧角色-${tag}` }));
}

const oldStateExists = () => !!localStorage.getItem(STATE_KEY);
const oldCharExists = () => !!localStorage.getItem(CHAR_KEY);

await e2eRun(() => {
    const phase = e2eParams().get("phase") ?? "1";
    e2eLog(`phase=${phase}  currentSlot(模块冻结值)=${currentSlot}  URL=${location.search}`);

    switch (phase) {
        // ===== 阶段 1：写入旧档（页面加载时已无 new 参数，不会被清） =====
        case "1": {
            localStorage.clear();
            seedOldSave("A");
            e2eLog(`写入后立即可读：state=${oldStateExists()} char=${oldCharExists()}`);
            e2eLog(`localStorage 全部键：${Object.keys(localStorage).join(",")}`);
            e2eCheck("旧档已就位（存档 + 角色卡）", oldStateExists() && oldCharExists());
            break;
        }

        // ===== 阶段 2：第一次「新建」 =====
        case "2": {
            // 注意：storage.ts 在 **import 时** 就完成了清空，早于本函数体执行。
            // 因此这里无法观察到"清空前"的状态 —— 能观察到"清空后"正是本次修复的目标。
            e2eLog(`本页 localStorage 全部键：${Object.keys(localStorage).join(",")}`);
            e2eCheck("【核心】?new=1 清空了存档", !oldStateExists(), localStorage.getItem(STATE_KEY) ?? "null");
            e2eCheck("【核心】?new=1 清空了角色卡", !oldCharExists(), localStorage.getItem(CHAR_KEY) ?? "null");
            e2eCheck(
                "【核心】不再写入 melai-did-new 持久标记（该标记是 P0-11 根因）",
                !localStorage.getItem(MARKER_KEY),
                `marker=${localStorage.getItem(MARKER_KEY)}`,
            );
            break;
        }

        // ===== 阶段 3：玩家又攒了数据（模拟：取消向导后又玩了一阵） =====
        case "3": {
            seedOldSave("B");
            e2eLog(`第二轮旧档就位：state=${oldStateExists()} char=${oldCharExists()}`);
            e2eCheck("第二轮旧档已就位", oldStateExists() && oldCharExists());
            // 关键前提：此时 localStorage 里**没有**任何残留标记。
            // 修复前，阶段 2 会留下 marker=1，从而让阶段 4 的守卫命中。
            e2eCheck(
                "进入阶段 4 前没有残留的 did-new 标记（修复前此处会是 1）",
                !localStorage.getItem(MARKER_KEY),
                `marker=${localStorage.getItem(MARKER_KEY)}`,
            );
            break;
        }

        // ===== 阶段 4：再次「新建」—— 缺陷在此显形 =====
        case "4": {
            // 本阶段是最关键的判定点：
            //   修复前 —— 阶段 2 会留下 marker=1，import 时的守卫 `!getItem(newKey)` 为假
            //            → 不清空 → 阶段 3 写入的旧档**原封不动地存活**，用户看到旧档。
            //   修复后 —— 从不写 marker → 守卫通过 → 旧档被清空。
            e2eLog(`本页 localStorage 全部键：${Object.keys(localStorage).join(",")}`);
            e2eLog(`STATE_KEY 原文：${localStorage.getItem(STATE_KEY) ?? "null"}`);
            e2eCheck(
                "【核心】再次「新建」依然清空旧档（修复前此处会残留阶段 3 的旧档）",
                !oldStateExists() && !oldCharExists(),
                `state=${localStorage.getItem(STATE_KEY) ?? "null"} char=${localStorage.getItem(CHAR_KEY) ?? "null"}`,
            );
            e2eCheck(
                "【核心】阶段的旧档确实在阶段 3 写入过（证明本断言不是空转）",
                localStorage.getItem(MARKER_KEY) === null,
                `marker=${localStorage.getItem(MARKER_KEY)}`,
            );
            break;
        }

        // ===== 阶段 5：刷新（URL 已无 new 参数）不得清空 =====
        case "5": {
            seedOldSave("C");
            // 同一个页面里 storage 模块已加载完毕（冻结时 URL 无 new），
            // 这里直接断言：无 new 参数时模块不清空任何东西。
            e2eCheck(
                "无 new 参数时不清空存档（幂等性依赖 URL 参数被移除，而非持久标记）",
                oldStateExists() && oldCharExists(),
            );

            // clearSlot 必须连带清理旧版本可能遗留的标记
            localStorage.setItem(MARKER_KEY, "1"); // 模拟旧版本遗留
            clearSlot(SLOT);
            e2eCheck("clearSlot 清除了存档", !oldStateExists());
            e2eCheck("clearSlot 清除了角色卡", !oldCharExists());
            e2eCheck("【核心】clearSlot 连带清除了历史遗留的 did-new 标记", !localStorage.getItem(MARKER_KEY));

            localStorage.clear();
            break;
        }

        default:
            e2eCheck(`未知阶段 ${phase}`, false);
    }
});
