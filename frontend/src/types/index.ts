export interface Airport {
    code: string;
    name: string;
    city: string;
    country: string;
    lat: number;
    lng: number;
    timezone: string;
}

export interface Aircraft {
    id: number;
    tail_number: string;
    model: string;
    capacity: number;
    current_airport_code: string | null;
}

export interface Flight {
    id: number;
    flight_number: string;
    aircraft_id: number;
    origin_code: string;
    destination_code: string;
    scheduled_dep: string;
    scheduled_arr: string;
    actual_dep: string | null;
    actual_arr: string | null;
    delay_minutes: number;
    status: 'SCHEDULED' | 'BOARDING' | 'ACTIVE' | 'LANDED' | 'DELAYED' | 'CANCELLED';
    aircraft_tail?: string;
    aircraft_model?: string;
    origin_name?: string;
    origin_lat?: number;
    origin_lng?: number;
    dest_name?: string;
    dest_lat?: number;
    dest_lng?: number;
}

export interface MissedConnection {
    booking_id: number;
    first_name: string;
    last_name: string;
    email?: string;
    from_flight: string;
    from_origin?: string;
    from_dest?: string;
    arriving_at: string;
    missed_flight: string;
    missed_origin?: string;
    missed_dest?: string;
    missed_dep: string;
    connection_airport?: string;
    from_dest_lat?: number;
    from_dest_lng?: number;
    missed_dest_lat?: number;
    missed_dest_lng?: number;
    connection_lat?: number;
    connection_lng?: number;
}

export interface DisruptionLog {
    id: number;
    flight_id: number;
    flight_number: string;
    delay_minutes: number;
    cause: string;
    cascaded_from_flight_id: number | null;
    passengers_impacted: number;
    flights_impacted: number;
    created_at: string;
}

export interface DisruptionEvent {
    id: number;
    flight_id: number;
    flight_number: string;
    origin_code?: string;
    destination_code?: string;
    delay_minutes: number;
    cause: string;
    cascaded: boolean;
    passengers_impacted: number;
    flights_impacted: number;
    created_at: string;
}

export interface Metrics {
    delayed_flights: number;
    missed_connections: number;
    total_delay_minutes: number;
    impacted_passengers: number;
    estimated_cost: number;
    active_flights?: number;
    total_flights?: number;
}

export interface WorldState {
    flights: Flight[];
    missedConnections: MissedConnection[];
    metrics: Metrics;
    timestamp: string;
}

export interface InitialState {
    airports: Airport[];
    flights: Flight[];
    aircraft: Aircraft[];
}

export interface ChaosScenario {
    id: string;
    label: string;
    emoji: string;
    description: string;
    airport: string;
}

export interface RebookingSuggestion {
    booking_id: number;
    passenger_name: string;
    passenger_id: number;
    missed_flight_number: string;
    missed_origin: string;
    missed_destination: string;
    suggested_flight_id: number;
    suggested_flight_number: string;
    suggested_dep: string;
    suggested_arr: string;
    seats_available: number;
    time_saved_minutes: number;
}

export interface CostBreakdownItem {
    count?: number;
    unit_cost?: number;
    hours?: number;
    crew_per_flight?: number;
    rate?: number;
    rate_per_min?: number;
    delay_minutes?: number;
    total: number;
}

export interface CostEstimate {
    total_cost: number;
    breakdown: {
        hotel_vouchers: CostBreakdownItem;
        rebooking_fees: CostBreakdownItem;
        crew_overtime: CostBreakdownItem;
        operational: CostBreakdownItem;
    };
    stranded_passengers: number;
    delayed_flights: number;
}

export interface AirportFlightInfo {
    id: number;
    flight_number: string;
    origin_code?: string;
    destination_code?: string;
    scheduled_dep?: string;
    scheduled_arr?: string;
    actual_dep?: string;
    actual_arr?: string;
    delay_minutes: number;
    status: string;
}

export interface AirportDetail {
    airport: Airport;
    departures: AirportFlightInfo[];
    arrivals: AirportFlightInfo[];
    disruptions: any[];
    stats: {
        total_departures: number;
        total_arrivals: number;
        delayed_departures: number;
        delayed_arrivals: number;
        total_delay_minutes: number;
    };
}

// ----- Auth Types -----
export interface User {
    id: string;
    email: string;
    role: 'admin' | 'viewer';
    display_name: string;
    avatar_url?: string;
}

export interface AuthSession {
    access_token: string;
    refresh_token: string;
    expires_at: number;
}

// ----- Presence Types -----
export interface PresenceUser {
    id: string;
    socketId?: string;
    userId: string;
    displayName: string;
    role: string;
    avatarUrl?: string;
    color: string;
    cursor: { x: number; y: number } | null;
    focusedAirport: string | null;
    joinedAt: string;
}

// ----- Snapshot / Replay Types -----
export interface SnapshotSummary {
    id: number;
    label: string;
    metrics: Metrics;
    created_at: string;
}

export interface Snapshot {
    id: number;
    label: string;
    flights_data: Flight[];
    missed_connections_data: any[];
    metrics: Metrics;
    event_feed: any[];
    created_at: string;
}
