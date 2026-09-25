# Security headers on every response (the API sets them too).
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "no-referrer" always;
add_header X-Frame-Options "DENY" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
# HSTS: enable ONLY after HTTPS has been verified on every subdomain (runbook
# 04). Never add `preload` without a separate review.
# add_header Strict-Transport-Security "max-age=15552000; includeSubDomains" always;
