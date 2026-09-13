// menu.ts —— 菜单页：多存档列表 + 设置（复用 storage 模块）
// 每个存档槽位独立的 API 设置

import { loadSlotRaw, loadSlotCharacterName, clearSlot, clearAllAppData, currentSlot, slotKey, KEY_PREFIX, CURRENT_SLOT_KEY } from "./storage";
import { EFFORT_KEY, getEffort } from "./ai";
import { escapeHtml } from "./util";
import { migrateAllVoices } from "./voice-store";
import { exportSlotToJson, importSave, shouldReloadAfterImport } from "./save-io";
import { readAudioFile, setVoiceBase64, getVoiceBase64, clearVoice, getTtsStyle, setTtsStyle, getTtsApiKey, setTtsApiKey, getTtsLang, setTtsLang, synthesizeSpeech, isTtsEnabledForSlot, migrateTtsEnabledScope, type TtsLang } from "./tts";
import { requestJson } from "./ai/client";

const TOTAL_SLOTS = 5;

// 供应商配置
const PROVIDERS: Record<string, { name: string; baseUrl: string; headerFn?: (key: string) => Record<string, string> }> = {
    deepseek: {
        name: "DeepSeek",
        baseUrl: "https://api.deepseek.com",
    },
    openai: {
        name: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
    },
    claude: {
        name: "Claude",
        baseUrl: "https://api.anthropic.com/v1",
        headerFn: (key) => ({
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }),
    },
    gemini: {
        name: "Gemini",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    },
    moonshot: {
        name: "Moonshot",
        baseUrl: "https://api.moonshot.cn/v1",
    },
    qwen: {
        name: "通义千问",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
    zhipu: {
        name: "智谱",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    },
    xiaomi: {
        name: "小米 MiMo",
        baseUrl: "https://api.xiaomimimo.com/v1",
    },
    custom: {
        name: "自定义",
        baseUrl: "",
    },
};

// 【P0-13】槽位键构造统一走 storage.slotKey（前缀集中在 storage.KEY_PREFIX），
// 不再在本文件里自行拼接字符串。


// 当前选中的存档槽位（用于设置页面）
let activeSlot = currentSlot;

function fmtTime(ts: number): string {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function moodLine(s: Record<string, number>): string {
    return (s.joy ?? 0) > 55 ? "心情明朗" :
        (s.sadness ?? 0) > 45 ? "有点难过" :
        (s.anger ?? 0) > 40 ? "还在生你的气" :
        (s.jealousy ?? 0) > 30 ? "在吃醋" :
        (s.loneliness ?? 0) > 40 ? "觉得孤独" :
        (s.fatigue ?? 0) > 50 ? "疲惫" : "心情平稳";
}

// 渲染存档列表
function renderSaves() {
    const list = document.getElementById("save-list")!;
    list.innerHTML = "";

    for (let slot = 1; slot <= TOTAL_SLOTS; slot++) {
        const save = loadSlotRaw(slot);
        const card = document.createElement("div");
        card.className = `save-card${slot === activeSlot ? " active" : ""}`;

        // 读取该槽位的 API 设置
        const provider = localStorage.getItem(slotKey(KEY_PREFIX.provider, slot)) ?? "deepseek";
        const providerName = PROVIDERS[provider]?.name ?? provider;
        const hasKey = !!localStorage.getItem(slotKey(KEY_PREFIX.apikey, slot));

        if (save) {
            const s = save.aiState as Record<string, number>;
            const aff = Math.round(s.affection ?? 0);
            const tagIcon = hasKey
                ? `<svg class="ico" viewBox="0 0 24 24" style="width:10px;height:10px;"><use href="#i-check"/></svg>`
                : `<svg class="ico" viewBox="0 0 24 24" style="width:10px;height:10px;"><use href="#i-x"/></svg>`;
            card.innerHTML = `
                <div class="s-head">
                  <span class="s-name">存档 ${slot} · ${escapeHtml(loadSlotCharacterName(slot))}</span>
                  <span style="display:flex;gap:6px;align-items:center;">
                    <span class="s-tag">${providerName}${tagIcon}</span>
                    <button class="s-del" data-del="${slot}"><svg class="ico" viewBox="0 0 24 24" style="width:12px;height:12px;"><use href="#i-trash-2"/></svg>删除</button>
                  </span>
                </div>
                <div class="s-info">
                  好感 <b>${aff}/100</b> ｜ ${moodLine(s)} ｜ 对话 ${save.turnCount ?? 0} 轮 ｜ 剧情 ${save.storyProgress ?? 0}%
                  <br><span>${fmtTime((save.savedAt as number) ?? Date.now())}</span>
                </div>
                <div class="s-actions">
                  <button class="s-enter btn btn-primary" data-slot="${slot}" data-new="0"><svg class="ico" viewBox="0 0 24 24" style="width:12px;height:12px;"><use href="#i-arrow-right"/></svg>进入</button>
                  <button class="s-config btn btn-ghost" data-slot="${slot}"><svg class="ico" viewBox="0 0 24 24" style="width:12px;height:12px;"><use href="#i-sliders-horizontal"/></svg>API 设置</button>
                </div>`;
        } else {
            const tagIcon = hasKey
                ? `<svg class="ico" viewBox="0 0 24 24" style="width:10px;height:10px;"><use href="#i-check"/></svg>`
                : `<svg class="ico" viewBox="0 0 24 24" style="width:10px;height:10px;"><use href="#i-x"/></svg>`;
            card.innerHTML = `
                <div class="s-head">
                  <span class="s-name">存档 ${slot}</span>
                  <span style="display:flex;gap:6px;align-items:center;">
                    <span class="s-tag">${providerName}${tagIcon}</span>
                  </span>
                </div>
                <div class="s-empty">还没有记录。</div>
                <div class="s-actions">
                  <button class="s-enter btn btn-primary" data-slot="${slot}" data-new="1"><svg class="ico" viewBox="0 0 24 24" style="width:12px;height:12px;"><use href="#i-plus"/></svg>新建</button>
                  <button class="s-config btn btn-ghost" data-slot="${slot}"><svg class="ico" viewBox="0 0 24 24" style="width:12px;height:12px;"><use href="#i-sliders-horizontal"/></svg>API 设置</button>
                </div>`;
        }

        card.addEventListener("click", (e) => {
            const delBtn = (e.target as HTMLElement).closest(".s-del") as HTMLElement | null;
            const enterBtn = (e.target as HTMLElement).closest(".s-enter") as HTMLElement | null;
            const configBtn = (e.target as HTMLElement).closest(".s-config") as HTMLElement | null;

            // 删除存档
            if (delBtn) {
                e.stopPropagation();
                const delSlot = parseInt(delBtn.dataset.del ?? "0", 10);
                if (confirm(`删除存档 ${delSlot}？\n此操作无法恢复！`)) {
                    clearSlot(delSlot);
                    localStorage.removeItem(slotKey(KEY_PREFIX.provider, delSlot));
                    localStorage.removeItem(slotKey(KEY_PREFIX.apikey, delSlot));
                    localStorage.removeItem(slotKey(KEY_PREFIX.model, delSlot));
                    localStorage.removeItem(slotKey(KEY_PREFIX.customUrl, delSlot));
                    localStorage.removeItem(slotKey(KEY_PREFIX.modelsCache, delSlot));
                    renderSaves();
                }
                return;
            }

            // 进入聊天
            if (enterBtn) {
                e.stopPropagation();
                const enterSlot = parseInt(enterBtn.dataset.slot ?? "1", 10);
                const isNew = enterBtn.dataset.new === "1";
                localStorage.setItem(CURRENT_SLOT_KEY, String(enterSlot));
                location.href = `./chat.html?slot=${enterSlot}${isNew ? "&new=1" : ""}`;
                return;
            }

            // API 设置：选中该槽位并滚动到设置区
            if (configBtn) {
                e.stopPropagation();
                const configSlot = parseInt(configBtn.dataset.slot ?? "1", 10);
                activeSlot = configSlot;
                localStorage.setItem(CURRENT_SLOT_KEY, String(configSlot));
                loadSlotSettings(configSlot);
                renderSaves();
                // 滚动到设置区
                const settingsCard = document.getElementById("settings-panel");
                settingsCard?.scrollIntoView({ behavior: "smooth" });
                return;
            }

            // 点击卡片本身：只选中，不进入
            activeSlot = slot;
            loadSlotSettings(slot);
            renderSaves();
        });

        list.appendChild(card);
    }
}

// ============ 设置 ============

const keyInput = document.getElementById("api-key") as HTMLInputElement;
const modelSelect = document.getElementById("model-select") as HTMLSelectElement;
const effortSelect = document.getElementById("effort-select") as HTMLSelectElement;
const providerSelect = document.getElementById("provider-select") as HTMLSelectElement;
const customUrlInput = document.getElementById("custom-url") as HTMLInputElement;
const customUrlSetting = document.getElementById("custom-url-setting")!;
const saveHint = document.getElementById("save-hint")!;
const slotLabel = document.getElementById("slot-label")!;

// 加载指定槽位的设置到 UI
function loadSlotSettings(slot: number) {
    const provider = localStorage.getItem(slotKey(KEY_PREFIX.provider, slot)) ?? "deepseek";
    const key = localStorage.getItem(slotKey(KEY_PREFIX.apikey, slot)) ?? "";
    const customUrl = localStorage.getItem(slotKey(KEY_PREFIX.customUrl, slot)) ?? "";
    const effort = getEffort(); // effort 全局共享（键名与默认值统一由 ai.ts 提供）

    providerSelect.value = provider;
    keyInput.value = key;
    effortSelect.value = effort;
    customUrlInput.value = customUrl;
    customUrlSetting.style.display = provider === "custom" ? "" : "none";

    slotLabel.textContent = `存档 ${slot} 的 API 设置`;
    loadCachedModels(slot);
    // 【P0-13】TTS 设置也是 per-slot 的，必须随切槽一起刷新，
    // 否则面板显示/写入的仍是模块加载时的那个槽位。
    void loadTtsSettings(slot);
}

// 保存当前槽位的设置
function saveCurrentSettings() {
    localStorage.setItem(slotKey(KEY_PREFIX.provider, activeSlot), providerSelect.value);
    localStorage.setItem(slotKey(KEY_PREFIX.apikey, activeSlot), keyInput.value.trim());
    localStorage.setItem(slotKey(KEY_PREFIX.customUrl, activeSlot), customUrlInput.value.trim());
    if (modelSelect.value) {
        localStorage.setItem(slotKey(KEY_PREFIX.model, activeSlot), modelSelect.value);
    }
}

// 加载已缓存的模型列表
function loadCachedModels(slot: number) {
    const cached = localStorage.getItem(slotKey(KEY_PREFIX.modelsCache, slot));
    const savedModel = localStorage.getItem(slotKey(KEY_PREFIX.model, slot));
    modelSelect.innerHTML = "";

    if (cached) {
        const models: string[] = JSON.parse(cached);
        for (const m of models) {
            const opt = document.createElement("option");
            opt.value = m;
            opt.textContent = m;
            modelSelect.appendChild(opt);
        }
        if (savedModel && models.includes(savedModel)) {
            modelSelect.value = savedModel;
        }
    } else {
        const opt = document.createElement("option");
        opt.value = "";
        opt.textContent = "（点击「测试」获取模型列表）";
        modelSelect.appendChild(opt);
    }
}

// 初始化
// 【顺序修复】loadSlotSettings 是 async 且会访问 tts* 模块级 const，
// 必须等这些声明完成后再调用 —— 见文件末尾的初始化区。

function showHint() {
    saveHint.style.display = "block";
    setTimeout(() => (saveHint.style.display = "none"), 1500);
}

providerSelect.addEventListener("change", () => {
    customUrlSetting.style.display = providerSelect.value === "custom" ? "" : "none";
    saveCurrentSettings();
    showHint();
});

keyInput.addEventListener("change", () => {
    saveCurrentSettings();
    showHint();
});

modelSelect.addEventListener("change", () => {
    saveCurrentSettings();
    showHint();
});

effortSelect.addEventListener("change", () => {
    localStorage.setItem(EFFORT_KEY, effortSelect.value);
    showHint();
});

customUrlInput.addEventListener("change", () => {
    saveCurrentSettings();
    showHint();
});

// 清空所有数据
// ============ 【P0-12】存档导出 / 导入 ============

const ioStatus = document.getElementById("io-status")!;
const importFileInput = document.getElementById("import-file") as HTMLInputElement;

function setIoStatus(text: string, kind: "ok" | "err" | "info" = "info") {
    ioStatus.textContent = text;
    ioStatus.style.color = kind === "err" ? "var(--danger)" : kind === "ok" ? "var(--ink)" : "var(--ink-soft)";
}

// 导出当前正在配置的槽位
document.getElementById("export-save")!.addEventListener("click", () => {
    const result = exportSlotToJson(activeSlot);
    if (result.ok === false) {
        setIoStatus(`导出失败：${result.reason}`, "err");
        return;
    }
    const blob = new Blob([result.json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = result.filename;
    a.click();
    // 释放 blob URL，避免泄漏
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setIoStatus(`已导出存档 ${activeSlot}（${result.filename}）`, "ok");
});

// 导入：选择文件 → 四阶段校验 → 一次性提交（失败不破坏当前存档）
document.getElementById("import-save")!.addEventListener("click", () => {
    importFileInput.value = "";
    importFileInput.click();
});

importFileInput.addEventListener("change", async () => {
    const file = importFileInput.files?.[0];
    if (!file) return;
    setIoStatus("正在读取文件…", "info");
    let text: string;
    try {
        text = await file.text();
    } catch (e) {
        setIoStatus(`读取文件失败：${(e as Error).message}`, "err");
        return;
    }

    const target = activeSlot;
    if (!confirm(`把该存档导入到「存档 ${target}」？\n当前该槽位的内容会被替换（导入失败则保持不变）。`)) {
        setIoStatus("已取消导入", "info");
        return;
    }

    // importSave 内部已经是 parse → validate → migrate → commit（事务 + 回滚），
    // 任何一步失败都不会改动现有存档。
    const result = importSave(text, target);
    if (result.ok === false) {
        setIoStatus(`导入失败（${result.stage} 阶段）：${result.reason}`, "err");
        return;
    }

    const s = result.applied;
    setIoStatus(`已导入到存档 ${target}：${s.characterName} · 第 ${s.dayIndex} 天 · 好感 ${s.affection}`, "ok");
    renderSaves();
    loadSlotSettings(target);
    // 当前槽位被替换时内存状态已过期，提示刷新（不悄悄改内存，避免绕过契约校验路径）
    if (shouldReloadAfterImport(target, currentSlot)) {
        setIoStatus(`已导入到当前槽位，请刷新页面以载入新存档。`, "ok");
    }
});

document.getElementById("clear-data")!.addEventListener("click", () => {
    if (confirm("确定清空所有数据？\n此操作无法恢复！\n\n（只会清除本应用的数据，不会影响同源下的其它页面）")) {
        // 【P0-13 加固】白名单式清理，取代裸 localStorage.clear()
        const { removed } = clearAllAppData();
        alert(`已清空本应用的 ${removed} 项数据。页面即将刷新。`);
        location.reload();
    }
});

// ============ API 测试 & 模型列表 ============

const apiTestBtn = document.getElementById("api-test") as HTMLButtonElement;
const apiStatus = document.getElementById("api-status")!;

function getApiBase(): string {
    const provider = providerSelect.value;
    if (provider === "custom") {
        return customUrlInput.value.trim().replace(/\/+$/, "");
    }
    return PROVIDERS[provider]?.baseUrl ?? "";
}

function getHeaders(key: string): Record<string, string> {
    const provider = providerSelect.value;
    const p = PROVIDERS[provider];
    if (p?.headerFn) return p.headerFn(key);
    return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
    };
}

async function testApi() {
    const key = keyInput.value.trim();
    const provider = providerSelect.value;

    if (!key) {
        apiStatus.style.display = "block";
        apiStatus.style.color = "var(--danger)";
        apiStatus.textContent = "请先输入 API Key";
        return;
    }

    const baseUrl = getApiBase();
    if (!baseUrl) {
        apiStatus.style.display = "block";
        apiStatus.style.color = "var(--danger)";
        apiStatus.textContent = "请先填写自定义 API 地址";
        return;
    }

    // 保存 key
    saveCurrentSettings();

    apiTestBtn.disabled = true;
    apiTestBtn.textContent = "测试中…";
    apiStatus.style.display = "block";
    apiStatus.style.color = "var(--ink-soft)";
    apiStatus.textContent = `正在连接 ${PROVIDERS[provider]?.name ?? provider} API…`;

    try {
        // 【A-1】传输层走 ai/client；错误语义保持原样
        const { resp, data } = await requestJson(`${baseUrl}/models`, { headers: getHeaders(key) });

        if (!resp.ok) {
            throw new Error((data as any).error?.message ?? `HTTP ${resp.status}`);
        }

        const models: string[] = ((data as any).data ?? []).map((m: any) => m.id).filter(Boolean);

        if (!models.length) {
            throw new Error("未获取到模型列表");
        }

        // 缓存模型列表到当前槽位
        localStorage.setItem(slotKey(KEY_PREFIX.modelsCache, activeSlot), JSON.stringify(models));

        // 更新下拉框
        modelSelect.innerHTML = "";
        for (const m of models.sort()) {
            const opt = document.createElement("option");
            opt.value = m;
            opt.textContent = m;
            modelSelect.appendChild(opt);
        }
        modelSelect.value = models[0]!;
        localStorage.setItem(slotKey(KEY_PREFIX.model, activeSlot), modelSelect.value);

        apiStatus.style.color = "var(--ink)";
        apiStatus.textContent = `Key 有效！已获取 ${models.length} 个模型`;
    } catch (e) {
        apiStatus.style.color = "var(--danger)";
        apiStatus.textContent = `测试失败：${(e as Error).message}`;
    } finally {
        apiTestBtn.disabled = false;
        apiTestBtn.textContent = "测试";
    }
}

apiTestBtn.addEventListener("click", testApi);

// ============ TTS 语音设置 ============

const ttsApiKeyInput = document.getElementById("tts-api-key") as HTMLInputElement;
const ttsVoiceFile = document.getElementById("tts-voice-file") as HTMLInputElement;
const ttsVoiceClear = document.getElementById("tts-voice-clear") as HTMLButtonElement;
const ttsVoiceStatus = document.getElementById("tts-voice-status")!;
const ttsLangSelect = document.getElementById("tts-lang") as HTMLSelectElement;
const ttsStyleInput = document.getElementById("tts-style") as HTMLInputElement;
const ttsTestText = document.getElementById("tts-test-text") as HTMLInputElement;
const ttsTestBtn = document.getElementById("tts-test-btn") as HTMLButtonElement;
const ttsTestStatus = document.getElementById("tts-test-status")!;
const ttsToggleStatus = document.getElementById("tts-toggle-status")!;

// 初始化 TTS 设置
/**
 * 【P0-13】加载指定槽位的 TTS 设置。
 *
 * 缺陷原貌：本页原有无参版本，只能读"模块加载时冻结的槽位"。
 * 而菜单页是**一页多槽**：点某张存档卡的「API 设置」会把要配置的槽位切到该卡，
 * 于是面板标题写着「存档 5」、`apikey-5` 也写对了，
 * 但 TTS 专用 Key / 音色 / 风格 / 语言却全被读写到了槽位 1。
 *
 * 修法：显式传入正在配置的槽位（`activeSlot`），并在切槽时重新加载 TTS 面板。
 */
async function loadTtsSettings(slot: number) {
    ttsApiKeyInput.value = getTtsApiKey(slot);
    ttsLangSelect.value = getTtsLang(slot);
    const voice = await getVoiceBase64(slot);
    if (voice) {
        ttsVoiceStatus.textContent = "已上传音色样本";
        ttsVoiceStatus.style.color = "var(--ink)";
    } else {
        ttsVoiceStatus.textContent = "未上传";
        ttsVoiceStatus.style.color = "var(--ink-soft)";
    }
    ttsStyleInput.value = getTtsStyle(slot);
    // 顺便刷新 TTS 开关的显示（它同样是 per-slot 的）
    const enabled = isTtsEnabledForSlot(slot);
    ttsToggleStatus.textContent = enabled ? "此存档：已开启" : "此存档：未开启";
    ttsToggleStatus.style.color = enabled ? "var(--ink)" : "var(--ink-soft)";
}

// 【P0-13 / G6】旧版全局 TTS 开关的一次性迁移（把旧的"全局开"复制到每个槽位并删除旧键）
migrateTtsEnabledScope(Array.from({ length: TOTAL_SLOTS }, (_, i) => i + 1));

// 【P0-2】把各槽位的音色从 localStorage 迁移到 IndexedDB。
// fail-safe：只有新位置写入并读回校验成功后才删除旧数据；
// 失败（含 IndexedDB 不可用）时旧数据原样保留，功能不受影响。
void (async () => {
    const slots = Array.from({ length: TOTAL_SLOTS }, (_, i) => i + 1);
    const results = await migrateAllVoices(slots);
    const migrated = results.filter((r) => r.status === "migrated" || r.status === "already-migrated");
    const failed = results.filter((r) => r.status === "write-failed" || r.status === "verify-failed");
    if (migrated.length) console.log(`[TTS] 音色已迁移到 IndexedDB：${migrated.map((r) => r.slot).join(",")}`);
    if (failed.length) console.warn(`[TTS] 音色迁移失败（旧数据已保留）：${failed.map((r) => r.slot).join(",")}`);
    // 迁移后刷新当前面板（音色状态可能从"未上传"变为"已上传"）
    void loadTtsSettings(activeSlot);
})();

// 保存 TTS API Key
ttsApiKeyInput.addEventListener("change", () => {
    setTtsApiKey(ttsApiKeyInput.value.trim(), activeSlot);
    showHint();
});

// 保存 TTS 语言
ttsLangSelect.addEventListener("change", () => {
    setTtsLang(ttsLangSelect.value as TtsLang, activeSlot);
    showHint();
});

// 上传音色文件
ttsVoiceFile.addEventListener("change", async () => {
    const file = ttsVoiceFile.files?.[0];
    if (!file) return;

    try {
        ttsVoiceStatus.textContent = "读取中…";
        ttsVoiceStatus.style.color = "var(--ink-soft)";
        const base64 = await readAudioFile(file);
        // 【P0-2】写入结果带失败原因（含"写完导致存档失败 → 已回滚"这一情况）
        const result = await setVoiceBase64(base64, activeSlot);
        if (result.ok === false) {
            ttsVoiceStatus.textContent = result.reason;
            ttsVoiceStatus.style.color = "var(--danger)";
            return;
        }
        ttsVoiceStatus.textContent = result.stored === "indexeddb" ? "已上传音色样本（IndexedDB）" : "已上传音色样本";
        ttsVoiceStatus.style.color = "var(--ink)";
    } catch (e) {
        ttsVoiceStatus.textContent = (e as Error).message;
        ttsVoiceStatus.style.color = "var(--danger)";
    }
});

// 清除音色
ttsVoiceClear.addEventListener("click", async () => {
    await clearVoice(activeSlot);
    ttsVoiceFile.value = "";
    ttsVoiceStatus.textContent = "未上传";
    ttsVoiceStatus.style.color = "var(--ink-soft)";
});

// 保存风格指令
ttsStyleInput.addEventListener("change", () => {
    setTtsStyle(ttsStyleInput.value.trim(), activeSlot);
});

// TTS 测试
ttsTestBtn.addEventListener("click", async () => {
    const text = ttsTestText.value.trim();
    if (!text) {
        ttsTestStatus.textContent = "请输入要朗读的文字";
        ttsTestStatus.style.color = "var(--danger)";
        return;
    }

    const voice = await getVoiceBase64(activeSlot);
    if (!voice) {
        ttsTestStatus.textContent = "请先上传音色样本";
        ttsTestStatus.style.color = "var(--danger)";
        return;
    }

    ttsTestBtn.disabled = true;
    ttsTestBtn.textContent = "合成中…";
    ttsTestStatus.textContent = "正在调用 MiMo TTS API...";
    ttsTestStatus.style.color = "var(--ink-soft)";

    try {
        const buffer = await synthesizeSpeech(text, ttsStyleInput.value.trim());
        const blob = new Blob([buffer], { type: "audio/wav" });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        await audio.play();
        ttsTestStatus.textContent = "播放成功";
        ttsTestStatus.style.color = "var(--ink)";
    } catch (e) {
        ttsTestStatus.textContent = (e as Error).message;
        ttsTestStatus.style.color = "var(--danger)";
    } finally {
        ttsTestBtn.disabled = false;
        ttsTestBtn.textContent = "试听";
    }
});

// ============ 初始化 ============
//
// 顺序很重要：本文件里有多个 async 初始化函数，它们会访问 tts*/… 等模块级 `const`。
// 若在那些声明**之前**调用，会命中暂时性死区（TDZ）：
//   ReferenceError: Cannot access 'ttsApiKeyInput' before initialization
// 这类错误类型检查发现不了（类型完全正确），只能靠真实页面冒烟测试暴露。
// 因此所有初始化调用统一收敛到文件末尾 —— 此处所有声明都已完成。

renderSaves();
loadSlotSettings(activeSlot);
void loadTtsSettings(activeSlot);
