// LISTING generation: asks Google Gemini to turn raw property details into a
// publishable listing (title + short description). Real photo analysis is
// out of scope for this version, so image handling is a placeholder note.
//
// Uses Gemini's REST API directly (https://ai.google.dev/gemini-api/docs)
// with a free-tier flash model — no extra SDK dependency needed.
const { gemini: geminiConfig } = require('./config');

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const FALLBACK_MODELS = ['gemini-3-flash-preview', 'gemini-3.5-flash'];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Send one generateContent request to a single model. Retries transient
// capacity errors (429 / 503 / 5xx) with backoff. Returns the raw response JSON.
async function askModel(model, parts, { json = false, temperature = 0.7 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const url = `${GEMINI_BASE_URL}/${model}:generateContent?key=${encodeURIComponent(geminiConfig.apiKey)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: Object.assign({ temperature }, json ? { responseMimeType: 'application/json' } : {}),
        }),
      });

      const text = await response.text();
      if (response.ok) return JSON.parse(text);
      lastError = new Error(`Gemini API ${response.status}: ${text.slice(0, 200)}`);
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable) throw lastError;
    } catch (err) {
      lastError = err;
    }
    await sleep(600 * Math.pow(2, attempt));
  }
  throw lastError || new Error('Gemini request failed');
}

// Summarise the attached media for the reply text. Real image analysis is out
// of scope, but we surface the count and content types Twilio reported so it's
// clear the photos arrived. Media URLs (media[].url) are kept for a future
// version that actually analyses images.
function buildPhotoNote(media = []) {
  if (media.length === 0) {
    return 'No photos were attached. Attach photos of the property for the best result.';
  }
  const types = [...new Set(media.map((m) => m.contentType || 'unknown'))].join(', ');
  return `${media.length} photo(s) attached (${types}). Photos were included in the AI analysis, so the listing reflects what the photos show — no separate photo analysis planned.`;
}

// Minimal fallback so the bot still answers even if Gemini is unavailable.
function fallbackListing(body, media) {
  return {
    title: `StyZo Host Listing — ${new Date().toLocaleDateString()}`,
    description: `A quality listing drafted from your details: "${body.slice(0, 120)}". We had trouble reaching the AI, so please review and edit before publishing.`,
    photoNote: buildPhotoNote(media),
  };
}

async function runWithFallbacks(parts, { json, temperature }) {
  const models = [geminiConfig.model, ...FALLBACK_MODELS.filter((m) => m !== geminiConfig.model)];
  let lastError;
  for (const model of models) {
    try {
      return await askModel(model, parts, { json, temperature });
    } catch (err) {
      lastError = err;
      console.warn(`Gemini model ${model} failed (${err.message})`);
    }
  }
  throw lastError || new Error('All Gemini models failed');
}

async function callGemini(prompt, images = []) {
  const parts = [];

  // Attach downloaded photos so Gemini can actually SEE the property. Inline
  // image data is base64; we cap size so huge uploads don't blow the model limit.
  for (const image of images) {
    const buf = image.buffer;
    if (!buf || !buf.length) continue;
    if (buf.length > 6 * 1024 * 1024) continue;
    parts.push({
      inline_data: {
        mime_type: image.contentType || 'image/jpeg',
        data: buf.toString('base64'),
      },
    });
  }

  parts.push({ text: prompt });

  const data = await runWithFallbacks(parts, { json: true, temperature: 0.7 });
  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || '')
      .join('') || '';
  return text;
}

async function generateListing({ propertyDetails, mediaCount, media = [], images = [], tweak = false }) {
  if (!geminiConfig.apiKey) {
    return fallbackListing(propertyDetails, media);
  }

  try {
    const photoNote = buildPhotoNote(media);
    const photoSizes =
      media.length > 0
        ? ` The host also attached ${media.length} photo(s) via WhatsApp.`
        : '';
    const seenImages =
      images.filter((i) => i.buffer && i.buffer.length && i.buffer.length <= 6 * 1024 * 1024).length > 0
        ? ' The photos are attached to this request, so use what you can see in them. '
        : '';

    const tweakPrompt = tweak
      ? 'You are StyZo, an AI assistant for short-stay property hosts. The host is editing an existing listing draft and sent these changes. Apply exactly these requested edits while staying consistent with the original context. Reply ONLY with valid JSON in exactly this shape: {"title":"...","description":"..."}. ' +
        `Requested edits from the host: "${propertyDetails}".`
      : 'You are StyZo, an AI assistant for short-stay property hosts. ' +
        'Given a property description AND any photos, generate a catchy listing title and a ' +
        '2-3 sentence description that appeals to travellers. ' +
        'Reply ONLY with valid JSON in exactly this shape: ' +
        '{"title":"...","description":"..."}. ' +
        `Property details from the host: "${propertyDetails}".${photoSizes} ${photoNote}${seenImages}`;

    const raw = await callGemini(tweakPrompt, tweak ? [] : images);
    // Strip JSON fences if the model ever wraps the answer in a code block.
    const clean = raw.replace(/^```json\s*|\s*```$/g, '').trim();
    const parsed = JSON.parse(clean);

    return {
      title: String(parsed.title || '').trim(),
      description: String(parsed.description || '').trim(),
      photoNote: buildPhotoNote(media),
    };
  } catch (err) {
    console.error('Gemini listing generation failed:', err.message);
    return fallbackListing(propertyDetails, media);
  }
}

// Transcribe a WhatsApp voice note (audio message) into plain text using
// Gemini's audio input. Returns the spoken text, or '' on any failure so the
// caller can fall back to a text reply.
async function transcribeAudio({ buffer, contentType = 'audio/ogg' }) {
  if (!geminiConfig.apiKey || !buffer || !buffer.length) return '';

  const parts = [
    {
      inline_data: {
        mime_type: contentType,
        data: buffer.toString('base64'),
      },
    },
    {
      text: 'Transcribe this voice note exactly as spoken. Reply with ONLY the transcribed text, nothing else — no quotes, no commentary. If the audio is unclear, transcribe the parts you can make out.',
    },
  ];

  try {
    const data = await runWithFallbacks(parts, { json: false, temperature: 0 });
    return (
      data?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || '')
        .join('')
        .trim() || ''
    );
  } catch (err) {
    console.error('Audio transcription failed:', err.message);
    return '';
  }
}

// Natural-language fallback for anything that isn't clearly pricing, booking,
// or a listing request. Gives Gemini context about what StyZo does and lets it
// answer helpfully, steering the conversation back to our capabilities.
async function chatReply(message) {
  if (!geminiConfig.apiKey || !message || !message.trim()) return '';

  const parts = [
    {
      text:
        'You are StyZo, an AI assistant built into a WhatsApp bot that helps short-stay ' +
        'property hosts. You can help with:\n' +
        '- PRICING: recommend nightly rates for a city + dates (e.g. "What is the price in Barcelona on July 10-12?")\n' +
        '- LISTINGS: write an appealing property listing from details and photos (e.g. "Create a listing for my 2-bed beachfront apartment")\n' +
        '- BOOKINGS: confirm or block dates (e.g. "Confirm July 15" or "Block August 5-7")\n' +
        'The guest/host may ask about anything. Reply naturally, helpfully and concisely ' +
        '(under 150 words, WhatsApp friendly, plain text). If the message is vague or off-topic, ' +
        'politely clarify what they need or nudge them toward pricing, listings, or bookings. ' +
        'Never pretend to do things you cannot do (e.g. do not claim a listing was published).',
    },
    { text: `Message from the user: "${message}"` },
  ];

  try {
    const data = await runWithFallbacks(parts, { json: false, temperature: 0.6 });
    return (
      data?.candidates?.[0]?.content?.parts
        ?.map((part) => part.text || '')
        .join('')
        .trim() || ''
    );
  } catch (err) {
    console.error('Chat reply generation failed:', err.message);
    return '';
  }
}

module.exports = { generateListing, transcribeAudio, chatReply };