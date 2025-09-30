import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { verifyToken } from "../utils/jwt";
import { db } from "../db";

export const authMiddleware = createMiddleware<{
  Variables: {
    user: {
      id: number;
      email: string;
      organizationIds: number[];
    };
  };
}>(async (c, next) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new HTTPException(401, {
      res: c.json({ message: "Missing token" }, 401),
    });
  }

  const token = authHeader.split(" ")[1];

  let payload: { email: string };
  try {
    payload = verifyToken(token) as { email: string };
  } catch {
    throw new HTTPException(401, {
      res: c.json({ message: "Invalid token" }, 401),
    });
  }

  const user = await db
    .selectFrom("users")
    .selectAll()
    .where("email", "=", payload.email)
    .executeTakeFirst();

  if (!user) {
    throw new HTTPException(401, {
      res: c.json({ message: "User not found" }, 401),
    });
  }

  await next();
});
