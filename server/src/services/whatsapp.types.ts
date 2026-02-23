// schemas/whatsapp.ts
import { z } from "zod";

const TextMessageSchema = z.object({
  body: z.string(),
});

const ImageMessageSchema = z.object({
  id: z.string(),
});

const ButtonMessageSchema = z.object({
  text: z.string(),
  payload: z.string(),
});

const MessageSchema = z.object({
  from: z.string(),
  id: z.string(),
  timestamp: z.string(),
  type: z.string(),
  text: TextMessageSchema.optional(),
  image: ImageMessageSchema.optional(),
  button: ButtonMessageSchema.optional(),
});

const ContactSchema = z.object({
  profile: z.object({
    name: z.string(),
  }),
  wa_id: z.string(),
});

const MetadataSchema = z.object({
  display_phone_number: z.string(),
  phone_number_id: z.string(),
});

const ValueSchema = z.object({
  messaging_product: z.literal("whatsapp"),
  metadata: MetadataSchema,
  contacts: z.array(ContactSchema).optional(),
  messages: z.array(MessageSchema).optional(),
  statuses: z.array(z.any()).optional(), // Add a schema if you need strict typing
});

const ChangeSchema = z.object({
  value: ValueSchema,
  field: z.string(),
});

const EntrySchema = z.object({
  id: z.string(),
  changes: z.array(ChangeSchema),
});

export const WhatsAppWebhookSchema = z.object({
  object: z.literal("whatsapp_business_account"),
  entry: z.array(EntrySchema),
});

export type WhatsAppWebhook = z.infer<typeof WhatsAppWebhookSchema>;
