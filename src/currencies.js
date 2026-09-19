// Currency + local-rate tiers, keyed by city. When a pricing request names a
// city we recognise, the quote uses that region's currency and realistic local
// base rates (e.g. INR prices in the thousands, not a direct $100 conversion).
// Unknown or unrecognised cities fall back to the configured default currency.

const CURRENCIES = {
  INR: { code: 'INR', symbol: '₹', basePrice: 3500, weekendSurcharge: 1500 },
  USD: { code: 'USD', symbol: '$', basePrice: 100, weekendSurcharge: 25 },
  EUR: { code: 'EUR', symbol: '€', basePrice: 120, weekendSurcharge: 30 },
  GBP: { code: 'GBP', symbol: '£', basePrice: 95, weekendSurcharge: 25 },
  CHF: { code: 'CHF', symbol: 'CHF ', basePrice: 150, weekendSurcharge: 45 },
  DKK: { code: 'DKK', symbol: 'kr ', basePrice: 750, weekendSurcharge: 200 },
  SEK: { code: 'SEK', symbol: 'kr ', basePrice: 1100, weekendSurcharge: 300 },
  NOK: { code: 'NOK', symbol: 'kr ', basePrice: 1250, weekendSurcharge: 350 },
  AUD: { code: 'AUD', symbol: 'A$', basePrice: 160, weekendSurcharge: 40 },
  CAD: { code: 'CAD', symbol: 'C$', basePrice: 140, weekendSurcharge: 35 },
  JPY: { code: 'JPY', symbol: '¥', basePrice: 15000, weekendSurcharge: 4000 },
};

// City -> currency mapping (lowercase city names). Includes user-specified
// Indian cities plus a solid set for the regions the bot is most likely to see.
const CITY_CURRENCY = {
  // India — INR
  chennai: 'INR', madras: 'INR', mumbai: 'INR', bombay: 'INR', coimbatore: 'INR',
  madurai: 'INR', delhi: 'INR', 'new delhi': 'INR', bangalore: 'INR', bengaluru: 'INR',
  hyderabad: 'INR', pune: 'INR', jaipur: 'INR', kolkata: 'INR', calcutta: 'INR',
  kochi: 'INR', cochin: 'INR', ahmedabad: 'INR', surat: 'INR', nagpur: 'INR',
  lucknow: 'INR', indore: 'INR', chandigarh: 'INR', mysore: 'INR', mysuru: 'INR',
  udaipur: 'INR', goa: 'INR', panaji: 'INR', varanasi: 'INR', agra: 'INR',
  amritsar: 'INR', 'visakhapatnam': 'INR', bhopal: 'INR', gurgaon: 'INR',
  gurugram: 'INR', noida: 'INR', mangalore: 'INR', vadodara: 'INR', kozhikode: 'INR',

  // United States — USD
  'new york': 'USD', nyc: 'USD', manhattan: 'USD', brooklyn: 'USD',
  'los angeles': 'USD', 'san francisco': 'USD', chicago: 'USD', miami: 'USD',
  boston: 'USD', austin: 'USD', dallas: 'USD', houston: 'USD', seattle: 'USD',
  denver: 'USD', 'las vegas': 'USD', orlando: 'USD', 'san diego': 'USD',
  'washington': 'USD', philadelphia: 'USD', atlanta: 'USD', phoenix: 'USD',
  portland: 'USD', nashville: 'USD', 'new orleans': 'USD', honolulu: 'USD',
  'san jose': 'USD', 'santa fe': 'USD', 'key west': 'USD', memphis: 'USD',
  'salt lake city': 'USD',

  // United Kingdom — GBP
  london: 'GBP', manchester: 'GBP', edinburgh: 'GBP', birmingham: 'GBP',
  liverpool: 'GBP', bristol: 'GBP', leeds: 'GBP', glasgow: 'GBP',
  newcastle: 'GBP', sheffield: 'GBP', nottingham: 'GBP', oxford: 'GBP',
  cambridge: 'GBP', brighton: 'GBP', belfast: 'GBP',

  // Switzerland — CHF
  zurich: 'CHF', geneva: 'CHF', basel: 'CHF', lausanne: 'CHF', bern: 'CHF',

  // Denmark / Sweden / Norway — kr
  copenhagen: 'DKK', stockholm: 'SEK', gothenburg: 'SEK', malmo: 'SEK',
  oslo: 'NOK', bergen: 'NOK',

  // Eurozone — EUR
  paris: 'EUR', rome: 'EUR', milan: 'EUR', naples: 'EUR', venice: 'EUR',
  florence: 'EUR', barcelona: 'EUR', madrid: 'EUR', seville: 'EUR', valencia: 'EUR',
  berlin: 'EUR', munich: 'EUR', hamburg: 'EUR', frankfurt: 'EUR', cologne: 'EUR',
  amsterdam: 'EUR', rotterdam: 'EUR', lisbon: 'EUR', porto: 'EUR',
  brussels: 'EUR', antwerp: 'EUR', vienna: 'EUR', prague: 'EUR', budapest: 'EUR',
  warsaw: 'EUR', krakow: 'EUR', athens: 'EUR', dublin: 'EUR', vilnius: 'EUR',

  // Australia / Canada / Japan
  sydney: 'AUD', melbourne: 'AUD', brisbane: 'AUD', perth: 'AUD', adelaide: 'AUD',
  toronto: 'CAD', vancouver: 'CAD', montreal: 'CAD', calgary: 'CAD', ottawa: 'CAD',
  tokyo: 'JPY', osaka: 'JPY', kyoto: 'JPY',
};

const ALL_CITY_KEYS = Object.keys(CITY_CURRENCY);

// Best-effort currency lookup from a parsed city name. Matches exact city names
// first, then the longest substring overlap (handles "New York City" etc).
function detectCurrency(city) {
  if (!city) return null;
  const c = city.toLowerCase();
  if (CITY_CURRENCY[c]) return CITY_CURRENCY[c];
  const hits = ALL_CITY_KEYS.filter(
    (k) => c.includes(k) || k.includes(c),
  );
  if (!hits.length) return null;
  hits.sort((a, b) => b.length - a.length);
  return CITY_CURRENCY[hits[0]];
}

// Full currency config for a city, falling back to the given default currency.
function currencyFor(city, fallbackCode = 'USD') {
  const code = detectCurrency(city) || fallbackCode;
  const cfg = CURRENCIES[code] || CURRENCIES.USD;
  return { ...cfg, code };
}

module.exports = { CURRENCIES, CITY_CURRENCY, ALL_CITY_KEYS, detectCurrency, currencyFor };