# 16 — Rotate encryption keys

**Who:** Security Admin, with password confirmation. **Where:** host shell and Platform UI.

## Credential-vault keyring (`integrations_keys`)
The keyring holds versioned keys (`1:<key>,2:<key>`). The newest version encrypts new data; every listed version can still decrypt.

1. **Create:** append a new version to the keyring file and keep the old one. Edit the file with `sudoedit` so the value is never echoed. The key is 32 random bytes, base64-encoded.
2. **Accept both:** restart the api and worker:
   ```bash
   docker compose --env-file env/production.env up -d --wait api worker
   ```
3. **Re-encrypt:** in *Platform → Security → Secrets → integrations_keys*, choose **Advance rotation** to the *re-encrypt* step. The API rewraps every stored credential to the new version and reports how many rows still use each version.
4. **Verify:** check that the usage for the old version is 0, and that an integration's **Test connection** succeeds.
5. **Revoke old:** remove the old version from the keyring, then restart. The API refuses this step while any row still uses the old version.

## Backup repository passphrase (`backup_repo_cipher_pass`)
pgBackRest can't re-encrypt an existing repository. Rotating the passphrase therefore means starting a **new repository**:
1. Create a new passphrase and **escrow it**.
2. Configure a new repository path (for example repo1 at `/var/lib/pgbackrest-2`, or a new bucket prefix for repo2).
3. Run `stanza-create`, then a full backup, then verify it (runbook 13).
4. Keep the old repository **and its passphrase** until its retention window has passed, then delete that repository by its explicit path.

## GPG passphrase (`backup_logical_passphrase`)
New logical and configuration backups use the new passphrase. Keep the old passphrase in escrow until the last backup encrypted with it has expired.

## TLS private key
Reissue the certificate with a new key ([runbook 04](04-tls-certificates.md), `certbot renew --force-renewal --reuse-key=false`).
