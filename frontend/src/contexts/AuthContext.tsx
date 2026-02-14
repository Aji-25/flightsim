import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react';
import type { User } from '../types';

const API_URL = 'http://localhost:3001';
const TOKEN_KEY = 'warroom_token';

interface AuthContextType {
    user: User | null;
    token: string | null;
    loading: boolean;
    error: string | null;
    login: (email: string, password: string) => Promise<boolean>;
    signup: (email: string, password: string, displayName: string) => Promise<boolean>;
    logout: () => void;
    isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null);
    const [token, setToken] = useState<string | null>(localStorage.getItem(TOKEN_KEY));
    const [loading, setLoading] = useState(!!localStorage.getItem(TOKEN_KEY));
    const [error, setError] = useState<string | null>(null);

    // Restore session on mount
    useEffect(() => {
        const stored = localStorage.getItem(TOKEN_KEY);
        if (stored) {
            fetch(`${API_URL}/api/auth/me`, {
                headers: { Authorization: `Bearer ${stored}` },
            })
                .then(res => {
                    if (!res.ok) throw new Error('Session expired');
                    return res.json();
                })
                .then(data => {
                    setUser(data.user);
                    setToken(stored);
                })
                .catch(() => {
                    localStorage.removeItem(TOKEN_KEY);
                    setToken(null);
                    setUser(null);
                })
                .finally(() => setLoading(false));
        } else {
            setLoading(false);
        }
    }, []);

    const login = useCallback(async (email: string, password: string): Promise<boolean> => {
        setError(null);
        try {
            const res = await fetch(`${API_URL}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Login failed');

            const accessToken = data.session.access_token;
            localStorage.setItem(TOKEN_KEY, accessToken);
            setToken(accessToken);
            setUser(data.user);
            return true;
        } catch (err: any) {
            setError(err.message);
            return false;
        }
    }, []);

    const signup = useCallback(async (email: string, password: string, displayName: string): Promise<boolean> => {
        setError(null);
        try {
            const res = await fetch(`${API_URL}/api/auth/signup`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password, displayName }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Signup failed');
            return true;
        } catch (err: any) {
            setError(err.message);
            return false;
        }
    }, []);

    const logout = useCallback(() => {
        localStorage.removeItem(TOKEN_KEY);
        setToken(null);
        setUser(null);
        fetch(`${API_URL}/api/auth/logout`, { method: 'POST' }).catch(() => { });
    }, []);

    return (
        <AuthContext.Provider value={{
            user,
            token,
            loading,
            error,
            login,
            signup,
            logout,
            isAdmin: user?.role === 'admin',
        }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
    return ctx;
}
