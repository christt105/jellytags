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
# /etc/nginx/templates/ with envsubst automatically before starting, using
# every defined env var, so $host/$uri and friends are left untouched.
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Expose port 80
EXPOSE 80
