// 获取保存按钮
const archive_initialization = document.getElementById(
  "archive_initialization"
);
// 当保存按钮被点击时执行
archive_initialization.onclick = function () {
  // 获取输入api
  const api_key = document.getElementById("api_key").value;
  // 保存本地键值api，内容为api的字符串数据
  localStorage.setItem("api_key", api_key);
  // 获取输入存档名
  const archive_name = document.getElementById("archive_name").value;
  // 获取输入存档介绍
  const archive_description = document.getElementById(
    "archive_description"
  ).value;
  // 获取输入AI提示词
  const ai_prompt = document.getElementById("ai_prompt").value;
  // 获取输入用户名
  const user_name = document.getElementById("user_name").value;
  // 获取输入角色设定
  const role_setting = document.getElementById("role_setting").value;
  // 获取输入剧本设定
  const script_setting = document.getElementById("script_setting").value;
  // 设获取数据
  let archive_data = {
    archive_name: archive_name,
    archive_description: archive_description,
    ai_prompt: ai_prompt,
    user_name: user_name,
    role_setting: role_setting,
    script_setting: script_setting,
  };
  // 保存数据
  localStorage.setItem("archive_data", JSON.stringify(archive_data));
  let chat_history = [];
  localStorage.setItem("chat_history", JSON.stringify(chat_history));
  // 调试
  let ddd = localStorage.getItem("archive_data");
  let aaaa = JSON.parse(ddd);
  console.log(aaaa);
  // 跳转聊天页面
  window.location.href = "chat_page.html";
};
// 能跑就行了!!!!!!!!!!!by lanyinxianxuan
// 注释by lanyinxianxuan
