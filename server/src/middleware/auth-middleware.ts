import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { getAuth } from "@hono/clerk-auth";

export type User = {
  id: string;
  email: string;
};

export type AuthEnv = {
  Variables: {
    user: User;
  };
};

export const authMiddleware = createMiddleware<AuthEnv>(async (c, next) => {
  const auth = getAuth(c);
  const client = c.get("clerk");

  if (!auth?.userId) {
    throw new HTTPException(401, {
      res: c.json({ message: "Unauthorized" }, 401),
    });
  }

  // Fetch the user directly from Clerk
  let clerkUser;
  try {
    clerkUser = await client.users.getUser(auth.userId);
  } catch {
    throw new HTTPException(401, {
      res: c.json({ message: "Invalid Clerk user" }, 401),
    });
  }

  const email = clerkUser.emailAddresses?.[0]?.emailAddress || "";

  c.set("user", {
    id: clerkUser.id,
    email,
  });

  await next();
});
