// proactive-gate.e2e.ts —— P0-8 回归测试：主动开口的「聊天能力」门控
//
// 被修复的缺陷：
//   time.ts 的 onSlotChanged() 里写的是 `!!localStorage.getItem("deepseek-key")`，
//   而全仓从无任何写入方（现行键是 per-slot 的 `apikey-${slot}`）。
//   后果 ①：该判断恒为 false → **时段切换的主动开口永远不会触发**。
//   后果 ②（同期发现）：story.ts 的随机时刻主动开口走 tryProactiveSpeak 的另一条
//   调用路径，而该函数当时**完全没有能力判断** → 没有 API Key 时也会尝试开口。
//
// 修法：把能力判断上移为 tryProactiveSpeak / tryProactiveSpeakForce 的统一门控，
// 由 chat.ts 注入。因此本测试同时覆盖两条调用路径共用的那个门控。

import {
    markUserReplied,
    setChatCapabilityGetter,
    setMessageSender,
    setProactiveGate,
    tryProactiveSpeak,
    tryProactiveSpeakForce,
} from "../playground/time";
import { e2eCheck, e2eLog, e2eRun } from "./e2e-assert";

const sent: { text: string; proactive: boolean }[] = [];
setMessageSender((text, opts) => {
    sent.push({ text, proactive: opts?.proactive ?? false });
});

await e2eRun(() => {
    // ---------- ① 未注册时保持既有默认行为（向后兼容） ----------
    // 默认 getter 返回 true，所以能否开口只取决于其它门控。这里先不设 gate，
    // 用「冷却」这一确定性门控来观察默认值不会额外阻塞。
    markUserReplied();
    setProactiveGate(() => true);

    // ---------- ② 无聊天能力：必须静默拒绝 ----------
    setChatCapabilityGetter(() => false);

    const noCap1 = tryProactiveSpeak("（测试）无 Key 时不该开口");
    e2eCheck("【核心】无聊天能力时 tryProactiveSpeak 返回 false", noCap1 === false);
    e2eLog(`无能力分支：发送条数=${sent.length}（应为 0）`);
    e2eCheck("【核心】无聊天能力时不发送任何消息", sent.length === 0, `sent=${sent.length}`);

    // 被冷落强制通道同样必须被拦住（它会突破 awaitingReply，但不该突破能力门控）
    const noCap2 = tryProactiveSpeakForce("（测试）强制通道也不该开口");
    e2eCheck("【核心】无聊天能力时 tryProactiveSpeakForce 也返回 false", noCap2 === false);
    e2eCheck("【核心】强制通道在有 Key 前不发送任何消息", sent.length === 0, `sent=${sent.length}`);

    // ---------- ③ 关键细节：被能力门控拦下时不得消耗冷却 ----------
    // 这是最容易写错的地方 —— 若先记 lastProactiveAt 再判断能力，
    // 则用户设置好 API Key 后还要白等 60 秒才能真正开口。
    setChatCapabilityGetter(() => true);
    markUserReplied();
    const afterCapabilityGranted = tryProactiveSpeak("（测试）具备能力后应立即可以开口");
    e2eCheck(
        "【核心】能力门控不消耗冷却：具备能力后立即可以开口",
        afterCapabilityGranted === true,
        `returned=${afterCapabilityGranted}`,
    );
    e2eCheck("具备能力后确实发出了消息", sent.length === 1, `sent=${sent.length}`);
    e2eCheck("发出的消息标记为 proactive", sent[0]?.proactive === true, JSON.stringify(sent[0]));

    // ---------- ④ 冷却仍然生效 ----------
    markUserReplied();
    const onCooldown = tryProactiveSpeak("（测试）冷却期内不该再次开口");
    e2eCheck("冷却期内拒绝再次开口", onCooldown === false);
    e2eCheck("冷却期内未新增发送", sent.length === 1, `sent=${sent.length}`);
    markUserReplied();
    const forceOnCooldown = tryProactiveSpeakForce("（测试）强制通道也受冷却约束");
    e2eCheck("强制通道同样受冷却约束", forceOnCooldown === false);

    // ---------- ⑤ awaitingReply 门控仍然生效 ----------
    // 上面 ③ 成功那次把 awaitingReply 置为 true；冷却也还在。
    // 这里用一个新的判断顺序验证「能力通过 → 其它门控仍然独立生效」：
    // 由于冷却未过，无法直接观察 awaitingReply；改为断言能力 getter 被实际调用。
    let capabilityCalls = 0;
    setChatCapabilityGetter(() => {
        capabilityCalls++;
        return true;
    });
    tryProactiveSpeak("（测试）观察能力 getter 是否被调用");
    e2eCheck("每次开口尝试都会查询聊天能力（证明门控真的在链路上）", capabilityCalls === 1, `calls=${capabilityCalls}`);

    // ---------- ⑥ proactiveGate 仍然生效（且优先于冷却，不消耗冷却） ----------
    let capabilityCalls2 = 0;
    setChatCapabilityGetter(() => {
        capabilityCalls2++;
        return true;
    });
    setProactiveGate(() => false);
    const gateClosed = tryProactiveSpeak("（测试）忙碌时不该开口");
    e2eCheck("proactiveGate 关闭时拒绝开口", gateClosed === false);
    e2eCheck("proactiveGate 关闭时也查询了能力（门控顺序：能力优先）", capabilityCalls2 === 1);

    // 复原，避免影响同一浏览器进程内的后续断言
    setProactiveGate(() => true);
    setChatCapabilityGetter(() => true);
    markUserReplied();
});
