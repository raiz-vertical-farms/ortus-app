import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { mqttClient } from "../services/mqtt";
import { db } from "../db";

const app = new Hono()
  .post(
    "/create",
    zValidator(
      "json",
      z.object({
        unique_id: z.string(),
        name: z.string().min(1),
        organization_id: z.number(),
      })
    ),
    async (c) => {
      const { name, organization_id, unique_id } = c.req.valid("json");
      const now = new Date().toISOString();

      const device = await db
        .insertInto("devices")
        .values({ name, unique_id, organization_id, created_at: now })
        .returning(["id", "name", "organization_id"])
        .executeTakeFirstOrThrow();

      return c.json({ success: true, device });
    }
  )
  .post(
    "/:id/switch/:switchId",
    zValidator("json", z.object({ state: z.enum(["ON", "OFF"]) })),
    async (c) => {
      const device_id = Number(c.req.param("id"));
      const switchId = c.req.param("switchId");
      const { state } = c.req.valid("json");

      if (isNaN(device_id)) {
        return c.json({ success: false, error: "Invalid device ID" }, 400);
      }

      const topic = `${device_id}/switch/${switchId}/command`;

      mqttClient.publish(topic, state, async (err) => {
        if (!err) {
          await db
            .updateTable("devices")
            .set({ switch_state: state })
            .where("id", "=", device_id)
            .execute();
        }
      });

      return c.json({
        success: true,
        message: `Switch ${switchId} set to ${state}`,
      });
    }
  )
  .post(
    "/:id/light/:lightId",
    zValidator(
      "json",
      z.object({
        state: z.enum(["ON", "OFF"]).optional(),
        brightness: z.number().min(0).max(100).optional(),
      })
    ),
    async (c) => {
      const device_id = Number(c.req.param("id"));
      const lightId = c.req.param("lightId");
      const { state, brightness } = c.req.valid("json");

      if (isNaN(device_id)) {
        return c.json({ success: false, error: "Invalid device ID" }, 400);
      }

      const topic = `${device_id}/light/${lightId}/command`;
      const payload: Record<string, any> = {};
      if (state) payload.state = state;
      if (brightness !== undefined) payload.brightness = brightness;

      mqttClient.publish(topic, JSON.stringify(payload), async (err) => {
        if (!err) {
          const updateValues: Partial<{
            light_state: string;
            light_brightness: number;
          }> = {};

          if (state) updateValues.light_state = state;
          if (brightness !== undefined)
            updateValues.light_brightness = brightness;

          if (Object.keys(updateValues).length > 0) {
            await db
              .updateTable("devices")
              .set(updateValues)
              .where("id", "=", device_id)
              .execute();
          }
        }
      });

      return c.json({
        success: true,
        message: `Light command sent`,
        payload,
      });
    }
  )
  .post(
    "/:id/number/:numberId",
    zValidator("json", z.object({ value: z.number() })),
    async (c) => {
      const device_id = Number(c.req.param("id"));
      const numberId = c.req.param("numberId");
      const { value } = c.req.valid("json");

      if (isNaN(device_id)) {
        return c.json({ success: false, error: "Invalid device ID" }, 400);
      }

      const topic = `${device_id}/number/${numberId}/command`;

      mqttClient.publish(topic, String(value));

      return c.json({
        success: true,
        message: `Number ${numberId} updated`,
        value,
      });
    }
  )
  .get("/:id/state", async (c) => {
    const device_id = Number(c.req.param("id"));

    if (isNaN(device_id)) {
      return c.json({ success: false, error: "Invalid device ID" }, 400);
    }

    const device = await db
      .selectFrom("devices")
      .select([
        "id",
        "name",
        "unique_id",
        "organization_id",
        "online",
        "last_seen",
        "switch_state",
        "light_state",
        "light_brightness",
      ])
      .select((eb) =>
        eb
          .selectFrom("plants")
          .whereRef("plants.device_id", "=", "devices.id")
          .select((eb2) => eb2.fn.countAll().as("number_of_plants"))
          .as("number_of_plants")
      )
      .where("id", "=", device_id)
      .executeTakeFirst();

    if (!device) {
      return c.json({ success: false, error: "Device not found" }, 404);
    }

    return c.json({
      success: true,
      state: device,
    });
  })
  .get("/devices", async (c) => {
    const devices = await db
      .selectFrom("devices")
      .select([
        "id",
        "name",
        "unique_id",
        "organization_id",
        "online",
        "last_seen",
        "switch_state",
        "light_state",
        "light_brightness",
      ])
      .execute();

    return c.json({
      success: true,
      devices,
    });
  });

export default app;

export type AppType = typeof app;
