-- Fan was merged into the irrigation relay (single GPIO drives pump + fan).
DROP TABLE IF EXISTS fan_schedules;

ALTER TABLE device_state DROP COLUMN fan_on;
