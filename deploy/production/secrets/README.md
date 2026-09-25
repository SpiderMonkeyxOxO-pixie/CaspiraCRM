# Production and staging secrets (host only — never committed)

Each environment has its **own** directory and its **own** values:

```
deploy/production/secrets/
  production/   owner root, group SECRETS_GID (1500), mode 0750
    jwt_secret                       0440  ≥ 48 random bytes, base64
    jwt_secret_previous              0440  empty; holds the old JWT key only during a rotation (runbook 15)
    db_password                      0440  runtime role caspira_app
    db_migrator_password             0440  migration role caspira_owner
    db_readonly_password             0440  reporting role caspira_readonly
    db_monitor_password              0440  monitoring role caspira_monitor
    postgres_superuser_password      0440  superuser (socket-only; used at init)
    redis_password                   0440
    integrations_keys                0440  "1:<32 bytes base64>" credential-vault keyring
    ai_safety_id_secret              0440
    metrics_token                    0440
    platform_automation_token_pepper 0440
    smtp_password                    0440  from the email provider
    backup_repo_cipher_pass          0440  pgBackRest repo1 encryption passphrase
    backup_logical_passphrase        0440  GPG passphrase for logical and configuration backups
    backup_offsite_credentials       0440  key=… / secret=… / cipher=… for repo2 (write-only key where supported)
  staging/      same names, different values
```

Rules:
- Generate with `scripts/create-secrets.sh <environment>`; it creates only missing files and never prints values.
- **Escrow the backup keys separately** (`backup_repo_cipher_pass`, `backup_logical_passphrase`, off-site credentials) in the organization's password manager or HSM. Without them the backups can't be decrypted — and they must never be stored in the backup repository or the off-site bucket.
- Development credentials are never reused in staging or production, and staging never shares a value with production.
- Record every secret's metadata (not its value) in **Platform → Secrets**; rotate with runbooks 15 and 16.
- The containers read these files at `/run/secrets/<name>`; values never appear in environment variables, images, build arguments or logs.
