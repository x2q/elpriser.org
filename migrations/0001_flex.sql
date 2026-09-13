-- Regulerbar kapacitet: hvad elpriser.org faktisk styrer.
--
-- Two quantities matter to a buyer of flexibility, and a rated wattage is
-- neither of them:
--   down_w  power that can be switched OFF right now — devices currently on,
--           at their measured draw (a fridge's compressor is not always running)
--   up_w    power that can be switched ON right now — devices held off by the
--           price schedule, at their rated draw
-- So each reading records the relay state, what elpriser.org commanded, and
-- the measured power, and the devices table records what a device can do.
--
-- Privacy by construction: a device is a random id generated on the device
-- itself. No MAC address, serial, IP, address or account is stored. Location
-- is the price area and nothing finer.

CREATE TABLE IF NOT EXISTS devices (
  id           TEXT PRIMARY KEY,          -- random, generated on the device
  platform     TEXT NOT NULL,             -- shelly | homeassistant | other
  category     TEXT NOT NULL,             -- fridge | freezer | pump | heat_pump | water_heater | ev_charger | battery | other
  area         TEXT NOT NULL,             -- DK1 | DK2
  phases       INTEGER,                   -- 1 or 3
  rated_w      INTEGER,                   -- declared by the user
  max_off_min  INTEGER,                   -- how long it can be held off; NULL = unknown
  first_seen   TEXT NOT NULL,
  last_seen    TEXT NOT NULL,
  reports      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS readings (
  device_id     TEXT NOT NULL,
  ts            TEXT NOT NULL,            -- UTC, floored to the 15-minute slot
  on_state      INTEGER NOT NULL,         -- relay actually on
  commanded_on  INTEGER,                  -- what elpriser.org told it to be
  power_w       REAL,                     -- measured draw; NULL when not metered
  measured      INTEGER NOT NULL,         -- 1 = power_w measured, 0 = not metered
  PRIMARY KEY (device_id, ts)
);
CREATE INDEX IF NOT EXISTS readings_ts ON readings(ts);

-- Raw readings are kept 90 days. These hourly totals are what outlives them,
-- and they carry no device ids.
CREATE TABLE IF NOT EXISTS hourly (
  hour      TEXT NOT NULL,
  area      TEXT NOT NULL,
  category  TEXT NOT NULL,
  devices   INTEGER NOT NULL,
  down_w    REAL NOT NULL,
  up_w      REAL NOT NULL,
  PRIMARY KEY (hour, area, category)
);
