import { z } from "zod";
import { xid } from "zod/v4";

// --- util types ---
type RequiredKeys<T> = {
  [K in keyof T]-?: undefined extends T[K] ? never : K;
}[keyof T];

type AssertShape<Shape extends z.ZodRawShape, T> =
  // Check no extra keys
  Exclude<keyof Shape, keyof T> extends never
    ? // Check type compatibility
      {
        [K in keyof Shape]: z.input<Shape[K]>;
      } extends T
      ? // Check all required keys
        Exclude<RequiredKeys<T>, keyof Shape> extends never
        ? unknown
        : never
      : never
    : never;

// --- main helper ---
export function defineObjectSchemaFor<T>() {
  return function <Shape extends z.ZodRawShape>(
    shape: AssertShape<Shape, T> extends never ? never : Shape
  ) {
    return z.object(shape).strict();
  };
}
