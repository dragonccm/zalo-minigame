import React, { useState, useEffect, useRef, useCallback } from 'react';
import { api, CAT, num } from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useRoute } from '../App';
import { GameHost } from '../sdk/GameHost';
import TaskOverlay from '../components/TaskOverlay';
import Icon from '../components/Icon';

export default function GamePage({ slug }) {
  const { user, openLogin, refreshUser } = useAuth();
  const { toastGood, toastBad } = useToast();
  const { navigate } = useRoute();

  const [game, setGame] = useState(null);
  const [loading, setLoading] = useState(true);
  const [iframeLoading, setIframeLoading] = useState(true);
  const [muted, setMuted] = useState(false);
  const [unlockedAchievements, setUnlockedAchievements] = useState(new Set());
  const [leaderboard, setLeaderboard] = useState([]);
  const [userRank, setUserRank] = useState(null);
  const [lbPeriod, setLbPeriod] = useState('all');
  const [otherGames, setOtherGames] = useState([]);
  const [taskOffer, setTaskOffer] = useState(null);
  const [taskResolver, setTaskResolver] = useState(null);
  const [pseudoFull, setPseudoFull] = useState(false);

  const iframeRef = useRef(null);
  const playerRef = useRef(null);
  const hostRef = useRef(null);

  // Fetch game metadata
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setIframeLoading(true);

    api(`/api/games/${encodeURIComponent(slug)}`)
      .then(res => {
        if (!mounted) return;
        setGame(res.game);
        document.title = `${res.game.name} — GameHub`;
        document.body.classList.add('gamepage');
        const unlocked = new Set(((res.game.me && res.game.me.unlocked) || []).map(x => x.key));
        setUnlockedAchievements(unlocked);
      })
      .catch(err => {
        if (mounted) toastBad(err.message);
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    // Fetch other games for suggestion
    api('/api/games')
      .then(res => {
        if (!mounted) return;
        const others = (res.games || []).filter(g => g.slug !== slug).slice(0, 6);
        setOtherGames(others);
      })
      .catch(() => {});

    return () => {
      mounted = false;
      document.body.classList.remove('gamepage');
      document.body.classList.remove('pfs-on');
      if (hostRef.current) {
        hostRef.current.destroy();
        hostRef.current = null;
      }
    };
  }, [slug, toastBad]);

  // Load Leaderboard
  const loadLb = useCallback(
    period => {
      setLbPeriod(period);
      api(`/api/games/${encodeURIComponent(slug)}/leaderboard?period=${period}&limit=10`)
        .then(res => {
          setLeaderboard(res.entries || []);
          setUserRank(res.me || null);
        })
        .catch(() => {});
    },
    [slug]
  );

  useEffect(() => {
    if (game?.scoring) {
      loadLb('all');
    }
  }, [game, loadLb]);

  // Handle Resize & Fit
  useEffect(() => {
    const fit = () => {
      const grid = document.querySelector('.gamegrid');
      const main = document.querySelector('.gamemain');
      if (!grid || !main) return;
      const mobile = window.matchMedia('(max-width: 900px)').matches;
      const top = grid.getBoundingClientRect().top + window.scrollY;
      const h = Math.max(380, window.innerHeight - top - (mobile ? 4 : 12)) + 'px';
      grid.style.height = mobile ? '' : h;
      main.style.height = mobile ? h : '';
    };

    fit();
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);
    return () => {
      window.removeEventListener('resize', fit);
      window.removeEventListener('orientationchange', fit);
    };
  }, [game]);

  // Initialize GameHost
  const startHost = useCallback(() => {
    if (!game || !iframeRef.current) return;
    if (hostRef.current) hostRef.current.destroy();

    const host = new GameHost(iframeRef.current, game, {
      getUser: () => user,
      onReady: () => setIframeLoading(false),
      onRefreshUser: refreshUser,
      onLoginHint: () => {
        toastGood('Đăng nhập để lưu điểm & thành tựu!');
        openLogin();
      },
      onScore: (res, score) => {
        toastGood(`Đã lưu <b>${num(score)}</b> điểm — hạng <b>#${res.rank}</b>${res.isNewBest ? ' · kỷ lục mới!' : ''}`);
        loadLb(lbPeriod);
      },
      onAchievement: ach => {
        setUnlockedAchievements(prev => new Set([...prev, ach.key]));
        toastGood(`Thành tựu: <b>${ach.name}</b><br><small>+${ach.points} XP</small>`);
      },
      onRequestReward: offer => {
        return new Promise(resolve => {
          setTaskOffer(offer);
          setTaskResolver(() => resolve);
        });
      },
    });

    hostRef.current = host;
    setTimeout(() => setIframeLoading(false), 8000);
  }, [game, user, lbPeriod, loadLb, refreshUser, openLogin, toastGood]);

  useEffect(() => {
    if (game && !loading) {
      startHost();
    }
  }, [game, loading, startHost]);

  // Controls
  const handleReload = () => {
    if (iframeRef.current && game) {
      setIframeLoading(true);
      iframeRef.current.src = game.entry;
      startHost();
    }
  };

  const handleToggleMute = () => {
    if (hostRef.current) {
      const nextMuted = !muted;
      hostRef.current.setMuted(nextMuted);
      setMuted(nextMuted);
    }
  };

  const handleFullscreen = () => {
    const stage = document.querySelector('.stage');
    if (!stage) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (stage.requestFullscreen) {
      stage.requestFullscreen().catch(() => {
        setPseudoFull(true);
        document.body.classList.add('pfs-on');
      });
    } else {
      // iOS / WebKit pseudo-fullscreen fallback
      setPseudoFull(true);
      document.body.classList.add('pfs-on');
    }
  };

  const handleExitPseudoFull = () => {
    setPseudoFull(false);
    document.body.classList.remove('pfs-on');
  };

  if (loading || !game) {
    return (
      <div className="center" style={{ padding: '60px' }}>
        <div className="spin" />
        <p className="muted">Đang tải game...</p>
      </div>
    );
  }

  const portrait = game.orientation === 'portrait';

  return (
    <div>
      {!user && (
        <div className="banner" style={{ marginBottom: '10px' }}>
          <Icon name="lock" /> Bạn đang chơi với tư cách khách —{' '}
          <a
            href="#"
            onClick={e => {
              e.preventDefault();
              openLogin();
            }}
          >
            đăng nhập
          </a>{' '}
          để lưu điểm, thành tựu và tiến trình.
        </div>
      )}

      <div className="gamegrid">
        <div className="gamemain">
          {/* Game Stage */}
          <div className={`stage ${pseudoFull ? 'pfs' : ''}`}>
            {pseudoFull && (
              <button
                className="pfs-exit"
                onClick={handleExitPseudoFull}
                title="Thoát toàn màn hình"
              >
                <Icon name="x" />
              </button>
            )}

            <div
              ref={playerRef}
              className={`player ${portrait ? 'portrait' : ''}`}
              id="player"
            >
              {iframeLoading && (
                <div className="loading" id="loading">
                  <div>
                    <div className="spin" />
                    Đang tải {game.name}...
                  </div>
                </div>
              )}

              <iframe
                ref={iframeRef}
                title={game.name}
                src={game.entry}
                sandbox="allow-scripts allow-pointer-lock"
                allow="fullscreen; autoplay; gamepad"
              />

              {/* Reward Task Overlay */}
              {taskOffer && hostRef.current && (
                <TaskOverlay
                  host={hostRef.current}
                  offer={taskOffer}
                  onFinish={res => {
                    setTaskOffer(null);
                    if (taskResolver) taskResolver(res);
                  }}
                />
              )}
            </div>
          </div>

          {/* Gamebar */}
          <div className="gamebar">
            <h1>{game.name}</h1>
            <span className="muted small gmeta">
              v{game.version} · {game.author} · <Icon name="play" size={12} /> {num(game.plays)}
            </span>
            <span className="spacer" />
            <button className="btn sm" onClick={handleReload} title="Tải lại game">
              <Icon name="rotate-ccw" />
            </button>
            <button className="btn sm" onClick={handleToggleMute} title="Tắt/bật tiếng">
              <Icon name={muted ? 'volume-x' : 'volume-2'} />
            </button>
            <button className="btn sm" onClick={handleFullscreen} title="Toàn màn hình">
              <Icon name="maximize" />
            </button>
          </div>
        </div>

        {/* Sidebar */}
        <aside className="gameside">
          {/* Leaderboard Panel */}
          {game.scoring && (
            <div className="panel">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Icon name="trophy" /> Bảng xếp hạng
              </h3>
              <div className="tabs">
                <button
                  className={`btn sm ${lbPeriod === 'day' ? 'primary' : ''}`}
                  onClick={() => loadLb('day')}
                >
                  Hôm nay
                </button>
                <button
                  className={`btn sm ${lbPeriod === 'week' ? 'primary' : ''}`}
                  onClick={() => loadLb('week')}
                >
                  Tuần
                </button>
                <button
                  className={`btn sm ${lbPeriod === 'all' ? 'primary' : ''}`}
                  onClick={() => loadLb('all')}
                >
                  Tất cả
                </button>
              </div>

              <ul className="lb">
                {leaderboard.length > 0 ? (
                  leaderboard.map(e => (
                    <li key={e.user.username} className={user?.username === e.user.username ? 'me' : ''}>
                      <span className="rk">{e.rank}</span>
                      <span className="nm">{e.user.displayName}</span>
                      <span className="sc">{num(e.score)}</span>
                    </li>
                  ))
                ) : (
                  <p className="muted small" style={{ margin: '8px 0' }}>
                    Chưa có điểm nào.
                  </p>
                )}
              </ul>

              {userRank && (
                <div className="muted small" style={{ marginTop: '8px' }}>
                  Điểm của bạn: <b>{num(userRank.score)}</b> (Hạng #{userRank.rank})
                </div>
              )}
            </div>
          )}

          {/* Achievements Panel */}
          {game.achievements?.length > 0 && (
            <div className="panel">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Icon name="award" /> Thành tựu{' '}
                <span className="muted small">
                  ({unlockedAchievements.size}/{game.achievements.length})
                </span>
              </h3>
              <div id="achList">
                {game.achievements.map(a => {
                  const isUnlocked = unlockedAchievements.has(a.key);
                  return (
                    <div
                      key={a.key}
                      className={`ach ${isUnlocked ? '' : 'locked'}`}
                      title={`${a.name} — ${a.description} (+${a.points} XP)`}
                    >
                      <div className="ic">
                        <Icon name={a.icon || 'trophy'} />
                      </div>
                      <div>
                        <div className="t">{a.name}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Next Games suggestion */}
          {otherGames.length > 0 && (
            <div className="panel">
              <h3 style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Icon name="gamepad-2" /> Chơi tiếp theo
              </h3>
              <div className="nextgrid">
                {otherGames.map(g => (
                  <a
                    key={g.slug}
                    className="ng"
                    href={`#/game/${encodeURIComponent(g.slug)}`}
                    onClick={e => {
                      if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                        e.preventDefault();
                        navigate('game', g.slug);
                      }
                    }}
                  >
                    <div className="thumb">
                      {g.thumbnail ? (
                        <img src={g.thumbnail} alt={g.name} loading="lazy" />
                      ) : (
                        <Icon name="gamepad-2" />
                      )}
                    </div>
                    <span>{g.name}</span>
                  </a>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>

      {/* Game Info Panel */}
      <div className="panel gameinfo" style={{ marginTop: '14px' }}>
        <div className="row" style={{ marginBottom: '8px' }}>
          <div>
            {game.categories?.map(c => (
              <span key={c} className="tag">
                {CAT[c] || c}
              </span>
            ))}
          </div>
          <span className="spacer" />
          <span className="muted small">{num(game.stats?.players || 0)} người có điểm</span>
        </div>
        <p style={{ margin: '0 0 8px' }}>{game.description}</p>
        <p className="muted small" style={{ margin: 0 }}>
          Điều khiển:{' '}
          {game.controls?.length
            ? game.controls
                .map(c =>
                  c === 'mouse'
                    ? 'Chuột'
                    : c === 'keyboard'
                    ? 'Bàn phím'
                    : c === 'touch'
                    ? 'Cảm ứng'
                    : 'Tay cầm'
                )
                .join(' · ')
            : 'Xem trong game'}
        </p>
      </div>
    </div>
  );
}
