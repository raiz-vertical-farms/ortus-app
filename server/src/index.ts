import { Hono } from "hono";
import * as z from "zod";
import { cors } from "hono/cors";
import { zValidator } from "@hono/zod-validator";
import { serve } from "@hono/node-server";
import "dotenv/config";
import { db } from "./db";
import { hashPassword, verifyPassword } from "./utils/crypto";
import { generateToken } from "./utils/jwt";

console.log("Starting Hono server...");

const app = new Hono();

app.use(
  "*",
  cors({
    origin: "*", // or restrict to specific domain e.g. "http://localhost:5173"
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

const routes = app
  .post(
    "/api/signup",
    zValidator(
      "json",
      z.object({
        email: z.string().email("Invalid email address"),
        password: z.string().min(6, "Password must be at least 6 characters"),
      })
    ),
    async (c) => {
      const { email, password } = c.req.valid("json");
      // Here you would normally handle user registration logic

      const existingUser = await db
        .selectFrom("users")
        .selectAll()
        .where("email", "=", email)
        .executeTakeFirst();

      if (existingUser) {
        const passwordMatch = verifyPassword(
          password,
          existingUser.password_hash,
          existingUser.password_salt
        );

        if (passwordMatch) {
          return c.json({ success: true, jwt: generateToken({ email }) });
        }

        return c.json({ error: "User already exists", success: false }, 400);
      }

      const { hash, salt } = hashPassword(password);

      const now = new Date().toISOString();

      await db.transaction().execute(async (trx) => {
        const user = await trx
          .insertInto("users")
          .values({
            email,
            name: "No name",
            password_hash: hash,
            password_salt: salt,
            created_at: now,
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();

        const org = await trx
          .insertInto("organizations")
          .values({
            name: `${email}'s Organization`,
            created_at: now,
          })
          .returning(["id"])
          .executeTakeFirstOrThrow();

        await trx
          .insertInto("user_organization_memberships")
          .values({
            user_id: user.id!,
            organization_id: org.id!,
            role: "admin",
            created_at: now,
          })
          .execute();
      });

      return c.json({ success: true, jwt: generateToken({ email }) });
    }
  )
  .post(
    "/api/login",
    zValidator(
      "json",
      z.object({
        email: z.string().email("Invalid email address"),
        password: z.string().min(6, "Password must be at least 6 characters"),
      })
    ),
    async (c) => {
      const { email, password } = c.req.valid("json");

      const user = await db
        .selectFrom("users")
        .selectAll()
        .where("email", "=", email)
        .executeTakeFirst();

      if (!user) {
        return c.json(
          { success: false, error: "Invalid email or password" },
          401
        );
      }

      const isPasswordValid = verifyPassword(
        password,
        user.password_hash,
        user.password_salt
      );

      if (!isPasswordValid) {
        return c.json(
          { success: false, error: "Invalid email or password" },
          401
        );
      }

      return c.json({ success: true, jwt: generateToken({ email }) });
    }
  )
  .post(
    "/api/device/create",
    zValidator(
      "json",
      z.object({
        name: z.string().min(1),
        organization_id: z.number(),
      })
    ),
    async (c) => {
      const { name, organization_id } = c.req.valid("json");
      const now = new Date().toISOString();

      const device = await db
        .insertInto("devices")
        .values({
          name,
          organization_id,
          created_at: now,
        })
        .returning(["id", "name", "organization_id"])
        .executeTakeFirstOrThrow();

      return c.json({ success: true, device });
    }
  )
  .post(
    "/api/plant/create",
    zValidator(
      "json",
      z.object({
        device_id: z.number(),
        plant_type_id: z.number(),
        location: z.string().min(1),
      })
    ),
    async (c) => {
      const { device_id, plant_type_id, location } = c.req.valid("json");
      const now = new Date().toISOString();

      const plant = await db
        .insertInto("plants")
        .values({
          device_id,
          plant_type_id,
          location,
          created_at: now,
        })
        .returning(["id", "device_id", "plant_type_id", "location"])
        .executeTakeFirstOrThrow();

      return c.json({ success: true, plant });
    }
  );

export type AppType = typeof routes;

if (process.env.NODE_ENV !== "production") {
  serve({ fetch: app.fetch, port: 3000 });
}

export default app;

export const config = {
  runtime: "nodejs20",
};
