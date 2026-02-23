import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { WhatsAppWebhookSchema } from "../services/whatsapp.types";

const app = new Hono();

app.get("/whatsapp", (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");

  if (!process.env.WHATSAPP_VERIFY_TOKEN) {
    throw new HTTPException(500, { message: "Missing verify token" });
  }

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return c.text(challenge ?? "");
  }

  throw new HTTPException(403, { message: "Forbidden" });
});

app.post("/whatsapp", async (c) => {
  try {
    const json = await c.req.json();

    const webhook = WhatsAppWebhookSchema.parse(json);

    const entry = webhook.entry[0];
    const change = entry.changes[0];
    const value = change.value;

    if (value.messages) {
      for (const msg of value.messages) {
        switch (msg.type) {
          case "text":
            console.log(`Text from ${msg.from}: ${msg.text?.body}`);
            break;

          case "image":
            console.log(`Image from ${msg.from}, ID=${msg.image?.id}`);
            break;

          case "button":
            console.log(
              `Button from ${msg.from}: ${msg.button?.text} (${msg.button?.payload})`
            );
            break;

          default:
            console.log("Unhandled message type:", msg.type);
        }
      }
    }

    if (value.statuses) {
      console.log("Statuses:", value.statuses);
    }

    return c.json({ status: "ok" });
  } catch (err) {
    console.error("Invalid webhook payload:", err);

    // Return 200 so WhatsApp doesn't retry
    return c.json({ status: "ignored" }, 200);
  }
});

export default app;
