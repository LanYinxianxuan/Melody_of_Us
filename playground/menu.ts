// menu.ts —— 菜单页：多存档列表 + 设置（复用 storage 模块）

import { loadSlotRaw, loadSlotCharacterName, clearSlot } from "./storage";

const KEY_STORE = "deepseek-key";
const MODEL_STORE = "deepseek-model";
const EFFORT_STORE = "deepseek-effort";
const TOTAL_SLOTS = 5;

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
const saveHint = document.getElementById("save-hint")!;

keyInput.value = localStorage.getItem(KEY_STORE) ?? "";
modelSelect.value = localStorage.getItem(MODEL_STORE) ?? "deepseek-v4-flash";
effortSelect.value = localStorage.getItem(EFFORT_STORE) ?? "high";

function showHint() {
    saveHint.style.display = "block";
    setTimeout(() => (saveHint.style.display = "none"), 1500);
}

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
const API_BASE = "https://api.deepseek.com";

async function testApi() {
    const key = keyInput.value.trim();
    if (!key) {
        apiStatus.style.display = "block";
        apiStatus.style.color = "#ffb0b0";
        apiStatus.textContent = "⚠️ 请先输入 API Key";
        return;
    }

    apiTestBtn.disabled = true;
    apiTestBtn.textContent = "⏳ 测试中…";
    apiStatus.style.display = "block";
    apiStatus.style.color = "var(--ink-soft)";
    apiStatus.textContent = "正在连接 DeepSeek API…";

    try {
        // 获取模型列表
        const resp = await fetch(`${API_BASE}/models`, {
            headers: { Authorization: `Bearer ${key}` },
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
        const currentVal = modelSelect.value;
        modelSelect.innerHTML = "";
        for (const m of models.sort()) {
            const opt = document.createElement("option");
            opt.value = m;
            opt.textContent = m;
            modelSelect.appendChild(opt);
        }
        // 保持之前选中的模型（如果还在列表中）
        if (models.includes(currentVal)) {
            modelSelect.value = currentVal;
        } else {
            modelSelect.value = models[0]!;
            localStorage.setItem(MODEL_STORE, modelSelect.value);
        }

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
