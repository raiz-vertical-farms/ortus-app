CREATE TABLE devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime ('%s', 'now') * 1000),
    online INTEGER NOT NULL DEFAULT 0,
    lan_ip TEXT,
    lan_ws_port INTEGER,
    mac_address TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    last_seen INTEGER,
    user_id TEXT NOT NULL
);

CREATE TABLE device_timeseries (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime ('%s', 'now') * 1000),
    mac_address TEXT NOT NULL,
    metric TEXT NOT NULL,
    value_type TEXT NOT NULL CHECK (
        value_type IN (
            'float',
            'int',
            'text',
            'json',
            'boolean'
        )
    ),
    value_text TEXT NOT NULL
);

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

-- Index for fast lookups of latest metrics per device
CREATE INDEX idx_device_metric_time ON device_timeseries (
    mac_address,
    metric,
    created_at DESC
);