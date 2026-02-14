// Supabase Edge Function: Chaos Simulator
// Runs as a serverless function — can be triggered by pg_cron or HTTP
// Deno runtime (Supabase Edge Functions use Deno)

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SCENARIOS = {
    snowstorm_jfk: {
        label: 'Snowstorm at JFK',
        airport: 'JFK',
        delays: [120, 180, 240],
        cause: 'Heavy snowstorm — JFK ground stop',
    },
    crew_strike_lhr: {
        label: 'Crew Strike at LHR',
        airport: 'LHR',
        delays: [90, 150, 200],
        cause: 'Cabin crew industrial action — LHR',
    },
    fog_cdg: {
        label: 'Dense Fog at CDG',
        airport: 'CDG',
        delays: [60, 90, 120],
        cause: 'Dense fog — CDG low visibility operations',
    },
    atc_failure_fra: {
        label: 'ATC System Failure at FRA',
        airport: 'FRA',
        delays: [100, 140, 180],
        cause: 'ATC radar system failure — FRA ground stop',
    },
    typhoon_hnd: {
        label: 'Typhoon near HND',
        airport: 'HND',
        delays: [180, 240, 300],
        cause: 'Typhoon approach — HND departures suspended',
    },
};

serve(async (req) => {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
        return new Response('ok', { headers: corsHeaders });
    }

    try {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const supabase = createClient(supabaseUrl, supabaseKey);

        let mode = 'random'; // default: trigger a random delay
        let scenarioId = null;

        // Parse request body if present
        if (req.method === 'POST') {
            try {
                const body = await req.json();
                mode = body.mode || 'random';
                scenarioId = body.scenario || null;
            } catch {
                // No body — use defaults (e.g., cron invocation)
            }
        }

        const results = [];

        if (mode === 'scenario' && scenarioId && SCENARIOS[scenarioId]) {
            // Named scenario
            const config = SCENARIOS[scenarioId];

            const { data: departures } = await supabase
                .from('flights')
                .select('id, flight_number')
                .eq('origin_code', config.airport)
                .in('status', ['SCHEDULED', 'BOARDING', 'ACTIVE']);

            for (const flight of (departures || [])) {
                const delay = config.delays[Math.floor(Math.random() * config.delays.length)];
                const { error } = await supabase.rpc('calculate_blast_radius', {
                    p_flight_id: flight.id,
                    p_delay_minutes: delay,
                    p_cause: config.cause,
                    p_cascaded_from: null,
                    p_depth: 0,
                });
                if (!error) results.push({ flight: flight.flight_number, delay });
            }

            // Arrivals (shorter delays)
            const { data: arrivals } = await supabase
                .from('flights')
                .select('id, flight_number')
                .eq('destination_code', config.airport)
                .in('status', ['SCHEDULED', 'BOARDING', 'ACTIVE']);

            for (const flight of (arrivals || [])) {
                const delay = Math.floor(config.delays[0] * 0.5);
                const { error } = await supabase.rpc('calculate_blast_radius', {
                    p_flight_id: flight.id,
                    p_delay_minutes: delay,
                    p_cause: `${config.cause} (arrival hold)`,
                    p_cascaded_from: null,
                    p_depth: 0,
                });
                if (!error) results.push({ flight: flight.flight_number, delay });
            }
        } else {
            // Random delay — pick a random active flight
            const { error } = await supabase.rpc('trigger_random_delay');
            if (error) throw error;
            results.push({ mode: 'random', triggered: true });
        }

        // Save a snapshot after chaos
        await supabase.rpc('save_simulation_snapshot', {
            p_label: mode === 'scenario'
                ? `Chaos: ${SCENARIOS[scenarioId]?.label || scenarioId}`
                : 'Auto Chaos (cron)',
        });

        // Update flight statuses
        await supabase.rpc('update_flight_statuses');

        return new Response(
            JSON.stringify({
                success: true,
                mode,
                scenario: scenarioId,
                flights_affected: results.length,
                details: results,
                timestamp: new Date().toISOString(),
            }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 200,
            }
        );
    } catch (err) {
        return new Response(
            JSON.stringify({ error: err.message }),
            {
                headers: { ...corsHeaders, 'Content-Type': 'application/json' },
                status: 500,
            }
        );
    }
});
