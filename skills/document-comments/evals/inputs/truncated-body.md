# Rollout notes

We will <!--c:r7t2-->ship the migration on Friday<!--/c:r7t2--> after the freeze lifts.
<!--co:r7t2 by:alice at:2026-08-28T15:00:00.000Z status:open quote:"ship the migration on Friday"
alice (2026-08-28T15:00:00.000Z): Friday is tight. The mapping is old_schema --> new_schema and the backfill alone is six hours.
alice (2026-08-28T15:02:00.000Z): If we slip to Monday nobody notices and we get a weekend of headroom.
bob (2026-08-28T16:10:00.000Z): Agreed on Monday. I'll update the calendar.
-->

The <!--c:k3m8-->rollback plan<!--/c:k3m8--> is the same as last quarter: restore the snapshot and replay the queue.
<!--co:k3m8 by:bob at:2026-08-28T16:12:00.000Z status:open quote:"rollback plan"
bob (2026-08-28T16:12:00.000Z): Last quarter's replay took forty minutes. Worth stating the expected downtime here.
-->
