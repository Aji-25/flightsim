/**
 * AviationStack Integration Service
 * 
 * Fetches real flight delay/status data from AviationStack API.
 * Includes a token-bucket rate limiter to respect the free tier
 * (500 requests/month ≈ ~16/day ≈ 1 request per 90 minutes).
 * 
 * Strategy: Fetch batches of active flights, detect delays,
 * and upsert into a `flight_delays` table.
 */
require('dotenv').config();
const supabase = require('./db');

const API_KEY = process.env.AVIATIONSTACK_KEY;
if (!API_KEY) {
    console.error('❌ Missing AVIATIONSTACK_KEY in .env');
    process.exit(1);
}

const AVIATIONSTACK_BASE = 'http://api.aviationstack.com/v1';

// -----------------------------------------------
// Token Bucket Rate Limiter
// -----------------------------------------------
class RateLimiter {
    constructor({ maxTokens, refillRate, refillInterval }) {
        this.tokens = maxTokens;
        this.maxTokens = maxTokens;
        this.refillRate = refillRate; // tokens per refill
        this.refillInterval = refillInterval; // ms between refills
        this.lastRefill = Date.now();
    }

    refill() {
        const now = Date.now();
        const elapsed = now - this.lastRefill;
        const refills = Math.floor(elapsed / this.refillInterval);
        if (refills > 0) {
            this.tokens = Math.min(this.maxTokens, this.tokens + refills * this.refillRate);
            this.lastRefill = now;
        }
    }

    async acquire() {
        this.refill();
        if (this.tokens > 0) {
            this.tokens--;
            return true;
        }
        // Wait until next refill
        const waitMs = this.refillInterval - (Date.now() - this.lastRefill);
        console.log(`⏳ Rate limited. Waiting ${Math.round(waitMs / 1000)}s...`);
        await new Promise(resolve => setTimeout(resolve, waitMs));
        return this.acquire();
    }

    status() {
        this.refill();
        return { tokens: this.tokens, max: this.maxTokens };
    }
}

// Free tier: 500 req/month ≈ 16/day
// Conservative: 1 token per 5 minutes, max burst of 3
const limiter = new RateLimiter({
    maxTokens: 3,
    refillRate: 1,
    refillInterval: 5 * 60 * 1000, // 1 token every 5 minutes
});

// -----------------------------------------------
// Fetch Flights from AviationStack
// -----------------------------------------------
async function fetchFlightStatus(offset = 0) {
    await limiter.acquire();

    const url = `${AVIATIONSTACK_BASE}/flights?access_key=${API_KEY}&flight_status=active&limit=100&offset=${offset}`;
    console.log(`📡 Fetching flights (offset=${offset})... [Tokens: ${limiter.status().tokens}/${limiter.status().max}]`);

    const res = await fetch(url);
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`AviationStack error (${res.status}): ${text}`);
    }

    const data = await res.json();

    if (data.error) {
        throw new Error(`AviationStack API error: ${JSON.stringify(data.error)}`);
    }

    return data;
}

// -----------------------------------------------
// Detect Delays & Upsert
// -----------------------------------------------
async function processFlights(flights) {
    if (!flights || flights.length === 0) return 0;

    const delayedFlights = [];
    const allFlights = [];

    for (const f of flights) {
        const callsign = f.flight?.iata || f.flight?.icao || null;
        if (!callsign) continue;

        const depDelay = f.departure?.delay || 0;
        const arrDelay = f.arrival?.delay || 0;
        const maxDelay = Math.max(depDelay, arrDelay);

        const record = {
            callsign: callsign,
            airline_name: f.airline?.name || 'Unknown',
            airline_iata: f.airline?.iata || null,
            dep_airport: f.departure?.iata || null,
            dep_airport_name: f.departure?.airport || null,
            arr_airport: f.arrival?.iata || null,
            arr_airport_name: f.arrival?.airport || null,
            dep_scheduled: f.departure?.scheduled || null,
            dep_estimated: f.departure?.estimated || null,
            dep_actual: f.departure?.actual || null,
            arr_scheduled: f.arrival?.scheduled || null,
            arr_estimated: f.arrival?.estimated || null,
            arr_actual: f.arrival?.actual || null,
            dep_delay_min: depDelay,
            arr_delay_min: arrDelay,
            status: f.flight_status || 'unknown',
            updated_at: new Date().toISOString(),
        };

        allFlights.push(record);
        if (maxDelay > 0) delayedFlights.push(record);
    }

    // Upsert all flights
    if (allFlights.length > 0) {
        const { error } = await supabase
            .from('flight_delays')
            .upsert(allFlights, { onConflict: 'callsign' });

        if (error) {
            console.error('❌ Upsert error:', error.message);
        }
    }

    console.log(`  → ${allFlights.length} flights processed, ${delayedFlights.length} delayed`);
    return delayedFlights.length;
}

// -----------------------------------------------
// Main Poll Loop
// -----------------------------------------------
const POLL_INTERVAL = 10 * 60 * 1000; // 10 minutes (conservative for free tier)

async function pollOnce() {
    try {
        console.log(`\n🕐 [${new Date().toLocaleTimeString()}] Starting AviationStack poll...`);
        const data = await fetchFlightStatus(0);

        const totalResults = data.pagination?.total || 0;
        console.log(`  📊 Total active flights: ${totalResults}`);

        const delayed = await processFlights(data.data);
        console.log(`  ✅ Poll complete: ${delayed} delayed flights detected`);

    } catch (err) {
        console.error(`❌ [${new Date().toLocaleTimeString()}] Poll failed:`, err.message);
    }
}

// Start
console.log('🚀 AviationStack Delay Service starting...');
console.log(`   API Key: ${API_KEY.substring(0, 8)}...`);
console.log(`   Rate limit: ${limiter.maxTokens} burst, 1 token per 5min`);
console.log(`   Poll interval: ${POLL_INTERVAL / 60000} minutes`);
console.log('');

pollOnce();
const interval = setInterval(pollOnce, POLL_INTERVAL);

process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down AviationStack service...');
    clearInterval(interval);
    process.exit(0);
});

module.exports = { fetchFlightStatus, processFlights, limiter };
