// 读取本地存档（安全）
let archive = [];
try {
  const raw = localStorage.getItem("archive");
  archive = raw ? JSON.parse(raw) : [];
} catch (e) {
  console.error("读取本地存档失败:", e);
  archive = [];
}

console.log("存档数据:", archive);

// 从 URL 获取存档 id，并选择对应存档
const params = new URLSearchParams(window.location.search);
const archiveIdParam = params.get("id");
const archiveId = archiveIdParam ? Number(archiveIdParam) : null;
let currentArchive = null;
if (archiveId !== null) {
  currentArchive = archive.find((a) => a.archive_id === archiveId) || null;
}
// 回退到第一个存档（如果存在）
if (!currentArchive && archive.length > 0) {
  currentArchive = archive[0];
}

if (!currentArchive) {
  console.warn("未找到可用存档，chat 页面需要先创建存档");
}

const Api_Key = currentArchive?.ai_api_key || "";
console.log("API:", Api_Key);

// 获取发送按钮
const user_input_send_button = document.getElementById(
  "user_input_send_button"
);
// 设硅基流动地址
const url = "https://api.siliconflow.cn/v1/chat/completions";

// 当按钮点击时
if (!user_input_send_button) {
  console.warn("send button not found");
} else {
  user_input_send_button.onclick = async () => {
    // 发送ai信息数组
    let message = [];
    // 获取用户输入
    const user_input_el = document.getElementById("user_input");
    const user_input = user_input_el?.value.trim() || "";

    // system message 使用当前存档数据作为上下文
    const archive_data = currentArchive || {};
    message.push({ role: "system", content: JSON.stringify(archive_data) });
    // 测试空值
    if (!user_input) {
      alert("请输入消息内容！");
      return;
    }
    // chat_history.forEach((item) => {
    //   message.push({
    //     role: item.role,
    //     content:
    //       typeof item.content === "string"
    //         ? item.content
    //         : JSON.stringify(item.content),
    //   });
    // });
    // 加信息于用户输入
    message.push({ role: "user", content: user_input });
    console.log(message);
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
        temperature: 0.6,
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
              // 输出到页面（逐字显示），如果元素不存在则累加字符串
              const ai_dialogue = document.getElementById("ai_dialogue");
              if (ai_dialogue) {
                for (let char of ai_delta) {
                  ai_dialogue.textContent += char;
                  await new Promise((r) => setTimeout(r, 50)); // 逐字显示
                }
              } else {
                // 如果没有对应 DOM，仍然累积返回文本
                // （后面会把它保存到存档）
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
      // 将对话写入当前存档的 chat_history 并保存回 localStorage
      if (currentArchive) {
        currentArchive.chat_history = currentArchive.chat_history || [];
        currentArchive.chat_history.push({ role: "user", content: user_input });
        currentArchive.chat_history.push({
          role: "assistant",
          content: ai_return,
        });

        // 更新 archive 数组中的对应项并写回 localStorage
        const idx = archive.findIndex(
          (a) => a.archive_id === currentArchive.archive_id
        );
        if (idx !== -1) {
          archive[idx] = currentArchive;
        } else {
          // 如果未找到，则追加
          archive.push(currentArchive);
        }
        try {
          localStorage.setItem("archive", JSON.stringify(archive));
        } catch (e) {
          console.error("保存对话到本地存档失败", e);
        }

        console.log("本次对话已保存到存档 id=", currentArchive.archive_id);
      } else {
        console.warn("没有可用存档，未保存对话");
      }
    } catch (error) {
      console.error("发生错误:", error);
    }
  };
}
// 显示历史记录
const chat_history_button = document.getElementById("chat_history_button");
if (chat_history_button) {
  chat_history_button.onclick = () => {
    if (!currentArchive) {
      alert("未找到存档");
      return;
    }
    // 简单显示历史对话（可按需实现更漂亮的 UI）
    const hist = currentArchive.chat_history || [];
    console.log("chat history:", hist);
    alert(JSON.stringify(hist, null, 2));
  };
}
