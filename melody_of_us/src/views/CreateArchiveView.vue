<script setup>
import { ref } from 'vue';

const archiveName = ref('');
const archiveDescription = ref('');
const apiKey = ref('');

/**
 * 存档数据保存方法
 * 数据将以 JSON 字符串形式存储在 localStorage 中
 */
const saveArchive = () => {
  // 1. 定义存档数据结构
  const archiveData = {
    id: Date.now(), // 唯一标识
    name: archiveName.value,
    description: archiveDescription.value,
    apiKey: apiKey.value,
    createTime: new Date().toISOString(),
    // 聊天记录示例
    chatHistory: [
      { role: 'system', content: '你是一个贴心的伴侣', timestamp: Date.now() },
      { role: 'user', content: '你好', timestamp: Date.now() + 1000 }
    ],
    // 属性值（数字表示，例如：0-开心, 1-伤心, 2-愤怒 等）
    attributes: {
      happiness: 80,
      sadness: 10,
      energy: 100,
      moodStatus: 0 // 具体数值对应关系可根据业务定义
    }
  };

  // 2. 获取已有存档列表（如果不存在则初始化为空数组）
  const existingArchives = JSON.parse(localStorage.getItem('melody_archives') || '[]');

  // 3. 将新存档加入列表
  existingArchives.push(archiveData);

  // 4. 以 JSON 方式保存回浏览器存储
  localStorage.setItem('melody_archives', JSON.stringify(existingArchives));

  alert('存档保存成功！');
  
  // 清空输入
  archiveName.value = '';
  archiveDescription.value = '';
  apiKey.value = '';
};

/*
  调用方法说明：
  
  1. 获取所有存档：
     const archives = JSON.parse(localStorage.getItem('melody_archives') || '[]');
     
  2. 获取特定存档（按ID）：
     const archive = archives.find(a => a.id === someId);
     
  3. 更新属性值示例：
     archive.attributes.happiness += 5;
     localStorage.setItem('melody_archives', JSON.stringify(archives));
*/
</script>

<template>
    <div class="app">
        <input type="text" id="ArchiveName" placeholder="存档名称" v-model="archiveName">
        <input type="text" id="ArchiveDescription" placeholder="存档描述" v-model="archiveDescription">
        <input type="text" id="ApiKey" placeholder="APIKey" v-model="apiKey">
        <input type="button" id="saveButton" value="保存" @click="saveArchive">
    </div>
</template>
