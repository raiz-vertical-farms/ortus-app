// sendWhatsappMessage.ts
export interface SendWhatsAppTextParams {
  to: string; // recipient user phone number
  body: string; // message text
  previewUrl?: boolean; // enable/disable link preview
}

export async function sendWhatsAppTextMessage({
  to,
  body,
  previewUrl = false,
}: SendWhatsAppTextParams) {
  const API_VERSION = process.env.WHATSAPP_API_VERSION;
  const PHONE_NUMBER_ID = process.env.WHATSAPP_BUSINESS_PHONE_NUMBER_ID;
  const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN;

  if (!API_VERSION || !PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    throw new Error("Missing required WhatsApp env variables.");
  }

  const url = `https://graph.facebook.com/${API_VERSION}/${PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: "text",
    text: {
      preview_url: previewUrl,
      body,
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ACCESS_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`WhatsApp API error: ${response.status} - ${errorText}`);
  }

  return response.json();
}
