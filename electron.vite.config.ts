import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin, loadEnv } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      define: {
        'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL),
        'import.meta.env.VITE_SUPABASE_KEY': JSON.stringify(env.VITE_SUPABASE_KEY),
        // 星火（MaaS）API Key：仅从根目录 .env.local 注入，不写进源码仓库
        'import.meta.env.VITE_SPARK_API_KEY': JSON.stringify(env.VITE_SPARK_API_KEY)
      }
    },
    preload: {
      plugins: [externalizeDepsPlugin()]
    },
    renderer: {
      resolve: {
        alias: {
          '@renderer': resolve('src/renderer/src'),
          'suth-lyric-kit': resolve('packages/suth-lyric-kit/src/index.ts')
        }
      },
      define: {
        // 星火（MaaS）API Key：仅从根目录 .env.local 注入，不写进源码仓库
        'import.meta.env.VITE_SPARK_API_KEY': JSON.stringify(env.VITE_SPARK_API_KEY)
      },
      plugins: [vue(), wasm(), topLevelAwait()]
    }
  }
})
