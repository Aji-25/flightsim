-- =============================================================
-- Flight Disruption Engine — Seed Data (PostgreSQL / Supabase)
-- =============================================================
-- -----------------------------------------------
-- 1. AIRPORTS (Major international hubs)
-- -----------------------------------------------
INSERT INTO airports (code, name, city, country, lat, lng, timezone)
VALUES (
        'JFK',
        'John F. Kennedy International',
        'New York',
        'USA',
        40.6413,
        -73.7781,
        'America/New_York'
    ),
    (
        'LAX',
        'Los Angeles International',
        'Los Angeles',
        'USA',
        33.9425,
        -118.4081,
        'America/Los_Angeles'
    ),
    (
        'ORD',
        'O''Hare International',
        'Chicago',
        'USA',
        41.9742,
        -87.9073,
        'America/Chicago'
    ),
    (
        'LHR',
        'Heathrow',
        'London',
        'UK',
        51.4700,
        -0.4543,
        'Europe/London'
    ),
    (
        'CDG',
        'Charles de Gaulle',
        'Paris',
        'France',
        49.0097,
        2.5479,
        'Europe/Paris'
    ),
    (
        'FRA',
        'Frankfurt Airport',
        'Frankfurt',
        'Germany',
        50.0379,
        8.5622,
        'Europe/Berlin'
    ),
    (
        'DXB',
        'Dubai International',
        'Dubai',
        'UAE',
        25.2532,
        55.3657,
        'Asia/Dubai'
    ),
    (
        'SIN',
        'Changi Airport',
        'Singapore',
        'Singapore',
        1.3644,
        103.9915,
        'Asia/Singapore'
    ),
    (
        'HND',
        'Haneda Airport',
        'Tokyo',
        'Japan',
        35.5494,
        139.7798,
        'Asia/Tokyo'
    ),
    (
        'SYD',
        'Kingsford Smith',
        'Sydney',
        'Australia',
        -33.9461,
        151.1772,
        'Australia/Sydney'
    ),
    (
        'DEL',
        'Indira Gandhi International',
        'Delhi',
        'India',
        28.5562,
        77.1000,
        'Asia/Kolkata'
    ),
    (
        'GRU',
        'Guarulhos International',
        'São Paulo',
        'Brazil',
        -23.4356,
        -46.4731,
        'America/Sao_Paulo'
    );
-- -----------------------------------------------
-- 2. AIRCRAFT
-- -----------------------------------------------
INSERT INTO aircraft (
        id,
        tail_number,
        model,
        capacity,
        current_airport_code
    )
VALUES (1, 'N101AA', 'Boeing 777-300ER', 350, 'JFK'),
    (2, 'N202UA', 'Boeing 787-9', 290, 'LAX'),
    (3, 'G-XLEA', 'Airbus A380', 490, 'LHR'),
    (4, 'D-AIMA', 'Airbus A350-900', 310, 'FRA'),
    (5, 'A6-EDA', 'Airbus A380', 490, 'DXB'),
    (6, '9V-SKA', 'Airbus A350-900', 310, 'SIN'),
    (7, 'JA301A', 'Boeing 787-9', 290, 'HND'),
    (8, 'VH-OQA', 'Airbus A380', 490, 'SYD');
SELECT setval(
        'aircraft_id_seq',
        (
            SELECT MAX(id)
            FROM aircraft
        )
    );
-- -----------------------------------------------
-- 3. FLIGHTS (Dense network with tight connections)
-- -----------------------------------------------
-- === Chain 1: Transatlantic (N101AA) ===
INSERT INTO flights (
        flight_number,
        aircraft_id,
        origin_code,
        destination_code,
        scheduled_dep,
        scheduled_arr,
        actual_dep,
        actual_arr,
        status
    )
VALUES (
        'AA100',
        1,
        'JFK',
        'LHR',
        NOW() + INTERVAL '1 hour',
        NOW() + INTERVAL '8 hours',
        NOW() + INTERVAL '1 hour',
        NOW() + INTERVAL '8 hours',
        'SCHEDULED'
    ),
    (
        'AA101',
        1,
        'LHR',
        'FRA',
        NOW() + INTERVAL '9 hours',
        NOW() + INTERVAL '11 hours',
        NOW() + INTERVAL '9 hours',
        NOW() + INTERVAL '11 hours',
        'SCHEDULED'
    );
-- === Chain 2: Europe -> Middle East (G-XLEA) ===
INSERT INTO flights (
        flight_number,
        aircraft_id,
        origin_code,
        destination_code,
        scheduled_dep,
        scheduled_arr,
        actual_dep,
        actual_arr,
        status
    )
VALUES (
        'BA205',
        3,
        'LHR',
        'DXB',
        NOW() + INTERVAL '2 hours',
        NOW() + INTERVAL '9 hours',
        NOW() + INTERVAL '2 hours',
        NOW() + INTERVAL '9 hours',
        'SCHEDULED'
    ),
    (
        'BA206',
        3,
        'DXB',
        'SIN',
        NOW() + INTERVAL '10 hours',
        NOW() + INTERVAL '17 hours',
        NOW() + INTERVAL '10 hours',
        NOW() + INTERVAL '17 hours',
        'SCHEDULED'
    );
-- === Chain 3: Europe -> Asia (D-AIMA) ===
INSERT INTO flights (
        flight_number,
        aircraft_id,
        origin_code,
        destination_code,
        scheduled_dep,
        scheduled_arr,
        actual_dep,
        actual_arr,
        status
    )
VALUES (
        'LH756',
        4,
        'FRA',
        'DEL',
        NOW() + INTERVAL '3 hours',
        NOW() + INTERVAL '11 hours',
        NOW() + INTERVAL '3 hours',
        NOW() + INTERVAL '11 hours',
        'SCHEDULED'
    ),
    (
        'LH757',
        4,
        'DEL',
        'HND',
        NOW() + INTERVAL '12 hours',
        NOW() + INTERVAL '20 hours',
        NOW() + INTERVAL '12 hours',
        NOW() + INTERVAL '20 hours',
        'SCHEDULED'
    );
-- === Chain 4: Middle East Hub (A6-EDA) ===
INSERT INTO flights (
        flight_number,
        aircraft_id,
        origin_code,
        destination_code,
        scheduled_dep,
        scheduled_arr,
        actual_dep,
        actual_arr,
        status
    )
VALUES (
        'EK404',
        5,
        'DXB',
        'SIN',
        NOW() + INTERVAL '4 hours',
        NOW() + INTERVAL '11 hours',
        NOW() + INTERVAL '4 hours',
        NOW() + INTERVAL '11 hours',
        'SCHEDULED'
    ),
    (
        'EK405',
        5,
        'SIN',
        'SYD',
        NOW() + INTERVAL '12 hours',
        NOW() + INTERVAL '20 hours',
        NOW() + INTERVAL '12 hours',
        NOW() + INTERVAL '20 hours',
        'SCHEDULED'
    );
-- === Chain 5: Domestic US + International (N202UA) ===
INSERT INTO flights (
        flight_number,
        aircraft_id,
        origin_code,
        destination_code,
        scheduled_dep,
        scheduled_arr,
        actual_dep,
        actual_arr,
        status
    )
VALUES (
        'UA500',
        2,
        'LAX',
        'ORD',
        NOW() + INTERVAL '2 hours',
        NOW() + INTERVAL '6 hours',
        NOW() + INTERVAL '2 hours',
        NOW() + INTERVAL '6 hours',
        'SCHEDULED'
    ),
    (
        'UA501',
        2,
        'ORD',
        'CDG',
        NOW() + INTERVAL '7 hours',
        NOW() + INTERVAL '15 hours',
        NOW() + INTERVAL '7 hours',
        NOW() + INTERVAL '15 hours',
        'SCHEDULED'
    );
-- === Chain 6: Asia-Pacific (JA301A) ===
INSERT INTO flights (
        flight_number,
        aircraft_id,
        origin_code,
        destination_code,
        scheduled_dep,
        scheduled_arr,
        actual_dep,
        actual_arr,
        status
    )
VALUES (
        'NH801',
        7,
        'HND',
        'SIN',
        NOW() + INTERVAL '1 hour',
        NOW() + INTERVAL '8 hours',
        NOW() + INTERVAL '1 hour',
        NOW() + INTERVAL '8 hours',
        'SCHEDULED'
    ),
    (
        'NH802',
        7,
        'SIN',
        'SYD',
        NOW() + INTERVAL '9 hours',
        NOW() + INTERVAL '17 hours',
        NOW() + INTERVAL '9 hours',
        NOW() + INTERVAL '17 hours',
        'SCHEDULED'
    );
-- === Additional cross-connections ===
INSERT INTO flights (
        flight_number,
        aircraft_id,
        origin_code,
        destination_code,
        scheduled_dep,
        scheduled_arr,
        actual_dep,
        actual_arr,
        status
    )
VALUES (
        'QF001',
        8,
        'SYD',
        'LHR',
        NOW() + INTERVAL '3 hours',
        NOW() + INTERVAL '27 hours',
        NOW() + INTERVAL '3 hours',
        NOW() + INTERVAL '27 hours',
        'SCHEDULED'
    ),
    (
        'AF440',
        4,
        'CDG',
        'JFK',
        NOW() + INTERVAL '16 hours',
        NOW() + INTERVAL '24 hours',
        NOW() + INTERVAL '16 hours',
        NOW() + INTERVAL '24 hours',
        'SCHEDULED'
    ),
    (
        'SQ321',
        6,
        'SIN',
        'LHR',
        NOW() + INTERVAL '5 hours',
        NOW() + INTERVAL '18 hours',
        NOW() + INTERVAL '5 hours',
        NOW() + INTERVAL '18 hours',
        'SCHEDULED'
    );
-- -----------------------------------------------
-- 4. PASSENGERS
-- -----------------------------------------------
INSERT INTO passengers (first_name, last_name, email, phone)
VALUES (
        'James',
        'Wilson',
        'james.wilson@email.com',
        '+1-555-0101'
    ),
    (
        'Maria',
        'Santos',
        'maria.santos@email.com',
        '+55-11-9876-5432'
    ),
    (
        'Akira',
        'Tanaka',
        'akira.tanaka@email.com',
        '+81-3-1234-5678'
    ),
    (
        'Sophie',
        'Dubois',
        'sophie.dubois@email.com',
        '+33-1-2345-6789'
    ),
    (
        'Raj',
        'Patel',
        'raj.patel@email.com',
        '+91-98-7654-3210'
    ),
    (
        'Emily',
        'Chen',
        'emily.chen@email.com',
        '+65-9123-4567'
    ),
    (
        'Hans',
        'Mueller',
        'hans.mueller@email.com',
        '+49-69-1234-5678'
    ),
    (
        'Olivia',
        'Brown',
        'olivia.brown@email.com',
        '+44-20-7946-0958'
    ),
    (
        'Carlos',
        'Rivera',
        'carlos.rivera@email.com',
        '+1-555-0202'
    ),
    (
        'Aisha',
        'Khan',
        'aisha.khan@email.com',
        '+971-50-123-4567'
    ),
    (
        'Yuki',
        'Sato',
        'yuki.sato@email.com',
        '+81-90-1234-5678'
    ),
    (
        'Liam',
        'OConnor',
        'liam.oconnor@email.com',
        '+353-1-234-5678'
    );
-- -----------------------------------------------
-- 5. BOOKINGS (Passengers with connecting flights)
-- -----------------------------------------------
-- Phase 1: Insert all bookings with next_booking_id = NULL
-- (avoids FK constraint violations from forward references)
-- James: JFK->LHR (AA100) then LHR->FRA (AA101)
INSERT INTO bookings (
        id,
        passenger_id,
        flight_id,
        next_booking_id,
        status
    )
VALUES (1, 1, 1, NULL, 'CONFIRMED');
INSERT INTO bookings (
        id,
        passenger_id,
        flight_id,
        next_booking_id,
        status
    )
VALUES (2, 1, 2, NULL, 'CONFIRMED');
-- Maria: JFK->LHR (AA100) then LHR->DXB (BA205)
INSERT INTO bookings (
        id,
        passenger_id,
        flight_id,
        next_booking_id,
        status
    )
VALUES (3, 2, 1, NULL, 'CONFIRMED');
INSERT INTO bookings (
        id,
        passenger_id,
        flight_id,
        next_booking_id,
        status
    )
VALUES (4, 2, 3, NULL, 'CONFIRMED');
-- Sophie: LHR->DXB (BA205) then DXB->SIN (BA206)
INSERT INTO bookings (
        id,
        passenger_id,
        flight_id,
        next_booking_id,
        status
    )
VALUES (5, 4, 3, NULL, 'CONFIRMED');
INSERT INTO bookings (
        id,
        passenger_id,
        flight_id,
        next_booking_id,
        status
    )
VALUES (6, 4, 4, NULL, 'CONFIRMED');
-- Raj: FRA->DEL (LH756) then DEL->HND (LH757)
INSERT INTO bookings (
        id,
        passenger_id,
        flight_id,
        next_booking_id,
        status
    )
VALUES (7, 5, 5, NULL, 'CONFIRMED');
INSERT INTO bookings (
        id,
        passenger_id,
        flight_id,
        next_booking_id,
        status
    )
VALUES (8, 5, 6, NULL, 'CONFIRMED');
-- Emily: DXB->SIN (EK404) then SIN->SYD (EK405)
INSERT INTO bookings (
        id,
        passenger_id,
        flight_id,
        next_booking_id,
        status
    )
VALUES (9, 6, 7, NULL, 'CONFIRMED');
INSERT INTO bookings (
        id,
        passenger_id,
        flight_id,
        next_booking_id,
        status
    )
VALUES (10, 6, 8, NULL, 'CONFIRMED');
-- Hans: LAX->ORD (UA500) then ORD->CDG (UA501)
INSERT INTO bookings (
        id,
        passenger_id,
        flight_id,
        next_booking_id,
        status
    )
VALUES (11, 7, 9, NULL, 'CONFIRMED');
INSERT INTO bookings (
        id,
        passenger_id,
        flight_id,
        next_booking_id,
        status
    )
VALUES (12, 7, 10, NULL, 'CONFIRMED');
-- Olivia: LHR->DXB (BA205) then DXB->SIN (EK404) — cross-airline
INSERT INTO bookings (
        id,
        passenger_id,
        flight_id,
        next_booking_id,
        status
    )
VALUES (13, 8, 3, NULL, 'CONFIRMED');
INSERT INTO bookings (
        id,
        passenger_id,
        flight_id,
        next_booking_id,
        status
    )
VALUES (14, 8, 7, NULL, 'CONFIRMED');
-- Akira: HND->SIN (NH801) then SIN->SYD (NH802)
INSERT INTO bookings (
        id,
        passenger_id,
        flight_id,
        next_booking_id,
        status
    )
VALUES (15, 3, 11, NULL, 'CONFIRMED');
INSERT INTO bookings (
        id,
        passenger_id,
        flight_id,
        next_booking_id,
        status
    )
VALUES (16, 3, 12, NULL, 'CONFIRMED');
-- Carlos: LAX->ORD (UA500) — single leg
INSERT INTO bookings (
        id,
        passenger_id,
        flight_id,
        next_booking_id,
        status
    )
VALUES (17, 9, 9, NULL, 'CONFIRMED');
-- Aisha: DXB->SIN (BA206) then SIN->LHR (SQ321) — cross-airline
INSERT INTO bookings (
        id,
        passenger_id,
        flight_id,
        next_booking_id,
        status
    )
VALUES (18, 10, 4, NULL, 'CONFIRMED');
INSERT INTO bookings (
        id,
        passenger_id,
        flight_id,
        next_booking_id,
        status
    )
VALUES (19, 10, 15, NULL, 'CONFIRMED');
-- Yuki: HND->SIN (NH801) then SIN->LHR (SQ321)
INSERT INTO bookings (
        id,
        passenger_id,
        flight_id,
        next_booking_id,
        status
    )
VALUES (20, 11, 11, NULL, 'CONFIRMED');
INSERT INTO bookings (
        id,
        passenger_id,
        flight_id,
        next_booking_id,
        status
    )
VALUES (21, 11, 15, NULL, 'CONFIRMED');
-- Liam: SYD->LHR (QF001) — single long-haul leg
INSERT INTO bookings (
        id,
        passenger_id,
        flight_id,
        next_booking_id,
        status
    )
VALUES (22, 12, 13, NULL, 'CONFIRMED');
-- Phase 2: Now link connecting bookings via next_booking_id
-- (all rows exist, so FK constraints are satisfied)
UPDATE bookings
SET next_booking_id = 2
WHERE id = 1;
-- James leg 1 -> leg 2
UPDATE bookings
SET next_booking_id = 4
WHERE id = 3;
-- Maria leg 1 -> leg 2
UPDATE bookings
SET next_booking_id = 6
WHERE id = 5;
-- Sophie leg 1 -> leg 2
UPDATE bookings
SET next_booking_id = 8
WHERE id = 7;
-- Raj leg 1 -> leg 2
UPDATE bookings
SET next_booking_id = 10
WHERE id = 9;
-- Emily leg 1 -> leg 2
UPDATE bookings
SET next_booking_id = 12
WHERE id = 11;
-- Hans leg 1 -> leg 2
UPDATE bookings
SET next_booking_id = 14
WHERE id = 13;
-- Olivia leg 1 -> leg 2
UPDATE bookings
SET next_booking_id = 16
WHERE id = 15;
-- Akira leg 1 -> leg 2
UPDATE bookings
SET next_booking_id = 19
WHERE id = 18;
-- Aisha leg 1 -> leg 2
UPDATE bookings
SET next_booking_id = 21
WHERE id = 20;
-- Yuki leg 1 -> leg 2
-- Reset sequence counters after explicit ID inserts
SELECT setval(
        'bookings_id_seq',
        (
            SELECT MAX(id)
            FROM bookings
        )
    );