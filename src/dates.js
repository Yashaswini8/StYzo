// Small date helpers shared by the classifier, pricing, and booking modules.
// We deliberately avoid date libraries (moment/date-fns) to keep the demo light.

const MONTH_INDEX = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  january: 0, february: 1, march: 2, april: 3, june: 5, july: 6,
  august: 7, september: 8, october: 9, november: 10, december: 11,
};

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function atNoon(date) {
  // Normalise to local noon so day math is safe from DST edge cases.
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
}

function toIso(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date, days) {
  const copy = new Date(date.getTime());
  copy.setDate(copy.getDate() + days);
  return atNoon(copy);
}

function dayName(date) {
  return DAY_NAMES[date.getDay()];
}

// Pull a list of dates out of free-form message text.
// Supports: "2026-07-10", "July 10", "10 July", "10/07/2026".
function extractDates(text, reference = new Date()) {
  const year = reference.getFullYear();
  const found = [];
  const push = (date) => {
    const normalised = atNoon(date);
    if (found.every((f) => !f.getTime() || normalised.getTime() !== f.getTime())) {
      found.push(normalised);
    }
  };

  // ISO: 2026-07-10
  for (const m of text.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g)) {
    pickMonthDay(push, Number(m[2]), Number(m[3]), Number(m[1]));
  }

  // Month name followed by day: "July 10" / "Jul 10"
  for (const m of text.matchAll(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})\b/gi,
  )) {
    pickMonthDay(push, monthIndex(m[1]) + 1, Number(m[2]), year);
  }

  // Day followed by month name: "10 July" / "10 Jul"
  for (const m of text.matchAll(
    /\b(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/gi,
  )) {
    pickMonthDay(push, monthIndex(m[2]) + 1, Number(m[1]), year);
  }

  // Numeric: "10/07/2026" — month first if it is a valid month number,
  // otherwise day first.
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/g)) {
    let day = Number(m[1]);
    let month = Number(m[2]);
    if (month > 12) [day, month] = [month, day];
    pickMonthDay(push, month, day, m[3] ? Number(m[3]) : year);
  }

  function monthIndex(token) {
    return MONTH_INDEX[token.toLowerCase().slice(0, 3)];
  }

  function pickMonthDay(pushFn, month, day, yyyy) {
    if (!month || !day) return;
    pushFn(new Date(yyyy, month - 1, day, 12));
  }

  // Day ranges: "July 10-12", "10-12 July" (also accept an en-dash or "to").
  const rangeMonthFirst = text.match(
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})\s*[-\u2013to]+\s*(\d{1,2})\b/i,
  );
  if (rangeMonthFirst) {
    pickMonthDay(push, monthIndex(rangeMonthFirst[1]) + 1, Number(rangeMonthFirst[3]), year);
  }
  const rangeDayFirst = text.match(
    /\b(\d{1,2})\s*[-\u2013]+\s*(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i,
  );
  if (rangeDayFirst) {
    pickMonthDay(push, monthIndex(rangeDayFirst[3]) + 1, Number(rangeDayFirst[1]), year);
    pickMonthDay(push, monthIndex(rangeDayFirst[3]) + 1, Number(rangeDayFirst[2]), year);
  }

  return found.sort((a, b) => a.getTime() - b.getTime());
}

// Quick check used by the classifier to decide whether a message mentions a date.
function hasDate(text) {
  return (
    /\d{4}-\d{1,2}-\d{1,2}/.test(text) ||
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\b/i.test(text) ||
    /\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i.test(text) ||
    /\b\d{1,2}\/\d{1,2}(\/\d{4})?\b/.test(text)
  );
}

// "for 3 nights" -> 3
function parseNightCount(text) {
  const match = text.match(/\b(\d{1,3})\s+night[s]?\b/i);
  return match ? Number(match[1]) : 0;
}

module.exports = { extractDates, hasDate, parseNightCount, toIso, addDays, dayName, atNoon };