// intervention.ts —— 支线 NPC 介入系统（两层）
// 第一层：程序规则筛选（成本 0）——地点/时间/关键词/关系/事件/冷却
// 第二层：AI 判断（成本 1 次调用）——只在规则筛出候选后，决定"是否出现/怎么出现"
// 原则：主角永远第一优先级；NPC 是世界的生命力，不是陪聊机器人。

import { store, saveState } from "./storage";
import { type NpcState, updateNpcSchedule, npcLearn, applyNpcDelta } from "./npc";
import { currentDayIndex, fmtVirtualTime, currentSchedule, herLocation } from "./time";

// ============ 介入模式 ============

export type InterventionMode = "join" | "message" | "mention" | "scene" | "none";

export interface InterventionCandidate {
    npc: NpcState;
    mode: InterventionMode;
    reason: string;
    score: number;
}

// ============ 第一层：程序规则筛选 ============

// 主角色名（从存档角色读，避免循环依赖——由 chat.ts 注入）
let mainNameGetter: () => string = () => "她";
let userNameGetter: () => string = () => "你";

export function setNpcNameGetters(main: () => string, user: () => string) {
    mainNameGetter = main;
    userNameGetter = user;
}

// NPC 当前是否在"主角所在场景"附近（同地点才可能直接加入/场景出现）
function npcIsNearby(npc: NpcState): boolean {
    const mainLoc = herLocation();
    const npcLoc = npc.location;
    // 学校相关地点互通：学校/教室/图书馆/食堂 视为同场景
    const schoolZones = ["学校", "教室", "图书馆", "食堂", "社团活动", "放学"];
    if (schoolZones.includes(mainLoc) && schoolZones.includes(npcLoc)) return true;
    if (mainLoc === npcLoc) return true;
    // 路上相遇
    if (mainLoc === "上学路上" && npcLoc === "上学路上") return true;
    if (mainLoc === "回家路上" && npcLoc === "回家路上") return true;
    return false;
}

// 夜间/睡眠时段：NPC 不活跃
function npcIsAwake(npc: NpcState): boolean {
    return npc.label !== "深夜" && !npc.activity.includes("睡");
}

// 判断关键词是否命中最近对话
function keywordHit(npc: NpcState, recentText: string): boolean {
    return npc.profile.keywords.some((k) => recentText.includes(k));
}

// 主函数：输入最近对话文本 + 虚拟时间，输出候选 NPC 列表（带介入模式与理由）
export function screenNpcCandidates(recentText: string): InterventionCandidate[] {
    const candidates: InterventionCandidate[] = [];

    for (const npc of Object.values(store.npcs)) {
        // 已经在场：不重复触发（由在场管理处理离场）
        if (npc.present) continue;

        // 1. 时间合理性：晚上该睡觉的 NPC 不出现
        if (!npcIsAwake(npc)) continue;

        // 2. 更新她的当前作息（位置/活动随虚拟时间变化）
        updateNpcSchedule(npc, store.virtualMs, store.dayBaseMs);

        // 3. 冷却：最近刚参与过（虚拟时间 6 小时内）不反复出现
        if (store.virtualMs - npc.lastActiveAt < 6 * 3600000 && npc.lastActiveAt > 0) continue;

        let score = 0;
        let mode: InterventionMode = "none";
        let reason = "";

        // 关键词命中（提到她）→ 高概率介入
        const hit = keywordHit(npc, recentText);
        if (hit) {
            score += 30;
            reason = `你们聊到了${npc.profile.name}`;
            // 在学校且她也在 → 直接出现；不在 → 发消息
            mode = npcIsNearby(npc) ? "join" : "message";
        }

        // 地点相遇：她在主角所在场景 → 可能路过/打招呼
        if (npcIsNearby(npc)) {
            score += 20;
            reason = reason || `${npc.profile.name}恰好也在${npc.location}`;
            mode = mode === "none" ? "scene" : mode;
        }

        // 关系：和主角关系好 → 更可能主动
        if (npc.relToMain > 60) score += 10;
        if (npc.relToUser > 50) score += 5;

        // 剧情相关：当前剧情线提到她
        if (store.activeThread && npc.profile.keywords.some((k) => store.activeThread.includes(k))) {
            score += 15;
            reason = reason || `和你们之间的事有关`;
        }

        // 她有自己的目标/心事 → 可能主动找主角（低概率但有）
        if (npc.goal && Math.random() < 0.25) {
            score += 12;
            reason = reason || `${npc.profile.name}心里有事想找${mainNameGetter()}`;
            mode = mode === "none" ? "message" : mode;
        }

        // 事件随机性：极低的基础概率（世界是活的，但不打扰）
        score += Math.random() * 8;

        // 场景私密保护：深夜/私人话题不加 NPC
        if (store.presentNpcs.length === 0 && currentSchedule().label === "深夜") score = 0;
        // 私人话题关键词（亲密/秘密）→ 不介入
        if (/喜欢你|我爱你|亲你|抱你|秘密|心里话/.test(recentText)) score = 0;

        // 阈值：≥25 才够格进入第二层
        if (score >= 25) {
            candidates.push({ npc, mode, reason, score });
        }
    }

    // 排序：分数高的优先
    candidates.sort((a, b) => b.score - a.score);
    return candidates;
}

// ============ 第二层：AI 判断 + 执行 ============

// 执行介入：对候选 NPC 决定是否真的介入（概率 + 随机），返回实际介入的 NPC 与模式
export function decideIntervention(candidates: InterventionCandidate[], recentText: string, publicRecent: { role: string; content: string }[]): InterventionCandidate | null {
    if (!candidates.length) return null;

    // 最多只介入 1 个（保持主角核心）
    const top = candidates[0]!;

    // 概率：按分数换算，分数越高越可能真的出现
    const chance = Math.min(0.55, 0.2 + top.score / 100);
    if (Math.random() > chance) return null;

    // 记录参与时间
    top.npc.lastActiveAt = store.virtualMs;
    return top;
}

// 构造"公开对话"（NPC 能听到的部分：最近几句，不含用户私密输入——MVP：全部公开，由场景判断）
export function buildPublicRecent(count = 4): { role: string; content: string }[] {
    return store.chatHistory.slice(-count).map((e) => ({
        role: e.role,
        content: e.content,
    }));
}

// NPC 介入后：处理她的发言结果（情绪/记忆/关系/离场）
export function applyNpcResult(npc: NpcState, result: { delta: Record<string, number>; learn?: string; leave?: boolean }) {
    // 情绪/关系变化
    applyNpcDelta(npc, result.delta ?? {});

    // 她新知道的事
    if (result.learn) npcLearn(npc, result.learn);

    // 关系变化记录
    if (Math.abs(result.delta?.relToMain ?? 0) >= 3 || Math.abs(result.delta?.relToUser ?? 0) >= 3) {
        npc.history.push(
            `第${currentDayIndex()}天 ${fmtVirtualTime()}：对${mainNameGetter()}${(result.delta?.relToMain ?? 0) >= 0 ? "好感上升" : "有些疏远"}，对${userNameGetter()}${(result.delta?.relToUser ?? 0) >= 0 ? "好感上升" : "有些疏远"}`,
        );
        if (npc.history.length > 30) npc.history = npc.history.slice(-30);
    }

    // 离场：说完后默认离开（恢复二人对话；除非 AI 明确 leave:false 表示她继续留下）
    const shouldLeave = result.leave !== false;
    if (shouldLeave && npc.present) {
        npc.present = false;
        store.presentNpcs = store.presentNpcs.filter((id) => id !== npc.profile.id);
    }

    saveState();
}

// ============ 被动的世界变化（无 AI 成本） ============

// NPC 自己过日子：随时间推进，更新她们的位置/活动（纯程序，0 成本）
export function tickNpcWorld() {
    for (const npc of Object.values(store.npcs)) {
        updateNpcSchedule(npc, store.virtualMs, store.dayBaseMs);
    }
}
