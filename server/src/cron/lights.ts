import { Cron } from "croner";

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

  const { hour: onHour, minute: onMinute } = getUTCHourMinute(
    schedule.onTimestamp
  );
  const { hour: offHour, minute: offMinute } = getUTCHourMinute(
    schedule.offTimestamp
  );

  // Run every day at those UTC times
  const onJob = new Cron(
    `${onMinute} ${onHour} * * *`,
    { timezone: "UTC" },
    () => {
      console.log(`[${macAddress}] Light ON at ${onHour}:${onMinute} UTC`);
      // your light on logic here
    }
  );

  const offJob = new Cron(
    `${offMinute} ${offHour} * * *`,
    { timezone: "UTC" },
    () => {
      console.log(`[${macAddress}] Light OFF at ${offHour}:${offMinute} UTC`);
      // your light off logic here
    }
  );

  lightSchedules.set(macAddress, [onJob, offJob]);
}

export function deactivateLightSchedule(macAddress: string) {
  lightSchedules.get(macAddress)?.forEach((cron) => cron.pause());
  lightSchedules.delete(macAddress);
}

export function reactivateLightSchedule(macAddress: string) {
  lightSchedules.get(macAddress)?.forEach((cron) => cron.resume());
}

export function removeLightSchedule(macAddress: string) {
  const schedules = lightSchedules.get(macAddress);
  if (schedules?.length) {
    schedules.forEach((cron) => cron.stop());
    lightSchedules.delete(macAddress);
  }
}
