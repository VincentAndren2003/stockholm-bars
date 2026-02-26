/**
 * Vercel serverless function: match user query to Stockholm bars using OpenAI.
 * Set OPENAI_API_KEY in Vercel env. POST body: { "message": "date vibe" }
 * Returns: { "barIds": ["id1", "id2"], "reply": "Short message" }
 */

const fs = require('fs');
const path = require('path');

function loadBars() {
  const p = path.join(__dirname, '..', 'bars.json');
  const raw = fs.readFileSync(p, 'utf8');
  const data = JSON.parse(raw);
  return Array.isArray(data) ? data : (data.bars || data.data || []);
}

function buildBarSummary(bars) {
  return bars.map((b) => {
    const name = b.bar_name || b.name || 'Unknown';
    const id = b.id || name.toLowerCase().replace(/\s+/g, '-');
    const vibes = Array.isArray(b.vibes) ? b.vibes.join(', ') : (b.vibes || '');
    const dance = b.dance_floor || 'unknown';
    const danceNotes = b.dance_notes || '';
    const price = b.price != null ? `${b.price} kr` : 'unknown';
    const hours = typeof b.opening_hours === 'string' ? b.opening_hours : (b.opening_hours ? JSON.stringify(b.opening_hours) : '');
    return { id, name, vibes, dance, danceNotes, price, hours };
  });
}

async function callOpenAI(apiKey, barSummary, userMessage) {
  const barListText = barSummary
    .map(
      (b) =>
        `- id: "${b.id}" | name: "${b.name}" | vibes: ${b.vibes || 'none'} | dance_floor: ${b.dance} ${b.danceNotes ? '| ' + b.danceNotes : ''} | beer: ${b.price} | hours: ${b.hours || 'unknown'}`
    )
    .join('\n');

  const systemPrompt = `You are a helpful assistant for a Stockholm bar map. You ONLY recommend bars from the list below. Match the user's request to bar ids by vibe, type (gay bar, dance, date, chill, party, girls night), price, or name. Return a JSON object with exactly two keys: "barIds" (array of bar ids from the list that match) and "reply" (one short friendly sentence in English, e.g. "Here are 3 places that match."). If nothing matches well, return a few closest matches anyway. Use only the "id" values from the list.`;

  const userPrompt = `Bar list:\n${barListText}\n\nUser request: ${userMessage}\n\nRespond with JSON only: {"barIds": ["id1", "id2"], "reply": "Your short message"}`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 500,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content?.trim() || '';
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in OpenAI response');
  const parsed = JSON.parse(jsonMatch[0]);
  const barIds = Array.isArray(parsed.barIds) ? parsed.barIds : [];
  const reply = typeof parsed.reply === 'string' ? parsed.reply : 'Here are some matches.';
  return { barIds, reply };
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'OPENAI_API_KEY not configured' });
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {};
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  const message = (body.message || '').trim();
  if (!message) {
    return res.status(400).json({ error: 'Missing "message" in body' });
  }

  try {
    const bars = loadBars();
    const summary = buildBarSummary(bars);
    const result = await callOpenAI(apiKey, summary, message);
    return res.status(200).json(result);
  } catch (err) {
    console.error('bar-chat error:', err);
    return res.status(500).json({
      error: err.message || 'Server error',
      barIds: [],
      reply: 'Something went wrong. Try again.',
    });
  }
};
