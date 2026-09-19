// Message routing: decides which handler answers an incoming WhatsApp message.
//
//   • BOOKING  — a confirm/block action word plus a date
//   • PRICING  — a city name plus dates (with or without price-like intent)
//   • LISTING  — only when the message clearly describes a property OR the
//                sender is continuing an existing listing draft (tweak/publish)
//   • HELP     — explicit help/menu/commands requests → static menu
//   • CHAT     — anything else → sent to the AI to reply naturally
//
// Ordering matters: booking is checked first because "confirm July 10" also
// contains a city + date pattern we must not mis-route to pricing. Listing is
// deliberately strict so off-topic or vague messages never trigger a draft.
const { hasDate } = require('./dates');
const { KNOWN_CITIES } = require('./events');
const { ALL_CITY_KEYS } = require('./currencies');

const CONFIRM_WORDS = ['confirm', 'confirming', 'confirmed', 'book', 'booking', 'booked', 'reserve', 'reserved', 'reservation'];
const BLOCK_WORDS = ['block', 'blocking', 'blocked', 'cancel', 'cancelling', 'cancelled', 'canceled', 'hold', 'unavailable'];

const PRICE_WORDS = [
  'price', 'pricing', 'cost', 'costs', 'quote', 'quotes', 'rate', 'rates',
  'estimate', 'charge', 'charges', 'fee', 'fees', 'nightly',
  'per night', 'how much', 'what does it cost', 'price range',
];

const HELP_WORDS = ['help', 'menu', 'options', 'what can you do', 'commands', 'how do i', 'what can u do'];

// Explicit requests to create/draft a listing. Capitalised: "make a listing",
// "list my apartment", "draft an ad", "publish my property", etc.
const LISTING_INTENT_RE = [
  /\b(create|add|make|draft|write|build|generate|set up|publish|post|start)\b.*\b(listing|ad|advert|advertisement|property ad)\b/,
  /\b(list|advertise|describe|sell)\b.*\b(property|apartment|flat|villa|house|studio|place)\b/,
  /\bbecome\b.*\bhost\b/,
];

const PROPERTY_NOUNS = [
  'apartment', 'flat', 'villa', 'house', 'studio', 'condo', 'condominium',
  'cottage', 'bungalow', 'townhouse', 'loft', 'penthouse', 'chalet', 'cabin',
  'guesthouse', 'property', 'unit', 'retreat', 'suite',
];

// Signals that a message actually describes a property: rooms, size, location,
// or amenities.
const PROPERTY_DETAILS = [
  'bedroom', 'bedrooms', 'bathroom', 'bathrooms', 'sqm', 'm2', 'square meter',
  'square metre', 'sqft', 'square feet', 'street', 'avenue', 'road',
  'boulevard', 'lane', 'address', 'downtown', 'center', 'centre',
  'neighborhood', 'neighbourhood', 'district', 'beach', 'beachfront',
  'seafront', 'waterfront', 'lakefront', 'ocean view', 'sea view', 'pool',
  'swimming pool', 'wifi', 'wi-fi', 'garden', 'terrace', 'balcony', 'patio',
  'garage', 'parking', 'air conditioning', 'fireplace', 'sauna', 'jacuzzi',
  'gym', 'rooftop', 'view', 'views', 'furnished', 'floor', 'facing', 'coastal',
];

// Reply phrases that only make sense while continuing an existing draft.
const DRAFT_TWEAK_RE = /\b(edit|edits|tweak|change|shorten|make it|rewrite|rephrase|improve|update|add|remove|less|more|could you)\b/i;
const DRAFT_PUBLISH_RE = /\b(publish|post it|make it live|go live|put it live|send it|finalize|finalise|done|looks good|perfect.)\b/i;

function hasMedia(mediaCount) {
  return Number(mediaCount) > 0;
}

function isPropertyDescription(text) {
  const noun = PROPERTY_NOUNS.some((w) => text.includes(w));
  const detail =
    PROPERTY_DETAILS.some((w) => text.includes(w)) ||
    /\b\d+\s*(bed|br|bd|bedroom|bedrooms|bath|bathroom)\b/.test(text) ||
    /\b\d+\s*(sqm|m2|sqft)\b/.test(text);
  return noun && detail;
}

// Map a raw incoming message to { type, action, city }. `lastType` is the type
// of the sender's previous message, so draft replies (tweak/publish) are only
// treated as listing continuations when a draft was just made.
function classify({ body = '', mediaCount = 0, lastType = '' }) {
  const text = body.trim().toLowerCase();

  // --- 1. Booking: action word + a date --------------------------------
  const isConfirm = CONFIRM_WORDS.some((w) => text.includes(w));
  const isBlock = BLOCK_WORDS.some((w) => text.includes(w));
  if ((isConfirm || isBlock) && hasDate(text)) {
    return { type: 'booking', action: isBlock ? 'block' : 'confirm' };
  }

  // --- 2. Pricing: any city + dates with price-like intent -----------------
  const isPriceIntent = PRICE_WORDS.some((w) => text.includes(w));
  const allCities = [...new Set([...KNOWN_CITIES, ...ALL_CITY_KEYS])];
  const city = allCities.find((c) => text.includes(c));
  if (hasDate(text) && (isPriceIntent || city)) {
    return { type: 'pricing', city: city || null };
  }

  // --- 3. Listing: only with real property intent -------------------------
  // A question ("how do I write an ad?", "what is a villa?") is information
  // seeking, not a request to draft a listing — let the chat fallback handle it.
  const isQuestion =
    /\b(how|what|when|where|why|should|can|could|do|does|is|are)\b/i.test(text) && /\?/.test(text);
  const explicitIntent = LISTING_INTENT_RE.some((re) => re.test(text)) && !isQuestion;
  const propertyDescription = isPropertyDescription(text) && !isQuestion;
  const draftPublish =
    lastType === 'listing' && DRAFT_PUBLISH_RE.test(text) && !hasDate(text);
  const draftTweak =
    lastType === 'listing' && DRAFT_TWEAK_RE.test(text) && !hasDate(text);

  if (explicitIntent || propertyDescription || draftPublish || draftTweak) {
    return { type: 'listing', action: draftPublish ? 'publish' : draftTweak ? 'tweak' : null };
  }

  // A bare photo (no caption, or a short caption) is considered a property
  // photo — draft a listing from it. Longer captions must otherwise describe
  // the property to count as a listing request.
  if (hasMedia(mediaCount) && (text.length === 0 || propertyDescription)) {
    return { type: 'listing', action: 'photo' };
  }

  // --- 4. Help: explicit request for assistance ---------------------------
  if (HELP_WORDS.some((w) => text.includes(w))) {
    return { type: 'help' };
  }

  // --- 5. Chat: everything else goes to the AI -----------------------------
  return { type: 'chat' };
}

module.exports = { classify };