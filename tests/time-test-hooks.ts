// time-test-hooks.ts —— 浏览器 e2e 用的 time 模块出口
//
// 为什么不直接用 "../playground/time"：
//   e2e 套件需要同时拿到 time.ts 的公开 API 和 mind.ts 暴露的 store 句柄
//   （用于精确构造虚拟时间），集中在这里 re-export 可以让各测试文件只 import 一处，
//   也便于将来收敛跨模块测试的取数方式。
//
// 说明：mind.ts 的 mindTestHooks 是项目既有的测试出口（agent-smoke.mjs 也在用），
// 这里只是复用它，不新增生产代码。

export {
    currentDayIndex,
    setDayChangeHandler,
    setVirtualTime,
    setTimeRate,
    tickClock,
} from "../playground/time";

export { mindTestHooks } from "../playground/mind";

import { store as timeStore } from "../playground/storage";

/** 直接读取当前时间倍率（time.ts 未导出 getter，store 里有） */
export function getTimeRate(): number {
    return timeStore.timeRate;
}
