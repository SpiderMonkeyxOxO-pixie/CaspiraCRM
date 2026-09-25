# 04 — Issue and renew TLS certificates

**Who:** System Owner. **Where:** host shell. **Changes public DNS or certificates: needs approval first.**

The proxy reads `fullchain.pem` and `privkey.pem` from `TLS_CERT_DIR` (for example `/etc/caspira/tls/production`), mounted read-only. It serves ACME HTTP-01 challenges from `ACME_WEBROOT` over port 80, and redirects everything else to HTTPS.

## Render the site configuration (once per host)
The committed template holds no real host names. Render it on the host:
```bash
cd /opt/caspira/deploy/production
sed -e 's/APP_HOST/crm.<domain>/g' -e 's/API_HOST/api.<domain>/g' proxy/conf.d/caspira.conf.template > proxy/conf.d/caspira.conf
```
The rendered `caspira.conf` is git-ignored. After any change, run `./dc production exec -T proxy nginx -t` before reloading.

## Maintenance page
- **On:** `touch /opt/caspira/deploy/production/proxy/maintenance/ENABLED`.
- **Off:** `rm /opt/caspira/deploy/production/proxy/maintenance/ENABLED`, one explicit file.

While it is on, the proxy answers 503 with the maintenance page (the SPA) or a JSON body (the API). No reload is needed.

## Issue (Let's Encrypt with certbot, webroot mode)
1. DNS must already point `crm.<domain>` and `api.<domain>` at the host (A and AAAA records). Check with `dig +short crm.<domain>`.
2. Start the proxy (runbook 03). Port 80 must be reachable.
3. Issue the certificate:
   ```bash
   sudo certbot certonly --webroot -w /var/www/caspira-acme -d crm.<domain> -d api.<domain> --deploy-hook /opt/caspira/deploy/production/scripts/tls-deploy-hook.sh
   ```
4. Create the deploy hook once, as `/opt/caspira/deploy/production/scripts/tls-deploy-hook.sh` (mode 0750, owner root). It copies with explicit file names and reloads nginx without a restart:
   ```bash
   #!/usr/bin/env bash
   set -euo pipefail
   install -m 0444 "$RENEWED_LINEAGE/fullchain.pem" /etc/caspira/tls/production/fullchain.pem
   install -m 0440 -g 101 "$RENEWED_LINEAGE/privkey.pem" /etc/caspira/tls/production/privkey.pem
   /opt/caspira/deploy/production/dc production exec -T proxy nginx -s reload
   ```
5. Check the result:
   - `curl -vI https://api.<domain>/health 2>&1 | grep -E "SSL connection|expire"` should show TLS 1.2 or 1.3.
   - An external test (for example SSL Labs) should grade A.

## Renewal
- certbot's systemd timer renews automatically. Test it with `sudo certbot renew --dry-run`.
- The `certificate_expiry` alert (High) fires below 21 days left. Its value comes from the API's own TLS handshake with `PUBLIC_API_URL`.

## HSTS
Keep `HSTS_ENABLED=false` until HTTPS has worked for every subdomain for at least a week. Then set it to `true`, starting with a short `HSTS_MAX_AGE` such as 86400 and raising it later. **Never** add `preload` without a separate decision: it is very hard to undo.

## Expired certificate (incident)
1. Put the maintenance page up if browsers are failing.
2. Run `sudo certbot renew --force-renewal --cert-name crm.<domain>`. The hook reloads the proxy.
3. If ACME fails, check DNS, port 80 reachability and the rate limits. As a stopgap you can install a certificate from another CA into `TLS_CERT_DIR`.
