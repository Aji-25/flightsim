-- =============================================================
-- Flight Disruption Engine — Schema Extensions
-- Snapshots, Auth Roles, Presence
-- =============================================================
-- -----------------------------------------------
-- Simulation Snapshots (Historical Replay)
-- -----------------------------------------------
CREATE TABLE simulation_snapshots (
    id SERIAL PRIMARY KEY,
    label VARCHAR(255) DEFAULT 'Auto Snapshot',
    flights_data JSONB NOT NULL,
    missed_connections_data JSONB DEFAULT '[]',
    metrics JSONB NOT NULL,
    event_feed JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX idx_snapshots_created ON simulation_snapshots(created_at DESC);
-- -----------------------------------------------
-- User Roles (Auth + RBAC)
-- -----------------------------------------------
CREATE TABLE user_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    display_name TEXT NOT NULL DEFAULT 'Ops Controller',
    role TEXT NOT NULL DEFAULT 'viewer' CHECK (role IN ('admin', 'viewer')),
    avatar_url TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION handle_new_user() RETURNS TRIGGER AS $$ BEGIN
INSERT INTO public.user_profiles (id, email, display_name, role)
VALUES (
        NEW.id,
        NEW.email,
        COALESCE(
            NEW.raw_user_meta_data->>'display_name',
            split_part(NEW.email, '@', 1)
        ),
        'viewer' -- Always default to viewer; admins must be promoted manually
    );
RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE OR REPLACE TRIGGER on_auth_user_created
AFTER
INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user();
-- RLS Policies
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view all profiles" ON user_profiles FOR
SELECT USING (true);
CREATE POLICY "Users can update own profile" ON user_profiles FOR
UPDATE USING (auth.uid() = id);
-- Snapshot RLS
ALTER TABLE simulation_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Anyone can read snapshots" ON simulation_snapshots FOR
SELECT USING (true);
CREATE POLICY "Admins can create snapshots" ON simulation_snapshots FOR
INSERT WITH CHECK (true);
-- -----------------------------------------------
-- PL/pgSQL: Save Snapshot
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION save_simulation_snapshot(p_label TEXT DEFAULT 'Auto Snapshot') RETURNS INT AS $$
DECLARE v_snapshot_id INT;
v_flights JSONB;
v_missed JSONB;
v_metrics JSONB;
BEGIN -- Capture current flights
SELECT COALESCE(jsonb_agg(row_to_json(f)), '[]'::jsonb) INTO v_flights
FROM flights f;
-- Capture missed connections
SELECT COALESCE(
        jsonb_agg(
            json_build_object(
                'booking_id',
                b.id,
                'passenger_name',
                p.first_name || ' ' || p.last_name,
                'from_flight',
                f1.flight_number,
                'missed_flight',
                f2.flight_number
            )
        ),
        '[]'::jsonb
    ) INTO v_missed
FROM bookings b
    JOIN passengers p ON b.passenger_id = p.id
    JOIN flights f1 ON b.flight_id = f1.id
    LEFT JOIN bookings b2 ON b.next_booking_id = b2.id
    LEFT JOIN flights f2 ON b2.flight_id = f2.id
WHERE b.status = 'MISSED_CONNECTION';
-- Compute metrics
SELECT json_build_object(
        'delayed_flights',
        (
            SELECT COUNT(*)
            FROM flights
            WHERE status = 'DELAYED'
        ),
        'missed_connections',
        (
            SELECT COUNT(*)
            FROM bookings
            WHERE status = 'MISSED_CONNECTION'
        ),
        'total_delay_minutes',
        COALESCE(
            (
                SELECT SUM(delay_minutes)
                FROM flights
                WHERE status = 'DELAYED'
            ),
            0
        ),
        'impacted_passengers',
        (
            SELECT COUNT(DISTINCT passenger_id)
            FROM bookings
            WHERE status = 'MISSED_CONNECTION'
        )
    )::jsonb INTO v_metrics;
INSERT INTO simulation_snapshots (
        label,
        flights_data,
        missed_connections_data,
        metrics
    )
VALUES (p_label, v_flights, v_missed, v_metrics)
RETURNING id INTO v_snapshot_id;
RETURN v_snapshot_id;
END;
$$ LANGUAGE plpgsql;