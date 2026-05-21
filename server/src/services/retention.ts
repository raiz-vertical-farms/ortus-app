import { Cron } from "croner";
import { db } from "../db";

const RETENTION_DAYS = Number(process.env.RETENTION_DAYS ?? 30);

async function prune() {
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const stateRes = await db
    .deleteFrom("device_state_history")
    .where("recorded_at", "<", cutoff)
    .executeTakeFirst();
  const logRes = await db
    .deleteFrom("device_logs")
    .where("recorded_at", "<", cutoff)
    .executeTakeFirst();
  console.log(
    `[Retention] pruned ${Number(stateRes.numDeletedRows ?? 0)} state rows, ${Number(logRes.numDeletedRows ?? 0)} log rows (cutoff=${RETENTION_DAYS}d)`
  );
}

// Daily at 03:17 to avoid the top-of-hour stampede.
new Cron("17 3 * * *", { name: "retention-prune" }, () => {
  prune().catch((err) => console.error("[Retention] prune failed:", err));
});

// Run once on startup so a long-stopped server cleans up immediately.
prune().catch((err) => console.error("[Retention] initial prune failed:", err));
