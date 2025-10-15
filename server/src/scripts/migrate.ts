// migrate.ts
import "dotenv/config";
import fs from "fs";
import path from "path";
import { createClient } from "@libsql/client";

const MIGRATIONS_TABLE = "_migrations";

async function runMigrations(
  dbUrl: string,
  migrationsDir: string,
  authToken?: string
) {
  const client = createClient({ url: dbUrl, authToken });

  // ensure migrations table exists
  await client.execute(`
    CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      run_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // get already run migrations
  const appliedMigrations = (
    await client.execute(
      `SELECT name FROM ${MIGRATIONS_TABLE} ORDER BY name ASC`
    )
  ).rows.map((row: any) => row.name as string);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (appliedMigrations.includes(file)) {
      console.log(`Skipping already applied migration: ${file}`);
      continue;
    }

    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, "utf8");

    // naive split on semicolon, filter out blanks/comments
    const statements = sql
      .split(/;\s*$/m) // split on semicolon at line end
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    console.log(`Applying migration: ${file}`);

    const tx = await client.transaction();
    try {
      for (const stmt of statements) {
        try {
          await tx.execute(stmt);
        } catch (err: any) {
          console.error(`❌ Error executing statement in ${file}:\n${stmt}\n`);
          console.error("SQLite error:", err.message);
          throw err;
        }
      }
      await tx.execute({
        sql: `INSERT INTO ${MIGRATIONS_TABLE} (name) VALUES (?)`,
        args: [file],
      });
      await tx.commit();
    } catch (err) {
      await tx.rollback();
      throw err;
    }
  }

  console.log("✅ All migrations applied");
}

// CLI usage
const [, , dbPathOrUrl, migrationsDir] = process.argv;
if (!dbPathOrUrl || !migrationsDir) {
  console.error("Usage: tsx migrate.ts <db.sqlite|url> <migrationsDir>");
  process.exit(1);
}

runMigrations(
  process.env.NODE_ENV == "production"
    ? process.env.TURSO_DB_URL!
    : `file:${dbPathOrUrl}`,
  migrationsDir,
  process.env.TURSO_DB_TOKEN
).catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
