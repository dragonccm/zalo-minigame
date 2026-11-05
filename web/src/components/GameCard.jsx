import React from 'react';
import { CAT, num } from '../api';
import Icon from './Icon';
import { useRoute } from '../App';

export default function GameCard({ game }) {
  const { navigate } = useRoute();
  const href = `#/game/${encodeURIComponent(game.slug)}`;

  const handleClick = e => {
    // Only intercept primary left click without modifier keys
    if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      navigate('game', game.slug);
    }
  };

  return (
    <a className="gcard" href={href} onClick={handleClick}>
      <div className="thumb">
        {game.thumbnail ? (
          <img src={game.thumbnail} alt={game.name} loading="lazy" />
        ) : (
          <Icon name="gamepad-2" size={48} />
        )}
        <span className="playbtn">
          <Icon name="play" /> Chơi
        </span>
      </div>
      <div className="body">
        <h3>{game.name}</h3>
        <p className="desc">{game.description}</p>
        <div className="meta">
          <span>
            {game.categories.slice(0, 2).map(c => (
              <span key={c} className="tag">
                {CAT[c] || c}
              </span>
            ))}
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Icon name="play" /> {num(game.plays)}
          </span>
        </div>
      </div>
    </a>
  );
}
