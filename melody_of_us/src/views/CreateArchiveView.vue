<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const handleCreateAndGo = () => {
  // 1. 执行创建逻辑，并获取生成的 id
  const newId = createArchive(); 

  // 2. 携带 id 跳转
  router.push({ path: '/chat', query: { id: newId } });
}
// 定义响应式变量
const archiveName = ref('');
const archiveIntroduction = ref('');
const apiKey = ref('');

/**
 * 保存数据到浏览器存储 (localStorage)
 * 格式：JSON
 */
const createArchive = () => {
  // 1. 构造存档数据对象
  const archiveData = {
    id: Date.now(), // 唯一ID
    name: archiveName.value,
    introduction: archiveIntroduction.value,
    apiKey: apiKey.value,
    createTime: new Date().toLocaleString(),
    
    // 聊天记录 (规范格式)
    chatHistory: [
      { role: 'system', content: '系统初始化', time: new Date().getTime() },
      { role: 'user', content: '你好', time: new Date().getTime() + 1000 }
    ],
    
    // 属性值 (数字表示，具体含义可自行定义)
    // 例如: 0-开心, 1-伤心, 2-平静, 3-愤怒
    statusValues: {
      happiness: 100,
      sadness: 0,
      currentMood: 0, // 默认开心
      energy: 80
    }
  };

  // 2. 获取已有存档列表
  const archives = JSON.parse(localStorage.getItem('melody_archives') || '[]');

  // 3. 将新数据存入数组
  archives.push(archiveData);

  // 4. 以 JSON 字符串方式存回 localStorage
  localStorage.setItem('melody_archives', JSON.stringify(archives));

  alert('存档已成功以 JSON 格式保存到浏览器！');
  
  const id = archiveData.id;

  // 清空输入框
  archiveName.value = '';
  archiveIntroduction.value = '';
  apiKey.value = '';

  return id;
};

/*
  调用方法示例：
  
  // 1. 获取所有存档数据
  const getAllArchives = () => {
    return JSON.parse(localStorage.getItem('melody_archives') || '[]');
  };
  
  // 2. 更新某个存档的属性值（例如把心情设为 1-伤心）
  const updateArchiveMood = (id, newMoodValue) => {
    const list = getAllArchives();
    const item = list.find(a => a.id === id);
    if (item) {
      item.statusValues.currentMood = newMoodValue;
      localStorage.setItem('melody_archives', JSON.stringify(list));
    }
  };
  
  // 3. 添加聊天记录
  const addChatMessage = (id, role, content) => {
    const list = getAllArchives();
    const item = list.find(a => a.id === id);
    if (item) {
      item.chatHistory.push({ role, content, time: Date.now() });
      localStorage.setItem('melody_archives', JSON.stringify(list));
    }
  };
*/
</script>

<template>
  <div class="app">
    <input type="text" id="archiveName" placeholder="存档名称" v-model="archiveName">
    <input type="text" id="archiveIntroduction" placeholder="存档简介" v-model="archiveIntroduction">
    <input type="password" id="apiKey" placeholder="APIKey" v-model="apiKey">
    <input type="button" value="创建存档" @click="handleCreateAndGo" >
  </div>
</template>
