// db.ts
import { Kysely, SqliteDialect, KyselyPlugin } from "kysely";
import SQLite from "better-sqlite3";
import { LibsqlDialect } from "@libsql/kysely-libsql";
import { DB } from "./types";

function createDb() {
  if (process.env.NODE_ENV == "production") {
    console.log("Using production database at:", process.env.TURSO_DB_URL);
    console.log("Using production database token:", process.env.TURSO_DB_TOKEN);

    return new Kysely<DB>({
      dialect: new LibsqlDialect({
        url: process.env.TURSO_DB_URL!,
        authToken: process.env.TURSO_DB_TOKEN,
      }),
    });
  } else {
    console.log("🛢 Using local SQLite database at: ./db.sqlite");
    return new Kysely<DB>({
      dialect: new SqliteDialect({
        database: new SQLite("./db.sqlite"),
      }),
    });
  }
}

export const db = createDb();
