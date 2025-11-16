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
let ai_dialogue = document.getElementById("ai_dialogue");
let ai_action = document.getElementById("ai_action");
let ai_thoughts = document.getElementById("ai_thoughts");
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
      model: "deepseek-ai/DeepSeek-V3",
      stream: true,
      messages: message,
      temperature: 1.0,
    }),
  };
  // 发送
  try {
    const response = await fetch(url, options);
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    let partial = "";
    let full_response = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      partial += decoder.decode(value, { stream: true });
      let lines = partial.split("\n");
      partial = lines.pop(); // 保留最后一行残余

      for (let line of lines) {
        line = line.trim();
        if (!line || !line.startsWith("data:")) continue;

        const jsonStr = line.replace(/^data:\s*/, "");
        if (jsonStr === "[DONE]") continue;

        try {
          const parsed = JSON.parse(jsonStr);
          const ai_delta = parsed.choices[0]?.delta?.content;
          if (ai_delta) {
            full_response += ai_delta;
            for (let char of ai_delta) {
              ai_dialogue.textContent += char;
              await new Promise((r) => setTimeout(r, 50)); // 逐字显示
            }
          }
        } catch (e) {
          console.error("流解析错误:", e);
        }
      }
    }
    //     // 模拟数据
    //     const ai_return = `{
    //   "dialogue": "（笑靥如花）那么...要不要听听我新练的钢琴曲？虽然弹得还不够好...（轻轻拉起校服衣袖）",
    //   "action": "害羞地摸着琴谱边缘，眼神充满期待地看着小旋，手指无意识地摆出弹琴的姿势",
    //   "thoughts": "能分享音乐真是太棒了...就像刚才分享画册那样...希望他不会觉得我太唐突...但真的很想让他听听这首曲子",
    //   "stats": {
    //     "affection": 68,
    //     "trust": 50,
    //     "confidence": 45,
    //     "intimacy": 40,
    //     "excitement": 80,
    //     "emotion": 80,
    //     "nervousness": 38,
    //     "anxiety": 20,
    //     "fatigue": 10,
    //     "shyness": 48,
    //     "anger": 0,
    //     "fear": 3
    //   },
    //   "delta": {
    //     "affection": 5,
    //     "trust": 5,
    //     "confidence": 2,
    //     "intimacy": 4,
    //     "excitement": 5,
    //     "emotion": 5,
    //     "nervousness": -10,
    //     "anxiety": -3,
    //     "fatigue": 0,
    //     "shyness": -5,
    //     "anger": 0,
    //     "fear": -2
    //   },
    //   "developer": null
    // }`;
    let ai_return = full_response;
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
// 显示历史记录
const chat_history_button = document.getElementById("chat_history_button");
chat_history_button.onclick = () => {};
