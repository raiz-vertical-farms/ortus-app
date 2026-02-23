import { Twilio } from "twilio";

const accountSid = "AC5b4c200f537972de749097d134328857";
const authToken = process.env.TWILIO_AUTH_TOKEN;

export const twilio = new Twilio(accountSid, authToken);
