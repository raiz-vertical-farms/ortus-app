import { Hono } from "hono";
import { db } from "../db";
import { twilio } from "../services/twilio";

const app = new Hono();

// twilio calls this endpoint when a user sends a message to the whatsapp bot
// the body contains "From" (their phone number) and "Body" (the message text = otp)
app.post("/whatsapp", async (c) => {
  const body = await c.req.parseBody();
  const from = body["From"] as string; // e.g. "whatsapp:+447911123456"
  const otp = ((body["Body"] as string) ?? "").trim();

  // look up a matching otp that hasn't expired yet
  const record = await db
    .selectFrom("whatsapp_otps")
    .selectAll()
    .where("otp", "=", otp)
    .where("expires_at", ">", Math.floor(Date.now() / 1000))
    .executeTakeFirst();

  if (!record) {
    // otp is invalid or expired — reply to the user in whatsapp
    return c.text(
      `<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>Invalid or expired code. Please generate a new one in the app.</Message></Response>`,
      200,
      { "Content-Type": "text/xml" }
    );
  }

  // strip the "whatsapp:" prefix twilio adds to the phone number
  const phone = from.replace("whatsapp:", "");

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

  // reply to confirm the connection was successful
  return c.text(
    `<?xml version="1.0" encoding="UTF-8"?>
<Response><Message>Your Ortus account is now connected! You'll receive alerts here when your plant needs attention.</Message></Response>`,
    200,
    { "Content-Type": "text/xml" }
  );
});

export default app;
