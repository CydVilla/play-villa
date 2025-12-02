# Play Villa - Game Voting App

A retro-styled single-page React application for community game voting. Vote for what game to play on Saturday!

## Features

- 🎮 **Game Search**: Search and submit games using the RAWG Video Games Database API
- 🗳️ **Voting System**: Vote for your favorite game (one vote per user, can retract)
- ⏰ **Countdown Timer**: Real-time countdown to voting deadline
- 🏆 **Winner Showcase**: Beautiful display of the winning game
- 💬 **Discord Integration**: Direct link to join the community Discord
- 📅 **Calendar Integration**: Add the game event to your calendar (iCal/Google Calendar)
- 💰 **Donations**: PayPal donation link in footer

## Setup

1. Install dependencies:
```bash
npm install
```

2. Get a free API key from [RAWG.io](https://rawg.io/apidocs)

3. Create a `.env` file in the root directory:
```
REACT_APP_RAWG_API_KEY=your_api_key_here
```

4. Start the development server:
```bash
npm start
```

## How It Works

- Users can search for games and submit them for voting
- Each user can vote for one game at a time
- Users can retract their vote and vote for a different game
- Voting ends at midnight on Saturday
- The game with the most votes wins
- The winning game is showcased with Discord invite and calendar integration

## Technologies

- React 18
- RAWG Video Games Database API
- LocalStorage for vote persistence (no backend required)
- CSS3 with VHS-themed animations and effects

## Styling

The app features an authentic 80's VHS aesthetic with:
- Neon green and magenta colors
- Scanline effects
- Glitch animations
- Pixel fonts (Press Start 2P, VT323)
- Retro CRT monitor effects

## License

MIT

