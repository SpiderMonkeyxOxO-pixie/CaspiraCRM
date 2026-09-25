# Upstream settings for the API.
proxy_pass http://api;
proxy_http_version 1.1;
proxy_set_header Host $host;
proxy_set_header Connection $connection_upgrade;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header X-Real-IP $remote_addr;
# Replace (never append to) any client-supplied X-Forwarded-For.
proxy_set_header X-Forwarded-For $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Request-Id $request_id;
proxy_connect_timeout 5s;
proxy_send_timeout 60s;
proxy_read_timeout 120s;
# Authenticated responses are never cached by the proxy.
proxy_no_cache 1;
proxy_cache_bypass 1;
proxy_hide_header X-Powered-By;
