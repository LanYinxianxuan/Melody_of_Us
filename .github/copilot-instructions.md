# Copilot 使用指引（仓库特定）

以下说明帮助 AI 编程代理（如 Copilot）快速在本仓库中产出有用、可编译的更改。内容基于仓库内可发现的实现与约定。

概览

- 本项目是一个基于 Capacitor 的轻量网页游戏，主要由静态网页（位于 `www/`）和一个 Android 容器（位于 `android/`）组成。
- 前端为纯静态 HTML/CSS/JS（`www/html/`, `www/libs/`），通过 Capacitor 将 `www/` 内容嵌入 Android 原生容器。

关键架构点（为什么这样组织）

- Web-first：游戏逻辑、页面和脚本都在 `www/`，便于浏览器调试与快速迭代。
- 原生适配：`android/` 包含 Gradle 项目与 Capacitor 桥（`MainActivity` 继承 `BridgeActivity`），主要用于打包为 APK 与接入原生能力。

常见开发与构建工作流

- 在浏览器查看：直接打开 `www/index.html` 或在项目根运行简单静态服务（示例）：
  - `python -m http.server --directory www 8000`
  - `npx http-server www`（若已安装）
- 同步并在 Android Studio 中打开（推荐用于打包/调试真机）：
  - `npm install`（若需安装依赖）
  - `npx cap sync android`
  - `npx cap open android` （或直接在 `android/` 目录用 Android Studio 打开）
- 使用 Gradle 打包（CLI）：
  - `cd android && ./gradlew assembleDebug`

项目约定与模式（来自代码）

- 页面与入口：`www/index.html`，导航到 `www/html/start_game.html` 等页面。
- 前端逻辑文件：`www/libs/chat.js`（AI 对话相关）、`www/libs/save_archive.js`（存档相关）。修改对话/存档逻辑请从这些文件入手。
- 资源同步：Android 的 `app/src/main/assets/public/` 与 `www/` 目录在构建/同步时应保持一致（由 Capacitor 管理）。
- 原生入口：`android/app/src/main/java/com/melodyofus/app/MainActivity.java`，仅继承 `BridgeActivity`，说明 Capacitor 插件或原生扩展应通过标准 Capacitor 接口接入。

集成点与外部依赖

- Capacitor：`capacitor.config.json`（根目录）与 `package.json` 中依赖 `@capacitor/*`（v7）。确保使用匹配的 Capacitor CLI 版本。
- Android/Gradle：任意原生更改后应运行 `npx cap sync android` 并在 Android Studio 中 rebuild。

编辑与变更建议（AI 代理写变更时）

- 优先修改 `www/` 的文件来更改游戏行为或 UI；仅在需要原生能力时触及 `android/`。
- 修改前检查 `www/html/` 是否有调用对应 `www/libs/` 的脚本（避免断链）。
- 如果新增前端依赖，更新 `package.json` 并记录需要的 `npx cap sync` 步骤。

示例引用（快速定位）

- 启动页：`www/index.html`
- 页面集合：`www/html/*.html`（如 `start_game.html`, `chat_page.html`）
- 聊天逻辑：`www/libs/chat.js`
- 存档逻辑：`www/libs/save_archive.js`
- Capacitor 原生入口：`android/app/src/main/java/com/melodyofus/app/MainActivity.java`
- 项目配置：`capacitor.config.json`, `package.json`

注意事项

- 仓库为同人/非商业作品（见 `README.md`），变更应注意版权与发布限制。
- 仓库内未发现自动化测试目录；提交较大变更后最好在浏览器与 Android Studio 手动验证。

如果以上任何部分不清晰或你希望我把某些常用命令写成 `package.json` 的 `scripts`，请告诉我要添加哪些命令或偏好的调试流程。

调试 `chat.js`（快速示例）

- 目标文件：`www/libs/chat.js`。该文件从 `localStorage` 的 `archive` 中读取 `ai_api_key` 和 `chat_history`，并通过 `fetch` 请求第三方流式聊天 API。
- 本地快速调试步骤：
  1. 在项目根运行本地静态服务器（已添加到 `package.json` 脚本）：

```bash
npm run serve
```

2. 在浏览器打开：`http://localhost:8000/html/chat_page.html`，打开开发者工具的 Console/Network 面板观察输出（`chat.js` 内有 `console.log`）。
3. 在 Console 中注入一个测试存档，确保 `chat.js` 能读取到 `ai_api_key` 与 `chat_history`：

```javascript
localStorage.setItem(
  "archive",
  JSON.stringify([{ ai_api_key: "YOUR_API_KEY", chat_history: [] }])
);
```

4. 为避免调用真实 API，可临时修改 `www/libs/chat.js` 中 `user_input_send_button.onclick` 的实现，在 `fetch` 之前短路返回模拟数据。例如在函数顶端加：

```javascript
// 临时短路，用于本地调试
const simulateLocalResponse = async (user_input) => {
  const ai_return = "（调试）这是模拟返回内容：" + user_input;
  archive[0].chat_history.push({ role: "user", content: user_input });
  archive[0].chat_history.push({ role: "assistant", content: ai_return });
  document.getElementById("ai_dialogue").textContent = ai_return;
};
// 然后在 onclick 内用：
// await simulateLocalResponse(user_input); return;
```

5. 在调试完成后恢复 `fetch` 流逻辑并同步到 Android：

```bash
npm run cap:sync
npm run cap:open:android
# 在 Android Studio 中 rebuild 或运行
```

- 注意：`chat.js` 中存在变量 `archive_data` 被序列化为 system message（见源码），请在调试时确认该变量的来源或临时替换为适当的上下文字符串。

脚本参考（已添加到 `package.json`）

- `npm run serve`：在 `http://localhost:8000` 启动静态服务器（用于浏览器调试）。
- `npm run cap:sync`：运行 `npx cap sync android`，将 `www/` 同步到原生项目。
- `npm run cap:open:android`：打开 Android 项目到 Android Studio。
- `npm run build:android`：在 `android/` 目录运行 `./gradlew assembleDebug`，构建 debug APK。
