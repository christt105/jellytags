# Issue #20 — Fix CORS by proxying Jellyfin requests

**Status:** Implemented
**Issue:** https://github.com/christt105/jellytags/issues/20

## Problem

JellyTags is a pure browser SPA (`src/main.ts` + `@jellyfin/sdk`) that talks
**directly from the browser to the Jellyfin server**:

- `src/main.ts:18` — `jellyfin.createApi(serverUrl)` with `serverUrl = VITE_JELLYFIN_URL`.
- Image URLs are hand-built against the same absolute host (`src/main.ts:259`, `:456`).

Because the request to e.g. `https://jellyfin.domain.com/System/Info/Public`
crosses origins, the browser issues a CORS preflight. Jellyfin does not return
`Access-Control-Allow-Origin`, so the browser blocks the response:

```
Access to XMLHttpRequest at 'https://jellyfin.domain.com/System/Info/Public'
from origin 'http://localhost:8181' has been blocked by CORS policy ...
```

**Fix:** stop making cross-origin requests. Route all Jellyfin traffic through a
**same-origin reverse proxy** so the actual request to Jellyfin originates
server-side, where CORS does not apply.

## Why a Vite proxy alone is not enough

The reporter suggested a Vite proxy. That fixes **dev only** (`npm run dev`).
Production is **Nginx serving static files** (`Dockerfile` → `nginx:alpine`, no
Node backend). So the proxy must exist in two places:

| Environment        | Proxy mechanism                       |
| ------------------ | ------------------------------------- |
| Dev (`npm run dev`)| `server.proxy` in `vite.config.ts`    |
| Prod (Docker)      | `proxy_pass` in a custom `nginx.conf` |

Both expose Jellyfin under the same relative path (`/jellyfin`) so the client
code is environment-agnostic.

## Plan

### 1. Client — use a relative base path (`src/main.ts`)

- Introduce `const apiBase = '/jellyfin'` and pass it to `createApi(apiBase)`
  instead of the absolute `serverUrl`.
- Replace the two hand-built image URLs (`${serverUrl}/Items/...`) with
  `${apiBase}/Items/...`.
- `VITE_JELLYFIN_URL` is no longer read by the browser; it becomes a
  **proxy target** consumed only by Vite (dev) and Nginx (prod).

### 2. Dev proxy (`vite.config.ts`)

```ts
server: {
  host: '0.0.0.0',
  port: 8181,
  proxy: {
    '/jellyfin': {
      target: process.env.VITE_JELLYFIN_URL,
      changeOrigin: true,
      rewrite: (p) => p.replace(/^\/jellyfin/, ''),
    },
  },
}
```

### 3. Prod proxy (`nginx.conf.template`, new file)

```nginx
server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;

  location /jellyfin/ {
    proxy_pass ${VITE_JELLYFIN_URL}/;
    proxy_set_header Host $host;
    # Optional security win — see below
    # proxy_set_header X-Emby-Token ${VITE_JELLYFIN_TOKEN};
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

### 4. Wire env substitution at container start (`docker-entrypoint.sh`)

The Jellyfin URL is injected at container start, so the nginx config needs
substitution too. Add an `envsubst` step alongside the existing JS `sed`:

```sh
envsubst '${VITE_JELLYFIN_URL} ${VITE_JELLYFIN_TOKEN}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf
```

`Dockerfile` copies `nginx.conf.template` into `/etc/nginx/templates/`.
(`envsubst` ships in `nginx:alpine` via the `gettext` package — confirm or
`apk add gettext` in the runtime stage.)

## Bonus: stop leaking the API token

Today `VITE_JELLYFIN_TOKEN` is **baked into the client JS**
(`docker-entrypoint.sh` seds it into the bundle), so anyone loading the page can
read an **admin** Jellyfin token. Once the proxy exists, inject the token at the
proxy instead (`proxy_set_header X-Emby-Token ...`) and drop it from the client
bundle entirely. Strongly recommended, but can land as a follow-up.

## Effort

**~Half a day.**

- Dev fix (steps 1–2): ~15 min, low risk.
- Prod fix (steps 3–4): the real work — writing the nginx reverse proxy and
  wiring env substitution into the existing entrypoint, then verifying in the
  container.

## Touched files

- `src/main.ts` — relative API base + image URLs
- `vite.config.ts` — dev proxy
- `nginx.conf.template` — **new**, reverse proxy
- `Dockerfile` — copy template, ensure `envsubst`
- `docker-entrypoint.sh` — render template at startup
- `docker-compose.yml` / `README.md` — note that the token is now server-side (if bonus applied)
