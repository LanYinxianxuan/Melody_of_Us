// dist-check.mjs —— 构建产物完整性检查
//
// 背景：本项目的「源码目录 == 部署目录」（playground/），构建产物依赖 npm run build 里
// 一串 cp/sed 才能自洽。历史上正是这一层缺乏校验，导致 PWA 资产在部署后 404 而无人发现。
// 本脚本把「产物自洽」变成可自动验证的断言：
//   1. 三个页面都存在
//   2. 每个 HTML 里的每个本地 src/href 都能解析到真实文件
//   3. 每页都有对应的 JS chunk（不是只有静态 HTML）
//   4. PWA 三件套（sw.js / manifest / icons）与 Capacitor webDir 一致
//
// 需要先跑 `npm run build`。dist 不存在时 SKIP（exit 0），便于单独运行。

import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../", import.meta.url)));
const DIST = join(ROOT, "dist");
const WEB_ROOT = join(DIST, "playground"); // 与 capacitor.config.json 的 webDir 一致

const log = (m) => process.stdout.write(`${m}\n`);

let passed = 0;
let failed = 0;
function check(label, ok, detail = "") {
    if (ok) {
        passed++;
        log(`  ✅ ${label}`);
    } else {
        failed++;
        log(`  ❌ ${label}${detail ? `  ← ${detail}` : ""}`);
    }
}

/** 递归列出目录下所有文件（相对 DIST 的路径） */
async function walk(dir, base = dir) {
    const out = [];
    for (const entry of await readdir(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...(await walk(full, base)));
        else out.push(relative(base, full));
    }
    return out;
}

async function main() {
    if (!existsSync(DIST)) {
        log("⚠️  dist/ 不存在，请先运行 npm run build —— 跳过产物检查");
        process.exit(0);
    }

    const files = await walk(DIST);
    log(`dist 文件数: ${files.length}`);

    // ===== 1. 三个页面 =====
    log("\n===== 页面存在性 =====");
    for (const page of ["home.html", "index.html", "menu.html", "chat.html"]) {
        check(`dist/playground/${page}`, files.includes(join("playground", page)));
    }

    // ===== 2. 引用完整性 =====
    log("\n===== 引用完整性（本地 src/href 是否可解析）=====");
    const pages = ["home.html", "index.html", "menu.html", "chat.html"];
    let refCount = 0;
    const broken = [];
    for (const page of pages) {
        const abs = join(WEB_ROOT, page);
        if (!existsSync(abs)) continue;
        const html = await readFile(abs, "utf8");
        for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
            const ref = m[1];
            if (/^(https?:|\/\/|data:|#|mailto:)/.test(ref)) continue;
            refCount++;
            const target = normalize(join(dirname(abs), ref.split("?")[0].split("#")[0]));
            if (!existsSync(target)) broken.push(`${page} → ${ref}`);
        }
    }
    check(`${refCount} 条本地引用全部可解析`, broken.length === 0, broken.join("; "));

    // ===== 3. 每页都有 JS chunk =====
    log("\n===== 入口 chunk 存在性 =====");
    for (const page of ["menu.html", "chat.html"]) {
        const abs = join(WEB_ROOT, page);
        if (!existsSync(abs)) continue;
        const html = await readFile(abs, "utf8");
        const src = html.match(/<script[^>]+src="\.\/assets\/([^"]+)"/)?.[1];
        check(`${page} 引用的 chunk 存在`, !!src && files.includes(join("playground", "assets", src)), src ?? "未找到 <script src>");
    }

    // ===== 4. PWA 三件套（相对 webDir，即 Capacitor 的运行根）=====
    log("\n===== PWA 资产（相对 webDir=dist/playground）=====");
    for (const asset of ["sw.js", "manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png"]) {
        check(`playground/${asset}`, files.includes(join("playground", asset)));
    }

    // manifest 的 start_url/scope 必须落在 webDir 内（越界会导致 Capacitor 下 404）
    const manifestPath = join(WEB_ROOT, "manifest.webmanifest");
    if (existsSync(manifestPath)) {
        const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
        check(
            `manifest.start_url 在 webDir 内（${manifest.start_url}）`,
            !String(manifest.start_url ?? "").startsWith("../"),
            manifest.start_url,
        );
    }

    // ===== 5. chunk 体积（回归护栏）=====
    log("\n===== 体积 =====");
    const assets = files.filter((f) => f.startsWith(join("playground", "assets")) && f.endsWith(".js"));
    for (const a of assets) {
        const size = (await stat(join(DIST, a))).size;
        log(`    ${a}  ${(size / 1024).toFixed(2)} KB`);
    }
    const totalJs = (await Promise.all(assets.map((a) => stat(join(DIST, a))))).reduce((s, i) => s + i.size, 0);
    // 回归护栏：当前基线 203.4 KB（chat 167.75 + tts 25.45 + menu 10.18）。
    // 预算给 15% 余量；阶段 3/6 做代码分割后应显著下降，届时同步下调此预算。
    const JS_BUDGET_KB = 240;
    check(
        `JS 总量 < ${JS_BUDGET_KB} KB（当前 ${(totalJs / 1024).toFixed(1)} KB，基线 203.4 KB）`,
        totalJs < JS_BUDGET_KB * 1024,
    );

    // ===== 6. 结构性回归：localStorage 孤儿键 =====
    // P0-7 / P0-8 的根因是同一类缺陷：写入端与读取端各用一个键名，两边单独看都"正常"，
    // 只有跨文件比对才看得出。这里把它变成机械检查，防止同类问题再次发生。
    //
    // 设计取舍（宁可精确且需维护，也不要聪明但误报）：
    //   · 字面量键（"melai-effort"）跨全仓精确比对；
    //   · 模板键（`apikey-${slot}`）的写入方用 setItem(slotKey(...)) 间接完成，
    //     正则无法解析，因此用 DECLARED_PARAM_WRITERS 显式登记；
    //   · 常量键（SAVE_KEY = `melai-state-${slot}`）同理登记；
    //   · 注释一律剥离后再扫描 —— 否则在注释里引用旧代码（记录良好的修复）
    //     反而会让检查失败。
    log("\n===== 结构性回归：localStorage 键一致性 =====");

    const srcDir = join(ROOT, "playground");
    // ⚠ 必须**递归**收集：阶段 3 把渲染代码拆进了 playground/ui/。
    // 只扫顶层会让"这些防回归检查"在搬迁之后静默失效 —— 测试变绿，但已经什么都没检查。
    const sources = new Map();
    const collect = async (dir) => {
        for (const entry of await readdir(dir, { withFileTypes: true })) {
            const full = join(dir, entry.name);
            if (entry.isDirectory()) await collect(full);
            else if (entry.name.endsWith(".ts")) sources.set(full, await readFile(full, "utf8"));
        }
    };
    await collect(srcDir);

    /** 剥离块注释与行注释（本项目键名不会出现在字符串里的 "//" 之后） */
    const stripComments = (src) =>
        src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

    /** 归一化模板插值：`apikey-${slot}` 与 `apikey-${activeSlot}` → `apikey-${*}` */
    const normalizeKey = (raw) => raw.replace(/\$\{[^}]*\}/g, "${*}");

    const KEY_PATTERN = /localStorage\.(get|set)Item\(\s*(`[^`]*`|"[^"]*"|'[^']*')/g;

    /**
     * 由非字面量方式写入的键：正则无法解析，因此显式登记「谁负责写」。
     * 一旦某个键不再被写入，这里会成为唯一线索 —— 请连同注释一起维护。
     */
    const DECLARED_PARAM_WRITERS = new Map([
        ["apikey-${*}", 'menu.ts: setItem(slotKey("apikey", activeSlot))'],
        ["provider-${*}", 'menu.ts: setItem(slotKey("provider", activeSlot))'],
        ["model-${*}", 'menu.ts: setItem(slotKey("model", activeSlot))'],
        ["custom-url-${*}", 'menu.ts: setItem(slotKey("custom-url", activeSlot))'],
        ["models-cache-${*}", 'menu.ts: setItem(slotKey("models-cache", activeSlot))'],
        ["melai-state-${*}", "storage.ts: SAVE_KEY 常量"],
        ["melai-character-${*}", "storage.ts: CHAR_KEY 常量 / character.ts saveCharacter"],
        ["melai-did-new-${*}", "storage.ts 模块初始化"],
    ]);

    /**
     * 只读的历史键：仅用于一次性迁移读取，写入的是迁移后的新键，读取后即刻删除。
     * 每一项都必须有明确的迁移归属，否则就是未处理的孤儿键。
     */
    const READ_ONLY_LEGACY = new Set([
        "melai-state", // 旧单档存档 → melai-state-1（storage.ts 迁移块，探测通过才搬移并删源）
        "melai-character", // 旧单档角色卡 → melai-character-1
        "melai-tts-enabled", // 【G6】旧全局 TTS 开关 → 由 migrateTtsEnabledScope 复制到各槽位后删除
        "melai-did-new", // 【P0-11】已废弃的"新建存档"守卫标记，仅清理历史遗留
    ]);

    /**
     * 已登记、已定位、待后续阶段处理的孤儿键。
     * 每一项都必须写明归属的缺陷编号与原因，修完后立即删除。
     * 当前为空：P0-7（deepseek-effort / melai-provider）与 P0-8（deepseek-key）均已修复。
     */
    const KNOWN_ORPHANS = new Map();

    /** 统计一批源码里出现的 localStorage 键（已剥离注释） */
    const collectKeys = (src) => {
        const found = [];
        for (const m of stripComments(src).matchAll(KEY_PATTERN)) {
            found.push({ op: m[1], key: normalizeKey(m[2].slice(1, -1)) });
        }
        return found;
    };

    const written = new Set(DECLARED_PARAM_WRITERS.keys());
    const read = new Map(); // normalizedKey -> [relativeFile]
    for (const [file, src] of sources) {
        for (const { op, key } of collectKeys(src)) {
            if (op === "set") {
                written.add(key);
            } else {
                if (!read.has(key)) read.set(key, []);
                const rel = relative(ROOT, file);
                if (!read.get(key).includes(rel)) read.get(key).push(rel);
            }
        }
    }

    // 6a. 被读取但从未被写入的键 → 孤儿键（读取端永远拿到 undefined / 落到默认值）
    const orphans = [...read.keys()].filter(
        (k) => !written.has(k) && !READ_ONLY_LEGACY.has(k) && !KNOWN_ORPHANS.has(k),
    );
    check(
        `无未登记的 localStorage 孤儿键（已登记 ${KNOWN_ORPHANS.size} 个待修）`,
        orphans.length === 0,
        orphans.map((k) => `"${k}" 被 ${read.get(k).join(",")} 读取但无人写入`).join("; "),
    );

    /** 在指定文件集合中查找某个键的读写位置（已剥离注释） */
    const findKeyUsages = (keyLiteral, { skipFile } = {}) => {
        const hits = [];
        for (const [file, src] of sources) {
            const rel = relative(ROOT, file);
            if (skipFile && rel === skipFile) continue;
            const clean = stripComments(src);
            const re = new RegExp(`localStorage\\.(get|set)Item\\(\\s*["'\`]${keyLiteral}["'\`]`, "g");
            for (const m of clean.matchAll(re)) {
                hits.push(`${rel}:${clean.slice(0, m.index).split("\n").length}`);
            }
        }
        return hits;
    };

    // 6b. effort 键只能由 ai.ts 的访问器读取（其余模块必须走 getEffort()/isThinkingEnabled()）
    const directEffortReads = findKeyUsages("melai-effort", { skipFile: join("playground", "ai.ts") });
    check("effort 键只由 ai.ts 的访问器读取（无绕过）", directEffortReads.length === 0, directEffortReads.join("; "));

    // 6c. chat.ts 顶栏状态必须经由 isThinkingEnabled() 判断
    const chatSrc = sources.get(join(srcDir, "chat.ts")) ?? "";
    check("chat.ts 状态文案使用 isThinkingEnabled()", /const thinking = isThinkingEnabled\(\)/.test(chatSrc));

    // 6g. 【P0-13】槽位作用域键必须走 storage.slotKey()，不得手写模板字面量。
    //     用**已登记的前缀白名单**精确匹配，避免把 `group-${group}`、`meter-${key}`
    //     这类 DOM id 模板误判为存储键（早期版本用宽泛正则导致过假阳性）。
    const SLOT_SCOPED_PREFIXES = [
        "melai-state", "melai-character", "apikey", "provider", "model",
        "custom-url", "models-cache", "melai-tts-voice", "melai-tts-apikey",
        "melai-tts-style", "melai-tts-lang", "melai-tts-enabled", "melai-did-new",
    ];
    const manualSlotKeys = [];
    const manualKeyRe = new RegExp("`(" + SLOT_SCOPED_PREFIXES.join("|") + ")-\\$\\{");
    for (const [file, rawSrc] of sources) {
        const rel = relative(ROOT, file);
        if (rel === join("playground", "storage.ts")) continue; // slotKey() 的唯一合法拼接点
        stripComments(rawSrc).split("\n").forEach((line, i) => {
            if (manualKeyRe.test(line)) manualSlotKeys.push(`${rel}:${i + 1}`);
        });
    }
    check(
        "槽位键不在 storage 之外手工拼接（统一走 slotKey/KEY_PREFIX）",
        manualSlotKeys.length === 0,
        manualSlotKeys.join("; "),
    );

    // 6h. TTS 的 per-slot 键只能由 tts.ts 直接读写。
    //     精确匹配 localStorage 调用里的字面量前缀 —— KEY_PREFIX 的**声明**在 storage.ts，
    //     那是合法的事实来源，不应被判定为违规。
    const ttsKeyUsers = [];
    const ttsDirectRe = /localStorage\.(?:get|set|remove)Item\(\s*[`"'](?:melai-tts-(?:voice|apikey|style|lang|enabled)|\$\{TTS_)/;
    for (const [file, rawSrc] of sources) {
        const rel = relative(ROOT, file);
        if (rel === join("playground", "tts.ts")) continue;
        if (ttsDirectRe.test(stripComments(rawSrc))) ttsKeyUsers.push(rel);
    }
    check("TTS per-slot 键只在 tts.ts 中直接读写", ttsKeyUsers.length === 0, ttsKeyUsers.join("; "));

    // 6d/6e. P0-7 的键分裂防回归：孤儿键不得再被读写
    const stray = [...findKeyUsages("deepseek-effort"), ...findKeyUsages("melai-provider")];
    check('孤儿键 "deepseek-effort" / "melai-provider" 不再被读写（P0-7 防回归）', stray.length === 0, stray.join("; "));

    // 6f. P0-8 防回归：时段切换不得再自行读能力键，必须走 tryProactiveSpeak 的统一门控
    const timeSrc = stripComments(sources.get(join(srcDir, "time.ts")) ?? "");
    check(
        "time.ts 不再自行读取聊天能力键（改由 chat.ts 注入）",
        !/localStorage\.getItem\(\s*["'`]deepseek-key["'`]/.test(timeSrc),
    );
    check(
        "time.ts 的主动开口有统一能力门控",
        /function tryProactiveSpeak[\s\S]{0,400}hasChatCapability\(\)/.test(timeSrc),
    );
    const chatClean = stripComments(chatSrc);
    check("chat.ts 已注入能力判断", /setChatCapabilityGetter\(\(\) =>/.test(chatClean));

    // ===== 7. e2e 夹具来源 =====
    // 浏览器测试用**生产 chat.html** 作为 DOM 夹具（零漂移）。
    // 早期版本手写了一份最小夹具页，但模块会动态生成 id（group-${group} / meter-${key}），
    // 手写夹具永远追不上 -> 每次漏一个就在 import 期抛错。这里锁定"夹具必须来自生产页面"。
    log("\n===== e2e 夹具来源 =====");
    const e2eSrc = await readFile(join(ROOT, "tests", "e2e.mjs"), "utf8");
    check(
        "e2e 使用生产 chat.html 作为 DOM 夹具（零漂移）",
        /playground",\s*"chat\.html"/.test(e2eSrc) && /buildFixtureHtml/.test(e2eSrc),
    );
    check(
        "不再存在手写的最小夹具页（tests/e2e.html）",
        !existsSync(join(ROOT, "tests", "e2e.html")),
    );

    // ===== 8. P0-6 防回归：不得再出现「双 appendMessage」写法 =====
    // 该缺陷是纯手误：一行里写了两条语句，创建两个元素，文本落在没有 .sys 的那一个上。
    // 编译器看不出问题（两条语句都合法），因此只能靠模式检查兜住。
    log("\n===== P0-6 防回归：系统消息写法 =====");

    const doubleAppend = [];
    for (const [file, src] of sources) {
        const clean = stripComments(src);
        const rel = relative(ROOT, file);
        clean.split("\n").forEach((line, i) => {
            const hits = line.match(/appendMessage\(/g) ?? [];
            if (hits.length > 1) doubleAppend.push(`${rel}:${i + 1}`);
        });
    }
    check(
        "同一行内不出现两次 appendMessage（双元素写入）",
        doubleAppend.length === 0,
        doubleAppend.join("; "),
    );

    // 系统提示必须走 appendSystemMessage 单一入口。
    // 阶段 3.3 把消息装配移到了 playground/ui/message.ts，因此这里按**全部源码**判定：
    // 断言的是"存在唯一入口"，而不是"入口恰好在某个文件里"（后者会随重构失效）。
    const allClean = [...sources.values()].map(stripComments).join("\n");
    const chatClean2 = stripComments(sources.get(join(srcDir, "chat.ts")) ?? "");
    check("存在 appendSystemMessage 统一入口（任意模块）", /function appendSystemMessage\(/.test(allClean));
    check(
        "该入口是导出的（调用方不会各写一半）",
        /export function appendSystemMessage\(/.test(allClean),
    );
    check(
        "系统提示不直接拼接 classList + textContent",
        !/appendMessage\("ai"\)\.classList\.add\("sys"\)/.test(chatClean2),
    );

    // ===== 9. P0-3 防回归：存档写入失败不得被静默吞掉 =====
    // 静默 catch 让"存档已经不再工作"这件事完全不可观测：用户会一直玩到刷新才丢档。
    // 这里锁定两个关键写入函数的契约：必须返回布尔值，且必须走统一失败上报。
    log("\n===== P0-3 防回归：存档失败可观测性 =====");

    const storageClean = stripComments(sources.get(join(srcDir, "storage.ts")) ?? "");
    const charClean = stripComments(sources.get(join(srcDir, "character.ts")) ?? "");

    check(
        "saveState 返回布尔值（调用方可判断成败）",
        /export function saveState\(\): boolean/.test(storageClean),
    );
    check(
        "saveCharacter 返回布尔值（调用方可判断成败）",
        /export function saveCharacter\(\): boolean/.test(charClean),
    );
    check(
        "storage.ts 提供失败上报通道",
        /export function setSaveFailureHandler\(/.test(storageClean) &&
            /function reportFailure\(/.test(storageClean),
    );
    check(
        "character.ts 复用同一个失败上报通道（不各自为政）",
        /notifySaveFailure\(/.test(charClean),
    );
    check(
        "两个存档函数不再使用空 catch 吞掉异常",
        !/catch\s*\{\s*\/\*\s*ignore\s*\*\/\s*\}/.test(
            storageClean.slice(storageClean.indexOf("export function saveState")) +
                charClean.slice(charClean.indexOf("export function saveCharacter")),
        ),
    );
    check(
        "chat.ts 已注册存档失败处理函数（用户可见）",
        /setSaveFailureHandler\(/.test(stripComments(chatSrc)),
    );

    // ===== 10. P0-5 防回归：打字机与自动滚动 =====
    // 缺陷是"两处叠加"：setInterval 强制布局 + CSS scroll-behavior:smooth 被程序化赋值反复重启。
    // 编译器看不出问题，因此用结构检查锁住这两个契约。
    log("\n===== P0-5 防回归：打字机与滚动 =====");

    // ⚠ 阶段 3.3 把打字机与自动滚动整体搬到了 playground/ui/message.ts。
    // 这里按**全部源码**判定：断言的是"行为契约"，不是"代码在哪个文件"。
    const chatForP5 = allClean;

    // 打字机必须由 rAF 驱动（不再断言"全文没有 setInterval" —— 卡死看门狗本身就需要它）
    check(
        "打字机使用 requestAnimationFrame 驱动",
        /requestAnimationFrame\(tick\)/.test(chatForP5),
    );
    check(
        "打字机渲染发生在 rAF 回调里（textContent 写入位于 tick 内）",
        /const tick = \(now: number\) => \{[\s\S]{0,1200}?dialogue\.textContent/.test(chatForP5),
    );
    check(
        "打字机有 rAF 卡死兜底（帧被限流时文本仍能渲染完整）",
        /STALL_TIMEOUT_MS/.test(chatForP5) && /stallWatchdog/.test(chatForP5),
    );
    check(
        '自动滚动显式使用 behavior:"auto"（不与 CSS smooth 打架）',
        /const AUTO_SCROLL_BEHAVIOR: ScrollBehavior = "auto"/.test(chatForP5),
    );
    // 高频路径（打字机 / 追加消息 / 旁白）必须走统一助手。
    // 允许 renderHistoryToChat 里的直接赋值 —— 它只在启动时回填历史，执行一次且不在动画路径上，
    // 不属于 P0-5 的"每 55ms 重启平滑滚动"问题。
    const HIGH_FREQUENCY_FUNCS = ["typeReply", "appendMessage", "scrollMessagesToBottom"];
    const directMsgScroll = [];
    for (const fnName of HIGH_FREQUENCY_FUNCS) {
        const fnStart = chatForP5.indexOf(`function ${fnName}(`);
        if (fnStart < 0) continue;
        const body = chatForP5.slice(fnStart, fnStart + 3000);
        if (/container\.scrollTop\s*=\s*container\.scrollHeight/.test(body)) {
            directMsgScroll.push(fnName);
        }
    }
    check(
        "高频路径不再直接写 container.scrollTop（统一走 scrollMessagesToBottom）",
        directMsgScroll.length === 0,
        directMsgScroll.join("; "),
    );
    check(
        "打字机内的滚动经由统一助手（受 behavior:\"auto\" 约束）",
        /const scrollToBottom = scrollMessagesToBottom/.test(chatForP5),
    );

    // ===== 11. P0-2 防回归：IndexedDB 必须全程有超时 =====
    // 缺陷特征：某些环境下 IDB 的 request/transaction 永不触发回调。
    // 若没有超时，一次音色读写就会让页面**永久挂起**（用户侧表现为"点了没反应"），
    // 比"不支持 IDB"严重得多。这里把"每个 IDB 等待点都必须带超时"固化成断言。
    log("\n===== P0-2 防回归：IndexedDB 超时保护 =====");
    const voiceSrc = stripComments(sources.get(join(srcDir, "voice-store.ts")) ?? "");
    check("voice-store.ts 存在", voiceSrc.length > 0);
    check("IDB 探测带超时", /IDB_PROBE_TIMEOUT_MS/.test(voiceSrc));
    check("IDB 操作带超时", /IDB_OP_TIMEOUT_MS/.test(voiceSrc) && /function withTimeout/.test(voiceSrc));
    check("openDb 自带超时兜底", /IndexedDB open 超时/.test(voiceSrc));
    // 三个操作都必须经过 withTimeout
    const wrapped = ["idbGet", "idbPut", "idbDelete"].filter((fn) => {
        const i = voiceSrc.indexOf(`function ${fn}(`);
        if (i < 0) return false;
        return /withTimeout\(/.test(voiceSrc.slice(i, i + 120));
    });
    check("get/put/remove 三个操作都经 withTimeout 包装", wrapped.length === 3, wrapped.join(","));
    check("音色写入与存档安全联动使用 operation-scoped 判定", /getSaveFailureGeneration\(\) > genBefore/.test(voiceSrc));
    check("迁移在读回校验通过后才删除旧数据", /verify\?\.data !== legacy/.test(voiceSrc));

    log(`\n========== 产物检查: ${passed} 通过 / ${failed} 失败 ==========`);
    process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
    log(`产物检查异常: ${e?.stack ?? e}`);
    process.exit(1);
});
