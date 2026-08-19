// wizard.ts —— 角色创建向导：预设选择 / 自由介绍 + AI 访谈追问 / 降级补缺
// 依赖 character / ai；保存后的界面反馈通过回调交给 chat.ts。

import { CHARACTER, PRESETS, saveCharacter, setCharacter, type CharacterProfile } from "./character";
import { interviewWithAI, type InterviewTurn } from "./ai";
import { CHAR_KEY, store, saveState, DEFAULT_SCENE, type SceneConfig } from "./storage";
import { aiState, initStateForRelation } from "./state";
import { setProactiveEnabled } from "./time";

// ============ 场景解析 ============
// 用户自由描述"在哪生活/她平时做什么" → 场景配置（驱动作息/地点/世界观）
function parseSceneText(text: string): SceneConfig {
    const t = text.trim();
    if (!t) return { ...DEFAULT_SCENE };

    // 常见场所关键词 → 场所名；否则用整句的开头部分
    const placeMap: [RegExp, string][] = [
        [/咖啡|奶茶|饮品|甜品|点心/, "咖啡店"],
        [/酒吧|live|Live|livehouse|live house/, "酒吧"],
        [/便利店|超市|商店|小店/, "便利店"],
        [/公司|写字楼|办公室|上班/, "公司"],
        [/学校|大学|学院|教室|高中|初中/, "学校"],
        [/医院|诊所/, "医院"],
        [/工作室|画室|摄影/, "工作室"],
        [/乐队|排练|舞台|演唱会/, "排练室"],
        [/书店|图书馆/, "书店"],
        [/海边|小镇|村子|乡村/, "小镇"],
    ];
    let place = "她住的地方附近";
    for (const [re, p] of placeMap) {
        if (re.test(t)) { place = p; break; }
    }

    // 她平时做的事：找动作描述
    const routineMap: [RegExp, string][] = [
        [/冲咖啡|做咖啡|拉花/, "冲咖啡、招呼客人"],
        [/唱歌|驻唱|弹吉他|弹琴/, "排练、唱歌"],
        [/写代码|编程|程序员|开发/, "写代码"],
        [/上课|学习|读书|考研/, "上课学习"],
        [/画画|画漫画|插画/, "画画"],
        [/写小说|写作|写稿/, "写稿"],
        [/收银|理货|摆货架/, "理货、收银"],
        [/看病|出诊|护士/, "看诊"],
        [/练习|排练/, "排练"],
        [/开店|经营|营业/, "看店、招呼客人"],
        [/打工|店员|服务员|兼职/, "招呼客人、忙店里的事"],
    ];
    let routine = "忙着";
    for (const [re, r] of routineMap) {
        if (re.test(t)) { routine = r; break; }
    }
    if (routine === "忙着") routine = "忙她自己的事";

    const othersMap: [RegExp, string][] = [
        [/咖啡|奶茶/, "顾客"],
        [/酒吧|live|Live/, "观众"],
        [/公司|办公室|上班/, "同事"],
        [/学校|大学|教室/, "同学"],
        [/医院|诊所/, "病人"],
        [/工作室|画室/, "同伴"],
        [/乐队|排练|舞台/, "乐队伙伴"],
        [/书店|图书馆/, "来看书的人"],
    ];
    let others = "周围的人";
    for (const [re, o] of othersMap) {
        if (re.test(t)) { others = o; break; }
    }

    // 忙/休息时段标签
    let busyLabel = "忙";
    let restLabel = "休息";
    if (place === "学校") { busyLabel = "上课"; restLabel = "课间"; }
    else if (place === "公司") { busyLabel = "上班"; restLabel = "休息"; }
    else if (place === "排练室" || place === "酒吧") { busyLabel = "排练"; restLabel = "休息"; }
    else if (place === "便利店" || place === "咖啡店" || place === "书店") { busyLabel = "开店"; restLabel = "空闲"; }

    return { name: t.slice(0, 24), place, routine, others, busyLabel, restLabel };
}

// ============ 草稿与字段 ============

export interface WizardDraft extends CharacterProfile {}

const wizardModal = document.getElementById("wizard-modal")!;
const wizardBody = document.getElementById("wizard-body")!;
const wizardPrev = document.getElementById("wizard-prev") as HTMLButtonElement;
const wizardNext = document.getElementById("wizard-next") as HTMLButtonElement;

let wizardStep = 0; // 0=预设；1=自由介绍；2+ = AI访谈/补缺追问
let wizardDraft: WizardDraft = emptyDraft();
let pendingFields: (keyof WizardDraft)[] = [];

function emptyDraft(): WizardDraft {
    return { name: "", age: "", appearance: "", personality: "", background: "", speechStyle: "", likes: "", dislikes: "", relation: "", secrets: "" };
}

const PERSONALITY_CHIPS = ["温柔", "元气", "傲娇", "高冷", "毒舌", "内向", "天然呆", "爱操心", "成熟", "敏感"];
const SPEECH_CHIPS = ["软萌尾音", "干脆直率", "网感俏皮", "谨小慎微", "轻声细语"];
const RELATION_CHIPS = ["同学/同桌", "朋友", "恋人", "青梅竹马", "同事", "家人", "刚认识"];

// 可追问的字段定义（降级时只问最基本的信息：名字/性格/关系）
const FIELD_STEPS: { key: keyof WizardDraft; title: string; q: string; hint: string; type: "input" | "area" | "personality" | "speech" | "relation" }[] = [
    { key: "name", title: "名字", q: "她叫什么名字？", hint: "可以写中文名，也可以加昵称，比如「仁菜（Nina）」", type: "input" },
    { key: "age", title: "年龄", q: "她多大？", hint: "比如：17 岁 / 大学生 / 28 岁的社畜…", type: "input" },
    { key: "appearance", title: "外貌", q: "她长什么样？", hint: "发型、发色、眼睛、穿着……越具体越鲜活", type: "input" },
    { key: "personality", title: "性格", q: "她的性格核心是什么？", hint: "可以多选，也可以补充", type: "personality" },
    { key: "background", title: "背景", q: "她的背景故事？", hint: "从哪来、经历了什么、现在在做什么、目标……", type: "area" },
    { key: "speechStyle", title: "说话风格", q: "她怎么说话？", hint: "口癖、语气、语速、爱用的词……", type: "speech" },
    { key: "likes", title: "喜好", q: "她喜欢什么？", hint: "吃的、听的、做的事、在意的东西……", type: "input" },
    { key: "dislikes", title: "讨厌", q: "她讨厌什么？", hint: "什么会让她皱眉、炸毛、躲开", type: "input" },
    { key: "relation", title: "与你的关系", q: "你和她是……？", hint: "这决定她怎么对你说话", type: "relation" },
    { key: "secrets", title: "秘密", q: "她最深的秘密或软肋？", hint: "只有关系足够亲密后才会透露的东西", type: "area" },
];

// 从自由介绍里提取已知信息（规则解析）
export function parseIntro(text: string): Partial<WizardDraft> {
    const r: Partial<WizardDraft> = {};

    const mName = text.match(/(?:叫|名字是|名叫|我是|我叫)([\u4e00-\u9fa5A-Za-z·]{1,8})(?:[，。,!！的、]|$)/);
    if (mName) r.name = mName[1]!;

    const mAge = text.match(/(\d{1,2})\s*岁/);
    if (mAge) r.age = mAge[1] + " 岁";

    const picked = PERSONALITY_CHIPS.filter((c) => text.includes(c));
    if (picked.length) r.personality = picked.join("、");

    const mApp = text.match(/[^。！？\n]*?(?:发|眼睛|瞳孔|穿着|身高|身材|长相|样子|气质)[^。！？\n]*/);
    if (mApp) r.appearance = mApp[0].trim();

    const mLikes = text.match(/[^。！？\n]*(?:喜欢|爱吃|爱听|热衷|最爱)[^。！？\n]*/);
    if (mLikes) r.likes = mLikes[0].trim();

    const mDis = text.match(/[^。！？\n]*(?:讨厌|不喜欢|最怕|受不了|厌恶)[^。！？\n]*/);
    if (mDis) r.dislikes = mDis[0].trim();

    const mSec = text.match(/[^。！？\n]*(?:秘密|其实|不为人知|藏着|软肋)[^。！？\n]*/);
    if (mSec) r.secrets = mSec[0].trim();

    const mRel = text.match(/(?:是我的|我是她(?:的)?|我们是)(好朋友|朋友|恋人|男女朋友|同桌|同学|青梅竹马|同事|家人|邻居|死党)/);
    if (mRel) r.relation = mRel[1]!;

    return r;
}

// 只保留最基本的信息（名字/性格/关系）
function computePending() {
    const essentials: (keyof WizardDraft)[] = ["name", "personality", "relation"];
    pendingFields = FIELD_STEPS.filter(
        (f) => essentials.includes(f.key) && !(wizardDraft[f.key] ?? "").trim(),
    ).map((f) => f.key);
}

// ============ 外部回调 ============

let savedCallback: (() => void) | null = null;

export function setWizardSavedCallback(fn: () => void) {
    savedCallback = fn;
}

// ============ 打开/关闭 ============

export function openWizard() {
    wizardStep = 0;
    wizardDraft = emptyDraft();
    pendingFields = [];
    wizardModal.classList.remove("hidden");
    renderWizard();
}

export function closeWizard() {
    wizardModal.classList.add("hidden");
}

function applyPreset(key: string) {
    const preset = PRESETS[key];
    if (preset) {
        Object.assign(CHARACTER, { ...preset });
        delete (CHARACTER as any).scene; // scene 不进角色卡存档（属场景系统）
        saveCharacter();
        // 预设自带场景（咖啡店/公司/Livehouse/诊所/画室…）；没有则默认校园
        store.scene = preset.scene ? { ...preset.scene } : { ...DEFAULT_SCENE };
        // 按预设关系初始化情感（如恋人→高好感）
        initStateForRelation(CHARACTER.relation ?? "");
        saveState();
        closeWizard();
        savedCallback?.();
    }
}

// 跳过/取消时：随机选一个预设，避免新建对话总是同一个角色
function applyRandomPreset() {
    const keys = Object.keys(PRESETS);
    const key = keys[Math.floor(Math.random() * keys.length)]!;
    applyPreset(key);
}

// ============ AI 访谈状态 ============

let interviewActive = false;
let interviewLoading = false;
let interviewDone = false;
let currentInsight = "";
let currentQuestion = "";
let interviewTurns: InterviewTurn[] = [];
let interviewIntro = "";

// ============ 渲染 ============

function wizardFieldFor(key: keyof WizardDraft) {
    return FIELD_STEPS.find((f) => f.key === key);
}

function renderWizard() {
    const totalFollowup = pendingFields.length;
    const previewStep = totalFollowup + 2;

    let h2Text: string;
    let subText: string;

    if (wizardStep === 0) {
        h2Text = "✨ 创建你的角色";
        subText = "先选一个预设直接开始，或点「自定义创建」——先自由写一段她的介绍，AI 会帮你理解并追问细节。";
    } else if (wizardStep === 1) {
        h2Text = "✍️ 介绍她";
        subText = "用一段话自由介绍你的角色——她是谁、长什么样、什么性格、有什么故事……想到什么写什么。写完后 AI 会像访谈一样追问细节。";
    } else if (interviewActive) {
        h2Text = interviewDone ? "✨ AI 生成的角色卡" : "💬 AI 访谈";
        subText = interviewDone ? "AI 觉得信息足够了，这是它为你整理的角色卡。" : "AI 在读你的介绍并逐步追问细节，直到她足够鲜活。";
    } else if (wizardStep === previewStep) {
        h2Text = "✨ 确认角色";
        subText = "最后确认一下这张角色卡，没问题就完成！";
    } else {
        const field = wizardFieldFor(pendingFields[wizardStep - 2]!)!;
        h2Text = `✨ ${field.title}`;
        subText = `补全设定（第 ${wizardStep - 1} / ${totalFollowup} 项）：`;
    }

    wizardModal.querySelector("h2")!.textContent = h2Text;
    wizardModal.querySelector(".sub")!.textContent = subText;

    if (wizardStep === 0) {
        // 动态渲染所有预设（每个预设自带场景：咖啡店/公司/Livehouse/诊所/画室…）
        const presetBtns = Object.entries(PRESETS)
            .map(([key, p]) => {
                const sceneTag = p.scene ? ` · ${p.scene.name}` : "";
                const desc = (p.background ?? "").slice(0, 22) + (p.background && p.background.length > 22 ? "…" : "");
                return `<button class="wiz-preset" data-preset="${key}">
                  <span class="p-name">${p.name}${sceneTag}</span>
                  <span class="p-desc">${desc}</span>
                </button>`;
            })
            .join("");
        wizardBody.innerHTML = `
            ${presetBtns}
            <button class="wiz-preset" data-custom="1">
              <span class="p-name">🎨 自定义创建</span>
              <span class="p-desc">写一段介绍，让 AI 访谈追问，生成完整角色</span>
            </button>`;
        wizardPrev.style.display = "none";
        wizardNext.style.display = "none";
        return;
    }

    if (wizardStep === 1) {
        wizardBody.innerHTML = `
            <div class="wiz-q">用一段话介绍她（至少写名字和性格，其他随意）：<small>例：她叫小夏，19 岁，粉色短发扎着双马尾，性格活泼又有点爱逞强，喜欢做章鱼烧，讨厌下雨天。</small></div>
            <textarea class="wiz-input" id="wiz-intro" rows="4" placeholder="写在这里…"></textarea>
            <div class="wiz-q" style="margin-top:14px;">你们在哪里生活？她平时在做什么？<small>可选，决定她的日常作息和你们相处的场景。例：海边小镇的咖啡店 / 她在公司上班 / 她的乐队在排练室……留空默认校园。</small></div>
            <input class="wiz-input" id="wiz-scene" placeholder="例：我们住在一个海边小镇，她在一家咖啡店打工（可留空）">`;
        wizardPrev.style.display = "";
        wizardNext.style.display = "";
        wizardNext.textContent = "开始访谈 →";
        return;
    }

    if (interviewActive) {
        renderInterview();
        return;
    }

    if (wizardStep === previewStep) {
        wizardBody.innerHTML = buildPreviewHTML(wizardDraft);
        wizardPrev.style.display = "";
        wizardNext.textContent = "✅ 完成，就是她！";
        return;
    }

    // 补缺追问步骤（无 AI key 的降级）
    const field = wizardFieldFor(pendingFields[wizardStep - 2]!)!;
    let input = "";

    if (field.type === "personality") {
        input = `<div class="wiz-chips">${PERSONALITY_CHIPS.map((c) => `<span class="wiz-chip">${c}</span>`).join("")}</div>
                 <input class="wiz-input" id="wiz-extra" placeholder="补充（可选）" style="margin-top:10px;">`;
    } else if (field.type === "speech") {
        input = `<div class="wiz-chips">${SPEECH_CHIPS.map((c) => `<span class="wiz-chip">${c}</span>`).join("")}</div>
                 <input class="wiz-input" id="wiz-extra" placeholder="补充口癖（可选）" style="margin-top:10px;">`;
    } else if (field.type === "relation") {
        input = `<div class="wiz-chips">${RELATION_CHIPS.map((c) => `<span class="wiz-chip">${c}</span>`).join("")}</div>
                 <input class="wiz-input" id="wiz-extra" placeholder="其他（可选）" style="margin-top:10px;">`;
    } else {
        const isArea = field.type === "area";
        input = isArea
            ? `<textarea class="wiz-input" id="wiz-val" rows="4" placeholder="写在这里…"></textarea>`
            : `<input class="wiz-input" id="wiz-val" placeholder="写在这里…">`;
    }

    wizardBody.innerHTML = `<div class="wiz-q">${field.q}<small>${field.hint}</small></div>${input}`;

    if (field.type === "personality") {
        for (const chip of wizardBody.querySelectorAll<HTMLElement>(".wiz-chip")) {
            chip.addEventListener("click", () => chip.classList.toggle("selected"));
        }
    } else if (field.type === "speech" || field.type === "relation") {
        for (const chip of wizardBody.querySelectorAll<HTMLElement>(".wiz-chip")) {
            chip.addEventListener("click", () => {
                for (const c of wizardBody.querySelectorAll<HTMLElement>(".wiz-chip")) c.classList.remove("selected");
                chip.classList.add("selected");
            });
        }
    }

    wizardPrev.style.display = "";
    wizardNext.style.display = "";
    wizardNext.textContent = "下一步 →";
}

function buildPreviewHTML(d: WizardDraft): string {
    return `
        <div class="wiz-preview">
          <b>名字：</b>${d.name || "（未填）"}（${d.age || "?"}）<br>
          <b>外貌：</b>${d.appearance || "（未填）"}<br>
          <b>性格：</b>${d.personality || "（未填）"}<br>
          <b>背景：</b>${d.background || "（未填）"}<br>
          <b>说话风格：</b>${d.speechStyle || "（未填）"}<br>
          <b>喜好：</b>${d.likes || "（未填）"} ｜ <b>讨厌：</b>${d.dislikes || "（未填）"}<br>
          <b>与你的关系：</b>${d.relation || "（未填）"}<br>
          <b>秘密：</b>${d.secrets || "（未填）"}
        </div>`;
}

// ============ AI 访谈界面 ============

function renderInterview() {
    if (interviewDone) {
        wizardBody.innerHTML = buildPreviewHTML(wizardDraft);
        wizardPrev.style.display = "none";
        wizardNext.style.display = "";
        wizardNext.textContent = "✅ 保存角色";
        return;
    }

    let html = "";

    if (interviewTurns.length) {
        for (const t of interviewTurns) {
            html += `
                <div style="margin-bottom:8px;padding:8px 12px;border-radius:10px;background:var(--accent-soft);">
                  <div style="color:var(--accent);font-size:12px;">🤖 ${t.q}</div>
                  <div style="color:var(--ink-soft);font-size:13px;margin-top:4px;">你：${t.a || "（没想好）"}</div>
                </div>`;
        }
    }

    if (interviewLoading) {
        html += `<div style="color:var(--ink-soft);font-size:13px;text-align:center;padding:16px;">AI 正在思考下一个问题…</div>`;
    } else {
        html += `
            <div style="margin:10px 0;padding:10px 14px;border-radius:12px;background:var(--accent-soft);border:1px solid var(--accent-line);">
              <div style="color:var(--accent-deep);font-size:12px;margin-bottom:4px;">💡 ${currentInsight || "让我想想她是谁…"}</div>
            </div>
            <div style="font-size:15px;color:var(--ink);line-height:1.7;margin-bottom:10px;font-weight:600;">🤖 ${currentQuestion}</div>
            <textarea class="wiz-input" id="wiz-answer" rows="3" placeholder="回答她的问题…（也可以写『你定吧』让她发挥）"></textarea>
            <button id="wiz-submit" style="width:100%;margin-top:10px;padding:11px 0;border-radius:999px;border:none;background:linear-gradient(to right, #d65a7e, #b84567);color:#fff;font-size:14px;cursor:pointer;">回答并继续</button>`;
    }

    wizardBody.innerHTML = html;
    wizardPrev.style.display = "";
    wizardNext.style.display = "none";
}

async function nextInterviewTurn() {
    interviewLoading = true;
    renderInterview();
    console.log("[访谈] 开始下一轮，当前轮数:", interviewTurns.length);

    try {
        const r = await interviewWithAI(interviewIntro, interviewTurns);
        console.log("[访谈] AI 返回:", JSON.stringify(r).slice(0, 200));

        // 达到 5 轮上限：强制结束访谈，用已有信息生成角色卡
        if (interviewTurns.length >= 5) {
            console.log("[访谈] 已达 5 轮上限，强制生成角色卡");
            interviewDone = true;
            wizardDraft = { ...wizardDraft, ...(r.character ?? {}) };
            renderInterview();
            return;
        }

        if (r.done && r.character) {
            interviewDone = true;
            wizardDraft = { ...r.character };
            renderInterview();
            return;
        }

        currentInsight = r.insight ?? "";
        currentQuestion = r.question || "（还有哪里想更丰满一点？）";
        interviewLoading = false;
        renderInterview();
    } catch (e) {
        console.warn("AI 访谈失败，降级为补缺追问：", e);
        interviewActive = false;
        interviewLoading = false;
        computePending();
        renderWizard();
    }
}

function startInterview() {
    const intro = ((document.getElementById("wiz-intro") as HTMLTextAreaElement)?.value ?? "").trim();

    if (!intro) {
        alert("先写一段介绍吧——至少一句话，AI 才能开始了解她。");
        return;
    }

    // 场景：读用户的自由描述 → 存 store.scene（驱动作息/地点/世界观）
    const sceneText = ((document.getElementById("wiz-scene") as HTMLInputElement)?.value ?? "").trim();
    store.scene = parseSceneText(sceneText);

    wizardDraft = emptyDraft();
    wizardDraft.background = intro;
    Object.assign(wizardDraft, parseIntro(intro));

    interviewIntro = intro;
    interviewTurns = [];
    interviewDone = false;
    currentInsight = "";
    currentQuestion = "";
    interviewActive = true;
    wizardStep = 2;
    nextInterviewTurn();
}

// ============ 收集 ============

function collectCurrentStep() {
    const key = pendingFields[wizardStep - 2]!;
    const field = wizardFieldFor(key)!;

    if (field.type === "personality") {
        const chips = [...wizardBody.querySelectorAll<HTMLElement>(".wiz-chip.selected")].map((c) => c.textContent!);
        const extra = (document.getElementById("wiz-extra") as HTMLInputElement)?.value.trim() ?? "";
        wizardDraft.personality = [...chips, extra].filter(Boolean).join("、");
    } else if (field.type === "speech") {
        const chip = wizardBody.querySelector<HTMLElement>(".wiz-chip.selected")?.textContent ?? "";
        const extra = (document.getElementById("wiz-extra") as HTMLInputElement)?.value.trim() ?? "";
        wizardDraft.speechStyle = [chip, extra].filter(Boolean).join("，");
    } else if (field.type === "relation") {
        const chip = wizardBody.querySelector<HTMLElement>(".wiz-chip.selected")?.textContent ?? "";
        const extra = (document.getElementById("wiz-extra") as HTMLInputElement)?.value.trim() ?? "";
        wizardDraft.relation = [chip, extra].filter(Boolean).join("，");
    } else {
        wizardDraft[key] = ((document.getElementById("wiz-val") as HTMLInputElement)?.value ?? "").trim();
    }
}

// ============ 事件绑定 ============

wizardNext.addEventListener("click", () => {
    if (wizardStep === 1) {
        // 检查当前槽位的 API Key（per-slot 存储）
        const slot = parseInt(localStorage.getItem("melai-current-slot") ?? "1", 10) || 1;
        const hasKey = !!localStorage.getItem(`apikey-${slot}`);
        if (hasKey) {
            startInterview();
        } else {
            const intro = ((document.getElementById("wiz-intro") as HTMLTextAreaElement)?.value ?? "").trim();
            const sceneText = ((document.getElementById("wiz-scene") as HTMLInputElement)?.value ?? "").trim();
            store.scene = parseSceneText(sceneText);
            wizardDraft = emptyDraft();
            wizardDraft.background = intro;
            Object.assign(wizardDraft, parseIntro(intro));
            computePending();
            wizardStep = 2;
            renderWizard();
        }
        return;
    }

    if (interviewDone) {
        // 自定义创建：直接用草稿覆盖角色（不继承任何预设默认值）
        finishWizard(wizardDraft);
        return;
    }

    const previewStep = pendingFields.length + 2;

    if (wizardStep >= 2 && wizardStep < previewStep) collectCurrentStep();

    if (wizardStep === previewStep) {
        finishWizard(wizardDraft);
        return;
    }

    wizardStep++;
    renderWizard();
});

// 保存角色：整体覆盖 + 按关系初始化情感数值（恋人不该是"陌生人"初始值）
function finishWizard(draft: CharacterProfile) {
    setCharacter(draft);
    saveCharacter();
    // 关系 → 初始情感（恋人高好感/信任/亲密；朋友中等；刚认识保持默认）
    initStateForRelation(draft.relation ?? "");
    saveState(); // 把关系初始化后的情感数值落盘（否则刷新后回到默认）
    closeWizard();
    savedCallback?.();
}

wizardPrev.addEventListener("click", () => {
    if (wizardStep > 0) wizardStep--;
    renderWizard();
});

wizardBody.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;
    const submitBtn = target.closest("#wiz-submit") as HTMLElement | null;

    if (submitBtn) {
        const ans = ((document.getElementById("wiz-answer") as HTMLTextAreaElement)?.value ?? "").trim();
        const q = currentQuestion;
        interviewTurns.push({ q, a: ans });
        nextInterviewTurn();
        return;
    }

    const presetBtn = target.closest(".wiz-preset") as HTMLElement | null;
    if (!presetBtn) return;

    const preset = presetBtn.dataset.preset;
    const custom = presetBtn.dataset.custom;

    if (preset) {
        applyPreset(preset);
    } else if (custom) {
        wizardStep = 1;
        wizardDraft = emptyDraft();
        renderWizard();
    }
});

document.getElementById("wizard-cancel")!.addEventListener("click", () => {
    // 取消 = 什么都不做：关闭向导，不随机角色、不打招呼；恢复主动开口
    setProactiveEnabled(true);
    closeWizard();
});

document.getElementById("wizard-skip")!.addEventListener("click", () => {
    applyRandomPreset();
});

document.getElementById("char-wizard-reopen")!.addEventListener("click", openWizard);
