-- Replace device_timeseries with a single-row-per-device state table
DROP INDEX IF EXISTS idx_device_metric_time;
DROP TABLE IF EXISTS device_timeseries;

CREATE TABLE device_state (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    device_id INTEGER NOT NULL UNIQUE,
    brightness INTEGER NOT NULL DEFAULT 0,
    light_on INTEGER NOT NULL DEFAULT 0,
    irrigation_on INTEGER NOT NULL DEFAULT 0,
    fan_on INTEGER NOT NULL DEFAULT 0,
    temperature REAL,
    water_empty INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE
);
