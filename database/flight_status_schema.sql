-- =============================================================
-- Flight Delays Table — Stores AviationStack delay data
-- =============================================================
CREATE TABLE IF NOT EXISTS flight_delays (
    callsign VARCHAR(20) PRIMARY KEY,
    airline_name VARCHAR(100),
    airline_iata VARCHAR(10),
    dep_airport VARCHAR(10),
    dep_airport_name VARCHAR(200),
    arr_airport VARCHAR(10),
    arr_airport_name VARCHAR(200),
    dep_scheduled TIMESTAMP,
    dep_estimated TIMESTAMP,
    dep_actual TIMESTAMP,
    arr_scheduled TIMESTAMP,
    arr_estimated TIMESTAMP,
    arr_actual TIMESTAMP,
    dep_delay_min INT DEFAULT 0,
    arr_delay_min INT DEFAULT 0,
    status VARCHAR(30) DEFAULT 'unknown',
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_flight_delays_delayed ON flight_delays(dep_delay_min)
WHERE dep_delay_min > 0;
CREATE INDEX IF NOT EXISTS idx_flight_delays_airports ON flight_delays(dep_airport, arr_airport);
-- =============================================================
-- Live Bookings Table — Links passengers to live flights
-- =============================================================
CREATE TABLE IF NOT EXISTS live_bookings (
    id SERIAL PRIMARY KEY,
    passenger_id INT NOT NULL REFERENCES passengers(id),
    callsign VARCHAR(20) NOT NULL,
    seat VARCHAR(5),
    booking_class VARCHAR(20) DEFAULT 'Economy',
    status VARCHAR(30) DEFAULT 'CONFIRMED',
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_live_bookings_callsign ON live_bookings(callsign);
CREATE INDEX IF NOT EXISTS idx_live_bookings_passenger ON live_bookings(passenger_id);
CREATE INDEX IF NOT EXISTS idx_live_bookings_status ON live_bookings(status);