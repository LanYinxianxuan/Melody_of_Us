// settings-effort.e2e.ts —— P0-7 回归测试：思考等级（effort）设置必须真正生效
//
// 被修复的缺陷：
//   menu.ts 写 localStorage["melai-effort"]，而 ai.ts:520 与 chat.ts:357 读
//   localStorage["deepseek-effort"]（全仓从无写入方）。后果：
//     ① 用户选「关闭（最快）」后，发出去的请求里仍带 thinking:{type:"enabled"}，
//        reasoning_effort 仍是 "high" —— 设置完全无效，照样慢、照样贵；
//     ② chat.ts 顶栏状态判断依据的键恒为 undefined → 走默认 high → 无论怎么设置
//        都显示「思考中…」。
//   因为两个键各自都存在，任何单点阅读代码都看不出问题：写入端"正常"，读取端也"正常"。

import {
    EFFORT_KEY,
    EFFORT_LEVELS,
    getEffort,
    isThinkingEnabled,
    thinkingParams,
    type EffortLevel,
} from "../playground/ai";
import { e2eCheck, e2eLog, e2eRun } from "./e2e-assert";

await e2eRun(() => {
    e2eLog(`EFFORT_KEY="${EFFORT_KEY}" 合法取值=[${EFFORT_LEVELS.join(",")}]`);

    // ---------- ① 缺省值 ----------
    localStorage.removeItem(EFFORT_KEY);
    e2eCheck("未设置时默认 high", getEffort() === "high", getEffort());
    e2eCheck("未设置时思考开启", isThinkingEnabled() === true);

    // ---------- ② 每一个合法取值都必须被真实识别 ----------
    for (const level of EFFORT_LEVELS) {
        localStorage.setItem(EFFORT_KEY, level);
        const read = getEffort();
        e2eCheck(`写入 "${level}" 后读回一致`, read === level, `读回 "${read}"`);
    }

    // ---------- ③ 核心：关闭思考必须真的改变请求参数 ----------
    localStorage.setItem(EFFORT_KEY, "disabled");
    const off = thinkingParams();
    e2eLog(`disabled → ${JSON.stringify(off)}`);
    e2eCheck("【核心】effort=disabled 时请求带 thinking.type=disabled", off.thinking.type === "disabled", JSON.stringify(off));
    e2eCheck(
        "【核心】effort=disabled 时不发送 reasoning_effort",
        !("reasoning_effort" in off),
        JSON.stringify(off),
    );
    e2eCheck("【核心】effort=disabled 时 isThinkingEnabled=false（顶栏将显示「回复中…」）", isThinkingEnabled() === false);

    // ---------- ④ 其余等级映射正确 ----------
    const expected: Record<Exclude<EffortLevel, "disabled">, string> = { low: "low", high: "high", max: "max" };
    for (const [level, effort] of Object.entries(expected) as [EffortLevel, string][]) {
        localStorage.setItem(EFFORT_KEY, level);
        const p = thinkingParams();
        e2eCheck(`${level} → thinking.enabled`, p.thinking.type === "enabled", JSON.stringify(p));
        e2eCheck(`${level} → reasoning_effort="${effort}"`, p.reasoning_effort === effort, JSON.stringify(p));
        e2eCheck(`${level} → isThinkingEnabled=true`, isThinkingEnabled() === true);
    }

    // ---------- ⑤ 非法值必须回落默认，而不是把 undefined 传出去 ----------
    for (const bogus of ["", "medium", "HIGH", "0", "yes"]) {
        localStorage.setItem(EFFORT_KEY, bogus);
        e2eCheck(`非法值 ${JSON.stringify(bogus)} 回落 high`, getEffort() === "high", getEffort());
    }

    // ---------- ⑥ 防回归：孤儿键 "deepseek-effort" 不得再被读取 ----------
    localStorage.removeItem(EFFORT_KEY);
    localStorage.setItem("deepseek-effort", "disabled");
    e2eCheck(
        '写孤儿键 "deepseek-effort" 不再影响思考等级（证明读取端已迁移）',
        getEffort() === "high" && isThinkingEnabled() === true,
        `getEffort()="${getEffort()}"`,
    );
    localStorage.removeItem("deepseek-effort");

    // ---------- ⑦ UI 与请求参数必须来自同一个判断 ----------
    // 逐一取值，断言「状态文案的判据」与「请求参数的判据」永远一致
    for (const level of EFFORT_LEVELS) {
        localStorage.setItem(EFFORT_KEY, level);
        const requestSaysThinking = thinkingParams().thinking.type === "enabled";
        const uiSaysThinking = isThinkingEnabled();
        e2eCheck(`"${level}"：UI 判断与请求参数一致`, requestSaysThinking === uiSaysThinking, `${requestSaysThinking} vs ${uiSaysThinking}`);
    }

    // ---------- ⑧ 默认值必须与菜单下拉的第一项保持可发现 ----------
    e2eCheck("EFFORT_LEVELS 覆盖菜单 4 个选项", EFFORT_LEVELS.length === 4, EFFORT_LEVELS.join(","));

    localStorage.removeItem(EFFORT_KEY);
});
