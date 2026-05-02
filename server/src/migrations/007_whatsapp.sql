CREATE TABLE whatsapp_otps (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id TEXT NOT NULL,
    otp TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE user_whatsapp (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    user_id TEXT NOT NULL UNIQUE,
    phone_number TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- last time we sent a water-empty WhatsApp alert for this device (epoch ms)
ALTER TABLE device_state ADD COLUMN last_water_alert_at INTEGER;
