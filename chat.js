let history = localStorage.getItem("chat_history");
let chat_history = JSON.parse(history);
// 获取保存存档数据字符串
let save = localStorage.getItem("archive_data");
// 字符串转json
let archive_data = JSON.parse(save);
console.log("存档数据：", archive_data);
// 获取保存api
let Api_Key = localStorage.getItem("api_key");
console.log("API Key:", Api_Key);
// 获取ai回复内容
let ai_text = document.getElementById("ai_text");
// 获取发送按钮
const user_input_send_button = document.getElementById(
  "user_input_send_button"
);
// 设硅基流动地址
const url = "https://api.siliconflow.cn/v1/chat/completions";

// 当按钮点击时
user_input_send_button.onclick = async () => {
  // 发送ai信息数组
  let message = [];
  // 获取用户输入
  const user_input = document.getElementById("user_input").value.trim();
  // 加信息数组于存档
  message.push({ role: "system", content: JSON.stringify(archive_data) });
  // 测试空值
  if (!user_input) {
    alert("请输入消息内容！");
    return;
  }
  chat_history.forEach((item) => {
    message.push({
      role: item.role,
      content:
        typeof item.content === "string"
          ? item.content
          : JSON.stringify(item.content),
    });
  });
  // 加信息于用户输入
  message.push({ role: "user", content: user_input });
  // 发送内容懒得写
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
  // 发送
  try {
    const response = await fetch(url, options);
    const data = await response.json();
    console.log(data);
    // 获取返回内容
    const ai_return = data.choices[0].message.content;
    console.log(ai_return);
    // 写到页面上
    ai_text.textContent = ai_return;
    // 把对话加到message
    // message.push({
    //   role: "assistant",
    //   content: `${ai_return}`,
    // });
    console.log(message);

    chat_history.push({ role: "user", content: user_input });
    chat_history.push({ role: "assistant", content: ai_return });
    localStorage.setItem("chat_history", JSON.stringify(chat_history));
    console.log(
      "本次对话记录：",
      JSON.parse(localStorage.getItem("chat_history"))
    );
  } catch (error) {
    console.error("发生错误:", error);
  }
};
