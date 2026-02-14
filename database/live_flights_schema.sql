-- =============================================================
-- Live Flights Table — Stores real-time OpenSky state vectors
-- =============================================================
-- This table is populated by the OpenSky ingestion service
-- and consumed by the frontend for live aircraft tracking.
CREATE TABLE IF NOT EXISTS live_flights (
    icao24 VARCHAR(10) PRIMARY KEY,
    -- ICAO 24-bit transponder address
    callsign VARCHAR(20),
    -- Flight callsign (e.g., "UAL123")
    origin_country VARCHAR(100),
    -- Country of origin
    latitude DECIMAL(10, 6),
    -- Current latitude
    longitude DECIMAL(10, 6),
    -- Current longitude
    altitude_m INT DEFAULT 0,
    -- Barometric altitude (meters)
    velocity_ms DECIMAL(8, 1),
    -- Ground speed (m/s)
    heading DECIMAL(6, 1),
    -- True track (degrees from north)
    vertical_rate DECIMAL(8, 1),
    -- Vertical rate (m/s)
    on_ground BOOLEAN DEFAULT false,
    -- Whether aircraft is on ground
    last_contact TIMESTAMP,
    -- Last contact time from OpenSky
    updated_at TIMESTAMP DEFAULT NOW() -- Last update from our ingestion
);
-- Index for fast geo queries and cleanup
CREATE INDEX IF NOT EXISTS idx_live_flights_updated ON live_flights(updated_at);
CREATE INDEX IF NOT EXISTS idx_live_flights_callsign ON live_flights(callsign);
CREATE INDEX IF NOT EXISTS idx_live_flights_ground ON live_flights(on_ground);