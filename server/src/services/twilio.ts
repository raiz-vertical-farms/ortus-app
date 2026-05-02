import Twilio from "twilio";

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;

// create the twilio client using our account credentials
export const twilio = Twilio(accountSid, authToken);
