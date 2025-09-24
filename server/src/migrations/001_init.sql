-- Organizations
CREATE TABLE organizations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Users
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Memberships (link users to organizations with a simple role)
CREATE TABLE user_organization_memberships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    organization_id INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'admin')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, organization_id),
    FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE
);

-- Devices (farm wall modules)
CREATE TABLE devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    organization_id INTEGER NOT NULL,
    unique_id TEXT UNIQUE NOT NULL, -- e.g. ESP32 chip id or MAC address
    name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    -- Device state
    online BOOLEAN DEFAULT 0,
    last_seen TIMESTAMP,
    switch_state TEXT CHECK (switch_state IN ('ON', 'OFF')) DEFAULT 'OFF',
    light_state TEXT CHECK (light_state IN ('ON', 'OFF')) DEFAULT 'OFF',
    light_brightness INTEGER CHECK (
        light_brightness BETWEEN 0 AND 100
    ),
    FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE
);

-- Plant Types (catalog of species)
CREATE TABLE plant_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL, -- e.g. Basilikum
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Plants (individual plants on a device)
CREATE TABLE plants (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_id INTEGER NOT NULL,
    plant_type_id INTEGER NOT NULL,
    location TEXT NOT NULL, -- could be slot number, coordinates, etc.
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (device_id) REFERENCES devices (id) ON DELETE CASCADE,
    FOREIGN KEY (plant_type_id) REFERENCES plant_types (id) ON DELETE RESTRICT
);