import { Hono } from "hono";
import { validator as zValidator, resolver, describeRoute } from "hono-openapi";
import * as z from "zod";
import { db } from "../db";
import { hashPassword, verifyPassword } from "../utils/crypto";
import { generateToken } from "../utils/jwt";

const credentialsSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const authSuccessResponseSchema = z.object({
  success: z.literal(true),
  jwt: z.string(),
});

const authErrorResponseSchema = z.object({
  success: z.literal(false),
  error: z.string(),
});

const auth = new Hono()
  .post(
    "/login",
    describeRoute({
      summary: "Authenticate an existing user",
      tags: ["Auth"],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: resolver(credentialsSchema),
          },
        },
      },
      responses: {
        200: {
          description: "Successful login",
          content: {
            "application/json": {
              schema: resolver(authSuccessResponseSchema),
            },
          },
        },
        401: {
          description: "Invalid credentials",
          content: {
            "application/json": {
              schema: resolver(authErrorResponseSchema),
            },
          },
        },
      },
    }),
    zValidator("json", credentialsSchema),
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
    describeRoute({
      summary: "Register a new user",
      tags: ["Auth"],
      requestBody: {
        required: true,
        content: {
          "application/json": {
            schema: resolver(credentialsSchema),
          },
        },
      },
      responses: {
        200: {
          description: "User created or already existed with matching password",
          content: {
            "application/json": {
              schema: resolver(authSuccessResponseSchema),
            },
          },
        },
        400: {
          description: "User already exists with a different password",
          content: {
            "application/json": {
              schema: resolver(authErrorResponseSchema),
            },
          },
        },
      },
    }),
    zValidator("json", credentialsSchema),
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
