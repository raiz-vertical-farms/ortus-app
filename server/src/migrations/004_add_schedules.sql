CREATE TABLE light_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL UNIQUE, -- one schedule per device
    on_timestamp INTEGER NOT NULL, -- UTC timestamp in seconds
    off_timestamp INTEGER NOT NULL, -- UTC timestamp in seconds
    created_at INTEGER DEFAULT (strftime ('%s', 'now')),
    FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE
);

CREATE TABLE pump_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL UNIQUE, -- one schedule per device
    start_time INTEGER NOT NULL, -- UTC timestamp in seconds
    times_per_day INTEGER NOT NULL, -- number of activations per day
    created_at INTEGER DEFAULT (strftime ('%s', 'now')),
    FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE
);