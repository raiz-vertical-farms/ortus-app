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
  plant: plantSchema,
});

const plants = new Hono().post(
  "/plant/create",
  describeRoute({
    operationId: "createPlant",
    summary: "Create a new plant",
    tags: ["Plants"],
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

    const plant = await db
      .insertInto("plants")
      .values({
        device_id,
        plant_type_id,
        location,
      })
      .returning(["id", "device_id", "plant_type_id", "location"])
      .executeTakeFirstOrThrow();

    return c.json({ plant });
  }
);

export default plants;
