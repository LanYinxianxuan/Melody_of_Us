// ui/world/world-surface.ts —— 【Phase 5-A2】World Surface 的组合入口
//
// 职责：把 `WorldViewModel` 分发给各个子表面。
// 它是 UI 层唯一需要被 `app/`（chat.ts）调用的入口。
//
// 设计要点（Phase 5 §17 性能）：
//   ① **指纹短路**：`tickClock` 每秒都会触发刷新，但世界表面的内容**只在虚拟时间
//      跨分钟、时段切换、NPC 状态变化、或新增 Core Fact 时才变**。
//      因此先用 `worldViewModelFingerprint` 比对，未变化直接返回 —— 不构建、不写 DOM。
//   ② **子表面就地更新**：`npc-surface` / `event-surface` 都按 key 复用已有节点，
//      只在文本真正变化时写 `textContent`。
//   ③ 本模块**不修改任何世界状态**：它只读 `buildWorldViewModel()` 的返回值。

import { buildWorldViewModel, worldViewModelFingerprint, type WorldViewModel } from "./world-view-model";
import { renderNpcSurface } from "./npc-surface";
import { renderEventSurface } from "./event-surface";

/** 上一次渲染的指纹；`null` 表示还没渲染过 */
let lastFingerprint: string | null = null;
/** 上一次的 VM（供测试与调试读取，只读副本语义） */
let lastVm: WorldViewModel | null = null;
/** 统计：被指纹短路跳过的次数（测试用，证明"没有每秒重建 DOM"） */
let skippedRefreshes = 0;
/** 统计：真正写 DOM 的次数 */
let appliedRefreshes = 0;

export interface WorldSurfaceResult {
    /** 是否真正执行了渲染 */
    rendered: boolean;
    /** 是否发生了 DOM 写入 */
    wrote: boolean;
    /** 本次是否被指纹短路 */
    skipped: boolean;
    fingerprint: string;
}

/**
 * 刷新世界表面。由 `app/`（chat.ts）在既有时机调用：
 *   · 初始化末尾一次
 *   · 时钟每秒的回调里（**靠指纹短路来避免无谓重建**）
 *   · 关键世界事件之后（NPC 介入、跨天、重置、载入存档）
 */
export function refreshWorldSurface(force = false): WorldSurfaceResult {
    const vm = buildWorldViewModel();
    const fp = worldViewModelFingerprint(vm);

    if (!force && lastFingerprint === fp) {
        skippedRefreshes++;
        return { rendered: false, wrote: false, skipped: true, fingerprint: fp };
    }

    lastFingerprint = fp;
    lastVm = vm;
    appliedRefreshes++;

    const wroteNpc = renderNpcSurface(vm.npcs);
    const wroteEvents = renderEventSurface(vm.coreFacts);

    return { rendered: true, wrote: wroteNpc || wroteEvents, skipped: false, fingerprint: fp };
}

/** 强制失效（载入存档 / 重置 / 换槽位后调用，确保下一帧一定重建） */
export function invalidateWorldSurface(): void {
    lastFingerprint = null;
    lastVm = null;
}

/** 只读：最近一次渲染用的 VM（可能为 null，表示还没渲染过） */
export function currentWorldViewModel(): WorldViewModel | null {
    return lastVm;
}

/** 测试/诊断统计 */
export function worldSurfaceStats(): { applied: number; skipped: number; fingerprint: string | null } {
    return { applied: appliedRefreshes, skipped: skippedRefreshes, fingerprint: lastFingerprint };
}

/** 测试用：重置统计与缓存 */
export function __resetWorldSurfaceForTest(): void {
    lastFingerprint = null;
    lastVm = null;
    appliedRefreshes = 0;
    skippedRefreshes = 0;
}
