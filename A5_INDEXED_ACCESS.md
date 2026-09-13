# A5_INDEXED_ACCESS.md —— `noUncheckedIndexedAccess` 的评估与启用路径

> 对应 `GAMEPLAY_REVIEW.md` 的 **A-5**。**本阶段不启用。**
> 本文保留评估结论，供以后单独执行时按步骤落地。

---

## 1. 结论

**现在不能开，也不应该为了消错而大规模改 `AIState`。**

| 项 | 结论 |
|---|---|
| 能否直接开启 | ❌ 否，实测 **+108 个类型错误** |
| 错误主要来源 | `AIState` 的宽索引签名（约 100 条 / 108 条） |
| 剩余 ~8 条的来源 | `store.agenda`、NPC 数组、若干 `.find()` 结果的索引访问 |
| 现在开启的后果 | 得到 108 条**无信息量**的告警，并**诱发**"为了消错而加运行时兜底"——那会改变行为 |

---

## 2. 为什么 `AIState` 会产生 100 条错误

`state.ts` 导出的是 `export let aiState: AIState`。当前 `AIState` 用的是**宽索引签名**，
因此 `aiState[dim.key]` 的结果类型含 `undefined`。而 38 个维度是一个**闭集**：

```ts
// 现状（问题所在）
export type AIState = { [k: string]: number } & { /* …若干具名维度… */ };
```

一旦开启 `noUncheckedIndexedAccess`，**每一处维度读取**都会变成
`number | undefined`，于是：

- `v.toFixed(0)` → 报错
- `aiState.affection + delta` → 报错
- `clamp(aiState[k]! + …)` → 本来就有 `!`，但 `!` 的语义会被迫在更多地方出现

这些都不是真 bug，而是**类型表达不够精确**造成的噪声。

---

## 3. 启用路径（三步，缺一不可）

### 步骤 1：先把 `AIState` 的键类型收紧为精确的维度联合

```ts
// 目标形态（示意）
export const DIMENSIONS = [ … ] as const;
export type DimensionKey = (typeof DIMENSIONS)[number]["key"];
export type AIState = Record<DimensionKey, number>;
```

- `DIMENSIONS` 已经在 `state.ts` 里存在且是唯一的维度真理源，收紧类型**不需要改任何运行时数据**。
- 这一改动会**立刻**暴露两类真实问题（这是它的价值）：
  ① 拼错的维度 key；② 代码里访问了不存在的维度。
- ⚠️ 注意：`aiStateSnap: Record<string, number | undefined>`（`chat.ts` 的检查点）
  与 `store` 上的 `userMind` / `aiMind` / `relMind` 都是**另一套**类型
  （`UserMindState` / `AiMindState` / `RelMindState`），它们已经是具名形状，不受影响。

### 步骤 2：与 A-3 一起补齐 `store` 的字段声明

✅ **已完成**（阶段 3）：全仓零 `(store as any)`，`store` 的字段声明已覆盖
`userMind` / `aiMind` / `relMind` / `lastAgentVirtualAt`。
`tests/boundaries.test.mjs` 有断言防止回退。

### 步骤 3：再开启 `noUncheckedIndexedAccess`

此时剩余报错应当是个位数，且**每一条都值得逐个判断**（是真实越界还是需要显式兜底）。

---

## 4. 启用时必须遵守的纪律

| 纪律 | 原因 |
|---|---|
| 只加类型，不加运行时兜底 | `?? 0` / `if (!x) return` 这类"为了消错"的改动会**改变行为**（例如把一次越界崩溃变成静默用 0 继续跑） |
| 每改一处跑一次 `npm run verify` | 38 维维度是全项目最核心的数据结构，`tests/render-boundary.e2e.ts` 与 `mind-persistence` 都能捕捉漂移 |
| 不顺手改 `applyDelta` / 衰减公式 | 属于玩法冻结（见 `GAMEPLAY_CONTRACT.md`） |
| 不顺手把 `aiStateSnap` 改成精确类型 | 它存的是"快照"，允许缺键是刻意的（`Object.assign(aiState, cp.aiStateSnap)` 只覆盖快照里有的键） |

---

## 5. 与本阶段的关系

- **阶段 3 不做**（用户明确要求）。
- 步骤 2 已在本阶段顺带完成（A-3），所以将来只需要做步骤 1 与步骤 3。
- 建议作为**独立小阶段**执行，不要与任何渲染/边界搬迁混在一起 ——
  它的报错面覆盖全项目，混在别的改动里会让"哪个改动引入了新问题"变得无法判断。
