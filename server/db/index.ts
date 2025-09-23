// db.ts
import { Kysely, SqliteDialect } from "kysely";
import SQLite from "better-sqlite3";
import { LibsqlDialect } from "@libsql/kysely-libsql";
import { DB } from "./types";

function createDb() {
  if (process.env.NODE_ENV == "production") {
    return new Kysely<DB>({
      dialect: new LibsqlDialect({
        url: process.env.TURSO_DB_URL!,
        authToken: process.env.TURSO_DB_TOKEN,
      }),
    });
  } else {
    return new Kysely<DB>({
      dialect: new SqliteDialect({
        database: new SQLite("./db.sqlite"),
      }),
    });
  }
}

export const db = createDb();
