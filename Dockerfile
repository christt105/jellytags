FROM node:20-alpine AS build

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY . .
RUN npm run build

# Production stage using Nginx
FROM nginx:1.31-alpine3.23

# Patch OS packages in runtime image
RUN apk upgrade --no-cache

# Copy built assets
COPY --from=build /app/dist /usr/share/nginx/html

# Copy nginx config template. nginx's own entrypoint (docker-entrypoint.d/
# 20-envsubst-on-templates.sh) renders *.template files under
# /etc/nginx/templates/ with envsubst automatically before starting. Scope
# the substitution to our own vars, so an unrelated env var can't collide
# with one of nginx's own $variables in the template.
ENV NGINX_ENVSUBST_FILTER=^VITE_
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# nginx.conf.template's proxy_pass target comes from a variable (needed for
# runtime DNS re-resolution), and with a variable target nginx forwards
# whatever path is embedded in it instead of the rewritten request path; a
# trailing slash on VITE_JELLYFIN_URL would silently break every proxied
# request. Normalize it away before envsubst runs.
COPY strip-trailing-slash.envsh /docker-entrypoint.d/05-strip-trailing-slash.envsh
RUN chmod +x /docker-entrypoint.d/05-strip-trailing-slash.envsh

# Expose port 80
EXPOSE 80
