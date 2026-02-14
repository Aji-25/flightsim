/**
 * OpenSky Network Live Data Ingestion Service
 * 
 * Fetches real-time aircraft state vectors from OpenSky Network API
 * and stores them in Supabase for the frontend to consume.
 * 
 * Authentication: OAuth2 Client Credentials Flow
 * Data: /states/all endpoint → live aircraft positions
 */
require('dotenv').config();
const supabase = require('./db');

// -----------------------------------------------
// Configuration
// -----------------------------------------------
const OPENSKY_TOKEN_URL = 'https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token';
const OPENSKY_API_BASE = 'https://opensky-network.org/api';
const POLL_INTERVAL_MS = 15_000; // 15 seconds (OpenSky rate limit friendly)

const CLIENT_ID = process.env.OPENSKY_CLIENT_ID;
const CLIENT_SECRET = process.env.OPENSKY_CLIENT_SECRET;

if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('❌ Missing OPENSKY_CLIENT_ID or OPENSKY_CLIENT_SECRET in .env');
    process.exit(1);
}

// -----------------------------------------------
// Token Management
// -----------------------------------------------
let accessToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
    // Reuse token if still valid (with 60s buffer)
    if (accessToken && Date.now() < tokenExpiresAt - 60_000) {
        return accessToken;
    }

    console.log('🔑 Requesting new OpenSky access token...');

    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
    });

    const res = await fetch(OPENSKY_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Token request failed (${res.status}): ${text}`);
    }

    const data = await res.json();
    accessToken = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in * 1000);
    console.log(`✅ Token acquired (expires in ${data.expires_in}s)`);
    return accessToken;
}

// -----------------------------------------------
// Fetch Live States from OpenSky
// -----------------------------------------------
async function fetchLiveStates() {
    const token = await getAccessToken();

    // Fetch all states — no bounding box filter (global view)
    const res = await fetch(`${OPENSKY_API_BASE}/states/all`, {
        headers: { 'Authorization': `Bearer ${token}` },
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`OpenSky API error (${res.status}): ${text}`);
    }

    const data = await res.json();
    return data; // { time, states: [[icao24, callsign, ...], ...] }
}

// -----------------------------------------------
// Parse OpenSky State Vector
// -----------------------------------------------
// State vector indices:
// 0: icao24, 1: callsign, 2: origin_country, 3: time_position,
// 4: last_contact, 5: longitude, 6: latitude, 7: baro_altitude,
// 8: on_ground, 9: velocity, 10: true_track, 11: vertical_rate,
// 12: sensors, 13: geo_altitude, 14: squawk, 15: spi, 16: position_source
function parseStateVector(sv) {
    return {
        icao24: sv[0],
        callsign: (sv[1] || '').trim(),
        origin_country: sv[2],
        longitude: sv[5],
        latitude: sv[6],
        altitude: sv[7] || sv[13] || 0,  // baro or geo altitude
        on_ground: sv[8],
        velocity: sv[9],    // m/s
        heading: sv[10],     // degrees from north
        vertical_rate: sv[11],
        last_contact: sv[4],
    };
}

// -----------------------------------------------
// Upsert into Supabase
// -----------------------------------------------
async function upsertLiveFlights(states) {
    if (!states || states.length === 0) {
        console.log('⚠️  No states received');
        return 0;
    }

    // Filter: only planes with valid position and a callsign
    const validStates = states
        .map(parseStateVector)
        .filter(s => s.callsign && s.latitude != null && s.longitude != null);

    console.log(`📡 Received ${states.length} total, ${validStates.length} with valid positions`);

    // Batch upsert in chunks of 500
    const CHUNK_SIZE = 500;
    let upserted = 0;

    for (let i = 0; i < validStates.length; i += CHUNK_SIZE) {
        const chunk = validStates.slice(i, i + CHUNK_SIZE).map(s => ({
            icao24: s.icao24,
            callsign: s.callsign,
            origin_country: s.origin_country,
            latitude: s.latitude,
            longitude: s.longitude,
            altitude_m: Math.round(s.altitude || 0),
            velocity_ms: s.velocity ? Math.round(s.velocity * 10) / 10 : null,
            heading: s.heading ? Math.round(s.heading * 10) / 10 : null,
            vertical_rate: s.vertical_rate ? Math.round(s.vertical_rate * 10) / 10 : null,
            on_ground: s.on_ground,
            last_contact: new Date(s.last_contact * 1000).toISOString(),
            updated_at: new Date().toISOString(),
        }));

        const { error } = await supabase
            .from('live_flights')
            .upsert(chunk, { onConflict: 'icao24' });

        if (error) {
            console.error(`❌ Upsert error (chunk ${i / CHUNK_SIZE}):`, error.message);
        } else {
            upserted += chunk.length;
        }
    }

    return upserted;
}

// -----------------------------------------------
// Cleanup stale entries (older than 5 min)
// -----------------------------------------------
async function cleanupStaleEntries() {
    const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { error, count } = await supabase
        .from('live_flights')
        .delete()
        .lt('updated_at', fiveMinAgo);

    if (error) {
        console.error('❌ Cleanup error:', error.message);
    } else if (count > 0) {
        console.log(`🧹 Cleaned ${count} stale entries`);
    }
}

// -----------------------------------------------
// Main Loop
// -----------------------------------------------
let isRunning = false;

async function pollOnce() {
    if (isRunning) return;
    isRunning = true;

    try {
        const data = await fetchLiveStates();
        const count = await upsertLiveFlights(data.states);
        console.log(`✈️  [${new Date().toLocaleTimeString()}] Updated ${count} live flights (API time: ${data.time})`);

        // Cleanup stale entries every cycle
        await cleanupStaleEntries();
    } catch (err) {
        console.error(`❌ [${new Date().toLocaleTimeString()}] Poll failed:`, err.message);
    } finally {
        isRunning = false;
    }
}

// Start polling
console.log('🚀 OpenSky Live Data Ingestion starting...');
console.log(`   Client ID: ${CLIENT_ID}`);
console.log(`   Poll interval: ${POLL_INTERVAL_MS / 1000}s`);
console.log('');

pollOnce();
const interval = setInterval(pollOnce, POLL_INTERVAL_MS);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down ingestion...');
    clearInterval(interval);
    process.exit(0);
});

module.exports = { pollOnce, fetchLiveStates };
