import React from 'react';
import './Footer.css';

const Footer = () => {
  const currentYear = new Date().getFullYear();
  
  return (
    <footer className="app-footer">
      <div className="footer-content">
        <p className="footer-text">Made with ❤️ for the community</p>
        <a
          href="https://paypal.me/villacv"
          target="_blank"
          rel="noopener noreferrer"
          className="donation-link"
        >
          💰 DONATE VIA PAYPAL
        </a>
        <p className="copyright-text">© {currentYear} All Rights Reserved</p>
      </div>
    </footer>
  );
};

export default Footer;

