# NovaPulse sports refresh schedule

The refresh function is intentionally not scheduled by this change. After a
controlled deployment, configure a single Supabase Cron job at 15-minute
intervals using `pg_cron` and `pg_net`, with the refresh authorization secret
stored in Vault. The job must call only `novapulse-sports-refresh` and use the
server-side project URL and secret; neither value belongs in the TV bundle.

The function itself enforces a database-backed ten-minute crash-recovery lease
and a two-minute database cooldown. A concurrent invocation returns the
sanitized `refresh_in_progress` result before creating the upstream adapter,
while a non-overlapping invocation inside the cooldown returns
`refresh_cooldown`. Neither path consumes provider requests. The cooldown is
recorded at acquisition time and survives release, upstream failure, and
worker termination.

The six configured leagues use one sequential upcoming request and one
sequential recent request each: 12 requests per run. A two-minute minimum
start interval keeps scheduled and manual invocations below TheSportsDB's
30-requests-per-minute free-tier limit; the intended 15-minute schedule is
therefore unaffected.

Every acquisition receives a database-generated owner token. Release matches
both the fixed singleton lease key and that token, so an expired invocation
cannot clear a newer owner's lease.

Before enabling the job, verify the deployed function URL, Vault secret name,
and current server secret through the normal Supabase release process. Do not
put a literal secret in this document or in a migration.
