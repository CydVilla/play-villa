import React, { useState, useEffect } from 'react';
import './App.css';
import GameSearch from './components/GameSearch';
import VotingList from './components/VotingList';
import CountdownTimer from './components/CountdownTimer';
import WinnerShowcase from './components/WinnerShowcase';
import WinnersHistory from './components/WinnersHistory';
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

// Generate Amazon affiliate link for a game
const generateAmazonLink = (gameName) => {
  const storeId = process.env.REACT_APP_AMAZON_STORE_ID;
  if (!storeId) return null;
  
  // Clean game name for search
  const searchQuery = encodeURIComponent(gameName + ' video game');
  return `https://www.amazon.com/s?k=${searchQuery}&tag=${storeId}`;
};

// Save winner to history
const saveWinnerToHistory = (winner, votingEndTime) => {
  const winnersHistory = JSON.parse(localStorage.getItem('playVillaWinnersHistory') || '[]');
  const amazonLink = generateAmazonLink(winner.name);
  
  const winnerEntry = {
    id: Date.now(),
    gameName: winner.name,
    votes: winner.votes,
    image: winner.image,
    dateWon: new Date().toISOString(),
    playDate: new Date(votingEndTime).toISOString(),
    amazonLink: amazonLink
  };
  
  winnersHistory.unshift(winnerEntry); // Add to beginning
  // Keep only last 50 winners
  const limitedHistory = winnersHistory.slice(0, 50);
  localStorage.setItem('playVillaWinnersHistory', JSON.stringify(limitedHistory));
  
  return winnerEntry;
};

// Function to send winner announcement to Discord
const sendDiscordWebhook = async (winner, votingEndTime) => {
  const webhookUrl = process.env.REACT_APP_DISCORD_WEBHOOK_URL;
  
  if (!webhookUrl || !winner) return;

  // votingEndTime is already Saturday at midnight (the play date)
  const playDate = new Date(votingEndTime);
  
  const amazonLink = generateAmazonLink(winner.name);

  const embed = {
    title: "🎮 PLAY VILLA - WINNER ANNOUNCED! 🎮",
    description: `**${winner.name}** has won the vote!`,
    color: 0x00ff00, // Green color
    fields: [
      {
        name: "📊 Votes",
        value: `${winner.votes} vote${winner.votes !== 1 ? 's' : ''}`,
        inline: true
      },
      {
        name: "📅 Play Date",
        value: playDate.toLocaleDateString('en-US', { 
          weekday: 'long', 
          month: 'long', 
          day: 'numeric' 
        }),
        inline: true
      }
    ],
    footer: {
      text: "Join us on Saturday! • https://discord.gg/Nh7RYw2zJD"
    },
    timestamp: new Date().toISOString()
  };

  // Add Amazon link field if available
  if (amazonLink) {
    embed.fields.push({
      name: "🛒 Get on Amazon",
      value: `[Buy ${winner.name}](${amazonLink})`,
      inline: false
    });
  }

  // Add image if available
  if (winner.image) {
    embed.image = { url: winner.image };
  }

  try {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        embeds: [embed]
      })
    });
  } catch (error) {
    console.error('Failed to send Discord webhook:', error);
  }
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
  const [votingEndTime, setVotingEndTime] = useState(() => {
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

  // Check if voting has ended and reset on Sunday
  useEffect(() => {
    const checkVotingStatus = () => {
      const now = new Date();
      const currentDay = now.getDay(); // 0 = Sunday, 6 = Saturday
      const currentHour = now.getHours();
      
      // Reset voting on Sunday at midnight (start of new week)
      // Check if it's Sunday and we're at midnight (0:00-0:59)
      if (currentDay === 0 && currentHour === 0 && isVotingEnded) {
        setIsVotingEnded(false);
        setWinner(null);
        setGames([]); // Clear games for fresh start
        // Set new voting end time to next Saturday
        const nextSaturday = getNextSaturday();
        setVotingEndTime(nextSaturday);
        localStorage.setItem('playVillaVotingEndTime', nextSaturday.toISOString());
        return;
      }
      
      // Check if voting has ended (Saturday midnight)
      if (now >= votingEndTime && !isVotingEnded) {
        setIsVotingEnded(true);
        // Determine winner
        if (games.length > 0) {
          const sortedGames = [...games].sort((a, b) => b.votes - a.votes);
          const winnerGame = sortedGames[0];
          setWinner(winnerGame);
          
          // Save winner to history
          saveWinnerToHistory(winnerGame, votingEndTime);
          
          // Send Discord webhook notification
          sendDiscordWebhook(winnerGame, votingEndTime);
        }
      }
    };

    checkVotingStatus();
    const interval = setInterval(checkVotingStatus, 1000);
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

  // Dev mode: Manually end voting and determine winner
  const handleManualEndVoting = () => {
    if (games.length === 0) {
      alert('No games to vote on!');
      return;
    }

    setIsVotingEnded(true);
    const sortedGames = [...games].sort((a, b) => b.votes - a.votes);
    const winnerGame = sortedGames[0];
    setWinner(winnerGame);
    
    // Save winner to history
    saveWinnerToHistory(winnerGame, votingEndTime);
    
    // Send Discord webhook notification
    sendDiscordWebhook(winnerGame, votingEndTime);
  };

  const isDevelopment = process.env.NODE_ENV === 'development';

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
            {isDevelopment && (
              <div className="dev-tools">
                <button 
                  className="dev-end-voting-btn"
                  onClick={handleManualEndVoting}
                  disabled={games.length === 0}
                >
                  🔧 DEV: END VOTING NOW
                </button>
              </div>
            )}
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
          <>
            <WinnerShowcase winner={winner} votingEndTime={votingEndTime} />
            <WinnersHistory />
          </>
        )}

        <Footer />
      </div>
    </div>
  );
}

export default App;

