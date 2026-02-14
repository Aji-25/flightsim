import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip, useMap } from 'react-leaflet';
import FlightAnimation from './FlightAnimation';
import LiveFlightLayer from './LiveFlightLayer';
import type { Flight, Airport, MissedConnection } from '../types';
import 'leaflet/dist/leaflet.css';

interface Props {
    mode: 'live' | 'sim';
    flights: Flight[];
    airports: Airport[];
    missedConnections: MissedConnection[];
    onAirportClick?: (code: string) => void;
}

interface DelayRoute {
    callsign: string;
    airline_name: string;
    dep_airport: string;
    arr_airport: string;
    dep_delay_min: number;
    arr_delay_min: number;
    dep_lat: number;
    dep_lng: number;
    arr_lat: number;
    arr_lng: number;
}

const API_BASE = 'https://flightsim.onrender.com';

// Great-circle interpolation
function interpolatePosition(
    lat1: number, lng1: number,
    lat2: number, lng2: number,
    progress: number
): [number, number] {
    const toRad = (d: number) => (d * Math.PI) / 180;
    const toDeg = (r: number) => (r * 180) / Math.PI;
    const φ1 = toRad(lat1), λ1 = toRad(lng1);
    const φ2 = toRad(lat2), λ2 = toRad(lng2);
    const d = 2 * Math.asin(Math.sqrt(
        Math.sin((φ2 - φ1) / 2) ** 2 +
        Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2
    ));
    if (d < 1e-6) return [lat1, lng1];
    const A = Math.sin((1 - progress) * d) / Math.sin(d);
    const B = Math.sin(progress * d) / Math.sin(d);
    const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
    const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
    const z = A * Math.sin(φ1) + B * Math.sin(φ2);
    return [toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))), toDeg(Math.atan2(y, x))];
}

function getStatusColor(status: string): string {
    switch (status) {
        case 'DELAYED': return '#ef4444';
        case 'CANCELLED': return '#f97316';
        case 'IN_AIR': return '#60a5fa';
        case 'BOARDING': return '#a78bfa';
        default: return '#4ade80';
    }
}

function getHeatmapColor(delayScore: number): { fill: string; border: string } {
    if (delayScore > 300) return { fill: '#ef4444', border: '#dc2626' };
    if (delayScore > 100) return { fill: '#f97316', border: '#ea580c' };
    if (delayScore > 30) return { fill: '#eab308', border: '#ca8a04' };
    return { fill: '#60a5fa', border: '#3b82f6' };
}

function getHeatmapRadius(delayScore: number): number {
    if (delayScore > 300) return 10;
    if (delayScore > 100) return 8;
    if (delayScore > 30) return 6;
    return 5;
}

function MapBounds({ airports }: { airports: Airport[] }) {
    const map = useMap();
    useEffect(() => {
        if (airports.length > 1) {
            const bounds = airports.map(a => [a.lat, a.lng] as [number, number]);
            map.fitBounds(bounds, { padding: [40, 40], maxZoom: 4 });
        }
    }, []);
    return null;
}

export default function WorldMap({ mode, flights, airports, missedConnections, onAirportClick }: Props) {
    const [liveDelayRoutes, setLiveDelayRoutes] = useState<DelayRoute[]>([]);

    // Fetch live delay routes for red arcs
    useEffect(() => {
        if (mode !== 'live') { setLiveDelayRoutes([]); return; }

        async function fetchRoutes() {
            try {
                const res = await fetch(`${API_BASE}/api/delayed-routes`);
                if (res.ok) {
                    const data = await res.json();
                    setLiveDelayRoutes(data.routes || []);
                }
            } catch { /* silent */ }
        }

        fetchRoutes();
        const interval = setInterval(fetchRoutes, 30_000);
        return () => clearInterval(interval);
    }, [mode]);


    // Compute delay scores per airport for heatmap (sim mode)
    const airportDelayScores = useMemo(() => {
        const scores: Record<string, number> = {};
        airports.forEach(a => { scores[a.code] = 0; });
        if (mode === 'sim') {
            flights.forEach(f => {
                if (f.status === 'DELAYED' && f.delay_minutes > 0) {
                    if (scores[f.origin_code] !== undefined) scores[f.origin_code] += f.delay_minutes;
                    if (scores[f.destination_code] !== undefined) scores[f.destination_code] += f.delay_minutes;
                }
            });
        }
        return scores;
    }, [flights, airports, mode]);

    // Flight route arcs (sim mode)
    const flightRoutes = useMemo(() => {
        if (mode !== 'sim') return [];
        return flights
            .filter(f => f.origin_lat && f.dest_lat && f.status !== 'LANDED' && f.status !== 'CANCELLED')
            .map(f => {
                const points: [number, number][] = [];
                const steps = 20;
                for (let i = 0; i <= steps; i++) {
                    points.push(interpolatePosition(
                        f.origin_lat!, f.origin_lng!,
                        f.dest_lat!, f.dest_lng!,
                        i / steps
                    ));
                }
                return {
                    id: f.id,
                    positions: points,
                    color: getStatusColor(f.status),
                    delayed: f.status === 'DELAYED',
                    label: `${f.flight_number}: ${f.origin_code} → ${f.destination_code}`,
                    delayMinutes: f.delay_minutes,
                };
            });
    }, [flights, mode]);

    // Live delay route arcs (red lines for delayed flights)
    const liveRouteArcs = useMemo(() => {
        if (mode !== 'live') return [];
        return liveDelayRoutes
            .filter(r => r.dep_lat && r.arr_lat)
            .map((r, idx) => {
                const points: [number, number][] = [];
                const steps = 20;
                for (let i = 0; i <= steps; i++) {
                    points.push(interpolatePosition(r.dep_lat, r.dep_lng, r.arr_lat, r.arr_lng, i / steps));
                }
                const severity = r.dep_delay_min >= 120 ? 'critical' : r.dep_delay_min >= 60 ? 'major' : 'moderate';
                return { id: idx, positions: points, callsign: r.callsign, airline: r.airline_name || '', dep: r.dep_airport, arr: r.arr_airport, delay: r.dep_delay_min, severity };
            });
    }, [liveDelayRoutes, mode]);

    // Broken connection lines (sim mode)
    const brokenLines = useMemo(() => {
        if (mode !== 'sim') return [];
        return missedConnections
            .filter(mc => mc.connection_lat && mc.missed_dest_lat)
            .map(mc => ({
                id: mc.booking_id,
                positions: [
                    [mc.connection_lat!, mc.connection_lng!],
                    [mc.missed_dest_lat!, mc.missed_dest_lng!],
                ] as [number, number][],
                label: `${mc.first_name} ${mc.last_name}: ${mc.from_flight} ✕ ${mc.missed_flight}`,
            }));
    }, [missedConnections, mode]);

    return (
        <div className="world-map-container">
            <MapContainer
                center={[30, 20]}
                zoom={2}
                minZoom={2}
                maxZoom={8}
                style={{ width: '100%', height: '100%' }}
                zoomControl={false}
                attributionControl={false}
            >
                <TileLayer
                    url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
                    attribution='&copy; Esri, HERE, Garmin'
                />
                <MapBounds airports={airports} />

                {/* Airport markers — heatmap in sim mode, subtle in live */}
                {airports.map(airport => {
                    const score = airportDelayScores[airport.code] || 0;
                    const colors = mode === 'sim' ? getHeatmapColor(score) : { fill: '#60a5fa', border: '#3b82f6' };
                    const radius = mode === 'sim' ? getHeatmapRadius(score) : 5;

                    return (
                        <CircleMarker
                            key={airport.code}
                            center={[airport.lat, airport.lng]}
                            radius={radius}
                            fillColor={colors.fill}
                            color={colors.border}
                            weight={mode === 'sim' ? 2 : 1.5}
                            opacity={mode === 'sim' ? 0.9 : 0.7}
                            fillOpacity={mode === 'sim' ? 0.8 : 0.5}
                            eventHandlers={{
                                click: () => onAirportClick?.(airport.code),
                            }}
                        >
                            <Tooltip direction="top" className="airport-tooltip">
                                <strong>{airport.code}</strong> — {airport.city}
                                {mode === 'sim' && score > 0 && <><br /><span style={{ color: colors.fill }}>⚠ {score}m total delay</span></>}
                            </Tooltip>
                        </CircleMarker>
                    );
                })}

                {/* Flight route arcs (sim mode) */}
                {flightRoutes.map(route => (
                    <Polyline
                        key={route.id}
                        positions={route.positions}
                        pathOptions={{
                            color: route.color,
                            weight: route.delayed ? 3 : 1.5,
                            opacity: route.delayed ? 0.9 : 0.4,
                            dashArray: route.delayed ? '8 6' : undefined,
                        }}
                    >
                        <Tooltip>{route.label}{route.delayMinutes > 0 ? ` (+${route.delayMinutes}m late)` : ''}</Tooltip>
                    </Polyline>
                ))}

                {/* Live delay route arcs — red lines for delayed flights */}
                {liveRouteArcs.map(route => (
                    <Polyline
                        key={`live-delay-${route.id}`}
                        positions={route.positions}
                        pathOptions={{
                            color: route.severity === 'critical' ? '#ef4444' : route.severity === 'major' ? '#f97316' : '#fbbf24',
                            weight: route.severity === 'critical' ? 2.5 : 2,
                            opacity: route.severity === 'critical' ? 0.85 : 0.6,
                            dashArray: '6 4',
                        }}
                    >
                        <Tooltip>
                            {route.callsign} ({route.airline})<br />
                            {route.dep} → {route.arr}<br />
                            <span style={{ color: '#ef4444' }}>+{route.delay}m delayed</span>
                        </Tooltip>
                    </Polyline>
                ))}

                {/* Broken connection lines (sim mode) */}
                {brokenLines.map(line => (
                    <Polyline
                        key={`broken-${line.id}`}
                        positions={line.positions}
                        pathOptions={{
                            color: '#f87171',
                            weight: 3,
                            opacity: 0.8,
                            dashArray: '4 8',
                        }}
                    >
                        <Tooltip>{line.label}</Tooltip>
                    </Polyline>
                ))}

                {/* Living layers: sim markers OR live markers */}
                {mode === 'sim' && <FlightAnimation flights={flights} />}
                <LiveFlightLayer />
            </MapContainer>

            {/* Mode Badge */}
            <div className="live-flight-badge">
                <div className={`live-dot ${mode === 'sim' ? 'dot-sim' : ''}`} />
                <span>{mode === 'live' ? 'OpenSky Live' : 'Simulation Mode'}</span>
            </div>
        </div>
    );
}
