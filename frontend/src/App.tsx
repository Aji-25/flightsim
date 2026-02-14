import { useState } from 'react';
import { useAuth } from './contexts/AuthContext';
import { useFlightData } from './hooks/useFlightData';
import WorldMap from './components/WorldMap';
import MetricsBar from './components/MetricsBar';
import DisruptionSidebar from './components/DisruptionSidebar';
import ControlPanel from './components/ControlPanel';
import EventFeed from './components/EventFeed';
import AirportPopup from './components/AirportPopup';
import LoginPage from './components/LoginPage';
import PresenceAvatars from './components/PresenceAvatars';
import ReplayTimeline from './components/ReplayTimeline';
import ToastContainer from './components/ToastContainer';
import AnalyticsDashboard from './components/AnalyticsDashboard';
import './App.css';

function WarRoom() {
  const { user, token, logout, isAdmin } = useAuth();
  const [page, setPage] = useState<'warroom' | 'analytics'>('warroom');
  const [mode, setMode] = useState<'live' | 'sim'>('live');

  const {
    flights,
    airports,
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
    presenceUsers,
    sendFocus,
    isReplaying,
    handleReplaySnapshot,
    handleExitReplay,
  } = useFlightData({
    token,
    userId: user?.id || null,
    displayName: user?.display_name || 'Anonymous',
    role: user?.role || 'viewer',
  });

  const [selectedAirport, setSelectedAirport] = useState<string | null>(null);

  const handleAirportClick = (code: string) => {
    setSelectedAirport(code);
    sendFocus(code);
  };

  const handleCloseAirport = () => {
    setSelectedAirport(null);
    sendFocus(null);
  };

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-content">
          <div className="loading-spinner"></div>
          <h1>WAR ROOM</h1>
          <p>Initializing flight disruption engine...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="loading-screen error-screen">
        <div className="loading-content">
          <div className="error-icon">⚠️</div>
          <h1>Connection Error</h1>
          <p>{error}</p>
          <p className="error-hint">Make sure the backend is running on port 3001</p>
          <button className="btn-retry" onClick={() => window.location.reload()}>
            Retry Connection
          </button>
        </div>
      </div>
    );
  }

  // Analytics page
  if (page === 'analytics') {
    return <AnalyticsDashboard mode={mode} token={token} onBack={() => setPage('warroom')} />;
  }

  return (
    <div className="war-room">
      <header className="war-room-header">
        <div className="header-brand">
          <span className="header-icon">🎯</span>
          <h1>WAR ROOM</h1>
          <span className="header-subtitle">Flight Disruption Engine</span>
          {isReplaying && <span className="replay-badge">📼 REPLAY MODE</span>}
          <button
            className={`mode-toggle ${mode === 'live' ? 'mode-live' : 'mode-sim'}`}
            onClick={() => setMode(m => m === 'live' ? 'sim' : 'live')}
          >
            <span className={`mode-dot ${mode === 'live' ? 'dot-live' : 'dot-sim'}`} />
            {mode === 'live' ? '🔴 Live' : '🎮 Sim'}
          </button>
        </div>
        <div className="header-right">
          <PresenceAvatars users={presenceUsers} currentUserId={user?.id || null} />
          <MetricsBar mode={mode} metrics={metrics} costEstimate={costEstimate} connected={connected} />
          <button className="btn-analytics" onClick={() => setPage('analytics')}>📊 Analytics</button>
          <div className="user-menu">
            <span className={`role-badge role-${user?.role}`}>{user?.role?.toUpperCase()}</span>
            <span className="user-name">{user?.display_name}</span>
            <button className="btn-logout" onClick={logout}>↗</button>
          </div>
        </div>
      </header>

      <div className="war-room-body">
        <div className="map-area">
          <WorldMap
            mode={mode}
            flights={flights}
            airports={airports}
            missedConnections={missedConnections}
            onAirportClick={handleAirportClick}
          />
          <EventFeed mode={mode} events={eventFeed} />
          <ReplayTimeline
            onReplaySnapshot={handleReplaySnapshot}
            onExitReplay={handleExitReplay}
            isReplaying={isReplaying}
            token={token}
          />
        </div>
        <DisruptionSidebar
          mode={mode}
          flights={flights}
          missedConnections={missedConnections}
          rebookings={rebookings}
        />
      </div>

      {isAdmin && !isReplaying && mode === 'sim' && (
        <ControlPanel
          flights={flights}
          onTriggerDelay={triggerDelay}
          onTriggerScenario={triggerScenario}
          onReset={resetSimulation}
        />
      )}

      {selectedAirport && (
        <AirportPopup
          airportCode={selectedAirport}
          onClose={handleCloseAirport}
          fetchAirportDetail={fetchAirportDetail}
        />
      )}

      <ToastContainer events={eventFeed} />
    </div>
  );
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="loading-content">
          <div className="loading-spinner"></div>
          <h1>WAR ROOM</h1>
          <p>Restoring session...</p>
        </div>
      </div>
    );
  }

  if (!user) return <LoginPage />;
  return <WarRoom />;
}
