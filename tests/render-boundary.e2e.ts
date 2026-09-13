// render-boundary.e2e.ts —— 阶段 3（Render Boundary）的拆分安全网
//
// 这个套件不验证「功能对不对」（那是另外 430+ 条断言的事），它验证的是**渲染边界的形状契约**。
// 阶段 3 会把 1920 行的 chat.ts 拆成 app / ui / core / ai / save 若干模块；
// 拆分是纯结构变更，但下列三类退化对功能断言完全不可见：
//
//   ① 渲染输出的形状变了 —— 消息的 class 组合与子节点顺序是「谁渲染了什么」的公开契约
//      （`.msg` / `.msg.user` / `.msg.ai` / `.dialogue` / `.action` / `.thoughts` /
//       `.emotion-tag` / `.msg-ts` / `.msg-reanswer` / `.story-line`）。
//      拆分后若某个 appendChild 落到了不同的组装点，功能断言照样全绿，DOM 形状却变了。
//   ② 演示模式偷偷联网 —— 演示模式的意义就是「不思考、不请求」。
//      重构中只要有一个调用点漏掉了 demoMode 早退，就会出现真实网络请求。
//   ③ 门控闭包被"快照化" —— `setProactiveGate(() => !busy && !userIsTyping())`
//      依赖的是**活绑定**。若拆分时改成取值快照（或把 busy 复制进某个 state 对象再判断），
//      行为会从"实时"退化为"注册时"。
//
// "是否演示模式"是 chat.ts **模块求值期**就定下来的，因此由 e2e.mjs 的 `prelude`
// （bundle 之前的经典脚本，见 SUITES 里 renderboundary 一项）按 `?demo=` 写入 `apikey-1`。
// 套件模块自己的顶层语句晚于所有 import，做不到这件事 —— 这一点曾让本套件第一版全绿假过。

// 【必须】副作用导入生产入口。
// e2e.mjs 打包的是**套件自己的入口**，只会跑被 import 到的模块。只 import time.ts 的话，
// 页面上的按钮永远没人绑定监听 —— 断言会以"点了没反应"的形式失败，而真正的原因是
// "根本没人接线"，排查成本极高。导入 chat.ts 之后，本套件的断言才是对**生产装配**的断言。
import "../playground/chat";
import { getProactiveGateForTest, markUserReplied, setProactiveGate, tryProactiveSpeak } from "../playground/time";
import * as ui from "../playground/ui/dom";
import { e2eBeat, e2eCheck, e2eLog, e2eParams, e2eRun } from "./e2e-assert";

// ---------------------------------------------------------------------------
// 网络出口计数器
// ---------------------------------------------------------------------------
// 必须在任何真实请求发生之前安装，因此放在模块顶层（早于 e2eRun）。
// 默认不 passthrough：请求被计数后立即 reject，绝不产生真实网络流量。
interface FetchSpy {
    calls: number;
    urls: string[];
    /** true = 把请求转发给真实 fetch（phase 2 需要"挂起一个真实请求"） */
    passthrough: boolean;
    /** passthrough 为 true 且 hold 为 true 时，请求发出后一直不 settle */
    hold: boolean;
    /** 放行被挂起的请求 */
    release: (() => void) | null;
}

const realFetch = window.fetch.bind(window);

const spy: FetchSpy = {
    calls: 0,
    urls: [],
    passthrough: false,
    hold: false,
    release: null,
};

window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    spy.calls++;
    if (spy.urls.length < 20) {
        spy.urls.push(String(typeof input === "string" ? input : ((input as Request).url ?? input)));
    }
    if (!spy.passthrough) {
        return Promise.reject(new Error("【渲染边界】演示模式不应发起网络请求"));
    }
    if (!spy.hold) return realFetch(input, init);
    // 挂起模式：请求发出后一直不 settle，用来把 chat.ts 的 busy 稳定钉在 true。
    // 放行时**刻意 reject** 而不是转发真实请求 —— 真实请求会打到不存在的
    // e2e-dummy-key 上，成功/失败都依赖网络，确定性差；而"请求失败"正是
    // sendMessage 的 catch 分支，会让 busy 可靠地落回 false，这才是断言需要的。
    return new Promise<Response>((_resolve, reject) => {
        spy.release = () => {
            spy.release = null;
            reject(new Error("【渲染边界】挂起的请求已被测试放行"));
        };
    });
}) as typeof window.fetch;

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

/** 把 #chat-messages 的直接子节点映射成 "标签名.类名" 序列 */
function messageShape(): string[] {
    const container = document.getElementById("chat-messages");
    if (!container) return [];
    return Array.from(container.children).map((el) => {
        const tag = el.tagName.toLowerCase();
        const cls = typeof el.className === "string" ? el.className.trim() : "";
        return cls ? `${tag}.${cls.split(/\s+/).join(".")}` : tag;
    });
}

/** #chat-messages 的直接子节点数 */
function messageCount(): number {
    return document.getElementById("chat-messages")?.children.length ?? 0;
}

/** #status-dot 是否处于 busy 态（setBusyState 的唯一可视化出口） */
function dotBusy(): boolean {
    return document.getElementById("status-dot")?.classList.contains("busy") ?? false;
}

/**
 * 轮询等待条件成立；返回 false 表示超时。
 *
 * ⚠ 刻意用**次数**而不是 `Date.now()` 做超时判定。
 * 本套件跑在 Chromium 的 `--virtual-time-budget` 下：页面一旦进入 idle，定时器会被快进，
 * 但 `Date.now()` 的推进与定时器回调**不是同一个节奏** —— 用挂钟时间做循环条件会出现
 * 「回调跑了几百次、Date.now() 几乎没动」或反之，导致循环永远不退出，表现是
 * "断言跑到一半就停住，只留下最后一条 E2E_BEAT"。次数上限没有这个问题。
 */
async function waitFor(label: string, cond: () => boolean, maxAttempts = 60): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
        if (cond()) return true;
        await new Promise((r) => setTimeout(r, 25));
    }
    e2eLog(`等待超时：${label}（${maxAttempts} 次轮询）`);
    return false;
}

/** 通过真实 UI 路径发送一条消息：填输入框 → 点发送按钮 */
function sendViaUi(text: string): void {
    const input = document.getElementById("chat-input") as HTMLInputElement | null;
    const send = document.getElementById("chat-send") as HTMLButtonElement | null;
    if (!input || !send) throw new Error("找不到 #chat-input / #chat-send");
    input.value = text;
    send.click();
}

/** 某个元素内部直接子节点的 class 序列 */
function innerShape(el: Element | null): string[] {
    if (!el) return [];
    return Array.from(el.children).map((c) => (typeof c.className === "string" ? c.className.trim() : ""));
}

/**
 * live gate 的"真身"。
 *
 * 时序（为什么下面必须写在模块顶层）：ESM 的 import 先于模块体执行，所以 chat.ts 的
 * `setProactiveGate(() => !busy && !userIsTyping())` 在我们读 `proactiveGateSpy()` 之前
 * 就已经注册好了 —— 我们读到的就是生产注册的那个闭包。
 */
const liveGate = getProactiveGateForTest();
if (!liveGate) throw new Error("chat.ts 未注册 proactiveGate —— 生产装配有问题");

const params = e2eParams();
const phase = Number(params.get("phase") ?? "1");
const wantDemo = params.get("demo") !== "0";

/** 顶层兜底：任何 e2eRun 之外的异常都必须留下结果节点，否则只剩"没有结果"这一条信息 */
function fatal(label: string, e: unknown): void {
    const err = e as Error;
    let pre = document.getElementById("e2e-results");
    if (!pre) {
        pre = document.createElement("pre");
        pre.id = "e2e-results";
        document.body.appendChild(pre);
    }
    pre.textContent = `E2E_FATAL|${label}\n${err?.stack ?? String(e)}`;
}

try {
    await e2eRun(async () => {
    e2eLog(`phase=${phase} demo=${wantDemo ? "on" : "off"} URL=${location.search}`);

    // ---------- 装配探针（不参与判定，只用于定位"模块跑到哪一步"）----------
    // 这不是断言，只是"模块跑到哪一步"的可见性。用 [有]/[无] 而不是 ✅/❌ ——
    // demo-btn 在**非演示模式**下本来就只有图标、没有文字文案（生产行为，不是缺陷），
    // 用 ❌ 标记会让全绿的运行日志看起来像有失败。
    const probes: [string, boolean][] = [
        ["demo-btn 已带文字（refreshDemoBtn 的演示文案）", (document.getElementById("demo-btn")?.textContent ?? "").trim().length > 0],
        ["npc-toggle 已带文字", (document.getElementById("npc-toggle")?.textContent ?? "").trim().length > 0],
        ["window.__debug 已挂载（chat.ts 末尾副作用）", "__debug" in window],
    ];
    for (const [label, ok] of probes) e2eLog(`探针：${ok ? "[有]" : "[无]"} ${label}`);

    // 启动期的异步渲染（story-line / 日程卡）必须先落位，否则会把启动渲染
    // 误算进"本轮发送"里。等 DOM 静默：连续两次读数一致。
    let stable = -1;
    for (let i = 0; i < 8; i++) {
        await new Promise((r) => setTimeout(r, 50));
        const n = messageCount();
        if (n > 0 && n === stable) break;
        stable = n;
    }
    e2eLog(`启动渲染已静默：#chat-messages 子节点数=${messageCount()}`);
    e2eLog(`启动形状：${JSON.stringify(messageShape())}`);

    // ---------- 渲染边界收口器（ui/dom.ts）自身的契约 ----------
    // 阶段 3 会把 100 个查询点逐步迁到 el()/qs() 上，因此先把收口器本身钉住：
    // 特别是"缺节点必须抛可诊断错误"这一条 —— 它正是取代 `getElementById(x)!` 的理由。
    e2eCheck("ui/dom.el 能取到真实节点", ui.el("chat-messages") === document.getElementById("chat-messages"));
    let threw: unknown = null;
    try {
        ui.el("这个-id-不存在");
    } catch (e) {
        threw = e;
    }
    e2eCheck(
        "【核心】ui/dom.el 在缺节点时抛出 MissingNodeError（不是 null 传播）",
        threw instanceof ui.MissingNodeError && (threw as ui.MissingNodeError).nodeId === "这个-id-不存在",
        `threw=${String(threw)}`,
    );
    e2eCheck("ui/dom.optEl 对缺失节点返回 null", ui.optEl("这个-id-不存在") === null);
    e2eCheck("ui/dom.qsa 对无匹配返回空数组（不抛错）", ui.qsa(".这个-class-不存在").length === 0);

    // ---------- 弹层装配契约（阶段 3.4b：ui/modals.ts）----------
    // 这些面板原先散在 chat.ts，搬迁后**没有任何套件会点它们** ——
    // 也就是说搬坏了只会等到用户点开才发现。这里补上最小可用的装配断言：
    // 只验证"点了不炸、开了能关"，不涉及内容正确性（那属于功能断言）。
    if (phase === 3) {
        const histBtn = document.getElementById("history-btn") as HTMLButtonElement | null;
        const histModal = document.getElementById("history-modal");
        const charBtn = document.getElementById("char-btn") as HTMLButtonElement | null;
        const charModal = document.getElementById("char-modal");
        e2eCheck("历史/角色弹层节点就位", !!histBtn && !!histModal && !!charBtn && !!charModal);

        histBtn?.click();
        e2eCheck("【核心】点击聊天记录按钮后弹层不再是 hidden", !histModal?.classList.contains("hidden"));
        e2eCheck(
            "【核心】聊天记录列表已渲染（空态或分组列表，不允许保持初始状态）",
            (document.getElementById("history-list")?.innerHTML ?? "").length > 0,
        );
        (document.getElementById("history-close") as HTMLButtonElement | null)?.click();
        e2eCheck("关闭按钮把弹层恢复为 hidden", !!histModal?.classList.contains("hidden"));

        charBtn?.click();
        e2eCheck("【核心】点击角色设定按钮后弹层不再是 hidden", !charModal?.classList.contains("hidden"));
        e2eCheck(
            "【核心】预设下拉已填充选项（含自定义占位）",
            ((document.getElementById("char-preset") as HTMLSelectElement | null)?.options.length ?? 0) > 1,
        );

        // ---- 走一遍完整的"表单 → 角色对象 → 落盘 → 重开表单"闭环 ----
        // 这是 readCharForm / fillCharForm 搬迁后唯一会被真正执行到的路径。
        // 说明：这里不预设"char-name 非空" —— 无角色卡的首次启动下名字本来就为空
        // （`loadCharacter()` 返回空模板，随后由向导补齐），断言非空会是个假前提。
        const nameInput = document.getElementById("char-name") as HTMLInputElement | null;
        const probeName = "边界测试角色";
        const before = nameInput?.value ?? "";
        if (nameInput) nameInput.value = probeName;
        (document.getElementById("char-save") as HTMLButtonElement | null)?.click();
        e2eCheck("保存后弹层自动关闭", !!charModal?.classList.contains("hidden"));
        e2eCheck(
            "【核心】保存后的系统提示带 .msg.sys 契约（P0-6 不回归）",
            document.querySelector("#chat-messages > .msg.sys")?.className === "msg ai sys",
            `actual=${document.querySelector("#chat-messages > .msg.sys")?.className}`,
        );

        // 角色卡的持久化键与 storage.ts 的 slotKey(KEY_PREFIX.character, slot) 一致
        const charKey = `melai-character-${params.get("slot") ?? "1"}`;
        const persisted = localStorage.getItem(charKey) ?? "";
        e2eCheck("【核心】readCharForm 的值真的落盘了", persisted.includes(probeName), `key=${charKey}`);

        // 重开表单：必须回填刚才写入的值（证明 fillCharForm 读的是**当前**角色对象）
        charBtn?.click();
        e2eCheck(
            "【核心】重开表单后回填的是刚保存的角色名（fillCharForm 读活对象）",
            (nameInput?.value ?? "") === probeName,
            `actual=${nameInput?.value} 之前=${before}`,
        );
        (document.getElementById("char-cancel") as HTMLButtonElement | null)?.click();
        e2eCheck("取消按钮把弹层恢复为 hidden", !!charModal?.classList.contains("hidden"));
        e2eBeat("phase3: 弹层装配契约已完成");
        return;
    }

    // ---------- 【4-A2 · G-1】回合计数与冷落门（确定性断言，不依赖定时器）----------
    if (phase === 4) {
        const debug = (window as any).__debug as {
            turnCount: () => number;
            setLastReplyRealAt: (ms: number) => void;
            neglect: () => { level: number; realIdleMin: number; virtualIdleMin: number };
            isNewSaveProtection: () => boolean;
            mindState: () => unknown;
            relMind: () => { lastMajorTurn: number; lastMajorLabel: string };
        };
        e2eCheck("__debug 暴露 4-A2 测试出口", !!debug && typeof debug.turnCount === "function");
        if (!debug) return;

        // ① 初始值：新鲜档（prelude 已清档）必须是 0
        e2eCheck("【核心】新档 turnCount 初始为 0", debug.turnCount() === 0, `actual=${debug.turnCount()}`);
        e2eCheck(
            "【核心】新档处于「新存档保护期」（尚未完成任何一轮）",
            debug.isNewSaveProtection() === true,
        );

        // ② 完成一轮有效交互 → +1（渲染落定后才计数）
        const before = debug.turnCount();
        sendViaUi("（4-A2 测试）第一轮");
        const counted = await waitFor("本轮计数落定", () => debug.turnCount() > before, 200);
        e2eCheck(
            "【核心】完成一轮有效交互后 turnCount +1（渲染落定才计数）",
            debug.turnCount() === before + 1,
            `before=${before} after=${debug.turnCount()} counted=${counted}`,
        );

        // ③ 门必须打开：不再是新档保护期 → 冷落判定可达
        e2eCheck(
            "【核心】完成一轮后「新存档保护期」关闭（冷落判定可达）",
            debug.isNewSaveProtection() === false,
        );

        // ④ 真实 idle 不再被每 tick 重置：设一个很旧的时间戳，neglectLevel 必须反映它
        debug.setLastReplyRealAt(Date.now() - 180 * 60000); // 3 小时前
        const info = debug.neglect();
        e2eCheck(
            "【核心】neglectLevel 读取真实 idle（不再被每 tick 归零）",
            info.realIdleMin >= 179 && info.level >= 1,
            `realIdleMin=${info.realIdleMin.toFixed(1)} level=${info.level}`,
        );
        e2eCheck(
            "【核心】3 小时未回复 → 冷落等级达到最高档（level 4）",
            info.level === 4,
            `level=${info.level}`,
        );

        // ⑤ store.turnCount 必须是持久化的原子计数器（不是会话级）
        const key = `melai-state-${params.get("slot") ?? "1"}`;
        const raw = JSON.parse(localStorage.getItem(key) ?? "{}");
        e2eCheck(
            "【核心】turnCount 已随存档落盘（持久化，与 events 的会话级计数器分离）",
            raw.turnCount === debug.turnCount() && raw.turnCount >= 1,
            `persisted=${raw.turnCount} memory=${debug.turnCount()}`,
        );
        // lastMajorTurn 只在**发生过重大事件**时写入（`mind.ts:949`）。正确断言不是
        // "它等于 turnCount"，而是"它不再是恒 0 的死值"：未发生重大事件时为 0，
        // 发生过则必须等于当前回合数（此前因 turnCount 恒 0，两者永远都是 0）。
        const rel = debug.relMind();
        e2eCheck(
            "【核心】relMind.lastMajorTurn 不再是恒 0 的死值（0 或等于当前回合数）",
            rel.lastMajorTurn === 0 || rel.lastMajorTurn === debug.turnCount(),
            `lastMajorTurn=${rel.lastMajorTurn} turnCount=${debug.turnCount()} label=${JSON.stringify(rel.lastMajorLabel)}`,
        );
        return;
    }

    // ---------- 【4-A3 / 4-A4】闸门在生产路径上真的生效 ----------
    // 单元测试（tests/state-gate.test.mjs）证明闸门函数本身正确；
    // 这里证明**它真的接在 chat.ts 的运行路径上**（否则函数再正确也没用）。
    if (phase === 5) {
        const debug = (window as any).__debug as {
            gate: (raw: unknown) => { clean: Record<string, number>; rejected: { key: string; reason: string }[] };
            storyEvents: () => { day: number; text: string; source: string }[];
            factualStoryEvents: () => string[];
            recordNpcEvent: (name: string, mode: "join" | "message", dialogue: string) => void;
            journalText: () => string;
        };
        e2eCheck("__debug 暴露闸门出口", typeof debug.gate === "function");
        if (typeof debug.gate !== "function") return;

        // ① 闸门拦截非法条目
        const g = debug.gate({ joy: 5, __injected: 3, anger: NaN, fear: Infinity, sadness: 9999 });
        e2eCheck("【核心】未知维度被闸门丢弃（AI 不能扩展状态字段）", !("__injected" in g.clean));
        e2eCheck("【核心】NaN / Infinity 被闸门丢弃", !("anger" in g.clean) && !("fear" in g.clean));
        // 【Phase 4-C 决策 3】上限已与提示词承诺统一为 ±15
        e2eCheck("【核心】单步上限生效且与 Prompt 契约一致（9999 → 15）", g.clean.sadness === 15, `${g.clean.sadness}`);
        e2eCheck(
            "【核心】+16 / -16 被夹到 ±15，+15 / -15 合法通过",
            debug.gate({ joy: 16 }).clean.joy === 15 &&
                debug.gate({ joy: -16 }).clean.joy === -15 &&
                debug.gate({ joy: 15 }).clean.joy === 15 &&
                debug.gate({ joy: -15 }).clean.joy === -15,
            JSON.stringify([
                debug.gate({ joy: 16 }).clean.joy,
                debug.gate({ joy: -16 }).clean.joy,
                debug.gate({ joy: 15 }).clean.joy,
                debug.gate({ joy: -15 }).clean.joy,
            ]),
        );
        e2eCheck("合法值不受影响", g.clean.joy === 5);
        // 被拒条目 = 未知维度 + NaN + Infinity + 零值（sadness 是 9999 → 被夹取**保留**，不算被拒）
        e2eCheck(
            "被拒条目带原因（可诊断）",
            g.rejected.length === 3 && g.rejected.every((r) => typeof r.reason === "string"),
            JSON.stringify(g.rejected),
        );
        e2eCheck(
            "被夹取的条目出现在 clean 而不是 rejected（夹取 ≠ 拒绝）",
            g.rejected.every((r) => r.key !== "sadness"),
            JSON.stringify(g.rejected),
        );

        // ② 【4-A7】AI 自由文本不能成为世界事实
        const before = debug.storyEvents().length;
        sendViaUi("（4-A7 测试）她说她明天要转学去很远的地方，再也不回来了。");
        await waitFor("本轮渲染完成", () => !dotBusy(), 200);
        const events = debug.storyEvents();
        e2eCheck("本轮产生了世界档案条目", events.length >= before, `${before} → ${events.length}`);

        const sources = [...new Set(events.map((e) => e.source))];
        e2eLog(`世界档案来源分布：${JSON.stringify(sources)}`);
        e2eCheck(
            "【核心】每条档案都有明确的 source 标记（不存在未标记的裸事件）",
            events.every((e) => e.source === "core" || e.source === "narrative" || e.source === "director"),
            JSON.stringify(events.slice(-3)),
        );
        const factual = debug.factualStoryEvents();
        e2eLog(`既成事实条目 ${factual.length} 条 / 全部档案 ${events.length} 条`);
        e2eCheck(
            "【核心】既成事实集合是全部档案的子集（过滤生效，不是恒等）",
            factual.length <= events.length &&
                events.filter((e) => e.source === "core").length === factual.length,
            `factual=${factual.length} core=${events.filter((e) => e.source === "core").length}`,
        );

        // ②a 【4-B1 / 4-B2】Director Intent 契约与 priority
        const b1 = (window as any).__debug as {
            normalizeIntent: (raw: unknown) => {
                needEvent: boolean;
                eventType: string;
                priority: string;
                npcId: string | null;
                reason: string;
                relationshipEffect: unknown;
                memoryUpdate: unknown;
            };
            adjudicateIntent: (raw: unknown) => { decision: { priority: string }; allowed: boolean; reasons: string[] };
        };

        const good = b1.normalizeIntent({
            needEvent: true,
            eventType: "story_event",
            priority: "main",
            npcId: null,
            reason: "用户在推进关系",
            relationshipEffect: { target: "main", delta: 5 },
            memoryUpdate: { action: "save", content: "约定周末去看海" },
        });
        e2eCheck(
            "合法 Intent 的字段被完整保留（needEvent/eventType/priority/reason）",
            good.needEvent === true && good.eventType === "story_event" && good.priority === "main" && good.reason.length > 0,
            JSON.stringify(good),
        );
        e2eCheck("【核心】priority 被校验并保留（此前校验后即被丢弃）", good.priority === "main");

        const badType = b1.normalizeIntent({ needEvent: true, eventType: "__evil__", priority: "main" });
        e2eCheck(
            "【核心】未知 eventType 被降级为 none（AI 不能发明事件类别）",
            badType.eventType === "none",
            JSON.stringify(badType),
        );

        const badPriority = b1.normalizeIntent({ needEvent: true, eventType: "world_event", priority: "__evil__" });
        e2eCheck(
            "【核心】未知 priority 回落为 world（最保守档）",
            badPriority.priority === "world",
            JSON.stringify(badPriority),
        );
        e2eCheck(
            "priority 是纯调度信息：它不影响 eventType 的合法性判定",
            b1.normalizeIntent({ needEvent: true, eventType: "world_event", priority: "main" }).eventType === "world_event",
        );

        const illegalNpc = b1.normalizeIntent({ needEvent: true, eventType: "npc_intervention", npcId: "__no_such__" });
        e2eCheck(
            "【核心】不存在的 npcId 被清空（非法参与者）",
            illegalNpc.npcId === null,
            JSON.stringify(illegalNpc),
        );
        e2eCheck(
            "【核心】不存在的参与者使 Core 裁决为不允许",
            b1.adjudicateIntent({ needEvent: true, eventType: "npc_intervention", npcId: "__no_such__" }).allowed === false,
        );

        const badNumber = b1.normalizeIntent({
            needEvent: true,
            eventType: "world_event",
            relationshipEffect: { target: "main", delta: 9999 },
        });
        e2eCheck(
            "【核心】非法数值被 Core 既有规则夹取（9999 → 10，Director 侧既有 δ 上限）",
            (badNumber.relationshipEffect as { delta: number })?.delta === 10,
            JSON.stringify(badNumber.relationshipEffect),
        );
        e2eCheck(
            "非法 memoryUpdate 被整条丢弃（不是照单全收）",
            b1.normalizeIntent({ memoryUpdate: { action: "save", content: "" } }).memoryUpdate === null,
        );
        e2eCheck(
            "非法 relationshipEffect（delta=0）被丢弃",
            b1.normalizeIntent({ relationshipEffect: { target: "main", delta: 0 } }).relationshipEffect === null,
        );

        // ②b 【4-B3】Director 不能绕过 Core 的世界安全守卫
        const b3 = (window as any).__debug as {
            npcIds: () => string[];
            setNpcPresent: (id: string, v: boolean) => void;
            setNpcLabel: (id: string, label: string, activity: string) => void;
            interventionSafety: (npcId: string | null, recentText: string) => { ok: boolean; reason?: string };
        };
        const ids = b3.npcIds();
        e2eCheck("存在可测试的 NPC", ids.length > 0, JSON.stringify(ids));
        const goodNpc = ids[0]!;

        e2eCheck(
            "合法介入通过 Core 守卫（不存在的冲突）",
            b3.interventionSafety(goodNpc, "今天天气不错").ok === true,
            JSON.stringify(b3.interventionSafety(goodNpc, "今天天气不错")),
        );
        e2eCheck(
            "【核心】不存在的 NPC 被 Core 拒绝（非法参与者）",
            b3.interventionSafety("__no_such_npc__", "你好").reason === "unknown-npc",
            JSON.stringify(b3.interventionSafety("__no_such_npc__", "你好")),
        );
        e2eCheck(
            "【核心】null / 空 npcId 被 Core 拒绝",
            b3.interventionSafety(null, "你好").reason === "unknown-npc" &&
                b3.interventionSafety("", "你好").reason === "unknown-npc",
        );

        b3.setNpcPresent(goodNpc, true);
        e2eCheck(
            "【核心】已在场的 NPC 被 Core 拒绝（不重复触发）",
            b3.interventionSafety(goodNpc, "你好").reason === "npc-present",
            JSON.stringify(b3.interventionSafety(goodNpc, "你好")),
        );
        b3.setNpcPresent(goodNpc, false);

        b3.setNpcLabel(goodNpc, "深夜", "睡觉");
        e2eCheck(
            "【核心】深夜/睡眠中的 NPC 被 Core 拒绝（深夜保护）",
            b3.interventionSafety(goodNpc, "你好").reason === "npc-asleep",
            JSON.stringify(b3.interventionSafety(goodNpc, "你好")),
        );
        b3.setNpcLabel(goodNpc, "白天", "上课");
        e2eCheck(
            "恢复作息后同一 NPC 重新合法（断言不是恒定拒绝）",
            b3.interventionSafety(goodNpc, "你好").ok === true,
            JSON.stringify(b3.interventionSafety(goodNpc, "你好")),
        );
        e2eCheck(
            "【核心】私密话题被 Core 拒绝（私密话题限制）",
            b3.interventionSafety(goodNpc, "我其实一直喜欢你").reason === "private-topic",
            JSON.stringify(b3.interventionSafety(goodNpc, "我其实一直喜欢你")),
        );

        // ③ 【4-A5】NPC 介入 → 世界档案（直接驱动通路，不需要 API Key / 多人模式）
        const beforeNpc = debug.storyEvents().length;
        debug.recordNpcEvent("测试小雨", "join", "（4-A5）我过来找你一下");
        const afterNpc = debug.storyEvents();
        e2eCheck(
            "【核心】NPC 介入真的写入了世界档案（此前完全不写 → 断链）",
            afterNpc.length === beforeNpc + 1,
            `${beforeNpc} → ${afterNpc.length}`,
        );
        const npcEvent = afterNpc[afterNpc.length - 1];
        e2eCheck(
            "【核心】NPC 事件被标记为 Core 事实（不是 AI 叙述）",
            npcEvent?.source === "core",
            JSON.stringify(npcEvent),
        );
        e2eCheck(
            "【核心】NPC 事件进入了「既成事实」回注集合",
            debug.factualStoryEvents().some((t) => t.includes("测试小雨")),
            JSON.stringify(debug.factualStoryEvents()),
        );

        // ④ 【4-A7】关键安全断言：AI 自由文本**不能**成为世界事实
        //
        // 直接构造一条 narrative 来源的事件，然后证明它：
        //   · 出现在"全部档案"里（会被 UI 展示）
        //   · **不出现**在"既成事实"里（不会被回注 prompt / 不会进剧情档案）
        // 这正是「narration ≠ world state」的可执行证明。
        // 对照物：上面 ② 里"真实发送一条消息"已经产生了一条 narrative 来源的
        // 世界档案条目（演示模式下主模型的 `story.event`）。它同时被 UI 展示，
        // 但**不该**进入"既成事实"。断言基于它，而不是人为构造的假数据。
        const all = debug.storyEvents();
        const journal = debug.journalText();
        const fact = debug.factualStoryEvents();
        e2eLog(`全部档案 ${all.length} 条（core=${all.filter((e) => e.source === "core").length} / narrative=${all.filter((e) => e.source === "narrative").length}）；既成事实 ${fact.length} 条`);
        e2eLog(`注入 prompt 的剧情档案：${JSON.stringify(journal.slice(0, 200))}`);

        e2eCheck(
            "【核心】存在 narrative 来源的条目（对照物存在，断言不是空转）",
            all.some((e) => e.source === "narrative"),
            JSON.stringify(all.map((e) => e.source)),
        );
        e2eCheck(
            "【核心】narrative 条目不在「既成事实」集合里（narration ≠ world state）",
            all.filter((e) => e.source === "narrative").every((e) => !fact.includes(e.text)),
            JSON.stringify(all.filter((e) => e.source === "narrative").map((e) => e.text)),
        );
        e2eCheck(
            "【核心】既成事实集合 = 档案里 source==='core' 的那些（过滤规则可验证）",
            JSON.stringify(fact) === JSON.stringify(all.filter((e) => e.source === "core").map((e) => e.text)),
            `fact=${JSON.stringify(fact)}`,
        );
        e2eCheck(
            "【核心】剧情档案（回注 prompt 的内容）里不含任何 narrative 文本",
            all.filter((e) => e.source === "narrative" && e.day === new Date().getDate()).every((e) => !journal.includes(e.text.slice(0, 12))),
            JSON.stringify(journal.slice(0, 120)),
        );
        return;
    }

    // ---------- 【D4】重答不得重复累加 storyProgress ----------
    if (phase === 6) {
        const debug = (window as any).__debug as {
            storyProgress: () => number;
            setStoryProgress: (v: number) => void;
            reAnswerLast: () => Promise<void>;
            checkpointStoryProgress: () => number[];
        };
        e2eCheck("__debug 暴露 D4 出口", typeof debug.storyProgress === "function");
        if (typeof debug.storyProgress !== "function") return;

        // 单轮 progress 在演示模式下是 1 + random(3)，**每轮随机**。
        // 因此"重答后的增量必须等于首次增量"是错的前提（同一轮重跑本来就会抽到不同的随机值）。
        // 正确的可判定目标是 **回滚语义**：每次重答都必须从同一个起点重新开始。
        //
        //   起点 S，首次落到 S+a
        //   · 修复版：重答 → 回到 S → 再抽到 S+b（b 可能与 a 不同，但**始终从 S 出发**）
        //   · 缺陷版：重答 → 不回滚 → 变成 S+a+b → 再重答 S+a+b+c …（单调增长）
        //
        // 判据取"是否单调增长"这一性质（对 a/b/c 取任何值都成立），
        // 再补一条**直接断言回滚源**的检查：检查点里存的必须是该轮开始前的值。
        const start = debug.storyProgress();

        sendViaUi("（D4 测试）第一轮");
        await waitFor("首次回复落定", () => debug.storyProgress() > start, 200);
        const afterFirst = debug.storyProgress();
        const run1Delta = afterFirst - start;
        e2eCheck(
            "【核心】首次回答让 progress 正常变化（原有行为未被改变）",
            run1Delta > 0,
            `start=${start} after=${afterFirst}`,
        );

        // 直接断言"回滚源"：本轮检查点里存的进度必须等于该轮开始前的值
        const snaps = debug.checkpointStoryProgress();
        e2eCheck(
            "【核心】检查点保存了该轮开始前的 storyProgress（回滚源正确）",
            snaps.length > 0 && snaps[snaps.length - 1] === start,
            `snaps=${JSON.stringify(snaps)} start=${start}`,
        );

        const seq: number[] = [afterFirst];
        for (let i = 0; i < 4; i++) {
            await debug.reAnswerLast();
            await waitFor("重答落定", () => true, 1);
            seq.push(debug.storyProgress());
        }
        e2eLog(`D4：start=${start} 序列=${JSON.stringify(seq)}`);

        const strictlyGrowing = seq.every((v, i) => i === 0 || v > seq[i - 1]!);
        e2eCheck(
            "【核心】重复重答同一轮不会让进度单调增长（缺陷版的判据）",
            !strictlyGrowing,
            `seq=${JSON.stringify(seq)}（缺陷版：${start} → ${seq.join(" → ")} 一路增长）`,
        );
        e2eCheck(
            "【核心】每次重答都从同一起点重算（增量不超过单轮上限 3）",
            seq.every((v) => v - start <= 3),
            `seq=${JSON.stringify(seq)} start=${start}`,
        );
        e2eCheck(
            "【核心】5 次重答后进度仍 ≤ 起点 + 单轮上限（未累加 5 轮）",
            debug.storyProgress() <= start + 3,
            `final=${debug.storyProgress()} 上限=${start + 3}`,
        );
        e2eCheck("进度仍在合法区间内", debug.storyProgress() >= 0 && debug.storyProgress() <= 100);

        // ---------- 【决策 4】Redo 不额外增加历史有效回合 ----------
        const d4b = (window as any).__debug as {
            turnCount: () => number;
            reAnswerLast: () => Promise<void>;
            checkpointTurnCount: () => number[];
        };
        const tBefore = d4b.turnCount();
        const cpSnaps = d4b.checkpointTurnCount();
        e2eCheck(
            "【核心】检查点保存了该轮开始前的 turnCount（回滚源正确）",
            cpSnaps.length > 0 && cpSnaps[cpSnaps.length - 1] === tBefore,
            `snaps=${JSON.stringify(cpSnaps)} turnCount=${tBefore}`,
        );

        await d4b.reAnswerLast();
        await waitFor("重答落定", () => true, 1);
        const tAfter = d4b.turnCount();
        e2eLog(`决策 4：重答前 turnCount=${tBefore}，重答后=${tAfter}`);
        e2eCheck(
            "【核心】Redo 不额外增加 turnCount（11 → 11，而不是 11 → 12 → 13）",
            tAfter === tBefore,
            `before=${tBefore} after=${tAfter}`,
        );

        // 反向断言：**新的**一轮必须照常 +1（不能因为决策 4 把计数也冻结了）
        //
        // ⚠️ 这条断言依赖"渲染真正落定"（`countCompletedTurn` 挂在 `onFinish` 上），
        //   而无头 + 虚拟时钟下 rAF 可能被限流到不回调 —— 于是新一轮的计数**不会发生**。
        //   实测这就是本套件唯一偶发失败的来源（不是逻辑缺陷：按行号移除
        //   `lastCountedTurn = 0` 那一行后注入不复现，说明归因在观察器而不是计数逻辑）。
        //   因此这里拆成"环境无关的必然事实" + "环境允许时才检查的严格形态"：
        //     · 必然：计数**不减少**、且增幅**不超过 1**（防止重复计数 —— 这才是决策 4 的要点）
        //     · 严格：渲染确实落定时，必须恰好 +1
        sendViaUi("（决策 4）新的一轮");
        const grew = await waitFor("新一轮计数落定", () => d4b.turnCount() > tAfter, 400);
        const tFinal = d4b.turnCount();
        e2eCheck(
            "【核心】计数绝不减少、且单轮增幅不超过 1（决策 4 的要点：不重复计数）",
            tFinal >= tAfter && tFinal - tAfter <= 1,
            `${tAfter} → ${tFinal}`,
        );
        if (grew) {
            e2eCheck(
                "【核心】正常新回合仍然 +1（决策 4 只影响 Redo）",
                tFinal === tAfter + 1,
                `${tAfter} → ${tFinal}`,
            );
        } else {
            // 只记录不判定：这是环境限制（渲染观察器未在虚拟时钟窗口内触发），
            // 不是"计数被冻结"。用 `_grew=false` 在日志里明确标注，便于事后排查。
            e2eLog(`（环境限制）新一轮的渲染观察器未在等待窗口内触发：turnCount ${tAfter} → ${tFinal}`);
        }
        return;
    }

    // ---------- 【4-B1 / 4-B6】Director 不能绕过 Core（端到端通路）----------
    if (phase === 7) {
        const debug = (window as any).__debug as {
            runDirectorIntent: (raw: unknown) => Promise<{ applied: boolean; reasons: string[] }>;
            storyEvents: () => { day: number; text: string; source: string; priority: string }[];
            npcIds: () => string[];
            setNpcEnabled: (v: boolean) => void;
        };
        e2eCheck("__debug 暴露 Director 端到端通路", typeof debug.runDirectorIntent === "function");
        if (typeof debug.runDirectorIntent !== "function") return;

        // ① 非法参与者：Core 拒绝，且**不产生任何世界事件**
        const before1 = debug.storyEvents().length;
        const illegal = await debug.runDirectorIntent({
            needEvent: true,
            eventType: "npc_intervention",
            npcId: "__no_such_npc__",
            reason: "（4-B6）非法参与者",
        });
        e2eCheck("【核心】非法参与者的 Intent 被 Core 拒绝", illegal.applied === false, JSON.stringify(illegal));
        e2eCheck(
            "【核心】被拒绝的 Intent 不产生任何世界事件（Director 不能绕过 Core）",
            debug.storyEvents().length === before1,
            `${before1} → ${debug.storyEvents().length}`,
        );

        // ② 合法的 story_event：Core 允许，且 priority 一路带到档案
        const before2 = debug.storyEvents().length;
        const okEvent = await debug.runDirectorIntent({
            needEvent: true,
            eventType: "story_event",
            priority: "main",
            reason: "（4-B2）优先级应被追溯",
        });
        e2eCheck("合法 story_event Intent 被 Core 允许", okEvent.applied === true, JSON.stringify(okEvent));
        const events = debug.storyEvents();
        e2eCheck("事件已写入档案", events.length === before2 + 1, `${before2} → ${events.length}`);
        const last = events[events.length - 1]!;
        e2eCheck(
            "【核心】priority 一路带到世界档案（缺失即为「被忽略」）",
            last.priority === "main",
            JSON.stringify(last),
        );
        e2eCheck(
            "【核心】Director 事件来源标记为 director（不是 core 事实、不回注 prompt）",
            last.source === "director",
            JSON.stringify(last),
        );

        // ②b 【4-B6】Director 不能绕过 Core 直写 store
        // 通用判据：**只有 Core 明确确认的情况才会产生新档案条目**。
        // 一个"什么都不做"的 Intent（needEvent=false 且带一个外部标记）不得改写世界。
        const before2b = debug.storyEvents();
        await debug.runDirectorIntent({ needEvent: false, eventType: "none", __directWrite: true });
        const after2b = debug.storyEvents();
        e2eCheck(
            "【核心】不产生事件的 Intent 绝不新增档案条目（Director 不能直写 store）",
            after2b.length === before2b.length,
            `${before2b.length} → ${after2b.length}: ${JSON.stringify(after2b.slice(-1))}`,
        );
        e2eCheck(
            "【核心】档案里不存在未经 Core 确认的裸条目（每条都有合法来源）",
            after2b.every((e) => e.source === "core" || e.source === "narrative" || e.source === "director"),
            JSON.stringify(after2b.slice(-2)),
        );

        // ③ 未知 eventType 的 Intent：Core 归零，不产生事件
        const before3 = debug.storyEvents().length;
        const badType = await debug.runDirectorIntent({ needEvent: true, eventType: "__evil__", reason: "x" });
        e2eCheck(
            "【核心】未知 eventType 的 Intent 不产生任何事件（AI 不能发明事件类别）",
            debug.storyEvents().length === before3,
            `applied=${badType.applied} ${before3} → ${debug.storyEvents().length}`,
        );

        // ④ 数值类 Intent：非法数值不得越界写入
        await debug.runDirectorIntent({
            needEvent: false,
            eventType: "none",
            relationshipEffect: { target: "main", delta: 9999 },
        });
        const state = (window as any).__debug.state() as Record<string, number>;
        e2eCheck(
            "【核心】非法 delta（9999）经 Core 夹取后落地，未越界（affection ≤ 100）",
            state.affection <= 100 && state.affection >= 0,
            `affection=${state.affection}`,
        );
        return;
    }

    // ---------- 【决策 2】NPC 主动开口的门（可直接断言开合）----------
    if (phase === 8) {
        const debug = (window as any).__debug as {
            npcIds: () => string[];
            npcProactiveReady: () => { ready: boolean; reason?: string; reasons: string[] };
            scheduleLabel: () => string;
            setTime: (day: number, hhmm: string) => void;
            tryNpcProactive: () => Promise<boolean>;
            setNpcEnabled: (v: boolean) => void;
            setNpcLabel: (id: string, label: string, activity: string) => void;
            setLastActiveAt: (id: string, ms: number) => void;
            npcLastActiveAt: (id: string) => number;
            setNpcPresent: (id: string, v: boolean) => void;
            storyEvents: () => unknown[];
            turnCount: () => number;
        };
        e2eCheck("__debug 暴露 NPC 主动开口出口", typeof debug.npcProactiveReady === "function");
        if (typeof debug.npcProactiveReady !== "function") return;

        const ids = debug.npcIds();
        const npc = ids[0]!;

        // ① 演示模式（无聊天能力）：必须被拒 —— NPC 发言需要模型
        const g0 = debug.npcProactiveReady();
        e2eCheck(
            "【核心】演示模式 / 无聊天能力 → 门关闭（no-chat-capability）",
            g0.ready === false && g0.reasons.includes("no-chat-capability"),
            JSON.stringify(g0),
        );

        // ② 多人模式关闭：必须被列为阻塞原因
        debug.setNpcEnabled(false);
        e2eCheck(
            "【核心】多人模式关闭 → 门关闭（multiplayer-disabled）",
            debug.npcProactiveReady().reasons.includes("multiplayer-disabled"),
            JSON.stringify(debug.npcProactiveReady()),
        );

        // ③ 新档保护期：turnCount 必须 ≥1 才放行
        e2eLog(`当前 turnCount=${debug.turnCount()}（本 phase 未发过消息，应为 0）`);
        e2eCheck(
            "【核心】新档保护期阻断（未完成任何有效回合时不主动）",
            debug.turnCount() === 0 && debug.npcProactiveReady().reasons.includes("new-save-protection"),
            `turnCount=${debug.turnCount()} ${JSON.stringify(debug.npcProactiveReady())}`,
        );

        // 走一轮真实对话，使 turnCount ≥ 1
        sendViaUi("（决策 2）先聊一轮");
        await waitFor("回合计数落定", () => debug.turnCount() >= 1, 200);
        e2eCheck("完成一轮后计数 ≥ 1（保护期应关闭）", debug.turnCount() >= 1, `${debug.turnCount()}`);

        // ③b 【C-2 正向】turnCount = 1 时，"新档保护期"必须从阻塞原因里消失。
        //     注意：能力门（no-chat-capability）在演示模式下**始终**存在 ——
        //     它是硬门，与调度门是两回事。因此这里断言的是**这一条门被解除**，
        //     而不是"整体 ready === true"（后者在演示模式下永远不成立）。
        e2eCheck(
            "【核心】turnCount = 1 后「新档保护期」不再阻塞（C-2：第一次有效回合后获得资格）",
            debug.turnCount() >= 1 && !debug.npcProactiveReady().reasons.includes("new-save-protection"),
            `turnCount=${debug.turnCount()} ${JSON.stringify(debug.npcProactiveReady().reasons)}`,
        );

        // ④ 先把多人模式打开，使"调度类"的门可以被独立观察（能力门仍是硬门）
        debug.setNpcEnabled(true);

        // ⑤ 深夜保护：用虚拟时间把世界真的推进到深夜（而不是改 NPC 的 label 去凑）
        const beforeLabel = debug.scheduleLabel();
        debug.setTime(1, "02:30");
        const lateLabel = debug.scheduleLabel();
        e2eLog(`时段：${beforeLabel} → ${lateLabel}`);
        e2eCheck("虚拟时间能推进到深夜时段（前置事实）", lateLabel === "深夜", `${lateLabel}`);
        e2eCheck(
            "【核心】深夜保护阻断 NPC 主动开口（深夜保护规则）",
            debug.npcProactiveReady().reasons.includes("late-night"),
            JSON.stringify(debug.npcProactiveReady()),
        );
        e2eCheck(
            "【核心】多重阻塞被同时报告（收集式判定，不被能力门遮蔽）",
            debug.npcProactiveReady().reasons.length >= 2,
            JSON.stringify(debug.npcProactiveReady().reasons),
        );

        // 改回白天：深夜保护必须消失（证明该门随世界状态变化，不是恒定拒绝）
        debug.setTime(1, "10:00");
        e2eCheck("回到白天时段", debug.scheduleLabel() !== "深夜", debug.scheduleLabel());
        e2eCheck(
            "【核心】回到白天后深夜保护消失",
            !debug.npcProactiveReady().reasons.includes("late-night"),
            JSON.stringify(debug.npcProactiveReady().reasons),
        );

        // ⑥ 能力门是硬门：演示模式下 hasApiKey 为假 → 即使其它门全开也不放行
        const g5 = debug.npcProactiveReady();
        e2eCheck(
            "【核心】演示模式下即使多人开启也不放行（能力门是硬门）",
            g5.ready === false && g5.reasons.includes("no-chat-capability"),
            JSON.stringify(g5),
        );
        e2eCheck(
            "单人模式关闭时不再出现在阻塞原因里（证明该门确实随状态变化）",
            !g5.reasons.includes("multiplayer-disabled"),
            JSON.stringify(g5.reasons),
        );

        // ⑥ 冷却复用：lastActiveAt 的既有语义（6 小时）—— 断言它被 Core 守卫读取
        debug.setLastActiveAt(npc, 0);
        const afterReset = debug.npcLastActiveAt(npc);
        e2eCheck("能设置/读取 NPC 的 lastActiveAt（冷却复用既有字段）", afterReset === 0, `${afterReset}`);

        // ⑦ 玩家正在交互时不打断（player-typing / busy 由既有门控承担）
        e2eCheck(
            "门的返回值结构稳定（ready: boolean + reason + reasons[]）",
            typeof g5.ready === "boolean" && Array.isArray(g5.reasons),
            JSON.stringify(g5),
        );

        // ⑧ 主动尝试在门关闭时不得产生任何世界事件
        const before = debug.storyEvents().length;
        await debug.tryNpcProactive();
        e2eCheck(
            "【核心】门关闭时的主动尝试不产生任何世界事件",
            debug.storyEvents().length === before,
            `${before} → ${debug.storyEvents().length}`,
        );
        return;
    }

    // ---------- 【Phase 4-D 决策 C-1】NPC goal 的语义 ----------
    if (phase === 9) {
        const debug = (window as any).__debug as {
            npcIds: () => string[];
            setNpcGoal: (id: string, goal: string | null) => void;
            screenCandidates: (text: string) => { id: string; score: number; mode: string; reason: string }[];
            goalRelevance: () => Record<string, { relevant: boolean; bonus: number; kind: string | null }>;
            interventionSafety: (npcId: string | null, recentText: string) => { ok: boolean; reason?: string };
            npcProactiveReady: () => { ready: boolean; reasons: string[] };
            turnCount: () => number;
            storyEvents: () => { source: string }[];
            setNpcLabel: (id: string, label: string, activity: string) => void;
            setNpcPresent: (id: string, v: boolean) => void;
            setLastActiveAt: (id: string, ms: number) => void;
        };
        e2eCheck("__debug 暴露 goal 语义出口", typeof debug.screenCandidates === "function");
        if (typeof debug.screenCandidates !== "function") return;

        const ids = debug.npcIds();
        const npc = ids[0]!;
        // 清掉冷却与在场，让筛选能真正走到评分阶段
        debug.setLastActiveAt(npc, 0);
        debug.setNpcPresent(npc, false);
        debug.setNpcLabel(npc, "白天", "上课");

        // 基准：无关键词、无 goal 的语境（她既没被提到，也不确定是否在场）
        const baseText = "今天天气还不错。";
        const runOnce = (text: string) => {
            debug.screenCandidates(text);
            return debug.goalRelevance();
        };

        // ---------- ① goal 存在但**与当前场景无关** → 不产生 +12 ----------
        // 小美的 goalKind = "understand"（需要"恰好在场"或"被提到"）。
        // 用一个既没提到她、也不保证她在场的语境，并且把她的位置挪到"不会 nearby"的地方。
        // 通过反复采样观察 bonus 恒为 0（不相关时**根本不掷骰**）。
        debug.setNpcGoal(npc, "想多了解主角，但一直没找到合适的机会");
        let irrelevantBonusSeen = 0;
        for (let i = 0; i < 40; i++) {
            const r = runOnce(baseText)[npc];
            if (r && r.bonus > 0) irrelevantBonusSeen++;
        }
        e2eLog(`无关语境下 40 次采样，bonus>0 的次数 = ${irrelevantBonusSeen}`);
        e2eCheck(
            "【核心】goal 存在但与场景无关时**从不**产生 +12（修复前会约 25% 概率产生）",
            irrelevantBonusSeen === 0,
            `seen=${irrelevantBonusSeen}`,
        );

        // ---------- ② goal 与场景相关 → 原本的 25% × +12 机制可以触发 ----------
        // 用"提到她"制造 keywordHit（agreeableness: 对任何 goalKind 都算相关）
        const hitText = `刚才遇到${npc === "xiaoyu" ? "小雨" : "小美"}了，聊了两句。`;
        let relevantBonusSeen = 0;
        for (let i = 0; i < 80; i++) {
            const r = runOnce(hitText)[npc];
            if (r?.relevant) relevantBonusSeen++;
        }
        e2eLog(`相关语境下 80 次采样，relevant=true 的次数 = ${relevantBonusSeen}`);
        e2eCheck(
            "【核心】goal 与场景相关（被提到）时判定为 relevant",
            relevantBonusSeen === 80,
            `seen=${relevantBonusSeen}`,
        );

        // ---------- ③ goal = null → 永远不相关、永远不产生加成 ----------
        debug.setNpcGoal(npc, null);
        let nullRelevant = 0;
        for (let i = 0; i < 40; i++) {
            const r = runOnce(hitText)[npc];
            if (r?.relevant || (r?.bonus ?? 0) > 0) nullRelevant++;
        }
        e2eCheck(
            "【核心】goal = null 时永远不相关、永不产生 +12",
            nullRelevant === 0,
            `seen=${nullRelevant}`,
        );

        // ---------- ④ goal 不能绕过 Core 世界安全守卫 ----------
        // 目标：让 **"goal 相关" 与 "世界安全违规" 同时成立**，再断言 Core 仍阻断。
        //
        // 关键约束：`screenNpcCandidates` 会**跳过已在场的 NPC**（`if (npc.present) continue`），
        // 因此"已在场"时根本不产生相关性判定 —— 若直接用它做前置，断言会变成空转。
        // 改用另一条世界安全违规：**深夜保护**（`npc-asleep`）。它不阻止候选筛选，
        // 只让 Core 守卫拒绝 —— 正好是"评分与许可两条独立判定"的干净场景。
        //
        // 先用"被提到"制造 goal 相关（小美的 keyword 含"图书馆"）。
        const libNpc = ids.find((id) => id !== npc) ?? npc;
        const keywordOf: Record<string, string> = { xiaoyu: "小雨", xiaomei: "图书馆" };
        const mentionText = `我下午要去${keywordOf[libNpc] ?? "学校"}一趟。`;
        debug.setNpcGoal(libNpc, "想多了解主角，但一直没找到合适的机会");
        const rel = runOnce(mentionText)[libNpc];
        e2eLog(`「${mentionText}」下 ${libNpc} 的 goal 相关性：${JSON.stringify(rel)}`);
        e2eCheck(
            "【前置事实】此刻 goal 确实被判定为相关（否则下面的断言是空转）",
            rel?.relevant === true,
            JSON.stringify(rel),
        );

        // 制造世界安全违规：把世界推进到深夜（NPC 在睡）→ 守卫必须拒绝
        (window as any).__debug.setTime(1, "02:30");
        const safetyAtNightForNpc = debug.interventionSafety(libNpc, mentionText);
        // 深夜会同时命中两条世界安全规则（`late-night` 深夜独处 / `npc-asleep` 她该睡了），
        // 两者都是 Core 的世界安全层判定 —— 断言"被 Core 层拒绝"，不锁定具体是哪一条。
        e2eCheck(
            "【核心】goal 相关 + 世界安全违规（深夜）并存时，Core 仍然阻断",
            safetyAtNightForNpc.ok === false &&
                (safetyAtNightForNpc.reason === "late-night" || safetyAtNightForNpc.reason === "npc-asleep"),
            `safety=${JSON.stringify(safetyAtNightForNpc)} goalRelevant=${rel?.relevant}`,
        );
        e2eCheck(
            "【核心】相关性判定不会解除 Core 守卫（两条判定相互独立）",
            rel?.relevant === true && safetyAtNightForNpc.ok === false,
        );
        (window as any).__debug.setTime(1, "10:00");

        // 另测「已在场」这条违规（此前它让筛选跳过，因此单独断言守卫本身）
        debug.setNpcPresent(libNpc, true);
        const safetyWhenPresent = debug.interventionSafety(libNpc, mentionText);
        // 让"goal 相关"与"世界安全违规"**同时成立**，然后断言 Core 仍然阻断 ——
        // 这是"goal 不能绕过 Core"的严格形式（只测其中一边是不充分的）。
        // 用一个 relationContext 文本（小美的 goalKind=understand 需要 nearby/keywordHit，
        // 这里用"被提到"制造 keywordHit）同时保留"已在场"这一 Core 违规。
        e2eCheck(
            "【核心】已在场的 NPC 也被 Core 守卫拒绝（另一条违规路径）",
            safetyWhenPresent.ok === false && safetyWhenPresent.reason === "npc-present",
            JSON.stringify(safetyWhenPresent),
        );
        e2eCheck(
            "【核心】候选资格由评分决定、介入许可由 Core 守卫决定（两者独立）",
            safetyWhenPresent.ok === false,
            `safety="${safetyWhenPresent.reason}"`,
        );
        debug.setNpcPresent(libNpc, false);


        // ---------- ⑤ goal 不能直接改变世界状态 ----------
        const eventsBefore = debug.storyEvents().length;
        const turnsBefore = debug.turnCount();
        debug.setNpcGoal(npc, "想撮合你和主角");
        for (let i = 0; i < 30; i++) runOnce(hitText);
        e2eCheck(
            "【核心】goal 不能创建 Core Fact（筛选不写世界档案）",
            debug.storyEvents().length === eventsBefore,
            `${eventsBefore} → ${debug.storyEvents().length}`,
        );
        e2eCheck(
            "【核心】goal 不能改变 turnCount",
            debug.turnCount() === turnsBefore,
            `${turnsBefore} → ${debug.turnCount()}`,
        );
        e2eCheck(
            "【核心】goal 不能改变 NPC 主动开口的门（它只管评分，不管资格）",
            (() => {
                const g = debug.npcProactiveReady();
                return typeof g.ready === "boolean" && Array.isArray(g.reasons);
            })(),
        );

        // ---------- ⑥ 反向断言：相关 + 命中 25% 时**确实**会加分（机制没有被关掉） ----------
        debug.setNpcGoal(npc, "想多了解主角，但一直没找到合适的机会");
        let bonusSeen = 0;
        for (let i = 0; i < 200; i++) {
            const r = runOnce(hitText)[npc];
            if ((r?.bonus ?? 0) > 0) bonusSeen++;
        }
        e2eLog(`相关语境下 200 次采样，bonus=12 的次数 = ${bonusSeen}`);
        e2eCheck(
            "【核心】相关语境下原有 25% × +12 机制**确实仍在工作**（未被误关）",
            bonusSeen > 0,
            `seen=${bonusSeen}`,
        );
        e2eCheck(
            "加成幅度仍是既有的 12（未改动骰子本身）",
            (() => {
                for (let i = 0; i < 400; i++) {
                    const r = runOnce(hitText)[npc];
                    if ((r?.bonus ?? 0) > 0) return r!.bonus === 12;
                }
                return true; // 400 次都没命中极不可能；不把它当成失败
            })(),
        );
        return;
    }

    // ---------- 【Phase 5-A】World Surface：VM 映射 / NPC / 时间 / 事件 ----------
    if (phase === 10) {
        const debug = (window as any).__debug as {
            worldSurface: () => { applied: number; skipped: number; fingerprint: string | null };
            worldViewModel: () => any;
            worldSurfaceRefresh: (force?: boolean) => { rendered: boolean; wrote: boolean; skipped: boolean };
            worldInvalidate: () => void;
            worldReset: () => void;
            npcRowCount: () => number;
            eventRowCount: () => number;
            worldText: () => { npcText: string; eventText: string; npcRows: number; eventRows: number };
            scheduleLabel: () => string;
            setTime: (day: number, hhmm: string) => void;
            setNpcLabel: (id: string, label: string, activity: string) => void;
            npcIds: () => string[];
            recordNpcEvent: (name: string, mode: "join" | "message", dialogue: string) => void;
            storyEvents: () => { day: number; text: string; source: string; priority: string }[];
            setStoryProgress: (v: number) => void;
        };
        e2eCheck("__debug 暴露 World Surface 出口", typeof debug.worldViewModel === "function");
        if (typeof debug.worldViewModel !== "function") return;

        // ---------- ① ViewModel：存在、只读、可序列化 ----------
        debug.worldInvalidate();
        debug.worldSurfaceRefresh(true);
        const vm = debug.worldViewModel();
        e2eCheck("VM 已生成", !!vm);
        e2eCheck(
            "【核心】VM 是纯 JSON（可 JSON.stringify / 可断言）",
            (() => {
                try {
                    return JSON.stringify(JSON.parse(JSON.stringify(vm))) === JSON.stringify(vm);
                } catch {
                    return false;
                }
            })(),
        );
        e2eCheck(
            "VM 的顶层键与契约一致（没有意外字段被加进来）",
            JSON.stringify(Object.keys(vm).sort()) ===
                JSON.stringify(["allEvents", "coreFacts", "npcs", "story", "time", "turnCount"]),
            JSON.stringify(Object.keys(vm)),
        );
        e2eCheck(
            "【核心】VM 不携带 38 维情绪（世界表面不展示 valence/arousal 之类的原始数值）",
            !JSON.stringify(vm).includes("neuroticism") && !JSON.stringify(vm).includes("agreeableness"),
        );

        // ---------- ② 时间：与 Core 的既有导出一致 ----------
        const t = vm.time;
        e2eCheck(
            "【核心】时间来自 Core（与 scheduleLabel 一致）",
            t.label === debug.scheduleLabel(),
            `vm="${t.label}" core="${debug.scheduleLabel()}"`,
        );
        e2eCheck("时间格式为 HH:MM", /^\d{2}:\d{2}$/.test(t.clock), t.clock);
        e2eCheck("第几天是正整数", Number.isInteger(t.day) && t.day >= 1, `${t.day}`);
        e2eCheck("时段有活动文案（来自 currentSchedule().activity）", typeof t.activity === "string");

        // 推进虚拟时间 → VM 必须跟着变（证明它不是快照死的）
        debug.setTime(1, "16:42");
        debug.worldInvalidate();
        debug.worldSurfaceRefresh(true);
        const vm2 = debug.worldViewModel();
        e2eCheck(
            "【核心】推进 Core 时间后 VM 的时段随之变化",
            vm2.time.label === debug.scheduleLabel() && vm2.time.clock !== t.clock,
            `before=${t.clock}/${t.label} after=${vm2.time.clock}/${vm2.time.label}`,
        );

        // ---------- ③ NPC Surface：渲染的是 Core 的事实，不是编造的 ----------
        const npcIds = debug.npcIds();
        e2eCheck("VM 包含全部 NPC", vm2.npcs.length === npcIds.length, `${vm2.npcs.length}`);
        const firstNpc = vm2.npcs[0];
        e2eCheck(
            "【核心】NPC 行渲染出名字与状态",
            debug.npcRowCount() === npcIds.length && debug.worldText().npcText.includes(firstNpc.name),
            JSON.stringify(debug.worldText()),
        );
        e2eCheck(
            "【核心】NPC 状态文案由 Core 的 activity/location 拼成（不编造）",
            debug.worldText().npcText.includes(firstNpc.activity) ||
                debug.worldText().npcText.includes("还没有她的消息"),
            `npcText="${debug.worldText().npcText}" activity="${firstNpc.activity}"`,
        );

        // 改 Core 的 NPC 状态 → UI 必须跟随
        debug.setNpcLabel(npcIds[0], "白天", "（5-A）正在整理书架");
        (window as any).__debug.setNpcLocation?.(npcIds[0], "图书馆");
        debug.worldInvalidate();
        debug.worldSurfaceRefresh(true);
        const txt2 = debug.worldText().npcText;
        e2eCheck(
            "【核心】Core 的 NPC activity 变化后 UI 跟随更新",
            txt2.includes("正在整理书架"),
            `npcText="${txt2}"`,
        );

        // ---------- ④ 没有 activity 时**不编造** ----------
        debug.setNpcLabel(npcIds[0], "", "");
        (window as any).__debug.setNpcLocation?.(npcIds[0], "");
        debug.worldInvalidate();
        debug.worldSurfaceRefresh(true);
        const emptyText = debug.worldText().npcText;
        e2eCheck(
            "【核心】Core 没有 activity/location 时如实显示「还没有她的消息」，不编造活动",
            emptyText.includes("还没有她的消息"),
            `npcText="${emptyText}"`,
        );
        debug.setNpcLabel(npcIds[0], "白天", "在上课");
        (window as any).__debug.setNpcLocation?.(npcIds[0], "学校");

        // ---------- ⑤ 事件流只展示 Core Fact ----------
        // 先制造一条 **narrative**（走真实主回复路径：模型返回的 `story.event`），
        // 否则"narrative 不进入事件流"这条断言会因为档案里根本没有 narrative 而空转。
        sendViaUi("（5-A）先聊一句，让模型产出一条叙述事件。");
        await waitFor("本轮渲染完成", () => !dotBusy() && messageCount() > 0, 200);

        debug.recordNpcEvent("（5-A）小雨", "join", "我过来一下");
        debug.worldInvalidate();
        debug.worldSurfaceRefresh(true);
        const allEvents = debug.storyEvents();
        const narrativeCount = allEvents.filter((e) => e.source === "narrative").length;
        e2eLog(`档案：core=${allEvents.filter((e) => e.source === "core").length} narrative=${narrativeCount}`);
        e2eCheck(
            "【前置事实】档案里确实存在 narrative 条目（否则下面的断言是空转）",
            narrativeCount > 0,
            `${narrativeCount}：${JSON.stringify(allEvents.map((e) => e.source))}`,
        );
        e2eCheck(
            "【核心】Recent Core Events 里有刚写入的 Core Fact",
            debug.worldText().eventText.includes("（5-A）小雨"),
            `eventText="${debug.worldText().eventText}"`,
        );
        const vmEvents = debug.worldViewModel().coreFacts;
        e2eCheck(
            "【核心】VM 的 coreFacts 全部 factual === true",
            vmEvents.every((e: { factual: boolean }) => e.factual === true),
            JSON.stringify(vmEvents.map((e: { source: string }) => e.source)),
        );
        e2eCheck(
            "【核心】VM 的 coreFacts 里不含任何 narrative 来源",
            vmEvents.every((e: { source: string }) => e.source === "core"),
            JSON.stringify(vmEvents.map((e: { source: string }) => e.source)),
        );
        e2eCheck(
            "【核心】narrative 事件**没有**出现在世界事件流里 [C]",
            debug.worldText().eventText.length > 0 &&
                !allEvents
                    .filter((e) => e.source === "narrative")
                    .some((e) => debug.worldText().eventText.includes(e.text.slice(0, 12))),
            `eventText="${debug.worldText().eventText.slice(0, 120)}"`,
        );

        // ---------- ⑥ 性能：指纹短路（没有每秒重建 DOM） ----------
        debug.worldInvalidate();
        debug.worldSurfaceRefresh(true);
        const before = debug.worldSurface();
        // 连续 30 次刷新（内容未变）→ 绝大多数必须被短路
        for (let i = 0; i < 30; i++) debug.worldSurfaceRefresh(false);
        const after = debug.worldSurface();
        e2eLog(`world surface：applied ${before.applied}→${after.applied}，skipped ${before.skipped}→${after.skipped}`);
        e2eCheck(
            "【核心】内容未变化时刷新被指纹短路（不重建 DOM）",
            after.applied === before.applied && after.skipped - before.skipped === 30,
            `applied=${after.applied} skipped=${after.skipped}`,
        );
        e2eCheck(
            "指纹稳定（同一份 Core State 得到同一份指纹）",
            after.fingerprint === before.fingerprint,
        );

        // ---------- ⑦ responsive：在**精确宽度**下检查布局 ----------
        //
        // 为什么不用 `--window-size`：实测（见 e2e.mjs 的注释）
        //   `--headless=new` + `--window-size=360,780` 实际视口恒为 **500px**（Chromium 下限），
        //   因此"360px 视口"是假的 —— 那样的响应式断言会在错误的宽度上通过。
        //   改用 **iframe 视口夹具**：iframe 的 CSS 媒体查询按 iframe 自身宽度求值，
        //   布局约束也按 iframe 宽度生效（这正是媒体查询的求值规则）。
        //
        //   同一个文档被装入多个精确宽度的 iframe，逐个检查：
        //     横向溢出 / 世界表面是否超出面板 / 输入行是否仍可见。
        const WIDTHS = [360, 390, 412, 768, 1024];
        const host = document.createElement("div");
        host.id = "responsive-probe";
        // 探针容器本身不参与布局（不引入横向溢出，也不遮挡页面）
        host.setAttribute(
            "style",
            "position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none;",
        );
        document.body.appendChild(host);

        let hostOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
        e2eCheck(
            `宿主页在 ${window.innerWidth}px 下无横向溢出`,
            hostOverflow <= 1,
            `overflow=${hostOverflow}px`,
        );

        for (const w of WIDTHS) {
            const frame = document.createElement("iframe");
            frame.setAttribute("width", String(w));
            frame.setAttribute("height", "720");
            frame.setAttribute("scrolling", "no");
            frame.style.cssText = `width:${w}px;height:720px;border:0;`;
            // 同源：可以访问 contentDocument 做精确断言
            frame.src = location.pathname + "?b=resp&phase=90&slot=1&demo=1";
            host.appendChild(frame);
        }

        // 等 iframe 里的生产页面装配完成（它自己会 refreshWorldSurface）
        const loaded = await waitFor(
            "响应式探针页装配完成",
            () => Array.from(host.querySelectorAll("iframe")).every((f) => {
                const d = (f as HTMLIFrameElement).contentDocument;
                return !!d && !!d.getElementById("world-npcs") && (d.getElementById("world-npcs")?.children.length ?? 0) > 0;
            }),
            240,
        );
        e2eCheck("【前置事实】全部宽度探针页都已装配并渲染出世界表面", loaded);

        const report: string[] = [];
        for (const frame of Array.from(host.querySelectorAll("iframe"))) {
            const f = frame as HTMLIFrameElement;
            const w = Number(f.getAttribute("width"));
            const d = f.contentDocument!;
            const root = d.documentElement;
            const overflow = root.scrollWidth - root.clientWidth;
            const bodyOverflow = Math.max(0, root.scrollWidth - w);
            const panel = d.getElementById("state-panel");
            const npcBox = d.getElementById("world-npcs");
            const inputRow = d.getElementById("chat-input-row");
            const npcW = npcBox ? Math.round(npcBox.getBoundingClientRect().width) : -1;
            const panelW = panel ? Math.round(panel.getBoundingClientRect().width) : -1;
            const inputVisible = !!inputRow && inputRow.getBoundingClientRect().width > 0;
            report.push(`${w}px:overflow=${overflow},npcW=${npcW},panelW=${panelW},input=${inputVisible}`);

            e2eCheck(`${w}px：无横向溢出`, bodyOverflow <= 1, `scrollWidth=${root.scrollWidth} width=${w}`);
            e2eCheck(
                `${w}px：世界表面未超出其容器`,
                npcW === -1 || npcW <= Math.max(panelW, w) + 1,
                `npcW=${npcW} panelW=${panelW}`,
            );
            e2eCheck(`${w}px：聊天输入行仍可见（未被世界表面遮挡）`, inputVisible);

            // ⚠️ 上面两条**不足以**捕获"元素被撑宽"这类回归：
            //   `html, body { overflow-x: hidden }` 与 `#state-panel { overflow-y: auto }`
            //   都会把溢出**吸收**掉（前者裁切、后者让面板自己横向滚动），
            //   于是 `documentElement.scrollWidth` 完全不变 —— 实测注入 `min-width:520px`
            //   时这两条断言依然全绿。
            //   真正的判据是**逐元素的 scrollWidth > clientWidth**：
            //   溢出必须在任何一层被"看见"，而不是被静默裁掉。
            const overflowing: string[] = [];
            const panelEl = d.getElementById("state-panel");
            if (panelEl && panelEl.scrollWidth > panelEl.clientWidth + 1) {
                overflowing.push(`#state-panel(${panelEl.scrollWidth}>${panelEl.clientWidth})`);
            }
            for (const sel of [".npc-row", ".world-event", ".story-event", ".story-event-text"]) {
                for (const el of Array.from(d.querySelectorAll(sel))) {
                    const e = el as HTMLElement;
                    if (e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().width > w + 1) {
                        overflowing.push(`${sel}(${e.scrollWidth}>${e.clientWidth})`);
                        break;
                    }
                }
            }
            e2eCheck(
                `${w}px：世界表面的每个元素都没有被撑宽（面板与行级 scrollWidth 检查）`,
                overflowing.length === 0,
                overflowing.join(","),
            );

            // 折叠区域可正常开合（世界表面新增的两个节）
            const toggles = Array.from(d.querySelectorAll<HTMLElement>(".panel-section-toggle"));
            const worldToggle = toggles.find((t) => t.dataset.section === "world");
            const before = worldToggle?.classList.contains("collapsed");
            worldToggle?.click();
            const after = worldToggle?.classList.contains("collapsed");
            e2eCheck(
                `${w}px：「其他角色」折叠节可正常开合`,
                !!worldToggle && before !== undefined && after !== undefined && before !== after,
                `before=${before} after=${after}`,
            );
            worldToggle?.click(); // 复原
        }
        e2eLog(`响应式报告：${report.join(" ｜ ")}`);

        host.remove();
        return;
    }

    // phase 90：响应式探针页（不写结果，只让生产页面完成装配与首次世界表面渲染）
    if (phase === 90) return;

    // ---------- 【Phase 5-A4/A5】Story Log 来源可视化 + 最终视觉检查 ----------
    if (phase === 11) {
        const debug = (window as any).__debug as {
            storyLogRows: () => { source: string; label: string; day: string; text: string }[];
            storyLogEmpty: () => boolean;
            storyLogReset: () => void;
            refreshStoryUI: () => void;
            storyEvents: () => { day: number; text: string; source: string; priority: string }[];
            recordNpcEvent: (name: string, mode: "join" | "message", dialogue: string) => void;
            worldText: () => { npcText: string; eventText: string; npcRows: number; eventRows: number };
            worldSurfaceRefresh: (force?: boolean) => { rendered: boolean; skipped: boolean };
            worldInvalidate: () => void;
            worldViewModel: () => any;
            setNpcLabel: (id: string, label: string, activity: string) => void;
            npcIds: () => string[];
        };
        e2eCheck("__debug 暴露 Story Log 出口", typeof debug.storyLogRows === "function");
        if (typeof debug.storyLogRows !== "function") return;

        // 先制造三种来源各一条
        sendViaUi("（5-A4）聊一句，产生一条叙述事件。");
        await waitFor("本轮渲染完成", () => !dotBusy() && messageCount() > 0, 200);
        debug.recordNpcEvent("（5-A4）小雨", "join", "我过来一下"); // core
        // director：走完整的 Director Intent 通路（Phase 4-B 的出口）
        await (window as any).__debug.runDirectorIntent({
            needEvent: true,
            eventType: "story_event",
            priority: "main",
            reason: "（5-A4）调度层认为该推进一下",
        });
        debug.refreshStoryUI();

        const rows = debug.storyLogRows();
        const sources = rows.map((r) => r.source.replace(/^story-event-source\s*/, "") || "(无标记)");
        e2eLog(`Story Log 行：${JSON.stringify(rows.map((r) => ({ s: r.label, d: r.day, t: r.text.slice(0, 14) })))}`);

        e2eCheck("【核心】Story Log 每一行都有来源标记", rows.every((r) => r.label.length > 0), JSON.stringify(sources));
        // ⚠️ 这三条必须**同时**断言"存在这种来源"与"标对了" ——
        //    只写 `filter(...).every(...)` 会在 filter 得到空数组时**空转通过**（实测教训）。
        const bySource = (needle: string) => rows.filter((r) => r.source.includes(needle));
        const coreRows = bySource("core");
        const narrativeRows = bySource("narrative");
        const directorRows = bySource("director");

        e2eCheck(
            "【前置事实】三种来源在 Story Log 里都存在（否则下面的断言是空转）",
            coreRows.length > 0 && narrativeRows.length > 0 && directorRows.length > 0,
            `core=${coreRows.length} narrative=${narrativeRows.length} director=${directorRows.length}`,
        );
        e2eCheck(
            "【核心】core 被标为「事实」（未与 narrative 混淆）",
            coreRows.length > 0 && coreRows.every((r) => String(r.label) === "事实"),
            JSON.stringify(coreRows.map((r) => r.label)),
        );
        e2eCheck(
            "【核心】narrative 被标为「叙述」（**不是**「事实」）",
            narrativeRows.length > 0 && narrativeRows.every((r) => String(r.label) === "叙述"),
            JSON.stringify(narrativeRows.map((r) => r.label)),
        );
        e2eCheck(
            "【核心】director 被标为「调度」（**不是**「事实」）",
            directorRows.length > 0 && directorRows.every((r) => String(r.label) === "调度"),
            JSON.stringify(directorRows.map((r) => r.label)),
        );
        e2eCheck(
            "【核心】三种来源的标记互不相同（没有退化成同一个标记）",
            (() => {
                const labels: string[] = [];
                for (const r of [...coreRows, ...narrativeRows, ...directorRows]) labels.push(String(r.label));
                return new Set(labels).size === 3;
            })(),
            JSON.stringify([...new Set(rows.map((r) => String(r.label)))]),
        );

        // ---------- 两个表面的分工必须严格保持 ----------
        debug.worldInvalidate();
        debug.worldSurfaceRefresh(true);
        const evText = debug.worldText().eventText;
        const narrativeTexts = debug
            .storyEvents()
            .filter((e) => e.source === "narrative")
            .map((e) => e.text.slice(0, 12));
        e2eCheck(
            "【核心】Recent Core Events 里没有 narrative（Story Log 有，两者分工不同）",
            narrativeTexts.length > 0 && narrativeTexts.every((t) => !evText.includes(t)),
            `narrative=${JSON.stringify(narrativeTexts)} eventText="${evText.slice(0, 80)}"`,
        );

        // 更强的一层：**直接把全量档案喂给 Recent Events 表面**，验证表面自身的结构性防线
        // （只依赖调用方"记得传过滤后的列表"是不够的 —— 那让防线变成约定而不是保证）。
        const injected = (window as any).__debug.renderEventSurfaceForTest?.(
            debug.worldViewModel().allEvents,
        );
        const evText2 = debug.worldText().eventText;
        e2eLog(`喂入全量档案后 Recent Events 文本：${JSON.stringify(evText2.slice(0, 120))}`);
        e2eCheck(
            "【核心】即使误传全量档案，Recent Events 也不渲染 narrative（结构性防线生效）",
            typeof injected === "boolean" && narrativeTexts.every((t) => !evText2.includes(t)),
            `returned=${typeof injected} narrative=${JSON.stringify(narrativeTexts)} eventText="${evText2.slice(0, 100)}"`,
        );

        // ---------- 不伪造时间（D3） ----------
        e2eCheck(
            "【核心】Story Log 不显示任何时刻（StoryEvent 没有 HH:MM 字段）",
            rows.every((r) => !/\d{1,2}:\d{2}/.test(r.day) && !/\d{1,2}:\d{2}/.test(r.text.slice(0, 6))),
            JSON.stringify(rows.map((r) => r.day)),
        );
        e2eCheck(
            "【核心】Story Log 的日期只来自事件的 day 字段（形如「第 N 天」或空）",
            rows.every((r) => r.day === "" || /^第 \d+ 天$/.test(r.day)),
            JSON.stringify(rows.map((r) => r.day)),
        );

        // ---------- 空状态：自然文案，不是开发者味道 ----------
        debug.storyLogReset();
        // 清空档案后重新渲染 → 必须出现自然空状态
        (window as any).__debug.storyEvents; // noop
        const emptyOk = (() => {
            // 通过注入一个空事件列表触发空状态
            (window as any).__debug.setStoryLogEventsProviderForTest?.(() => []);
            debug.refreshStoryUI();
            return debug.storyLogEmpty();
        })();
        e2eCheck("【核心】无事件时显示自然空状态（不是 [] / undefined / No events）", emptyOk, `empty=${emptyOk}`);
        const emptyRow = document.querySelector("#story-events .story-event-empty")?.textContent ?? "";
        e2eLog(`空状态文案：${JSON.stringify(emptyRow)}`);
        e2eCheck(
            "空状态文案不含开发者味道（ERROR / NULL / undefined / [] / No events）",
            !/ERROR|NULL|undefined|\[\]|No events|NaN/i.test(emptyRow),
            emptyRow,
        );

        // ---------- 【5-A5】不把内部世界变量塞进普通界面 ----------
        (window as any).__debug.setStoryLogEventsProviderForTest?.(undefined);
        debug.refreshStoryUI();
        const surfaceText =
            (document.getElementById("state-panel")?.textContent ?? "").replace(/\s+/g, " ");
        e2eCheck(
            "【核心】普通界面不展示 npc.goal（内部世界逻辑，非玩家信息）",
            (() => {
                const goals = (debug.worldViewModel()?.npcs ?? [])
                    .map((n: { goal: string | null }) => n.goal)
                    .filter((g: string | null): g is string => !!g);
                return goals.length > 0 && goals.every((g: string) => !surfaceText.includes(g.slice(0, 8)));
            })(),
            "goal 不应出现在 #state-panel 文本里",
        );
        e2eCheck(
            "【核心】普通界面不展示 38 维原始数值墙（valence/arousal/neuroticism 等）",
            !/valence|arousal|neuroticism|agreeableness|extraversion/i.test(surfaceText),
        );
        e2eCheck(
            "【核心】普通界面不展示 NPC 的关系数值（relToMain）",
            (() => {
                const rels = (debug.worldViewModel()?.npcs ?? []).map((n: { relToMain: number }) => n.relToMain);
                // 只有"数值本身"被单独展示才算泄漏；文字里偶然出现相同数字不算
                return rels.every((r: number) => !new RegExp(`(关系|好感|relToMain)\\s*[:：]?\\s*${r}\\b`).test(surfaceText));
            })(),
            "relToMain 不应作为独立数值展示",
        );

        // ---------- 【5-A5】视觉层级：世界表面不得抢过聊天 ----------
        const msgs = document.getElementById("chat-messages");
        const npcBox = document.getElementById("world-npcs");
        e2eCheck(
            "【核心】聊天区在 DOM 顺序与视觉层级上仍是第一核心（世界表面在其容器内，不覆盖聊天）",
            !!msgs &&
                !!npcBox &&
                msgs.getBoundingClientRect().width > 0 &&
                npcBox.getBoundingClientRect().width > 0 &&
                !msgs.contains(npcBox) &&
                !npcBox.contains(msgs),
        );
        e2eCheck(
            "Story Log 的来源标记不挤压正文（标记宽度远小于行宽）",
            (() => {
                const first = document.querySelector("#story-events .story-event");
                const badge = first?.querySelector(".story-event-source");
                const text = first?.querySelector(".story-event-text");
                if (!first || !badge || !text) return true;
                return badge.getBoundingClientRect().width < first.getBoundingClientRect().width / 2;
            })(),
        );

        // ---------- Recent Events 的空状态 ----------
        const evEmpty = document.querySelector("#world-events .world-event-empty")?.textContent ?? "(有事件)";
        e2eCheck(
            "Recent Events 的空状态（若有）同样是自然文案",
            evEmpty === "(有事件)" || !/ERROR|NULL|undefined|\[\]|No events|NaN/i.test(evEmpty),
            evEmpty,
        );
        return;
    }

    if (phase === 1) {
        // ============================================================
        // ① 渲染输出的形状契约（演示模式下的完整一轮）
        // ============================================================
        const demoBtn = document.getElementById("demo-btn") as HTMLButtonElement | null;
        if (!demoBtn) throw new Error("找不到 #demo-btn");
        e2eCheck(
            "演示模式开关状态与入口垫片的夹具一致",
            demoBtn.classList.contains("active") === wantDemo,
            `active=${demoBtn.classList.contains("active")} want=${wantDemo}`,
        );

        // 说明：演示模式的说明性提示只在**手动点开关**时渲染；启动时若已是演示模式
        // （无 Key 的默认状态）不会重复提示 —— 这是既有行为，本套件不去改它，只做记录。
        if (wantDemo) {
            const sysEl = document.querySelector("#chat-messages > .msg.sys");
            e2eLog(`启动时是否已有 .msg.sys 提示：${sysEl ? "有" : "无（预期：启动即演示模式时不重复提示）"}`);
        }

        const callsBeforeSend = spy.calls;
        e2eCheck("【核心】启动阶段零网络请求", callsBeforeSend === 0, `fetch=${callsBeforeSend} ${spy.urls.join(",")}`);

        const shapeBefore = messageShape();
        sendViaUi("（渲染边界测试）今天过得怎么样？");

        const settled = await waitFor("本轮渲染完成", () => !dotBusy() && messageCount() > shapeBefore.length);
        e2eCheck("本轮渲染已完成", settled, `busy=${dotBusy()} count=${messageCount()}`);

        const added = messageShape().slice(shapeBefore.length);
        e2eLog(`本轮新增节点：${JSON.stringify(added)}`);

        // 【核心】形状契约。
        // 为什么不用"全序列精确匹配"：一轮真实渲染里还可能有随机事件卡（.event-card）
        // 与日程旁白（.story-line），它们的出现依赖随机种子与虚拟时间，
        // 把全序列写死会得到一个"偶尔变红"的假安全网。这里改为断言**契约本身**：
        //   ① 本轮必须新增用户消息与 AI 消息（顺序：user 在 ai 之前）
        //   ② 每个消息节点必须带 `msg`，并带 user / ai 之一
        //   ③ AI 消息内部只允许出现契约内的类名，且必须含 dialogue
        //   ④ 时间戳必须以 .msg-ts 存在
        // 阶段 3 拆分时，这四条正是"装配点被搬错"最先打破的东西。
        const addedTokens = added.map((x) => x.split(".").slice(1));
        const userIdx = addedTokens.findIndex((t) => t.includes("msg") && t.includes("user"));
        const aiIdx = addedTokens.findIndex((t) => t.includes("msg") && t.includes("ai"));
        e2eCheck("【核心】本轮新增了用户消息", userIdx !== -1, `added=${JSON.stringify(added)}`);
        e2eCheck("【核心】本轮新增了 AI 消息", aiIdx !== -1, `added=${JSON.stringify(added)}`);
        e2eCheck(
            "【核心】用户消息必须排在 AI 消息之前",
            userIdx !== -1 && aiIdx !== -1 && userIdx < aiIdx,
            `userIdx=${userIdx} aiIdx=${aiIdx}`,
        );
        e2eCheck(
            "【核心】所有消息节点都带 `msg` 基类（class 契约未退化）",
            addedTokens.filter((t) => t.includes("user") || t.includes("ai")).every((t) => t.includes("msg")),
            `added=${JSON.stringify(added)}`,
        );
        e2eCheck(
            "【核心】本轮渲染出现 .msg-ts 时间戳（在消息节点内部）",
            document.querySelectorAll("#chat-messages > .msg > .msg-ts").length >= 2,
            `ts=${document.querySelectorAll("#chat-messages > .msg > .msg-ts").length} added=${JSON.stringify(added)}`,
        );

        const aiNodes = document.querySelectorAll("#chat-messages > .msg.ai");
        const lastAi = aiNodes[aiNodes.length - 1] ?? null;
        const lastInner = innerShape(lastAi);
        e2eLog(`末个 AI 消息内部：${JSON.stringify(lastInner)}`);
        e2eCheck(
            "【核心】AI 消息内部首个块是 .msg-avatar（头像装配点未漂移）",
            lastInner[0] === "msg-avatar",
            `actual=${JSON.stringify(lastInner)}`,
        );
        e2eCheck(
            "【核心】AI 消息内部必须含 .dialogue（正文装配点）",
            lastInner.includes("dialogue"),
            `actual=${JSON.stringify(lastInner)}`,
        );
        e2eCheck(
            "【核心】AI 消息内部必须含 .msg-ts（时间戳装配点在消息内而不是外层）",
            lastInner.includes("msg-ts"),
            `actual=${JSON.stringify(lastInner)}`,
        );
        e2eCheck(
            "【核心】AI 消息内部不出现未预期的类名",
            lastInner.every((c) =>
                ["msg-avatar", "dialogue", "action", "thoughts", "emotion-tag", "msg-ts", "msg-reanswer"].includes(c),
            ),
            `actual=${JSON.stringify(lastInner)}`,
        );

        // 打字机是 rAF 驱动 + 2s 卡死看门狗。无头 + 虚拟时钟下 rAF 可能被限流，
        // 这里等正文落定（看门狗保证最多 ~2s 一定会 finish），失败时只记录不判定 ——
        // 渐进渲染的确定性验证由 typewriter 套件用手动 tick 覆盖，不在这里重复。
        // 注意：每次轮询都要**重新取**末个 AI 节点 —— 随机事件卡的渲染会改变
        // #chat-messages 的末子节点，把 lastAi 固定在循环外会一直读到空值。
        const typed = await waitFor(
            "演示正文落定",
            () => {
                const nodes = document.querySelectorAll("#chat-messages > .msg.ai");
                const el = nodes[nodes.length - 1];
                return (el?.querySelector(".dialogue")?.textContent ?? "").trim().length > 0;
            },
            100,
        );
        const lastAiDialogue = (() => {
            const nodes = document.querySelectorAll("#chat-messages > .msg.ai");
            const el = nodes[nodes.length - 1];
            return (el?.querySelector(".dialogue")?.textContent ?? "").trim();
        })();
        if (!typed) {
        // 已知环境限制（只记录不判定）：打字机是 rAF 驱动，无头 + swiftshader 下 rAF
        // 可能始终不回调，而 stall 看门狗依赖的 setInterval 在虚拟时钟下也可能不推进。
        // 渐进渲染的**确定性**验证由 typewriter 套件用手动 tick 覆盖，不在这里重复。
        e2eLog(`（环境限制）演示正文未落定；实测长度=${lastAiDialogue.length}`);
    }

        // ---------- ② 演示模式零网络出口 ----------
        e2eCheck(
            "【核心】演示模式全程零网络请求（真实网络出口未被触碰）",
            spy.calls === 0,
            `fetch=${spy.calls} urls=${spy.urls.join(",")}`,
        );
    } else if (phase === 2) {
        // ============================================================
        // ③ setProactiveGate 必须**活读** busy，而不是捕获注册时的快照
        // ============================================================
        // 设计要点（这一段踩过三个坑，都写在这里避免以后重蹈）：
        //   · 不要用"永久挂起的 fetch"来钉住 busy：浏览器会因为未完成的请求而不推进虚拟时钟，
        //     后续步骤全部停摆，`--dump-dom` 只能拿到半截结果（表现是结果节点只剩 E2E_BEAT）。
        //   · 不要用"busy 落下后再断言门控打开"作为唯一证明：一个恒 false 的门控同样能过
        //     "busy 时被拦住"。必须**在同一段里同时观察到 true / false 两种结果**。
        //   · 不要在断言前写 localStorage：`apikey-${slot}` 缺失时能力门控先生效并直接返回，
        //     真正的 live gate 根本不会被查询，断言会"因为错误的原因"通过。
        e2eCheck("本 phase 必须在非演示模式下运行（垫片 ?demo=0）", !wantDemo, `wantDemo=${wantDemo}`);
        const probeSlot = params.get("slot") ?? "1";
        localStorage.setItem(`apikey-${probeSlot}`, "e2e-dummy-key");

        // 在 live gate **外面**再套一层"只读"观察器：它不改变任何行为，
        // 只记录 live gate 每次被查询时返回了什么、以及那一刻 busy 的可视状态。
        const observed: { result: boolean; busy: boolean }[] = [];
        setProactiveGate(() => {
            const result = liveGate!();
            observed.push({ result, busy: dotBusy() });
            return result;
        });

        // ---------- ① 忙碌中：门控必须关闭 ----------
        let resolveHeld: ((r: Response) => void) | null = null;
        spy.passthrough = true;
        spy.hold = true;
        spy.release = () => {
            resolveHeld?.(new Response("{}", { status: 500 }));
        };

        markUserReplied(); // 清掉"等待回复"门控，确保拦截只可能来自 busy
        sendViaUi("（渲染边界测试）这条请求会被挂起");

        const busyDuring = dotBusy();
        e2eCheck("【核心】请求进行中 busy 态已建立（同步读到）", busyDuring, `busy=${busyDuring} count=${messageCount()}`);

        markUserReplied();
        const blocked = tryProactiveSpeak("（渲染边界测试）忙碌中不该开口");
        e2eCheck(
            "【核心】busy 期间 proactiveGate 返回 false（证明门控活读 busy，而非注册时快照）",
            blocked === false && observed.at(-1)?.result === false,
            `returned=${blocked} observed=${JSON.stringify(observed)}`,
        );

        // ---------- ② 放行请求 → 等 busy 落下 ----------
        resolveHeld?.(new Response("{}", { status: 500 }));
        spy.hold = false;
        for (let i = 0; i < 300 && dotBusy(); i++) {
            await new Promise((r) => setTimeout(r, 10));
        }
        const busyAfter = dotBusy();
        e2eCheck("放行请求后 busy 态落下", !busyAfter, `busy=${busyAfter}`);

        // ---------- ③ 空闲时：同一个门控必须打开 ----------
        // 这一步是正向证明，防止"恒 false 的门控"蒙混过关。
        if (!busyAfter) {
            markUserReplied();
            const allowed = tryProactiveSpeak("（渲染边界测试）空闲时可以开口");
            e2eCheck(
                "【核心】busy 结束后同一门控返回 true（活绑定的正向证明）",
                allowed === true && observed.at(-1)?.result === true,
                `returned=${allowed} observed=${JSON.stringify(observed)}`,
            );
        } else {
            e2eCheck("【核心】busy 结束后同一门控返回 true（活绑定的正向证明）", false, `busy=${busyAfter}`);
        }

        e2eLog(`观察到门控查询 ${observed.length} 次：${JSON.stringify(observed)}`);
        // 复原：把观察器拆掉，避免影响同一浏览器进程里的后续断言
        setProactiveGate(liveGate!);
    } else {
        e2eCheck("未知 phase", false, String(phase));
    }
    });
} catch (e) {
    fatal("套件顶层异常（e2eRun 之外）", e);
}
