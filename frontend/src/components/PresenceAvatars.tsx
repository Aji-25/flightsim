import type { PresenceUser } from '../types';

interface Props {
    users: PresenceUser[];
    currentUserId: string | null;
}

function getInitials(name: string): string {
    return name
        .split(' ')
        .map(w => w[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
}

export default function PresenceAvatars({ users, currentUserId }: Props) {
    if (users.length === 0) return null;

    const others = users.filter(u => u.userId !== currentUserId);
    const maxShow = 5;
    const visible = others.slice(0, maxShow);
    const overflow = others.length - maxShow;

    return (
        <div className="presence-bar">
            <div className="presence-avatars">
                {visible.map(user => (
                    <div
                        key={user.id || user.userId}
                        className="presence-avatar"
                        style={{ borderColor: user.color }}
                        title={`${user.displayName} (${user.role})${user.focusedAirport ? ` — viewing ${user.focusedAirport}` : ''}`}
                    >
                        {user.avatarUrl
                            ? <img src={user.avatarUrl} alt={user.displayName} />
                            : <span style={{ color: user.color }}>{getInitials(user.displayName)}</span>
                        }
                        <span className="presence-dot" style={{ background: user.color }}></span>
                        {user.focusedAirport && (
                            <span className="presence-focus" style={{ background: user.color }}>
                                {user.focusedAirport}
                            </span>
                        )}
                    </div>
                ))}
                {overflow > 0 && (
                    <div className="presence-overflow">
                        +{overflow}
                    </div>
                )}
            </div>
            <span className="presence-count">{users.length} online</span>
        </div>
    );
}
