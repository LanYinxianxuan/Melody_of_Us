<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const archives = ref([]);

// 1. 页面加载时从 localStorage 获取所有存档
onMounted(() => {
  const data = JSON.parse(localStorage.getItem('melody_archives') || '[]');
  archives.value = data;
});

/**
 * 2. 跳转到聊天页的方法
 * 携带存档的 ID 传参
 */
const enterChat = (id) => {
  router.push({ path: '/chat', query: { id: id } });
};

/**
 * 3. 删除存档的方法 (可选)
 */
const deleteArchive = (id) => {
  if (confirm('确定要删除这个存档吗？')) {
    archives.value = archives.value.filter(a => a.id !== id);
    localStorage.setItem('melody_archives', JSON.stringify(archives.value));
  }
};
</script>

<template>
  <div class="archive-list">
    <h1>过往存档列表</h1>
    
    <div v-if="archives.length === 0">
      目前还没有存档，去 <router-link to="/createArchive">创建一个</router-link> 吧！
    </div>

    <div v-else>
      <div 
        v-for="item in archives" 
        :key="item.id" 
        class="archive-item"
        style="border: 1px solid #ccc; padding: 10px; margin-bottom: 10px;"
      >
        <h3>{{ item.name }}</h3>
        <p>简介: {{ item.introduction }}</p>
        <p>
          心情指数: {{ item.statusValues?.currentMood }} | 
          好感度: {{ item.statusValues?.happiness }}
        </p>
        <p><small>创建时间: {{ item.createTime }}</small></p>
        
        <button @click="enterChat(item.id)">进入聊天</button>
        <button @click="deleteArchive(item.id)" style="color: red; margin-left: 10px;">删除存档</button>
      </div>
    </div>

    <router-link to="/">返回首页</router-link>
  </div>
</template>
