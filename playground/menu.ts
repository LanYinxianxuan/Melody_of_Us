// menu.ts —— 菜单页：多存档列表 + 设置（复用 storage 模块）
// 每个存档槽位独立的 API 设置

import { loadSlotRaw, loadSlotCharacterName, clearSlot, currentSlot } from "./storage";
import { readAudioFile, setVoiceBase64, getVoiceBase64, clearVoice, getTtsStyle, setTtsStyle, getTtsApiKey, setTtsApiKey, synthesizeSpeech } from "./tts";

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

// 每个存档槽位独立的存储键（格式：设置项-槽位号）
function slotKey(setting: string, slot: number): string {
    return `${setting}-${slot}`;
}

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
        const provider = localStorage.getItem(slotKey("provider", slot)) ?? "deepseek";
        const providerName = PROVIDERS[provider]?.name ?? provider;
        const hasKey = !!localStorage.getItem(slotKey("apikey", slot));

        if (save) {
            const s = save.aiState as Record<string, number>;
            const aff = Math.round(s.affection ?? 0);
            card.innerHTML = `
                <div class="s-head">
                  <span class="s-name">存档 ${slot} · ${loadSlotCharacterName(slot)}</span>
                  <span style="display:flex;gap:6px;align-items:center;">
                    <span class="s-tag">${providerName}${hasKey ? " ✓" : " ✗"}</span>
                    <button class="s-del" data-del="${slot}">🗑 删除</button>
                  </span>
                </div>
                <div class="s-info">
                  好感 <b style="color:#f472b6;">${aff}/100</b> ｜ ${moodLine(s)} ｜ 对话 ${save.turnCount ?? 0} 轮 ｜ 剧情 ${save.storyProgress ?? 0}%
                  <br><span style="color:rgba(255,255,255,0.4);">${fmtTime((save.savedAt as number) ?? Date.now())}</span>
                </div>
                <div class="s-go">▶ 继续这个存档</div>`;
        } else {
            card.innerHTML = `
                <div class="s-head">
                  <span class="s-name">存档 ${slot}</span>
                  <span style="display:flex;gap:6px;align-items:center;">
                    <span class="s-tag">${providerName}${hasKey ? " ✓" : " ✗"}</span>
                  </span>
                </div>
                <div class="s-empty">还没有记录。</div>
                <div class="s-go">＋ 从这里开始一段新故事</div>`;
        }

        card.addEventListener("click", (e) => {
            const delBtn = (e.target as HTMLElement).closest(".s-del") as HTMLElement | null;

            if (delBtn) {
                e.stopPropagation();
                const delSlot = parseInt(delBtn.dataset.del ?? "0", 10);
                if (confirm(`删除存档 ${delSlot}？\n此操作无法恢复！`)) {
                    clearSlot(delSlot);
                    // 也清除该槽位的 API 设置
                    localStorage.removeItem(slotKey("provider", delSlot));
                    localStorage.removeItem(slotKey("apikey", delSlot));
                    localStorage.removeItem(slotKey("model", delSlot));
                    localStorage.removeItem(slotKey("custom-url", delSlot));
                    localStorage.removeItem(slotKey("models-cache", delSlot));
                    renderSaves();
                }
                return;
            }

            // 切换到该槽位并进入聊天
            localStorage.setItem("melai-current-slot", String(slot));
            const isNew = !save;
            location.href = `./chat.html?slot=${slot}${isNew ? "&new=1" : ""}`;
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
    const provider = localStorage.getItem(slotKey("provider", slot)) ?? "deepseek";
    const key = localStorage.getItem(slotKey("apikey", slot)) ?? "";
    const model = localStorage.getItem(slotKey("model", slot)) ?? "";
    const customUrl = localStorage.getItem(slotKey("custom-url", slot)) ?? "";
    const effort = localStorage.getItem("melai-effort") ?? "high"; // effort 全局共享

    providerSelect.value = provider;
    keyInput.value = key;
    effortSelect.value = effort;
    customUrlInput.value = customUrl;
    customUrlSetting.style.display = provider === "custom" ? "" : "none";

    slotLabel.textContent = `存档 ${slot} 的 API 设置`;
    loadCachedModels(slot);
}

// 保存当前槽位的设置
function saveCurrentSettings() {
    localStorage.setItem(slotKey("provider", activeSlot), providerSelect.value);
    localStorage.setItem(slotKey("apikey", activeSlot), keyInput.value.trim());
    localStorage.setItem(slotKey("custom-url", activeSlot), customUrlInput.value.trim());
    if (modelSelect.value) {
        localStorage.setItem(slotKey("model", activeSlot), modelSelect.value);
    }
}

// 加载已缓存的模型列表
function loadCachedModels(slot: number) {
    const cached = localStorage.getItem(slotKey("models-cache", slot));
    const savedModel = localStorage.getItem(slotKey("model", slot));
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
loadSlotSettings(activeSlot);

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
    localStorage.setItem("melai-effort", effortSelect.value);
    showHint();
});

customUrlInput.addEventListener("change", () => {
    saveCurrentSettings();
    showHint();
});

// 清空所有数据
document.getElementById("clear-data")!.addEventListener("click", () => {
    if (confirm("确定清空所有数据？\n此操作无法恢复！")) {
        localStorage.clear();
        alert("已清空全部数据。页面即将刷新。");
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
        apiStatus.style.color = "#ffb0b0";
        apiStatus.textContent = "⚠️ 请先输入 API Key";
        return;
    }

    const baseUrl = getApiBase();
    if (!baseUrl) {
        apiStatus.style.display = "block";
        apiStatus.style.color = "#ffb0b0";
        apiStatus.textContent = "⚠️ 请先填写自定义 API 地址";
        return;
    }

    // 保存 key
    saveCurrentSettings();

    apiTestBtn.disabled = true;
    apiTestBtn.textContent = "⏳ 测试中…";
    apiStatus.style.display = "block";
    apiStatus.style.color = "var(--ink-soft)";
    apiStatus.textContent = `正在连接 ${PROVIDERS[provider]?.name ?? provider} API…`;

    try {
        const resp = await fetch(`${baseUrl}/models`, {
            headers: getHeaders(key),
        });

        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.error?.message ?? `HTTP ${resp.status}`);
        }

        const data = await resp.json();
        const models: string[] = (data.data ?? []).map((m: any) => m.id).filter(Boolean);

        if (!models.length) {
            throw new Error("未获取到模型列表");
        }

        // 缓存模型列表到当前槽位
        localStorage.setItem(slotKey("models-cache", activeSlot), JSON.stringify(models));

        // 更新下拉框
        modelSelect.innerHTML = "";
        for (const m of models.sort()) {
            const opt = document.createElement("option");
            opt.value = m;
            opt.textContent = m;
            modelSelect.appendChild(opt);
        }
        modelSelect.value = models[0]!;
        localStorage.setItem(slotKey("model", activeSlot), modelSelect.value);

        apiStatus.style.color = "#34d399";
        apiStatus.textContent = `✅ Key 有效！已获取 ${models.length} 个模型`;
    } catch (e) {
        apiStatus.style.color = "#ffb0b0";
        apiStatus.textContent = `❌ 测试失败：${(e as Error).message}`;
    } finally {
        apiTestBtn.disabled = false;
        apiTestBtn.textContent = "🔍 测试";
    }
}

apiTestBtn.addEventListener("click", testApi);

// ============ TTS 语音设置 ============

const ttsApiKeyInput = document.getElementById("tts-api-key") as HTMLInputElement;
const ttsVoiceFile = document.getElementById("tts-voice-file") as HTMLInputElement;
const ttsVoiceClear = document.getElementById("tts-voice-clear") as HTMLButtonElement;
const ttsVoiceStatus = document.getElementById("tts-voice-status")!;
const ttsStyleInput = document.getElementById("tts-style") as HTMLInputElement;
const ttsTestText = document.getElementById("tts-test-text") as HTMLInputElement;
const ttsTestBtn = document.getElementById("tts-test-btn") as HTMLButtonElement;
const ttsTestStatus = document.getElementById("tts-test-status")!;

// 初始化 TTS 设置
function loadTtsSettings() {
    ttsApiKeyInput.value = getTtsApiKey();
    const voice = getVoiceBase64();
    if (voice) {
        ttsVoiceStatus.textContent = "✅ 已上传音色样本";
        ttsVoiceStatus.style.color = "#34d399";
    } else {
        ttsVoiceStatus.textContent = "未上传";
        ttsVoiceStatus.style.color = "var(--ink-soft)";
    }
    ttsStyleInput.value = getTtsStyle();
}

loadTtsSettings();

// 保存 TTS API Key
ttsApiKeyInput.addEventListener("change", () => {
    setTtsApiKey(ttsApiKeyInput.value.trim());
    showHint();
});

// 上传音色文件
ttsVoiceFile.addEventListener("change", async () => {
    const file = ttsVoiceFile.files?.[0];
    if (!file) return;

    try {
        ttsVoiceStatus.textContent = "⏳ 读取中...";
        ttsVoiceStatus.style.color = "var(--ink-soft)";
        const base64 = await readAudioFile(file);
        setVoiceBase64(base64);
        ttsVoiceStatus.textContent = "✅ 已上传音色样本";
        ttsVoiceStatus.style.color = "#34d399";
    } catch (e) {
        ttsVoiceStatus.textContent = `❌ ${(e as Error).message}`;
        ttsVoiceStatus.style.color = "#ffb0b0";
    }
});

// 清除音色
ttsVoiceClear.addEventListener("click", () => {
    clearVoice();
    ttsVoiceFile.value = "";
    ttsVoiceStatus.textContent = "未上传";
    ttsVoiceStatus.style.color = "var(--ink-soft)";
});

// 保存风格指令
ttsStyleInput.addEventListener("change", () => {
    setTtsStyle(ttsStyleInput.value.trim());
});

// TTS 测试
ttsTestBtn.addEventListener("click", async () => {
    const text = ttsTestText.value.trim();
    if (!text) {
        ttsTestStatus.textContent = "⚠️ 请输入要朗读的文字";
        ttsTestStatus.style.color = "#ffb0b0";
        return;
    }

    const voice = getVoiceBase64();
    if (!voice) {
        ttsTestStatus.textContent = "⚠️ 请先上传音色样本";
        ttsTestStatus.style.color = "#ffb0b0";
        return;
    }

    ttsTestBtn.disabled = true;
    ttsTestBtn.textContent = "⏳ 合成中...";
    ttsTestStatus.textContent = "正在调用 MiMo TTS API...";
    ttsTestStatus.style.color = "var(--ink-soft)";

    try {
        const buffer = await synthesizeSpeech(text, ttsStyleInput.value.trim());
        const blob = new Blob([buffer], { type: "audio/wav" });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        await audio.play();
        ttsTestStatus.textContent = "✅ 播放成功";
        ttsTestStatus.style.color = "#34d399";
    } catch (e) {
        ttsTestStatus.textContent = `❌ ${(e as Error).message}`;
        ttsTestStatus.style.color = "#ffb0b0";
    } finally {
        ttsTestBtn.disabled = false;
        ttsTestBtn.textContent = "🔊 试听";
    }
});

// ============ 初始化 ============

renderSaves();
