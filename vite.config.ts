import { defineConfig } from 'vite'

export default defineConfig({
  base: "", // dynamic path for hosting
  server: {
    host: '0.0.0.0',
    port: 8181
  },
  build: {
    modulePreload: false,
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/[name].js`,
        assetFileNames: `assets/[name].[ext]`
      }
    }
  }
})
