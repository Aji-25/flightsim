import { useEffect, useRef, useState, useMemo } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import type { Flight } from '../types';

interface Props {
    flights: Flight[];
}

function interpolate(
    lat1: number, lng1: number,
    lat2: number, lng2: number,
    t: number
): [number, number] {
    // Clamp t between 0 and 1
    const p = Math.max(0, Math.min(1, t));
    return [
        lat1 + (lat2 - lat1) * p,
        lng1 + (lng2 - lng1) * p,
    ];
}

function getBearing(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const y = Math.sin(dLng) * Math.cos(lat2 * Math.PI / 180);
    const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
        Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLng);
    return ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360;
}

function createPlaneIcon(bearing: number, isDelayed: boolean): L.DivIcon {
    const color = isDelayed ? '#ef4444' : '#60a5fa';
    const glow = isDelayed ? 'drop-shadow(0 0 6px rgba(239,68,68,0.8))' : 'drop-shadow(0 0 4px rgba(96,165,250,0.6))';
    const pulseClass = isDelayed ? 'plane-delayed' : '';

    return L.divIcon({
        className: `plane-marker ${pulseClass}`,
        html: `<div style="
            transform: rotate(${bearing - 90}deg);
            filter: ${glow};
            font-size: 16px;
            line-height: 1;
            color: ${color};
            transition: transform 0.5s ease;
        ">✈</div>`,
        iconSize: [20, 20],
        iconAnchor: [10, 10],
    });
}

export default function FlightAnimation({ flights }: Props) {
    const map = useMap();
    const markersRef = useRef<Map<number, L.Marker>>(new Map());
    const trailsRef = useRef<Map<number, L.Polyline>>(new Map());
    const [tick, setTick] = useState(0);

    // Animation loop - 60fps-ish
    useEffect(() => {
        const interval = setInterval(() => setTick(t => t + 1), 1000);
        return () => clearInterval(interval);
    }, []);

    // Active flights that should be animated
    const activeFlights = useMemo(() => {
        return flights.filter(f =>
            f.status === 'ACTIVE' &&
            f.origin_lat != null && f.origin_lng != null &&
            f.dest_lat != null && f.dest_lng != null
        );
    }, [flights]);

    // Boarding/delayed flights to show at origin
    const groundFlights = useMemo(() => {
        return flights.filter(f =>
            (f.status === 'BOARDING' || f.status === 'DELAYED') &&
            f.origin_lat != null && f.origin_lng != null
        );
    }, [flights]);

    useEffect(() => {
        const now = new Date();
        const activeIds = new Set<number>();

        // Animate active (in-flight) planes
        for (const flight of activeFlights) {
            activeIds.add(flight.id);
            const depTime = new Date(flight.actual_dep || flight.scheduled_dep).getTime();
            const arrTime = new Date(flight.scheduled_arr).getTime();
            const duration = arrTime - depTime;
            if (duration <= 0) continue;

            const elapsed = now.getTime() - depTime;
            const progress = Math.max(0, Math.min(1, elapsed / duration));

            const [lat, lng] = interpolate(
                flight.origin_lat!, flight.origin_lng!,
                flight.dest_lat!, flight.dest_lng!,
                progress
            );

            const bearing = getBearing(
                flight.origin_lat!, flight.origin_lng!,
                flight.dest_lat!, flight.dest_lng!
            );

            const isDelayed = flight.delay_minutes > 0;
            const icon = createPlaneIcon(bearing, isDelayed);

            let marker = markersRef.current.get(flight.id);
            if (marker) {
                marker.setLatLng([lat, lng]);
                marker.setIcon(icon);
            } else {
                marker = L.marker([lat, lng], { icon, zIndexOffset: 1000 })
                    .addTo(map);
                markersRef.current.set(flight.id, marker);
            }

            // Tooltip
            const delayStr = isDelayed ? ` (+${flight.delay_minutes}m)` : '';
            marker.bindTooltip(
                `<strong>${flight.flight_number}</strong>${delayStr}<br/>` +
                `${flight.origin_code} → ${flight.destination_code}<br/>` +
                `Progress: ${Math.round(progress * 100)}%`,
                { direction: 'top', offset: [0, -12], className: 'plane-tooltip' }
            );

            // Trail line (origin → current position)
            let trail = trailsRef.current.get(flight.id);
            const trailCoords: L.LatLngExpression[] = [
                [flight.origin_lat!, flight.origin_lng!],
                [lat, lng],
            ];
            if (trail) {
                trail.setLatLngs(trailCoords);
            } else {
                trail = L.polyline(trailCoords, {
                    color: isDelayed ? '#ef4444' : '#60a5fa',
                    weight: isDelayed ? 3 : 1.5,
                    opacity: isDelayed ? 0.8 : 0.2,
                    dashArray: isDelayed ? undefined : '4 6',
                    className: isDelayed ? 'trail-delayed' : 'trail-normal'
                }).addTo(map);
                trailsRef.current.set(flight.id, trail);
            }
        }

        // Ground planes (boarding/delayed at origin)
        for (const flight of groundFlights) {
            activeIds.add(flight.id);
            const isDelayed = flight.status === 'DELAYED';
            const icon = createPlaneIcon(0, isDelayed);

            let marker = markersRef.current.get(flight.id);
            if (marker) {
                marker.setLatLng([flight.origin_lat!, flight.origin_lng!]);
                marker.setIcon(icon);
            } else {
                marker = L.marker([flight.origin_lat!, flight.origin_lng!], {
                    icon,
                    zIndexOffset: 900,
                }).addTo(map);
                markersRef.current.set(flight.id, marker);
            }

            const statusLabel = isDelayed ? `DELAYED +${flight.delay_minutes}m` : 'BOARDING';
            marker.bindTooltip(
                `<strong>${flight.flight_number}</strong><br/>` +
                `${statusLabel}<br/>` +
                `${flight.origin_code} → ${flight.destination_code}`,
                { direction: 'top', offset: [0, -12], className: 'plane-tooltip' }
            );
        }

        // Remove stale markers
        for (const [id, marker] of markersRef.current) {
            if (!activeIds.has(id)) {
                map.removeLayer(marker);
                markersRef.current.delete(id);
                const trail = trailsRef.current.get(id);
                if (trail) {
                    map.removeLayer(trail);
                    trailsRef.current.delete(id);
                }
            }
        }
    }, [activeFlights, groundFlights, map, tick]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            markersRef.current.forEach(m => map.removeLayer(m));
            trailsRef.current.forEach(t => map.removeLayer(t));
            markersRef.current.clear();
            trailsRef.current.clear();
        };
    }, [map]);

    return null; // Renders directly to Leaflet map
}
