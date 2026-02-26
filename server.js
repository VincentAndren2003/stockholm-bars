/**
 * Local dev server: serves static files and POST /api/bar-chat (OpenAI bar matching).
 * Run: node server.js   then open http://localhost:3000
 * Requires OPENAI_API_KEY in .env (or env).
 */

// Load .env if present (no extra deps)
try {
  const envPath = require('path').join(__dirname, '.env');
  const env = require('fs').readFileSync(envPath, 'utf8');
  env.split('\n').forEach((line) => {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  });
} catch (_) {}

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

function loadBars() {
  const p = path.join(__dirname, 'bars.json');
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

const mimeTypes = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
};

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  if (req.method === 'POST' && req.url === '/api/bar-chat') {
    if (!OPENAI_API_KEY) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'OPENAI_API_KEY not set in .env', barIds: [], reply: 'Server not configured.' }));
      return;
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    let parsed;
    try {
      parsed = JSON.parse(body || '{}');
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON' }));
      return;
    }
    const message = (parsed.message || '').trim();
    if (!message) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing "message"' }));
      return;
    }
    try {
      const bars = loadBars();
      const summary = buildBarSummary(bars);
      const result = await callOpenAI(OPENAI_API_KEY, summary, message);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(JSON.stringify(result));
    } catch (err) {
      console.error('bar-chat error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          error: err.message,
          barIds: [],
          reply: 'Something went wrong. Try again.',
        })
      );
    }
    return;
  }

  let filePath = path.join(__dirname, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!path.extname(filePath)) filePath = path.join(filePath, 'index.html');
  if (!path.resolve(filePath).startsWith(path.resolve(__dirname))) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(err.code === 'ENOENT' ? 404 : 500);
      res.end();
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Server at http://localhost:${PORT}`);
  if (!OPENAI_API_KEY) console.warn('OPENAI_API_KEY not set — AI bar search will fail until you add it to .env');
});
