#!/bin/sh
# Replace env vars in JavaScript files
echo "Replacing env constants in JS"
for file in /usr/share/nginx/html/assets/*.js; do
  if [ -f "$file" ]; then
    sed -i "s|__JELLYFIN_URL__|${VITE_JELLYFIN_URL}|g" $file
    sed -i "s|__JELLYFIN_TOKEN__|${VITE_JELLYFIN_TOKEN}|g" $file
  fi
done
echo "Starting Nginx"
nginx -g 'daemon off;'
