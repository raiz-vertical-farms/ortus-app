import { Hono } from "hono";
import { validator as zValidator, resolver, describeRoute } from "hono-openapi";
import * as z from "zod";
import { db } from "../db";

const createPlantRequestSchema = z.object({
  device_id: z.number(),
  plant_type_id: z.number(),
  location: z.string().min(1),
});

const plantSchema = z.object({
  id: z.number(),
  device_id: z.number(),
  plant_type_id: z.number(),
  location: z.string(),
});

const createPlantResponseSchema = z.object({
  success: z.literal(true),
  plant: plantSchema,
});

const plants = new Hono().post(
  "/plant/create",
  describeRoute({
    summary: "Create a new plant",
    tags: ["Plants"],
    requestBody: {
      required: true,
      content: {
        "application/json": {
          schema: resolver(createPlantRequestSchema),
        },
      },
    },
    responses: {
      200: {
        description: "Plant created",
        content: {
          "application/json": {
            schema: resolver(createPlantResponseSchema),
          },
        },
      },
    },
  }),
  zValidator("json", createPlantRequestSchema),
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
