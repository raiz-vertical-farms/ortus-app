-- Device becomes the source of truth for its schedules. Schedule fields move
-- onto device_state so the latest reported state is the only place we read
-- from. Units are seconds throughout (matching the firmware wire format)
-- except for start_off, which is a server-tracked one-shot phase-order flag
-- that the firmware doesn't echo back in its state broadcast.
-- The legacy light_schedules / irrigation_schedules tables remain in place
-- through this phase and are dropped in migration 010 once the fleet has
-- been OTA'd to firmware that echoes schedules in its state broadcast.

ALTER TABLE device_state ADD COLUMN light_schedule_active INTEGER NOT NULL DEFAULT 0;
ALTER TABLE device_state ADD COLUMN light_on_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE device_state ADD COLUMN light_off_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE device_state ADD COLUMN light_start_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE device_state ADD COLUMN light_start_off INTEGER NOT NULL DEFAULT 0;
ALTER TABLE device_state ADD COLUMN irrigation_schedule_active INTEGER NOT NULL DEFAULT 0;
ALTER TABLE device_state ADD COLUMN irrigation_on_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE device_state ADD COLUMN irrigation_off_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE device_state ADD COLUMN irrigation_start_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE device_state ADD COLUMN irrigation_start_off INTEGER NOT NULL DEFAULT 0;

ALTER TABLE device_state_history ADD COLUMN light_schedule_active INTEGER NOT NULL DEFAULT 0;
ALTER TABLE device_state_history ADD COLUMN light_on_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE device_state_history ADD COLUMN light_off_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE device_state_history ADD COLUMN light_start_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE device_state_history ADD COLUMN light_start_off INTEGER NOT NULL DEFAULT 0;
ALTER TABLE device_state_history ADD COLUMN irrigation_schedule_active INTEGER NOT NULL DEFAULT 0;
ALTER TABLE device_state_history ADD COLUMN irrigation_on_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE device_state_history ADD COLUMN irrigation_off_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE device_state_history ADD COLUMN irrigation_start_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE device_state_history ADD COLUMN irrigation_start_off INTEGER NOT NULL DEFAULT 0;

-- Backfill from the legacy schedule tables. Old firmware will not echo schedule
-- fields in its state broadcasts, so these backfilled values are what the UI
-- reads until each device is OTA'd. minutes_* and millisecond start_at are
-- converted to seconds to match the firmware's units.
UPDATE device_state SET
  light_schedule_active = COALESCE((SELECT active           FROM light_schedules ls WHERE ls.device_id = device_state.device_id), 0),
  light_on_seconds      = COALESCE((SELECT minutes_on * 60  FROM light_schedules ls WHERE ls.device_id = device_state.device_id), 0),
  light_off_seconds     = COALESCE((SELECT minutes_off * 60 FROM light_schedules ls WHERE ls.device_id = device_state.device_id), 0),
  light_start_at        = COALESCE((SELECT start_at / 1000  FROM light_schedules ls WHERE ls.device_id = device_state.device_id), 0),
  light_start_off       = COALESCE((SELECT start_off        FROM light_schedules ls WHERE ls.device_id = device_state.device_id), 0),
  irrigation_schedule_active = COALESCE((SELECT active           FROM irrigation_schedules irs WHERE irs.device_id = device_state.device_id), 0),
  irrigation_on_seconds      = COALESCE((SELECT minutes_on * 60  FROM irrigation_schedules irs WHERE irs.device_id = device_state.device_id), 0),
  irrigation_off_seconds     = COALESCE((SELECT minutes_off * 60 FROM irrigation_schedules irs WHERE irs.device_id = device_state.device_id), 0),
  irrigation_start_at        = COALESCE((SELECT start_at / 1000  FROM irrigation_schedules irs WHERE irs.device_id = device_state.device_id), 0),
  irrigation_start_off       = COALESCE((SELECT start_off        FROM irrigation_schedules irs WHERE irs.device_id = device_state.device_id), 0);
