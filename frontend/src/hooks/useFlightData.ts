import { useEffect, useRef, useState, useCallback } from 'react';
import { io, Socket } from 'socket.io-client';
import type { WorldState, InitialState, DisruptionEvent, RebookingSuggestion, CostEstimate, AirportDetail, PresenceUser, Snapshot } from '../types';

const API_URL = 'https://flightsim.onrender.com';

interface UseFlightDataOptions {
    token: string | null;
    userId: string | null;
    displayName: string;
    role: string;
}

export function useFlightData(options: UseFlightDataOptions) {
    const { token, userId, displayName, role } = options;
    const socketRef = useRef<Socket | null>(null);
    const [initialState, setInitialState] = useState<InitialState | null>(null);
    const [worldState, setWorldState] = useState<WorldState | null>(null);
    const [eventFeed, setEventFeed] = useState<DisruptionEvent[]>([]);
    const [rebookings, setRebookings] = useState<RebookingSuggestion[]>([]);
    const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);
    const [connected, setConnected] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Presence state
    const [presenceUsers, setPresenceUsers] = useState<PresenceUser[]>([]);

    // Replay state
    const [isReplaying, setIsReplaying] = useState(false);
    const [replayState, setReplayState] = useState<WorldState | null>(null);

    const authHeaders = useCallback((): HeadersInit => {
        const h: HeadersInit = { 'Content-Type': 'application/json' };
        if (token) h['Authorization'] = `Bearer ${token}`;
        return h;
    }, [token]);

    // Fetch initial state (airports, flights, aircraft)
    useEffect(() => {
        fetch(`${API_URL}/api/state`, { headers: authHeaders() })
            .then(res => res.json())
            .then(data => {
                setInitialState(data);
                setLoading(false);
            })
            .catch(err => {
                setError(`Failed to connect to server: ${err.message}`);
                setLoading(false);
            });
    }, [authHeaders]);

    // Fetch rebookings + cost whenever world state changes
    const fetchSideData = useCallback(async () => {
        try {
            const [rebookRes, costRes] = await Promise.all([
                fetch(`${API_URL}/api/rebookings`, { headers: authHeaders() }),
                fetch(`${API_URL}/api/cost-estimate`, { headers: authHeaders() }),
            ]);
            const rebookData = await rebookRes.json();
            const costData = await costRes.json();
            setRebookings(rebookData.suggestions || []);
            setCostEstimate(costData);
        } catch {
            // Non-critical — silently fail
        }
    }, [authHeaders]);

    // WebSocket connection
    useEffect(() => {
        const socket = io(API_URL, {
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionDelay: 1000,
        });
        socketRef.current = socket;

        socket.on('connect', () => {
            console.log('🔌 Connected to War Room');
            setConnected(true);

            // Join presence
            socket.emit('presence:join', {
                userId: userId || socket.id,
                displayName: displayName || 'Anonymous',
                role: role || 'viewer',
            });
        });

        socket.on('disconnect', () => {
            console.log('🔌 Disconnected from War Room');
            setConnected(false);
        });

        socket.on('world_state', (data: WorldState) => {
            if (!isReplaying) {
                setWorldState(data);
                fetchSideData();
            }
        });

        socket.on('disruption_event', (event: DisruptionEvent) => {
            if (!isReplaying) {
                setEventFeed(prev => [event, ...prev].slice(0, 100));
            }
        });

        socket.on('simulation_reset', () => {
            setEventFeed([]);
            setRebookings([]);
            setCostEstimate(null);
            setIsReplaying(false);
            setReplayState(null);
            fetch(`${API_URL}/api/state`, { headers: authHeaders() })
                .then(res => res.json())
                .then(setInitialState);
        });

        // Presence updates
        socket.on('presence:state', (users: PresenceUser[]) => {
            setPresenceUsers(users);
        });

        return () => {
            socket.disconnect();
        };
    }, [fetchSideData, isReplaying, userId, displayName, role, authHeaders]);

    // Cursor tracking for presence
    const sendCursorPosition = useCallback((x: number, y: number) => {
        socketRef.current?.emit('presence:cursor', { x, y });
    }, []);

    const sendFocus = useCallback((airport: string | null) => {
        socketRef.current?.emit('presence:focus', { airport });
    }, []);

    // Replay handlers
    const handleReplaySnapshot = useCallback((snapshot: Snapshot) => {
        setIsReplaying(true);
        setReplayState({
            flights: snapshot.flights_data,
            missedConnections: snapshot.missed_connections_data,
            metrics: snapshot.metrics,
            timestamp: snapshot.created_at,
        });
    }, []);

    const handleExitReplay = useCallback(() => {
        setIsReplaying(false);
        setReplayState(null);
    }, []);

    const triggerDelay = useCallback(async (flightId?: number, delayMinutes?: number, cause?: string) => {
        try {
            await fetch(`${API_URL}/api/simulate/delay`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ flightId, delayMinutes, cause }),
            });
        } catch (err) {
            console.error('Failed to trigger delay:', err);
        }
    }, [authHeaders]);

    const triggerScenario = useCallback(async (scenarioId: string) => {
        try {
            const res = await fetch(`${API_URL}/api/simulate/scenario`, {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ scenario: scenarioId }),
            });
            return await res.json();
        } catch (err) {
            console.error('Failed to trigger scenario:', err);
        }
    }, [authHeaders]);

    const resetSimulation = useCallback(async () => {
        try {
            await fetch(`${API_URL}/api/simulate/reset`, {
                method: 'POST',
                headers: authHeaders(),
            });
            setWorldState(null);
            setEventFeed([]);
            setRebookings([]);
            setCostEstimate(null);
            setIsReplaying(false);
            setReplayState(null);
            const res = await fetch(`${API_URL}/api/state`, { headers: authHeaders() });
            const data = await res.json();
            setInitialState(data);
        } catch (err) {
            console.error('Failed to reset:', err);
        }
    }, [authHeaders]);

    const fetchAirportDetail = useCallback(async (code: string): Promise<AirportDetail | null> => {
        try {
            const res = await fetch(`${API_URL}/api/airports/${code}`, { headers: authHeaders() });
            return await res.json();
        } catch (err) {
            console.error('Failed to fetch airport detail:', err);
            return null;
        }
    }, [authHeaders]);

    // Active state: replay overrides live
    const activeState = isReplaying && replayState ? replayState : worldState;

    const flights = activeState?.flights ?? initialState?.flights ?? [];
    const airports = initialState?.airports ?? [];
    const metrics = activeState?.metrics ?? {
        delayed_flights: 0,
        missed_connections: 0,
        total_delay_minutes: 0,
        impacted_passengers: 0,
        estimated_cost: 0,
    };
    const missedConnections = activeState?.missedConnections ?? [];

    return {
        flights,
        airports,
        aircraft: initialState?.aircraft ?? [],
        metrics,
        missedConnections,
        eventFeed,
        rebookings,
        costEstimate,
        connected,
        loading,
        error,
        triggerDelay,
        triggerScenario,
        resetSimulation,
        fetchAirportDetail,
        // Presence
        presenceUsers,
        sendCursorPosition,
        sendFocus,
        // Replay
        isReplaying,
        handleReplaySnapshot,
        handleExitReplay,
    };
}
