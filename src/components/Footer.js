import React, { useState } from 'react';
import './Footer.css';

const Footer = () => {
  const currentYear = new Date().getFullYear();
  const [testStatus, setTestStatus] = useState('');
  const isDevelopment = process.env.NODE_ENV === 'development';

  const testDiscordWebhook = async () => {
    const webhookUrl = process.env.REACT_APP_DISCORD_WEBHOOK_URL;
    
    if (!webhookUrl) {
      setTestStatus('❌ No webhook URL found in .env');
      setTimeout(() => setTestStatus(''), 3000);
      return;
    }

    setTestStatus('⏳ Sending test message...');

    // Create test winner data
    const testWinner = {
      name: 'Super Mario Bros. Wonder',
      votes: 42,
      image: 'https://images.igdb.com/igdb/image/upload/t_cover_big/co7h7x.jpg'
    };

    const nextSaturday = new Date();
    nextSaturday.setDate(nextSaturday.getDate() + (6 - nextSaturday.getDay() + 7) % 7 || 7);
    nextSaturday.setHours(0, 0, 0, 0);

    const embed = {
      title: "🎮 PLAY VILLA - WINNER ANNOUNCED! 🎮",
      description: `**${testWinner.name}** has won the vote!`,
      color: 0x00ff00,
      fields: [
        {
          name: "📊 Votes",
          value: `${testWinner.votes} vote${testWinner.votes !== 1 ? 's' : ''}`,
          inline: true
        },
        {
          name: "📅 Play Date",
          value: nextSaturday.toLocaleDateString('en-US', { 
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

    if (testWinner.image) {
      embed.image = { url: testWinner.image };
    }

    try {
      const response = await fetch(webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          embeds: [embed]
        })
      });

      if (response.ok) {
        setTestStatus('✅ Test message sent successfully! Check your Discord channel.');
      } else {
        const errorText = await response.text();
        setTestStatus(`❌ Error: ${response.status} ${response.statusText}`);
        console.error('Discord webhook error:', errorText);
      }
    } catch (error) {
      if (error.message.includes('ERR_BLOCKED_BY_CLIENT') || error.message.includes('Failed to fetch')) {
        setTestStatus('⚠️ Blocked by browser extension. Disable ad blockers or try incognito mode.');
        console.error('Request blocked. This is usually caused by browser extensions like ad blockers.');
      } else {
        setTestStatus(`❌ Failed: ${error.message}`);
        console.error('Webhook error:', error);
      }
    }

    setTimeout(() => setTestStatus(''), 5000);
  };
  
  return (
    <footer className="app-footer">
      <div className="footer-content">
        <p className="footer-text">Made with ❤️ for the community</p>
        <div className="footer-links">
          <a
            href="https://paypal.me/villacv"
            target="_blank"
            rel="noopener noreferrer"
            className="donation-link"
          >
            💰 DONATE VIA PAYPAL
          </a>
          <a
            href="https://github.com/CydVilla/play-villa"
            target="_blank"
            rel="noopener noreferrer"
            className="github-link"
            aria-label="View on GitHub"
          >
            <svg className="github-icon" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
            </svg>
            <span>CONTRIBUTE ON GITHUB</span>
          </a>
          {isDevelopment && (
            <button
              onClick={testDiscordWebhook}
              className="test-webhook-btn"
            >
              🧪 TEST DISCORD WEBHOOK
            </button>
          )}
        </div>
        {testStatus && (
          <p className="test-status">{testStatus}</p>
        )}
        <p className="copyright-text">© {currentYear} All Rights Reserved</p>
      </div>
    </footer>
  );
};

export default Footer;

