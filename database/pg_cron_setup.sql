-- =============================================================
-- pg_cron Setup for Autonomous Chaos Simulation
-- Run this in the Supabase SQL Editor after enabling pg_cron
-- =============================================================
-- Enable the pg_cron extension (already available in Supabase)
CREATE EXTENSION IF NOT EXISTS pg_cron;
-- Schedule chaos every 30 seconds: trigger a random delay
-- This calls the Edge Function which handles the chaos logic
-- Alternatively, you can call the PL/pgSQL function directly:
SELECT cron.schedule(
        'chaos-loop',
        -- job name
        '*/1 * * * *',
        -- every 1 minute (cron minimum)
        $$
        SELECT trigger_random_delay();
SELECT save_simulation_snapshot('Auto Chaos (cron)');
$$
);
-- Schedule flight status updates every 10 seconds
-- NOTE: pg_cron minimum interval is 1 minute. For sub-minute,
-- use the Edge Function + Supabase Realtime instead.
SELECT cron.schedule(
        'status-updater',
        '*/1 * * * *',
        $$SELECT update_flight_statuses();
$$
);
-- To view scheduled jobs:
-- SELECT * FROM cron.job;
-- To unschedule:
-- SELECT cron.unschedule('chaos-loop');
-- SELECT cron.unschedule('status-updater');