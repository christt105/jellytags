#!/bin/sh
echo "Rendering Nginx config"
envsubst '${VITE_JELLYFIN_URL} ${VITE_JELLYFIN_TOKEN}' \
  < /etc/nginx/templates/default.conf.template \
  > /etc/nginx/conf.d/default.conf

echo "Starting Nginx"
nginx -g 'daemon off;'
