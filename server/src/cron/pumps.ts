import { Cron } from "croner";

const pumpSchedules = new Map<string, Cron>();

type PumpSchedule = {
  startTime: number; // UTC timestamp in milliseconds
  timesPerDay: number; // how many times per day
};

export function setPumpSchedule(macAddress: string, schedule: PumpSchedule) {
  removePumpSchedule(macAddress);

  if (schedule.timesPerDay <= 0) {
    throw new Error("timesPerDay must be greater than zero");
  }

  // Calculate interval in minutes between activations
  const intervalMinutes = Math.floor((24 * 60) / schedule.timesPerDay);

  // Create cron expression that repeats every N minutes
  const cronExpr = `*/${intervalMinutes} * * * *`;

  const job = new Cron(cronExpr, {
    startAt: new Date(schedule.startTime),
    timezone: "UTC",
  });

  pumpSchedules.set(macAddress, job);
}

export function deactivatePumpSchedule(macAddress: string) {
  pumpSchedules.get(macAddress)?.pause();
}

export function reactivatePumpSchedule(macAddress: string) {
  pumpSchedules.get(macAddress)?.resume();
}

export function removePumpSchedule(macAddress: string) {
  const job = pumpSchedules.get(macAddress);
  if (job) {
    job.stop();
    pumpSchedules.delete(macAddress);
  }
}
