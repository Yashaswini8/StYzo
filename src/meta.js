// Meta WhatsApp Cloud API adapter — inbound webhook parsing + outbound
// messaging via the Graph API. It reuses the exact same response brain as
// any other transport (classifier, Gemini listings, rule-based pricing,
// in-memory bookings, welcome-once), so replies are identical regardless of
// which platform a message arrives through. Works generically for ANY sender.
const { generateResponse } = require('./webhook');
const { transcribeAudio } = require('./listing');
const { meta: metaConfig } = require('./config');

const GRAPH_VERSION = 'v25.0';
const MAX_MEDIA_DOWNLOADS = 4;
const MAX_MEDIA_BYTES = 6 * 1024 * 1024;

// Dedupe window. With multiple apps subscribed to the same WABA, Meta can POST
// the same message id twice — we process each message exactly once.
const seenMessages = new Map();

function rememberMessage(messageId) {
  if (!messageId) return false;
  if (seenMessages.has(messageId)) return true;
  seenMessages.set(messageId, Date.now());
  while (seenMessages.size > 500) {
    const oldest = seenMessages.keys().next().value;
    seenMessages.delete(oldest);
  }
  return false;
}

async function sendMetaWhatsApp(to, body) {
  if (!metaConfig.phoneNumberId || !metaConfig.accessToken) {
    console.warn('Meta messaging not configured — skipping send to', to);
    return;
  }
  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${metaConfig.phoneNumberId}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${metaConfig.accessToken}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Meta API ${response.status}: ${(await response.text()).slice(0, 200)}`);
  }
  return response.json();
}

// Pull the first real user message out of Meta's webhook envelope. Meta also
// posts status/delivery updates with no `messages` array — those are ignored.
function extractFirstMessage(body) {
  const entry = Array.isArray(body?.entry) ? body.entry : [];
  for (const e of entry) {
    const changes = Array.isArray(e?.changes) ? e.changes : [];
    for (const c of changes) {
      const messages = Array.isArray(c?.value?.messages) ? c.value.messages : [];
      for (const message of messages) {
        if (message && message.from) return message;
      }
    }
  }
  return null;
}

// Map a Meta message object into the same { from, body, mediaCount, media,
// type, mId } shape the rest of the pipeline expects. `sender` stays whatever
// Meta sent — every phone number is handled identically.
function normaliseMessage(message) {
  const from = String(message.from || '').trim();
  const type = String(message.type || 'text');
  const mId = String(message.id || '').trim();

  // Text message.
  if (type === 'text' && message.text) {
    return { from, body: String(message.text.body || '').trim(), mediaCount: 0, media: [], type, mId };
  }

  // Media message (image/audio/video/document/sticker). We keep the media id
  // so the bytes can be fetched via the Graph API for photo-aware listings.
  const payload = message[type] || {};
  const contentType = String(payload.mime_type || type || 'unknown').trim();
  return {
    from,
    body: '',
    mediaCount: 1,
    media: [{
      index: 0,
      id: String(payload.id || '').trim(),
      url: '',
      contentType,
    }],
    type,
    mId,
  };
}

// Download the bytes for any media id (image, voice note, document...) and
// return { buffer, contentType }, or null on failure.
async function downloadMediaById(mediaId, contentType) {
  if (!mediaId) return null;
  const url = await getMediaUrl(mediaId);
  if (!url) return null;
  const buffer = await downloadMedia(url);
  if (!buffer.length || buffer.length > MAX_MEDIA_BYTES) return null;
  return { buffer, contentType };
}

// Resolve a media id to a temporary download URL.
async function getMediaUrl(mediaId) {
  const response = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(mediaId)}`,
    { headers: { Authorization: `Bearer ${metaConfig.accessToken}` } },
  );
  if (!response.ok) {
    throw new Error(`Media lookup ${response.status}`);
  }
  const data = await response.json();
  return String(data.url || '');
}

// Download the actual image bytes. The returned URL is signed and still needs
// the access token in the header.
async function downloadMedia(mediaUrl) {
  const response = await fetch(mediaUrl, {
    headers: { Authorization: `Bearer ${metaConfig.accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`Media download ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

async function processMetaWebhook(body) {
  const message = extractFirstMessage(body);
  if (!message) return; // status/delivery-only webhooks

  const { from, body: text, mediaCount, media, type, mId } = normaliseMessage(message);
  if (!from) return;

  // Same WhatsApp message can be posted by multiple subscribed apps — handle once.
  if (rememberMessage(mId)) return;

  let bodyOverride = text;
  let images = [];
  let effectiveMedia = media;
  let effectiveMediaCount = mediaCount;

  // Voice note: download the audio and transcribe it, then answer its content
  // exactly as if the guest had typed it.
  if (type === 'audio') {
    const audio = await downloadMediaById(media[0]?.id, media[0]?.contentType || 'audio/ogg');
    if (!audio) {
      await safeSend(
        from,
        "I received your voice note but couldn't download it. Could you send it again or type your request?",
      );
      return;
    }
    const transcript = await transcribeAudio(audio).catch((err) => {
      console.error(`(meta:${from}) voice note transcription failed: ${err.message}`);
      return '';
    });
    if (!transcript) {
      await safeSend(
        from,
        "I received your voice note but couldn't transcribe it. Could you type your request instead?",
      );
      return;
    }
    bodyOverride = transcript;
    effectiveMedia = [];
    effectiveMediaCount = 0;
    console.log(`(meta:${from}) [voice] transcribed: "${transcript}"`);
  }

  // Photo (or any other media): download so the listing AI can see it.
  for (const item of effectiveMedia.slice(0, MAX_MEDIA_DOWNLOADS)) {
    if (!item.id) continue;
    try {
      const downloaded = await downloadMediaById(item.id, item.contentType);
      if (downloaded) images.push(downloaded);
    } catch (err) {
      console.error(`(meta:${from}) could not download media ${item.id}: ${err.message}`);
    }
  }
  if (effectiveMedia.length && images.length < effectiveMedia.length) {
    console.warn(`(meta:${from}) downloaded ${images.length}/${effectiveMedia.length} attachment(s)`);
  }

  // Namespace the From so the welcome gate fires once per WhatsApp number.
  const generated = await generateResponse({
    from: `meta:${from}`,
    body: bodyOverride,
    mediaCount: effectiveMediaCount,
    media: effectiveMedia,
    images,
  });

  const { welcome, reply, type: replyType } = generated;
  console.log(`(meta:${from}) [${replyType}] "${bodyOverride}" ${effectiveMedia.length ? `(${effectiveMedia.length} media)` : ''}`);
  if (welcome) {
    console.log(`(meta:${from}) [welcome] welcome message sent`);
    await safeSend(from, welcome);
  }
  await safeSend(from, reply);
}

async function safeSend(to, body) {
  try {
    await sendMetaWhatsApp(to, body);
  } catch (err) {
    console.error('Could not send Meta reply:', err.message);
  }
}

// Express route handler. ACK Meta instantly with HTTP 200, then process in the
// background so slow work (image downloads + Gemini calls) never makes Meta
// retry the webhook.
function handleMetaIncoming(req, res) {
  res.status(200).send('EVENT_RECEIVED');
  processMetaWebhook(req.body).catch((err) => {
    console.error('Meta webhook processing failed:', err.message);
  });
}

module.exports = { handleMetaIncoming, sendMetaWhatsApp, normaliseMessage };