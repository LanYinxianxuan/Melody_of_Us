// boundaries.test.mjs —— 架构边界的**静态**守卫（阶段 3）
//
// 为什么需要静态检查而不只是 e2e：
//   渲染边界是"约定"，不是运行时能自证的东西。一个模块偷偷 `document.getElementById`
//   照样能通过全部 448 条 e2e 断言 —— 因为那些断言测的是行为，不是结构。
//   本文件把约定变成可执行断言：越界即红。
//
// 两类检查：
//   ① DOM 访问归属：哪个模块允许直接碰 DOM，哪些必须走 ui/dom 收口
//   ② 网络出口归属：fetch 只允许出现在 ai/ 里（当前为**记录性**检查，见下）

import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const PLAYGROUND = join(ROOT, "playground");

let passed = 0;
let failed = 0;
const check = (label, ok, detail = "") => {
    if (ok) {
        passed++;
        console.log(`  ✅ ${label}`);
    } else {
        failed++;
        console.log(`  ❌ ${label}${detail ? `  ← ${detail}` : ""}`);
    }
};

/**
 * 模块 → 允许的 DOM 访问级别。
 *
 *  `owner`    唯一允许出现原生 querySelector / getElementById 的模块（收口器本体）
 *  `allowed`  允许通过 ui/ 收口器操作 DOM（渲染层与页面装配层）
 *  `forbidden` 完全不得接触 DOM（世界规则 / 网络 / 持久化）
 *
 * 未列出的模块按 `forbidden` 处理 —— 新增文件必须显式登记才能碰 DOM，
 * 这样"边界"是默认拒绝而不是默认允许。
 */
const LEVELS = {
    // 收口器本体
    "ui/dom.ts": "owner",

    // 必须走收口器（渲染层）；出现原生 querySelector 即越界
    "ui/message.ts": "strict",
    "ui/state-panel.ts": "strict",
    "ui/modals.ts": "strict",
    "ui/world/world-view-model.ts": "strict",
    "ui/world/npc-surface.ts": "strict",
    "ui/world/event-surface.ts": "strict",
    "ui/world/world-surface.ts": "strict",
    "ui/world/story-log-surface.ts": "strict",
    "action-suggest.ts": "strict",
    "mind-debug.ts": "strict",
    "event-card.ts": "strict", // 事件卡的弹层渲染与用户选择（规则在 events.ts）

    // 页面入口层：允许直接操作 DOM，但**每次改动都必须让这个数字下降或持平**。
    // 迁移到 ui/dom 收口器是阶段 3 的收尾工作，见 PHASE3_RENDER_BOUNDARY.md。
    "chat.ts": "entry", // 已迁完（0 处原生查询），保留 entry 是因为它仍有 39 处 window./document. 使用
    "menu.ts": "entry",
    "wizard.ts": "entry",

    // 参见 GAMEPLAY_REVIEW A-2：这三个模块内含渲染函数，应上移到 ui/，当前冻结
    "agenda.ts": "entry",
    "time.ts": "entry",
    "story.ts": "entry",
};

/** 各 entry 模块当前允许的原生查询数上限（只允许下降，不允许上升） */
const RAW_QUERY_BUDGET = {
    "chat.ts": 0,
    "menu.ts": 30,
    "wizard.ts": 16,
    "agenda.ts": 8,
    "time.ts": 16,
    "story.ts": 11,
};

/** 世界规则 / 网络 / 持久化层 —— 这些模块出现 DOM 访问就是越界 */
const MUST_BE_PURE = [
    "state.ts",
    "storage.ts",
    "save-schema.ts",
    "save-io.ts",
    "character.ts",
    "mind.ts",
    "npc.ts",
    "intervention.ts",
    "events.ts",
    "director.ts",
    "actions.ts",
    "ai.ts",
    "tts.ts",
    "voice-store.ts",
    "util.ts",
    "response-template.ts",
];

/**
 * "DOM 访问"的判定口径。**刻意排除 `document.createElement`**：
 * 创建元素并把 `textContent` 写进去是渲染层最核心的合法操作
 * （UI 存在的意义就是造节点），把它当成越界会让这条规则变得无法遵守。
 * 这里关心的是**查询**页面既有结构那一类操作。
 */
const DOM_PATTERN = /\bdocument\s*\.(?!createElement)[A-Za-z_$]|\bwindow\s*\.\s*document\b/;

async function walk(dir) {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...(await walk(full)));
        else if (entry.name.endsWith(".ts")) out.push(full);
    }
    return out;
}

console.log("===== 架构边界静态守卫 =====");

const files = await walk(PLAYGROUND);

/** 便于按相对路径取源码（静态断言用） */
const sourcesCache = new Map();
for (const file of files) {
    sourcesCache.set(relative(PLAYGROUND, file).split("\\").join("/"), await readFile(file, "utf8"));
}

// ---------- ① DOM 访问归属 ----------
console.log("\n--- DOM 访问归属 ---");

const notComment = ({ line }) => !/^\s*(\/\/|\*|\/\*)/.test(line);
const domLines = (src) =>
    src
        .split("\n")
        .map((line, i) => ({ line, no: i + 1 }))
        .filter((h) => DOM_PATTERN.test(h.line) && notComment(h));

const violations = [];
const budgetReport = [];
for (const file of files) {
    const rel = relative(PLAYGROUND, file).split("\\").join("/");
    const level = LEVELS[rel] ?? "forbidden";
    const src = await readFile(file, "utf8");
    const hits = domLines(src);
    const raw = hits.filter(({ line }) => /document\.(getElementById|querySelector)/.test(line));

    if (level === "forbidden" && hits.length) {
        violations.push(`${rel}:${hits[0].no} (${hits.length} 处) ${hits[0].line.trim().slice(0, 80)}`);
    }
    if (level === "strict" && raw.length) {
        violations.push(`[strict] ${rel}:${raw[0].no} 绕过收口器 → ${raw[0].line.trim().slice(0, 80)}`);
    }
    if (level === "entry") {
        const budget = RAW_QUERY_BUDGET[rel];
        if (budget === undefined) {
            violations.push(`[entry] ${rel} 未登记原生查询预算`);
        } else if (raw.length > budget) {
            violations.push(`[entry] ${rel} 原生查询 ${raw.length} 处，超出预算 ${budget}`);
        } else {
            budgetReport.push(`${rel} ${raw.length}/${budget}`);
        }
    }
}
check(
    "strict 层（渲染层）不得绕过收口器直接 querySelector",
    violations.filter((v) => v.startsWith("[strict]")).length === 0,
    violations.filter((v) => v.startsWith("[strict]")).slice(0, 4).join(" | "),
);
check(
    "forbidden 层（规则/网络/持久化）零 DOM 访问",
    violations.filter((v) => !v.startsWith("[")).length === 0,
    violations.filter((v) => !v.startsWith("[")).slice(0, 4).join(" | "),
);
check(
    "entry 层原生查询数不超过已登记预算（只允许下降）",
    violations.filter((v) => v.startsWith("[entry]")).length === 0,
    violations.filter((v) => v.startsWith("[entry]")).slice(0, 4).join(" | "),
);
console.log(`    entry 层现状：${budgetReport.join(" ｜ ")}`);

// ---------- ② 世界规则 / 网络 / 持久化层不得接触 DOM ----------
console.log("\n--- 领域层纯度 ---");
const impure = [];
for (const rel of MUST_BE_PURE) {
    const src = await readFile(join(PLAYGROUND, rel), "utf8").catch(() => null);
    if (src === null) continue;
    const hits = src
        .split("\n")
        .map((line, i) => ({ line, no: i + 1 }))
        .filter(({ line }) => DOM_PATTERN.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line));
    if (hits.length) impure.push(`${rel}:${hits[0].no} ${hits[0].line.trim().slice(0, 80)}`);
}
check(
    `世界规则 / 网络 / 持久化层（${MUST_BE_PURE.length} 个模块）零 DOM 访问`,
    impure.length === 0,
    impure.slice(0, 4).join(" | "),
);

// ---------- ③ 收口器本身被使用（防止"建了不用"） ----------
console.log("\n--- 收口器采用率 ---");
const chatSrc = await readFile(join(PLAYGROUND, "chat.ts"), "utf8");
check(
    "chat.ts 已完全迁移到 ui/dom 收口器（无残留 getElementById/querySelector）",
    !/document\.(getElementById|querySelector)/.test(chatSrc),
);
const uiUse = (chatSrc.match(/\bui\.(el|optEl|qs|qsa)\b/g) ?? []).length;
check(`chat.ts 通过收口器的查询点 ≥ 60（实测 ${uiUse}）`, uiUse >= 60, `实测 ${uiUse}`);

// ---------- ④ 存档字段必须被类型声明覆盖（A-3） ----------
console.log("\n--- store 字段类型覆盖（A-3）---");
const asAnySites = [];
for (const file of files) {
    const rel = relative(PLAYGROUND, file).split("\\").join("/");
    const src = await readFile(file, "utf8");
    const hits = src
        .split("\n")
        .map((line, i) => ({ line, no: i + 1 }))
        .filter(({ line }) => /\(\s*store\s+as\s+any\s*\)/.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line));
    if (hits.length) asAnySites.push(`${rel}:${hits[0].no} (${hits.length} 处)`);
}
check(
    "全仓零 `(store as any)` —— 存档字段均由 storage.ts 的 store 类型声明覆盖",
    asAnySites.length === 0,
    asAnySites.join(" | "),
);

// ---------- ⑤ ui/ 不得承担持久化与网络 ----------
console.log("\n--- ui/ 层职责边界 ---");
const uiFiles = files.filter((f) => relative(PLAYGROUND, f).split("\\").join("/").startsWith("ui/"));
const uiViolations = [];
for (const file of uiFiles) {
    const rel = relative(PLAYGROUND, file).split("\\").join("/");
    const src = await readFile(file, "utf8");
    for (const [pattern, what] of [
        [/localStorage\s*\./, "localStorage"],
        [/\bfetch\s*\(/, "fetch"],
        [/indexedDB/, "indexedDB"],
    ]) {
        const hit = src
            .split("\n")
            .map((line, i) => ({ line, no: i + 1 }))
            .find(({ line }) => pattern.test(line) && !/^\s*(\/\/|\*|\/\*)/.test(line));
        if (hit) uiViolations.push(`${rel}:${hit.no} 使用了 ${what}`);
    }
}
check(
    `ui/ 层（${uiFiles.length} 个模块）不碰 localStorage / fetch / indexedDB`,
    uiViolations.length === 0,
    uiViolations.join(" | "),
);

// ---------- ⑤b 【Phase 5-A】ui/ 不得修改任何世界状态 ----------
console.log("\n--- ui/ 层不得修改世界状态（Phase 5 §2 / §14）---");
{
    const mutators = [];
    for (const file of uiFiles) {
        const rel = relative(PLAYGROUND, file).split("\\").join("/");
        const src = await readFile(file, "utf8");
        src.split("\n").forEach((line, i) => {
            if (/^\s*(\/\/|\*|\/\*)/.test(line)) return;
            // 跳过"缺陷注入标记"注释行（注入是临时实验，不应被静态守卫误报）
            if (line.includes("\u{1F9EA}")) return;
            // 对 store / aiState 的**赋值**（含 += / ++ / Object.assign）
            const writesStore = /\bstore\s*\.[A-Za-z_$][\w$]*\s*(=[^=]|\+=|-=|\*=|\+\+|--)/.test(line);
            const assignsStore = /Object\.assign\(\s*store\b/.test(line);
            const writesAiState = /\baiState\s*\[[^\]]*\]\s*(=[^=]|\+=|-=)/.test(line) ||
                /\baiState\s*\.[A-Za-z_$][\w$]*\s*(=[^=]|\+=|-=)/.test(line);
            if (writesStore || assignsStore || writesAiState) {
                mutators.push(`${rel}:${i + 1} ${line.trim().slice(0, 80)}`);
            }
        });
    }
    check(
        "ui/ 层不修改 store / aiState（世界状态只由 Core 与 Director 经闸门修改）",
        mutators.length === 0,
        mutators.slice(0, 4).join(" | "),
    );
}

// ---------- ⑥ 存档写入必须走 storage.ts 的 saveState（3.7 的理由）----------
console.log("\n--- 存档写入出口唯一性（3.7）---");
// 为什么这条值得断言：saveState() 内含**只读守卫**（存档损坏/未来版本/读取失败时拒绝写入，
// 避免把用户那份可能可修复的数据永久覆盖）。如果有人在别处直接写存档键，
// 就会绕过这个守卫 —— 而"绕过了守卫"在功能断言里几乎看不出来（写入是成功的）。
const SAVE_KEY_LITERAL = /["'`]melai-state/;
const bypass = [];
for (const [rel, src] of sourcesCache) {
    if (rel === "storage.ts") continue; // 守卫本身在这里
    const hit = src
        .split("\n")
        .map((line, i) => ({ line, no: i + 1 }))
        .find(({ line }) => SAVE_KEY_LITERAL.test(line) && /setItem|removeItem/.test(line));
    if (hit) bypass.push(`${rel}:${hit.no} ${hit.line.trim().slice(0, 80)}`);
}
check(
    "除 storage.ts 外，无人直接写 `melai-state-*` 存档键（只读守卫不会被绕过）",
    bypass.length === 0,
    bypass.join(" | "),
);

// ---------- ⑦ 网络出口：ai/ 必须是唯一出口（A-1） ----------
console.log("\n--- 网络出口唯一性（A-1）---");
const fetchSites = [];
for (const file of files) {
    const rel = relative(PLAYGROUND, file).split("\\").join("/");
    const src = await readFile(file, "utf8");
    const hits = src
        .split("\n")
        .map((line, i) => ({ line, no: i + 1 }))
        .filter(
            ({ line }) =>
                /\bfetch\s*\(/.test(line) &&
                !/^\s*(\/\/|\*|\/\*)/.test(line) &&
                !/window\.fetch|globalThis\.fetch/.test(line),
        );
    if (hits.length) fetchSites.push(`${rel}:${hits[0].no} (${hits.length} 处)`);
}
console.log(`    直接调用 fetch 的模块：${fetchSites.join(", ") || "(无)"}`);
// 归一后 ai/ 目录下有 `ai.ts`（原 AI 引擎，仍是主角对话的出口）与 `ai/client.ts`（共享传输层）。
// 因此判定条件是"路径以 ai 开头且紧跟 . 或 /"，而不是"以 ai/ 开头"——
// 后者会让 ai.ts 自己被漏掉，断言变成"vacuous pass"。
const outsideAi = fetchSites.filter((s) => !/^ai[./]/.test(s));
check(
    "fetch 只出现在 ai/ 目录（ai.ts 与 ai/client.ts）",
    outsideAi.length === 0,
    outsideAi.join(" | "),
);
check(
    "ai/ 之外的模块通过 ai/client 的传输层发起请求",
    (() => {
        const consumers = ["director.ts", "tts.ts", "menu.ts"].filter((f) => {
            const src = sourcesCache.get(f);
            return src !== undefined && /from "\.\/ai\/client"/.test(src);
        });
        return consumers.length === 3;
    })(),
    "director.ts / tts.ts / menu.ts 应各自 import ai/client",
);

console.log(`\n========== 架构边界: ${passed} 通过 / ${failed} 失败 ==========`);
process.exit(failed === 0 ? 0 : 1);
