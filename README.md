# StyZo — WhatsApp Host Assistant

StyZo is a backend server that lets short-stay property hosts message a WhatsApp
number and automatically get:

- **🏠 AI-generated listings** (title + description) via Google Gemini
- **💰 Pricing suggestions** via simple rule-based logic (no AI)
- **📅 Booking confirmations / blocked dates** stored in memory

It ties together Twilio's WhatsApp API and Google's Gemini API. Built with **Node.js + Express**.

---

## How it works

1. A host sends a WhatsApp message to your Twilio number.
2. Twilio POSTs the message to the server's `/webhook` endpoint.
3. StyZo classifies the message into one of four request types:

| Request type | Trigger | Example |
| --- | --- | --- |
| `listing` | Photos attached, or property details | _"Create a listing for my 2-bed apartment at 12 Ocean Drive"_ (+ photos) |
| `pricing` | A city name + dates | _"What's the price in Barcelona on July 10-12?"_ |
| `booking` | A confirm/block action + a date | _"Confirm July 15"_ or _"Block August 5-7"_ |
| `help` | Anything unrecognised | _"hello"_ |

4. The matching handler runs, a reply is drafted, and StyZo sends it back to the
   same WhatsApp number via Twilio's Messages API.

### Project layout

```
styzo/
├── src/
│   ├── server.js       # Express app + entry point
│   ├── webhook.js      # POST /webhook handler; routes messages to the right logic
│   ├── classifier.js   # Message routing (listing / pricing / booking / help)
│   ├── listing.js      # Gemini-powered listing generation
│   ├── pricing.js      # Rule-based pricing estimator
│   ├── bookings.js     # In-memory booking store
│   ├── twilio.js       # Outbound WhatsApp replies
│   ├── dates.js        # Free-text date/range parsing
│   ├── events.js       # Hardcoded sample local events (demo data)
│   └── config.js       # Reads every secret from the environment
├── render.yaml         # Render blueprint (optional, dashboard works too)
├── .env.example        # Copy to .env and fill in
└── package.json
```

### Pricing rules (demo values, all configurable in `.env`)

- **Base rate:** `BASE_PRICE` (default `100` / night)
- **Weekend bump:** `WEEKEND_SURCHARGE` (default `25`) added on Fri/Sat nights
- **Event bump:** extra `bumpPercent %` of the base rate on nights matching an
  event in `src/events.js` (e.g. Barcelona Marathon → +35%)

> Events are a hardcoded sample list for demo purposes only.

**Bookings** live in an in-memory `Map`, so data resets on restart — swap in
SQLite/Postgres when you need persistence.

---

## Local development

### 1. Prerequisites

- Node.js 18+
- A [Twilio account](https://www.twilio.com/try-twilio)
- A [Google Gemini API key](https://aistudio.google.com/apikey) — free tier

### 2. Install & configure

```bash
cd styzo
npm install
cp .env.example .env    # then fill in your real keys
```

`.env` needs at least:

```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886   # Twilio WhatsApp sandbox number in dev
GEMINI_API_KEY=your-gemini-api-key
```

### 3. Run locally

```bash
npm start        # or npm run dev for auto-reload
```

Health check: http://localhost:3000/

### 4. Test with ngrok so Twilio can reach you

```bash
ngrok http 3000
```

Twilio can only call a public URL, so forward your local port:

1. Copy the `https://xxxx.ngrok.io` URL.
2. In the [Twilio Console → Messaging → Try it out → WhatsApp Sandbox](https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp):
   - Set **When a message comes in** to `https://xxxx.ngrok.io/webhook`
   - Method: **HTTP POST**.
3. Message your sandbox number from WhatsApp and try:

```
What's the price in Barcelona on 15-17 Nov 2026?
```

You should get a quote back with the weekend + event bump breakdown.

---

## Twilio WhatsApp Sandbox setup (exact steps)

StyZo works with **Twilio's WhatsApp Sandbox** (the "you're all set!
Happy texting!" grey/green sandbox screen) — not Meta's Cloud API. Twilio is
the WhatsApp provider, so this is the only webhook the server talks to.

### What the sandbox sends you

When a message arrives, Twilio POSTs it to your configured webhook as
`application/x-www-form-urlencoded` data:

```
Body            the message text
From            the sender, e.g. "whatsapp:+15551234567"
NumMedia        number of attached media items (0 if none)
MediaUrl0       public URL of the first photo
MediaContentType0   MIME type of the first photo, e.g. "image/jpeg"
MediaUrl1, MediaContentType1, ...   any additional photos
```

`src/webhook.js` reads exactly these fields (`Body`, `From`, `NumMedia`,
`MediaUrl…`, `MediaContentType…`) and collects them into a `media` array that
feeds the listing generator. The webhook replies to Twilio with HTTP 200 right
away, then answers the host asynchronously through the Twilio Messages API.

### Step-by-step

1. **Get your sandbox credentials**
   - Open the [Twilio Console → Messaging → Try it out → WhatsApp Sandbox](https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp).
   - Note the sandbox number — it is **`whatsapp:+14155238886`** for every
     account (your *Assign a number* dropdown stays as this default in sandbox).
   - Your **Account SID** (`AC…`) and **Auth Token** sit in your account
     settings / API keys page.

2. **Put them in `.env`**

   ```env
   TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   TWILIO_AUTH_TOKEN=your_auth_token
   TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
   ```

    > `src/twilio.js` strips/adds the `whatsapp:` prefix automatically, so it
    > works whether you write `whatsapp:+14155238886` or `+14155238886`.

3. **Join the sandbox from your phone**
   - From WhatsApp, send the magic join code shown on the Sandbox page
     (e.g. `join lover-icecream`) to `whatsapp:+14155238886`.
   - Twilio replies "You are all set" — you're now a member of the sandbox and
     can message it.

4. **Run StyZo + ngrok**

   ```bash
   npm start          # terminal 1 — server on http://localhost:3000
   ngrok http 3000    # terminal 2 — public tunnel, copy the https://...ngrok.io URL
   ```

5. **Point "WHEN A MESSAGE COMES IN" at the server**
   - In the Sandbox console, find **"Sandbox Settings"** (button next to
     *Assign a number*).
   - Set **When a message comes in** to:
     ```
     https://<your-ngrok-subdomain>.ngrok.io/webhook
     ```
   - Set the **HTTP method** dropdown to **`HTTP POST`**.
   - Click **Save**.

6. **Test it**
   - Send photos of a property plus a description:
     - message your sandbox number from WhatsApp: *"Create a listing for my
       sunny 2-bed apartment, old town, 3 nights from €90"* with 2 photos attached
     - StyZo should answer with an AI title + description and a note describing
       the 2 photos it received.
   - Try pricing: *"What's the price in Barcelona on 15-17 Nov 2026?"*
   - Try booking: *"Confirm December 20-22"* then the same again for a conflict.

> **Sandbox limits to know**
> - Sandbox participants expire after 3 days — re-send the `join` code to renew.
> - Media URLs produced by the sandbox expire after a while; for this demo we
>   only count them, so that's fine.

### Production WhatsApp later

When you outgrow the sandbox, apply for a WhatsApp Business profile in the
Twilio Console and set `TWILIO_WHATSAPP_NUMBER` to that real number. Nothing
else in StyZo changes — the webhook format (Body/From/NumMedia/MediaUrl…) is
identical.

---

## Deploying to Render

Two equivalent options — pick one.

### Option A: Render Blueprint (recommended)

The repo includes `render.yaml`. If you already have a GitHub repo:

1. Push this folder to a new GitHub repository.
2. Go to [render.com](https://render.com) → **New → Blueprint** → connect the repo.
3. Render will prompt you for the `sync: false` variables (your Twilio & Gemini
   credentials). Fill them in and deploy.

### Option B: Manual Web Service

1. Push the code to a GitHub repo.
2. [render.com](https://render.com) → **New → Web Service** → connect the repo.
3. Settings:
   - **Runtime:** Node
   - **Build command:** `npm install`
   - **Start command:** `npm start`
4. Under **Environment**, add:
   - `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_NUMBER`, `GEMINI_API_KEY`
   - (optional) `GEMINI_MODEL`, `BASE_PRICE`, `WEEKEND_SURCHARGE`, `DEFAULT_CITY`
5. Deploy. Render gives you a URL like `https://styzo.onrender.com`.
6. Point your Twilio WhatsApp webhook at `https://styzo.onrender.com/webhook`
   (method: **HTTP POST**) — exactly like the ngrok step above.

> **Free-tier note:** Render's free service sleeps after inactivity; the first
> inbound message may take ~30s to wake it up. Your Twilio reply may be delayed
> until then. Upgrade to a paid plan or add a health-check ping if that matters.

### Deploying to Railway

Near-identical: new project → deploy from GitHub → set the same environment
variables → add the public URL as your Twilio webhook.

---

## Example messages

| You send | What you get back |
| --- | --- |
| _"Create a listing for a sunny 2-bed apartment in old town"_ (+ 2 photos) | AI draft: title + description + photo note |
| _"What's the price in Barcelona on 15-17 Nov 2026?"_ | Rule-based quote with weekend/event breakdown |
| _"Confirm December 20-22"_ | Booking confirmation (stored in memory) |
| _"Block January 5"_ | Date blocked |
| _"Confirm December 20-22"_ again | Conflict warning — dates already taken |

---

## Notes & scope

- **Photo analysis is out of scope**: attached photos are counted and mentioned,
  but not actually analysed.
- **Pricing is rule-based, not AI** (weekend + hardcoded event bumps).
- **Bookings are in-memory** — they do not survive a server restart.
- The webhook responds to Twilio with `HTTP 200` immediately, then sends the
  reply asynchronously, so slow AI calls never trigger Twilio retries.