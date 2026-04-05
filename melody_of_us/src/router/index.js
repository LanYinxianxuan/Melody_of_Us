import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'

const router = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
    },
    {
      path: '/createArchive',
      name: '创建新的存档',
      component: () => import('../views/CreateArchiveView.vue'),
    },
    {
      path:'/chat',
      name:'聊天',
      component: () => import('../views/ChatView.vue'),
    },
    {
      path: '/archiveList',
      name: '过往存档',
      component: () => import('../views/ArchiveListView.vue'),
    },
    {
      path: '/achievements',
      name: '成就图鉴',
      component: () => import('../views/AchievementsView.vue'),
    },
    {
      path: '/settings',
      name: '设置',
      component: () => import('../views/SettingsView.vue'),
    },
    {
      path: '/help',
      name: '帮助',
      component: () => import('../views/HelpView.vue'),
    },
    {
      path: '/about',
      name: 'about',
      // route level code-splitting
      // this generates a separate chunk (About.[hash].js) for this route
      // which is lazy-loaded when the route is visited.
      component: () => import('../views/AboutView.vue'),
    },
  ],
})

export default router
