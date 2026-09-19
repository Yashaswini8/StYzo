// TWI_LIO outbound: send the assistant's reply back to the host's WhatsApp
// number using the Twilio Messages API. All credentials come from config.
const twilio = require('twilio');
const { twilio: twilioConfig } = require('./config');

let client;

function ensureNumber(n) {
  return n.startsWith('whatsapp:') ? n : `whatsapp:${n}`;
}

function sendWhatsApp(to, body) {
  const { accountSid, authToken, whatsappNumber } = twilioConfig;
  if (!accountSid || !authToken || !whatsappNumber) {
    const error = new Error(
      'Twilio is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN ' +
        'and TWILIO_WHATSAPP_NUMBER in .env (or the Render dashboard).',
    );
    return Promise.reject(error);
  }

  if (!client) {
    client = twilio(accountSid, authToken);
  }

  return client.messages.create({
    from: ensureNumber(whatsappNumber),
    to: ensureNumber(to),
    body,
  });
}

module.exports = { sendWhatsApp };