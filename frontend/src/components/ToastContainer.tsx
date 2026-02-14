import { useState, useEffect, useCallback, useRef } from 'react';
import type { DisruptionEvent } from '../types';

export interface Toast {
    id: string;
    type: 'critical' | 'warning' | 'info' | 'cascade';
    title: string;
    message: string;
    timestamp: number;
    flightNumber?: string;
    airport?: string;
}

interface Props {
    events: DisruptionEvent[];
}

let audioCtx: AudioContext | null = null;

function playAlertSound(type: 'critical' | 'cascade' | 'warning') {
    try {
        if (!audioCtx) audioCtx = new AudioContext();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        if (type === 'critical') {
            oscillator.frequency.value = 880;
            oscillator.type = 'square';
            gainNode.gain.value = 0.1;
        } else if (type === 'cascade') {
            oscillator.frequency.value = 660;
            oscillator.type = 'sawtooth';
            gainNode.gain.value = 0.08;
        } else {
            oscillator.frequency.value = 440;
            oscillator.type = 'sine';
            gainNode.gain.value = 0.06;
        }

        oscillator.start();
        gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.2);
        oscillator.stop(audioCtx.currentTime + 0.2);
    } catch {
        // Audio not supported
    }
}

const TYPE_ICONS: Record<string, string> = {
    critical: '🚨',
    cascade: '⚡',
    warning: '⚠️',
    info: '📋',
};

export default function ToastContainer({ events }: Props) {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const processedRef = useRef(new Set<number>());
    const airportDelayCountRef = useRef<Map<string, number>>(new Map());

    // Request notification permission
    useEffect(() => {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }, []);

    const addToast = useCallback((toast: Omit<Toast, 'id' | 'timestamp'>) => {
        const newToast: Toast = {
            ...toast,
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            timestamp: Date.now(),
        };
        setToasts(prev => [newToast, ...prev].slice(0, 5));

        // Auto-dismiss after 4s
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== newToast.id));
        }, 4000);
    }, []);

    const dismissToast = useCallback((id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    // Process incoming events
    useEffect(() => {
        if (events.length === 0) return;
        const latest = events[0];
        if (!latest || processedRef.current.has(latest.id)) return;
        processedRef.current.add(latest.id);

        // Track airport delay counts
        const airport = latest.origin_code || '';
        const currentCount = (airportDelayCountRef.current.get(airport) || 0) + 1;
        airportDelayCountRef.current.set(airport, currentCount);

        // Cascade alert
        if (latest.cascaded && latest.flights_impacted > 1) {
            addToast({
                type: 'cascade',
                title: 'CASCADE',
                message: `${latest.flight_number} → ${latest.flights_impacted} flights, ${latest.passengers_impacted} pax`,
                flightNumber: latest.flight_number,
                airport: latest.origin_code,
            });
            playAlertSound('cascade');
            return;
        }

        // Critical: major delay (>120 min)
        if (latest.delay_minutes >= 120) {
            addToast({
                type: 'critical',
                title: 'CRITICAL',
                message: `${latest.flight_number} +${latest.delay_minutes}m — ${latest.cause}`,
                flightNumber: latest.flight_number,
                airport: latest.origin_code,
            });
            playAlertSound('critical');
            return;
        }

        // Airport threshold: >3 flights delayed at one airport
        if (currentCount >= 3 && currentCount % 3 === 0) {
            addToast({
                type: 'critical',
                title: `AIRPORT: ${airport}`,
                message: `${currentCount} flights delayed — potential ground stop`,
                airport,
            });
            playAlertSound('critical');
            return;
        }

        // Warning: moderate delay
        if (latest.delay_minutes >= 60) {
            addToast({
                type: 'warning',
                title: 'DELAY',
                message: `${latest.flight_number} +${latest.delay_minutes}m — ${latest.cause}`,
                flightNumber: latest.flight_number,
            });
            playAlertSound('warning');
            return;
        }

        // Info: regular delay
        addToast({
            type: 'info',
            title: 'DELAY',
            message: `${latest.flight_number} +${latest.delay_minutes}m`,
            flightNumber: latest.flight_number,
        });
    }, [events, addToast]);

    if (toasts.length === 0) return null;

    return (
        <div className="toast-container">
            {toasts.map((toast, i) => (
                <div
                    key={toast.id}
                    className={`toast toast-${toast.type}`}
                    style={{ animationDelay: `${i * 30}ms` }}
                    onClick={() => dismissToast(toast.id)}
                >
                    <span className="toast-icon">{TYPE_ICONS[toast.type]}</span>
                    <span className="toast-title">{toast.title}</span>
                    <span className="toast-msg">{toast.message}</span>
                    <div className="toast-progress">
                        <div className={`toast-progress-bar toast-progress-${toast.type}`}></div>
                    </div>
                </div>
            ))}
        </div>
    );
}
