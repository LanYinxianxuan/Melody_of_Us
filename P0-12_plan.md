# P0-12 + P0-2 + P0-13 实施方案与数据契约设计

> 状态：**已全部实施完成**（P0-12 / P0-2 / P0-13；`npm run verify` 全绿）
>
> 交付记录：
> | 项 | 结果 |
> |---|---|
> | 新增生产模块 | `save-schema.ts`（契约/迁移，纯函数）、`save-io.ts`（导出导入）、`voice-store.ts`（IndexedDB 音色） |
> | 新增测试 | 3 个 Node 单测文件 + 7 个浏览器 e2e 套件 + 页面冒烟测试 |
> | 断言总数 | 88 + 44 + 50 + 46 + 422 + 9 = **659** |
> | 环境限制 | 本沙箱 Chromium 的 IndexedDB 后端不工作（详见 §D.10），fail-safe 逻辑改用可注入后端确定性验证 |（G1–G8 已由用户确认；G3 依据调用点审计改为 async；P0-2 的失败判定改为 operation-scoped）
> 本文件为实施依据；实施按 H 的 8 步推进，每步跑 `npm run verify`。
> 审计方式：逐行读 `storage/character/tts/menu/ai` + 全仓 88 处 localStorage 调用枚举 + **在真实浏览器中以探针转储真实存档**（非从类型推断）
> 基线：`melody-ai` 工作区（阶段 1 已完成 P0-1/3/4/5/6/7/8/10/11）

---

## A. 当前数据结构审计

### A.1 存档键（`melai-state-{slot}`）

**实测**：一个真实存档有 **30 个顶层键** = `store` 的 28 个字段 + `aiState` + `savedAt`。

```
aiState(38 维) | savedAt
turnCount | storyProgress | storyEvents[] | chatHistory[] | journal[] | activeThread
scheduleIndex | timeRate | virtualMs | dayBaseMs | dayIndex
memories[] | lastReplyRealAt | lastReplyVirtualAt
lastNeglectAt | lastNeglectRealAt | lastNeglectLevel
npcs{} | presentNpcs[] | npcEnabled | scene{} | agenda[] | userLocation | pendingOvernight[]
userMind(14) | aiMind(10) | relMind(4) | lastAgentVirtualAt
```

**实测体积**：空档 3.3 KB；含 2 个 NPC（含各 11 段作息）8.8 KB；满量档（200 历史 / 100 事件 / 14 天日程）**73 KB**（UTF-16）。全部按字节计费。

### A.2 嵌套结构（实测键名）

| 结构 | 键数 | 键 |
|---|---|---|
| `aiState` | 38 | 人格 5 / 关系 6 / 情绪 12 / 状态 5 / 阴影 10 |
| `scene` | 6 | `name place routine others busyLabel restLabel` |
| `userMind` | 14 | 0~1 连续值 |
| `aiMind` | 10 | 含 `topicFatigue comfortCount lastTopic` |
| `relMind` | 4 | `tension lastMajorLabel lastMajorTurn lastMajorVirtualAt` |
| `npcs[id]` | 12 | `profile emotion relToMain relToUser knownFacts history location activity label present lastActiveAt goal` |
| `npcs[id].profile` | 15 | `id name title avatar personality background speechStyle likes dislikes relationToUser relationToMain schedule[] keywords[] meetLocation goal` |
| `npcs[id].profile.schedule[]` | 4 × 11 | `time label activity location` |
| `npcs[id].emotion` | 8 | `joy sadness anger shyness jealousy loneliness anxiety fatigue` |
| `agenda[]` | 2 | `{day, items[]}`；item = `{time,title,desc?,status,source}` |
| `chatHistory[]` | 3 | `{role,content,ts?}` |
| `storyEvents[]` | 2 | `{day,text}` |
| `journal[]` | 2 | `{day,summary}` |

**角色卡**（独立键 `melai-character-{slot}`）：`CharacterProfile` 10 个字符串字段。

### A.3 旧格式兼容现状（`loadState` 逐字段策略）

| 策略 | 字段数 | 字段 |
|---|---|---|
| `typeof number` + 默认值 | 12 | `scheduleIndex timeRate virtualMs dayBaseMs dayIndex lastReplyRealAt lastReplyVirtualAt lastNeglectAt lastNeglectRealAt lastNeglectLevel lastAgentVirtualAt` |
| `Array.isArray` + 默认 `[]` | 8 | `storyEvents chatHistory journal memories presentNpcs pendingOvernight agenda` |
| 与默认对象浅合并 | 1 | `scene` |
| 字面量默认 + 展开合并 | 3 | `userMind aiMind relMind` |
| 按 `NPCS` 定义重建 + 合并 | 1 | `npcs` |
| 白名单校验 | 1 | `userLocation` |
| 类型判断 | 1 | `activeThread`（string 否则 null） |
| **无任何校验** | **2** | `turnCount`（`?? 0`）、`storyProgress`（`?? 0`） |
| 只增不删 | 1 | `aiState`（`Object.assign(aiState, INITIAL_STATE, data.aiState)`） |

**已发现的旧格式迁移（散落在代码里的 4 处一次性迁移）**：
1. 旧单档 `melai-state` → `melai-state-1`（`storage.ts:49-57`）
2. `storyEvents` 从 `string[]` → `{day,text}[]`（`storage.ts:286-288`）
3. `scene` 缺失 → `DEFAULT_SCENE`
4. `npcs` 缺失 → 按当前场景重建

### A.4 现存缺陷（本次审计确认）

| # | 问题 | 位置 | 后果 |
|---|---|---|---|
| D1 | **`aiState` 值不做类型校验** | `storage.ts:282` | 脏档里一个字符串会经 `clamp(NaN)` → **NaN 永久污染该维度**（已实测 `clamp(NaN)===NaN`） |
| D2 | **`aiState` 只增不删** | 同上 | 旧版本删掉的维度永久残留在存档里继续落盘（`resetState` 会 delete，`loadState` 不会） |
| D3 | `turnCount` / `storyProgress` 无类型校验 | `storage.ts:284-285` | 字符串会直接进入数值语义 |
| D4 | **存档损坏 = 静默开新档** | `storage.ts:358` + `chat.ts` 把 `loadState()===false` 当新游戏 | 旧数据仍占配额但永不读取，用户以为进度丢了 |
| D5 | **无 version 字段** | 全档 | 无法区分"旧档"与"损坏档" |
| D6 | `loadSlotRaw` 只判 `data.aiState` 存在 | `storage.ts:386` | 菜单页可能展示结构错误的存档摘要 |
| D7 | 保存失败已可观测（P0-3 已修） | — | ✅ 保持 |

### A.5 全部 localStorage 键（88 处调用枚举）

| 键 | 作用域 | 写入方 | 读取方 |
|---|---|---|---|
| `melai-current-slot` | global | storage.ts / menu.ts | storage/ai/tts/menu/wizard/director |
| `melai-state-{slot}` | per-slot | storage.ts | storage / menu |
| `melai-character-{slot}` | per-slot | character.ts / chat.ts | character / storage / menu / chat |
| `melai-did-new-{slot}` | per-slot | （已删除，仅清理遗留） | — |
| `apikey-{slot}` | per-slot | menu.ts | ai/chat/director/tts/event-card/wizard |
| `provider-{slot}` | per-slot | menu.ts | ai/director/tts |
| `model-{slot}` | per-slot | menu.ts | ai/director |
| `custom-url-{slot}` | per-slot | menu.ts | ai/director/tts |
| `models-cache-{slot}` | per-slot | menu.ts | menu |
| `melai-effort` | **global** | menu.ts | ai/chat |
| `melai-tts-enabled` | **global** | tts.ts | tts |
| `melai-tts-voice-{slot}` | per-slot | tts.ts(menu 调) | tts |
| `melai-tts-apikey-{slot}` | per-slot | tts.ts(menu 调) | tts |
| `melai-tts-style-{slot}` | per-slot | tts.ts(menu 调) | tts |
| `melai-tts-lang-{slot}` | per-slot | tts.ts(menu 调) | tts |
| `panel.section.{name}` | **global** | chat.ts | chat |
| `melai-agent-console` | **global** | mind-debug.ts | mind-debug |
| `melai-state` / `melai-character` | 遗留（只读迁移） | — | storage.ts |
| `deepseek-key` | ☠️ 孤儿键（P0-8 已移除，仅存注释） | — | — |

---

## B. SaveV1 契约草案

### B.1 设计原则（按你的要求排序）

1. **兼容优先于美观**：SaveV1 的字段**尽量沿用现有键名与嵌套形状**，不重命名、不扁平化、不重构语义。
2. **version 是唯一新增的顶层字段**，其余字段保持字节级兼容。
3. **零信任读取**：所有字段经统一校验后再进入 `store`。
4. **失败不阻塞启动**：任何校验/迁移失败都不得让应用起不来。

### B.2 version 放哪里

**放在顶层，与 `savedAt` 并列，字段名 `v`。**

```jsonc
{
  "v": 1,                    // ← 新增：SaveV1
  "savedAt": 1789234178272,  // 已有
  "aiState": { ... },        // 已有，38 维
  ...store 的 28 个字段       // 已有，形状不变
}
```

**为什么用顶层 `v` 而不是嵌在 `meta` 下**：
- 现有代码是 `{ aiState, ...store, savedAt }`，加一个顶层标量改动最小；
- 无需引入 `meta` 包装层（那会改变所有字段的访问路径，属于"为了 schema 改数据结构"，被你的要求排除）；
- 短名 `v` 而非 `version` 的理由：**旧档没有这个字段**，所以"存在 `v`"本身就是版本信号。用 `version` 同样可行，但我倾向显式可读 → **建议用 `version`**（见决策点 G1）。

**旧档判定（无 version 字段）**：

| 情形 | 判定 | 处理 |
|---|---|---|
| `raw === null` | 无存档 | 返回"新游戏"（现状） |
| JSON 解析失败 | **损坏档** | 保留原数据 + 报告用户，**不静默开新档**（修 D4） |
| `version` 缺失但 `aiState` 存在 | **SaveV0（旧档）** | 走 V0→V1 迁移（等价于现有 `loadState` 的逐字段兜底） |
| `version === 1` | SaveV1 | 走 V1 校验 |
| `version > 1` | **未来档** | **拒绝加载并明确告知**（不能猜） |
| `version` 非整数 / 负数 | 非法 | 同"损坏档" |

### B.3 SaveV1 完整结构

```ts
/** 存档格式版本。缺失 = V0（P0-12 之前的旧档）。 */
export const SAVE_VERSION = 1;

/** 统一存档信封。字段名与 V0 保持一致，不重命名。 */
export interface SaveV1 {
    version: 1;
    savedAt: number;
    aiState: Record<string, number>;   // 38 维（键集合由 DIMENSIONS 决定）
    // ↓ store 的 28 个字段，形状与现状完全一致
    turnCount: number;
    storyEvents: StoryEvent[];
    storyProgress: number;
    chatHistory: HistoryEntry[];
    journal: DayJournal[];
    activeThread: string | null;
    scheduleIndex: number;
    timeRate: number;
    virtualMs: number;
    dayBaseMs: number;
    dayIndex: number;
    memories: string[];
    lastReplyRealAt: number;
    lastReplyVirtualAt: number;
    lastNeglectAt: number;
    lastNeglectRealAt: number;
    lastNeglectLevel: number;
    npcs: Record<string, NpcState>;
    presentNpcs: string[];
    npcEnabled: boolean;
    scene: SceneConfig;
    agenda: AgendaDay[];
    userLocation: string;
    pendingOvernight: string[];
    userMind: UserMindState;
    aiMind: AiMindState;
    relMind: RelMindState;
    lastAgentVirtualAt: number;
}
```

### B.4 必需 / 可选字段分级

这里的关键判断：**"必需"不等于"缺失即拒绝"**。为了兼容性，我把字段分三级：

| 级别 | 字段 | 缺失/非法时的处理 |
|---|---|---|
| **L1 必需（缺失即判定为非本应用存档）** | `aiState`（且为对象） | 拒绝加载 → 报"损坏档"，**不覆盖原数据** |
| **L2 有默认值（缺失即补默认，等同现状）** | 其余 27 个 store 字段 | 补默认值，与现有 `loadState` 逐字段兜底行为**完全一致** |
| **L3 新增（V1 才有）** | `version` | 缺失 → 视为 V0，走迁移 |

**`aiState` 内部**：38 个维度键 **不要求全部存在**（旧档可能缺新维度），缺失的从 `INITIAL_STATE` 补；但**存在值必须是有限数**（`Number.isFinite`），否则丢弃该键并从 `INITIAL_STATE` 补 —— **修 D1（NaN 污染）**。

**`aiState` 内多余键**：**删除**（对齐 `resetState` 行为），**修 D2**。

> ⚠️ 这是本次唯一涉及"改变现有数据行为"的地方：现状是"多余键保留并继续落盘"，改为"丢弃"。**我认为这是修复而非破坏**，但按你的要求在此显式报告 → 见决策点 G2。

### B.5 校验失败如何处理（三级处置，取代"静默开新档"）

| 失败类型 | 处置 | 用户可见 |
|---|---|---|
| 键不存在 | 新游戏 | 无（现状） |
| JSON 解析失败 | **保留原始字符串不覆盖**；进入"损坏档"状态；提示"存档无法读取，可导出原始数据" | Toast/系统消息 |
| `aiState` 缺失/非对象 | 同上（视为非本应用数据） | 同上 |
| 单字段类型错误 | **丢弃该字段用默认值**，其余字段照常加载；记录到 `loadReport` | 静默 + 调试可见 |
| `version` 高于当前 | **不加载、不迁移、不覆盖**；提示"存档来自更新版本" | Toast |
| `version` 非法 | 同"损坏档" | 同上 |

**关键**：损坏档时**绝不写回**（不在 `saveState` 里覆盖）。现状是 `loadState()===false` → 当新游戏 → 后续任何 `saveState` 都会**覆盖掉那份损坏数据**。这是 D4 的真实危害。

### B.6 导出 / 导入 API

```ts
// ===== 导出 =====
export interface SaveBundle {
    /** 固定标识，用于导入时识别文件类型 */
    format: "melody-of-us.save";
    version: number;              // 与存档内的 version 一致
    exportedAt: number;
    slot: number;                 // 导出时的槽位（仅供参考，导入时可重定向）
    character: CharacterProfile;  // 完整世界状态的一部分
    state: SaveV1;                // 完整存档
    /** 便于人工识别与排错，不参与校验 */
    summary: { characterName: string; dayIndex: number; affection: number; npcCount: number };
}

export function exportSlot(slot?: number): SaveBundle;

// ===== 导入（四阶段，逐步短路）=====
export type ImportResult =
    | { ok: true; applied: { slot: number; character: string; dayIndex: number } }
    | { ok: false; stage: "parse" | "validate" | "migrate" | "commit"; reason: string };

/**
 * 1. parse   —— 解析（同时识别 JSON 与纯存档两种输入形状）
 * 2. validate—— 校验（版本、必需字段、字段类型）
 * 3. migrate —— 迁移到当前版本（V0→V1）
 * 4. commit  —— 一次性提交（先备份现有数据到内存，写入失败则回滚）
 *
 * 任何一步失败：**当前存档保持原样**（不改内存 store，不写 localStorage）
 */
export function importSave(text: string, targetSlot: number): ImportResult;
```

**"一次性提交"的具体实现（原子性策略）**：

```
① 解析 + 校验 + 迁移 全部在**纯内存**完成 → 得到 candidate: { state: SaveV1, character }
② 备份当前槽位：backup = { stateRaw, charRaw }（读原始字符串，不解析）
③ 写入 candidate（先写 character，再写 state）
④ 若任一写入失败（配额/异常）→ 用 backup 原样写回 → 返回 { ok:false, stage:"commit" }
⑤ 成功后才更新内存中的 store / aiState / CHARACTER
```

**为什么第 ③ 步失败要回滚**：localStorage 的两次 `setItem` 不是事务。若第一次成功第二次失败，会留下"新角色 + 旧状态"的混合档。用原始字符串备份回滚是最简单可靠的方案（不需要临时槽位）。

**导入文件必须带版本信息** → `SaveBundle.version` + `SaveV1.version` 双重存在，导入时**两者都校验且必须一致**，否则 `stage:"validate"` 失败。

### B.7 与现有玩法的兼容性承诺

| 项目 | 是否改变 |
|---|---|
| 字段名 / 嵌套形状 | ❌ 不变 |
| 数值语义（38 维 0-100、mind 0-1、时间戳语义） | ❌ 不变 |
| `loadState` 的逐字段默认值 | ❌ 不变（V0 迁移复用同一套兜底） |
| `saveState` 写入内容 | ⚠️ **仅新增 `version` 字段** |
| `aiState` 多余键 | ⚠️ **改为丢弃**（修 D2，见 G2） |
| `aiState` 非有限数值 | ⚠️ **改为回落默认**（修 D1） |
| 损坏档行为 | ⚠️ **改为不覆盖**（修 D4） |

---

## C. Migration 方案

### C.1 组织方式

```
src 内的位置：storage.ts（不新建模块，避免提前拆分状态层）
├── const SAVE_VERSION = 1
├── type AnySave = Record<string, unknown>
├── migrate(raw: AnySave): { state: SaveV1; from: number; notes: string[] }
│    ├── migrateV0toV1(raw) → 复用现有逐字段兜底逻辑（原 loadState 主体）
│    └── （未来）migrateV1toV2(raw)
└── validate(state): { ok: true; state } | { ok: false; reason }
```

**迁移链形式**：`while (version < SAVE_VERSION) { raw = MIGRATIONS[version](raw); version++ }`

```ts
const MIGRATIONS: Record<number, (raw: AnySave) => AnySave> = {
    0: migrateV0toV1,   // 无 version → V1
    // 1: migrateV1toV2, // 未来
};
```

**V0 迁移做什么**：**就是把现在 `loadState` 里的逐字段兜底逻辑原样搬过来**。这意味着 V0→V1 不是"新写的迁移"，而是"把已存在的隐式迁移显式化"—— **零行为变更风险**。

### C.2 为什么这样组织

- **不引入迁移框架**：一张函数表 + 一个 while 循环足够，符合"不过度工程化"。
- **迁移函数是纯函数**：`AnySave → AnySave`，不碰 localStorage，便于单测。
- **每级迁移独立可测**：可用构造的旧档直接喂给 `migrate()`，无需浏览器。

### C.3 关键约束

| 约束 | 落实方式 |
|---|---|
| 迁移必须幂等 | V0→V1 的兜底本身就是幂等的（缺失才补） |
| 迁移不得丢数据 | 未知字段**默认保留**（除 `aiState` 的多余维度外，见 G2） |
| 迁移失败必须可回退 | `migrate` 抛错 → 捕获 → 视为"损坏档"，**不写回** |
| 未知版本不得猜测 | `version > SAVE_VERSION` → 直接拒绝 |

---

## D. IndexedDB 迁移方案（P0-2）

### D.1 目标与边界

**目标**：解除 TTS 音频与 localStorage 5MB 配额的竞争（实测：1MB 音频占 53% 配额，2MB 即超额，而代码允许 10MB）。

**明确不做**（按你的要求"不顺手重构整个音频系统"）：
- ❌ 不改 TTS 合成/播放逻辑
- ❌ 不改音色克隆请求格式
- ❌ 不改 `speak()` / `synthesizeSpeech()` 的签名与行为
- ✅ **只改音色的存储介质**（`getVoiceBase64` / `setVoiceBase64` / `clearVoice` 三个函数的内部实现）

### D.2 Database / Store / Key 设计

```
IndexedDB:  dbName = "melody-of-us"      version = 1
├── objectStore "tts-voice"   keyPath = "slot"        // 音色（大对象，唯一需要迁出 localStorage 的）
└── （未来）objectStore "tts-cache"                    // 合成音频缓存，本批不做
```

**key 结构**：直接以 `slot: number` 作为主键（不用复合键）。理由：音色是 per-slot 的，一个槽位一份，天然一对一。

**记录形状**：

```ts
interface VoiceRecord {
    slot: number;            // 主键
    /** base64 data URL（与现有 localStorage 内容完全一致，避免改动消费方） */
    data: string;
    /** 便于诊断与将来清理，不参与业务逻辑 */
    meta: {
        mime: string;        // 从 data URL 前缀解析，如 "audio/mpeg"
        bytes: number;       // base64 字符数
        /** 估算的解码后大小，用于展示与限额 */
        approxAudioBytes: number;
        savedAt: number;
        /** 来源标记，便于确认迁移是否完成 */
        source: "user-upload" | "migrated-from-localstorage";
    };
}
```

**为什么 `data` 保持 base64 而不是 Blob**：
- 消费方（`synthesizeSpeech`）现在是直接把 base64 塞进请求体；改 Blob 会牵动请求构造 → 违反"不重构音频系统"。
- IndexedDB 存 base64 字符串同样能解除 5MB 配额竞争（配额通常是磁盘配额量级）。
- 后续阶段若要把 base64 换成 Blob，只需改这一个字段 + 一处消费点。

### D.3 旧 localStorage 数据迁移（fail-safe）

**核心不变量：新位置确认写入成功后才能删除旧数据。**

```ts
async function migrateVoiceFromLocalStorage(): Promise<MigrateVoiceResult> {
    const slot = currentSlot();
    const legacyKey = `melai-tts-voice-${slot}`;
    const legacy = localStorage.getItem(legacyKey);
    if (!legacy) return { status: "nothing-to-migrate" };

    // ① IndexedDB 不可用 → 保留 localStorage 原样（回退路径）
    if (!(await idbAvailable())) return { status: "idb-unavailable" };

    // ② 已经迁过（幂等）：若 IDB 已有该 slot 记录且旧数据仍在，直接清旧数据
    const existing = await readVoice(slot);
    if (existing?.meta.source === "migrated-from-localstorage" && existing.data === legacy) {
        localStorage.removeItem(legacyKey);
        return { status: "already-migrated" };
    }

    // ③ 写入 IndexedDB
    try {
        await writeVoice({ slot, data: legacy, meta: { ..., source: "migrated-from-localstorage" } });
    } catch (e) {
        // ④ 写入失败 → **什么都不删**，旧数据继续可用
        return { status: "write-failed", error: e };
    }

    // ⑤ 读回校验（确认真的落盘了，而不只是事务 resolve）
    const verify = await readVoice(slot);
    if (!verify || verify.data !== legacy) {
        // 校验失败 → 同样不删；旧数据仍是唯一可靠副本
        return { status: "verify-failed" };
    }

    // ⑥ 确认成功后才删除旧数据
    localStorage.removeItem(legacyKey);
    return { status: "migrated" };
}
```

**触发时机**：`menu.ts` 的 `loadTtsSettings()`（音色管理界面）与 `chat.ts` 的 `initTts()` 各调一次；幂等，重复调用无副作用。

**为什么选这两个时机**：都是"要用音色"的地方，若迁移失败则读取路径会自然回退到 localStorage。

### D.4 旧 localStorage 数据何时删除

**只在第 ⑥ 步"写入 + 读回校验"双重成功之后。** 任何失败路径都不删。

### D.5 IndexedDB 不可用时的 fallback

**三级降级，行为对用户透明**：

| 层级 | 条件 | 行为 |
|---|---|---|
| L1 | IDB 可用 | 音色存 IDB |
| L2 | IDB 不可用（隐私模式 / 浏览器禁用 / 无 `indexedDB`） | **完全退回现状**：音色继续存 localStorage，并保留现有 10MB 上限守卫 |
| L3 | IDB 打开失败（版本冲突 / 磁盘错误） | 同 L2 |

**关键**：L2/L3 下**不返回错误、不阻止上传**（否则等于把一个存储优化变成功能退化）。

读取路径统一为：`getVoice()` → 先查 IDB，未命中则查 localStorage（兼容迁移未完成的场景）。

### D.6 迁移失败如何保证存档不受影响

**结构性保证**：音色存储与存档存储是**两个独立的 key space**（localStorage 的 `melai-tts-voice-*` vs `melai-state-*`；IDB 与 localStorage 完全隔离）。

因此：
- 迁移写 IDB 失败 → 不触碰 localStorage 的存档键；
- 迁移删旧音色失败（`removeItem` 抛错）→ 音色冗余但可用，存档无影响；
- 唯一的风险点是**如果迁移成功会释放配额**，那只会让存档写入更容易成功，不会更难。

**不做的事**：迁移**不会**去"清理"其它 localStorage 键来腾空间。

### D.7 清理 / 删除旧音频策略

| 场景 | 行为 |
|---|---|
| 用户点"清除音色" | 同时删 IDB 记录与 localStorage 遗留键（幂等） |
| 用户删除存档槽位（`clearSlot`） | 需**扩展** `clearSlot` 同步清理 `melai-tts-*-{slot}`（现状只清 state/character/did-new） |
| 导出存档 | **不包含**音色（音色是设备相关的克隆数据，体积大且含隐私） |
| 孤立记录（槽位已删但 IDB 仍有） | 菜单页加载时按当前 5 个槽位做一次惰性清理 |

### D.8 是否需要大小限制

**需要，但改为分层限制**：

| 介质 | 建议上限 | 理由 |
|---|---|---|
| IndexedDB | **25 MB / 个音色**（原来 10 MB 可放宽） | IDB 配额通常是磁盘量级；25MB 足够容纳高保真样本 |
| localStorage（fallback） | **保持 10 MB 不变** | 不改现状；但**新增实际可存性检查**：写入前估算 base64 占用，若超过当前可用配额则提前拒绝并给出明确提示（而不是抛 `QuotaExceededError` 后让用户困惑） |

### D.9 音色写入与存档安全的联动（**operation-scoped 判定**）

**目标**：确保"写入大音色"不会把 localStorage 配额吃满、进而让存档静默失效。

**原设计有一个真实缺陷**（用户指出，已修正）：
"写入前后各检查一次 `getLastSaveFailure() !== null`"是**全局陈旧状态**判定 ——
若 10:00 曾因其它原因存档失败，10:05 音色写入成功，检查仍会看到那个旧 failure，
从而**错误回滚一次成功的写入**：

```
10:00  saveState() 失败 → lastSaveFailure 被置位
10:05  用户清理了空间，TTS 音色写入成功
10:05  检查 getLastSaveFailure() !== null → true
       ⇒ 误判为"TTS 导致存档失败"，回滚 TTS  ← BUG
```

**修正方案：为失败记录加入单调递增的 generation，用"本次操作期间是否产生新的失败"来判定。**

需要在 P0-3 的失败通道上做一处**最小扩展**（不改判定语义，只加序号）：

```ts
// storage.ts —— P0-3 通道的最小扩展
let saveFailureGeneration = 0;   // 单调递增；每次失败 +1

export function getSaveFailureGeneration(): number {
    return saveFailureGeneration;
}

// reportFailure() 内部：lastSaveFailure = failure 的同时 saveFailureGeneration++
```

**音色写入的安全判定（operation-scoped）**：

```ts
async function writeVoiceSafely(record: VoiceRecord): Promise<{ ok: boolean; reason?: string }> {
    // ① 记录本次操作开始前的失败序号（不是"有没有失败"，而是"失败到第几次了"）
    const genBefore = getSaveFailureGeneration();

    // ② 写入音色
    await writeVoice(record);

    // ③ 主动触发一次存档写入，用**它的返回值**判断"现在还能不能存"
    //    这一步同时覆盖两种情况：
    //      · 音色写入把配额吃满 → 本次 saveState 返回 false
    //      · 配额本来就满（与音色无关）→ 也返回 false，此时不应归咎于音色
    const saveOk = saveState();

    // ④ 判定：只有"存档失败 且 本次操作期间产生了新的失败记录"才回滚
    const producedNewFailure = getSaveFailureGeneration() > genBefore;

    if (!saveOk && producedNewFailure) {
        // 确实是本次操作把存储推到了失败状态 → 回滚音色，恢复可用空间
        await deleteVoice(record.slot);
        saveState(); // 尽力把状态再存一次
        return { ok: false, reason: "writing-voice-exhausted-quota" };
    }

    if (!saveOk && !producedNewFailure) {
        // 存档本来就存不进去（陈旧问题），与本次音色写入无关 → **不回滚**
        return { ok: true, reason: "save-was-already-failing-before-this-operation" };
    }

    return { ok: true };
}
```

**为什么这样能消除误回滚**：
- 判据从「是否存在 failure」变成「**本次操作是否新产生了 failure**」（generation 差值）；
- 并且额外要求 `saveState()` 这个**明确返回值**为 false —— 两者同时成立才回滚；
- 10:00 的旧 failure 会让 `genBefore` 已经包含它，`genAfter - genBefore === 0` → **不会误回滚**。

**同时保留可观测性**：误判场景下仍返回 `reason`，便于调试与测试断言（测试正是要验证这种情况下**不发生回滚**）。

> 备注：这是 P0-3 通道的**向后兼容扩展**（新增一个 getter + 一个计数器），不改变 `saveState()` 的返回值语义、不改动既有失败上报行为，也不属于阶段 3 的状态容器重构。

---

## E. Scope 矩阵（P0-13）

### E.1 现状矩阵（审计结论）

| 设置 | 现状作用域 | 证据 |
|---|---|---|
| 当前存档（`melai-state-{slot}`） | per-slot | `SAVE_KEY` |
| 角色卡（`melai-character-{slot}`） | per-slot | `CHAR_KEY` |
| API Key（`apikey-{slot}`） | per-slot | menu 写 / ai+chat+director+tts+wizard+event-card 读 |
| Model（`model-{slot}`） | per-slot | menu 写 / ai + director 读 |
| Provider（`provider-{slot}`） | per-slot | menu 写 / ai + director + tts 读 |
| Custom URL（`custom-url-{slot}`） | per-slot | menu 写 / ai + director + tts 读 |
| Models 缓存（`models-cache-{slot}`） | per-slot | menu 读写 |
| **Effort（`melai-effort`）** | **global** | menu 写 / ai + chat 读（注释明示"effort 全局共享"） |
| TTS 音色（`melai-tts-voice-{slot}`） | per-slot | tts 读写 |
| TTS 专用 Key（`melai-tts-apikey-{slot}`） | per-slot | tts 读写 |
| TTS 风格（`melai-tts-style-{slot}`） | per-slot | tts 读写 |
| TTS 语言（`melai-tts-lang-{slot}`） | per-slot | tts 读写 |
| **TTS 总开关（`melai-tts-enabled`）** | **global** | tts 读写（chat 的开关按钮） |
| UI 偏好（`panel.section.{name}`） | **global** | chat 读写 |
| Agent 调试开关（`melai-agent-console`） | **global** | mind-debug 读写 |
| `melai-current-slot` | global | 多处读写 |

### E.2 不一致报告（按你的要求：只报告，不自行决定）

| # | 不一致 | 现状 | 为什么可疑 |
|---|---|---|---|
| **S1** | **TTS 语言/风格是 per-slot，但 TTS 总开关是 global** | 槽 1 开 TTS → 切到槽 2 仍开着，但用槽 2 的音色/语言 | 同一功能内混用两种作用域，用户无法预期 |
| **S2** | **TTS 音色 per-slot，但 `melai-tts-enabled` global** | 见上 | 同上 |
| **S3** | **UI 折叠偏好是 global** | `panel.section.*` 不带 slot | 折叠状态是**界面习惯**而非存档内容，global 可能是有意为之（我认为合理，但需你确认） |
| **S4** | **`currentSlot` 有三套解析** | `storage.ts` 冻结常量 / `ai.ts`+`tts.ts`+`wizard.ts` 每次重读 / `menu.ts` 冻结副本 `activeSlot` | 同一次运行内可能得出**不同槽位** |
| **S5** | `effort` global 而 provider/model per-slot | 见矩阵 | 已有注释说明是有意设计；但"思考等级"和"模型"耦合度高，分开作用域后切槽会得到"槽 2 的模型 + 全局的思考等级" |

### E.3 S4 的具体危害（实测分析）

三套解析的实际差异：

| 解析方 | 时机 | 值 |
|---|---|---|
| `storage.currentSlot` | 模块加载时（URL `?slot=` 优先，回落 localStorage） | **冻结** |
| `ai.getProviderConfig()` / `tts.currentSlot()` / `wizard` | 每次调用 | **实时**（永远读 localStorage，**不看 URL**） |
| `menu.activeSlot` | 模块加载时 | 冻结副本（菜单页会改它） |

**具体失效场景**：`storage.currentSlot` 优先取 URL 参数，而 `getProviderConfig()` 只读 localStorage。正常情况下 menu 在跳转前会写 `melai-current-slot`，两者一致。**但以下情况会分叉**：
- 用户直接打开 `chat.html?slot=3`（书签/外部链接）而不经过菜单 → `storage` 认为槽 3，而 localStorage 可能仍是槽 1 → **读槽 1 的 API Key / Model，写槽 3 的存档**。
- 两个标签页：标签 A 在槽 1、标签 B 打开槽 2 后，A 的**下一次 AI 请求**（`getProviderConfig` 实时重读）会用**槽 2 的 Key 与 Model**，而 A 的存档仍写槽 1。

**这不是理论问题** —— 是当前代码的确定行为。

### E.4 建议的目标矩阵（待你确认）

| 设置 | 目标 Scope | 变更 |
|---|---|---|
| 当前存档 / 角色 / API Key / Model / Provider / Custom URL / Models 缓存 | per-slot | 不变 |
| TTS 音色 / 专用 Key / 风格 / 语言 | per-slot | 不变 |
| **TTS 总开关** | **per-slot** | ⚠️ 变更（修 S1/S2） |
| Effort | global | 不变（已有明示设计） |
| UI 偏好（面板折叠） | global | 不变（界面习惯，建议保持） |
| Agent 调试开关 | global | 不变 |
| `melai-current-slot` | global 但**单一真理源** | ⚠️ 收敛三套解析为一处 |

### E.5 收敛方案（S4）

**不动存储结构，只收敛读取路径**：

```ts
// storage.ts —— 成为唯一的槽位解析入口
export const currentSlot: number;              // 冻结值（URL 优先）—— 保持不变
export function getActiveSlot(): number;       // 新增：唯一实时入口
```

- `ai.ts` / `tts.ts` / `director.ts` / `wizard.ts` 的"实时重读"统一改调 `getActiveSlot()`；
- **但**：`getActiveSlot()` 的实现**优先返回 URL 参数**（若存在），否则读 localStorage —— 这样"直接打开 `chat.html?slot=3`"不再分叉。
- 若你希望**彻底消除多标签交叉**，还需要 `storage` 事件监听（见 G5）。

---

## F. 风险清单

| # | 风险 | 严重度 | 缓解 |
|---|---|---|---|
| R1 | **导入时两次 `setItem` 非事务** → 可能留下"新角色 + 旧状态"混合档 | 高 | 原始字符串备份 + 失败回滚（B.6 第 ④ 步） |
| R2 | **损坏档不再被覆盖** → 用户可能困惑"为什么改不动" | 中 | 明确提示 + 提供"导出原始数据"与"确认重置"两个显式出口 |
| R3 | **`aiState` 丢弃多余键** 会让"回退到旧版本"时丢维度 | 中 | 见 G2；建议：导出功能保留原始档，便于回退 |
| R4 | **IDB 在隐私模式/部分 WebView 不可用** | 中 | 三级降级（D.5）保持现状可用 |
| R5 | **IDB 迁移删旧数据时机**若判断错 → 音色永久丢失 | 高 | 写入 + **读回校验**双重确认后才删（D.3 第 ⑤ 步） |
| R6 | **`clearSlot` 扩展清理 TTS 键**可能误删正在使用的音色 | 低 | 只在"删除存档"这个显式破坏性操作里联动 |
| R7 | **收敛槽位解析**会改变"直接打开 `?slot=N`"的行为（从分叉变为一致） | 中 | 这是修复而非破坏，但属于可观测行为变更 → 见 G5 |
| R8 | **TTS 总开关改 per-slot** 会让老用户"切槽后 TTS 关了" | 低 | 迁移：若 global 键为 true 且 per-slot 键不存在 → 为所有槽位补 true |
| R9 | **SaveV1 新增 `version` 字段**会让旧版本代码读取时把它当多余键（无害） | 低 | 旧版本 `loadState` 忽略未知键 |
| R10 | 引入 IDB 异步路径 → `getVoiceBase64()` 变 async，牵动调用方 | **低**（审计后下调） | G3 已确认改 async；实测仅 2 处需改造，其余 3 处本就在 async 上下文 |
| R13 | **音色写入把配额推到临界，导致存档随之失效** | 高 | §D.9 operation-scoped 判定：写后主动 `saveState()` + 比对 failure generation，确认是本次操作所致才回滚 |
| R14 | **用陈旧全局 failure 判定 → 误回滚一次成功的写入** | 中 | 原设计缺陷（用户指出），已由 §D.9 的 generation 机制消除 |
| R11 | 测试覆盖面：真实 IDB 行为无法用 localStorage 桩模拟 | 中 | e2e 里用真实浏览器跑真实 IDB（我们已有真实浏览器测试基建） |
| R12 | 导出文件含 API Key？ | 中 | **明确不导出 Key**（见 G4） |

---

## G. 决策结果（已确认）

| # | 决策 | 结果 |
|---|---|---|
| G1 | version 字段名 | ✅ **`version`** |
| G2 | `aiState` 多余维度 | ✅ **丢弃**（接受这是唯一改变数据行为的点，用于修 D2） |
| G3 | `getVoiceBase64()` 形态 | ✅ **改为 `Promise<string \| null>`**，由调用方 `await`（依据见 §G3 审计） |
| G4 | 导出敏感数据 | ✅ **不导出** API Key / TTS Key / 音色 base64 |
| G5 | 多标签交叉 | ✅ **只收敛 `getActiveSlot()`**，不做跨标签同步 |
| G6 | TTS 总开关作用域 | ✅ **改为 per-slot** + 老用户一次性迁移 |
| G7 | UI 折叠偏好作用域 | ✅ **保持 global** |
| G8 | 音色大小上限 | ✅ **IDB 25MB / localStorage fallback 保持 10MB** |

### G3 审计：async 是否造成范围扩大

`getVoiceBase64()` 全仓 **5 个调用点**：

| # | 位置 | 所在函数 | 已 async? | 改造成本 |
|---|---|---|---|---|
| 1 | `tts.ts:252` | `synthesizeSpeech` | ✅ | `+await`（1 词） |
| 2 | `tts.ts:301` | `synthesizeSpeechStream` | ✅ | `+await`（1 词） |
| 3 | `tts.ts:503` | `ttsStatusText` | ❌ | **零成本：该函数全仓零调用（死导出）** |
| 4 | `menu.ts:406` | `loadTtsSettings` | ❌ | 自身改 `async`；调用处不读返回值（启动时 fire） |
| 5 | `menu.ts:471` | 试听 click handler | ✅ | `+await`（1 词） |

`setVoiceBase64` / `clearVoice`：`menu.ts:440` 上传 handler 已 async（`+await`）；`menu.ts:451` 清除 handler 改 `async`（1 行）。

**结论**：真正需要"改造"的只有 **2 处**（各自改成 async），其余本来就在 async 上下文里。**async 方案的范围明显小于「同步 API + 内存预热 + 首次加载竞态处理」** —— 后者要额外引入缓存一致性、预热时机、冷启动竞态三块复杂度，却只为了不动这两个函数签名。

因此按用户指示直接采用 async，不再走同步预热方案。

## H. 实施顺序（确认后执行）

| 步 | 内容 | 可独立验证 |
|---|---|---|
| 1 | SaveV1 契约 + 校验 + 迁移链（**纯函数，先不接入 loadState**）+ 单测 | ✅ 用构造档直接测迁移/校验 |
| 2 | `loadState` 接入新链路（行为对齐现状）+ 旧档/损坏档/未知版本回归测试 | ✅ 缺陷版反例 |
| 3 | 导出 API + 单测 | ✅ |
| 4 | 导入 API（四阶段 + 回滚）+ 失败路径测试 | ✅ 用真实浏览器测配额回滚 |
| 5 | `getActiveSlot()` 收敛（S4）+ TTS 总开关改 per-slot 与一次性迁移（G6 已确认） | ✅ |
| 6 | IndexedDB 音色存储（`getVoiceBase64` 改 async）+ fail-safe 迁移 + §D.9 判定 + 降级路径 | ✅ 真实 IDB e2e |
| 7 | 菜单页 UI 接入（导出/导入按钮、音色状态提示） | ✅ 手工 + e2e |
| 8 | 完整 `npm run verify` | ✅ |

**每一步都跑 `npm run verify`；每步都能独立回退。**

### H.1 存档专项测试计划（针对五类档）

| 档类型 | 构造方式 | 断言 |
|---|---|---|
| **旧档 V0（必须真实测试）** | 真实旧格式 JSON（含 `storyEvents: string[]` 的早期形状） | 迁移后字段齐全、数值语义不变、可直接继续游玩 |
| 损坏档 | 截断 JSON / 非 JSON / `aiState` 为字符串 | **不覆盖原数据** + 返回可诊断结果（修 D4） |
| 未知高版本档 | `version: 99` | **拒绝加载 + 拒绝写回** + 明确原因 |
| 部分缺字段档 | 只留 `aiState` | 27 个字段全部补默认，行为与现状逐字段兜底一致 |
| 脏字段档 | `aiState:{affection:"abc"}`、`turnCount:"x"` | D1/D3 被修复（回落默认，而非 NaN 污染） |
| `aiState` 多余维度 | 额外 `{"obsolete": 50}` | 被丢弃（G2），且不写回存档 |

### H.2 P0-2 专项测试计划（含误回滚场景）

| 用例 | 构造 | 断言 |
|---|---|---|
| fail-safe 迁移成功 | localStorage 有音色 → 调迁移 | IDB 有记录**且**旧键被删 |
| IDB 写入失败 | stub `writeVoice` 抛错 | **localStorage 旧数据仍在**（不删） |
| 读回校验不一致 | stub `readVoice` 返回不同数据 | **不删旧数据** |
| IDB 不可用降级 | 令 `indexedDB` 不可用 | 音色仍存 localStorage，上传不被阻止 |
| **陈旧 failure 不误回滚** | 先制造一次存档失败 → 再写音色 | **不回滚**，返回 `save-was-already-failing-…` |
| **本次操作致失败要回滚** | 令音色写入触发新 failure 且 `saveState()` 返回 false | 回滚音色，返回 `writing-voice-exhausted-quota` |
| 迁移幂等 | 同一音色连续迁移两次 | 第二次直接清旧键，不重复写 |
| 大小上限 | 超 25MB（IDB）/ 10MB（fallback） | 提前拒绝并给出明确提示，不抛原始 `QuotaExceededError` |

---

## J. 环境限制与验证策略（实施中发现）

### J.1 本沙箱的 Chromium 无法运行 IndexedDB

**实测结论**：`indexedDB` 对象存在（`typeof === "object"`），`indexedDB.open()` 也正常返回
`IDBRequest`，但 `onupgradeneeded` / `onsuccess` / `onerror` / `onblocked` **在任何情况下都不触发**。

已排除的可能性：
| 尝试 | 结果 |
|---|---|
| `--headless=new` 默认 | 回调不触发 |
| `+ --disable-software-rasterizer --use-gl=swiftshader` | 回调不触发 |
| `--headless`（旧模式） | 回调不触发 |
| 显式 `--user-data-dir` | 回调不触发 |
| `--virtual-time-budget=30000` | 回调不触发 |
| 用**同步 XHR 阻塞 load 事件 4 秒**再读 | 回调仍不触发 |

即：不是"时间不够"或"dump 时机太早"，而是 IDB 后端在该环境下不可用。

### J.2 因此采取的验证策略（不降低标准）

| 层次 | 覆盖内容 | 方式 |
|---|---|---|
| **Node 单测**（`voice-store.test.mjs`，44 断言） | fail-safe **决策逻辑**：写入失败 / 读回校验不一致 / 后端不可用 → 旧数据必须保留；operation-scoped 判定的两个方向 | 注入 fake 后端，**确定性**覆盖每条失败路径 |
| **浏览器 e2e**（`voice-idb.e2e.ts`，40 断言） | **回退路径**：IDB 不可用时读写/删除/迁移全部走 localStorage 且功能正常 | 真实浏览器 |
| **结构护栏**（`dist-check.mjs`） | 超时保护存在、三个 IDB 操作都被 `withTimeout` 包裹、迁移必须读回校验后才删、判定必须用 generation 差值 | 静态断言 |

**未在本环境验证的部分**（如实记录）：真实 IDB 的端到端读写（`idbPut`/`idbGet`/`idbDelete` 的实际事务行为）。
该部分由注入后端的单测覆盖了**决策逻辑**，但真实介质行为需在具备 IDB 的环境（普通浏览器 / 真实 CI）复跑一次 `npm run test:e2e`。

### J.3 实施中发现并修复的额外缺陷

| # | 缺陷 | 说明 |
|---|---|---|
| E1 | **IDB 探测永不 settle** | `isIndexedDbAvailable()` 缓存了永不 resolve 的 Promise → 每个音色操作永久挂起。已加探测超时（1.5s）。 |
| E2 | **IDB 操作永不 settle** | 探测之外，`openDb`/事务同样可能不回调 → 读写永久挂起（用户侧"点了没反应"）。已给所有操作加超时（3s）。 |
| E3 | **菜单页 TTS 写错槽位**（子代理审计发现） | 冻结槽位被用在"一页多槽"的菜单页 → 面板写「存档 5」，TTS 设置却写进 `*-1`。已改为显式 `slot` 形参。 |
| E4 | **菜单页 TDZ 白屏** | 初始化调用早于 `tts*` 模块级 `const` 声明 → `ReferenceError`，页面白屏。**422 条 e2e 断言全部漏过**，由新增的页面冒烟测试发现。 |
| E5 | **裸 `localStorage.clear()`** | 「清空所有数据」会抹掉同源下其它页面的数据。已改为白名单前缀清理。 |
| E6 | **`?eventdemo=1` 污染真实槽位** | 无 slot 隔离时演示角色被永久写入用户真实存档。已强制要求显式独立槽位。 |
| E7 | **旧档迁移先删后验** | 旧单档迁到槽位 1 时无条件删源键；若源档损坏则唯一副本丢失。已改为先探测可读性再删。 |

## I. 本批明确不做的事

- ❌ 不重建 `store`（阶段 3 的状态容器重构）
- ❌ 不把存档迁到 IndexedDB（只把**音色**迁出去，存档继续用 localStorage）
- ❌ 不重构 TTS 合成/播放链路
- ❌ 不改提示词、玩法、数值语义
- ❌ 不引入 schema 校验库（手写校验足够，避免新增依赖）
- ❌ 不做跨标签写入锁（G5 选 A 时）

---

**G1–G8 已确认；本文件为实施依据。按 §H 的 8 步推进，每步跑 `npm run verify`。**
