# 20 — Declare and close a disaster

**Who:** DR Coordinator or System Owner declares; the incident owner runs the incident. **Where:** Platform UI (*Disaster recovery*).

## Declare
1. *Disaster recovery → Incidents → Declare.* Choose the matching plan (20 scenarios). Examples:
   - `server_loss`
   - `postgres_corruption`
   - `destructive_migration`
   - `bulk_deletion`
   - `ransomware`
   - `admin_credentials_compromised`
   - `backup_storage_outage`
   - `regional_outage`

   Give a title, a severity and a summary. The action needs password confirmation and is audited.
2. The plan shows:
   - detection;
   - containment steps;
   - evidence to collect;
   - recovery steps, with runbook links;
   - backup requirements;
   - communication cadence;
   - the RPO and RTO planning targets;
   - validation and return criteria.

## Run it
Move the incident through the states. Each transition is authorized and audited, and states can't be skipped:

**Incident Declared → Containment → Recovery → Validation → Service Restored → Post-Incident Review → Closed**

- Record actions on the incident as you go: who, what and when.
- Collect evidence **before** destructive recovery steps ([runbook 22](22-incident-evidence.md)).
- Communicate on the plan's cadence.

## Close
- **Service Restored:** only when [runbook 21](21-return-to-service.md) passes.
- **Closed:** requires a post-incident review of at least 20 characters, covering:
  - the timeline;
  - the root cause;
  - what detection missed;
  - actions with owners and dates;
  - the measured RPO and RTO against the targets.
- Open findings from the incident stay open until they are fixed or formally accepted.

## Drills
Schedule DR drills (*Disaster recovery → Drills*). A drill result must be signed by someone other than the person who ran it. Never drill against production.
