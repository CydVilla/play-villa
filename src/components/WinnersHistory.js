import React, { useState, useEffect } from 'react';
import './WinnersHistory.css';

const WinnersHistory = () => {
  const [winners, setWinners] = useState([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const loadWinners = () => {
      const saved = localStorage.getItem('playVillaWinnersHistory');
      if (saved) {
        setWinners(JSON.parse(saved));
      }
    };
    loadWinners();
  }, []);

  if (winners.length === 0) {
    return null;
  }

  return (
    <div className="winners-history-container">
      <button 
        className="toggle-history-btn"
        onClick={() => setIsOpen(!isOpen)}
      >
        {isOpen ? '−' : '+'} VIEW PAST WINNERS ({winners.length})
      </button>

      {isOpen && (
        <div className="winners-history">
          <h3 className="history-title">PAST WINNERS</h3>
          <div className="winners-grid">
            {winners.map((winner) => (
              <div key={winner.id} className="history-winner-card">
                {winner.image && (
                  <img 
                    src={winner.image} 
                    alt={winner.gameName} 
                    className="history-winner-image"
                  />
                )}
                <div className="history-winner-info">
                  <h4 className="history-game-name">{winner.gameName}</h4>
                  <p className="history-votes">{winner.votes} votes</p>
                  <p className="history-date">
                    {new Date(winner.dateWon).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric'
                    })}
                  </p>
                  {winner.amazonLink && (
                    <a
                      href={winner.amazonLink}
                      target="_blank"
                      rel="noopener noreferrer sponsored"
                      className="history-amazon-link"
                    >
                      🛒 Get on Amazon
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default WinnersHistory;

