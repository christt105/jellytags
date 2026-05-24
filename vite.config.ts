import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => {
  return {
    server: {
      host: '0.0.0.0',
      port: 8181
    },
    define: mode === 'production' ? {
      'import.meta.env.VITE_JELLYFIN_URL': '"__JELLYFIN_URL__"',
      'import.meta.env.VITE_JELLYFIN_TOKEN': '"__JELLYFIN_TOKEN__"',
    } : {},
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
  }
})
