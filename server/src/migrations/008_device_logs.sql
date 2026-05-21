-- Debug log lines published by firmware over ortus/<mac>/log.
CREATE TABLE device_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    device_id INTEGER NOT NULL,
    level TEXT NOT NULL,
    tag TEXT NOT NULL,
    message TEXT NOT NULL,
    recorded_at INTEGER NOT NULL,
    FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE
);

CREATE INDEX idx_device_logs_device_time ON device_logs (device_id, recorded_at DESC);
