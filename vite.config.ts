import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  if (command === 'serve' && !env.VITE_JELLYFIN_URL) {
    throw new Error('VITE_JELLYFIN_URL must be set (e.g. in .env) for the dev proxy to reach Jellyfin.')
  }

  return {
    server: {
      host: '0.0.0.0',
      port: 8181,
      // Same relative path the production nginx proxy exposes, so the client
      // code doesn't need to know whether it's running against Vite or nginx.
      proxy: {
        '/jellyfin': {
          target: env.VITE_JELLYFIN_URL,
          changeOrigin: true,
          headers: { Authorization: `MediaBrowser Token="${env.VITE_JELLYFIN_TOKEN}"` },
          rewrite: (path) => path.replace(/^\/jellyfin/, ''),
        },
      },
    },
    build: {
      modulePreload: false,
    }
  }
})
