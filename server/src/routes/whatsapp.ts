import { Hono } from "hono";
import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import { z } from "zod";
import { db } from "../db";
import { authMiddleware } from "../middleware/auth-middleware";

// shape of the response when generating an otp
const connectResponseSchema = z.object({
  otp: z.string(),
  deeplink: z.string(),
});

// shape of the response when checking if whatsapp is connected
const statusResponseSchema = z.object({
  connected: z.boolean(),
  phone_number: z.string().nullable(),
});

// the twilio sandbox whatsapp number — override via env in production
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER ?? "+14155238886";

// otp expires after 10 minutes
const OTP_TTL_SECONDS = 10 * 60;

// generates a random 6-digit numeric otp
function generateOtp(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

const app = new Hono();

app
  // all routes here require the user to be logged in
  .use("*", authMiddleware)
  .post(
    "/connect",
    describeRoute({
      operationId: "connectWhatsapp",
      summary: "Generate an OTP to connect WhatsApp",
      tags: ["WhatsApp"],
      responses: {
        200: {
          description: "OTP generated",
          content: {
            "application/json": {
              schema: resolver(connectResponseSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      const user = c.get("user");

      // generate a fresh otp and calculate when it expires
      const otp = generateOtp();
      const expiresAt = Math.floor(Date.now() / 1000) + OTP_TTL_SECONDS;

      // remove any old unused otps for this user before inserting a new one
      await db.deleteFrom("whatsapp_otps").where("user_id", "=", user.id).execute();

      // store the otp in the db so we can validate it when twilio sends the webhook
      await db.insertInto("whatsapp_otps").values({
        user_id: user.id,
        otp,
        expires_at: expiresAt,
      }).execute();

      // build a whatsapp deep link that opens the chat and pre-fills the otp as the message
      const deeplink = `https://wa.me/${TWILIO_WHATSAPP_NUMBER.replace("+", "")}?text=${otp}`;

      return c.json({ otp, deeplink });
    }
  )
  .get(
    "/status",
    describeRoute({
      operationId: "whatsappStatus",
      summary: "Check if the user has connected WhatsApp",
      tags: ["WhatsApp"],
      responses: {
        200: {
          description: "WhatsApp connection status",
          content: {
            "application/json": {
              schema: resolver(statusResponseSchema),
            },
          },
        },
      },
    }),
    async (c) => {
      const user = c.get("user");

      // check if there is a phone number saved for this user
      const record = await db
        .selectFrom("user_whatsapp")
        .select("phone_number")
        .where("user_id", "=", user.id)
        .executeTakeFirst();

      return c.json({
        connected: !!record,
        phone_number: record?.phone_number ?? null,
      });
    }
  );

export default app;
