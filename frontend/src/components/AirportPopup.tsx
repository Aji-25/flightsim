import { useState, useEffect } from 'react';
import type { AirportDetail } from '../types';

interface Props {
    airportCode: string;
    onClose: () => void;
    fetchAirportDetail: (code: string) => Promise<AirportDetail | null>;
}

function getStatusBadge(status: string): { color: string; label: string } {
    switch (status) {
        case 'DELAYED': return { color: '#ef4444', label: 'DELAYED' };
        case 'ACTIVE': return { color: '#22c55e', label: 'IN AIR' };
        case 'BOARDING': return { color: '#f59e0b', label: 'BOARDING' };
        case 'LANDED': return { color: '#6b7280', label: 'LANDED' };
        case 'CANCELLED': return { color: '#991b1b', label: 'CANCEL' };
        default: return { color: '#3b82f6', label: 'SCHED' };
    }
}

export default function AirportPopup({ airportCode, onClose, fetchAirportDetail }: Props) {
    const [detail, setDetail] = useState<AirportDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<'departures' | 'arrivals' | 'disruptions'>('departures');

    useEffect(() => {
        setLoading(true);
        fetchAirportDetail(airportCode).then(data => {
            setDetail(data);
            setLoading(false);
        });
    }, [airportCode, fetchAirportDetail]);

    if (loading) {
        return (
            <div className="airport-popup-overlay" onClick={onClose}>
                <div className="airport-popup" onClick={e => e.stopPropagation()}>
                    <div className="airport-popup-loading">
                        <div className="loading-spinner small-spinner"></div>
                        <p>Loading {airportCode}...</p>
                    </div>
                </div>
            </div>
        );
    }

    if (!detail) return null;

    const { airport, departures, arrivals, disruptions, stats } = detail;

    return (
        <div className="airport-popup-overlay" onClick={onClose}>
            <div className="airport-popup" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="airport-popup-header">
                    <div className="airport-popup-title">
                        <span className="airport-popup-code">{airport.code}</span>
                        <div className="airport-popup-info">
                            <span className="airport-popup-name">{airport.name}</span>
                            <span className="airport-popup-city">{airport.city}, {airport.country}</span>
                        </div>
                    </div>
                    <button className="airport-popup-close" onClick={onClose}>✕</button>
                </div>

                {/* Stats row */}
                <div className="airport-stats-row">
                    <div className="airport-stat">
                        <span className="airport-stat-value">{stats.total_departures}</span>
                        <span className="airport-stat-label">Departures</span>
                    </div>
                    <div className="airport-stat">
                        <span className="airport-stat-value">{stats.total_arrivals}</span>
                        <span className="airport-stat-label">Arrivals</span>
                    </div>
                    <div className="airport-stat stat-danger">
                        <span className="airport-stat-value">{stats.delayed_departures + stats.delayed_arrivals}</span>
                        <span className="airport-stat-label">Delayed</span>
                    </div>
                    <div className="airport-stat stat-warn">
                        <span className="airport-stat-value">
                            {stats.total_delay_minutes >= 60
                                ? `${Math.floor(stats.total_delay_minutes / 60)}h${stats.total_delay_minutes % 60}m`
                                : `${stats.total_delay_minutes}m`}
                        </span>
                        <span className="airport-stat-label">Total Delay</span>
                    </div>
                </div>

                {/* Tabs */}
                <div className="airport-tabs">
                    <button
                        className={`airport-tab ${tab === 'departures' ? 'airport-tab-active' : ''}`}
                        onClick={() => setTab('departures')}
                    >
                        Departures ({departures.length})
                    </button>
                    <button
                        className={`airport-tab ${tab === 'arrivals' ? 'airport-tab-active' : ''}`}
                        onClick={() => setTab('arrivals')}
                    >
                        Arrivals ({arrivals.length})
                    </button>
                    <button
                        className={`airport-tab ${tab === 'disruptions' ? 'airport-tab-active' : ''}`}
                        onClick={() => setTab('disruptions')}
                    >
                        Timeline ({disruptions.length})
                    </button>
                </div>

                {/* Content */}
                <div className="airport-popup-content">
                    {tab === 'departures' && (
                        <div className="airport-flight-list">
                            {departures.map(f => {
                                const badge = getStatusBadge(f.status);
                                return (
                                    <div key={f.id} className={`airport-flight-row ${f.status === 'DELAYED' ? 'row-delayed' : ''}`}>
                                        <span className="afl-number">{f.flight_number}</span>
                                        <span className="afl-dest">→ {f.destination_code}</span>
                                        <span className="afl-time">
                                            {f.scheduled_dep ? new Date(f.scheduled_dep).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                                        </span>
                                        {f.delay_minutes > 0 && (
                                            <span className="afl-delay">+{f.delay_minutes}m</span>
                                        )}
                                        <span className="afl-status" style={{ color: badge.color }}>{badge.label}</span>
                                    </div>
                                );
                            })}
                            {departures.length === 0 && (
                                <div className="airport-empty">No departures</div>
                            )}
                        </div>
                    )}

                    {tab === 'arrivals' && (
                        <div className="airport-flight-list">
                            {arrivals.map(f => {
                                const badge = getStatusBadge(f.status);
                                return (
                                    <div key={f.id} className={`airport-flight-row ${f.status === 'DELAYED' ? 'row-delayed' : ''}`}>
                                        <span className="afl-number">{f.flight_number}</span>
                                        <span className="afl-dest">← {f.origin_code}</span>
                                        <span className="afl-time">
                                            {f.scheduled_arr ? new Date(f.scheduled_arr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                                        </span>
                                        {f.delay_minutes > 0 && (
                                            <span className="afl-delay">+{f.delay_minutes}m</span>
                                        )}
                                        <span className="afl-status" style={{ color: badge.color }}>{badge.label}</span>
                                    </div>
                                );
                            })}
                            {arrivals.length === 0 && (
                                <div className="airport-empty">No arrivals</div>
                            )}
                        </div>
                    )}

                    {tab === 'disruptions' && (
                        <div className="airport-timeline">
                            {disruptions.map((d, i) => (
                                <div key={i} className="timeline-item">
                                    <div className="timeline-dot"></div>
                                    <div className="timeline-body">
                                        <div className="timeline-headline">
                                            <span className="timeline-flight">{d.flight_number}</span>
                                            <span className="timeline-delay">+{d.delay_minutes}m</span>
                                        </div>
                                        <div className="timeline-cause">{d.cause}</div>
                                        <div className="timeline-time">
                                            {new Date(d.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                        </div>
                                    </div>
                                </div>
                            ))}
                            {disruptions.length === 0 && (
                                <div className="airport-empty">No disruptions at this airport</div>
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
