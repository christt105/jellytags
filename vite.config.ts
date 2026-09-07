import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    server: {
      host: '0.0.0.0',
      port: 8181,
      // Mirrors the nginx reverse proxy used in production (nginx.conf.template)
      // so the client can always call the relative /jellyfin path, in dev too.
      proxy: {
        '/jellyfin': {
          target: env.VITE_JELLYFIN_URL,
          changeOrigin: true,
          headers: { 'X-Emby-Token': env.VITE_JELLYFIN_TOKEN },
          rewrite: (path) => path.replace(/^\/jellyfin/, ''),
        },
      },
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
  }
})
