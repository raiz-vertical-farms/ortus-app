-- Migrate light_schedules to interval-based schema
ALTER TABLE light_schedules RENAME TO light_schedules_old;

CREATE TABLE light_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    device_id INTEGER NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 0,
    start_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    start_off INTEGER NOT NULL DEFAULT 0,
    minutes_on INTEGER NOT NULL DEFAULT 720,
    minutes_off INTEGER NOT NULL DEFAULT 720,
    FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE
);

DROP TABLE light_schedules_old;

-- Migrate irrigation_schedules to interval-based schema
ALTER TABLE irrigation_schedules RENAME TO irrigation_schedules_old;

CREATE TABLE irrigation_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    device_id INTEGER NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 0,
    skipped_at INTEGER,
    start_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    start_off INTEGER NOT NULL DEFAULT 1,
    minutes_on INTEGER NOT NULL DEFAULT 2,
    minutes_off INTEGER NOT NULL DEFAULT 718,
    FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE
);

DROP TABLE irrigation_schedules_old;

-- Create fan_schedules (fans controlled individually per device)
CREATE TABLE fan_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    device_id INTEGER NOT NULL UNIQUE,
    active INTEGER NOT NULL DEFAULT 0,
    start_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
    start_off INTEGER NOT NULL DEFAULT 0,
    minutes_on INTEGER NOT NULL DEFAULT 30,
    minutes_off INTEGER NOT NULL DEFAULT 30,
    FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE
);
