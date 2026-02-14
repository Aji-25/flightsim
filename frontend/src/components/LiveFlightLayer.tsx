/**
 * LiveFlightLayer — Renders real-time aircraft from OpenSky data on the map
 * 
 * Designed as a react-leaflet child component (must be inside MapContainer).
 * Fetches live flight positions and renders them as small purple markers.
 */
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';

interface LiveFlight {
    icao24: string;
    callsign: string;
    origin_country: string;
    latitude: number;
    longitude: number;
    altitude_m: number;
    velocity_ms: number | null;
    heading: number | null;
    on_ground: boolean;
    updated_at: string;
}

const API_BASE = 'https://flightsim.onrender.com';
const POLL_INTERVAL = 10_000;

function createLiveIcon(heading: number | null): L.DivIcon {
    const rotation = heading ?? 0;
    return L.divIcon({
        className: 'live-plane-marker',
        html: `<div style="
            transform: rotate(${rotation}deg);
            font-size: 10px;
            color: #a78bfa;
            text-shadow: 0 0 4px rgba(167, 139, 250, 0.6);
            line-height: 1;
        ">✈</div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
    });
}

export default function LiveFlightLayer() {
    const map = useMap();
    const markersRef = useRef<Map<string, L.Marker>>(new Map());

    useEffect(() => {
        let cancelled = false;

        async function fetchLive() {
            if (cancelled) return;

            try {
                const res = await fetch(`${API_BASE}/api/live-flights`);
                if (!res.ok) return;

                const { flights }: { flights: LiveFlight[] } = await res.json();

                const activeIds = new Set<string>();

                for (const f of flights) {
                    if (!f.latitude || !f.longitude) continue;
                    activeIds.add(f.icao24);

                    const icon = createLiveIcon(f.heading);
                    let marker = markersRef.current.get(f.icao24);

                    if (marker) {
                        marker.setLatLng([f.latitude, f.longitude]);
                        marker.setIcon(icon);
                    } else {
                        marker = L.marker([f.latitude, f.longitude], {
                            icon,
                            zIndexOffset: 500,
                        }).addTo(map);
                        markersRef.current.set(f.icao24, marker);
                    }

                    const speedKnots = f.velocity_ms
                        ? Math.round(f.velocity_ms * 1.944)
                        : '?';
                    const altFt = f.altitude_m
                        ? Math.round(f.altitude_m * 3.281).toLocaleString()
                        : '?';

                    marker.bindTooltip(
                        `<strong>${f.callsign || f.icao24}</strong><br/>` +
                        `🌍 ${f.origin_country}<br/>` +
                        `📏 FL${altFt} · ${speedKnots}kts`,
                        { direction: 'top', offset: [0, -8], className: 'live-tooltip' }
                    );
                }

                // Remove stale markers
                markersRef.current.forEach((marker, id) => {
                    if (!activeIds.has(id)) {
                        marker.remove();
                        markersRef.current.delete(id);
                    }
                });

            } catch (err) {
                console.error('LiveFlightLayer fetch error:', err);
            }
        }

        fetchLive();
        const interval = setInterval(fetchLive, POLL_INTERVAL);

        return () => {
            cancelled = true;
            clearInterval(interval);
            markersRef.current.forEach(m => m.remove());
            markersRef.current.clear();
        };
    }, [map]);

    // This component renders nothing in React — it only adds Leaflet markers
    return null;
}

// Separate badge component that goes outside the map
export function LiveFlightBadge({ count }: { count: number }) {
    return (
        <div className="live-flight-badge">
            <div className="live-dot" />
            <span>{count > 0 ? `${count.toLocaleString()} aircraft live` : 'Connecting...'}</span>
        </div>
    );
}
