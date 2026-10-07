# Rollback Readiness

No deployment has occurred, so nothing was rolled back. This document defines the
procedure to be followed **if** a release goes wrong, and records what is and is
not currently possible.

> Destructive rollback tests against production data are explicitly **not**
> performed here.

## What makes a rollback identifiable

| Requirement | State |
| --- | --- |
| Previous application version identifiable | **BLOCKED** — not a git repository, and no build is version-stamped |
| Previous release artifact retained | **BLOCKED** — no artifact store configured |
| Deployment platform rollback | **BLOCKED** — no platform configured |

Until the repository is under version control and releases are published to an
artifact registry, "roll back to the previous version" is not possible. This is
the single most important thing to fix before the first deployment.

### Required first

1. Initialise version control and commit the tree.
2. Tag every release (`v1.0.0`, `v1.0.1`, …) and deploy by immutable tag/image
   digest — never by a moving branch.
3. Retain the previous N image digests (N ≥ 3). Deleting them removes your
   ability to roll back.
4. Record the currently-deployed digest in the release notes.

## Application rollback

**Backend**

```bash
# Redeploy the previously recorded image digest / git tag, then:
curl -fsS https://api.<domain>/api/v1/health          # expect 200
curl -fsS https://api.<domain>/api/v1/health/database # expect 200
```

**Frontend**

```bash
# Redeploy the previous tag, then confirm the domain guard is satisfied and:
curl -fsS https://<domain>/robots.txt   # Host: https://<domain>
```

A rollback that leaves `NEXT_PUBLIC_SITE_URL` unset will **refuse to start** —
that guard is intentional and must be supplied.

**Workers**: redeploy the previous worker and scheduler images together with the
API so queue payloads stay compatible. Workers lease jobs with expiry, so an
in-flight job from a previous version is recovered automatically rather than
lost.

## Database rollback

Migrations are **forward-only**. There is no down-migration for any of the 23
files, and rolling the schema back under a running application is more dangerous
than rolling forward.

Recommended order:

1. Stop the worker and scheduler first — they write.
2. Roll back the application.
3. Only then consider schema changes.

For a bad migration, prefer **forward-fixing** with a new numbered migration
(024, 025, …) that corrects it. That keeps the applied-migration record honest.

### Recovery options, in order of preference

1. **Point-in-time recovery** — restore the Supabase project to a timestamp just
   before the bad migration. Preferred for data corruption.
2. **Forward fix** — add a corrective migration. Preferred for a logic bug.
3. **Full restore into a new project** — last resort; requires re-pointing the
   API and re-seeding external data.

> **Warning.** A PITR restore discards everything written after the restore
> point, including sync progress and editorial changes. Take a fresh backup and
> confirm the provider's external-ID mapping still lines up after any restore —
> re-importing against a restored database is the main corruption risk, which is
> exactly what `verify_canonical_data()` detects.

## Secrets and configuration

- Environment variables are **not** versioned. Keep them in the platform's
  secret store and export them before redeploying.
- Never put a service-role key or provider key in CI logs, image layers, or a
  `.env` committed to the repository.
- If a credential is ever suspected exposed: rotate it at the provider first,
  then redeploy. Rotation order matters — rotating after redeploy leaves a window
  where both keys are live.
- `npm run verify` re-scans source and the built browser bundle for credential
  material; run it as a deploy gate.

## Post-rollback verification

- [ ] `/api/v1/health` and `/api/v1/health/database` return 200
- [ ] `/admin/providers/health`, `/admin/workers/health`,
      `/admin/schedulers/health` report healthy
- [ ] Worker resumes claiming jobs; `sync_jobs` statuses advance
- [ ] Public routes render real data (not error boundaries)
- [ ] `/robots.txt` and `/sitemap.xml` resolve on the public domain
- [ ] Canonical URLs still point at the production domain
- [ ] `npm run verify -- --api … --site … --admin-token …` reports 0 blockers

## Data-integrity check after any restore

```sql
-- Confirm no duplicate canonical entities were re-imported.
SELECT public._step40_norm_name(name) AS k, count(*)
FROM public.teams GROUP BY 1 HAVING count(*) > 1;

-- Confirm no provider record maps to two canonical entities.
SELECT data_source_id, entity_type, external_id, count(DISTINCT entity_id)
FROM public.external_entity_ids
GROUP BY 1, 2, 3 HAVING count(DISTINCT entity_id) > 1;

-- Confirm no orphaned football rows.
SELECT 'matches_home_team' AS rel, count(*) FROM public.matches m
WHERE m.home_team_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.teams t WHERE t.id = m.home_team_id);
```

All three must return zero rows.

## Rollback decision guide

| Symptom | Action |
| --- | --- |
| 5xx spike after deploy | Roll back the application |
| Wrong or empty content | Roll back the application; check data before touching the DB |
| Duplicate entities appeared | Roll back worker+scheduler, stop writes, audit external-ID mappings |
| Live scores stale/wrong | Stop the worker, do **not** roll back the schema; verify provider health |
| Editor-only regression | Roll back the application; data is unaffected |
| Schema migration failed | Fix forward with a new migration; do not attempt a down-migration |
| Suspected credential leak | Rotate at the provider **first**, then redeploy |