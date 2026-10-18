import { resolve } from 'path'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// 移动端（Capacitor WebView）构建配置：仅构建 renderer 部分
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    root: resolve('src/renderer'),
    base: './',
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL),
      'import.meta.env.VITE_SUPABASE_KEY': JSON.stringify(env.VITE_SUPABASE_KEY),
      'import.meta.env.VITE_PLATFORM': JSON.stringify('mobile')
    },
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        'suth-lyric-kit': resolve('packages/suth-lyric-kit/src/index.ts')
      }
    },
    plugins: [
      vue(),
      wasm(),
      topLevelAwait(),
      // 为 music-metadata / node-id3 / flac-metadata / wavefile 提供 Node 兼容层
      nodePolyfills({
        include: ['buffer', 'process', 'events', 'util', 'stream', 'string_decoder'],
        globals: { Buffer: true, process: true }
      })
    ],
    build: {
      outDir: resolve('dist-mobile'),
      emptyOutDir: true,
      chunkSizeWarningLimit: 3000,
      // 降低内存占用（受限容器环境）
      reportCompressedSize: false,
      rollupOptions: {
        maxParallelFileOps: 2
      }
    }
  }
})
