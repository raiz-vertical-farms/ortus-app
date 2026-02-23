import { Cron } from "croner";
import { mqttClient } from "../services/mqtt";

const pumpSchedules = new Map<string, Cron[]>();

type PumpSchedule = {
  startTime: number; // UTC timestamp in milliseconds
  timesPerDay: number; // how many times per day
};

export function setPumpSchedule(macAddress: string, schedule: PumpSchedule) {
  removePumpSchedule(macAddress);

  if (schedule.timesPerDay <= 0) {
    throw new Error("timesPerDay must be greater than zero");
  }

  const jobs: Cron[] = [];
  const intervalMs = Math.floor((24 * 60 * 60 * 1000) / schedule.timesPerDay);

  for (let i = 0; i < schedule.timesPerDay; i += 1) {
    const runTimestamp = schedule.startTime + i * intervalMs;
    const runDate = new Date(runTimestamp);
    const hour = runDate.getUTCHours();
    const minute = runDate.getUTCMinutes();

    const job = new Cron(`${minute} ${hour} * * *`, { timezone: "UTC" }, () => {
      console.log(
        `[${macAddress}] Pump activation triggered at ${hour}:${minute} UTC`
      );
      
      const payload = JSON.stringify({
        type: "triggerPump",
        duration: 15
      });
      mqttClient.publish(`ortus/${macAddress}/command`, payload);
    });

    jobs.push(job);
  }

  pumpSchedules.set(macAddress, jobs);
}

export function pausePumpSchedule(macAddress: string) {
  pumpSchedules.get(macAddress)?.forEach((job) => job.pause());
}

export function resumePumpSchedule(macAddress: string) {
  pumpSchedules.get(macAddress)?.forEach((job) => job.resume());
}

export function removePumpSchedule(macAddress: string) {
  const jobs = pumpSchedules.get(macAddress);
  jobs?.forEach((job) => job.stop());
  pumpSchedules.delete(macAddress);
}
