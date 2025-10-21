-- Organizations
CREATE TABLE organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime ('%s', 'now') * 1000),
    name TEXT NOT NULL
);

-- Users
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime ('%s', 'now') * 1000),
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL
);

-- Memberships (link users to organizations with a simple role)
CREATE TABLE user_organization_memberships (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime ('%s', 'now') * 1000),
    user_id INTEGER NOT NULL,
    organization_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
    UNIQUE (user_id, organization_id),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE
);

-- Devices (farm wall modules)
CREATE TABLE devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime ('%s', 'now') * 1000),
    organization_id INTEGER NOT NULL,
    mac_address TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    last_seen INTEGER,
    FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE
);

-- Device timeseries
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

-- Index for fast lookups of latest metrics per device
CREATE INDEX idx_device_metric_time ON device_timeseries (
    mac_address,
    metric,
    created_at DESC
);

-- Plant Types (catalog of species)
CREATE TABLE plant_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime ('%s', 'now') * 1000),
    name TEXT UNIQUE NOT NULL, -- e.g. Basilikum
    description TEXT
);

-- Plants (individual plants on a device)
CREATE TABLE plants (
    id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
    device_id INTEGER NOT NULL,
    plant_type_id INTEGER NOT NULL,
    location TEXT NOT NULL, -- could be slot number, coordinates, etc.
    created_at INTEGER NOT NULL DEFAULT (strftime ('%s', 'now') * 1000),
    FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE,
    FOREIGN KEY (plant_type_id) REFERENCES plant_types (id) ON DELETE RESTRICT
);