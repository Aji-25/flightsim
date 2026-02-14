/**
 * Realistic Passenger Data Generator
 * 
 * Generates fake but realistic passenger records and assigns them
 * to live flights from the OpenSky data. Creates bookings with
 * seat assignments and booking classes.
 * 
 * Run once to populate, or periodically to refresh.
 */
require('dotenv').config();
const supabase = require('./db');

// -----------------------------------------------
// Realistic Name Pools (diverse, international)
// -----------------------------------------------
const FIRST_NAMES = [
    // Western
    'James', 'Emma', 'Oliver', 'Sophia', 'William', 'Isabella', 'Benjamin', 'Mia',
    'Lucas', 'Charlotte', 'Henry', 'Amelia', 'Alexander', 'Harper', 'Daniel', 'Evelyn',
    'Michael', 'Abigail', 'Matthew', 'Emily', 'David', 'Elizabeth', 'Joseph', 'Sofia',
    'Samuel', 'Avery', 'John', 'Grace', 'Ryan', 'Chloe', 'Nathan', 'Victoria',
    // South Asian
    'Aarav', 'Priya', 'Arjun', 'Diya', 'Rohan', 'Ananya', 'Vivaan', 'Isha',
    'Aditya', 'Kavya', 'Sai', 'Meera', 'Raj', 'Neha', 'Krishna', 'Pooja',
    'Vikram', 'Shreya', 'Rahul', 'Nisha', 'Amit', 'Riya', 'Karthik', 'Lakshmi',
    // East Asian
    'Wei', 'Yuki', 'Hiroshi', 'Sakura', 'Jun', 'Mei', 'Takeshi', 'Hana',
    'Chen', 'Lin', 'Ryu', 'Aoi', 'Min-jun', 'Seo-yeon', 'Ji-hoon', 'Eunji',
    // Arabic
    'Ahmed', 'Fatima', 'Omar', 'Aisha', 'Hassan', 'Layla', 'Ali', 'Noor',
    'Khalid', 'Mariam', 'Youssef', 'Sara', 'Mohammed', 'Zainab', 'Ibrahim', 'Huda',
    // European
    'Matteo', 'Giulia', 'Pierre', 'Camille', 'Lars', 'Astrid', 'Carlos', 'Elena',
    'Hans', 'Ingrid', 'Marco', 'Francesca', 'Stefan', 'Katarina', 'Nikolai', 'Olga',
    // Latin American
    'Diego', 'Valentina', 'Santiago', 'Camila', 'Mateo', 'Luciana', 'Sebastián', 'Gabriela',
    // African
    'Kwame', 'Amara', 'Kofi', 'Nia', 'Emeka', 'Zuri', 'Tendai', 'Ayana',
];

const LAST_NAMES = [
    // Western
    'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
    'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Wilson', 'Anderson', 'Thomas', 'Taylor',
    'Moore', 'Jackson', 'Martin', 'Lee', 'Thompson', 'White', 'Harris', 'Clark',
    // South Asian
    'Sharma', 'Patel', 'Singh', 'Kumar', 'Gupta', 'Reddy', 'Verma', 'Joshi',
    'Nair', 'Iyer', 'Choudhury', 'Das', 'Menon', 'Rao', 'Bhat', 'Deshmukh',
    'Agarwal', 'Malhotra', 'Kapoor', 'Saxena', 'Pillai', 'Deshpande', 'Kulkarni', 'Banerjee',
    // East Asian
    'Tanaka', 'Suzuki', 'Wang', 'Zhang', 'Li', 'Liu', 'Kim', 'Park',
    'Chen', 'Yang', 'Sato', 'Nakamura', 'Watanabe', 'Yamamoto', 'Kobayashi', 'Choi',
    // Arabic
    'Al-Rashid', 'Hassan', 'Ibrahim', 'Khalil', 'Mansour', 'Bakr', 'Saleh', 'Nasser',
    // European
    'Müller', 'Schmidt', 'Rossi', 'Bianchi', 'Dubois', 'Laurent', 'Johansson', 'Nilsson',
    'Petrov', 'Ivanov', 'Fernández', 'González', 'Costa', 'Santos', 'Van der Berg', 'De Vries',
    // African
    'Okonkwo', 'Mensah', 'Mwangi', 'Diallo', 'Osei', 'Nkomo', 'Abebe', 'Okoro',
];

const EMAIL_DOMAINS = [
    'gmail.com', 'yahoo.com', 'outlook.com', 'icloud.com',
    'hotmail.com', 'proton.me', 'mail.com', 'fastmail.com',
];

const BOOKING_CLASSES = [
    { name: 'Economy', weight: 70 },
    { name: 'Premium Economy', weight: 15 },
    { name: 'Business', weight: 12 },
    { name: 'First', weight: 3 },
];

// -----------------------------------------------
// Helpers
// -----------------------------------------------
function pick(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function weightedPick(items) {
    const total = items.reduce((s, i) => s + i.weight, 0);
    let r = Math.random() * total;
    for (const item of items) {
        r -= item.weight;
        if (r <= 0) return item.name;
    }
    return items[0].name;
}

function generateSeat() {
    const row = Math.floor(Math.random() * 40) + 1;
    const col = pick(['A', 'B', 'C', 'D', 'E', 'F']);
    return `${row}${col}`;
}

function generateEmail(first, last) {
    const domain = pick(EMAIL_DOMAINS);
    const num = Math.floor(Math.random() * 999);
    const formats = [
        `${first.toLowerCase()}.${last.toLowerCase()}@${domain}`,
        `${first.toLowerCase()}${num}@${domain}`,
        `${first[0].toLowerCase()}${last.toLowerCase()}${num}@${domain}`,
    ];
    return pick(formats);
}

function generatePhone() {
    const prefix = pick(['+1', '+44', '+91', '+81', '+49', '+33', '+971', '+86', '+55']);
    const num = Math.floor(Math.random() * 9000000000 + 1000000000);
    return `${prefix} ${num}`;
}

// -----------------------------------------------
// Main Generator
// -----------------------------------------------
async function generatePassengers(count = 2000) {
    console.log(`\n👥 Generating ${count} realistic passengers...`);

    const passengers = [];
    const usedEmails = new Set();

    for (let i = 0; i < count; i++) {
        const first = pick(FIRST_NAMES);
        const last = pick(LAST_NAMES);
        let email = generateEmail(first, last);

        // Ensure unique email
        while (usedEmails.has(email)) {
            email = generateEmail(first, last);
        }
        usedEmails.add(email);

        passengers.push({
            first_name: first,
            last_name: last,
            email,
            phone: generatePhone(),
        });
    }

    // Batch insert in chunks
    const CHUNK = 200;
    let inserted = 0;
    for (let i = 0; i < passengers.length; i += CHUNK) {
        const chunk = passengers.slice(i, i + CHUNK);
        const { error } = await supabase.from('passengers').upsert(chunk, {
            onConflict: 'email',
            ignoreDuplicates: true,
        });
        if (error) {
            console.error(`  ❌ Insert error at chunk ${i / CHUNK}:`, error.message);
        } else {
            inserted += chunk.length;
        }
    }

    console.log(`  ✅ Inserted ${inserted} passengers`);
    return inserted;
}

async function assignPassengersToFlights() {
    console.log('\n🎫 Assigning passengers to live flights...');

    // Get live flights with callsigns
    const { data: liveFlights, error: lfErr } = await supabase
        .from('live_flights')
        .select('icao24, callsign')
        .neq('callsign', '')
        .eq('on_ground', false)
        .limit(500);

    if (lfErr || !liveFlights?.length) {
        console.log('  ⚠️  No live flights found. Run OpenSky ingestion first.');
        return 0;
    }

    // Get all passengers
    const { data: passengers, error: pErr } = await supabase
        .from('passengers')
        .select('id');

    if (pErr || !passengers?.length) {
        console.log('  ⚠️  No passengers found. Run generate first.');
        return 0;
    }

    // Clear old bookings
    await supabase.from('live_bookings').delete().neq('id', 0);

    const bookings = [];
    const passengerIds = passengers.map(p => p.id);

    for (const flight of liveFlights) {
        // Assign 50-200 passengers per flight
        const paxCount = Math.floor(Math.random() * 150) + 50;
        const shuffled = [...passengerIds].sort(() => Math.random() - 0.5);

        for (let i = 0; i < Math.min(paxCount, shuffled.length); i++) {
            bookings.push({
                passenger_id: shuffled[i],
                callsign: flight.callsign,
                seat: generateSeat(),
                booking_class: weightedPick(BOOKING_CLASSES),
                status: 'CONFIRMED',
            });
        }
    }

    // Batch insert
    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < bookings.length; i += CHUNK) {
        const chunk = bookings.slice(i, i + CHUNK);
        const { error } = await supabase.from('live_bookings').insert(chunk);
        if (error) {
            console.error(`  ❌ Booking insert error at chunk ${i / CHUNK}:`, error.message);
        } else {
            inserted += chunk.length;
        }
    }

    console.log(`  ✅ Created ${inserted} bookings across ${liveFlights.length} flights`);
    return inserted;
}

// -----------------------------------------------
// Run
// -----------------------------------------------
async function main() {
    console.log('🚀 Passenger Data Generator');
    console.log('============================\n');

    await generatePassengers(2000);
    await assignPassengersToFlights();

    console.log('\n✅ Done! Passengers are now assigned to live flights.');
    process.exit(0);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
