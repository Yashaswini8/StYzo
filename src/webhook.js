// Webhook handler for Twilio's WhatsApp Sandbox "Message comes in" trigger.
// Twilio POSTs the incoming message as URL-encoded form data:
//   Body, From, NumMedia, and MediaUrl0 / MediaContentType0 (and so on).
// We extract everything, classify it, ACK Twilio immediately with HTTP 200,
// then send the reply asynchronously via the Twilio API (so slow work like
// Gemini calls never makes Twilio retry the webhook).
const { classify } = require('./classifier');
const { generateListing, chatReply } = require('./listing');
const { estimateQuote, formatQuote } = require('./pricing');
const { bookRange, formatBookingResult } = require('./bookings');
const { sendWhatsApp } = require('./twilio');

const HELP_PHRASES = [
  "Hi! I'm StyZo, your host assistant. I can help with:",
  'Hey there! I can help you with:',
  'Here\'s what StyZo can do for you:',
];
const HELP_LINES = [
  '',
  '🏠 LISTING  — send property details, e.g. "Create a listing for my 2-bed apartment at 12 Ocean Drive, beachfront" (+ attach photos)',
  '💰 PRICING  — send a city and dates, e.g. "What\'s the price in Barcelona on July 10-12?"',
  '📅 BOOKING  — confirm or block a date, e.g. "Confirm July 10" or "Block August 5-7"',
];

function helpText() {
  return [HELP_PHRASES[Math.floor(Math.random() * HELP_PHRASES.length)], ...HELP_LINES].join('\n');
}

// Sent once to each user the very first time they ever message us, before
// their actual request is processed.
const WELCOME_TEXT = "Welcome to StYzo! I'm here to help with pricing, listings, and bookings. What do you need?";

// Persistent record of users who have already received the welcome message.
// Keyed by the platform-prefixed "From" (e.g. "meta:919042983773" or
// "whatsapp:+15551234567"), stored on disk so it survives restarts and only
// fires on a user's very first message ever.
const fs = require('fs');
const path = require('path');
const WELCOMED_FILE = path.join(__dirname, '..', 'data', 'welcomed.json');
let welcomedUsers = new Set();

try {
  fs.mkdirSync(path.dirname(WELCOMED_FILE), { recursive: true });
  welcomedUsers = readWelcomed();
} catch (err) {
  console.error('Could not initialise welcomed-users store:', err.message);
}

function readWelcomed() {
  try {
    const raw = fs.readFileSync(WELCOMED_FILE, 'utf8');
    const list = JSON.parse(raw);
    return new Set(Array.isArray(list) ? list : []);
  } catch {
    return new Set();
  }
}

function markWelcomed(user) {
  welcomedUsers.add(user);
  try {
    fs.writeFileSync(WELCOMED_FILE, JSON.stringify([...welcomedUsers]));
  } catch (err) {
    console.error('Could not persist welcomed-users store:', err.message);
  }
}

function safeSend(to, body) {
  return sendWhatsApp(to, body).catch((err) => {
    console.error('Could not send reply:', err.message);
  });
}

// Read every attached media item out of Twilio's request format.
// Twilio numbers them MediaUrl0, MediaUrl1, ... with a matching
// MediaContentType0, MediaContentType1, ... per item.
function extractMedia(reqBody) {
  const count = parseInt(reqBody.NumMedia || '0', 10);
  const media = [];
  for (let i = 0; i < count; i += 1) {
    media.push({
      index: i,
      url: String(reqBody[`MediaUrl${i}`] || '').trim(),
      contentType: String(reqBody[`MediaContentType${i}`] || '').trim(),
    });
  }
  return media;
}

async function buildListingReply({ body, mediaCount, media, images, action }) {
  // Continuing an existing draft: either publish it or regenerate from edits.
  if (action === 'publish') {
    return pickPhrase([
      "Published! 🎉 Your listing is live and ready for guests.",
      "Your listing has been published. 🎉 It's now visible to guests.",
    ]);
  }

  const tweak = action === 'tweak';
  const listing = await generateListing({ propertyDetails: body, mediaCount, media, images, tweak });
  return [
    pickPhrase([
      tweak ? "Here's your updated draft:" : "Here's your draft listing — made with AI:",
      tweak ? 'Here\'s the revised draft:' : 'Your AI-drafted listing is ready:',
    ]),
    '',
    `🏠 Title: ${listing.title}`,
    '',
    `📝 Description: ${listing.description}`,
    '',
    `📷 Photo note: ${listing.photoNote}`,
    '',
    pickPhrase([
      'Reply with tweaks, or send "publish" when you\'re happy.',
      'Tell me what to change, or send "publish" to finalize.',
    ]),
  ].join('\n');
}

function pickPhrase(options) {
  return options[Math.floor(Math.random() * options.length)];
}

function buildPricingReply({ body }) {
  try {
    const quote = estimateQuote({ body });
    return formatQuote(quote);
  } catch (err) {
    return `Couldn't understand those dates. Try "What's the price in Barcelona on July 10-12?"\n(${err.message})`;
  }
}

function buildBookingReply({ body, from, action }) {
  try {
    const result = bookRange({
      guest: from,
      body,
      status: action === 'block' ? 'blocked' : 'confirmed',
    });
    return formatBookingResult(result);
  } catch (err) {
    return `Couldn't complete that booking. ${err.message}`;
  }
}

// Track the type of each user's last reply so a genuine draft continuation
// ("make it shorter", "publish") is recognised as a listing follow-up.
const lastTypeByUser = new Map();

// Build the bot's reply for a message — shared by BOTH the Twilio webhook and
// the local /demo chat UI, so the demo shows the exact same responses WhatsApp
// would get. Returns { welcome, reply, type } where `welcome` is the
// first-time greeting (null for returning users).
async function generateResponse({ from, body, mediaCount, media = [], images = [] }) {
  let welcome = null;
  if (!welcomedUsers.has(from)) {
    markWelcomed(from);
    welcome = WELCOME_TEXT;
  }

  const lastType = lastTypeByUser.get(from) || '';
  const { type, action } = classify({ body, mediaCount, lastType });

  let reply;
  switch (type) {
    case 'listing':
      reply = await buildListingReply({ body, mediaCount, media, images, action });
      break;
    case 'pricing':
      reply = buildPricingReply({ body });
      break;
    case 'booking':
      reply = buildBookingReply({ body, from, action });
      break;
    case 'help':
      reply = helpText();
      break;
    case 'chat':
    default: {
      const natural = await chatReply(body).catch(() => '');
      reply = natural || helpText();
      break;
    }
  }

  lastTypeByUser.set(from, type);
  return { welcome, reply, type };
}

async function processMessage({ from, body, mediaCount, media }) {
  const { welcome, reply, type } = await generateResponse({ from, body, mediaCount, media });

  // Greet first-time users before their real answer. The welcome flag is set
  // before sending so rapid-fire first messages only greet once.
  if (welcome) {
    console.log(`(${from}) [welcome] welcome message sent`);
    await safeSend(from, welcome);
  }

  console.log(`(${from}) [${type}] "${body}"`);
  await safeSend(from, reply);
}

// Express route handler. Responds to Twilio instantly, then processes in the
// background so a slow Gemini call never stalls the webhook response.
function handleIncoming(req, res) {
  const from = String(req.body.From || '').trim();
  const body = String(req.body.Body || '').trim();
  const mediaCount = parseInt(req.body.NumMedia || '0', 10);
  const media = extractMedia(req.body);

  res.status(200).send('OK');

  if (!from || !body) {
    console.warn('Ignoring message with no From/Body');
    return;
  }

  processMessage({ from, body, mediaCount, media }).catch(async (err) => {
    console.error('Failed to process message:', err);
    await safeSend(from, 'Something went wrong while processing your message. Please try again.');
  });
}

module.exports = { handleIncoming, processMessage, generateResponse };