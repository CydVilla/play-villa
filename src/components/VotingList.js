import React from 'react';
import './VotingList.css';

const VotingList = ({ games, onVote, userVote }) => {
  const sortedGames = [...games].sort((a, b) => b.votes - a.votes);

  if (games.length === 0) {
    return (
      <div className="voting-list-container">
        <h2 className="section-title">GAMES UP FOR VOTE</h2>
        <div className="empty-state">
          <p>No games submitted yet. Be the first to add a game!</p>
        </div>
      </div>
    );
  }

  return (
    <div className="voting-list-container">
      <h2 className="section-title">GAMES UP FOR VOTE</h2>
      <div className="games-grid">
        {sortedGames.map((game) => {
          const isUserVote = userVote && userVote.gameId === game.id;
          return (
            <div
              key={game.id}
              className={`game-card ${isUserVote ? 'user-vote' : ''}`}
            >
              {game.image ? (
                <div className="game-image-wrapper">
                  <img src={game.image} alt={game.name} className="game-image" />
                  <div className="image-overlay"></div>
                </div>
              ) : (
                <div className="game-image-wrapper no-image">
                  <div className="no-image-placeholder">
                    <span className="no-image-icon">🎮</span>
                    <span className="no-image-text">NO IMAGE</span>
                  </div>
                </div>
              )}
              <div className="game-card-content">
                <h3 className="game-name">{game.name}</h3>
                <div className="vote-section">
                  <div className="vote-count">
                    <span className="vote-number">{game.votes}</span>
                    <span className="vote-label">VOTE{game.votes !== 1 ? 'S' : ''}</span>
                  </div>
                  <button
                    className={`vote-btn ${isUserVote ? 'voted' : ''}`}
                    onClick={() => onVote(game.id)}
                  >
                    {isUserVote ? '✓ VOTED' : 'VOTE'}
                  </button>
                </div>
                {isUserVote && (
                  <div className="your-vote-badge">YOUR VOTE</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default VotingList;

