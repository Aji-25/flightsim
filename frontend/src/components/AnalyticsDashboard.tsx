import { useState, useEffect, useCallback } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    LineChart, Line, AreaChart, Area, Cell, PieChart, Pie,
} from 'recharts';
import type { SnapshotSummary } from '../types';

const API_URL = 'https://flightsim.onrender.com';

interface Props {
    mode?: 'live' | 'sim';
    token: string | null;
    onBack: () => void;
}

interface DisruptionLogEntry {
    id: number;
    flight_number: string;
    delay_minutes: number;
    cause: string;
    cascaded_from_flight_id: number | null;
    passengers_impacted: number;
    flights_impacted: number;
    created_at: string;
    origin_code?: string;
    destination_code?: string;
}

interface AnalyticsData {
    disruption_log: DisruptionLogEntry[];
    airport_stats: { code: string; delay_count: number; total_delay: number }[];
    snapshots: SnapshotSummary[];
}

const CHART_COLORS = [
    '#3b82f6', '#a855f7', '#ef4444', '#f59e0b', '#10b981',
    '#6366f1', '#ec4899', '#14b8a6', '#f97316', '#8b5cf6',
];

function formatCost(val: number): string {
    if (val >= 1000000) return `$${(val / 1000000).toFixed(1)}M`;
    if (val >= 1000) return `$${(val / 1000).toFixed(0)}K`;
    return `$${val}`;
}

export default function AnalyticsDashboard({ mode = 'sim', token, onBack }: Props) {
    const [data, setData] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);

    const headers = useCallback((): HeadersInit => {
        const h: HeadersInit = {};
        if (token) h['Authorization'] = `Bearer ${token}`;
        return h;
    }, [token]);

    useEffect(() => {
        async function fetchAnalytics() {
            try {
                // Use live endpoint in live mode
                const analyticsUrl = mode === 'live'
                    ? `${API_URL}/api/live-analytics`
                    : `${API_URL}/api/analytics`;
                const snapshotsUrl = `${API_URL}/api/snapshots`;

                const fetches = mode === 'live'
                    ? [fetch(analyticsUrl)]
                    : [fetch(analyticsUrl, { headers: headers() }), fetch(snapshotsUrl, { headers: headers() })];

                const results = await Promise.all(fetches);
                const disruptions = await results[0].json();

                let snapshots: SnapshotSummary[] = [];
                if (mode === 'live') {
                    // Live analytics returns snapshots directly
                    snapshots = disruptions.snapshots || [];
                } else if (results[1]) {
                    const snapshotData = await results[1].json();
                    snapshots = snapshotData.snapshots || [];
                }

                setData({
                    disruption_log: disruptions.disruption_log || [],
                    airport_stats: disruptions.airport_stats || [],
                    snapshots,
                });
            } catch (err) {
                console.error('Analytics fetch failed:', err);
            }
            setLoading(false);
        }
        fetchAnalytics();
    }, [headers, mode]);

    if (loading) {
        return (
            <div className="analytics-screen">
                <div className="loading-content">
                    <div className="loading-spinner"></div>
                    <p>Loading analytics...</p>
                </div>
            </div>
        );
    }

    if (!data) {
        return (
            <div className="analytics-screen">
                <div className="loading-content">
                    <p>Failed to load analytics data</p>
                    <button className="btn-retry" onClick={onBack}>Back to War Room</button>
                </div>
            </div>
        );
    }

    // ----- Compute chart data -----

    // 1. Disruption frequency by hour
    const hourCounts = new Array(24).fill(0);
    data.disruption_log.forEach(d => {
        const hour = new Date(d.created_at).getHours();
        hourCounts[hour]++;
    });
    const hourData = hourCounts.map((count, hour) => ({
        hour: `${hour.toString().padStart(2, '0')}:00`,
        disruptions: count,
    }));

    // 2. Cost trend from snapshots
    const costTrend = data.snapshots
        .slice()
        .reverse()
        .map(s => {
            const m = s.metrics;
            const strandedCount = m.impacted_passengers || 0;
            const totalDelay = m.total_delay_minutes || 0;
            const cost = strandedCount * 350 + Math.round((totalDelay / 60) * 6 * 85) + totalDelay * 75;
            return {
                time: new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                cost,
                delayed: m.delayed_flights || 0,
                label: s.label,
            };
        });

    // 3. Top disrupted airports
    const topAirports = [...data.airport_stats]
        .sort((a, b) => b.total_delay - a.total_delay)
        .slice(0, 8);

    // 4. Cascade depth distribution
    const cascadeCounts: Record<string, number> = { 'Direct': 0, 'Cascaded': 0 };
    data.disruption_log.forEach(d => {
        if (d.cascaded_from_flight_id) cascadeCounts['Cascaded']++;
        else cascadeCounts['Direct']++;
    });
    const cascadeData = Object.entries(cascadeCounts).map(([name, value]) => ({ name, value }));

    // 5. Delay severity distribution
    const severityBuckets = [
        { label: '0-30m', min: 0, max: 30, count: 0 },
        { label: '30-60m', min: 30, max: 60, count: 0 },
        { label: '60-120m', min: 60, max: 120, count: 0 },
        { label: '120-240m', min: 120, max: 240, count: 0 },
        { label: '240m+', min: 240, max: Infinity, count: 0 },
    ];
    data.disruption_log.forEach(d => {
        const bucket = severityBuckets.find(b => d.delay_minutes >= b.min && d.delay_minutes < b.max);
        if (bucket) bucket.count++;
    });
    const severityData = severityBuckets.map(b => ({ range: b.label, count: b.count }));

    // Summary stats
    const totalDisruptions = data.disruption_log.length;
    const totalCascades = cascadeCounts['Cascaded'];
    const avgDelay = totalDisruptions > 0
        ? Math.round(data.disruption_log.reduce((s, d) => s + d.delay_minutes, 0) / totalDisruptions)
        : 0;
    const totalPax = data.disruption_log.reduce((s, d) => s + d.passengers_impacted, 0);

    const customTooltipStyle = {
        backgroundColor: 'rgba(10, 14, 26, 0.95)',
        border: '1px solid rgba(255,255,255,0.1)',
        borderRadius: '8px',
        padding: '10px 14px',
        color: '#e2e8f0',
        fontSize: '12px',
    };

    return (
        <div className="analytics-screen">
            <header className="analytics-header">
                <button className="analytics-back" onClick={onBack}>← War Room</button>
                <div className="analytics-title">
                    <span className="analytics-icon">📊</span>
                    <h1>ANALYTICS</h1>
                    <span className="analytics-subtitle">Disruption Intelligence</span>
                </div>
                <div className="analytics-summary-row">
                    <div className="analytics-stat">
                        <span className="analytics-stat-value">{totalDisruptions}</span>
                        <span className="analytics-stat-label">Total Events</span>
                    </div>
                    <div className="analytics-stat">
                        <span className="analytics-stat-value">{totalCascades}</span>
                        <span className="analytics-stat-label">Cascades</span>
                    </div>
                    <div className="analytics-stat">
                        <span className="analytics-stat-value">{avgDelay}m</span>
                        <span className="analytics-stat-label">Avg Delay</span>
                    </div>
                    <div className="analytics-stat">
                        <span className="analytics-stat-value">{totalPax.toLocaleString()}</span>
                        <span className="analytics-stat-label">Pax Impacted</span>
                    </div>
                </div>
            </header>

            <div className="analytics-grid">
                {/* Chart 1: Disruption Frequency by Hour */}
                <div className="chart-card">
                    <h3 className="chart-title">🕐 Disruption Frequency by Hour</h3>
                    <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={hourData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                            <XAxis dataKey="hour" tick={{ fill: '#64748b', fontSize: 10 }} interval={2} />
                            <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
                            <Tooltip contentStyle={customTooltipStyle} />
                            <Bar dataKey="disruptions" radius={[4, 4, 0, 0]}>
                                {hourData.map((_, i) => (
                                    <Cell key={i} fill={hourData[i].disruptions > 5 ? '#ef4444' : hourData[i].disruptions > 2 ? '#f59e0b' : '#3b82f6'} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Chart 2: Cost Trend Over Time */}
                <div className="chart-card">
                    <h3 className="chart-title">💰 Cost Impact Trend</h3>
                    <ResponsiveContainer width="100%" height={220}>
                        <AreaChart data={costTrend}>
                            <defs>
                                <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                            <XAxis dataKey="time" tick={{ fill: '#64748b', fontSize: 10 }} />
                            <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={formatCost} />
                            <Tooltip contentStyle={customTooltipStyle} formatter={(val) => [formatCost(val as number), 'Est. Cost']} />
                            <Area type="monotone" dataKey="cost" stroke="#f59e0b" fill="url(#costGradient)" strokeWidth={2} />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>

                {/* Chart 3: Top Disrupted Airports */}
                <div className="chart-card">
                    <h3 className="chart-title">🏗 Most Disrupted Airports</h3>
                    <ResponsiveContainer width="100%" height={220}>
                        <BarChart data={topAirports} layout="vertical">
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                            <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} />
                            <YAxis type="category" dataKey="code" tick={{ fill: '#e2e8f0', fontSize: 11, fontWeight: 600 }} width={40} />
                            <Tooltip contentStyle={customTooltipStyle} formatter={(val) => [`${val} min`, 'Total Delay']} />
                            <Bar dataKey="total_delay" radius={[0, 4, 4, 0]}>
                                {topAirports.map((_, i) => (
                                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                                ))}
                            </Bar>
                        </BarChart>
                    </ResponsiveContainer>
                </div>

                {/* Chart 4: Cascade Analysis */}
                <div className="chart-card chart-card-split">
                    <div className="chart-half">
                        <h3 className="chart-title">⚡ Cascade vs Direct</h3>
                        <ResponsiveContainer width="100%" height={180}>
                            <PieChart>
                                <Pie
                                    data={cascadeData}
                                    cx="50%"
                                    cy="50%"
                                    innerRadius={40}
                                    outerRadius={65}
                                    dataKey="value"
                                    stroke="none"
                                >
                                    <Cell fill="#3b82f6" />
                                    <Cell fill="#ef4444" />
                                </Pie>
                                <Tooltip contentStyle={customTooltipStyle} />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="chart-legend">
                            <span className="legend-item"><span className="legend-dot" style={{ background: '#3b82f6' }}></span>Direct</span>
                            <span className="legend-item"><span className="legend-dot" style={{ background: '#ef4444' }}></span>Cascaded</span>
                        </div>
                    </div>
                    <div className="chart-half">
                        <h3 className="chart-title">📏 Delay Severity</h3>
                        <ResponsiveContainer width="100%" height={180}>
                            <BarChart data={severityData}>
                                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                                <XAxis dataKey="range" tick={{ fill: '#64748b', fontSize: 9 }} />
                                <YAxis tick={{ fill: '#64748b', fontSize: 10 }} />
                                <Tooltip contentStyle={customTooltipStyle} />
                                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                                    {severityData.map((_, i) => (
                                        <Cell key={i} fill={['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#dc2626'][i]} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Chart 5: Delay Timeline (latest events) */}
                <div className="chart-card chart-card-wide">
                    <h3 className="chart-title">📈 Delay Timeline (Recent Events)</h3>
                    <ResponsiveContainer width="100%" height={200}>
                        <LineChart data={data.disruption_log.slice(0, 40).reverse().map((d, i) => ({
                            idx: i,
                            delay: d.delay_minutes,
                            flight: d.flight_number,
                            cascaded: !!d.cascaded_from_flight_id,
                        }))}>
                            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                            <XAxis dataKey="flight" tick={{ fill: '#64748b', fontSize: 9 }} angle={-45} textAnchor="end" height={50} />
                            <YAxis tick={{ fill: '#64748b', fontSize: 10 }} label={{ value: 'Delay (min)', angle: -90, position: 'insideLeft', fill: '#64748b', fontSize: 10 }} />
                            <Tooltip contentStyle={customTooltipStyle} />
                            <Line type="monotone" dataKey="delay" stroke="#a855f7" strokeWidth={2} dot={{ r: 3, fill: '#a855f7' }} activeDot={{ r: 5 }} />
                        </LineChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}
