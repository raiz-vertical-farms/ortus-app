import { Cron } from "croner";
import { mqttClient } from "../services/mqtt";

const lightSchedules = new Map<string, Cron[]>();

type LightSchedule = {
  onTimestamp: number; // UTC timestamp in ms
  offTimestamp: number; // UTC timestamp in ms
};

function getUTCHourMinute(timestamp: number) {
  const date = new Date(timestamp);
  return {
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
  };
}

export function setLightSchedule(macAddress: string, schedule: LightSchedule) {
  removeLightSchedule(macAddress);

  const now = Date.now();
  const { hour: onHour, minute: onMinute } = getUTCHourMinute(
    schedule.onTimestamp
  );
  const { hour: offHour, minute: offMinute } = getUTCHourMinute(
    schedule.offTimestamp
  );

  // Create Cron jobs
  const onJob = new Cron(
    `${onMinute} ${onHour} * * *`,
    { timezone: "UTC" },
    () => {
      console.log(`[${macAddress}] Light ON at ${onHour}:${onMinute} UTC`);
      mqttClient.publish(
        `${macAddress}/sensor/light/brightness/command`,
        "100"
      );
    }
  );

  const offJob = new Cron(
    `${offMinute} ${offHour} * * *`,
    { timezone: "UTC" },
    () => {
      console.log(`[${macAddress}] Light OFF at ${offHour}:${offMinute} UTC`);
      mqttClient.publish(`${macAddress}/sensor/light/brightness/command`, "0");
    }
  );

  lightSchedules.set(macAddress, [onJob, offJob]);

  // Check if we are currently within the ON interval ---
  const onTime = schedule.onTimestamp;
  const offTime = schedule.offTimestamp;

  // Handle schedules that cross midnight (e.g., on 22:00, off 06:00)
  const isWithinSchedule =
    onTime < offTime
      ? now >= onTime && now < offTime
      : now >= onTime || now < offTime;

  if (isWithinSchedule) {
    console.log(`[${macAddress}] Currently within schedule — turning ON now.`);
    mqttClient.publish(`${macAddress}/sensor/light/brightness/command`, "100");
  } else {
    console.log(`[${macAddress}] Currently outside schedule — ensuring OFF.`);
    mqttClient.publish(`${macAddress}/sensor/light/brightness/command`, "0");
  }
}

export function removeLightSchedule(macAddress: string) {
  const schedules = lightSchedules.get(macAddress);
  if (schedules?.length) {
    schedules.forEach((cron) => cron.stop());
    lightSchedules.delete(macAddress);
  }
}
