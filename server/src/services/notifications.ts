import { sendWhatsAppTextMessage } from "./whatsapp";

export function triggerNotificationIfNeeded(
  mac: string,
  metric: string,
  valueStr: string
) {
  // Example logic: trigger notification if soil moisture is below a threshold
  if (metric === "soil_moisture") {
    const moistureValue = parseFloat(valueStr);
    if (moistureValue < 20) {
      sendWhatsAppTextMessage({
        to: "+1234567890", // Replace with the user's phone number
        body: `Alert: Soil moisture for device ${mac} is low (${moistureValue}%). Please check your plant!`,
        previewUrl: false,
      }).catch((error) => {
        console.error("Failed to send WhatsApp notification:", error);
      });
    }
  }
}
