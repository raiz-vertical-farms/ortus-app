-- Append-only time-series of state changes, complementing the latest-only device_state.
CREATE TABLE device_state_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    device_id INTEGER NOT NULL,
    brightness INTEGER NOT NULL,
    light_on INTEGER NOT NULL,
    irrigation_on INTEGER NOT NULL,
    temperature REAL,
    water_empty INTEGER NOT NULL,
    recorded_at INTEGER NOT NULL,
    FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE
);

CREATE INDEX idx_state_history_device_time ON device_state_history (device_id, recorded_at DESC);
