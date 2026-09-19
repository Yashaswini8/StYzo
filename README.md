# StyZo — WhatsApp Host Assistant (Meta WhatsApp Cloud API)

StyZo is a backend server that lets short-stay property hosts message a WhatsApp
number and automatically get:

- **🏠 AI-generated listings** (title + description) via Google Gemini — text or photo-based
- **💰 Pricing suggestions** via simple rule-based logic (no AI), currency-aware per city
- **📅 Booking confirmations / blocked dates** stored in memory
- **🎙️ Voice notes** — downloaded and transcribed, then answered like text

It runs on **Meta's WhatsApp Cloud API** (Facebook Graph API, v25.0) and Google
Gemini. Built with **Node.js + Express**. No SMS provider or third-party Twilio
account is required.

---

## How it works

1. A host sends a WhatsApp message to your Meta WhatsApp Business number.
2. Meta POSTs the message to the server's `/webhook` endpoint as JSON.
3. StyZo extracts the first message (text, photo, or voice note), downloads any
   media via the Graph API, transcribes voice notes, then classifies the text:

| Request type | Trigger | Example |
| --- | --- | --- |
| `listing` | Photos attached, or property details | _"Create a listing for my 2-bed apartment at 12 Ocean Drive"_ (+ photos) |
| `pricing` | A city name + dates | _"What's the price in Barcelona on July 10-12?"_ |
| `booking` | A confirm/block action + a date | _"Confirm July 15"_ or _"Block August 5-7"_ |
| `chat` | Anything unrecognised | A friendly Gemini answer |

4. The matching handler runs, a reply is drafted, and StyZo sends it back to the
   same WhatsApp number through the **WhatsApp Cloud API**.

> Every phone number is handled generically — no sender whitelist in the code.
> (Meta's dev-mode "allowed recipient list" still applies until your app is
> approved for production messaging.)

### Project layout

```
styzo/
├── src/
│   ├── server.js       # Express app + entry point (webhook, /landing, /demo)
│   ├── meta.js         # Meta webhook parsing, media download, Graph outbound
│   ├── webhook.js      # Shared response brain (classify + build replies)
│   ├── classifier.js   # Message routing (listing / pricing / booking / chat / help)
│   ├── listing.js      # Gemini-powered listing generation + voice transcription
│   ├── pricing.js      # Rule-based pricing estimator
│   ├── currencies.js   # Per-city currency + symbol table
│   ├── bookings.js     # In-memory booking store
│   ├── dates.js        # Free-text date/range parsing
│   ├── events.js       # City-aware sample local events (demo data)
│   └── config.js       # Reads every secret from the environment
├── public/
│   ├── landing.html    # Public landing page (Chat with StyZo, Try Live Demo)
│   └── styzo-prototype.html  # Interactive demo prototype
├── vercel.json         # Vercel serverless deployment config
├── render.yaml         # Render blueprint (optional alternative host)
└── .env.example        # Template for your environment variables
```

---

## Setup

### 1. Prerequisites

- [Meta developer account](https://developers.facebook.com) with a Meta app
- A **WhatsApp Business** number set up in the app's WhatsApp → API Setup, with
  a test recipient added to the allowed list
- A [Google Gemini](https://aistudio.google.com/apikey) API key (free tier works)
- [Node.js](https://nodejs.org) 18+ — this repo uses built-in `fetch`, no SDKs

### 2. Configure

```bash
cp .env.example .env
```

Set `META_PHONE_NUMBER_ID` (Graph node id from WhatsApp → API Setup) and
`META_ACCESS_TOKEN` (the temporary token shown there expires ~24h — swap it for
a permanent/system-user token before going public). Add your `GEMINI_API_KEY`.

### 3. Run locally

```bash
npm install
npm start        # http://localhost:3000
```

### 4. Receive live messages

Expose your local server so Meta can reach the webhook:

```bash
npx ngrok http 3000
```

Then in the Meta app dashboard → WhatsApp → **API Setup → Edit webhook
subscription**:

- **Callback URL:** `https://<your-ngrok-or-deployed-url>/webhook`
- **Verify token:** `hackathon2026verify`
- Subscribe to the **`messages`** field.

---

## Env vars

| Variable | Required | Description |
| --- | --- | --- |
| `META_PHONE_NUMBER_ID` | yes | Graph node id of your WhatsApp Business number |
| `META_ACCESS_TOKEN` | yes | Meta access token (temporary or system-user) |
| `GEMINI_API_KEY` | yes | Google AI Studio key for listing generation |
| `GEMINI_MODEL` | no | Defaults to `gemini-3.6-flash` (fallbacks: `gemini-3-flash-preview`, `gemini-3.5-flash`) |
| `BASE_PRICE` | no | Base nightly rate (default 100) |
| `WEEKEND_SURCHARGE` | no | Extra per Fri/Sat night (default 25) |
| `PRICING_CURRENCY` | no | Fallback currency code (default USD) |
| `DEFAULT_CITY` | no | Fallback city for date-only pricing queries |
| `PORT` | no | Default 3000 |

---

## Deploy

### Vercel (primary)

The repo ships with `vercel.json` — deploy the whole backend (webhook + landing
+ demo) as a single serverless function:

```bash
vercel --prod
```

Then set the same env vars in the Vercel project, push public, and point the
Meta webhook callback URL at `https://<your-project>.vercel.app/webhook`.

### Render (optional)

The included `render.yaml` blueprint works too — connect the repo and fill in
the `sync: false` (secret) variables when prompted.

---

## API surface

| Route | Method | Purpose |
| --- | --- | --- |
| `/webhook` | GET | Meta verification handshake (returns the challenge) |
| `/webhook` | POST | Meta inbound message (ACKs with `EVENT_RECEIVED`, then processes) |
| `/landing` | GET | Public landing page |
| `/demo` | GET | Interactive prototype |
| `/` | GET | Public landing page |
| `/health` | GET | Health check JSON |

Meta uses Graph API **v25.0** for messaging and media (`GET /v25.0/{media_id}` →
signed URL, downloaded with the access token in the header). Duplicate webhook
posts (multiple apps subscribed to the same WABA) are de-duplicated by message id.