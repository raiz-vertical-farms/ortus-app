import { Hono } from "hono";
import Twilio from "twilio";
import { z } from "zod";
import { db } from "../db";

const app = new Hono();

// twilio sends "From" (whatsapp:+E164) and "Body" (the otp) as application/x-www-form-urlencoded
const twilioWebhookSchema = z.object({
  From: z.string().regex(/^whatsapp:\+\d{6,15}$/),
  Body: z.string().min(1).max(160),
});

// twilio signs every request with HMAC-SHA1 of (url + sorted params) using our auth token.
// without this check, anyone hitting /webhooks/whatsapp with valid-looking data could write to our DB.
function verifyTwilioSignature(
  signature: string | undefined,
  url: string,
  params: Record<string, string>
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken || !signature) return false;
  return Twilio.validateRequest(authToken, signature, url, params);
}

// twilio calls this endpoint when a user sends a message to the whatsapp bot
app.post("/whatsapp", async (c) => {
  const rawBody = await c.req.parseBody();

  // twilio always sends string fields; coerce so zod gets a clean shape
  const stringParams: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawBody)) {
    if (typeof v === "string") stringParams[k] = v;
  }

  // verify the signature against the exact url + params twilio signed.
  // TWILIO_WEBHOOK_URL lets us override when behind a proxy that rewrites the host/scheme.
  const signedUrl = process.env.TWILIO_WEBHOOK_URL ?? c.req.url;
  if (!verifyTwilioSignature(c.req.header("x-twilio-signature"), signedUrl, stringParams)) {
    return c.text("Invalid signature", 403);
  }

  const parsed = twilioWebhookSchema.safeParse(stringParams);
  if (!parsed.success) {
    return c.text("Invalid payload", 400);
  }
  const { From, Body } = parsed.data;
  const otp = Body.trim();

  // look up a matching otp that hasn't expired yet
  const record = await db
    .selectFrom("whatsapp_otps")
    .selectAll()
    .where("otp", "=", otp)
    .where("expires_at", ">", Math.floor(Date.now() / 1000))
    .executeTakeFirst();

  if (!record) {
    return c.text(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>Invalid or expired code. Please generate a new one in the app.</Message></Response>`,
      200,
      { "Content-Type": "text/xml" }
    );
  }

  // strip the "whatsapp:" prefix twilio adds to the phone number
  const phone = From.replace("whatsapp:", "");

  // save the phone number linked to this user, overwriting any existing entry
  await db
    .insertInto("user_whatsapp")
    .values({ user_id: record.user_id, phone_number: phone })
    .onConflict((oc) =>
      oc.column("user_id").doUpdateSet({ phone_number: phone })
    )
    .execute();

  // delete the used otp so it can't be reused
  await db.deleteFrom("whatsapp_otps").where("id", "=", record.id).execute();

  return c.text(
    `<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>Your Ortus account is now connected! You'll receive alerts here when your plant needs attention.</Message></Response>`,
    200,
    { "Content-Type": "text/xml" }
  );
});

export default app;
