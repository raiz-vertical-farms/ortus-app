import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import * as z from "zod";
import { db } from "../db";
import { hashPassword, verifyPassword } from "../utils/crypto";
import { generateToken } from "../utils/jwt";

const auth = new Hono()
  .post(
    "/login",
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
    "/signup",
    zValidator(
      "json",
      z.object({
        email: z.string().email("Invalid email address"),
        password: z.string().min(6, "Password must be at least 6 characters"),
      })
    ),
    async (c) => {
      const { email, password } = c.req.valid("json");

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
  );

export default auth;
