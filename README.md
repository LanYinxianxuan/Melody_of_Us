# Melody of Us —— 与你共鸣的日子

一个纯前端的 AI 数字人应用：**38 维情感状态机 · 剧情系统 · 时间系统 · 多存档 · 多供应商 · 角色创建向导**。

![License](https://img.shields.io/badge/license-MIT-blue)
![Version](https://img.shields.io/badge/version-1.0.0-pink)

## ✨ 特性

- 🎭 **38 维情感体系**：人格(5) / 关系(6) / 情绪(12) / 状态(5) / 阴影(10)，每轮动态变化
- 📖 **剧情系统**：剧情阶段、剧情线、随机事件、多人对话
- ⏰ **时间系统**：真实时钟同步、可调速率、手动跳转、场景描述
- 🎨 **角色创建**：预设角色 + 自定义创建（AI 访谈追问生成）
- 💾 **多存档**：5 个独立槽位，每个存档独立的 API 设置
- 🤖 **多供应商**：DeepSeek / OpenAI / Claude / Gemini / Moonshot / 通义千问 / 智谱 / 小米 MiMo
- 📱 **PWA 支持**：添加到主屏幕，离线可用
- 🎯 **强制 JSON 输出**：使用 `response_format` 确保 AI 稳定输出 JSON

## 🚀 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

打开 http://localhost:5173/playground/home.html

> 首次进入会弹出**角色创建向导**：选预设角色或自定义创建。

## 🔧 构建与部署

```bash
# 构建生产版本
npm run build

# 预览构建结果
npm run preview
```

把 `dist/` 目录部署到任意静态托管：
- **GitHub Pages**：推送到 `gh-pages` 分支
- **Netlify / Vercel**：连接仓库自动部署
- **云服务器**：Nginx 指向 `dist/` 目录

部署后手机浏览器打开 → **添加到主屏幕** = 全屏 App。

## 📄 页面说明

| 页面 | 说明 |
|------|------|
| `home.html` | 首页，项目介绍 |
| `menu.html` | 菜单：存档管理 + API 设置 + 模型测试 |
| `chat.html` | 主玩法：情感聊天 |

## 🎮 核心系统

### 38 维情感体系

| 层级 | 维度 | 说明 |
|------|------|------|
| 🎭 人格 | 开放、尽责、外向、宜人、敏感 | 性格底色，几乎不变 |
| ❤️ 关系 | 好感、信任、亲密、忠诚、依赖、熟悉 | 缓慢积累，代表关系深度 |
| 💭 情绪 | 喜悦、悲伤、愤怒、恐惧、惊讶、厌恶、害羞、尴尬、嫉妒、孤独、焦虑、期待 | 快速波动，代表当前情绪 |
| 🫀 状态 | 疲惫、精力、压力、紧张、自信 | 随时间漂移 |
| 🖤 阴影 | 贪婪、色欲、虚荣、占有欲、傲慢、野心、自私、懒惰、羞耻、内疚 | 平时潜伏，受刺激浮现 |

### 剧情系统

- **剧情阶段**：初识 → 熟稔 → 朋友 → 信任 → 交心
- **剧情线**：开了头要推进/了结，不要断头
- **随机事件**：AI 根据当前情境主动开口
- **多人对话**：AI 自行应变扮演第三方角色

### 时间系统

- **真实时钟**：虚拟时间与真实时间同步
- **可调速率**：0.01× ~ 100000×
- **场景描述**：根据时间自动更新（天气、光线、环境声音等）
- **作息表**：场景驱动（学校/咖啡店/公司等）

### 角色创建

- **预设角色**：仁菜 Nina、小鲸、桃香等
- **自定义创建**：写一段介绍，AI 访谈追问生成完整角色卡
- **随时修改**：对话中可打开角色设定修改

## 🤖 多供应商支持

| 供应商 | API 地址 | 模型示例 |
|--------|----------|----------|
| DeepSeek | api.deepseek.com | deepseek-chat, deepseek-reasoner |
| OpenAI | api.openai.com/v1 | gpt-4o, gpt-4o-mini |
| Claude | api.anthropic.com/v1 | claude-sonnet-4, claude-3-5-sonnet |
| Gemini | generativelanguage.googleapis.com | gemini-2.0-flash |
| Moonshot | api.moonshot.cn/v1 | moonshot-v1-8k/32k/128k |
| 通义千问 | dashscope.aliyuncs.com | qwen-turbo/plus/max |
| 智谱 | open.bigmodel.cn/api/paas/v4 | glm-4-flash/air |
| 小米 MiMo | api.xiaomimimo.com/v1 | mimo-v2.5-pro, mimo-v2.5 |
| 自定义 | 任意 OpenAI 兼容接口 | - |

### API 设置

- 每个存档槽位独立的 API Key、供应商、模型
- 点击「🔍 测试」自动获取可用模型列表
- 支持自定义 API 地址（OpenAI 兼容接口）

## 💾 存档系统

- **5 个独立槽位**：每个存档独立的情感、剧情、时间线、角色
- **独立 API 设置**：每个槽位可使用不同的供应商和模型
- **自动保存**：每轮对话自动存档
- **菜单管理**：查看、切换、删除存档

## 🎨 UI 特性

- **左侧状态面板**：角色卡、时间胶囊、场景描述、剧情、日程、情感
- **可折叠分组**：剧情、日程、情绪日志可收起/展开
- **场景描述**：根据时间自动更新（天气、光线、环境声音等）
- **自动滚动**：对话输出时自动滚动到底部
- **毛玻璃效果**：半透明毛玻璃 UI 设计

## 🏗️ 架构

```
playground/
├── state.ts              情感状态机（维度/delta/回归/描述）
├── storage.ts            数据层（多存档槽位/持久化）
├── character.ts          角色档案（预设/存取）
├── time.ts               时间系统（时钟/速率/作息/场景描述）
├── story.ts              剧情系统（阶段/档案/剧情线/随机事件）
├── ai.ts                 AI 集成（聊天/容错解析/演示/访谈）
├── director.ts           Director 决策系统
├── npc.ts                NPC 系统
├── wizard.ts             角色创建向导
├── agenda.ts             日程系统
├── response-template.ts  回复模板规范
├── chat.ts               UI/流程层（渲染/消息/胶水回调）
└── menu.ts               菜单页（存档列表/设置）
```

跨模块通信用回调注入（`setMessageSender` 等），依赖单向无循环。

## 📝 回复格式

所有 AI 回复遵循统一 JSON 格式：

```json
{
  "dialogue": "她说的话（纯对话，1~2段，60字左右）",
  "action": "动作/表情描写（20字内）",
  "thoughts": "内心想法（20字内）",
  "delta": {"affection": 6, "joy": 12},
  "user_emotion": "joy",
  "memory": "",
  "story": {"event": "", "progress": 0, "thread": "new"}
}
```

使用 `response_format: { type: "json_object" }` 强制 AI 输出 JSON。

## 🔐 安全说明

- 数据全部存浏览器 localStorage，无后端
- API Key 仅存本地，不会上传
- 每个存档槽位独立存储 API Key

## 📦 技术栈

- **前端**：原生 HTML/CSS/TypeScript
- **构建**：Vite
- **AI**：OpenAI 兼容 API（DeepSeek/OpenAI/Claude 等）
- **部署**：静态文件托管（GitHub Pages/Netlify/Vercel）

## 📄 开源协议

MIT License

## 🔗 链接

- **GitHub**：[Melody_of_Us](https://github.com/LanYinxianxuan/Melody_of_Us)
- **在线体验**：[GitHub Pages](https://lanyinxianxuan.github.io/Melody_of_Us/playground/home.html)

## 🙏 致谢

- [DeepSeek](https://deepseek.com/) - AI 模型支持
- [小米 MiMo](https://mimo.mi.com/) - AI 模型支持
- 所有开源贡献者

---

**作者**：[LanYinxianxuan](https://github.com/LanYinxianxuan)

**分支**：melody-ai
