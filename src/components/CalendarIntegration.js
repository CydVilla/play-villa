import React from 'react';
import './CalendarIntegration.css';

const CalendarIntegration = ({ gameName, gameDate }) => {
  // Format date for iCal
  const formatDateForICal = (date) => {
    return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  };

  // Create iCal file content
  const generateICal = () => {
    const startDate = new Date(gameDate);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setHours(23, 59, 59, 0);

    const start = formatDateForICal(startDate);
    const end = formatDateForICal(endDate);
    const now = formatDateForICal(new Date());

    return `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Play Villa//Game Vote//EN
BEGIN:VEVENT
UID:${Date.now()}@playvilla.com
DTSTAMP:${now}
DTSTART:${start}
DTEND:${end}
SUMMARY:Play Villa - ${gameName}
DESCRIPTION:Community game session - ${gameName}
LOCATION:Discord - https://discord.gg/Nh7RYw2zJD
END:VEVENT
END:VCALENDAR`;
  };

  // Download iCal file
  const downloadICal = () => {
    const icalContent = generateICal();
    const blob = new Blob([icalContent], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `play-villa-${gameName.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Google Calendar URL
  const getGoogleCalendarUrl = () => {
    const startDate = new Date(gameDate);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(startDate);
    endDate.setHours(23, 59, 59, 0);

    const formatGoogleDate = (date) => {
      return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    };

    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: `Play Villa - ${gameName}`,
      dates: `${formatGoogleDate(startDate)}/${formatGoogleDate(endDate)}`,
      details: `Community game session - ${gameName}`,
      location: 'Discord - https://discord.gg/Nh7RYw2zJD'
    });

    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  };

  return (
    <div className="calendar-integration">
      <h3 className="calendar-title">ADD TO CALENDAR</h3>
      <div className="calendar-buttons">
        <button onClick={downloadICal} className="calendar-btn ical-btn">
          📅 DOWNLOAD .ICS
        </button>
        <a
          href={getGoogleCalendarUrl()}
          target="_blank"
          rel="noopener noreferrer"
          className="calendar-btn google-btn"
        >
          📆 GOOGLE CALENDAR
        </a>
      </div>
      <p className="calendar-note">
        Don't forget to join us on Saturday!
      </p>
    </div>
  );
};

export default CalendarIntegration;

