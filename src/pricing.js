// PRICING: simple, fully rule-based estimator (no AI).
//   nightly rate = BASE_PRICE
//                + WEEKEND_SURCHARGE           for Friday/Saturday nights
//                + BASE_PRICE * bumpPercent    for nights matching a local event
// Returns a per-night breakdown plus a total, formatted for WhatsApp.
const { extractDates, hasDate, parseNightCount, toIso, addDays, dayName } = require('./dates');
const { EVENTS, KNOWN_CITIES } = require('./events');
const { pricing: pricingConfig } = require('./config');
const { detectCurrency, currencyFor, ALL_CITY_KEYS } = require('./currencies');

const MONTH_DAY_WORDS = new Set([
  'jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
  'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september',
  'october', 'november', 'december', 'monday', 'tuesday', 'wednesday', 'thursday',
  'friday', 'saturday', 'sunday',
]);

function isPlaceName(word) {
  const w = word.toLowerCase();
  return (
    w.length > 2 &&
    !MONTH_DAY_WORDS.has(w) &&
    !/^(the|new|lake|saint|san|my|our)\b/i.test(w) &&
    !/\d/.test(w)
  );
}

// Strip harmless leading noise words ("New York City" -> "York City") so a
// multi-word place passes the place-name check.
function cleanPlace(phrase) {
  let p = phrase.trim();
  while (/^(the|new|lake|saint|san|my|our)\s+/i.test(p)) {
    p = p.replace(/^(the|new|lake|saint|san|my|our)\s+/i, '').trim();
  }
  return p;
}

// Pull the city out of free-form pricing text for ANY destination, not just a
// hardcoded list. Finds the destination near the dates, e.g. "price in Porto
// on July 10-12" -> "Porto". Known cities (incl. all currency-listed cities)
// are preferred when present, in any casing.
function extractCity(text) {
  const lower = text.toLowerCase();
  const known = KNOWN_CITIES.find((c) => lower.includes(c));
  if (known) return titleCase(known);

  const dateRe = /\b(\d{4}-\d{1,2}-\d{1,2}|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*)\b/i;
  const dateMatch = dateRe.exec(text);
  const before = dateMatch ? text.slice(0, dateMatch.index) : text;
  const beforeLower = before.toLowerCase();

  // 1. Exact match against every known/currency city, longest first — safe for
  //    any casing and multi-word names ("new delhi", "New York City").
  const dictionary = [...KNOWN_CITIES, ...ALL_CITY_KEYS].sort((a, b) => b.length - a.length);
  for (const key of dictionary) {
    if (beforeLower.includes(key)) return titleCase(key);
  }

  // 2. "in X", "for X", "at X", "near X", "around X" — last one before the dates.
  let candidate = '';
  const prepRe = /(?:in|for|at|near|around|downtown)\s+([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]+){0,2})/g;
  for (const match of before.matchAll(prepRe)) {
    const place = cleanPlace(match[1]);
    if (isPlaceName(place)) candidate = place;
  }
  if (candidate) return titleCase(candidate);

  // 3. "Barcelona on 15 Nov" — capitalized word(s) ending right before the date.
  const tail = before.replace(/\s+on\s*$/i, '').replace(/\s+for\s*$/i, '').trim();
  const cap = /\b([A-Z][A-Za-z'.]+(?:\s+[A-Z][A-Za-z'.]+){0,2})\s*$/.exec(tail);
  if (cap) {
    const place = cleanPlace(cap[1]);
    if (isPlaceName(place)) return titleCase(place);
  }

  return '';
}

function titleCase(word) {
  return word
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');
}

// An event only bumps the rate if it is actually in the requested city AND on
// the requested night — otherwise the general base-rate logic applies.
function eventOn(date, city) {
  const iso = toIso(date);
  const place = (city || '').toLowerCase();
  if (!place) return null;
  return EVENTS.find((e) => e.date === iso && e.city.toLowerCase() === place) || null;
}

function isWeekendNight(date) {
  // Friday (5) and Saturday (6) are the nights we mark up.
  return date.getDay() === 5 || date.getDay() === 6;
}

// Compute a quote from the request body. Returns a data object; the webhook
// turns it into the final WhatsApp message. `city` may be passed in by the
// classifier, otherwise it is parsed from the message generically.
function estimateQuote({ body, city: cityHint }) {
  const dates = extractDates(body);
  if (!dates.length) {
    throw new Error('estimateQuote was called without any dates in the message');
  }

  const city = extractCity(cityHint ? cityHint : body);
  const checkIn = dates[0];
  const requestedNights = parseNightCount(body);
  let checkOut;
  let nights;

  if (dates[1] && dates[1].getTime() > checkIn.getTime()) {
    // Two explicit dates: check-in -> check-out.
    checkOut = dates[1];
    nights = Math.round((checkOut.getTime() - checkIn.getTime()) / 86400000);
  } else if (requestedNights > 0) {
    // "for 3 nights" with a single start date.
    nights = requestedNights;
    checkOut = addDays(checkIn, nights);
  } else {
    // Single date, no night count — assume one night.
    nights = 1;
    checkOut = addDays(checkIn, 1);
  }

  // Currency is chosen from the city: Indian cities get INR, US gets USD,
  // Europe gets EUR, etc. Unknown cities fall back to the configured default.
  const currency = currencyFor(city, pricingConfig.currency);
  const { symbol, basePrice, weekendSurcharge } = currency;
  const breakdown = [];
  let total = 0;

  for (let i = 0; i < nights; i += 1) {
    const night = addDays(checkIn, i);
    let rate = basePrice;
    const notes = [];

    if (isWeekendNight(night)) {
      rate += weekendSurcharge;
      notes.push(`+${symbol}${fmtNumber(weekendSurcharge)} weekend`);
    }

    const event = eventOn(night, city);
    if (event) {
      const bump = Math.round((basePrice * event.bumpPercent) / 100);
      rate += bump;
      notes.push(`+${symbol}${fmtNumber(bump)} ${event.name}`);
    }

    total += rate;
    breakdown.push({ date: toIso(night), day: dayName(night), rate, notes });
  }

  return {
    city: city || '',
    checkIn: toIso(checkIn),
    checkOut: toIso(checkOut),
    nights,
    currency: currency.code,
    symbol,
    basePrice,
    weekendSurcharge,
    breakdown,
    total,
  };
}

// 3500 -> "3,500" for human-friendly pricing rows.
function fmtNumber(value) {
  return Number(value).toLocaleString('en-US');
}

// Format the quote object into the reply text sent back to the host.
// The wrapper phrases rotate so identical requests don't produce byte-identical
// replies, while the numbers themselves stay exact.
function pickVariant(options) {
  return options[Math.floor(Math.random() * options.length)];
}

function formatQuote(quote) {
  const suffix = quote.nights === 1 ? 'night' : 'nights';
  const where = quote.city ? ` for ${quote.city}` : '';
  const lines = [
    pickVariant([
      `Here's an estimated quote${where}:`,
      `StyZo rate plan${where}:`,
      `Here's what I'd price that${where}:`,
      `Locking in a price estimate${where}:`,
    ]),
    `${quote.checkIn} → ${quote.checkOut} (${quote.nights} ${suffix})`,
    '',
  ];

  for (const night of quote.breakdown) {
    const note = night.notes.length ? ` — ${night.notes.join(', ')}` : '';
    lines.push(`• ${night.day} ${night.date}: ${quote.symbol}${fmtNumber(night.rate)}${note}`);
  }

  lines.push('');
  lines.push(pickVariant([
    `Total: ${quote.symbol}${fmtNumber(quote.total)}`,
    `Running total: ${quote.symbol}${fmtNumber(quote.total)}`,
    `Estimated total: ${quote.symbol}${fmtNumber(quote.total)}`,
  ]));
  lines.push('');
  lines.push(pickVariant([
    `Base rate is ${quote.symbol}${fmtNumber(quote.basePrice)}/night, +${quote.symbol}${fmtNumber(quote.weekendSurcharge)} on Fri/Sat nights, with extra bumps during local events.`,
    `Rates start at ${quote.symbol}${fmtNumber(quote.basePrice)}/night; Fri/Sat nights add ${quote.symbol}${fmtNumber(quote.weekendSurcharge)}, and local events can push prices higher.`,
  ]));
  return lines.join('\n');
}

module.exports = { estimateQuote, formatQuote, hasDate, extractCity };