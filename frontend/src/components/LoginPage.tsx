import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
    const { login, signup, error, loading } = useAuth();
    const [mode, setMode] = useState<'login' | 'signup'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [displayName, setDisplayName] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [signupSuccess, setSignupSuccess] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);

        if (mode === 'login') {
            await login(email, password);
        } else {
            const ok = await signup(email, password, displayName);
            if (ok) {
                setSignupSuccess(true);
                setMode('login');
            }
        }
        setSubmitting(false);
    };

    if (loading) {
        return (
            <div className="login-screen">
                <div className="loading-spinner"></div>
            </div>
        );
    }

    return (
        <div className="login-screen">
            <div className="login-card">
                <div className="login-header">
                    <span className="login-icon">🎯</span>
                    <h1>WAR ROOM</h1>
                    <p className="login-subtitle">Flight Disruption Engine</p>
                </div>

                <div className="login-tabs">
                    <button
                        className={`login-tab ${mode === 'login' ? 'login-tab-active' : ''}`}
                        onClick={() => { setMode('login'); setSignupSuccess(false); }}
                    >
                        Sign In
                    </button>
                    <button
                        className={`login-tab ${mode === 'signup' ? 'login-tab-active' : ''}`}
                        onClick={() => { setMode('signup'); setSignupSuccess(false); }}
                    >
                        Create Account
                    </button>
                </div>

                {signupSuccess && (
                    <div className="login-success">
                        ✅ Account created! Check your email to confirm, then sign in.
                    </div>
                )}

                {error && <div className="login-error">⚠️ {error}</div>}

                <form onSubmit={handleSubmit} className="login-form">
                    {mode === 'signup' && (
                        <div className="form-group">
                            <label htmlFor="displayName">Display Name</label>
                            <input
                                id="displayName"
                                type="text"
                                value={displayName}
                                onChange={e => setDisplayName(e.target.value)}
                                placeholder="Ops Controller"
                                required={mode === 'signup'}
                            />
                        </div>
                    )}
                    <div className="form-group">
                        <label htmlFor="email">Email</label>
                        <input
                            id="email"
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            placeholder="controller@airline.com"
                            required
                        />
                    </div>
                    <div className="form-group">
                        <label htmlFor="password">Password</label>
                        <input
                            id="password"
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="••••••••"
                            required
                            minLength={6}
                        />
                    </div>
                    <button type="submit" className="login-submit" disabled={submitting}>
                        {submitting ? 'Authenticating...' : mode === 'login' ? 'Enter War Room' : 'Create Account'}
                    </button>
                </form>

                <div className="login-footer">
                    <p>🔒 Powered by Supabase Auth</p>
                    <p className="role-hint">
                        <span className="role-admin">Admins</span> can trigger delays · <span className="role-viewer">Viewers</span> observe only
                    </p>
                </div>
            </div>
        </div>
    );
}
