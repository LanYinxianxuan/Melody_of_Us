// menu.ts —— 菜单页：多存档列表 + 设置（复用 storage 模块）

import { loadSlotRaw, loadSlotCharacterName, clearSlot } from "./storage";

const PROVIDER_STORE = "melai-provider";
const MODEL_STORE = "melai-model";
const EFFORT_STORE = "melai-effort";
const CUSTOM_URL_STORE = "melai-custom-url";
const TOTAL_SLOTS = 5;

// 供应商配置（models 为空数组，通过 API 获取）
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

// 每个供应商独立的 API Key 存储键
function getKeyStore(provider: string): string {
    return `apikey-${provider}`;
}

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

            if (delBtn) {
                e.stopPropagation();
                const delSlot = parseInt(delBtn.dataset.del ?? "0", 10);
                if (confirm(`删除存档 ${delSlot}？\n此操作无法恢复！`)) {
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

let currentProvider = localStorage.getItem(PROVIDER_STORE) ?? "deepseek";

// 切换供应商时：保存当前供应商的 key → 加载新供应商的 key
function switchProvider(newProvider: string) {
    // 保存当前供应商的 key
    localStorage.setItem(getKeyStore(currentProvider), keyInput.value.trim());
    // 切换
    currentProvider = newProvider;
    localStorage.setItem(PROVIDER_STORE, currentProvider);
    // 加载新供应商的 key
    keyInput.value = localStorage.getItem(getKeyStore(currentProvider)) ?? "";
    // 更新 UI
    customUrlSetting.style.display = currentProvider === "custom" ? "" : "none";
    if (currentProvider === "custom") {
        customUrlInput.value = localStorage.getItem(CUSTOM_URL_STORE) ?? "";
    }
    // 加载该供应商已缓存的模型列表
    loadCachedModels(currentProvider);
}

// 加载已缓存的模型列表
function loadCachedModels(provider: string) {
    const cached = localStorage.getItem(`models-${provider}`);
    const savedModel = localStorage.getItem(`${MODEL_STORE}-${provider}`);
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
providerSelect.value = currentProvider;
keyInput.value = localStorage.getItem(getKeyStore(currentProvider)) ?? "";
effortSelect.value = localStorage.getItem(EFFORT_STORE) ?? "high";
customUrlSetting.style.display = currentProvider === "custom" ? "" : "none";
if (currentProvider === "custom") {
    customUrlInput.value = localStorage.getItem(CUSTOM_URL_STORE) ?? "";
}
loadCachedModels(currentProvider);

function showHint() {
    saveHint.style.display = "block";
    setTimeout(() => (saveHint.style.display = "none"), 1500);
}

providerSelect.addEventListener("change", () => {
    switchProvider(providerSelect.value);
    showHint();
});

keyInput.addEventListener("change", () => {
    localStorage.setItem(getKeyStore(currentProvider), keyInput.value.trim());
    showHint();
});

modelSelect.addEventListener("change", () => {
    if (modelSelect.value) {
        localStorage.setItem(`${MODEL_STORE}-${currentProvider}`, modelSelect.value);
    }
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
    if (currentProvider === "custom") {
        return customUrlInput.value.trim().replace(/\/+$/, "");
    }
    return PROVIDERS[currentProvider]?.baseUrl ?? "";
}

function getHeaders(key: string): Record<string, string> {
    const p = PROVIDERS[currentProvider];
    if (p?.headerFn) return p.headerFn(key);
    return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
    };
}

async function testApi() {
    const key = keyInput.value.trim();

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
    localStorage.setItem(getKeyStore(currentProvider), key);

    apiTestBtn.disabled = true;
    apiTestBtn.textContent = "⏳ 测试中…";
    apiStatus.style.display = "block";
    apiStatus.style.color = "var(--ink-soft)";
    apiStatus.textContent = `正在连接 ${PROVIDERS[currentProvider]?.name ?? currentProvider} API…`;

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

        // 缓存模型列表
        localStorage.setItem(`models-${currentProvider}`, JSON.stringify(models));

        // 更新下拉框
        modelSelect.innerHTML = "";
        for (const m of models.sort()) {
            const opt = document.createElement("option");
            opt.value = m;
            opt.textContent = m;
            modelSelect.appendChild(opt);
        }
        modelSelect.value = models[0]!;
        localStorage.setItem(`${MODEL_STORE}-${currentProvider}`, modelSelect.value);

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

// ============ 初始化 ============

renderSaves();
