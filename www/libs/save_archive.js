// 获取保存按钮（如果页面没有该元素则安全退出）
const archive_initialization = document.getElementById(
  "archive_initialization"
);
if (!archive_initialization) {
  // 页内未找到保存按钮，可能是被不包含此脚本的页面加载，直接结束
  console.warn("save_archive: archive_initialization element not found");
} else {
  // 读取已有存档（如果有）
  let archive = [];
  try {
    const raw = localStorage.getItem("archive");
    archive = raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("读取本地存档失败，使用空数组代替", e);
    archive = [];
  }

  // 当保存按钮被点击时执行
  archive_initialization.onclick = function () {
    // 安全获取输入（避免页面元素缺失导致脚本崩溃）
    const api_key = document.getElementById("api_key")?.value || "";
    const archive_name = document.getElementById("archive_name")?.value || "";
    const archive_description =
      document.getElementById("archive_description")?.value || "";
    const ai_prompt = document.getElementById("ai_prompt")?.value || "";
    const user_name = document.getElementById("user_name")?.value || "";
    const role_setting = document.getElementById("role_setting")?.value || "";
    const script_setting =
      document.getElementById("script_setting")?.value || "";
    const ai_model = document.getElementById("model_selection")?.value || "";

    // 生成唯一 id（使用 Date.now）
    const id = Date.now();
    const archive_data = {
      archive_id: id,
      archive_name: archive_name,
      archive_description: archive_description,
      ai_prompt: ai_prompt,
      ai_api_key: api_key,
      ai_model: ai_model,
      user_name: user_name,
      role_setting: role_setting,
      script_setting: script_setting,
      chat_history: [],
    };

    // 将新存档追加到已有数组并保存
    archive.push(archive_data);
    try {
      localStorage.setItem("archive", JSON.stringify(archive));
    } catch (e) {
      console.error("本地存档保存失败", e);
      alert("保存失败：本地存储不可用");
      return;
    }

    // 调试输出（如需可保留）
    console.log("存档已保存：", archive_data);

    // 跳转聊天页面（使用模板字符串确保 id 被正确插入）
    window.location.href = `chat_page.html?id=${id}`;
  };
}
// 能跑就行了!!!!!!!!!!!by lanyinxianxuan
// 注释by lanyinxianxuan
