import { useEffect, useRef, useState } from 'react';
import type { DisruptionEvent } from '../types';

interface Props {
    mode: 'live' | 'sim';
    events: DisruptionEvent[];
}

const API_BASE = 'https://flightsim.onrender.com';

function getEventIcon(event: DisruptionEvent): string {
    if (event.passengers_impacted > 0) return '🔗';
    if (event.cascaded) return '⛓️';
    if (event.cause?.toLowerCase().includes('weather')) return '🌧️';
    if (event.cause?.toLowerCase().includes('fog')) return '🌫️';
    if (event.cause?.toLowerCase().includes('typhoon')) return '🌀';
    if (event.cause?.toLowerCase().includes('atc')) return '🗼';
    if (event.cause?.toLowerCase().includes('mechanical')) return '🔧';
    if (event.cause?.toLowerCase().includes('crew')) return '👨‍✈️';
    if (event.cause?.toLowerCase().includes('snow')) return '❄️';
    if (event.cause?.toLowerCase().includes('late')) return '⏱️';
    if (event.cause?.toLowerCase().includes('severe')) return '🌩️';
    return '⚡';
}

function formatTimeAgo(dateStr: string): string {
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
    if (diff < 5) return 'just now';
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
}

function getSeverityClass(delay: number): string {
    if (delay >= 180) return 'severity-critical';
    if (delay >= 90) return 'severity-major';
    if (delay >= 45) return 'severity-moderate';
    return 'severity-minor';
}

export default function EventFeed({ mode, events }: Props) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [liveEvents, setLiveEvents] = useState<DisruptionEvent[]>([]);

    // Fetch live events when in live mode
    useEffect(() => {
        if (mode !== 'live') { setLiveEvents([]); return; }

        async function fetchLiveEvents() {
            try {
                const res = await fetch(`${API_BASE}/api/live-events`);
                if (res.ok) {
                    const data = await res.json();
                    setLiveEvents(data.events || []);
                }
            } catch { /* silent */ }
        }

        fetchLiveEvents();
        const interval = setInterval(fetchLiveEvents, 15_000);
        return () => clearInterval(interval);
    }, [mode]);

    const displayEvents = mode === 'live' ? liveEvents : events;

    // Auto-scroll to top when new events arrive
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = 0;
        }
    }, [displayEvents.length]);

    if (displayEvents.length === 0) {
        return (
            <div className="event-feed">
                <div className="event-feed-header">
                    <h3>📡 Live Event Feed</h3>
                    <span className="event-count">0 events</span>
                </div>
                <div className="event-feed-empty">
                    <div className="empty-pulse"></div>
                    <p>Waiting for disruptions...</p>
                    <p className="event-feed-hint">
                        {mode === 'live' ? 'Loading live delay data...' : 'Trigger a delay or scenario to see events'}
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="event-feed">
            <div className="event-feed-header">
                <h3>📡 {mode === 'live' ? 'Live Delay Feed' : 'Live Event Feed'}</h3>
                <span className="event-count">{displayEvents.length} events</span>
            </div>
            <div className="event-feed-scroll" ref={scrollRef}>
                {displayEvents.map((event, idx) => (
                    <div
                        key={event.id}
                        className={`event-item ${getSeverityClass(event.delay_minutes)} ${idx === 0 ? 'event-new' : ''}`}
                    >
                        <div className="event-icon">{getEventIcon(event)}</div>
                        <div className="event-body">
                            <div className="event-headline">
                                <span className="event-flight">{event.flight_number}</span>
                                {event.origin_code && event.destination_code && (
                                    <span className="event-route">
                                        {event.origin_code} → {event.destination_code}
                                    </span>
                                )}
                                <span className="event-delay">+{event.delay_minutes}m</span>
                            </div>
                            <div className="event-cause">{event.cause}</div>
                            <div className="event-meta">
                                <span className="event-time">{formatTimeAgo(event.created_at)}</span>
                                {event.cascaded && <span className="event-tag tag-cascade">CASCADE</span>}
                                {event.passengers_impacted > 0 && (
                                    <span className="event-tag tag-pax">
                                        {event.passengers_impacted} PAX
                                    </span>
                                )}
                                {event.flights_impacted > 0 && (
                                    <span className="event-tag tag-chain">
                                        +{event.flights_impacted} flights
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
