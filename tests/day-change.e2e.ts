// day-change.e2e.ts —— P0-10 回归测试：跨天回调必须传出正确的 oldDay / newDay
//
// 被修复的缺陷：
//   time.ts 有两个跨天触发点，它们的「赋值 / 回调」顺序相反：
//     · setVirtualTime：先 store.dayIndex = newDay，再 dayChangeHandler(oldDay)
//     · tickClock：      先 dayChangeHandler(store.dayIndex)，再 store.dayIndex = newDay
//   而回调签名只有 oldDay，newDay 由消费方（chat.ts）读 store.dayIndex 推断。
//   于是在 tickClock（自然时间流逝）这条主要路径上，消费方读到的仍是旧值 →
//   director 的触发原因被写成「跨天（第3天 → 第3天）」，世界调度拿到错误的时间信息。
//
// 修法：签名显式携带 newDay；tickClock 改为先赋值再回调（与 setVirtualTime 一致）。
// 本测试直接驱动真实 tickClock，因此覆盖的是自然时间流逝这条主路径。

import {
    currentDayIndex,
    getTimeRate,
    setDayChangeHandler,
    setVirtualTime,
    tickClock,
    mindTestHooks,
    setTimeRate,
} from "./time-test-hooks";
import { e2eCheck, e2eLog, e2eRun } from "./e2e-assert";

const { store } = mindTestHooks;

const calls: { oldDay: number; newDay: number }[] = [];
setDayChangeHandler((oldDay, newDay) => {
    calls.push({ oldDay, newDay });
});

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * 在给定的虚拟时刻结束一次真实 tickClock()。
 * 原理：tickClock 用「距上次 tick 的真实耗时 × timeRate」推进虚拟时间，
 * 因此把 timeRate 设高、真实等待很短时间，即可精确制造跨天。
 * 这里刻意多推进一点（越过午夜 2 分钟）以保证必然跨天。
 */
async function crossDayFrom(day: number, virtualMs: number) {
    store.virtualMs = virtualMs;
    store.dayIndex = currentDayIndex();
    store.scheduleIndex = 0;
    const before = store.dayIndex;
    // 让 tickClock 的 lastRealMs 落在"现在"，再过 260ms × rate 产生足够位移
    tickClock();
    await sleep(260);
    tickClock();
    return { before, after: store.dayIndex };
}

await e2eRun(async () => {
    const originalRate = getTimeRate();

    // ---------- ① tickClock 路径（自然时间流逝，即 P0-10 的出错路径） ----------
    setTimeRate(600); // 260ms 真实 → 156 虚拟秒，足够越过午夜
    const midnightOfDay2 = store.dayBaseMs + 1 * 86400000 + (24 * 60 - 1) * 60000; // 第 2 天 23:59
    calls.length = 0;
    const r1 = await crossDayFrom(2, midnightOfDay2);

    e2eLog(`跨天前 dayIndex=${r1.before}（应为 2），跨天后 dayIndex=${r1.after}（应为 3）`);
    e2eLog(`回调参数：${JSON.stringify(calls)}`);

    e2eCheck("准备阶段处于第 2 天", r1.before === 2, `${r1.before}`);
    e2eCheck("tickClock 跨天时触发了回调", calls.length === 1, `calls=${calls.length}`);
    e2eCheck("【核心】oldDay 是第 2 天", calls[0]?.oldDay === 2, `oldDay=${calls[0]?.oldDay}`);
    e2eCheck("【核心】newDay 是第 3 天（修复前恒等于 oldDay）", calls[0]?.newDay === 3, `newDay=${calls[0]?.newDay}`);
    e2eCheck("【核心】oldDay !== newDay", calls[0]?.oldDay !== calls[0]?.newDay, JSON.stringify(calls[0]));
    e2eCheck("回调时 store.dayIndex 已是新天数", currentDayIndex() === 3, `${currentDayIndex()}`);

    // ---------- ② setVirtualTime 路径（原本语义正确，确保没被改坏） ----------
    calls.length = 0;
    setVirtualTime(9, "08:00");
    e2eLog(`setVirtualTime：回调=${JSON.stringify(calls)}`);
    e2eCheck("setVirtualTime 跨天触发回调", calls.length === 1, `calls=${calls.length}`);
    e2eCheck(
        "setVirtualTime 的 oldDay/newDay 正确（3 → 9）",
        calls[0]?.oldDay === 3 && calls[0]?.newDay === 9,
        JSON.stringify(calls[0]),
    );

    // ---------- ③ 未跨天时不得误触发 ----------
    calls.length = 0;
    setVirtualTime(9, "12:00");
    tickClock();
    await sleep(120);
    tickClock();
    e2eCheck("同一天内推进不触发跨天回调", calls.length === 0, `calls=${JSON.stringify(calls)}`);

    // ---------- ④ 回调报告的天数必须与实际发生的一致（最强不变量） ----------
    // 注意：tickClock 用「真实耗时 × timeRate」推进虚拟时间，跨度由真实耗时决定，
    // 因此不能假设它只跨一天。要验证的是「回调报的 oldDay/newDay == 真实前后天数」。
    setTimeRate(600);
    setVirtualTime(30, "23:59:00".slice(0, 5)); // 23:59
    const beforeDay = currentDayIndex();
    calls.length = 0;
    // 反复 tick 直到跨天（虚拟时间由「真实耗时 × timeRate」推进，
    // 因此用循环等待而不是猜测 sleep 时长 —— 后者会随机器快慢而 flaky）
    for (let i = 0; i < 200 && currentDayIndex() === beforeDay; i++) {
        await sleep(5);
        tickClock();
    }
    const afterDay = currentDayIndex();
    const reported = { ...calls[0] };
    e2eLog(`tickClock：实际 ${beforeDay} → ${afterDay}，回调报告 ${JSON.stringify(reported)}`);
    e2eCheck("tickClock 跨天回调恰触发一次", calls.length === 1, `calls=${calls.length}`);
    e2eCheck(
        "【核心】回调报告的 oldDay 等于真实起始天数",
        reported.oldDay === beforeDay,
        `report=${reported.oldDay} actual=${beforeDay}`,
    );
    e2eCheck(
        "【核心】回调报告的 newDay 等于真实结束天数",
        reported.newDay === afterDay,
        `report=${reported.newDay} actual=${afterDay}`,
    );
    e2eCheck("【核心】跨天回调的两端不相等", reported.oldDay !== reported.newDay, JSON.stringify(reported));

    // setVirtualTime 路径用同一不变量验证
    const beforeDay2 = currentDayIndex();
    calls.length = 0;
    setVirtualTime(beforeDay2 + 7, "06:00");
    const afterDay2 = currentDayIndex();
    e2eLog(`setVirtualTime：实际 ${beforeDay2} → ${afterDay2}，回调报告 ${JSON.stringify(calls[0])}`);
    e2eCheck("setVirtualTime 跨天回调恰触发一次", calls.length === 1, `calls=${calls.length}`);
    e2eCheck(
        "【核心】setVirtualTime 报告的 oldDay/newDay 与实际一致",
        calls[0]?.oldDay === beforeDay2 && calls[0]?.newDay === afterDay2,
        `${JSON.stringify(calls[0])} vs ${beforeDay2}→${afterDay2}`,
    );

    // 复原时间倍率，避免影响同进程后续断言
    setTimeRate(originalRate);
});
