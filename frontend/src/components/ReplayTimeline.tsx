import { useState, useEffect, useCallback } from 'react';
import type { SnapshotSummary, Snapshot, Metrics } from '../types';

const API_URL = 'https://flightsim.onrender.com';

interface Props {
    onReplaySnapshot: (snapshot: Snapshot) => void;
    onExitReplay: () => void;
    isReplaying: boolean;
    token: string | null;
}

function formatTime(dateStr: string): string {
    return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatMetricsSummary(metrics: Metrics): string {
    return `${metrics.delayed_flights} delayed · ${metrics.missed_connections} missed · ${metrics.total_delay_minutes}m total`;
}

export default function ReplayTimeline({ onReplaySnapshot, onExitReplay, isReplaying, token }: Props) {
    const [snapshots, setSnapshots] = useState<SnapshotSummary[]>([]);
    const [loading, setLoading] = useState(false);
    const [expanded, setExpanded] = useState(false);
    const [activeSnapshotId, setActiveSnapshotId] = useState<number | null>(null);
    const [scrubIndex, setScrubIndex] = useState(0);

    const fetchSnapshots = useCallback(async () => {
        setLoading(true);
        try {
            const headers: HeadersInit = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const res = await fetch(`${API_URL}/api/snapshots`, { headers });
            const data = await res.json();
            setSnapshots(data.snapshots || []);
        } catch {
            // silently fail
        }
        setLoading(false);
    }, [token]);

    useEffect(() => {
        if (expanded) fetchSnapshots();
    }, [expanded, fetchSnapshots]);

    const loadSnapshot = async (id: number) => {
        try {
            const headers: HeadersInit = {};
            if (token) headers['Authorization'] = `Bearer ${token}`;
            const res = await fetch(`${API_URL}/api/snapshots/${id}`, { headers });
            const data: Snapshot = await res.json();
            setActiveSnapshotId(id);
            onReplaySnapshot(data);
        } catch {
            // silently fail
        }
    };

    const handleScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
        const idx = parseInt(e.target.value, 10);
        setScrubIndex(idx);
        if (snapshots[idx]) {
            loadSnapshot(snapshots[idx].id);
        }
    };

    return (
        <div className={`replay-panel ${expanded ? 'replay-expanded' : ''}`}>
            <button
                className="replay-toggle"
                onClick={() => {
                    if (isReplaying) {
                        onExitReplay();
                        setActiveSnapshotId(null);
                    }
                    setExpanded(!expanded);
                }}
            >
                {isReplaying ? '⏹ Exit Replay' : '⏮ Replay'}
            </button>

            {expanded && (
                <div className="replay-content">
                    <div className="replay-header">
                        <h3>📼 Historical Replay</h3>
                        <button className="replay-refresh" onClick={fetchSnapshots}>↻</button>
                    </div>

                    {loading && <div className="replay-loading">Loading snapshots...</div>}

                    {!loading && snapshots.length === 0 && (
                        <div className="replay-empty">No snapshots yet. Trigger some disruptions first!</div>
                    )}

                    {!loading && snapshots.length > 0 && (
                        <>
                            {/* Timeline scrubber */}
                            <div className="replay-scrubber">
                                <input
                                    type="range"
                                    min={0}
                                    max={snapshots.length - 1}
                                    value={scrubIndex}
                                    onChange={handleScrub}
                                    className="scrubber-slider"
                                />
                                <div className="scrubber-labels">
                                    <span>{formatTime(snapshots[snapshots.length - 1].created_at)}</span>
                                    <span>{formatTime(snapshots[0].created_at)}</span>
                                </div>
                            </div>

                            {/* Snapshot list */}
                            <div className="snapshot-list">
                                {snapshots.map((snap, i) => (
                                    <div
                                        key={snap.id}
                                        className={`snapshot-item ${snap.id === activeSnapshotId ? 'snapshot-active' : ''}`}
                                        onClick={() => { setScrubIndex(i); loadSnapshot(snap.id); }}
                                    >
                                        <div className="snapshot-time">{formatTime(snap.created_at)}</div>
                                        <div className="snapshot-label">{snap.label}</div>
                                        <div className="snapshot-metrics">{formatMetricsSummary(snap.metrics)}</div>
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
