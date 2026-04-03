import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue' // 1. 必须引入这个插件

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
      vue(), // 2. 必须在这里调用它
        ],
          resolve: {
              alias: {
                    '@': fileURLToPath(new URL('./src', import.meta.url))
                        }
                          }
                          })