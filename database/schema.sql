-- =============================================================
-- Flight Disruption Engine — PostgreSQL Schema (Supabase)
-- =============================================================
-- Custom ENUM types
CREATE TYPE flight_status AS ENUM (
    'SCHEDULED',
    'BOARDING',
    'ACTIVE',
    'LANDED',
    'DELAYED',
    'CANCELLED'
);
CREATE TYPE booking_status AS ENUM (
    'CONFIRMED',
    'MISSED_CONNECTION',
    'REBOOKED',
    'CANCELLED'
);
-- -----------------------------------------------
-- Airports: Nodes in our global network graph
-- -----------------------------------------------
CREATE TABLE airports (
    code CHAR(3) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    city VARCHAR(100) NOT NULL,
    country VARCHAR(100) NOT NULL,
    lat DECIMAL(10, 6) NOT NULL,
    lng DECIMAL(10, 6) NOT NULL,
    timezone VARCHAR(50) DEFAULT 'UTC'
);
-- -----------------------------------------------
-- Aircraft: Physical assets (planes)
-- -----------------------------------------------
CREATE TABLE aircraft (
    id SERIAL PRIMARY KEY,
    tail_number VARCHAR(20) UNIQUE NOT NULL,
    model VARCHAR(50) NOT NULL,
    capacity INT NOT NULL DEFAULT 180,
    current_airport_code CHAR(3) REFERENCES airports(code)
);
-- -----------------------------------------------
-- Flights: Edges in our graph
-- -----------------------------------------------
CREATE TABLE flights (
    id SERIAL PRIMARY KEY,
    flight_number VARCHAR(10) NOT NULL,
    aircraft_id INT REFERENCES aircraft(id),
    origin_code CHAR(3) NOT NULL REFERENCES airports(code),
    destination_code CHAR(3) NOT NULL REFERENCES airports(code),
    scheduled_dep TIMESTAMP NOT NULL,
    scheduled_arr TIMESTAMP NOT NULL,
    actual_dep TIMESTAMP,
    actual_arr TIMESTAMP,
    delay_minutes INT DEFAULT 0,
    status flight_status DEFAULT 'SCHEDULED',
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_flights_status ON flights(status);
CREATE INDEX idx_flights_aircraft ON flights(aircraft_id);
CREATE INDEX idx_flights_scheduled_dep ON flights(scheduled_dep);
-- -----------------------------------------------
-- Passengers
-- -----------------------------------------------
CREATE TABLE passengers (
    id SERIAL PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    email VARCHAR(150) UNIQUE,
    phone VARCHAR(20)
);
-- -----------------------------------------------
-- Bookings: Passenger-to-Flight mapping with
-- connection chain (linked-list via next_booking_id)
-- -----------------------------------------------
CREATE TABLE bookings (
    id SERIAL PRIMARY KEY,
    passenger_id INT NOT NULL REFERENCES passengers(id),
    flight_id INT NOT NULL REFERENCES flights(id),
    next_booking_id INT REFERENCES bookings(id),
    status booking_status DEFAULT 'CONFIRMED',
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_bookings_flight ON bookings(flight_id);
CREATE INDEX idx_bookings_passenger ON bookings(passenger_id);
CREATE INDEX idx_bookings_status ON bookings(status);
-- -----------------------------------------------
-- Disruption Log: Audit trail of every delay event
-- -----------------------------------------------
CREATE TABLE disruption_log (
    id SERIAL PRIMARY KEY,
    flight_id INT NOT NULL REFERENCES flights(id),
    delay_minutes INT NOT NULL,
    cause VARCHAR(255),
    cascaded_from_flight_id INT REFERENCES flights(id),
    passengers_impacted INT DEFAULT 0,
    flights_impacted INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW()
);