-- =============================================================
-- Flight Disruption Engine — PL/pgSQL Functions (Supabase)
-- The Core "Blast Radius" Logic
-- =============================================================
-- -----------------------------------------------
-- FUNCTION: initialize_flight_times
-- Sets actual_dep/actual_arr = scheduled times
-- for all flights that don't have them yet.
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION initialize_flight_times() RETURNS void AS $$ BEGIN
UPDATE flights
SET actual_dep = scheduled_dep,
    actual_arr = scheduled_arr
WHERE actual_dep IS NULL;
END;
$$ LANGUAGE plpgsql;
-- -----------------------------------------------
-- FUNCTION: calculate_blast_radius
-- The main recursive delay propagation engine.
-- Given a flight_id and delay in minutes, it:
--   1. Delays the target flight
--   2. Propagates to the aircraft's next flight
--   3. Marks missed passenger connections
--   4. Logs everything to disruption_log
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION calculate_blast_radius(
        p_flight_id INT,
        p_delay_minutes INT,
        p_cause VARCHAR DEFAULT NULL,
        p_cascaded_from INT DEFAULT NULL,
        p_depth INT DEFAULT 0
    ) RETURNS void AS $$
DECLARE v_new_arr TIMESTAMP;
v_new_dep TIMESTAMP;
v_aircraft_id INT;
v_next_flight_id INT;
v_next_dep TIMESTAMP;
v_min_turnaround INT := 45;
-- Minutes needed for plane turnaround
v_min_connection INT := 30;
-- Minutes needed for passenger connection
v_pax_impacted INT := 0;
v_flights_impacted INT := 0;
v_forced_delay INT := 0;
v_booking RECORD;
v_next_flight_dep TIMESTAMP;
BEGIN -- Safety: prevent infinite recursion (max depth 20)
IF p_depth > 20 THEN RETURN;
END IF;
-- ===== STEP 1: Delay the target flight =====
UPDATE flights
SET actual_dep = COALESCE(actual_dep, scheduled_dep) + (p_delay_minutes || ' minutes')::INTERVAL,
    actual_arr = COALESCE(actual_arr, scheduled_arr) + (p_delay_minutes || ' minutes')::INTERVAL,
    delay_minutes = COALESCE(delay_minutes, 0) + p_delay_minutes,
    status = 'DELAYED'
WHERE id = p_flight_id;
-- Fetch updated values
SELECT actual_arr,
    actual_dep,
    aircraft_id INTO v_new_arr,
    v_new_dep,
    v_aircraft_id
FROM flights
WHERE id = p_flight_id;
-- ===== STEP 2: Aircraft Propagation (Cascading) =====
-- Find the next scheduled flight for this specific aircraft
SELECT id,
    COALESCE(actual_dep, scheduled_dep) INTO v_next_flight_id,
    v_next_dep
FROM flights
WHERE aircraft_id = v_aircraft_id
    AND id != p_flight_id
    AND COALESCE(actual_dep, scheduled_dep) >= v_new_dep
    AND status NOT IN ('LANDED', 'CANCELLED')
ORDER BY COALESCE(actual_dep, scheduled_dep) ASC
LIMIT 1;
IF v_next_flight_id IS NOT NULL THEN -- Check turnaround violation
v_forced_delay := v_min_turnaround - EXTRACT(
    EPOCH
    FROM (v_next_dep - v_new_arr)
)::INT / 60;
IF v_forced_delay > 0 THEN v_flights_impacted := v_flights_impacted + 1;
-- RECURSE: propagate to the next flight
PERFORM calculate_blast_radius(
    v_next_flight_id,
    v_forced_delay,
    'Aircraft turnaround from flight ' || p_flight_id,
    p_flight_id,
    p_depth + 1
);
END IF;
END IF;
-- ===== STEP 3: Passenger Connection Check =====
FOR v_booking IN
SELECT b.id AS booking_id,
    b.next_booking_id
FROM bookings b
WHERE b.flight_id = p_flight_id
    AND b.next_booking_id IS NOT NULL
    AND b.status = 'CONFIRMED' LOOP -- Get the departure time of the passenger's connecting flight
SELECT COALESCE(f.actual_dep, f.scheduled_dep) INTO v_next_flight_dep
FROM bookings b2
    JOIN flights f ON b2.flight_id = f.id
WHERE b2.id = v_booking.next_booking_id;
-- Check if connection is broken
IF v_next_flight_dep IS NOT NULL
AND EXTRACT(
    EPOCH
    FROM (v_next_flight_dep - v_new_arr)
)::INT / 60 < v_min_connection THEN -- MISSED CONNECTION!
UPDATE bookings
SET status = 'MISSED_CONNECTION'
WHERE id = v_booking.booking_id;
UPDATE bookings
SET status = 'MISSED_CONNECTION'
WHERE id = v_booking.next_booking_id;
v_pax_impacted := v_pax_impacted + 1;
END IF;
END LOOP;
-- ===== STEP 4: Log the disruption event =====
INSERT INTO disruption_log (
        flight_id,
        delay_minutes,
        cause,
        cascaded_from_flight_id,
        passengers_impacted,
        flights_impacted
    )
VALUES (
        p_flight_id,
        p_delay_minutes,
        p_cause,
        p_cascaded_from,
        v_pax_impacted,
        v_flights_impacted
    );
END;
$$ LANGUAGE plpgsql;
-- -----------------------------------------------
-- FUNCTION: trigger_random_delay
-- Picks a random active flight and delays it.
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION trigger_random_delay() RETURNS TABLE(
        delayed_flight_id INT,
        delay INT,
        delay_cause VARCHAR
    ) AS $$
DECLARE v_flight_id INT;
v_delay INT;
v_cause VARCHAR;
v_causes TEXT [] := ARRAY [
        'Weather delay', 'ATC congestion', 'Mechanical issue', 
        'Crew availability', 'Late incoming aircraft', 
        'Security screening delay', 'Gate conflict', 'Baggage handling delay'
    ];
BEGIN -- Pick a random non-landed, non-cancelled flight
SELECT f.id INTO v_flight_id
FROM flights f
WHERE f.status IN ('SCHEDULED', 'ACTIVE', 'BOARDING')
ORDER BY RANDOM()
LIMIT 1;
IF v_flight_id IS NOT NULL THEN -- Random delay between 15 and 180 minutes
v_delay := FLOOR(15 + (RANDOM() * 165))::INT;
-- Random cause
v_cause := v_causes [1 + FLOOR(RANDOM() * array_length(v_causes, 1))::INT];
PERFORM calculate_blast_radius(v_flight_id, v_delay, v_cause, NULL, 0);
RETURN QUERY
SELECT v_flight_id,
    v_delay,
    v_cause;
END IF;
END;
$$ LANGUAGE plpgsql;
-- -----------------------------------------------
-- FUNCTION: reset_simulation
-- Resets all flights and bookings to original state
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION reset_simulation() RETURNS void AS $$ BEGIN
UPDATE flights
SET actual_dep = scheduled_dep,
    actual_arr = scheduled_arr,
    delay_minutes = 0,
    status = 'SCHEDULED';
UPDATE bookings
SET status = 'CONFIRMED';
DELETE FROM disruption_log;
END;
$$ LANGUAGE plpgsql;
-- -----------------------------------------------
-- FUNCTION: update_flight_statuses
-- Simulates flights transitioning states based on time
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION update_flight_statuses() RETURNS void AS $$ BEGIN -- Move SCHEDULED flights to BOARDING (30 min before dep)
UPDATE flights
SET status = 'BOARDING'
WHERE status = 'SCHEDULED'
    AND COALESCE(actual_dep, scheduled_dep) <= NOW() + INTERVAL '30 minutes'
    AND COALESCE(actual_dep, scheduled_dep) > NOW();
-- Move BOARDING/DELAYED flights to ACTIVE (past departure)
UPDATE flights
SET status = 'ACTIVE'
WHERE status IN ('BOARDING', 'DELAYED')
    AND COALESCE(actual_dep, scheduled_dep) <= NOW()
    AND COALESCE(actual_arr, scheduled_arr) > NOW();
-- Move ACTIVE flights to LANDED (past arrival)
UPDATE flights
SET status = 'LANDED'
WHERE status = 'ACTIVE'
    AND COALESCE(actual_arr, scheduled_arr) <= NOW();
END;
$$ LANGUAGE plpgsql;
-- -----------------------------------------------
-- FUNCTION: suggest_rebookings
-- Finds the next available flight for each stranded
-- passenger and suggests a rebooking option.
-- Returns a table of suggestions.
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION suggest_rebookings() RETURNS TABLE (
        booking_id INT,
        passenger_name TEXT,
        passenger_id INT,
        missed_flight_number VARCHAR,
        missed_origin CHAR(3),
        missed_destination CHAR(3),
        suggested_flight_id INT,
        suggested_flight_number VARCHAR,
        suggested_dep TIMESTAMP,
        suggested_arr TIMESTAMP,
        seats_available INT,
        time_saved_minutes INT
    ) AS $$
DECLARE v_booking RECORD;
v_missed_flight RECORD;
v_suggested RECORD;
v_booked_seats INT;
BEGIN -- Loop through all missed connection bookings
FOR v_booking IN
SELECT b.id AS booking_id,
    b.passenger_id,
    b.flight_id,
    b.next_booking_id,
    p.first_name || ' ' || p.last_name AS passenger_name
FROM bookings b
    JOIN passengers p ON b.passenger_id = p.id
WHERE b.status = 'MISSED_CONNECTION'
    AND b.next_booking_id IS NOT NULL LOOP -- Get the missed connecting flight details
SELECT f.id,
    f.flight_number,
    f.origin_code,
    f.destination_code,
    COALESCE(f.actual_dep, f.scheduled_dep) AS dep,
    COALESCE(f.actual_arr, f.scheduled_arr) AS arr INTO v_missed_flight
FROM bookings b2
    JOIN flights f ON b2.flight_id = f.id
WHERE b2.id = v_booking.next_booking_id;
IF v_missed_flight IS NULL THEN CONTINUE;
END IF;
-- Find the next available flight on the same route
-- (same origin & destination, departing in the future, not cancelled)
FOR v_suggested IN
SELECT f.id,
    f.flight_number,
    COALESCE(f.actual_dep, f.scheduled_dep) AS dep,
    COALESCE(f.actual_arr, f.scheduled_arr) AS arr,
    a.capacity
FROM flights f
    JOIN aircraft a ON f.aircraft_id = a.id
WHERE f.origin_code = v_missed_flight.origin_code
    AND f.destination_code = v_missed_flight.destination_code
    AND COALESCE(f.actual_dep, f.scheduled_dep) > NOW()
    AND f.status NOT IN ('LANDED', 'CANCELLED')
    AND f.id != v_missed_flight.id
ORDER BY COALESCE(f.actual_dep, f.scheduled_dep) ASC
LIMIT 3 LOOP -- Count current bookings on the suggested flight
SELECT COUNT(*) INTO v_booked_seats
FROM bookings
WHERE flight_id = v_suggested.id
    AND status IN ('CONFIRMED', 'REBOOKED');
IF v_suggested.capacity - v_booked_seats > 0 THEN booking_id := v_booking.booking_id;
passenger_name := v_booking.passenger_name;
passenger_id := v_booking.passenger_id;
missed_flight_number := v_missed_flight.flight_number;
missed_origin := v_missed_flight.origin_code;
missed_destination := v_missed_flight.destination_code;
suggested_flight_id := v_suggested.id;
suggested_flight_number := v_suggested.flight_number;
suggested_dep := v_suggested.dep;
suggested_arr := v_suggested.arr;
seats_available := v_suggested.capacity - v_booked_seats;
time_saved_minutes := EXTRACT(
    EPOCH
    FROM (v_missed_flight.arr - v_suggested.arr)
)::INT / 60;
RETURN NEXT;
EXIT;
-- Found best option for this booking, move to next
END IF;
END LOOP;
END LOOP;
END;
$$ LANGUAGE plpgsql;