/**
 * DisruptionSidebar — Dual-mode sidebar for flight disruptions
 * 
 * Live Mode: Fetches from /api/delayed-flights (AviationStack data)
 * Sim Mode: Shows simulated delays from the flights table
 */
import { useState, useEffect } from 'react';
import type { Flight, MissedConnection, RebookingSuggestion } from '../types';

// -----------------------------------------------
// Live Data Types
// -----------------------------------------------
interface LiveDelayedFlight {
    callsign: string;
    airline_name: string;
    dep_airport: string;
    arr_airport: string;
    dep_delay_min: number;
    arr_delay_min: number;
    status: string;
    affected_passengers: number;
    sample_passengers: {
        name: string;
        email: string;
        seat: string;
        class: string;
    }[];
}

interface DelayResponse {
    delayed_flights: LiveDelayedFlight[];
    total_delayed: number;
    total_passengers_affected: number;
}

// -----------------------------------------------
// Props
// -----------------------------------------------
interface Props {
    mode: 'live' | 'sim';
    flights: Flight[];
    missedConnections: MissedConnection[];
    rebookings: RebookingSuggestion[];
}

const API_BASE = 'https://flightsim.onrender.com';

type Tab = 'delayed' | 'passengers' | 'rebookings';

export default function DisruptionSidebar({ mode, flights, missedConnections, rebookings }: Props) {
    const [activeTab, setActiveTab] = useState<Tab>('delayed');
    const [liveData, setLiveData] = useState<DelayResponse | null>(null);
    const [loadingLive, setLoadingLive] = useState(false);
    const [expandedFlight, setExpandedFlight] = useState<string | null>(null);

    // Fetch live delay data when in live mode
    useEffect(() => {
        if (mode !== 'live') return;

        async function fetchDelays() {
            setLoadingLive(true);
            try {
                const res = await fetch(`${API_BASE}/api/delayed-flights`);
                if (res.ok) setLiveData(await res.json());
            } catch (err) {
                console.error('Sidebar fetch error:', err);
            } finally {
                setLoadingLive(false);
            }
        }

        fetchDelays();
        const interval = setInterval(fetchDelays, 30_000);
        return () => clearInterval(interval);
    }, [mode]);

    // Sim mode data
    const delayedFlights = flights
        .filter(f => f.status === 'DELAYED')
        .sort((a, b) => b.delay_minutes - a.delay_minutes);

    // Live mode data
    const liveDelayed = liveData?.delayed_flights || [];
    const livePaxTotal = liveData?.total_passengers_affected || 0;

    const getSeverityClass = (minutes: number) => {
        if (minutes > 180) return 'severity-critical';
        if (minutes > 60) return 'severity-high';
        return 'severity-medium';
    };

    // Counts
    const delayCount = mode === 'sim' ? delayedFlights.length : liveDelayed.length;
    const strandedCount = mode === 'sim' ? missedConnections.length : livePaxTotal;
    const rebookCount = mode === 'sim' ? rebookings.length : 0;

    return (
        <div className="disruption-sidebar">
            <div className="sidebar-header">
                <h2>⚠️ Disruption Center</h2>
                <div className="sidebar-subtitle">
                    {mode === 'live' && loadingLive ? 'Loading...' : (
                        <>
                            {delayCount} delayed · {strandedCount.toLocaleString()} {mode === 'live' ? 'pax affected' : 'broken'}{mode === 'sim' ? ` · ${rebookCount} rebook` : ''}
                        </>
                    )}
                </div>
            </div>

            <div className="sidebar-tabs">
                <button
                    className={`tab-btn ${activeTab === 'delayed' ? 'tab-active' : ''}`}
                    onClick={() => setActiveTab('delayed')}
                >
                    Delayed <span className="tab-badge">{delayCount}</span>
                </button>
                <button
                    className={`tab-btn ${activeTab === 'passengers' ? 'tab-active' : ''}`}
                    onClick={() => setActiveTab('passengers')}
                >
                    {mode === 'live' ? 'Passengers' : 'Stranded'} <span className="tab-badge">{strandedCount.toLocaleString()}</span>
                </button>
                {mode === 'sim' && (
                    <button
                        className={`tab-btn ${activeTab === 'rebookings' ? 'tab-active' : ''}`}
                        onClick={() => setActiveTab('rebookings')}
                    >
                        Rebook <span className="tab-badge">{rebookCount}</span>
                    </button>
                )}
            </div>

            <div className="sidebar-content">
                {/* === DELAYED TAB === */}
                {activeTab === 'delayed' && mode === 'sim' && (
                    <div className="flight-list">
                        {delayedFlights.length === 0 ? (
                            <div className="empty-state">
                                <span className="empty-icon">✅</span>
                                <p>All flights on time</p>
                                <small>System operating normally</small>
                            </div>
                        ) : (
                            delayedFlights.map(flight => (
                                <div key={flight.id} className={`flight-card ${getSeverityClass(flight.delay_minutes)}`}>
                                    <div className="flight-card-header">
                                        <div className="flight-route-simple">
                                            <span className="flight-number">{flight.flight_number}</span>
                                            <span className="route-arrow">→</span>
                                            <span className="dest-code">{flight.destination_code}</span>
                                        </div>
                                        <div className="delay-badge">+{flight.delay_minutes}m</div>
                                    </div>
                                    <div className="flight-times">
                                        <div className="time-row">
                                            <span className="time-label">Scheduled</span>
                                            <span className="time-value">
                                                {new Date(flight.scheduled_arr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                        <div className="time-row time-delayed">
                                            <span className="time-label">Estimated</span>
                                            <span className="time-value">
                                                {flight.actual_arr ? new Date(flight.actual_arr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                                            </span>
                                        </div>
                                    </div>
                                    {flight.aircraft_tail && (
                                        <div className="flight-aircraft">✈ {flight.aircraft_tail} · {flight.aircraft_model}</div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                )}

                {activeTab === 'delayed' && mode === 'live' && (
                    <div className="flight-list">
                        {loadingLive ? (
                            <div className="empty-state">
                                <span className="empty-icon">⏳</span>
                                <p>Fetching delay data...</p>
                            </div>
                        ) : liveDelayed.length === 0 ? (
                            <div className="empty-state">
                                <span className="empty-icon">✅</span>
                                <p>No delays detected</p>
                                <small>AviationStack is monitoring active flights</small>
                            </div>
                        ) : (
                            liveDelayed.map(flight => (
                                <div
                                    key={flight.callsign}
                                    className={`flight-card ${getSeverityClass(flight.dep_delay_min)}`}
                                    onClick={() => setExpandedFlight(
                                        expandedFlight === flight.callsign ? null : flight.callsign
                                    )}
                                    style={{ cursor: 'pointer' }}
                                >
                                    <div className="flight-card-header">
                                        <div className="flight-route-simple">
                                            <span className="flight-number">{flight.callsign}</span>
                                            <span className="route-arrow">→</span>
                                            <span className="dest-code">{flight.arr_airport}</span>
                                        </div>
                                        <div className="delay-badge">+{flight.dep_delay_min}m</div>
                                    </div>
                                    <div className="flight-times">
                                        <div className="time-row">
                                            <span className="time-label">{flight.airline_name}</span>
                                            <span className="time-value" style={{ fontSize: '11px', opacity: 0.7 }}>
                                                {flight.dep_airport} → {flight.arr_airport}
                                            </span>
                                        </div>
                                        <div className="time-row">
                                            <span className="time-label">👥 {flight.affected_passengers} passengers</span>
                                            <span className="time-value" style={{ fontSize: '11px', color: '#f87171' }}>
                                                {flight.status}
                                            </span>
                                        </div>
                                    </div>

                                    {expandedFlight === flight.callsign && flight.sample_passengers.length > 0 && (
                                        <div style={{
                                            marginTop: '8px', padding: '8px',
                                            background: 'rgba(0,0,0,0.2)', borderRadius: '8px', fontSize: '12px',
                                        }}>
                                            <div style={{ color: '#94a3b8', marginBottom: '4px', fontWeight: 600 }}>
                                                Sample Affected Passengers:
                                            </div>
                                            {flight.sample_passengers.map((p, i) => (
                                                <div key={i} style={{
                                                    display: 'flex', justifyContent: 'space-between',
                                                    padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.05)', color: '#e2e8f0',
                                                }}>
                                                    <span>{p.name}</span>
                                                    <span style={{ color: '#a78bfa' }}>{p.seat} · {p.class}</span>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                )}

                {/* === PASSENGERS / STRANDED TAB === */}
                {activeTab === 'passengers' && mode === 'sim' && (
                    <div className="passenger-list">
                        {missedConnections.length === 0 ? (
                            <div className="empty-state">
                                <span className="empty-icon">👍</span>
                                <p>No missed connections</p>
                            </div>
                        ) : (
                            missedConnections.map(mc => (
                                <div key={mc.booking_id} className="passenger-card">
                                    <div className="passenger-name">{mc.first_name} {mc.last_name}</div>
                                    <div className="connection-detail">
                                        <div className="connection-from">
                                            <span className="label">Arriving on</span>
                                            <span className="value">{mc.from_flight}</span>
                                        </div>
                                        <div className="connection-break"><span className="break-icon">✕</span></div>
                                        <div className="connection-to">
                                            <span className="label">Missed</span>
                                            <span className="value">{mc.missed_flight}</span>
                                        </div>
                                    </div>
                                    <div className="rebooking-status">
                                        <span className="rebooking-badge">Needs Rebooking</span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}

                {activeTab === 'passengers' && mode === 'live' && (
                    <div className="passenger-list">
                        {liveDelayed.flatMap(f => f.sample_passengers.map(p => ({ ...p, callsign: f.callsign, delay: f.dep_delay_min, dep: f.dep_airport, arr: f.arr_airport }))).length === 0 ? (
                            <div className="empty-state">
                                <span className="empty-icon">👍</span>
                                <p>No affected passengers</p>
                            </div>
                        ) : (
                            liveDelayed.flatMap(f =>
                                f.sample_passengers.map((p, i) => (
                                    <div key={`${f.callsign}-${i}`} className="passenger-card">
                                        <div className="passenger-name">{p.name}</div>
                                        <div className="connection-detail">
                                            <div className="connection-from">
                                                <span className="label">Flight</span>
                                                <span className="value">{f.callsign}</span>
                                            </div>
                                            <div className="connection-break">
                                                <span className="break-icon" style={{ color: '#f87171' }}>⏱</span>
                                            </div>
                                            <div className="connection-to">
                                                <span className="label">Delay</span>
                                                <span className="value" style={{ color: '#f87171' }}>+{f.dep_delay_min}m</span>
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                                            <span>Seat {p.seat} · {p.class}</span>
                                            <span>{f.dep_airport} → {f.arr_airport}</span>
                                        </div>
                                    </div>
                                ))
                            )
                        )}
                    </div>
                )}

                {/* === REBOOKINGS TAB (sim only) === */}
                {activeTab === 'rebookings' && mode === 'sim' && (
                    <div className="rebooking-list">
                        {rebookings.length === 0 ? (
                            <div className="empty-state">
                                <span className="empty-icon">🔍</span>
                                <p>No rebooking options available</p>
                            </div>
                        ) : (
                            rebookings.map(rb => (
                                <div key={rb.booking_id} className="rebooking-card">
                                    <div className="rebook-header">
                                        <span className="rebook-pax">{rb.passenger_name}</span>
                                    </div>
                                    <div className="rebook-route">
                                        <div className="rebook-missed">
                                            <span className="rebook-label">Missed</span>
                                            <span className="rebook-flight missed">{rb.missed_flight_number}</span>
                                            <span className="rebook-path">{rb.missed_origin} → {rb.missed_destination}</span>
                                        </div>
                                        <div className="rebook-arrow">→</div>
                                        <div className="rebook-suggested">
                                            <span className="rebook-label">Suggested</span>
                                            <span className="rebook-flight suggested">{rb.suggested_flight_number}</span>
                                            <span className="rebook-time">
                                                {new Date(rb.suggested_dep).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="rebook-meta">
                                        <span className="rebook-seats">{rb.seats_available} seats left</span>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
