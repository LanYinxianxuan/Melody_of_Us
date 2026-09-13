// character-prompt.e2e.ts —— P0-1 回归测试：自定义角色必须真的进入 AI system prompt
//
// 被修复的缺陷（character.ts setCharacter）：
//   setCharacter(c) 原本执行 `CHARACTER = { ...c }`（重新绑定），而 chat.ts 在模块加载时
//   就持有 `let CHARACTER_REF = CHARACTER` 这个快照，并通过 setCharacterGetter 注册给 ai.ts。
//   于是走「自定义创建」路径后，所有快照仍指向旧的空模板对象 →
//   AI system prompt 里角色信息全是空、顶栏名字是占位符，**刷新页面后才正常**。
//   预设路径（wizard.ts:182 Object.assign(CHARACTER, profile)）是就地改写，所以此前不暴露。
//
// 本测试复现真实顺序，且刻意不刷新页面：
//   ① 载入模块（模拟 chat.ts 持有快照 + 注册 getter）
//   ② 走 wizard 的自定义保存路径 setCharacter(draft)
//   ③ 断言：CHARACTER 与快照仍是同一对象 / 快照能看到新角色 / SYSTEM_PROMPT 含角色信息 /
//            system prompt 不再含空模板痕迹 / 非规范字段被清除 / 落盘内容正确

import { CHARACTER, setCharacter, saveCharacter, loadCharacter, type CharacterProfile } from "../playground/character";
import { setCharacterGetter, SYSTEM_PROMPT } from "../playground/ai";
import { CHAR_KEY } from "../playground/storage";
import { e2eCheck, e2eLog, e2eRun } from "./e2e-assert";

/** 模拟 chat.ts:114 的模块级快照 —— 关键：必须在 setCharacter 之前取得 */
const CHAT_REF: CharacterProfile = CHARACTER;
setCharacterGetter(() => CHAT_REF);

const DRAFT: CharacterProfile = {
    name: "林晚秋",
    age: "24 岁",
    appearance: "及肩黑发，常穿米色针织衫，右手腕有一道浅疤",
    personality: "安静、观察力强，不擅长表达关心但会默默记住细节",
    background: "旧城区独立书店的店员，白天看店，晚上写小说，从未发表过",
    speechStyle: "语速慢，常用「嗯」「大概吧」，很少用感叹号",
    likes: "旧书、雨天、手冲咖啡",
    dislikes: "被催促、吵闹的客人",
    relation: "常客",
    secrets: "她写的小说主角一直是你",
};

await e2eRun(() => {
    // ---------- ① 建立基线：确认初始是空模板 ----------
    const beforePrompt = SYSTEM_PROMPT(CHAT_REF);
    e2eLog(`基线：CHARACTER.name="${CHARACTER.name}" / 快照.name="${CHAT_REF.name}"`);
    e2eCheck("初始为空模板（无名字）", CHARACTER.name === "" && CHAT_REF.name === "", `"${CHAT_REF.name}"`);

    // ---------- ② 走自定义创建路径（带一个非规范字段，模拟预设残留 scene） ----------
    const draftWithExtra = { ...DRAFT, scene: { name: "书店" } } as CharacterProfile;
    setCharacter(draftWithExtra);

    // ---------- ③ 对象身份：这是 P0-1 的核心 ----------
    e2eCheck(
        "setCharacter 后仍保持对象身份（char 快照 === CHARACTER）",
        CHAT_REF === CHARACTER,
        `char=${JSON.stringify(CHARACTER.name)} ref=${JSON.stringify(CHAT_REF.name)}`,
    );
    e2eCheck(
        "chat 侧快照能看到自定义角色的名字（无需刷新）",
        CHAT_REF.name === DRAFT.name,
        `ref.name="${CHAT_REF.name}"`,
    );
    e2eCheck("快照能看到性格", CHAT_REF.personality === DRAFT.personality);
    e2eCheck("快照能看到关系（决定情感初始化）", CHAT_REF.relation === DRAFT.relation);
    e2eCheck("快照能看到隐藏设定", CHAT_REF.secrets === DRAFT.secrets);

    // 所有 10 个规范字段逐一核对，避免只覆盖部分字段
    const fields: (keyof CharacterProfile)[] = [
        "name", "age", "appearance", "personality", "background",
        "speechStyle", "likes", "dislikes", "relation", "secrets",
    ];
    const mismatch = fields.filter((f) => CHAT_REF[f] !== DRAFT[f]);
    e2eCheck("10 个规范字段全部就位", mismatch.length === 0, mismatch.join(","));

    // ---------- ④ 非规范字段必须被清除 ----------
    e2eCheck(
        "非规范字段 scene 未被带入角色卡",
        !("scene" in (CHARACTER as unknown as Record<string, unknown>)),
        Object.keys(CHARACTER).join(","),
    );
    e2eCheck(
        "角色卡只含 10 个规范字段",
        Object.keys(CHARACTER).length === 10,
        Object.keys(CHARACTER).join(","),
    );

    // ---------- ⑤ AI system prompt 必须真的看到角色（本次修复的最终目的） ----------
    const prompt = SYSTEM_PROMPT(CHAT_REF);
    e2eLog(`system prompt 长度：修复后 ${prompt.length} 字符（修复前基线 ${beforePrompt.length}）`);

    e2eCheck("system prompt 含自定义角色名字", prompt.includes(DRAFT.name));
    e2eCheck("system prompt 含外貌", prompt.includes(DRAFT.appearance));
    e2eCheck("system prompt 含性格", prompt.includes(DRAFT.personality));
    e2eCheck("system prompt 含背景故事", prompt.includes("旧城区独立书店"));
    e2eCheck("system prompt 含说话风格", prompt.includes(DRAFT.speechStyle));
    e2eCheck("system prompt 含喜好", prompt.includes(DRAFT.likes));
    e2eCheck("system prompt 含与用户的关系", prompt.includes(DRAFT.relation));
    e2eCheck("system prompt 含隐藏设定", prompt.includes(DRAFT.secrets));
    e2eCheck("system prompt 不残留空模板（无「名字：\\n」连续空行）", !/名字：\s*\n/.test(prompt));
    e2eCheck(
        "system prompt 因角色信息而变长（说明真的注入进去了）",
        prompt.length > beforePrompt.length + 100,
        `${beforePrompt.length} → ${prompt.length}`,
    );

    // ---------- ⑥ 落盘 + 重新读取一致（角色卡可被 loadCharacter 还原） ----------
    saveCharacter();
    const raw = localStorage.getItem(CHAR_KEY);
    e2eCheck("角色卡已写入 localStorage", !!raw);
    const reloaded = loadCharacter();
    e2eCheck("loadCharacter 能还原自定义角色", reloaded.name === DRAFT.name && reloaded.secrets === DRAFT.secrets);
    e2eCheck(
        "落盘内容不含 scene（与 loadCharacter 的约定一致）",
        !!raw && !raw.includes('"scene"'),
        raw?.slice(0, 120) ?? "",
    );

    // ---------- ⑦ 二次替换必须完全覆盖，不留上一次的残留 ----------
    // 显式提供一个不含 secrets 的完整对象（模拟只填了部分字段的自定义角色）
    setCharacter({
        name: "沈亦",
        age: "",
        appearance: "",
        personality: "话痨",
        background: "",
        speechStyle: "",
        likes: "街头小吃",
        dislikes: "",
        relation: "",
        secrets: "",
    });
    e2eCheck("二次 setCharacter 完全覆盖名字/性格", CHARACTER.name === "沈亦" && CHARACTER.personality === "话痨");
    e2eCheck("二次 setCharacter 不会残留上一次的 secrets", CHARACTER.secrets === "", `"${CHARACTER.secrets}"`);
    e2eCheck("二次 setCharacter 不会残留上一次的 appearance", CHARACTER.appearance === "");
    e2eCheck("二次 setCharacter 后快照同步", CHAT_REF.name === "沈亦");
    e2eCheck("二次 setCharacter 后规范字段数仍为 10", Object.keys(CHARACTER).length === 10);
    e2eCheck(
        "二次 system prompt 反映新角色、不含旧角色",
        SYSTEM_PROMPT(CHAT_REF).includes("沈亦") && !SYSTEM_PROMPT(CHAT_REF).includes("林晚秋"),
    );

    // ---------- ⑧ 对象身份：预设路径（Object.assign）与自定义路径语义一致 ----------
    const identityBefore = CHARACTER;
    setCharacter({ ...DRAFT });
    e2eCheck("两条创建路径语义一致：对象身份都不变", CHARACTER === identityBefore);
});
