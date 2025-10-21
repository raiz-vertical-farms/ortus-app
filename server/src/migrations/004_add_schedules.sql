CREATE TABLE light_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime ('%s', 'now') * 1000),
    device_id INTEGER NOT NULL UNIQUE, -- one schedule per device
    on_timestamp INTEGER NOT NULL, -- UTC timestamp in milliseconds
    off_timestamp INTEGER NOT NULL, -- UTC timestamp in milliseconds
    active INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE
);

CREATE TABLE pump_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime ('%s', 'now') * 1000),
    device_id INTEGER NOT NULL UNIQUE, -- one schedule per device
    start_time INTEGER NOT NULL, -- UTC timestamp in milliseconds
    times_per_day INTEGER NOT NULL, -- number of activations per day
    active INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE
);