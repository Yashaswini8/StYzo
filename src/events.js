// Hardcoded sample local events used by the rule-based pricing logic.
// When a requested night falls on an event date, the nightly rate gets a
// percentage bump on top of the base rate. City names in PRICING requests
// are matched against this list, so any event here also makes that city "known".

const EVENTS = [
  { name: 'Barcelona Marathon', city: 'Barcelona', date: '2026-11-15', bumpPercent: 35 },
  { name: 'Barcelona Winter Festival', city: 'Barcelona', date: '2027-01-20', bumpPercent: 20 },
  { name: 'Christmas Market Opening', city: 'Barcelona', date: '2026-12-20', bumpPercent: 25 },
  { name: 'F1 Grand Prix', city: 'Barcelona', date: '2027-06-05', bumpPercent: 50 },
  { name: 'La Mercè Festival', city: 'Barcelona', date: '2027-09-24', bumpPercent: 30 },
  { name: 'Paris Fashion Week', city: 'Paris', date: '2026-10-05', bumpPercent: 40 },
  { name: 'Rome Marathon', city: 'Rome', date: '2027-03-15', bumpPercent: 25 },
  { name: 'Lisbon Web Summit', city: 'Lisbon', date: '2026-11-02', bumpPercent: 35 },
  { name: 'Berlin Tech Week', city: 'Berlin', date: '2027-06-14', bumpPercent: 30 },
];

// Cities StyZo knows how to price. Extras beyond the event cities keep the
// demo more forgiving when a host types a city the events list omits.
const KNOWN_CITIES = [
  ...new Set(EVENTS.map((e) => e.city.toLowerCase())),
  'madrid', 'amsterdam', 'london', 'istanbul',
];

module.exports = { EVENTS, KNOWN_CITIES };