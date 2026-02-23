CREATE TABLE alert_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime ('%s', 'now') * 1000),
    device_id INTEGER NOT NULL,
    alert_type TEXT NOT NULL, -- e.g. 'water_low', 'temperature_high'
    last_notified INTEGER, -- when we last sent a message
    message TEXT NOT NULL,
    UNIQUE (device_id, alert_type),
    FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE
);