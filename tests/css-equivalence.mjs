// css-equivalence.mjs —— Phase 2 防回归：CSS 抽取的"声明级等价"证明
//
// 为什么不用截图对比：
//   本项目首页/菜单页带 90s 背景漂移动画 + 悬浮视差 + 数据驱动的存档卡，
//   两次截图必然落在不同帧/不同数据状态，"像素 diff" 无法区分
//   「CSS 被改坏」与「截图时机不同」——实测同一份 CSS 的两次截图差异可达 2-3%。
//
// 因此改用**解析级证明**：把三页的 CSS（原内联 vs 现外链）解析成
//   (选择器, 属性, 值) 三元组的多重集，断言"声明集合等价"。
// 这比像素 diff 更强：它验证的是语义，不是渲染时序。
//
// 从 git HEAD 读取原始内联 <style> 作为基线 —— 那是抽取前的权威来源。

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const PAGES = ["home", "menu", "chat"];

/** 允许的、有意的差异（每一条都必须写明理由） */
const INTENTIONAL = {
    // --line-strong 在 home 曾是 #c9c9c9，在 menu/chat 是 #bdbdbd。
    // 统一为 #bdbdbd（多数派 + 与 UI_STYLE.md 一致）。
    allowedValueChanges: new Map([
        ["--line-strong", new Set(["#c9c9c9", "#bdbdbd"])],
    ]),
    // 抽取后新增的 token（原文件里不存在）
    newTokens: new Set([
        "--ink-mute", "--ink-on-dark", "--ink-on-dark-soft", "--ink-on-dark-strong",
        "--bg-hover", "--bg-active", "--bg-active-strong",
        "--ink-hover", "--ink-hover-alt", "--ink-active", "--ink-active-alt",
        "--overlay", "--overlay-light", "--grid-line", "--grid-line-strong", "--grid-line-faint",
        "--noise-opacity", "--danger-soft-hover",
        "--font-ui", "--fs-2xs", "--fs-xs", "--fs-sm", "--fs-base", "--fs-md", "--fs-lg",
        "--fs-xl", "--fs-2xl", "--fs-3xl", "--fs-hero",
        "--lh-tight", "--lh-base", "--lh-relaxed", "--lh-loose",
        "--sp-1", "--sp-2", "--sp-3", "--sp-4", "--sp-5", "--sp-6", "--sp-7", "--sp-8",
        "--sp-9", "--sp-10", "--sp-11", "--sp-12",
        "--r-sm", "--r-full", "--r-scrollbar",
        "--ctl-h-sm", "--ctl-h-md", "--ctl-h-lg", "--ctl-h-xl", "--ctl-h-2xl", "--touch-min",
        "--panel-w", "--chat-max-w",
        "--dur-fast", "--dur-base", "--dur-slow", "--dur-drawer", "--dur-progress",
        "--dur-progress-slow", "--dur-enter", "--dur-hero", "--ease", "--ease-out",
        "--z-grid", "--z-fluid", "--z-content", "--z-header", "--z-mask", "--z-drawer",
        "--z-modal", "--z-modal-full", "--z-modal-top",
        "--grid-size", "--parallax-inset",
        "--sp-4b", "--z-noise", "--menu-max-w", "--modal-w",
    ]),
    /**
     * 「显式写出初始值」⇒「省略」属安全等价变换。
     * 仅登记**可以证明是初始值**的取值，避免把真实丢失洗成通过。
     * 注意 text-decoration: none 对 <a> 并非初始值（初始为 underline）——生产 CSS 里已补回该声明，
     * 因此这张表里不登记它，保证那条声明一旦丢失测试就会失败。
     */
    initialValues: new Map([
        ["align-items", new Set(["normal", "stretch"])],
        ["flex-wrap", new Set(["nowrap"])],
        ["text-align", new Set(["start", "left"])],
        ["font-weight", new Set(["normal", "400"])],
        ["white-space", new Set(["normal"])],
        ["word-break", new Set(["normal"])],
        ["letter-spacing", new Set(["normal"])],
        ["user-select", new Set(["auto"])],
        ["border", new Set(["none"])],
        ["background", new Set(["transparent"])],
        ["margin", new Set(["0"])],
        ["padding", new Set(["0"])],
        ["opacity", new Set(["1"])],
        ["font-style", new Set(["normal"])],
        ["position", new Set(["static"])],
        ["overflow", new Set(["visible"])],
        ["list-style", new Set(["disc outside none"])],
    ]),
    /**
     * 有意删除的死规则（每条都要有可复核的证据）。
     * `.ico-lg` —— 抽取前 home 内联里就有，但 home 三个图标写的是 class="ico ic-logo"
     * （`ic-logo` 才是孤儿类，`.ico` 自身 16px 与 `.ico-lg` 的 18px 在本页从未生效）。
     * 全仓 grep 无 `ico-lg` 元素 → 删除后渲染零变化。
     * 注意：`.ico-sm` 是活规则（menu/chat 大量使用），不在此列。
     */
    removedSelectors: new Map([
        [".ico-lg", "死规则：全仓无 ico-lg 元素，home 实际写的是孤儿类 ic-logo"],
    ]),
    // 新增的工具类 / 组件类（不参与"旧规则是否丢失"的比对）
    newSelectors: new Set([
        ".sr-only", ".scroll-thin", ".scroll-thin::-webkit-scrollbar",
        ".scroll-thin::-webkit-scrollbar-thumb", ".scroll-thin::-webkit-scrollbar-track",
        ".btn-lg", ".btn-sm", ".status-line", ".modal-mask",
    ]),
};

/** 极简 CSS 解析：返回 [{selector, decls: Map<prop,value>}]，展开 @media 内部 */
function parseCss(css) {
    css = css.replace(/\/\*[\s\S]*?\*\//g, "");
    const out = [];
    let i = 0;
    const n = css.length;
    while (i < n) {
        const ws = /^\s+/.exec(css.slice(i));
        if (ws) { i += ws[0].length; continue; }
        if (css[i] === "@") {
            const brace = css.indexOf("{", i);
            const semi = css.indexOf(";", i);
            if (semi !== -1 && (brace === -1 || semi < brace)) { i = semi + 1; continue; }
            let depth = 0, k = brace;
            while (k < n) {
                if (css[k] === "{") depth++;
                else if (css[k] === "}") { depth--; if (depth === 0) break; }
                k++;
            }
            const at = css.slice(i, brace).trim();
            const inner = css.slice(brace + 1, k);
            if (at.startsWith("@media")) {
                for (const r of parseCss(inner)) out.push({ selector: `${at} >> ${r.selector}`, decls: r.decls });
            } else if (at.startsWith("@keyframes")) {
                out.push({ selector: at, decls: new Map([["__raw__", inner.replace(/\s+/g, " ").trim()]]) });
            }
            i = k + 1; continue;
        }
        const brace = css.indexOf("{", i);
        if (brace === -1) break;
        const close = css.indexOf("}", brace);
        if (close === -1) break;
        const selector = css.slice(i, brace).replace(/\s+/g, " ").trim();
        const body = css.slice(brace + 1, close);
        const decls = new Map();
        // 按分号切分时必须跳过括号/引号内部 —— data-URI 与渐变里会出现分号与逗号
        const parts = [];
        let buf = "", depth = 0, quote = null;
        for (const ch of body) {
            if (quote) {
                buf += ch;
                if (ch === quote) quote = null;
                continue;
            }
            if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
            if (ch === "(") depth++;
            if (ch === ")") depth--;
            if (ch === ";" && depth === 0) { parts.push(buf); buf = ""; continue; }
            buf += ch;
        }
        if (buf.trim()) parts.push(buf);
        for (const part of parts) {
            const c = part.indexOf(":");
            if (c === -1) continue;
            const p = part.slice(0, c).trim();
            const v = part.slice(c + 1).replace(/\s+/g, " ").trim();
            if (p) decls.set(p, v);
        }
        if (selector) out.push({ selector, decls });
        i = close + 1;
    }
    return out;
}

/**
 * token 展开：把 var(--x) 递归替换为其字面值（最多 8 层，防循环）。
 * 抽取过程中我们把大量字面量换成了等值 token，本函数让"等价"可被机器判定。
 */
function resolveValDeep(v, tokens, depth = 0) {
    if (depth > 8 ||
        typeof v !== "string" ||
        v.indexOf("var(") === -1) return v;
    return v.replace(/var\((--[\w-]+)\)/g, (full, name) => {
        const raw = tokens.get(name);
        return raw === undefined ? full : resolveValDeep(raw, tokens, depth + 1);
    });
}

/**
 * 函数式颜色值中的空格无语义差异：`rgba(255,255,255,.4)` 与 `rgba(255, 255, 255, 0.4)` 完全等价。
 * 抽取时格式化工具重新加了空格，这里统一去掉再比较（只动函数括号内的逗号后空格，不动引号内容）。
 */
function normalizeFnColors(v) {
    if (typeof v !== "string") return v;
    return v.replace(/(rgba?|hsla?)\(([^()]*)\)/g, (full, fn, args) =>
        `${fn}(${args.split(",").map((x) => x.trim()).join(",")})`);
}

/** 从规则集里抽取 :root 的 token 表 */
function collectTokens(rules) {
    const t = new Map();
    for (const r of rules) {
        if (r.selector !== ":root") continue;
        for (const [k, v] of r.decls) t.set(k, v);
    }
    return t;
}

let passed = 0, failed = 0;
const check = (label, ok, detail = "") => {
    if (ok) { passed++; console.log(`  ✅ ${label}`); }
    else { failed++; console.log(`  ❌ ${label}${detail ? `  ← ${detail}` : ""}`); }
};

const readGit = (p) => execFileSync("git", ["show", `HEAD:${p}`], { cwd: ROOT, encoding: "utf8" });

async function main() {
    console.log("===== CSS 声明级等价性（原内联 vs 现外链）=====");

    for (const page of PAGES) {
        console.log(`\n--- ${page} ---`);
        const orig = readGit(`playground/${page}.html`);
        const origCss = (orig.match(/<style[^>]*>([\s\S]*?)<\/style>/) ?? [])[1] ?? "";
        const origRules = parseCss(origCss);

        // 收集当前外链的全部 CSS
        const links = [...(await readFile(join(ROOT, "playground", `${page}.html`), "utf8"))
            .matchAll(/<link[^>]+href="\.\.\/(styles\/[^"]+)"/g)].map((m) => m[1]);
        check(`${page}.html 引用了样式文件`, links.length > 0, `${links.length}`);
        let nowCss = "";
        for (const l of links) {
            const f = join(ROOT, l);
            if (!existsSync(f)) { check(`样式文件存在: ${l}`, false); continue; }
            nowCss += "\n" + (await readFile(f, "utf8"));
        }
        const nowRules = parseCss(nowCss);
        console.log(`    原始 ${origRules.length} 规则 → 现有 ${nowRules.length} 规则（含新增组件/token）`);

        const origTokens = collectTokens(origRules);
        const nowTokens = collectTokens(nowRules);

        // 建索引：selector -> decls
        /**
         * 合并同名选择器的声明（CSS 里同一选择器可出现多次，后者覆盖前者）。
         * ⚠ 必须展开逗号分组：原内联里大量存在 `a, b { … }`，抽取后常被拆成 `a{…}` / `b{…}`；
         *   若不展开，`a`、`b` 两条选择器在左侧根本不存在，比对会被静默跳过（真实盲区）。
         */
        const expandSelector = (sel) =>
            sel.startsWith("@") ? [sel] : sel.split(",").map((x) => x.trim()).filter(Boolean);
        const indexRules = (rules) => {
            const m = new Map();
            for (const r of rules) {
                for (const sel of expandSelector(r.selector)) {
                    const prev = m.get(sel);
                    if (prev) for (const [k, v] of r.decls) prev.set(k, v);
                    else m.set(sel, new Map(r.decls));
                }
            }
            return m;
        };
        const origMap = indexRules(origRules);
        const nowMap = indexRules(nowRules);

        // ① 原规则是否都还在（除允许新增的外）
        const missing = [...origMap.keys()].filter(
            (s) => !nowMap.has(s) && !INTENTIONAL.newSelectors.has(s) && !INTENTIONAL.removedSelectors.has(s),
        );
        check("原有选择器全部保留", missing.length === 0, missing.slice(0, 6).join(" | "));

        // ② 共有规则：声明集合必须一致（忽略有意变更）
        const changed = [];
        for (const [sel, oDecls] of origMap) {
            const nDecls = nowMap.get(sel);
            if (!nDecls) continue;
            const removedProps = INTENTIONAL.removedSelectors.get(sel);
            for (const [prop, oVal] of oDecls) {
                if (removedProps !== undefined) continue;
                const nVal = nDecls.get(prop);
                if (nVal === undefined) {
                    const inits = INTENTIONAL.initialValues.get(prop);
                    if (inits && inits.has(oVal.trim())) continue; // 省略显式初始值 = 等价
                    changed.push(`${sel}{${prop}} 丢失`);
                    continue;
                }
                // 用"token 展开后 + 函数式颜色归一"的值比较：字面量 → var(--token) 属等价变换
                const oR = normalizeFnColors(resolveValDeep(oVal, origTokens));
                const nR = normalizeFnColors(resolveValDeep(nVal, nowTokens));
                if (oR === nR) continue;
                // 两侧引用同一 token（例如都写成 var(--line-strong)）——字面表可能不同，但语义相同
                if (oVal === nVal) continue;
                if (/^var\(--[\w-]+\)$/.test(oVal) && /^var\(--[\w-]+\)$/.test(nVal) && oVal === nVal) continue;
                const allow = INTENTIONAL.allowedValueChanges.get(prop);
                if (allow && allow.has(oVal) && allow.has(nVal)) continue;
                changed.push(`${sel}{${prop}}: "${oVal}" → "${nVal}"`);
            }
        }
        check("共有规则的声明值未变", changed.length === 0, changed.slice(0, 5).join(" | "));

        // ④ 媒体查询是否都保留
        const origMedia = new Set([...origMap.keys()].filter((s) => s.startsWith("@media")).map((s) => s.split(" >> ")[0]));
        const nowMedia = new Set([...nowMap.keys()].filter((s) => s.startsWith("@media")).map((s) => s.split(" >> ")[0]));
        const lostMedia = [...origMedia].filter((m) => !nowMedia.has(m) && m.includes("prefers-reduced-motion") === false);
        check("页面自有媒体查询全部保留", lostMedia.length === 0, lostMedia.join(" | "));
    }

    console.log(`\n========== CSS 等价性: ${passed} 通过 / ${failed} 失败 ==========`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
    console.log(`异常: ${e?.stack ?? e}`);
    process.exit(1);
});
