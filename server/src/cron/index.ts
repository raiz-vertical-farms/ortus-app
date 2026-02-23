import { db } from "../db";
import { setLightSchedule } from "./lights";
import { setIrrigationSchedule } from "./irrigation";

type LightScheduleRow = {
  mac_address: string;
  on_timestamp: number;
  off_timestamp: number;
};

type IrrigationScheduleRow = {
  mac_address: string;
  start_time: number;
  times_per_day: number;
};

export async function bootstrapSchedulesFromDb() {
  const [lightSchedules, irrigationSchedules] = await Promise.all([
    db
      .selectFrom("light_schedules as ls")
      .innerJoin("devices as d", "d.id", "ls.device_id")
      .select((eb) => [
        eb.ref("d.mac_address").as("mac_address"),
        eb.ref("ls.on_timestamp").as("on_timestamp"),
        eb.ref("ls.off_timestamp").as("off_timestamp"),
      ])
      .where("ls.active", "=", 1)
      .execute() as Promise<LightScheduleRow[]>,
    db
      .selectFrom("irrigation_schedules as ps")
      .innerJoin("devices as d", "d.id", "ps.device_id")
      .select((eb) => [
        eb.ref("d.mac_address").as("mac_address"),
        eb.ref("ps.start_time").as("start_time"),
        eb.ref("ps.times_per_day").as("times_per_day"),
      ])
      .where("ps.active", "=", 1)
      .execute() as Promise<IrrigationScheduleRow[]>,
  ]);

  lightSchedules.forEach((schedule) =>
    setLightSchedule(schedule.mac_address, {
      onTimestamp: schedule.on_timestamp,
      offTimestamp: schedule.off_timestamp,
    })
  );

  irrigationSchedules.forEach((schedule) =>
    setIrrigationSchedule(schedule.mac_address, {
      startTime: schedule.start_time,
      timesPerDay: schedule.times_per_day,
    })
  );

  console.log(
    `Bootstrapped ${lightSchedules.length} light schedules and ${irrigationSchedules.length} irrigation schedules from DB`
  );
}

export * from "./lights";
export * from "./irrigation";
