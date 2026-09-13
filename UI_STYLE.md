# Melody of Us · 网页风格与开发规范

> 本文档定义 Melody of Us（melody-ai 分支）的网页视觉风格体系与后续开发规范。
> 所有 UI 改动必须遵循本规范；规范本身如有演进，需同步更新本文档。

---

## 一、设计愿景

**「不动的时候干净，动起来有生命感。」**

- 极简、专业、克制的黑白灰界面
- 细节密度高，但视觉噪音低
- 交互有反馈，但不喧宾夺主
- 像经过完整设计的现代软件产品，而不是组件堆叠

---

## 二、设计令牌（Design Tokens）

### 2.1 颜色（唯一真理源：各 HTML 内 `:root`）

```css
:root {
    --ink: #111111;            /* 主文字 / 强调黑 */
    --ink-soft: #555555;       /* 次文字 */
    --ink-faint: #8a8a8a;      /* 弱文字 */
    --bg: #ffffff;             /* 页面底色 */
    --bg-soft: #f6f6f6;        /* 次级底（hover 灰、提示块） */
    --line: #e3e3e3;           /* 分隔线 / 卡片边框 */
    --line-strong: #bdbdbd;    /* 强调线（输入框默认边框） */
    --danger: #a32119;         /* 唯一强调色：危险操作（克制使用） */
    --danger-soft: rgba(163, 33, 25, 0.06);
    --danger-line: rgba(163, 33, 25, 0.4);
    --r: 2px;                  /* 全局微圆角 */
    --font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Consolas, monospace;
}
```

**规则**：

- 黑白灰为主。**唯一允许的彩色是 `--danger`（删除/清空/错误）**，且必须克制使用（细描边 + 淡底，不用大面积色块）。
- 禁止：渐变色、玻璃拟态、发光、霓虹、彩色阴影。
- 层级由边框、灰度、字重建立，**不要依赖阴影做层级**（聊天消息可保留极淡阴影，但以边框为主）。
- 文字对比度：正文 `--ink` 对 `--bg` 满足 WCAG AA。

### 2.2 圆角

- 全局 `--r: 2px`。按钮、卡片、输入框、弹窗统一使用。
- **禁止**：胶囊按钮（border-radius: 999px）、大圆角卡片、圆形图标按钮（头像除外）。

### 2.3 字体

- 界面：`"PingFang SC", "HarmonyOS Sans SC", "MiSans", "微软雅黑", "Noto Sans SC", system-ui, sans-serif`
- 数字/时间戳/数值：`var(--font-mono)` + `font-variant-numeric: tabular-nums`
- 不引入外部字体（无 Google Fonts）；字号层级：11 / 12 / 13 / 14 / 15 / 34，标题不大于 34px。

---

## 三、图标体系

### 3.1 图标库

**Lucide Icons**（ISC 许可证，允许商用与再分发）。

- 图标源文件：`playground/assets/icons.svg`（SVG symbol sprite，40 个图标）
- 每个 HTML `<body>` 开头内联一份 sprite，供 `<use>` 引用

### 3.2 使用方式

```html
<svg class="ico" viewBox="0 0 24 24"><use href="#i-menu"/></svg>
<svg class="ico-sm" viewBox="0 0 24 24"><use href="#i-volume-x"/></svg>
```

尺寸档位：

| 类名 | 尺寸 | 用途 |
|---|---|---|
| `.ico` | 16px | 按钮、面板标题、分组标题 |
| `.ico-sm` | 14px | 行内小图标、辅助图标 |

### 3.3 规则

1. **UI 图标一律使用 sprite**，禁止 Emoji / Unicode 符号 / 自绘 path 充当 UI 图标。
2. 新增图标：从 Lucide 官方下载 SVG（24×24、stroke=2 基础），加入 sprite（统一 `stroke-width="1.6"` 覆盖），命名 `i-<kebab-name>`。
3. 需要图标时优先复用：`panel-left / volume-2 / volume-x / users / user-round / history / sparkles / rotate-ccw / menu / send / x / arrow-left / arrow-right / plus / trash-2 / check / search / play / settings / sliders-horizontal / brain / book-open / calendar / activity / heart / smile / moon / chevron-down / map-pin / sun / lightbulb / github / database / save / loader-circle / bot / key-round / message-circle / palette / clock`
4. **允许保留 emoji 的两处例外**（均为内容而非控件）：
   - 角色头像（`chatAvatar()` 返回的角色形象 emoji）
   - 38 维维度标签（`state.ts` DIMENSIONS 的 label，会被 `ai.ts` 的 prompt 引用，属数据词典）
5. 图标与文字间距统一：按钮内 gap 5–7px。

---

## 四、组件规范

### 4.1 按钮

| 类 | 用途 | 视觉 |
|---|---|---|
| `.btn-primary` | 主操作 | 黑底白字，hover `#333`，active `#000` + translateY(1px) |
| `.btn-ghost` | 次操作 | 白底黑边，hover `--bg-soft`，active `#ededed` + translateY(1px) |
| `.btn-danger` | 危险操作 | `--danger-soft` 底 + `--danger-line` 边 + `--danger` 字，hover 加深 |

- 尺寸：高 30px（紧凑）/ 42px（首页 CTA），padding 0 14–24px，无胶囊。
- 按钮内图标统一 gap 5px 居中。
- 每个按钮必须有：Default / Hover / Active（translateY(1px)）/ Focus（`:focus-visible` 1px 黑描边 offset 2px）/ Disabled（opacity 0.45，not-allowed）。

### 4.2 输入与下拉

- 默认边框 `--line-strong`；hover 微灰底 `#fcfcfc`；focus 边框 `--ink`；radius `--r`。
- 高度统一 34px（表单）/ 26px（时间胶囊内小控件）。
- select option 颜色用 `--ink`（防白字）。

### 4.3 卡片 / 面板

- 只对真正需要分组的内容使用卡片（`.panel`：1px `--line` 边框 + `--r`）。
- **禁止**「一屏全是卡片」的堆叠；优先用分隔线、灰度、排版建立层级。
- 存档卡 `.save-card`：左侧 3px 状态条（灰色→active 黑），hover 灰底，active 加深。

### 4.4 消息

- 用户消息：黑底白字（`--ink`），右对齐。
- AI 消息：白底 1px `--line` 边框 + 方形小头像（34px，`--bg-soft` 底），左对齐。
- NPC 消息：`--bg-soft` 底 + 左侧 2px 黑条 + 名字标签。
- 系统提示 `.sys` / 剧情旁白 `.story-line`：居中、弱缩（`--ink-faint` / `--ink-soft`），无边框。
- 新消息淡入动画 `msg-in` 0.22s（reduced-motion 关闭）。
- 消息时间戳：`--font-mono`，10px，`--ink-faint`。

### 4.5 弹窗 / 模态

- 遮罩：`rgba(17,17,17,0.5)`；弹窗体：白底 1px `--line-strong` 边框，radius `--r`，max-width 480px。
- 标题 15px 粗体；正文 12px `--ink-soft`。
- 按钮行统一 `.row button` 三态（hover 边框黑 / active 下压 / focus-visible 描边）。

### 4.6 状态反馈

- 成功：`--ink` 文字 + `check` 图标（不用绿色）。
- 错误：`--danger` 文字。
- 加载中：文字「测试中…」或在实现时用 `loader-circle` + CSS 旋转（`prefers-reduced-motion` 下停止旋转）。
- 空状态：`--ink-faint` 居中一行说明，不配插图。

---

## 五、布局规范

### 5.1 页面结构

- **home**：顶部 52px 导航条（品牌 + GitHub 链接）→ 居中 hero（eyebrow + 大标题 + 副文案 + 特性列表 + CTA）→ 48px 页脚。
- **menu**：56px 页头（返回 + 标题）→ 桌面双栏 grid（左 存档列表 1fr，右 设置 420px）→ 页脚。
- **chat**：App 式布局：52px 应用栏（面板开关 + 角色信息 + 图标工具栏）→ 主体（左 320px 状态面板 + 右消息区）→ 底部输入条（非悬浮，1px 上边框 + `safe-area` 适配）。

### 5.2 间距

- 基础间距体系：4 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 20 / 24 / 32。
- 面板内 padding 18–20px；区块间用 1px 分隔线 + 12px padding，不叠卡片。
- 控件间距统一 8–10px。

### 5.3 响应式

- **home**：<640px 单列、按钮全宽、页脚纵排。
- **menu**：<900px 双栏折叠为单栏；<520px 按钮行纵排、卡片操作列排。
- **chat**：<768px 顶部工具条 wrap；状态面板变左侧抽屉（translateX 滑入 + 遮罩 `#panel-mask`，仅小屏显示）；消息区全宽；输入框 font-size 16px 防 iOS 缩放。
- 桌面面板开合：`#state-panel` display:none 切换，不使用 margin 推挤。

---

## 六、背景与动效规范

### 6.1 背景层（低对比，服务内容）

- `#bg-parallax > .bg-grid`：40px 微网格（`rgba(17,17,17,0.03)`），90s 漂移动画（CSS transform），随鼠标惯性偏移 ±10px；menu 页叠加滚动视差（scrollY × 0.05）。
- `.bg-noise`：SVG feTurbulence 灰阶噪点，opacity 0.05。
- `#bg-fluid`（canvas 速度场）：水域搅动效果，见 §6.2。

### 6.2 流体扰动（canvas 速度场）

实现位置：home.html / menu.html 内联脚本（两页同一实现）。

- 低频速度场网格 ≈ 1/8 视口尺寸；每帧扩散（0.06）+ 衰减（0.965）。
- 鼠标沿路径分段注入平滑方向速度；快速 → 拉长水流，慢速 → 小涟漪；停止后扰动继续扩散消散（余韵 1.2s）。
- 渲染：低频 ImageData（灰度 + 透明度，无粒子/光点）放大绘制 + blur(2px)，z-index 1，opacity 0.55。
- **性能约束**：rAF 仅在注入时唤醒，平静自动停帧清屏；`blur` 时清场；触屏强度 ×0.55。
- **禁止**：粒子尾巴、同心圆水波、霓虹光带、固定宽线、光标锁定式拖尾。

### 6.3 动画原则

| 场景 | 时长 | easing |
|---|---|---|
| 按钮 hover/active | 0.1–0.2s | ease |
| 背景网格漂移 | 90s | linear |
| 面板抽屉 | 0.25s | ease |
| 消息淡入 | 0.22s | ease-out |
| 折叠箭头 | 0.2s | ease |

- 动画目的必须明确（传达状态变化）；禁止旋转/闪烁/漂浮等无意义动画。
- **必须支持** `prefers-reduced-motion: reduce`：禁用网格漂移、流体、淡入、视差；保留 hover/focus 状态；chat 页 `scroll-behavior: auto`。

---

## 七、无障碍

- 可交互元素必须有 `:focus-visible` 1px 黑描边（offset 2px）。
- 触控目标 ≥28px（header 图标按钮 30px，移动端 28px）。
- 语义化 HTML（header/main/footer/section/button）；canvas 装饰层 `aria-hidden="true"` + `pointer-events: none`。
- 颜色对比度满足 AA；状态不只靠颜色表达（成功/失败配文字）。

---

## 八、质量检查清单（提交前）

1. 三页（home/menu/chat）桌面 + 390px 移动端截图核对。
2. 图标完整：`grep -o 'use href="#i-[a-z0-9-]*"' <page>.html | sed 's/.*#//;s/"//'` 与 sprite symbol 一一对应。
3. 无 console 错误（`--enable-logging=stderr` 扫描）。
4. 无横向溢出（`html,body { overflow-x: hidden }` 不解决布局问题，需真正修复溢出源）。
5. hover/active/focus/disabled 四态齐全。
6. `prefers-reduced-motion` 下背景静止、交互可用。
7. 构建通过：`npx vite build`。

---

## 九、后续开发规范

### 9.1 Git 流程

- 分支：开发功能用 `feat/<名称>` 从 melody-ai 拉出；UI 打磨类任务直接在 melody-ai 小步提交。
- 提交信息：`<type>(<scope>): <描述>`，type ∈ `feat / fix / style / refactor / chore / docs`。
- 一次提交只做一件事；提交前 `git status` 检查无遗留产物（截图、临时文件）。
- 远程 `origin/melody-ai` 为发布分支；推送前 `git fetch && git log origin/melody-ai..HEAD` 确认只含目标提交。

### 9.2 代码结构

- 逻辑层（*.ts 数据/世界系统）与界面层（chat/menu HTML+TS）分离；UI 只做渲染与转发。
- 新功能模块放 `playground/` 下独立文件；跨模块通信用回调注入（如 `setCharacterGetter`），禁止循环依赖。
- 内联样式只用于动态值；静态样式统一进 `<style>` 并遵循本文档令牌。
- 禁止复制粘贴重复 CSS；同风格组件用共享类名（.btn / .ico / .panel）。

### 9.3 验收标准

- 功能改动：必须能通过 UI 完整走通（CDP 或手工）。
- UI 改动：符合本文档 §二~§七；截图在提交信息中留痕（或放临时目录后删除）。
- 性能：交互类 JS 使用 rAF 节流；鼠标跟随类效果在空闲时停止；不逐帧创建 DOM。

---

*最后更新：2025-08-27 · melody-ai*
