// tests/scenarios.js —— 存档契约测试的夹具植入脚本（经典脚本，早于 module 执行）
//
// 为什么必须是经典脚本且放在 module 之前：
//   storage.ts 在**模块求值期**就会读取 localStorage 判定槽位；
//   若夹具在 module 之后写入，测到的就不是"加载时看到什么"。
//
// 用法：?scenario=<name>&slot=<n>
//   脚本把对应夹具写入 `melai-state-{slot}`，并写 `melai-character-{slot}`。

(function () {
    var params = new URLSearchParams(location.search);
    var scenario = params.get("scenario");
    var slot = params.get("slot") || "1";
    var STATE_KEY = "melai-state-" + slot;
    var CHAR_KEY = "melai-character-" + slot;

    // 每个场景独立：先清空，避免上一个 phase 的残留（同一 user-data-dir）
    try {
        localStorage.clear();
    } catch (e) {
        /* ignore */
    }

    /** 当前代码写出的完整存档（30 键），见 P0-12_plan.md §A.1 */
    function realV0() {
        return {
            savedAt: 1789234178272,
            aiState: { affection: 55, trust: 40, joy: 60 },
            turnCount: 42,
            storyEvents: [{ day: 3, text: "她第一次主动找你说话" }],
            storyProgress: 35,
            chatHistory: [
                { role: "user", content: "在吗", ts: 1789000000000 },
                { role: "assistant", content: "嗯，在的。", ts: 1789000060000 }
            ],
            journal: [{ day: 1, summary: "第一天，你们在教室相遇。" }],
            activeThread: "一起去书店",
            scheduleIndex: 5,
            timeRate: 1,
            virtualMs: 1789234178272,
            dayBaseMs: 1789171200000,
            dayIndex: 8,
            memories: ["她不喜欢被敷衍", "你答应陪她去书店"],
            lastReplyRealAt: 1789234100000,
            lastReplyVirtualAt: 1789230000000,
            lastNeglectAt: 0,
            lastNeglectRealAt: 0,
            lastNeglectLevel: 0,
            npcs: {},
            presentNpcs: [],
            npcEnabled: false,
            scene: { name: "海边小镇", place: "咖啡店", routine: "冲咖啡", others: "顾客", busyLabel: "开店", restLabel: "空闲" },
            agenda: [{ day: 8, items: [{ time: "10:00", title: "一起去书店", status: "todo", source: "ai" }] }],
            userLocation: "家",
            pendingOvernight: [],
            userMind: { happiness: 0.5, sadness: 0.3 },
            aiMind: { interest: 0.7, lastTopic: "书店" },
            relMind: { tension: 0.12, lastMajorLabel: "考试", lastMajorTurn: 30, lastMajorVirtualAt: 1789200000000 },
            lastAgentVirtualAt: 1789230000000
        };
    }

    /** 早期形状：storyEvents 为 string[]，完全缺 scene / npcs / mind 三态 */
    function legacyV0() {
        return {
            savedAt: 1600000000000,
            aiState: { affection: 55, trust: 40 },
            turnCount: 7,
            storyEvents: ["旧式事件一", "旧式事件二"],
            chatHistory: [{ role: "user", content: "早" }],
            memories: ["旧记忆"],
            virtualMs: 1600000000000,
            dayBaseMs: 1599955200000,
            dayIndex: 2
        };
    }

    var scenarios = {
        "real-v0": function () { return realV0(); },
        "legacy-v0": function () { return legacyV0(); },
        "corrupt-json": function () { return "{ this is not valid json"; },
        "future-version": function () {
            var s = realV0();
            s.version = 99;
            return s;
        },
        "dirty-fields": function () {
            var s = realV0();
            s.aiState = { affection: "abc", trust: null, joy: NaN, sadness: Infinity, obsolete_dim: 50 };
            s.turnCount = "42";
            s.storyProgress = { bad: true };
            s.timeRate = "fast";
            s.memories = "not-an-array";
            s.npcEnabled = "yes";
            s.userLocation = "火星";
            return s;
        },
        "only-aistate": function () {
            // 明确给一个与默认基线(25)不同的值，用于区分"夹具生效"与"回落默认"
            return { aiState: { affection: 77 } };
        },
        "missing-aistate": function () { return { turnCount: 5, savedAt: 1, scene: { place: "学校" } }; },
        "empty": function () { return null; },
        // ---- 导出 / 导入套件（saveio）复用的场景：都需要 slot1 有一份真实存档 ----
        "export": function () { return realV0(); },
        "import-reject": function () { return realV0(); },
        "commit-rollback": function () { return realV0(); },
        // "corrupt-json" 已被存档契约套件使用，导出套件直接复用
        // ---- TTS 作用域套件（tts-scope）----
        "explicit-slot": function () { return null; }, // 不需要存档，只需要干净环境
        "legacy-migration": function () { return null; }, // 由测试自己植入旧全局键
        // ---- IndexedDB 音色套件（voice-idb）----
        "data-shape": function () { return null; },
        "migrate-happy": function () { return null; },
        "migrate-failsafe": function () { return null; },
        "save-safety": function () { return null; },
        "legacy-fallback": function () { return null; },
    };

    // 某些场景需要在清空后额外植入数据（在 storage.ts 求值之前完成）
    var extraSeed = {
        "legacy-migration": function () {
            // 旧版本写下的全局 TTS 开关（无 -{slot} 后缀）
            localStorage.setItem("melai-tts-enabled", "true");
        }
    };
    if (extraSeed[scenario]) extraSeed[scenario]();

    var pick = scenarios[scenario];
    if (!pick) {
        window.__e2eScenarioError = "未知场景: " + scenario;
        return;
    }
    var fixture = pick();
    if (fixture !== null) {
        var payload = typeof fixture === "string" ? fixture : JSON.stringify(fixture);
        try {
            localStorage.setItem(STATE_KEY, payload);
        } catch (e) {
            window.__e2eScenarioError = "写入夹具失败: " + e.message;
        }
    }

    // 角色卡：除 empty 外都给一张，便于验证"读档与角色卡并存"
    if (scenario !== "empty") {
        try {
            localStorage.setItem(CHAR_KEY, JSON.stringify({
                name: "林晚秋", age: "24 岁", appearance: "及肩黑发", personality: "安静",
                background: "旧书店店员", speechStyle: "语速慢", likes: "旧书",
                dislikes: "吵闹", relation: "常客", secrets: "她写的小说主角是你"
            }));
        } catch (e) {
            /* ignore */
        }
    }

    window.__e2eScenario = scenario;
    window.__e2eSlot = slot;
})();
