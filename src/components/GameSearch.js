import React, { useState, useEffect } from 'react';
import './GameSearch.css';

// Note: You'll need to get a free API key from https://rawg.io/apidocs
// For now, using a placeholder. Replace with your API key in production.
const RAWG_API_KEY = process.env.REACT_APP_RAWG_API_KEY || 'YOUR_API_KEY_HERE';
const RAWG_API_URL = 'https://api.rawg.io/api/games';

const GameSearch = ({ onGameSubmit, existingGames }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [showImagePrompt, setShowImagePrompt] = useState(false);
  const [pendingGameName, setPendingGameName] = useState('');
  const [pendingGameImage, setPendingGameImage] = useState('');

  useEffect(() => {
    if (searchQuery.trim().length < 2) {
      setSearchResults([]);
      setShowResults(false);
      return;
    }

    // Show results immediately to display custom game option
    setShowResults(true);

    const searchGames = async () => {
      setIsSearching(true);
      try {
        // If no API key, use mock data for demo
        if (RAWG_API_KEY === 'YOUR_API_KEY_HERE') {
          // Mock results for demonstration
          setSearchResults([
            { id: 1, name: searchQuery, background_image: null, released: null },
            { id: 2, name: `${searchQuery} 2`, background_image: null, released: null }
          ]);
          setIsSearching(false);
          return;
        }

        const response = await fetch(
          `${RAWG_API_URL}?search=${encodeURIComponent(searchQuery)}&key=${RAWG_API_KEY}&page_size=10`
        );
        const data = await response.json();
        setSearchResults(data.results || []);
      } catch (error) {
        console.error('Error searching games:', error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    };

    const debounceTimer = setTimeout(searchGames, 300);
    return () => clearTimeout(debounceTimer);
  }, [searchQuery]);

  const handleGameSelect = (game) => {
    const gameData = {
      id: game.id,
      name: game.name,
      image: game.background_image,
      released: game.released
    };

    const exists = existingGames.find(g => g.id === game.id);
    if (!exists) {
      onGameSubmit(gameData);
      setSearchQuery('');
      setShowResults(false);
    } else {
      alert('This game has already been submitted!');
    }
  };

  const handleAddCustomGame = (gameName) => {
    // Check if game name already exists
    const nameExists = existingGames.find(
      g => g.name.toLowerCase().trim() === gameName.toLowerCase().trim()
    );
    
    if (nameExists) {
      alert('This game has already been submitted!');
      return;
    }

    setPendingGameName(gameName);
    setPendingGameImage('');
    setShowImagePrompt(true);
  };

  const handleSubmitCustomGame = () => {
    if (!pendingGameName.trim()) {
      return;
    }

    // Generate a unique ID for custom games (using timestamp + random)
    const customGameId = 'custom_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);

    const customGameData = {
      id: customGameId,
      name: pendingGameName.trim(),
      image: pendingGameImage.trim() || null,
      released: null,
      isCustom: true
    };

    onGameSubmit(customGameData);
    setPendingGameName('');
    setPendingGameImage('');
    setShowImagePrompt(false);
    setSearchQuery('');
    setShowResults(false);
  };

  const handleCancelCustomGame = () => {
    setPendingGameName('');
    setPendingGameImage('');
    setShowImagePrompt(false);
  };

  return (
    <div className="game-search-container">
      <div className="search-box-wrapper">
        <input
          type="text"
          className="vhs-input"
          placeholder="TYPE GAME NAME..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            if (e.target.value.trim().length >= 2) {
              setShowResults(true);
            }
          }}
          onFocus={() => {
            if (searchQuery.trim().length >= 2 || searchResults.length > 0) {
              setShowResults(true);
            }
          }}
          onBlur={() => {
            // Delay hiding results to allow clicks
            setTimeout(() => setShowResults(false), 200);
          }}
        />
        {isSearching && <div className="search-loading">SEARCHING...</div>}
      </div>

      {showResults && (
        <div className="search-results">
          {searchResults.length > 0 && searchResults.map((game) => {
            const alreadySubmitted = existingGames.find(g => g.id === game.id);
            return (
              <div
                key={game.id}
                className={`search-result-item ${alreadySubmitted ? 'submitted' : ''}`}
                onClick={() => !alreadySubmitted && handleGameSelect(game)}
              >
                {game.background_image && (
                  <img src={game.background_image} alt={game.name} className="game-thumb" />
                )}
                <div className="game-info">
                  <h3>{game.name}</h3>
                  {game.released && <p className="release-date">Released: {game.released}</p>}
                  {alreadySubmitted && <span className="submitted-badge">ALREADY SUBMITTED</span>}
                </div>
              </div>
            );
          })}
          
          {/* Always show "Add as custom game" option when there's a search query */}
          {searchQuery.trim().length >= 2 && (
            <div
              className="search-result-item custom-game-option"
              onClick={() => handleAddCustomGame(searchQuery)}
            >
              <div className="custom-game-icon">+</div>
              <div className="game-info">
                <h3>Add "{searchQuery}" as custom game</h3>
                <p className="custom-game-hint">Click to add this game manually</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Image prompt modal */}
      {showImagePrompt && (
        <div className="image-prompt-overlay" onClick={handleCancelCustomGame}>
          <div className="image-prompt-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="prompt-title">ADD CUSTOM GAME</h3>
            <p className="prompt-game-name">{pendingGameName}</p>
            <div className="prompt-form-group">
              <label htmlFor="prompt-image">IMAGE URL (OPTIONAL)</label>
              <input
                id="prompt-image"
                type="url"
                className="vhs-input"
                placeholder="https://example.com/game-image.jpg"
                value={pendingGameImage}
                onChange={(e) => setPendingGameImage(e.target.value)}
                autoFocus
              />
              {pendingGameImage && (
                <div className="image-preview">
                  <img src={pendingGameImage} alt="Preview" onError={(e) => {
                    e.target.style.display = 'none';
                    e.target.nextSibling.style.display = 'block';
                  }} />
                  <p style={{display: 'none', color: '#ff0000'}}>Invalid image URL</p>
                </div>
              )}
            </div>
            <div className="prompt-actions">
              <button 
                className="submit-custom-btn"
                onClick={handleSubmitCustomGame}
              >
                SUBMIT
              </button>
              <button 
                className="cancel-custom-btn"
                onClick={handleCancelCustomGame}
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}

      {RAWG_API_KEY === 'YOUR_API_KEY_HERE' && (
        <div className="api-warning">
          <p>⚠️ Get your free API key from <a href="https://rawg.io/apidocs" target="_blank" rel="noopener noreferrer">RAWG.io</a></p>
          <p>Set it as REACT_APP_RAWG_API_KEY in your .env file</p>
        </div>
      )}
    </div>
  );
};

export default GameSearch;

