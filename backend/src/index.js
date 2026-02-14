const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
require('dotenv').config();

const supabase = require('./db');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST']
    }
});

app.use(cors({
    origin: '*', // Allow all origins (for now) to fix CORS issues
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// -----------------------------------------------
// Auth Middleware — Supabase JWT verification
// -----------------------------------------------
async function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        req.user = null;
        return next(); // Allow unauthenticated for viewing
    }

    const token = authHeader.replace('Bearer ', '');
    try {
        const { data: { user }, error } = await supabase.auth.getUser(token);
        if (error || !user) {
            req.user = null;
            return next();
        }

        // Fetch role from user_profiles
        const { data: profile } = await supabase
            .from('user_profiles')
            .select('role, display_name, avatar_url')
            .eq('id', user.id)
            .single();

        req.user = {
            id: user.id,
            email: user.email,
            role: profile?.role || 'viewer',
            display_name: profile?.display_name || user.email?.split('@')[0],
            avatar_url: profile?.avatar_url,
        };
        next();
    } catch (err) {
        req.user = null;
        next();
    }
}

// Require admin role
function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

app.use(authMiddleware);

// -----------------------------------------------
// Helpers
// -----------------------------------------------

async function fetchWorldState() {
    const { data: flights } = await supabase
        .from('flights')
        .select(`
            id, flight_number, origin_code, destination_code,
            scheduled_dep, scheduled_arr, actual_dep, actual_arr,
            delay_minutes, status,
            origin:origin_code ( lat, lng ),
            destination:destination_code ( lat, lng )
        `);

    const flatFlights = (flights || []).map(f => ({
        ...f,
        origin_lat: f.origin?.lat, origin_lng: f.origin?.lng,
        dest_lat: f.destination?.lat, dest_lng: f.destination?.lng,
        origin: undefined, destination: undefined,
    }));

    // Missed connections
    const { data: missedBookings } = await supabase
        .from('bookings')
        .select(`
            id,
            passenger:passenger_id ( first_name, last_name ),
            flight:flight_id ( flight_number, destination_code ),
            next_booking_id
        `)
        .eq('status', 'MISSED_CONNECTION')
        .not('next_booking_id', 'is', null);

    const missedConnections = [];
    for (const b of (missedBookings || [])) {
        const { data: nextBooking } = await supabase
            .from('bookings')
            .select(`flight:flight_id ( flight_number, destination_code )`)
            .eq('id', b.next_booking_id)
            .single();

        const connCode = b.flight?.destination_code;
        const destCode = nextBooking?.flight?.destination_code;

        const { data: ca } = connCode
            ? await supabase.from('airports').select('lat, lng').eq('code', connCode).single()
            : { data: null };
        const { data: da } = destCode
            ? await supabase.from('airports').select('lat, lng').eq('code', destCode).single()
            : { data: null };

        missedConnections.push({
            booking_id: b.id,
            first_name: b.passenger?.first_name,
            last_name: b.passenger?.last_name,
            from_flight: b.flight?.flight_number,
            connection_airport: connCode,
            missed_flight: nextBooking?.flight?.flight_number,
            missed_dest: destCode,
            connection_lat: ca?.lat, connection_lng: ca?.lng,
            missed_dest_lat: da?.lat, missed_dest_lng: da?.lng,
        });
    }

    // Metrics
    const { count: delayedCount } = await supabase
        .from('flights').select('*', { count: 'exact', head: true }).eq('status', 'DELAYED');
    const { count: missedCount } = await supabase
        .from('bookings').select('*', { count: 'exact', head: true }).eq('status', 'MISSED_CONNECTION');
    const { data: delaySum } = await supabase
        .from('flights').select('delay_minutes').eq('status', 'DELAYED');
    const totalDelay = (delaySum || []).reduce((s, f) => s + (f.delay_minutes || 0), 0);
    const { data: impactedPax } = await supabase
        .from('bookings').select('passenger_id').eq('status', 'MISSED_CONNECTION');
    const uniquePax = new Set((impactedPax || []).map(b => b.passenger_id));

    // Cost estimation
    const strandedCount = uniquePax.size;
    const hotelCost = strandedCount * 150;
    const rebookingCost = strandedCount * 200;
    const crewOvertimeCost = Math.round((totalDelay / 60) * 6 * 85);
    const operationalCost = totalDelay * 75;
    const estimatedCost = hotelCost + rebookingCost + crewOvertimeCost + operationalCost;

    return {
        flights: flatFlights,
        missedConnections,
        metrics: {
            delayed_flights: delayedCount || 0,
            missed_connections: missedCount || 0,
            total_delay_minutes: totalDelay,
            impacted_passengers: uniquePax.size,
            estimated_cost: estimatedCost,
        },
        timestamp: new Date(),
    };
}

// -----------------------------------------------
// Live Flight Data (OpenSky)
// -----------------------------------------------
app.get('/api/live-flights', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('live_flights')
            .select('*')
            .eq('on_ground', false)
            .order('updated_at', { ascending: false })
            .limit(2000);

        if (error) throw error;
        res.json({ flights: data || [], count: (data || []).length });
    } catch (err) {
        console.error('Live flights error:', err);
        res.status(500).json({ error: 'Failed to fetch live flights' });
    }
});

app.get('/api/live-flights/stats', async (req, res) => {
    try {
        const { count: totalInAir } = await supabase
            .from('live_flights')
            .select('*', { count: 'exact', head: true })
            .eq('on_ground', false);

        const { count: totalOnGround } = await supabase
            .from('live_flights')
            .select('*', { count: 'exact', head: true })
            .eq('on_ground', true);

        const { data: countries } = await supabase
            .from('live_flights')
            .select('origin_country')
            .eq('on_ground', false);

        const uniqueCountries = new Set((countries || []).map(c => c.origin_country));

        res.json({
            in_air: totalInAir || 0,
            on_ground: totalOnGround || 0,
            countries: uniqueCountries.size,
        });
    } catch (err) {
        console.error('Live stats error:', err);
        res.status(500).json({ error: 'Failed to fetch live stats' });
    }
});

// -----------------------------------------------
// Live Metrics for Navbar (live mode)
// -----------------------------------------------
app.get('/api/live-metrics', async (req, res) => {
    try {
        // Count delayed flights
        const { count: delayedCount } = await supabase
            .from('flight_delays')
            .select('*', { count: 'exact', head: true })
            .gt('dep_delay_min', 0);

        // Sum total delay minutes
        const { data: delayData } = await supabase
            .from('flight_delays')
            .select('dep_delay_min')
            .gt('dep_delay_min', 0);
        const totalDelayMin = (delayData || []).reduce((s, d) => s + (d.dep_delay_min || 0), 0);

        // Count total bookings & flights
        const { count: totalPax } = await supabase
            .from('live_bookings')
            .select('*', { count: 'exact', head: true });

        const { count: totalFlights } = await supabase
            .from('live_flights')
            .select('*', { count: 'exact', head: true });

        // Estimate impacted passengers (avg passengers per flight × delayed flights)
        const avgPaxPerFlight = totalFlights > 0 ? Math.round((totalPax || 0) / totalFlights) : 120;
        const impactedPax = (delayedCount || 0) * avgPaxPerFlight;

        // Estimated cost: $75/min delay + $200/pax for delays > 120 min
        const longDelayFlights = (delayData || []).filter(d => d.dep_delay_min > 120).length;
        const cost = totalDelayMin * 75 + longDelayFlights * avgPaxPerFlight * 200;

        res.json({
            delayed_flights: delayedCount || 0,
            missed_connections: Math.floor((delayedCount || 0) * 0.3), // ~30% cause missed connections
            impacted_passengers: impactedPax,
            total_delay_minutes: totalDelayMin,
            estimated_cost: cost,
            total_flights_tracked: totalFlights || 0,
            total_passengers: totalPax || 0,
        });
    } catch (err) {
        console.error('Live metrics error:', err);
        res.status(500).json({ error: 'Failed to fetch live metrics' });
    }
});

// -----------------------------------------------
// Live Event Feed — Recent delay events for feed overlay
// -----------------------------------------------
app.get('/api/live-events', async (req, res) => {
    try {
        const { data: delays, error } = await supabase
            .from('flight_delays')
            .select('*')
            .gt('dep_delay_min', 0)
            .order('updated_at', { ascending: false })
            .limit(50);

        if (error) throw error;

        const events = (delays || []).map((d, i) => {
            // Derive a cause from delay magnitude
            let cause = 'Operational Delay';
            if (d.dep_delay_min > 180) cause = 'Severe Weather / ATC Hold';
            else if (d.dep_delay_min > 120) cause = 'Mechanical Issue';
            else if (d.dep_delay_min > 60) cause = 'Late Aircraft / Crew';
            else if (d.dep_delay_min > 30) cause = 'ATC Congestion';

            return {
                id: i + 1,
                flight_number: d.callsign || 'Unknown',
                delay_minutes: d.dep_delay_min || 0,
                cause,
                cascaded: false,
                passengers_impacted: 0,
                flights_impacted: 0,
                origin_code: d.dep_airport || '',
                destination_code: d.arr_airport || '',
                created_at: d.updated_at || new Date().toISOString(),
            };
        });

        res.json({ events });
    } catch (err) {
        console.error('Live events error:', err);
        res.status(500).json({ error: 'Failed to fetch live events' });
    }
});

// -----------------------------------------------
// Live Analytics — Aggregated data from flight_delays for charts
// -----------------------------------------------
app.get('/api/live-analytics', async (req, res) => {
    try {
        const { data: delays, error } = await supabase
            .from('flight_delays')
            .select('*')
            .gt('dep_delay_min', 0)
            .order('dep_delay_min', { ascending: false })
            .limit(500);

        if (error) throw error;
        const allDelays = delays || [];

        // 1. Disruption by hour (from dep_scheduled)
        const hourCounts = new Array(24).fill(0);
        allDelays.forEach(d => {
            if (d.dep_scheduled) {
                const hour = new Date(d.dep_scheduled).getHours();
                hourCounts[hour]++;
            }
        });

        // 2. Airport stats
        const airportMap = {};
        allDelays.forEach(d => {
            const code = d.dep_airport;
            if (!code) return;
            if (!airportMap[code]) airportMap[code] = { code, delay_count: 0, total_delay: 0 };
            airportMap[code].delay_count++;
            airportMap[code].total_delay += d.dep_delay_min || 0;
        });

        // 3. Build disruption_log-like entries for charts
        const disruption_log = allDelays.map((d, i) => ({
            id: i + 1,
            flight_number: d.callsign || 'Unknown',
            delay_minutes: d.dep_delay_min || 0,
            cause: d.dep_delay_min > 120 ? 'Severe Delay' : 'Operational',
            cascaded_from_flight_id: null,
            passengers_impacted: 0,
            flights_impacted: 0,
            origin_code: d.dep_airport || '',
            destination_code: d.arr_airport || '',
            created_at: d.updated_at || d.dep_scheduled || new Date().toISOString(),
        }));

        // 4. Fake snapshot-like cost trend from the data sorted by time
        const sorted = [...allDelays]
            .filter(d => d.dep_scheduled)
            .sort((a, b) => new Date(a.dep_scheduled).getTime() - new Date(b.dep_scheduled).getTime());

        let cumulativeCost = 0;
        const snapshots = [];
        // Group into ~12 buckets for nice chart
        const bucketSize = Math.max(1, Math.floor(sorted.length / 12));
        for (let i = 0; i < sorted.length; i += bucketSize) {
            const bucket = sorted.slice(i, i + bucketSize);
            bucket.forEach(d => {
                cumulativeCost += (d.dep_delay_min || 0) * 75;
            });
            const lastItem = bucket[bucket.length - 1];
            snapshots.push({
                id: snapshots.length + 1,
                label: `Batch ${snapshots.length + 1}`,
                created_at: lastItem.dep_scheduled || new Date().toISOString(),
                metrics: {
                    delayed_flights: i + bucket.length,
                    missed_connections: 0,
                    total_delay_minutes: bucket.reduce((s, d) => s + (d.dep_delay_min || 0), 0),
                    impacted_passengers: bucket.length * 120,
                    estimated_cost: cumulativeCost,
                },
            });
        }

        res.json({
            disruption_log,
            airport_stats: Object.values(airportMap),
            snapshots,
        });
    } catch (err) {
        console.error('Live analytics error:', err);
        res.status(500).json({ error: 'Failed to fetch live analytics' });
    }
});

// -----------------------------------------------
// Delayed Routes — lat/lng data for drawing red arcs on live map
// -----------------------------------------------

// Comprehensive airport coordinates (covers major worldwide airports)
const AIRPORT_COORDS = {
    // North America
    JFK: [40.6413, -73.7781], LAX: [33.9425, -118.4081], ORD: [41.9742, -87.9073], ATL: [33.6407, -84.4277],
    DFW: [32.8998, -97.0403], DEN: [39.8561, -104.6737], SFO: [37.6213, -122.379], SEA: [47.4502, -122.3088],
    MIA: [25.7959, -80.287], BOS: [42.3656, -71.0096], IAH: [29.9902, -95.3368], EWR: [40.6895, -74.1745],
    MSP: [44.8848, -93.2223], DTW: [42.2124, -83.3534], PHL: [39.8721, -75.2411], CLT: [35.214, -80.9431],
    MCO: [28.4312, -81.308], LGA: [40.7772, -73.8726], FLL: [26.0726, -80.1527], BWI: [39.1754, -76.6683],
    IAD: [38.9531, -77.4565], SLC: [40.7884, -111.9778], SAN: [32.7336, -117.1897], TPA: [27.9755, -82.5332],
    PDX: [45.5898, -122.5951], STL: [38.7487, -90.3700], AUS: [30.1975, -97.6664], RDU: [35.8776, -78.7875],
    MCI: [39.2976, -94.7139], BNA: [36.1263, -86.6774], SMF: [38.6954, -121.5908], SNA: [33.6762, -117.8674],
    HNL: [21.3187, -157.9225], ANC: [61.1743, -149.9962],
    // Mexico / Caribbean
    MEX: [19.4361, -99.0719], CUN: [21.0365, -86.877], GDL: [20.5218, -103.3113],
    // Canada
    YYZ: [43.6777, -79.6248], YVR: [49.1967, -123.1815], YUL: [45.4706, -73.7408], YOW: [45.3225, -75.6692],
    YYC: [51.1215, -114.0076], YEG: [53.3097, -113.5797],
    // Europe
    LHR: [51.47, -0.4543], CDG: [49.0097, 2.5479], FRA: [50.0379, 8.5622], AMS: [52.3086, 4.7639],
    MAD: [40.4936, -3.5668], BCN: [41.2971, 2.0785], FCO: [41.8003, 12.2389], MXP: [45.63, 8.7231],
    MUC: [48.3538, 11.775], ZRH: [47.4647, 8.5492], VIE: [48.1103, 16.5697], BRU: [50.9014, 4.4844],
    LIS: [38.7742, -9.1342], CPH: [55.618, 12.656], OSL: [60.1976, 11.1004], ARN: [59.6519, 17.9186],
    HEL: [60.3172, 24.9633], DUB: [53.4213, -6.2701], WAW: [52.1672, 20.9679], PRG: [50.1008, 14.26],
    BUD: [47.4369, 19.2556], ATH: [37.9364, 23.9445], IST: [41.2753, 28.7519], SAW: [40.8986, 29.3092],
    LGW: [51.1537, -0.1821], STN: [51.885, 0.235], MAN: [53.3537, -2.275], EDI: [55.95, -3.3725],
    GVA: [46.238, 6.1089], NCE: [43.6584, 7.2159], LYS: [45.7266, 5.0909], TXL: [52.5597, 13.2877],
    SVO: [55.9726, 37.4146], DME: [55.4088, 37.9063], LED: [59.8003, 30.2625],
    // Middle East
    DXB: [25.2532, 55.3657], AUH: [24.4539, 54.6513], DOH: [25.2731, 51.6081], RUH: [24.9576, 46.6988],
    JED: [21.6796, 39.1565], MCT: [23.5933, 58.2844], AMM: [31.7226, 35.9932], BAH: [26.2708, 50.6336],
    KWI: [29.2266, 47.9689], TLV: [32.0055, 34.8854],
    // Asia
    HND: [35.5494, 139.7798], NRT: [35.7647, 140.3864], ICN: [37.4602, 126.4407], GMP: [37.5583, 126.7906],
    PEK: [40.0799, 116.6031], PVG: [31.1434, 121.8052], CAN: [23.3924, 113.2988], HKG: [22.308, 113.9185],
    TPE: [25.0797, 121.2342], SIN: [1.3644, 103.9915], KUL: [2.7456, 101.7099], BKK: [13.6899, 100.7501],
    DMK: [13.9126, 100.6068], CGK: [-6.1256, 106.6559], MNL: [14.5086, 121.0198], SGN: [10.8188, 106.6519],
    HAN: [21.2212, 105.807], DEL: [28.5562, 77.1], BOM: [19.0896, 72.8656], BLR: [13.1979, 77.7063],
    MAA: [12.99, 80.1693], CCU: [22.6547, 88.4467], DAC: [23.8433, 90.3978], CMB: [7.1808, 79.8841],
    KTM: [27.6966, 85.3591],
    // Central Asia
    IKT: [52.268, 104.389], KHV: [48.528, 135.188], VVO: [43.396, 132.148],
    // Africa
    JNB: [26.1392, 28.2460], CPT: [-33.9648, 18.6017], NBO: [-1.3192, 36.9278], ADD: [8.9779, 38.7993],
    CAI: [30.1219, 31.4056], CMN: [33.3675, -7.5898], ALG: [36.691, 3.2155], LOS: [6.5774, 3.3212],
    ACC: [5.6052, -0.1668], DSS: [14.7397, -17.4902],
    // South America
    GRU: [-23.4356, -46.4731], GIG: [-22.81, -43.2506], EZE: [-34.8222, -58.5358], SCL: [-33.393, -70.7858],
    LIM: [-12.0219, -77.1143], BOG: [4.7016, -74.1469], UIO: [-0.1292, -78.3575],
    // Oceania
    SYD: [-33.9399, 151.1753], MEL: [-37.6733, 144.8433], BNE: [-27.3842, 153.1175],
    AKL: [-37.0082, 174.7917], WLG: [-41.3272, 174.8053],
    // Russia
    VKO: [55.5915, 37.2615], OVB: [55.0116, 82.6508], SVX: [56.743, 60.8027],
    KZN: [55.6062, 49.2787], ROV: [47.4939, 39.9244], AER: [43.4499, 39.9566],
    // India continued
    HYD: [17.2403, 78.4294], COK: [10.152, 76.4019], GOI: [15.3808, 73.8314],
    AMD: [23.0772, 72.6347], JAI: [26.8242, 75.8122], LKO: [26.7606, 80.8893],
    // Japan continued  
    KIX: [34.4347, 135.244], CTS: [42.7752, 141.6924], FUK: [33.5859, 130.4507],
    NGO: [34.8584, 136.8055], OKA: [26.1958, 127.6459],
    // South Korea
    PUS: [35.1795, 128.9382], CJU: [33.5113, 126.4929],
    // Southeast Asia
    DPS: [-8.7482, 115.1672], SUB: [-7.3798, 112.787], REP: [13.4107, 103.8131],
    RGN: [16.9073, 96.1332], PNH: [11.5466, 104.8441], VTE: [17.9883, 102.5633],
    // China continued
    SZX: [22.6393, 113.8107], CTU: [30.5785, 103.9471], CKG: [29.7192, 106.6417],
    XIY: [34.4471, 108.7516], KMG: [25.1019, 102.9293], WUH: [30.7838, 114.208],
    NKG: [31.742, 118.862], TSN: [39.1244, 117.3462], HGH: [30.2295, 120.4344],
    TAO: [36.2661, 120.3744], DLC: [38.9657, 121.5386], SHE: [41.6398, 123.4834],
    // Pacific
    PPT: [-17.5537, -149.6115], NAN: [-17.7554, 177.4431], APW: [-13.826, -171.998],
    // Caribbean
    SJU: [18.4394, -66.0018], NAS: [25.039, -77.4662], MBJ: [18.5037, -77.9134],
    PUJ: [18.5674, -68.3634], SDQ: [18.4297, -69.6689], HAV: [22.9892, -82.4091],
    // Misc
    FIH: [-4.3858, 15.4446], RAI: [14.9245, -23.4935], VXE: [16.8332, -25.0553],
    MDK: [-0.0226, 18.2887], CUR: [12.1889, -68.9598],
    // Pakistan
    ISB: [33.6167, 72.8], KHI: [24.9065, 67.1609], LHE: [31.5216, 74.4036],
    // More Middle East
    SHJ: [25.3286, 55.5172], DWC: [24.8967, 55.1614],
    // More Europe
    OTP: [44.5711, 26.085], SOF: [42.6952, 23.4062], BEG: [44.8184, 20.309],
    ZAG: [45.7429, 16.0688], LJU: [46.2237, 14.4576], SKP: [41.9616, 21.6214],
    TIA: [41.4147, 19.7206],
};

app.get('/api/delayed-routes', async (req, res) => {
    try {
        const { data: delays, error } = await supabase
            .from('flight_delays')
            .select('callsign, airline_name, dep_airport, arr_airport, dep_delay_min, arr_delay_min')
            .gt('dep_delay_min', 0)
            .order('dep_delay_min', { ascending: false })
            .limit(80);

        if (error) throw error;
        const allDelays = delays || [];

        // Build routes with coordinates from the embedded lookup
        const routes = allDelays
            .filter(d => AIRPORT_COORDS[d.dep_airport] && AIRPORT_COORDS[d.arr_airport])
            .map(d => ({
                callsign: d.callsign,
                airline_name: d.airline_name,
                dep_airport: d.dep_airport,
                arr_airport: d.arr_airport,
                dep_delay_min: d.dep_delay_min,
                arr_delay_min: d.arr_delay_min,
                dep_lat: AIRPORT_COORDS[d.dep_airport][0],
                dep_lng: AIRPORT_COORDS[d.dep_airport][1],
                arr_lat: AIRPORT_COORDS[d.arr_airport][0],
                arr_lng: AIRPORT_COORDS[d.arr_airport][1],
            }));

        res.json({ routes, total_delayed: allDelays.length, routes_with_coords: routes.length });
    } catch (err) {
        console.error('Delayed routes error:', err);
        res.status(500).json({ error: 'Failed to fetch delayed routes' });
    }
});

// -----------------------------------------------
// Delayed Flights with Passenger Impact
// -----------------------------------------------
app.get('/api/delayed-flights', async (req, res) => {
    try {
        // Get delayed flights from AviationStack data
        const { data: delayed, error: dErr } = await supabase
            .from('flight_delays')
            .select('*')
            .gt('dep_delay_min', 0)
            .order('dep_delay_min', { ascending: false })
            .limit(50);

        if (dErr) throw dErr;

        // Get global booking stats for estimation
        const { count: totalBookings } = await supabase
            .from('live_bookings')
            .select('*', { count: 'exact', head: true });
        const { count: totalFlights } = await supabase
            .from('live_flights')
            .select('*', { count: 'exact', head: true });

        const avgPax = totalFlights > 0 ? Math.round((totalBookings || 0) / totalFlights) : 120;

        // Get a random sample pool of passengers for display
        const { data: samplePool } = await supabase
            .from('live_bookings')
            .select('seat, booking_class, passengers!inner(first_name, last_name, email)')
            .limit(200);

        // Enrich each delayed flight with estimated passenger impact
        let poolIdx = 0;
        const enriched = (delayed || []).map(flight => {
            // Assign 5 sample passengers from the pool for display
            const samples = [];
            for (let i = 0; i < 5 && poolIdx < (samplePool || []).length; i++, poolIdx++) {
                const b = samplePool[poolIdx];
                samples.push({
                    name: `${b.passengers.first_name} ${b.passengers.last_name}`,
                    email: b.passengers.email,
                    seat: b.seat,
                    class: b.booking_class,
                });
            }

            return {
                ...flight,
                affected_passengers: avgPax,
                sample_passengers: samples,
            };
        });

        const totalAffected = enriched.reduce((s, f) => s + f.affected_passengers, 0);

        res.json({
            delayed_flights: enriched,
            total_delayed: enriched.length,
            total_passengers_affected: totalAffected,
        });
    } catch (err) {
        console.error('Delayed flights error:', err);
        res.status(500).json({ error: 'Failed to fetch delayed flights' });
    }
});

app.get('/api/passenger-impact/:callsign', async (req, res) => {
    try {
        const { callsign } = req.params;

        // Get all passengers on this flight
        const { data: bookings, error: bErr } = await supabase
            .from('live_bookings')
            .select('id, seat, booking_class, status, passengers!inner(first_name, last_name, email, phone)')
            .eq('callsign', callsign)
            .order('booking_class');

        if (bErr) throw bErr;

        // Get flight status
        const { data: flightInfo } = await supabase
            .from('flight_delays')
            .select('*')
            .eq('callsign', callsign)
            .single();

        const passengers = (bookings || []).map(b => ({
            id: b.id,
            name: `${b.passengers.first_name} ${b.passengers.last_name}`,
            email: b.passengers.email,
            phone: b.passengers.phone,
            seat: b.seat,
            class: b.booking_class,
            status: b.status,
        }));

        res.json({
            flight: flightInfo,
            passengers,
            total: passengers.length,
            by_class: {
                first: passengers.filter(p => p.class === 'First').length,
                business: passengers.filter(p => p.class === 'Business').length,
                premium_economy: passengers.filter(p => p.class === 'Premium Economy').length,
                economy: passengers.filter(p => p.class === 'Economy').length,
            },
        });
    } catch (err) {
        console.error('Passenger impact error:', err);
        res.status(500).json({ error: 'Failed to fetch passenger data' });
    }
});

// -----------------------------------------------
// Auth Endpoints
// -----------------------------------------------

// POST /api/auth/login
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;

        const { data: profile } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('id', data.user.id)
            .single();

        res.json({
            session: data.session,
            user: {
                id: data.user.id,
                email: data.user.email,
                role: profile?.role || 'viewer',
                display_name: profile?.display_name || data.user.email?.split('@')[0],
                avatar_url: profile?.avatar_url,
            },
        });
    } catch (err) {
        console.error('Login error:', err);
        res.status(401).json({ error: err.message || 'Login failed' });
    }
});

// POST /api/auth/signup
app.post('/api/auth/signup', async (req, res) => {
    try {
        const { email, password, displayName } = req.body;
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: { display_name: displayName || email.split('@')[0] },
            },
        });
        if (error) throw error;
        res.json({ user: data.user, message: 'Account created' });
    } catch (err) {
        console.error('Signup error:', err);
        res.status(400).json({ error: err.message || 'Signup failed' });
    }
});

// GET /api/auth/me — Get current user profile
app.get('/api/auth/me', async (req, res) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    res.json({ user: req.user });
});

// POST /api/auth/logout
app.post('/api/auth/logout', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader) {
            const token = authHeader.replace('Bearer ', '');
            // Best effort: Sign out using the user's token
            await supabase.auth.signOut(token);
        }
        res.json({ success: true });
    } catch (err) {
        // Even if upstream fails, tell client to clear state
        res.json({ success: true, warning: 'Upstream logout failed' });
    }
});

// -----------------------------------------------
// REST API Endpoints
// -----------------------------------------------

// GET /api/state — Full world snapshot
app.get('/api/state', async (req, res) => {
    try {
        const { data: airports, error: airportErr } = await supabase
            .from('airports')
            .select('*');

        const { data: flights, error: flightErr } = await supabase
            .from('flights')
            .select(`
                *,
                aircraft:aircraft_id ( tail_number, model ),
                origin:origin_code ( name, lat, lng ),
                destination:destination_code ( name, lat, lng )
            `)
            .order('scheduled_dep');

        const { data: aircraft, error: aircraftErr } = await supabase
            .from('aircraft')
            .select('*');

        if (airportErr || flightErr || aircraftErr) {
            throw airportErr || flightErr || aircraftErr;
        }

        const flatFlights = (flights || []).map(f => ({
            ...f,
            aircraft_tail: f.aircraft?.tail_number ?? null,
            aircraft_model: f.aircraft?.model ?? null,
            origin_name: f.origin?.name ?? null,
            origin_lat: f.origin?.lat ?? null,
            origin_lng: f.origin?.lng ?? null,
            dest_name: f.destination?.name ?? null,
            dest_lat: f.destination?.lat ?? null,
            dest_lng: f.destination?.lng ?? null,
            aircraft: undefined,
            origin: undefined,
            destination: undefined,
        }));

        res.json({ airports, flights: flatFlights, aircraft });
    } catch (err) {
        console.error('Error fetching state:', err);
        res.status(500).json({ error: 'Failed to fetch state' });
    }
});

// GET /api/disruptions — Current disruption report
app.get('/api/disruptions', async (req, res) => {
    try {
        const { data: delayedFlights } = await supabase
            .from('flights')
            .select(`
                id, flight_number, origin_code, destination_code,
                scheduled_dep, scheduled_arr, actual_dep, actual_arr,
                delay_minutes, status,
                origin:origin_code ( lat, lng ),
                destination:destination_code ( lat, lng )
            `)
            .eq('status', 'DELAYED')
            .order('delay_minutes', { ascending: false });

        const flatDelayed = (delayedFlights || []).map(f => ({
            ...f,
            origin_lat: f.origin?.lat, origin_lng: f.origin?.lng,
            dest_lat: f.destination?.lat, dest_lng: f.destination?.lng,
            origin: undefined, destination: undefined,
        }));

        // Missed connections
        const { data: missedBookings } = await supabase
            .from('bookings')
            .select(`
                id,
                passenger:passenger_id ( first_name, last_name, email ),
                flight:flight_id ( flight_number, origin_code, destination_code, actual_arr ),
                next_booking_id
            `)
            .eq('status', 'MISSED_CONNECTION')
            .not('next_booking_id', 'is', null);

        const missedConnections = [];
        for (const b of (missedBookings || [])) {
            if (!b.next_booking_id) continue;
            const { data: nextBooking } = await supabase
                .from('bookings')
                .select(`flight:flight_id ( flight_number, origin_code, destination_code, actual_dep )`)
                .eq('id', b.next_booking_id)
                .single();

            const connectionAirport = b.flight?.destination_code;
            const missedDest = nextBooking?.flight?.destination_code;

            const { data: connAirport } = connectionAirport
                ? await supabase.from('airports').select('lat, lng').eq('code', connectionAirport).single()
                : { data: null };
            const { data: missedAirport } = missedDest
                ? await supabase.from('airports').select('lat, lng').eq('code', missedDest).single()
                : { data: null };

            missedConnections.push({
                booking_id: b.id,
                first_name: b.passenger?.first_name,
                last_name: b.passenger?.last_name,
                email: b.passenger?.email,
                from_flight: b.flight?.flight_number,
                from_origin: b.flight?.origin_code,
                from_dest: b.flight?.destination_code,
                arriving_at: b.flight?.actual_arr,
                missed_flight: nextBooking?.flight?.flight_number,
                missed_origin: nextBooking?.flight?.origin_code,
                missed_dest: nextBooking?.flight?.destination_code,
                missed_dep: nextBooking?.flight?.actual_dep,
                connection_airport: connectionAirport,
                connection_lat: connAirport?.lat,
                connection_lng: connAirport?.lng,
                missed_dest_lat: missedAirport?.lat,
                missed_dest_lng: missedAirport?.lng,
            });
        }

        // Disruption log
        const { data: disruptionLog } = await supabase
            .from('disruption_log')
            .select(`*, flight:flight_id ( flight_number )`)
            .order('created_at', { ascending: false })
            .limit(50);

        const flatLog = (disruptionLog || []).map(d => ({
            ...d,
            flight_number: d.flight?.flight_number,
            flight: undefined,
        }));

        // Metrics
        const { count: delayedCount } = await supabase
            .from('flights').select('*', { count: 'exact', head: true }).eq('status', 'DELAYED');
        const { count: missedCount } = await supabase
            .from('bookings').select('*', { count: 'exact', head: true }).eq('status', 'MISSED_CONNECTION');
        const { data: delaySum } = await supabase
            .from('flights').select('delay_minutes').eq('status', 'DELAYED');
        const totalDelay = (delaySum || []).reduce((sum, f) => sum + (f.delay_minutes || 0), 0);
        const { data: impactedPax } = await supabase
            .from('bookings').select('passenger_id').eq('status', 'MISSED_CONNECTION');
        const uniquePax = new Set((impactedPax || []).map(b => b.passenger_id));
        const { count: activeCount } = await supabase
            .from('flights').select('*', { count: 'exact', head: true }).not('status', 'in', '("LANDED","CANCELLED")');
        const { count: totalCount } = await supabase
            .from('flights').select('*', { count: 'exact', head: true });

        res.json({
            delayedFlights: flatDelayed,
            missedConnections,
            disruptionLog: flatLog,
            metrics: {
                delayed_flights: delayedCount || 0,
                missed_connections: missedCount || 0,
                total_delay_minutes: totalDelay,
                impacted_passengers: uniquePax.size,
                active_flights: activeCount || 0,
                total_flights: totalCount || 0,
            }
        });
    } catch (err) {
        console.error('Error fetching disruptions:', err);
        res.status(500).json({ error: 'Failed to fetch disruptions' });
    }
});

// POST /api/simulate/delay — Manually trigger a delay (Admin only)
app.post('/api/simulate/delay', requireAdmin, async (req, res) => {
    try {
        const { flightId, delayMinutes, cause } = req.body;

        if (flightId && delayMinutes) {
            const { error } = await supabase.rpc('calculate_blast_radius', {
                p_flight_id: flightId,
                p_delay_minutes: delayMinutes,
                p_cause: cause || 'Manual delay trigger',
                p_cascaded_from: null,
                p_depth: 0,
            });
            if (error) throw error;
        } else {
            const { error } = await supabase.rpc('trigger_random_delay');
            if (error) throw error;
        }

        // Auto-snapshot after delay
        await supabase.rpc('save_simulation_snapshot', { p_label: `Manual Delay: ${cause || 'Random'}` });

        // Broadcast full state after delay
        const state = await fetchWorldState();
        if (state) io.emit('world_state', state);

        res.json({ success: true, message: 'Delay triggered successfully' });
    } catch (err) {
        console.error('Error triggering delay:', err);
        res.status(500).json({ error: 'Failed to trigger delay', details: err.message });
    }
});

// POST /api/simulate/scenario — Trigger a preset chaos scenario (Admin only)
app.post('/api/simulate/scenario', requireAdmin, async (req, res) => {
    try {
        const { scenario } = req.body;
        const results = [];

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

        const config = SCENARIOS[scenario];
        if (!config) {
            return res.status(400).json({ error: `Unknown scenario: ${scenario}` });
        }

        // Find all departures from the affected airport
        const { data: affected } = await supabase
            .from('flights')
            .select('id, flight_number')
            .eq('origin_code', config.airport)
            .in('status', ['SCHEDULED', 'BOARDING', 'ACTIVE']);

        for (const flight of (affected || [])) {
            const delay = config.delays[Math.floor(Math.random() * config.delays.length)];
            const { error } = await supabase.rpc('calculate_blast_radius', {
                p_flight_id: flight.id,
                p_delay_minutes: delay,
                p_cause: config.cause,
                p_cascaded_from: null,
                p_depth: 0,
            });
            if (!error) {
                results.push({ flight: flight.flight_number, delay });
            }
        }

        // Also delay arrivals into the airport (shorter delays)
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
            if (!error) {
                results.push({ flight: flight.flight_number, delay });
            }
        }

        // Auto-snapshot after scenario
        await supabase.rpc('save_simulation_snapshot', { p_label: `Scenario: ${config.label}` });

        const state = await fetchWorldState();
        if (state) io.emit('world_state', state);

        res.json({
            success: true,
            scenario: config.label,
            flights_affected: results.length,
            details: results,
        });
    } catch (err) {
        console.error('Error triggering scenario:', err);
        res.status(500).json({ error: 'Failed to trigger scenario', details: err.message });
    }
});

// POST /api/simulate/reset — Reset the simulation (Admin only)
app.post('/api/simulate/reset', requireAdmin, async (req, res) => {
    try {
        const { error } = await supabase.rpc('reset_simulation');
        if (error) throw error;

        const state = await fetchWorldState();
        io.emit('simulation_reset', { timestamp: new Date() });
        if (state) io.emit('world_state', state);

        res.json({ success: true, message: 'Simulation reset' });
    } catch (err) {
        console.error('Error resetting:', err);
        res.status(500).json({ error: 'Failed to reset simulation' });
    }
});

// POST /api/simulate/update-statuses — Advance flight lifecycle
app.post('/api/simulate/update-statuses', async (req, res) => {
    try {
        const { error } = await supabase.rpc('update_flight_statuses');
        if (error) throw error;
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating statuses:', err);
        res.status(500).json({ error: 'Failed to update statuses' });
    }
});

// GET /api/rebookings — Suggested rebookings for stranded passengers
app.get('/api/rebookings', async (req, res) => {
    try {
        const { data, error } = await supabase.rpc('suggest_rebookings');
        if (error) throw error;
        res.json({ suggestions: data || [] });
    } catch (err) {
        console.error('Error fetching rebookings:', err);
        res.status(500).json({ error: 'Failed to fetch rebookings' });
    }
});

// GET /api/cost-estimate — Financial impact of current disruptions
app.get('/api/cost-estimate', async (req, res) => {
    try {
        const HOTEL_VOUCHER = 150;
        const REBOOKING_FEE = 200;
        const CREW_OVERTIME_PER_HR = 85;
        const CREW_PER_FLIGHT = 6;
        const DELAY_COST_PER_MIN = 75;

        const { data: missedPax } = await supabase
            .from('bookings')
            .select('passenger_id')
            .eq('status', 'MISSED_CONNECTION');
        const uniquePax = new Set((missedPax || []).map(b => b.passenger_id));
        const strandedCount = uniquePax.size;

        const { data: delayedFlights } = await supabase
            .from('flights')
            .select('delay_minutes')
            .eq('status', 'DELAYED');

        const totalDelayMinutes = (delayedFlights || []).reduce((s, f) => s + (f.delay_minutes || 0), 0);
        const totalDelayHours = totalDelayMinutes / 60;

        const hotelCost = strandedCount * HOTEL_VOUCHER;
        const rebookingCost = strandedCount * REBOOKING_FEE;
        const crewOvertimeCost = Math.round(totalDelayHours * CREW_PER_FLIGHT * CREW_OVERTIME_PER_HR);
        const operationalCost = totalDelayMinutes * DELAY_COST_PER_MIN;
        const totalCost = hotelCost + rebookingCost + crewOvertimeCost + operationalCost;

        res.json({
            total_cost: totalCost,
            breakdown: {
                hotel_vouchers: { count: strandedCount, unit_cost: HOTEL_VOUCHER, total: hotelCost },
                rebooking_fees: { count: strandedCount, unit_cost: REBOOKING_FEE, total: rebookingCost },
                crew_overtime: { hours: Math.round(totalDelayHours * 10) / 10, crew_per_flight: CREW_PER_FLIGHT, rate: CREW_OVERTIME_PER_HR, total: crewOvertimeCost },
                operational: { delay_minutes: totalDelayMinutes, rate_per_min: DELAY_COST_PER_MIN, total: operationalCost },
            },
            stranded_passengers: strandedCount,
            delayed_flights: (delayedFlights || []).length,
        });
    } catch (err) {
        console.error('Error computing cost:', err);
        res.status(500).json({ error: 'Failed to compute cost estimate' });
    }
});

// GET /api/airports/:code — Airport detail
app.get('/api/airports/:code', async (req, res) => {
    try {
        const code = req.params.code.toUpperCase();

        const { data: airport } = await supabase
            .from('airports')
            .select('*')
            .eq('code', code)
            .single();

        if (!airport) {
            return res.status(404).json({ error: `Airport ${code} not found` });
        }

        const { data: departures } = await supabase
            .from('flights')
            .select('id, flight_number, destination_code, scheduled_dep, actual_dep, delay_minutes, status')
            .eq('origin_code', code)
            .order('scheduled_dep');

        const { data: arrivals } = await supabase
            .from('flights')
            .select('id, flight_number, origin_code, scheduled_arr, actual_arr, delay_minutes, status')
            .eq('destination_code', code)
            .order('scheduled_arr');

        const allFlightIds = [
            ...(departures || []).map(f => f.id),
            ...(arrivals || []).map(f => f.id),
        ];

        let disruptions = [];
        if (allFlightIds.length > 0) {
            const { data } = await supabase
                .from('disruption_log')
                .select('*, flight:flight_id ( flight_number )')
                .in('flight_id', allFlightIds)
                .order('created_at', { ascending: false })
                .limit(20);

            disruptions = (data || []).map(d => ({
                ...d,
                flight_number: d.flight?.flight_number,
                flight: undefined,
            }));
        }

        const delayedDep = (departures || []).filter(f => f.status === 'DELAYED').length;
        const delayedArr = (arrivals || []).filter(f => f.status === 'DELAYED').length;
        const totalDelay = [
            ...(departures || []),
            ...(arrivals || []),
        ].reduce((s, f) => s + (f.delay_minutes || 0), 0);

        res.json({
            airport,
            departures: departures || [],
            arrivals: arrivals || [],
            disruptions,
            stats: {
                total_departures: (departures || []).length,
                total_arrivals: (arrivals || []).length,
                delayed_departures: delayedDep,
                delayed_arrivals: delayedArr,
                total_delay_minutes: totalDelay,
            },
        });
    } catch (err) {
        console.error('Error fetching airport detail:', err);
        res.status(500).json({ error: 'Failed to fetch airport detail' });
    }
});

// -----------------------------------------------
// -----------------------------------------------
// Analytics Endpoint
// -----------------------------------------------

// GET /api/analytics — Aggregated disruption data for charts
app.get('/api/analytics', async (req, res) => {
    try {
        // Get the full disruption log
        const { data: disruptions, error: dErr } = await supabase
            .from('disruption_log')
            .select(`
                id, flight_id, delay_minutes, cause, cascaded_from_flight_id,
                passengers_impacted, flights_impacted, created_at,
                flights!disruption_log_flight_id_fkey(flight_number, origin_code, destination_code)
            `)
            .order('created_at', { ascending: false })
            .limit(500);
        if (dErr) throw dErr;

        const disruption_log = (disruptions || []).map(d => ({
            id: d.id,
            flight_id: d.flight_id,
            flight_number: d.flights?.flight_number || `FL${d.flight_id}`,
            origin_code: d.flights?.origin_code || '',
            destination_code: d.flights?.destination_code || '',
            delay_minutes: d.delay_minutes,
            cause: d.cause,
            cascaded_from_flight_id: d.cascaded_from_flight_id,
            passengers_impacted: d.passengers_impacted || 0,
            flights_impacted: d.flights_impacted || 0,
            created_at: d.created_at,
        }));

        // Airport aggregation
        const airportMap = {};
        for (const d of disruption_log) {
            const code = d.origin_code;
            if (!code) continue;
            if (!airportMap[code]) airportMap[code] = { code, delay_count: 0, total_delay: 0 };
            airportMap[code].delay_count++;
            airportMap[code].total_delay += d.delay_minutes;
        }
        const airport_stats = Object.values(airportMap);

        res.json({ disruption_log, airport_stats });
    } catch (err) {
        console.error('Error fetching analytics:', err);
        res.status(500).json({ error: 'Failed to fetch analytics' });
    }
});

// -----------------------------------------------
// Historical Replay — Snapshot Endpoints
// -----------------------------------------------

// GET /api/snapshots — List all snapshots
app.get('/api/snapshots', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('simulation_snapshots')
            .select('id, label, metrics, created_at')
            .order('created_at', { ascending: false })
            .limit(100);
        if (error) throw error;
        res.json({ snapshots: data || [] });
    } catch (err) {
        console.error('Error fetching snapshots:', err);
        res.status(500).json({ error: 'Failed to fetch snapshots' });
    }
});

// GET /api/snapshots/:id — Get full snapshot
app.get('/api/snapshots/:id', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('simulation_snapshots')
            .select('*')
            .eq('id', req.params.id)
            .single();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Snapshot not found' });
        res.json(data);
    } catch (err) {
        console.error('Error fetching snapshot:', err);
        res.status(500).json({ error: 'Failed to fetch snapshot' });
    }
});

// POST /api/snapshots — Save current state as a snapshot (Admin only)
app.post('/api/snapshots', requireAdmin, async (req, res) => {
    try {
        const { label } = req.body;
        const { data, error } = await supabase.rpc('save_simulation_snapshot', {
            p_label: label || 'Manual Snapshot',
        });
        if (error) throw error;
        res.json({ success: true, snapshot_id: data });
    } catch (err) {
        console.error('Error saving snapshot:', err);
        res.status(500).json({ error: 'Failed to save snapshot' });
    }
});

// -----------------------------------------------
// Edge Function Proxy
// -----------------------------------------------
app.post('/api/edge/chaos', requireAdmin, async (req, res) => {
    try {
        const supabaseUrl = process.env.SUPABASE_URL;
        const supabaseKey = process.env.SUPABASE_SERVICE_KEY;

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);

        try {
            const response = await fetch(`${supabaseUrl}/functions/v1/chaos-simulator`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${supabaseKey}`,
                },
                body: JSON.stringify(req.body),
                signal: controller.signal,
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Edge Function error: ${text}`);
            }

            const data = await response.json();
            // ... (rest of function)
            res.json(data);
        } finally {
            clearTimeout(timeout);
        }

        // Broadcast updated state
        const state = await fetchWorldState();
        if (state) io.emit('world_state', state);

        res.json(data);
    } catch (err) {
        console.error('Error proxying to Edge Function:', err);
        res.status(500).json({ error: 'Failed to invoke Edge Function' });
    }
});

// -----------------------------------------------
// Supabase Realtime: Subscribe to DB changes
// -----------------------------------------------
let realtimeChannel = null;

function setupRealtimeSubscription() {
    if (realtimeChannel) return;

    realtimeChannel = supabase
        .channel('db-changes')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'flights' }, async (payload) => {
            console.log('🔔 Flight changed:', payload.new?.flight_number || payload.old?.id);
            const state = await fetchWorldState();
            if (state) io.emit('world_state', state);
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'disruption_log' }, async (payload) => {
            console.log('🔔 New disruption event:', payload.new?.id);
            if (payload.new?.id) {
                const { data: event } = await supabase
                    .from('disruption_log')
                    .select(`*, flight:flight_id ( flight_number, origin_code, destination_code )`)
                    .eq('id', payload.new.id)
                    .single();
                if (event) {
                    io.emit('disruption_event', {
                        id: event.id,
                        flight_id: event.flight_id,
                        flight_number: event.flight?.flight_number,
                        origin_code: event.flight?.origin_code,
                        destination_code: event.flight?.destination_code,
                        delay_minutes: event.delay_minutes,
                        cause: event.cause,
                        cascaded: !!event.cascaded_from_flight_id,
                        passengers_impacted: event.passengers_impacted,
                        flights_impacted: event.flights_impacted,
                        created_at: event.created_at,
                    });
                }
            }
        })
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'bookings' }, async (payload) => {
            if (payload.new?.status === 'MISSED_CONNECTION') {
                console.log('🔔 Missed connection detected for booking:', payload.new.id);
                const state = await fetchWorldState();
                if (state) io.emit('world_state', state);
            }
        })
        .subscribe((status) => {
            console.log(`📡 Supabase Realtime: ${status}`);
        });
}

// -----------------------------------------------
// Fallback polling (if Realtime isn't enabled)
// -----------------------------------------------
let pollingInterval = null;

function startPolling() {
    if (pollingInterval) return;
    pollingInterval = setInterval(async () => {
        const state = await fetchWorldState();
        if (state) io.emit('world_state', state);
    }, 2000);
}

function stopPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
    }
}

// -----------------------------------------------
// Server-side scheduling (replaces DB events)
// -----------------------------------------------
let statusInterval = null;

function startScheduling() {
    if (statusInterval) return;
    statusInterval = setInterval(async () => {
        try {
            await supabase.rpc('update_flight_statuses');
        } catch (err) {
            console.error('Status update error:', err.message);
        }
    }, 10000);
}

// -----------------------------------------------
// WebSocket connections + Multi-User Presence
// -----------------------------------------------
const connectedUsers = new Map();

io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Try Supabase Realtime first, fall back to polling
    setupRealtimeSubscription();
    startPolling();
    startScheduling();

    // --- Multi-User Presence ---
    socket.on('presence:join', (userData) => {
        connectedUsers.set(socket.id, {
            id: socket.id,
            userId: userData.userId || socket.id,
            displayName: userData.displayName || 'Anonymous',
            role: userData.role || 'viewer',
            avatarUrl: userData.avatarUrl || null,
            color: userData.color || `hsl(${Math.floor(Math.random() * 360)}, 70%, 60%)`,
            cursor: null,
            focusedAirport: null,
            joinedAt: new Date().toISOString(),
        });
        io.emit('presence:state', Array.from(connectedUsers.values()));
    });

    socket.on('presence:cursor', (cursorData) => {
        const user = connectedUsers.get(socket.id);
        if (user) {
            user.cursor = cursorData;
            socket.broadcast.emit('presence:cursor_update', {
                socketId: socket.id,
                cursor: cursorData,
            });
        }
    });

    socket.on('presence:focus', (focusData) => {
        const user = connectedUsers.get(socket.id);
        if (user) {
            user.focusedAirport = focusData.airport || null;
            io.emit('presence:state', Array.from(connectedUsers.values()));
        }
    });

    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        connectedUsers.delete(socket.id);
        io.emit('presence:state', Array.from(connectedUsers.values()));

        if (io.engine.clientsCount === 0) {
            stopPolling();
            console.log('Polling stopped (no clients)');
        }
    });
});

// -----------------------------------------------
// Start Server
// -----------------------------------------------
const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
    console.log(`\n🛫 Flight Disruption Engine API (Supabase)`);
    console.log(`   Server running on http://localhost:${PORT}`);
    console.log(`   Supabase Realtime + WebSocket fallback`);
    console.log(`   Auth + RBAC enabled`);
    console.log(`   Multi-User Presence enabled`);
    console.log(`   Endpoints:`);
    console.log(`     POST /api/auth/login               — Login`);
    console.log(`     POST /api/auth/signup              — Signup`);
    console.log(`     GET  /api/auth/me                  — Current user`);
    console.log(`     GET  /api/state                    — World snapshot`);
    console.log(`     GET  /api/disruptions              — Disruption report`);
    console.log(`     POST /api/simulate/delay           — Trigger delay (admin)`);
    console.log(`     POST /api/simulate/scenario        — Trigger chaos (admin)`);
    console.log(`     POST /api/simulate/reset           — Reset simulation (admin)`);
    console.log(`     GET  /api/snapshots                — List snapshots`);
    console.log(`     GET  /api/snapshots/:id            — Load snapshot`);
    console.log(`     POST /api/snapshots                — Save snapshot (admin)`);
    console.log(`     POST /api/edge/chaos               — Edge Function proxy (admin)\n`);
});
