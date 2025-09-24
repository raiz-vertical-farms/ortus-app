import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import * as z from "zod";
import { db } from "../db";

const plants = new Hono().post(
  "/plant/create",
  zValidator(
    "json",
    z.object({
      device_id: z.number(),
      plant_type_id: z.number(),
      location: z.string().min(1),
    })
  ),
  async (c) => {
    const { device_id, plant_type_id, location } = c.req.valid("json");
    const now = new Date().toISOString();

    const plant = await db
      .insertInto("plants")
      .values({
        device_id,
        plant_type_id,
        location,
        created_at: now,
      })
      .returning(["id", "device_id", "plant_type_id", "location"])
      .executeTakeFirstOrThrow();

    return c.json({ success: true, plant });
  }
);

export default plants;
