// BOOKINGS: in-memory store of confirmed / blocked nights for the demo.
// Each night is stored as an ISO date key, so overlapping ranges are easy to
// detect. (Swap this for SQLite/a real DB when persistence is needed.)
const { extractDates, toIso, addDays } = require('./dates');

// dateIso -> { status: 'confirmed' | 'blocked', guest: number, createdAt }
const store = new Map();

function nightsForRange(checkIn, checkOut) {
  const dates = [];
  for (let d = checkIn; d.getTime() < checkOut.getTime(); d = addDays(d, 1)) {
    dates.push(toIso(d));
  }
  return dates;
}

function isAvailable(isoDate) {
  return !store.has(isoDate);
}

// Book a range. `status` is 'confirmed' or 'blocked'.
// Returns the nights that are taken if any part of the range conflicts.
function bookRange({ guest, body, status }) {
  const dates = extractDates(body);
  if (dates.length === 0) {
    throw new Error('No dates could be understood — include a date like "July 10".');
  }

  const checkIn = dates[0];
  const checkOut = dates[1] && dates[1].getTime() > checkIn.getTime()
    ? dates[1]
    : addDays(checkIn, 1);

  const nights = nightsForRange(checkIn, checkOut);
  const conflicts = nights.filter((iso) => store.has(iso));

  if (conflicts.length > 0) {
    return {
      ok: false,
      nights,
      conflicts,
      message: `The following night(s) are already taken: ${conflicts.join(', ')}. Pick different dates and try again.`,
    };
  }

  for (const iso of nights) {
    store.set(iso, { status, guest, createdAt: new Date().toISOString() });
  }

  return {
    ok: true,
    status,
    checkIn: toIso(checkIn),
    checkOut: toIso(checkOut),
    nights,
    message: `${status === 'confirmed' ? 'Confirmed' : 'Blocked'}: ${toIso(checkIn)} → ${toIso(checkOut)} (${nights.length} night${nights.length === 1 ? '' : 's'}).`,
  };
}

// Turn the stored result into the reply text. Phrasing rotates so the bot
// doesn't sound scripted across messages; the dates/status stay exact.
function pickVariant(options) {
  return options[Math.floor(Math.random() * options.length)];
}

function formatBookingResult(result) {
  if (!result.ok) {
    return `${pickVariant(['Sorry, those dates clash:', 'Heads up — conflict detected:', 'Can\'t take those dates:'])} ${result.message}`;
  }

  const suffix = result.nights.length === 1 ? 'night' : 'nights';
  const lead = result.status === 'confirmed'
    ? pickVariant(['Done — confirmed:', "You're booked:", 'Booked for the dates:'])
    : pickVariant(['Done — blocked:', 'Dates locked:', 'Blocked for the dates:']);

  return `${lead} ${result.checkIn} → ${result.checkOut} (${result.nights.length} ${suffix}).`;
}

module.exports = { bookRange, isAvailable, formatBookingResult };