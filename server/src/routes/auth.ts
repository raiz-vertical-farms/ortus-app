import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
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
  jwt: z.string(),
});

const authErrorResponseSchema = z.object({
  message: z.string(),
});

const auth = new Hono()
  .post(
    "/login",
    describeRoute({
      operationId: "login",
      summary: "Authenticate an existing user",
      tags: ["Auth"],
      responses: {
        200: {
          description: "Successful login",
          content: {
            "application/json": {
              schema: resolver(authSuccessResponseSchema),
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
        throw new HTTPException(401, {
          res: c.json({ message: "Invalid email or password" }, 401),
        });
      }

      const isPasswordValid = verifyPassword(
        password,
        user.password_hash,
        user.password_salt
      );

      if (!isPasswordValid) {
        throw new HTTPException(401, {
          res: c.json({ message: "Invalid email or password" }, 401),
        });
      }

      return c.json({ jwt: generateToken({ email }) });
    }
  )
  .post(
    "/signup",
    describeRoute({
      operationId: "signup",
      summary: "Register a new user",
      tags: ["Auth"],
      responses: {
        200: {
          description: "User created or already existed with matching password",
          content: {
            "application/json": {
              schema: resolver(authSuccessResponseSchema),
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
          return c.json({ jwt: generateToken({ email }) });
        }

        throw new HTTPException(400, {
          res: c.json({ message: "Wrong password." }, 400),
        });
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

      return c.json({ jwt: generateToken({ email }) });
    }
  );

export default auth;
