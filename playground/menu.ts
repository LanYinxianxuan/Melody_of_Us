// menu.ts —— 菜单页：多存档列表 + 设置（复用 storage 模块）

import { loadSlotRaw, loadSlotCharacterName, clearSlot } from "./storage";

const KEY_STORE = "deepseek-key";
const MODEL_STORE = "deepseek-model";
const EFFORT_STORE = "deepseek-effort";
const PROVIDER_STORE = "deepseek-provider";
const CUSTOM_URL_STORE = "deepseek-custom-url";
const TOTAL_SLOTS = 5;

// 供应商配置
const PROVIDERS: Record<string, { name: string; baseUrl: string; models: string[]; headerFn?: (key: string) => Record<string, string> }> = {
    deepseek: {
        name: "DeepSeek",
        baseUrl: "https://api.deepseek.com",
        models: ["deepseek-chat", "deepseek-reasoner"],
    },
    openai: {
        name: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4", "gpt-3.5-turbo", "o1-preview", "o1-mini"],
    },
    claude: {
        name: "Claude",
        baseUrl: "https://api.anthropic.com/v1",
        models: ["claude-sonnet-4-20250514", "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229"],
        headerFn: (key) => ({
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }),
    },
    gemini: {
        name: "Gemini",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
        models: ["gemini-2.0-flash", "gemini-2.0-flash-lite", "gemini-1.5-pro", "gemini-1.5-flash"],
    },
    moonshot: {
        name: "Moonshot",
        baseUrl: "https://api.moonshot.cn/v1",
        models: ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    },
    qwen: {
        name: "通义千问",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        models: ["qwen-turbo", "qwen-plus", "qwen-max", "qwen-long"],
    },
    zhipu: {
        name: "智谱",
        baseUrl: "https://open.bigmodel.cn/api/paas/v4",
        models: ["glm-4-flash", "glm-4-air", "glm-4", "glm-4-long"],
    },
    xiaomi: {
        name: "小米 MiMo",
        baseUrl: "https://api.xiaomimimo.com/v1",
        models: ["mimo-v2.5-pro", "mimo-v2.5"],
    },
    custom: {
        name: "自定义",
        baseUrl: "",
        models: [],
    },
};

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

function renderSaves() {
    const list = document.getElementById("save-list")!;
    const current = parseInt(localStorage.getItem("melai-current-slot") ?? "1", 10) || 1;
    list.innerHTML = "";

    for (let slot = 1; slot <= TOTAL_SLOTS; slot++) {
        const save = loadSlotRaw(slot);
        const card = document.createElement("div");
        card.className = `save-card${slot === current ? " active" : ""}`;

        if (save) {
            const s = save.aiState as Record<string, number>;
            const aff = Math.round(s.affection ?? 0);
            card.innerHTML = `
                <div class="s-head">
                  <span class="s-name">存档 ${slot} · ${loadSlotCharacterName(slot)}</span>
                  <span style="display:flex;gap:6px;align-items:center;">
                    <span class="s-tag">${slot === current ? "当前" : ""}</span>
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
                  <span class="s-tag">空</span>
                </div>
                <div class="s-empty">还没有记录。</div>
                <div class="s-go">＋ 从这里开始一段新故事</div>`;
        }

        card.addEventListener("click", (e) => {
            const delBtn = (e.target as HTMLElement).closest(".s-del") as HTMLElement | null;

            // 单独删除存档
            if (delBtn) {
                e.stopPropagation();
                const delSlot = parseInt(delBtn.dataset.del ?? "0", 10);

                if (
                    confirm(
                        `删除存档 ${delSlot}？\n将删除该存档的情感、剧情、聊天记录、时间线和角色设定。此操作无法恢复！`,
                    )
                ) {
                    clearSlot(delSlot);
                    renderSaves();
                }
                return;
            }

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

// 初始化设置值
const savedProvider = localStorage.getItem(PROVIDER_STORE) ?? "deepseek";
providerSelect.value = savedProvider;
keyInput.value = localStorage.getItem(KEY_STORE) ?? "";
effortSelect.value = localStorage.getItem(EFFORT_STORE) ?? "high";
customUrlInput.value = localStorage.getItem(CUSTOM_URL_STORE) ?? "";

// 根据供应商更新模型列表
function updateModelList(provider: string, selectedModel?: string) {
    const p = PROVIDERS[provider];
    if (!p) return;

    modelSelect.innerHTML = "";
    const models = p.models.length ? p.models : ["（请先测试获取模型列表）"];
    for (const m of models) {
        const opt = document.createElement("option");
        opt.value = m;
        opt.textContent = m;
        modelSelect.appendChild(opt);
    }

    // 恢复之前选中的模型
    const saved = selectedModel ?? localStorage.getItem(MODEL_STORE);
    if (saved && models.includes(saved)) {
        modelSelect.value = saved;
    } else {
        modelSelect.value = models[0]!;
        localStorage.setItem(MODEL_STORE, modelSelect.value);
    }

    // 自定义供应商显示 URL 输入框
    customUrlSetting.style.display = provider === "custom" ? "" : "none";
}

updateModelList(savedProvider);

function showHint() {
    saveHint.style.display = "block";
    setTimeout(() => (saveHint.style.display = "none"), 1500);
}

providerSelect.addEventListener("change", () => {
    localStorage.setItem(PROVIDER_STORE, providerSelect.value);
    updateModelList(providerSelect.value);
    showHint();
});

keyInput.addEventListener("change", () => {
    localStorage.setItem(KEY_STORE, keyInput.value.trim());
    showHint();
});

modelSelect.addEventListener("change", () => {
    localStorage.setItem(MODEL_STORE, modelSelect.value);
    showHint();
});

effortSelect.addEventListener("change", () => {
    localStorage.setItem(EFFORT_STORE, effortSelect.value);
    showHint();
});

customUrlInput.addEventListener("change", () => {
    localStorage.setItem(CUSTOM_URL_STORE, customUrlInput.value.trim());
    showHint();
});

// 清空所有数据
document.getElementById("clear-data")!.addEventListener("click", () => {
    if (
        confirm(
            "确定清空所有数据？\n这会删除：全部存档（1~9 槽）、所有角色设定、API Key、模型设置。\n此操作无法恢复！",
        )
    ) {
        localStorage.clear();
        alert("已清空全部数据。页面即将刷新，重新开始。");
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

    apiTestBtn.disabled = true;
    apiTestBtn.textContent = "⏳ 测试中…";
    apiStatus.style.display = "block";
    apiStatus.style.color = "var(--ink-soft)";
    apiStatus.textContent = `正在连接 ${PROVIDERS[provider]?.name ?? provider} API…`;

    try {
        // 获取模型列表
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

        // 更新模型下拉框
        modelSelect.innerHTML = "";
        for (const m of models.sort()) {
            const opt = document.createElement("option");
            opt.value = m;
            opt.textContent = m;
            modelSelect.appendChild(opt);
        }
        modelSelect.value = models[0]!;
        localStorage.setItem(MODEL_STORE, modelSelect.value);

        apiStatus.style.color = "#34d399";
        apiStatus.textContent = `✅ Key 有效！已获取 ${models.length} 个模型：${models.join("、")}`;
    } catch (e) {
        apiStatus.style.color = "#ffb0b0";
        apiStatus.textContent = `❌ 测试失败：${(e as Error).message}`;
    } finally {
        apiTestBtn.disabled = false;
        apiTestBtn.textContent = "🔍 测试";
    }
}

apiTestBtn.addEventListener("click", testApi);

// ============ 初始化 ============

renderSaves();
