// 读取存档和 API Key
let save = localStorage.getItem("archive_data");
let archive_data = JSON.parse(save);
console.log("存档数据:", archive_data);

let Api_Key = localStorage.getItem("api_key");
console.log("API Key:", Api_Key);

// 获取页面元素
let ai_text = document.getElementById("ai_text");//1
const user_input_send_button = document.getElementById("user_input_send_button");
const user_input_field = document.getElementById("user_input");

// 初始化聊天记录数组
let message = [];

// 添加系统信息（存档）到消息数组
message.push({ role: "system", content: JSON.stringify(archive_data) });

// DeepSeek API URL
const url = "https://api.siliconflow.cn/v1/chat/completions";

// 点击发送按钮触发
user_input_send_button.onclick = async () => {
  const user_input = user_input_field.value.trim();
  if (!user_input) {
    alert("请输入消息内容！");
    return;
  }

  // 添加用户消息到消息数组
  message.push({ role: "user", content: user_input });

  // 请求选项
  const options = {
    method: "POST",
    headers: {
      Authorization: `Bearer ${Api_Key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "deepseek-ai/DeepSeek-R1",
      messages: message,
      temperature: 1.0,
    }),
  };

  try {
    const response = await fetch(url, options);
    const data = await response.json();
    console.log("API 返回:", data);

    // 获取 AI 输出
    const ai_return = data.choices[0].message.content;
    console.log("AI 输出:", ai_return);

    // 显示在页面
    ai_text.textContent = ai_return;

    // 把 AI 输出加入消息数组，保持聊天历史
    message.push({ role: "assistant", content: ai_return });

  } catch (error) {
    console.error("发生错误:", error);
  }

  // 清空输入框
  user_input_field.value = "";
};