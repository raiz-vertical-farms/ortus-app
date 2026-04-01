export const SCHEDULE_DEFAULTS = {
  light: {
    minutes_on: 720,  // 12 hours on
    minutes_off: 720, // 12 hours off
  },
  irrigation: {
    minutes_on: 2,    // 2 minutes watering
    minutes_off: 718, // ~12 hours off
  },
  fan: {
    minutes_on: 30,   // 30 minutes on
    minutes_off: 30,  // 30 minutes off
  },
} as const;

export const ACK_TIMEOUT_MS = 10_000; // 10 seconds to receive ACK from device
