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

# Copy nginx config template, rendered at container start (docker-entrypoint.sh)
COPY nginx.conf.template /etc/nginx/templates/default.conf.template

# Copy entrypoint script
COPY docker-entrypoint.sh /
RUN chmod +x /docker-entrypoint.sh

# Expose port 80
EXPOSE 80

CMD ["/docker-entrypoint.sh"]
