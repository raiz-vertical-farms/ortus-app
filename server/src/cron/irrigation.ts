import { Cron } from "croner";
import { mqttClient } from "../services/mqtt";

const irrigationSchedules = new Map<string, Cron[]>();

type IrrigationSchedule = {
  startTime: number; // UTC timestamp in milliseconds
  timesPerDay: number; // how many times per day
};

export function setIrrigationSchedule(macAddress: string, schedule: IrrigationSchedule) {
  removeIrrigationSchedule(macAddress);

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
        `[${macAddress}] Irrigation activation triggered at ${hour}:${minute} UTC`
      );
      
      const payload = JSON.stringify({
        type: "triggerIrrigation",
        value: 15
      });
      mqttClient.publish(`ortus/${macAddress}/command`, payload);
    });

    jobs.push(job);
  }

  irrigationSchedules.set(macAddress, jobs);
}

export function pauseIrrigationSchedule(macAddress: string) {
  irrigationSchedules.get(macAddress)?.forEach((job) => job.pause());
}

export function resumeIrrigationSchedule(macAddress: string) {
  irrigationSchedules.get(macAddress)?.forEach((job) => job.resume());
}

export function removeIrrigationSchedule(macAddress: string) {
  const jobs = irrigationSchedules.get(macAddress);
  jobs?.forEach((job) => job.stop());
  irrigationSchedules.delete(macAddress);
}
