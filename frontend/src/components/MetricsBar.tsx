import { useState, useEffect } from 'react';
import type { Metrics, CostEstimate } from '../types';

interface Props {
    mode: 'live' | 'sim';
    metrics: Metrics;
    costEstimate: CostEstimate | null;
    connected: boolean;
}

function formatCost(amount: number): string {
    if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
    if (amount >= 1_000) return `$${(amount / 1_000).toFixed(0)}K`;
    return `$${amount.toLocaleString()}`;
}

const API_BASE = 'http://localhost:3001';

export default function MetricsBar({ mode, metrics, costEstimate, connected }: Props) {
    const [showBreakdown, setShowBreakdown] = useState(false);
    const [liveMetrics, setLiveMetrics] = useState<Metrics | null>(null);

    // Fetch live metrics when in live mode
    useEffect(() => {
        if (mode !== 'live') { setLiveMetrics(null); return; }

        async function fetchLive() {
            try {
                const res = await fetch(`${API_BASE}/api/live-metrics`);
                if (res.ok) {
                    const data = await res.json();
                    setLiveMetrics(data);
                }
            } catch { /* silent */ }
        }

        fetchLive();
        const interval = setInterval(fetchLive, 15_000);
        return () => clearInterval(interval);
    }, [mode]);

    // Use live metrics if available, otherwise sim metrics
    const m = (mode === 'live' && liveMetrics) ? liveMetrics : metrics;
    const cost = m.estimated_cost || 0;

    return (
        <div className="metrics-bar">
            <div className="metrics-bar-inner">
                <div className="metric-card metric-delayed">
                    <div className="metric-icon">✈️</div>
                    <div className="metric-data">
                        <span className="metric-value">{m.delayed_flights}</span>
                        <span className="metric-label">Delayed Flights</span>
                    </div>
                </div>

                <div className="metric-card metric-missed">
                    <div className="metric-icon">🔗</div>
                    <div className="metric-data">
                        <span className="metric-value">{m.missed_connections}</span>
                        <span className="metric-label">Missed Connections</span>
                    </div>
                </div>

                <div className="metric-card metric-passengers">
                    <div className="metric-icon">👥</div>
                    <div className="metric-data">
                        <span className="metric-value">{m.impacted_passengers.toLocaleString()}</span>
                        <span className="metric-label">Impacted Passengers</span>
                    </div>
                </div>

                <div className="metric-card metric-time">
                    <div className="metric-icon">⏱️</div>
                    <div className="metric-data">
                        <span className="metric-value">
                            {m.total_delay_minutes >= 60
                                ? `${Math.floor(m.total_delay_minutes / 60)}h ${m.total_delay_minutes % 60}m`
                                : `${m.total_delay_minutes}m`
                            }
                        </span>
                        <span className="metric-label">Total Delay</span>
                    </div>
                </div>

                {/* $$ Cost Impact */}
                <div
                    className="metric-card metric-cost"
                    onMouseEnter={() => setShowBreakdown(true)}
                    onMouseLeave={() => setShowBreakdown(false)}
                >
                    <div className="metric-icon">💰</div>
                    <div className="metric-data">
                        <span className="metric-value">{formatCost(cost)}</span>
                        <span className="metric-label">$$ Impact</span>
                    </div>

                    {/* Cost breakdown tooltip — only in sim mode where we have detailed breakdown */}
                    {showBreakdown && mode === 'sim' && costEstimate && costEstimate.total_cost > 0 && (
                        <div className="cost-breakdown-popup">
                            <div className="cost-breakdown-title">Financial Impact Breakdown</div>
                            <div className="cost-row">
                                <span>🏨 Hotel Vouchers</span>
                                <span className="cost-amount">{formatCost(costEstimate.breakdown.hotel_vouchers.total)}</span>
                            </div>
                            <div className="cost-detail">{costEstimate.breakdown.hotel_vouchers.count} pax × ${costEstimate.breakdown.hotel_vouchers.unit_cost}</div>
                            <div className="cost-row">
                                <span>🎫 Rebooking Fees</span>
                                <span className="cost-amount">{formatCost(costEstimate.breakdown.rebooking_fees.total)}</span>
                            </div>
                            <div className="cost-row">
                                <span>👨‍✈️ Crew Overtime</span>
                                <span className="cost-amount">{formatCost(costEstimate.breakdown.crew_overtime.total)}</span>
                            </div>
                            <div className="cost-detail">{costEstimate.breakdown.crew_overtime.hours}h × {costEstimate.breakdown.crew_overtime.crew_per_flight} crew × ${costEstimate.breakdown.crew_overtime.rate}/hr</div>
                            <div className="cost-row">
                                <span>⚙️ Ops Cost</span>
                                <span className="cost-amount">{formatCost(costEstimate.breakdown.operational.total)}</span>
                            </div>
                            <div className="cost-detail">{costEstimate.breakdown.operational.delay_minutes}m × ${costEstimate.breakdown.operational.rate_per_min}/min</div>
                            <div className="cost-total">
                                <span>Total</span>
                                <span>{formatCost(costEstimate.total_cost)}</span>
                            </div>
                        </div>
                    )}

                    {/* Live mode tooltip */}
                    {showBreakdown && mode === 'live' && cost > 0 && (
                        <div className="cost-breakdown-popup">
                            <div className="cost-breakdown-title">Live Cost Estimate</div>
                            <div className="cost-row">
                                <span>⏱️ Delay Ops</span>
                                <span className="cost-amount">{formatCost(m.total_delay_minutes * 75)}</span>
                            </div>
                            <div className="cost-detail">{m.total_delay_minutes}m × $75/min</div>
                            <div className="cost-row">
                                <span>👥 Pax Impact</span>
                                <span className="cost-amount">{formatCost(cost - m.total_delay_minutes * 75)}</span>
                            </div>
                            <div className="cost-total">
                                <span>Total</span>
                                <span>{formatCost(cost)}</span>
                            </div>
                        </div>
                    )}
                </div>

                <div className={`connection-status ${connected ? 'status-connected' : 'status-disconnected'}`}>
                    <span className="status-dot"></span>
                    {connected ? 'LIVE' : 'OFFLINE'}
                </div>
            </div>
        </div>
    );
}
