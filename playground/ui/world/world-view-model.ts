// ui/world/world-view-model.ts —— 【Phase 5-A1】世界的只读镜像
//
// 设计原则（Phase 5 §2 / §4）：
//   Core State  →  World ViewModel  →  UI
//
// 本模块**只能**：
//   · 只读（不写 store / 不写 aiState / 不写 npc）
//   · 可序列化（返回值是纯 JSON 结构，可直接 JSON.stringify 与断言）
//   · 不持有 DOM
//   · 不 fetch
//   · 不碰 localStorage
//   · 不执行游戏规则（阶段名、时间文案、日程状态**全部**取自 Core 的现成导出）
//
// 它**不能**做的（Phase 5 §14 的核心约束）：
//   ❌ 自己造 npcMood / npcLocation / npcActivity / worldTime / fakeEvent / fakeRelationship
//   任何在 Core 里不存在的事实，都不允许在这里被"补"出来。
//   本文件里出现的每一个字段，都能对应到 store 上的一个既有字段或 Core 的一个既有导出。
//
// 与 Core 的依赖方向：`ui/world` → `core`（只读导出）与 `save/`（存档契约的类型/判定）。
// 反向不存在（core 永不 import ui/）。

import { store } from "../../storage";
import { aiState, describeMood } from "../../state";
import { currentDayIndex, currentSchedule, fmtVirtualDate, fmtVirtualTime } from "../../time";
import { storyStage } from "../../story";
import { isFactualStoryEvent, type StoryEventSource } from "../../save-schema";

// ============ 形状（全部可序列化）============

/** 时间维度：直接来自 Core 的既有导出，零重新计算 */
export interface WorldTimeVm {
    /** "16:42" */
    clock: string;
    /** "9月12日 周五" */
    date: string;
    /** 第几天 */
    day: number;
    /** 时段名，例如"放学" */
    label: string;
    /** 该时段她在做什么（`currentSchedule().activity`） */
    activity: string;
}

/** 一个 NPC 的对外可见状态 */
export interface WorldNpcVm {
    id: string;
    name: string;
    avatar: string;
    /** 一句话身份（`NpcProfile.title`） */
    title: string;
    /** 当前地点（`NpcState.location`，由 `updateNpcSchedule` 随虚拟时间推进） */
    location: string;
    /** 当前活动（`NpcState.activity`，同上） */
    activity: string;
    /** 当前时段标签（`NpcState.label`） */
    label: string;
    /** 是否正在当前对话场景中 */
    present: boolean;
    /** 与主角关系 0–100（**不是** 38D，只是一个已存在的标量） */
    relToMain: number;
    /**
     * 她自己的目标（`NpcState.goal`）。
     * ⚠️ 只做展示；Phase 4-D 已把它的**玩法影响**规范化为"仅在与场景相关时参与候选评分"，
     *    本字段不参与任何判断。
     */
    goal: string | null;
    /** 进入"当前状态"的虚拟时刻（`lastActiveAt`，0 表示从未参与过） */
    lastActiveAt: number;
}

/** 一条世界档案条目（**区分来源** —— Phase 5-A4 的地基，此处先派生好）*/
export interface WorldEventVm {
    day: number;
    text: string;
    source: StoryEventSource;
    /** 是否属于"Core 确认发生的事实"（`isFactualStoryEvent` 的结论） */
    factual: boolean;
    /** 是否就是今天（相对 `currentDayIndex()`） */
    today: boolean;
    /** 调度等级（Phase 4-B 决策 1 写入；缺失时 Core 已归一化为 "world"） */
    priority: string;
}

export interface WorldStoryVm {
    /** 阶段名（`storyStage().name`） */
    stageName: string;
    stageDesc: string;
    /** 已保存的剧情进度（`store.storyProgress`）—— **不重新计算** */
    progress: number;
    /** 进行中的剧情线（`store.activeThread`） */
    activeThread: string | null;
    /** 主角当前心情描述（`describeMood()`，Core 的既有定性导出） */
    mood: string;
}

export interface WorldViewModel {
    time: WorldTimeVm;
    npcs: WorldNpcVm[];
    /** 只有 `source === "core"` 才是既成事实 */
    coreFacts: WorldEventVm[];
    /** 全部档案（含 narrative / director）—— UI 可选择展示，但**必须**能区分 */
    allEvents: WorldEventVm[];
    story: WorldStoryVm;
    /** 只是给 UI 的一个便捷标量，不参与任何判定 */
    turnCount: number;
}

// ============ 派生 ============

/**
 * 把一条 `store.storyEvents` 条目转成 VM。
 * **不修改来源判断**：`factual` 直接来自 `isFactualStoryEvent`（唯一真理源）。
 */
function toEventVm(e: { day: number; text: string; source?: StoryEventSource; priority?: string }, today: number): WorldEventVm {
    return {
        day: e.day,
        text: e.text,
        source: e.source ?? "narrative",
        factual: isFactualStoryEvent(e),
        today: e.day === today,
        priority: e.priority ?? "world",
    };
}

/**
 * 构建世界的只读镜像。
 *
 * 纯派生：同一次调用内不产生任何副作用；同一份 Core State 必定得到同一份 VM
 * （因此可以在测试里直接断言映射正确性）。
 *
 * @param limit 每个事件列表最多返回多少条（默认 6，与既有 `.story-event` 的展示量一致）
 */
export function buildWorldViewModel(limit = 6): WorldViewModel {
    const slot = currentSchedule();
    const day = currentDayIndex();

    const events = store.storyEvents.map((e) => toEventVm(e, day));
    const coreFacts = events.filter((e) => e.factual);
    const stage = storyStage();

    return {
        time: {
            clock: fmtVirtualTime(),
            date: fmtVirtualDate(),
            day,
            label: slot.label,
            activity: slot.activity,
        },
        // NPC 顺序取自 `Object.values(store.npcs)` 的既有顺序（NPCS 常量表的顺序），
        // 刻意不排序：排序会引入"UI 决定谁更重要"的隐含语义。
        npcs: Object.values(store.npcs).map((npc) => ({
            id: npc.profile.id,
            name: npc.profile.name,
            avatar: npc.profile.avatar,
            title: npc.profile.title,
            location: npc.location,
            activity: npc.activity,
            label: npc.label,
            present: npc.present,
            relToMain: npc.relToMain,
            goal: npc.goal,
            lastActiveAt: npc.lastActiveAt,
        })),
        coreFacts: coreFacts.slice(-limit),
        allEvents: events.slice(-limit),
        story: {
            stageName: stage.name,
            stageDesc: stage.desc,
            // ⚠️ 直接读 store，**不**用 storyStage().pct 去推算 —— 那是"UI 重新计算规则"
            progress: store.storyProgress,
            activeThread: store.activeThread,
            mood: describeMood(),
        },
        turnCount: store.turnCount,
    };
}

/**
 * VM 的指纹：用于"状态没变就不重建 DOM"的性能优化（Phase 5 §17）。
 *
 * 只包含**会影响渲染**的字段；刻意不含 `aiState` 的全 38 维（它每秒都在动，
 * 但世界表面并不渲染它）。
 */
export function worldViewModelFingerprint(vm: WorldViewModel): string {
    return JSON.stringify({
        t: vm.time.clock,
        l: vm.time.label,
        a: vm.time.activity,
        d: vm.time.day,
        n: vm.npcs.map((n) => [n.id, n.location, n.activity, n.label, n.present, n.relToMain]),
        f: vm.coreFacts.map((e) => [e.day, e.text]),
        s: [vm.story.stageName, vm.story.progress, vm.story.activeThread],
    });
}

/** 调试/测试用：VM 是否满足"只读、可序列化"的契约 */
export function assertSerializable(vm: WorldViewModel): boolean {
    try {
        const round = JSON.parse(JSON.stringify(vm)) as WorldViewModel;
        return worldViewModelFingerprint(round) === worldViewModelFingerprint(vm);
    } catch {
        return false;
    }
}

/** 供测试断言"VM 里的 NPC 情绪没有泄漏 38 维"等边界用（这里只暴露数量，不暴露值） */
export const WORLD_VM_DEBUG = {
    /** VM 里出现过的顶层键（用于断言没有意外的字段被加进来） */
    topLevelKeys(): string[] {
        return Object.keys(buildWorldViewModel(1));
    },
    /** Core 的 38 维聚合数（VM 不应把它整体带出去） */
    aiStateKeyCount(): number {
        return Object.keys(aiState).length;
    },
};
