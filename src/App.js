import React, { useState, useEffect } from 'react';
import './App.css';
import GameSearch from './components/GameSearch';
import VotingList from './components/VotingList';
import CountdownTimer from './components/CountdownTimer';
import WinnerShowcase from './components/WinnerShowcase';
import Footer from './components/Footer';

// Get or create unique user ID
const getUserId = () => {
  let userId = localStorage.getItem('playVillaUserId');
  if (!userId) {
    userId = 'user_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);
    localStorage.setItem('playVillaUserId', userId);
  }
  return userId;
};

// Get next Saturday at midnight
const getNextSaturday = () => {
  const now = new Date();
  const day = now.getDay();
  const daysUntilSaturday = (6 - day + 7) % 7 || 7; // Next Saturday, or 7 days if today is Saturday
  const nextSaturday = new Date(now);
  nextSaturday.setDate(now.getDate() + daysUntilSaturday);
  nextSaturday.setHours(0, 0, 0, 0);
  return nextSaturday;
};

function App() {
  const [games, setGames] = useState(() => {
    const saved = localStorage.getItem('playVillaGames');
    return saved ? JSON.parse(saved) : [];
  });
  const [userVote, setUserVote] = useState(() => {
    const userId = getUserId();
    const saved = localStorage.getItem(`playVillaVote_${userId}`);
    return saved ? JSON.parse(saved) : null;
  });
  const [votingEndTime] = useState(() => {
    const saved = localStorage.getItem('playVillaVotingEndTime');
    if (saved) {
      return new Date(saved);
    }
    const nextSaturday = getNextSaturday();
    localStorage.setItem('playVillaVotingEndTime', nextSaturday.toISOString());
    return nextSaturday;
  });
  const [isVotingEnded, setIsVotingEnded] = useState(false);
  const [winner, setWinner] = useState(null);

  // Check if voting has ended
  useEffect(() => {
    const checkVotingEnd = () => {
      const now = new Date();
      if (now >= votingEndTime && !isVotingEnded) {
        setIsVotingEnded(true);
        // Determine winner
        if (games.length > 0) {
          const sortedGames = [...games].sort((a, b) => b.votes - a.votes);
          setWinner(sortedGames[0]);
        }
      }
    };

    checkVotingEnd();
    const interval = setInterval(checkVotingEnd, 1000);
    return () => clearInterval(interval);
  }, [votingEndTime, isVotingEnded, games]);

  // Save games to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('playVillaGames', JSON.stringify(games));
  }, [games]);

  const handleGameSubmit = (game) => {
    const exists = games.find(g => g.id === game.id);
    if (!exists) {
      setGames([...games, { ...game, votes: 0 }]);
    }
  };

  const handleVote = (gameId) => {
    if (isVotingEnded) return;

    const userId = getUserId();
    const updatedGames = games.map(game => {
      if (game.id === gameId) {
        // If user already voted for this game, remove vote
        if (userVote && userVote.gameId === gameId) {
          return { ...game, votes: Math.max(0, game.votes - 1) };
        }
        // If user voted for another game, remove that vote first
        if (userVote && userVote.gameId !== gameId) {
          const previousGame = games.find(g => g.id === userVote.gameId);
          if (previousGame) {
            previousGame.votes = Math.max(0, previousGame.votes - 1);
          }
        }
        // Add new vote
        return { ...game, votes: game.votes + 1 };
      }
      // Remove vote from previously voted game
      if (userVote && userVote.gameId === game.id && gameId !== game.id) {
        return { ...game, votes: Math.max(0, game.votes - 1) };
      }
      return game;
    });

    setGames(updatedGames);

    // Update user vote
    if (userVote && userVote.gameId === gameId) {
      setUserVote(null);
      localStorage.removeItem(`playVillaVote_${userId}`);
    } else {
      const newVote = { gameId, timestamp: Date.now() };
      setUserVote(newVote);
      localStorage.setItem(`playVillaVote_${userId}`, JSON.stringify(newVote));
    }
  };

  const handleRetractVote = () => {
    if (!userVote) return;

    const userId = getUserId();
    const updatedGames = games.map(game => {
      if (game.id === userVote.gameId) {
        return { ...game, votes: Math.max(0, game.votes - 1) };
      }
      return game;
    });

    setGames(updatedGames);
    setUserVote(null);
    localStorage.removeItem(`playVillaVote_${userId}`);
  };

  return (
    <div className="App">
      <div className="vhs-container">
        <div className="vhs-header">
          <h1 className="vhs-title glitch" data-text="PLAY VILLA">
            PLAY VILLA
          </h1>
          <p className="vhs-subtitle">SATURDAY GAME VOTE</p>
        </div>

        {!isVotingEnded ? (
          <>
            <CountdownTimer endTime={votingEndTime} />
            <GameSearch onGameSubmit={handleGameSubmit} existingGames={games} />
            {userVote && (
              <div className="user-vote-info">
                <p>You voted for: <span className="highlight">{games.find(g => g.id === userVote.gameId)?.name}</span></p>
                <button className="retract-btn" onClick={handleRetractVote}>Retract Vote</button>
              </div>
            )}
            <VotingList 
              games={games} 
              onVote={handleVote} 
              userVote={userVote}
            />
          </>
        ) : (
          <WinnerShowcase winner={winner} votingEndTime={votingEndTime} />
        )}

        <Footer />
      </div>
    </div>
  );
}

export default App;

