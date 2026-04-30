export const SCHEDULE_DEFAULTS = {
  light: {
    minutes_on: 720, // 12 hours on
    minutes_off: 720, // 12 hours off
  },
  irrigation: {
    minutes_on: 60, // 1 hour watering
    minutes_off: 420, // ~7 hours off (to make 3 cycles/day)
  },
} as const;

export const ACK_TIMEOUT_MS = 10_000; // 10 seconds to receive ACK from device
