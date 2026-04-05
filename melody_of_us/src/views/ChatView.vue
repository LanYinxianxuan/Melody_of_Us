<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const userInput = ref('')
const messages = ref([])
const currentArchive = ref(null)
const isLoading = ref(false)

// 初始化时获取存档
onMounted(() => {
  const archives = JSON.parse(localStorage.getItem('melody_archives') || '[]')
  const archiveId = route.query.id
  
  if (archiveId) {
    // 如果 URL 传了 id，则加载指定存档
    currentArchive.value = archives.find(a => a.id === Number(archiveId))
  } 
  
  // 如果没传 id 或没找到，默认加载第一个
  if (!currentArchive.value && archives.length > 0) {
    currentArchive.value = archives[0]
  }

  if (currentArchive.value) {
    messages.value = currentArchive.value.chatHistory || []
  }
})

/**
 * 硅基流动 API 请求 (DeepSeek-V3)
 */
const sendMessage = async () => {
  if (!userInput.value.trim() || !currentArchive.value) return

  const userText = userInput.value
  userInput.value = ''

  // 1. 添加用户消息并保存
  const userMsg = { role: 'user', content: userText, time: Date.now() }
  messages.value.push(userMsg)
  saveToArchive()

  isLoading.value = true

  try {
    const response = await fetch('https://api.siliconflow.cn/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentArchive.value.apiKey}`,
      },
      body: JSON.stringify({
        model: 'deepseek-ai/DeepSeek-V3',
        messages: [
          {
            role: 'system',
            content:
              '你是一个具有丰富情感的角色。请始终以 JSON 格式输出响应，包含以下字段：content (对话内容), action (动作描述), mental (心理活动), attributes (属性值更新，如 happiness, sadness, currentMood 等)。示例：{"content": "...", "action": "...", "mental": "...", "attributes": {"happiness": 85}}',
          },
          ...messages.value.map((m) => ({
            role: m.role,
            content: typeof m.content === 'object' ? m.content.content : m.content,
          })),
        ],
        response_format: { type: 'json_object' },
      }),
    })

    const data = await response.json()
    const aiResponseRaw = data.choices[0].message.content
    const aiData = JSON.parse(aiResponseRaw)

    // 2. 添加 AI 消息并保存
    const aiMsg = {
      role: 'assistant',
      content: aiData, // 存储解析后的 JSON 对象
      time: Date.now(),
    }
    messages.value.push(aiMsg)

    // 3. 更新属性并保存整个存档
    if (aiData.attributes) {
      currentArchive.value.statusValues = {
        ...currentArchive.value.statusValues,
        ...aiData.attributes,
      }
    }
    saveToArchive()
  } catch (error) {
    console.error('API Error:', error)
    alert('请求失败，请检查 APIKey 或网络')
  } finally {
    isLoading.value = false
  }
}

/**
 * 将单条消息和最新的存档状态保存到 localStorage
 */
const saveToArchive = () => {
  const archives = JSON.parse(localStorage.getItem('melody_archives') || '[]')
  const index = archives.findIndex((a) => a.id === currentArchive.value.id)

  if (index !== -1) {
    // 同步本地状态
    currentArchive.value.chatHistory = messages.value
    archives[index] = currentArchive.value
    localStorage.setItem('melody_archives', JSON.stringify(archives))
  }
}
</script>

<template>
  <div class="chat-container">
    <div class="archive-info" v-if="currentArchive">
      当前存档: {{ currentArchive.name }} | 心情: {{ currentArchive.statusValues?.currentMood }} |
      好感度: {{ currentArchive.statusValues?.happiness }}
    </div>

    <div class="chat-window">
      <div v-for="(msg, index) in messages" :key="index" class="message-item">
        <strong>{{ msg.role === 'user' ? '我' : '角色' }}:</strong>

        <!-- 用户显示文本，AI 显示 JSON 中的 content 和动作 -->
        <div v-if="msg.role === 'user'">{{ msg.content }}</div>
        <div v-else>
          <p>
            <em>(动作: {{ msg.content.action }})</em>
          </p>
          <p>{{ msg.content.content }}</p>
          <p>
            <small>(心理: {{ msg.content.mental }})</small>
          </p>
        </div>
      </div>
      <div v-if="isLoading">AI 正在思考...</div>
    </div>

    <div class="input-area">
      <input v-model="userInput" type="text" placeholder="输入消息..." @keyup.enter="sendMessage" />
      <button @click="sendMessage" :disabled="isLoading">发送</button>
    </div>
  </div>
</template>
