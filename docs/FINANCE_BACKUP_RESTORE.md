# Backup and restore before Finance migrations

Backend Phase 6 adds the general ledger and changes the existing invoice,
payment, credit-note and expense tables. Take a backup **before** running
its migrations (`20260924170000_phase6_finance_full` and later), and
check that the backup restores.

Every command below runs in the **aaPanel terminal on the database VPS**
(`root@...#`, 202.61.87.220), not on your PC. Only the `caspira-dev-*` and
`caspira-prod-*` containers are involved. Never touch the `mjw-*` or
`mysql` containers.

## Development database (`caspira-dev-db`, database `caspira_crm_dev`)

Back up:

```bash
mkdir -p /root/backups
docker exec caspira-dev-db pg_dump -U caspira -Fc caspira_crm_dev > /root/backups/caspira-dev-$(date +%F-%H%M).dump
ls -lh /root/backups
```

Check that the file restores, into a throwaway database:

```bash
docker exec caspira-dev-db createdb -U caspira restore_check
docker exec -i caspira-dev-db pg_restore -U caspira -d restore_check --no-owner < /root/backups/caspira-dev-YYYY-MM-DD-HHMM.dump
docker exec caspira-dev-db psql -U caspira -d restore_check -c 'SELECT count(*) FROM invoices;'
docker exec caspira-dev-db dropdb -U caspira restore_check
```

Restore over the dev database. This **replaces** its contents, so stop the
local api and worker first:

```bash
docker exec caspira-dev-db dropdb -U caspira caspira_crm_dev
docker exec caspira-dev-db createdb -U caspira caspira_crm_dev
docker exec -i caspira-dev-db pg_restore -U caspira -d caspira_crm_dev --no-owner < /root/backups/caspira-dev-YYYY-MM-DD-HHMM.dump
```

## Production database (`caspira-prod-db`, database `caspira_crm`)

Same commands with the production names. Stop the api and worker before a
restore:

```bash
docker exec caspira-prod-db pg_dump -U caspira -Fc caspira_crm > /root/backups/caspira-prod-$(date +%F-%H%M).dump

cd /opt/caspira-crm/deploy/vps-prod && docker compose stop api worker
docker exec caspira-prod-db dropdb -U caspira caspira_crm
docker exec caspira-prod-db createdb -U caspira caspira_crm
docker exec -i caspira-prod-db pg_restore -U caspira -d caspira_crm --no-owner < /root/backups/caspira-prod-YYYY-MM-DD-HHMM.dump
docker compose start api worker
```

Replace `YYYY-MM-DD-HHMM` with the backup file's actual name, as `ls`
shows it. Keep backups off the server too: download them from aaPanel's
file manager.

## What the Phase 6 migration does to existing rows

- **Invoices** keep their figures. Their JSON lines are copied into `invoice_lines`. They have no journal, so the posted-journal reports don't include them.
- **Payments** become `Legacy Recorded` and get a matching allocation to their invoice.
- **Credit notes** become `Legacy Recorded` and count as fully applied.
- **Expenses** get `amountBeforeTax` and `baseAmount` set from `amount`.

Nothing is deleted.
