# connecting_to_real_time_data.md

To switch from "Simulation Mode" to "Real-Time Mode," you need to replace the internal simulation logic with an external data source. Here is the step-by-step guide.

## 1. Choose a Flight Data API
You need a source for live flight positions and statuses.
-   **AviationStack** (Free tier: 500 requests/mo). Good for flight schedules/status.
-   **OpenSky Network** (Free for open source). Good for live positions (lat/lng).
-   **FlightAware Firehose** (Enterprise). Best data, expensive.

**Recommended for Dev:** **AviationStack** for status + **OpenSky** for positions.

## 2. Create the Ingestion Service
Create a new file `backend/ingest_live_data.js`. This script will run every 10-30 seconds.

```javascript
/* backend/ingest_live_data.js */
require('dotenv').config();
const axios = require('axios');
const mysql = require('mysql2/promise');

// DB Connection
const dbConfig = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
};

async function fetchLiveFlights() {
    const connection = await mysql.createConnection(dbConfig);
    
    try {
        // 1. Fetch from AviationStack (Example)
        const response = await axios.get('http://api.aviationstack.com/v1/flights', {
            params: {
                access_key: process.env.AVIATIONSTACK_KEY,
                limit: 100,
                flight_status: 'active'
            }
        });

        const liveFlights = response.data.data;

        // 2. Update Database
        for (const flight of liveFlights) {
            await connection.execute(`
                UPDATE flights 
                SET 
                    status = ?,
                    actual_dep = ?,
                    actual_arr = ?,
                    lat = ?,    -- If API provides live location
                    lng = ?
                WHERE flight_number = ?
            `, [
                flight.flight_status.toUpperCase(),
                flight.departure.actual,
                flight.arrival.estimated,
                flight.geography?.latitude || null,
                flight.geography?.longitude || null,
                flight.flight.iata
            ]);
        }
        console.log(`Updated ${liveFlights.length} flights`);

    } catch (err) {
        console.error("Ingestion failed:", err.message);
    } finally {
        await connection.end();
    }
}

// Run every 30 seconds
setInterval(fetchLiveFlights, 30000);
fetchLiveFlights();
```

## 3. Disable the Simulation Engine
In `backend/src/index.js`, find the `simulationInterval` or the code that calculates positions mathematically.
-   **Comment it out.**
-   Keep the WebSocket/API logic (which serves the database state to the frontend).

## 4. Run It
1.  Get an API Key.
2.  Add it to `.env`.
3.  Run `node ingest_live_data.js` alongside your backend.

## 5. Frontend Changes (Optional)
The frontend is already designed to allow the backend to dictate positions.
-   If the DB has `lat`/`lng`, the map will show the plane there.
-   **Note:** Real-time APIs often don't provide *fluid* movement (polling every 30s makes planes "jump"). You might want to interpolate positions on the frontend between updates for smoothness.
