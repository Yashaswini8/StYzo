// StyZo entry point — a single Express app exposing the WhatsApp webhook, the
// public landing page, and the interactive demo (styzo-prototype.html).
// POST /webhook -> Meta WhatsApp Cloud API webhook
// GET  /landing -> public landing page (What is StyZo / Chat / Try Live Demo)
// GET  /demo    -> interactive demo prototype
// GET  /        -> public landing page
// GET  /health  -> health check
require('dotenv').config();
const path = require('path');
const express = require('express');
const { port } = require('./config');
const { handleMetaIncoming } = require('./meta');

const app = express();

// Meta posts the incoming message as application/json.
app.use(express.json());

// Lightweight access log for the webhook so we can confirm verification
// handshakes and message deliveries actually reach us.
app.use((req, res, next) => {
  if (req.path === '/webhook') {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  }
  next();
});

app.get('/health', (_req, res) => {
  res.json({ service: 'StyZo', status: 'ok', webhook: '/webhook', demo: '/demo', landing: '/landing' });
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'landing.html'));
});

// ---- WhatsApp webhook (Meta Cloud API JSON) ----
app.post('/webhook', (req, res) => {
  handleMetaIncoming(req, res);
});

// ---- Meta WhatsApp Cloud API webhook verification handshake ----
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === 'hackathon2026verify') {
    res.status(200).send(challenge);
  } else {
    res.status(403).send('Forbidden');
  }
});

// ---- Public landing page ----
app.get('/landing', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'landing.html'));
});

// ---- Interactive demo (styzo-prototype.html, provided by the team) ----
app.get('/demo', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'styzo-prototype.html'));
});

// Only start listening when this file is run directly (e.g. `npm start`),
// so the app can be imported by tests without binding a port.
if (require.main === module) {
  app.listen(port, () => {
    console.log(`StyZo is running on http://localhost:${port}`);
    console.log('Webhook endpoint: POST /webhook');
  });
}

module.exports = app;