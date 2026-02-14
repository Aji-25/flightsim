import { useState } from 'react';
import type { Flight, ChaosScenario } from '../types';

interface Props {
    flights: Flight[];
    onTriggerDelay: (flightId?: number, delayMinutes?: number, cause?: string) => void;
    onTriggerScenario: (scenarioId: string) => void;
    onReset: () => void;
}

const SCENARIOS: ChaosScenario[] = [
    { id: 'snowstorm_jfk', label: 'Snowstorm at JFK', emoji: '❄️', description: 'All JFK departures delayed 2-4h', airport: 'JFK' },
    { id: 'crew_strike_lhr', label: 'Crew Strike at LHR', emoji: '✊', description: 'Crew walkout grounds LHR flights', airport: 'LHR' },
    { id: 'fog_cdg', label: 'Dense Fog at CDG', emoji: '🌫️', description: 'Low visibility ops at CDG', airport: 'CDG' },
    { id: 'atc_failure_fra', label: 'ATC Failure at FRA', emoji: '🗼', description: 'Radar failure causes ground stop', airport: 'FRA' },
    { id: 'typhoon_hnd', label: 'Typhoon near HND', emoji: '🌀', description: 'All HND flights suspended 3-5h', airport: 'HND' },
];

export default function ControlPanel({ flights, onTriggerDelay, onTriggerScenario, onReset }: Props) {
    const [isOpen, setIsOpen] = useState(false);
    const [tab, setTab] = useState<'manual' | 'scenarios'>('scenarios');
    const [selectedFlight, setSelectedFlight] = useState<string>('');
    const [delayMinutes, setDelayMinutes] = useState(60);
    const [cause, setCause] = useState('Manual delay trigger');
    const [triggeringScenario, setTriggeringScenario] = useState<string | null>(null);

    const activeFlights = flights.filter(f =>
        f.status !== 'LANDED' && f.status !== 'CANCELLED'
    );

    const handleTrigger = () => {
        if (selectedFlight) {
            onTriggerDelay(parseInt(selectedFlight), delayMinutes, cause);
        } else {
            onTriggerDelay();
        }
    };

    const [showToast, setShowToast] = useState<{ id: string, label: string, emoji: string } | null>(null);

    const handleScenario = async (id: string) => {
        const scenario = SCENARIOS.find(s => s.id === id);
        if (!scenario) return;

        setTriggeringScenario(id);
        try {
            await onTriggerScenario(id);
            // Show Chaos Toast
            setShowToast({ id: scenario.id, label: scenario.label, emoji: scenario.emoji });
            setTimeout(() => setShowToast(null), 4000);
        } catch (err) {
            console.error('Failed to trigger scenario:', err);
        } finally {
            setTimeout(() => setTriggeringScenario(null), 2000);
        }
    };

    return (
        <div className={`control-panel ${isOpen ? 'panel-open' : ''}`}>
            <button className="panel-toggle" onClick={() => setIsOpen(!isOpen)}>
                {isOpen ? '✕' : '🎛️'}
            </button>

            {isOpen && (
                <div className="panel-content">
                    <h3>Simulation Controls</h3>

                    {/* Tab Switcher */}
                    <div className="control-tabs">
                        <button
                            className={`control-tab ${tab === 'scenarios' ? 'control-tab-active' : ''}`}
                            onClick={() => setTab('scenarios')}
                        >
                            🌪️ Scenarios
                        </button>
                        <button
                            className={`control-tab ${tab === 'manual' ? 'control-tab-active' : ''}`}
                            onClick={() => setTab('manual')}
                        >
                            🎯 Manual
                        </button>
                    </div>

                    {/* === Scenarios Tab === */}
                    {tab === 'scenarios' && (
                        <div className="scenarios-list">
                            {SCENARIOS.map(s => (
                                <button
                                    key={s.id}
                                    className={`scenario-btn ${triggeringScenario === s.id ? 'scenario-active' : ''}`}
                                    onClick={() => handleScenario(s.id)}
                                    disabled={triggeringScenario !== null}
                                >
                                    <span className="scenario-emoji">{s.emoji}</span>
                                    <div className="scenario-text">
                                        <span className="scenario-label">{s.label}</span>
                                        <span className="scenario-desc">{s.description}</span>
                                    </div>
                                    {triggeringScenario === s.id && (
                                        <span className="scenario-loading">⏳</span>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* === Manual Tab === */}
                    {tab === 'manual' && (
                        <>
                            <div className="control-group">
                                <label>Target Flight</label>
                                <select
                                    value={selectedFlight}
                                    onChange={e => setSelectedFlight(e.target.value)}
                                    className="control-select"
                                >
                                    <option value="">Random Flight</option>
                                    {activeFlights.map(f => (
                                        <option key={f.id} value={f.id}>
                                            {f.flight_number} ({f.origin_code}→{f.destination_code})
                                            {f.status === 'DELAYED' ? ` [+${f.delay_minutes}m]` : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div className="control-group">
                                <label>Delay: {delayMinutes} minutes</label>
                                <input
                                    type="range"
                                    min={10}
                                    max={300}
                                    step={5}
                                    value={delayMinutes}
                                    onChange={e => setDelayMinutes(parseInt(e.target.value))}
                                    className="control-range"
                                />
                                <div className="range-labels">
                                    <span>10m</span>
                                    <span>5h</span>
                                </div>
                            </div>

                            <div className="control-group">
                                <label>Cause</label>
                                <select
                                    value={cause}
                                    onChange={e => setCause(e.target.value)}
                                    className="control-select"
                                >
                                    <option value="Weather delay">🌧️ Weather delay</option>
                                    <option value="ATC congestion">🗼 ATC congestion</option>
                                    <option value="Mechanical issue">🔧 Mechanical issue</option>
                                    <option value="Crew availability">👨‍✈️ Crew availability</option>
                                    <option value="Security screening delay">🛡️ Security screening</option>
                                    <option value="Gate conflict">🚪 Gate conflict</option>
                                    <option value="Late incoming aircraft">⏰ Late incoming aircraft</option>
                                    <option value="Manual delay trigger">🎯 Manual trigger</option>
                                </select>
                            </div>

                            <button className="btn-trigger" onClick={handleTrigger}>
                                ⚡ Trigger Disruption
                            </button>

                            <button className="btn-random" onClick={() => onTriggerDelay()}>
                                🎲 Random Chaos
                            </button>
                        </>
                    )}

                    <hr className="control-divider" />

                    <button className="btn-reset" onClick={onReset}>
                        🔄 Reset Simulation
                    </button>
                </div>
            )}

            {/* Warning Toast */}
            {showToast && (
                <div className="chaos-toast">
                    <div className="toast-icon">{showToast.emoji}</div>
                    <div className="toast-content">
                        <h4>CRITICAL ALERT</h4>
                        <p>{showToast.label} Active</p>
                    </div>
                </div>
            )}
        </div>
    );
}
