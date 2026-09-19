// Centralised configuration. Every secret/key lives in .env (via dotenv)
// and is read here — nothing is hardcoded in the rest of the app.
require('dotenv').config();

function parseFloatOr(name, fallback) {
  const value = parseFloat(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
}

module.exports = {
  port: parseFloatOr('PORT', 3000),
  meta: {
    phoneNumberId: process.env.META_PHONE_NUMBER_ID || '',
    accessToken: process.env.META_ACCESS_TOKEN || '',
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
  },
  pricing: {
    basePrice: parseFloatOr('BASE_PRICE', 100),
    weekendSurcharge: parseFloatOr('WEEKEND_SURCHARGE', 25),
    currency: process.env.PRICING_CURRENCY || 'USD',
  },
  defaultCity: process.env.DEFAULT_CITY || 'Barcelona',
};