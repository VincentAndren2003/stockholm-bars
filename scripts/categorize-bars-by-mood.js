#!/usr/bin/env node
/**
 * Categorizes each bar by mood/feeling (first date, third date, chill date, etc.)
 * by fetching Google Place reviews and using an LLM to assign categories.
 *
 * Usage:
 *   node scripts/categorize-bars-by-mood.js [bars.json]
 *
 * Requires in .env (or environment):
 *   GOOGLE_PLACES_API_KEY  – for fetching review snippets
 *   OPENAI_API_KEY         – for LLM classification
 *
 * Reads bars.json, fetches Place Details (with reviews) for each bar that has
 * place_id, then calls OpenAI to assign one or more moods per bar. Writes
 * back to bars.json with a "moods" array per bar.
 *
 * Mood categories: first_date, third_date, chill_date, party_night,
 * chill_hangout, group_friends, cheap_night_out
 */

const fs = require('fs');
const path = require('path');

const inputArg = process.argv[2];
const BARS_PATH = inputArg
  ? path.resolve(process.cwd(), inputArg)
  : path.resolve(__dirname, '../bars.json');

const MOODS = [
  'first_date',    // Good for a first date: not too loud, cozy, easy to talk
  'third_date',    // Romantic / more intimate, good for a later date
  'chill_date',    // Relaxed date vibe, low key
  'party_night',   // Dancing, loud, night out with friends
  'chill_hangout', // Casual hangout, not necessarily a date
  'group_friends', // Good for groups
  'cheap_night_out' // Budget-friendly
];

function getEnvKey(name) {
  if (process.env[name]) return process.env[name].trim();
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf8');
    for (const line of env.split(/\r?\n/)) {
      const trimmed = line.replace(/\s*#.*$/, '').trim();
      if (!trimmed.startsWith(name)) continue;
      const afterKey = trimmed.slice(name.length).replace(/^\s*=\s*/, '');
      let val = afterKey.trim().replace(/\s*;+\s*$/, '');
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
        val = val.slice(1, -1);
      if (val) return val.trim();
    }
  }
  return '';
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getPlaceDetailsWithReviews(apiKey, placeId) {
  const params = new URLSearchParams({
    place_id: placeId,
    fields: 'name,rating,user_ratings_total,reviews',
    key: apiKey,
    language: 'en',
  });
  const url = `https://maps.googleapis.com/maps/api/place/details/json?${params}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK') return null;
  const result = data.result || {};
  const reviews = (result.reviews || []).slice(0, 5).map((r) => (r.text || '').trim()).filter(Boolean);
  return {
    name: result.name || null,
    rating: result.rating != null ? Number(result.rating) : null,
    user_ratings_total: result.user_ratings_total != null ? Number(result.user_ratings_total) : null,
    reviews,
  };
}

async function classifyBarWithOpenAI(apiKey, barContext) {
  const systemPrompt = `You are a bar expert. Given information and reviews about a bar in Stockholm, assign one or more mood categories. 
Categories (use exactly these slugs, no others): ${MOODS.join(', ')}.
- first_date: good for a first date (not too loud, cozy, easy to talk)
- third_date: romantic, more intimate, good for a later date
- chill_date: relaxed date vibe, low key
- party_night: dancing, loud, night out
- chill_hangout: casual hangout, not necessarily a date
- group_friends: good for groups
- cheap_night_out: budget-friendly

Reply with ONLY a JSON array of slugs, e.g. ["chill_date","cheap_night_out"]. No explanation.`;

  const userPrompt = `Bar info and reviews:\n${barContext}\n\nReturn JSON array of mood slugs:`;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.3,
      max_tokens: 150,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI ${res.status}: ${err}`);
  }

  const data = await res.json();
  const content = (data.choices?.[0]?.message?.content || '').trim();
  const jsonMatch = content.match(/\[[\s\S]*?\]/);
  if (!jsonMatch) return [];
  try {
    const arr = JSON.parse(jsonMatch[0]);
    return Array.isArray(arr) ? arr.filter((m) => MOODS.includes(m)) : [];
  } catch (_) {
    return [];
  }
}

async function main() {
  const googleKey = getEnvKey('GOOGLE_PLACES_API_KEY');
  const openaiKey = getEnvKey('OPENAI_API_KEY');

  if (!googleKey) {
    console.error('Set GOOGLE_PLACES_API_KEY in .env (for Place reviews).');
    process.exit(1);
  }
  if (!openaiKey) {
    console.error('Set OPENAI_API_KEY in .env (for LLM classification).');
    process.exit(1);
  }

  if (!fs.existsSync(BARS_PATH)) {
    console.error('Bars file not found:', BARS_PATH);
    process.exit(1);
  }

  const bars = JSON.parse(fs.readFileSync(BARS_PATH, 'utf8'));
  const list = Array.isArray(bars) ? bars : (bars.bars || bars.data || []);
  console.log('Bars to categorize:', list.length);

  let done = 0;
  let failed = 0;

  for (let i = 0; i < list.length; i++) {
    const bar = list[i];
    const name = bar.bar_name || bar.name || bar.id || 'Unknown';
    const placeId = bar.place_id || null;

    let reviewsText = '';
    if (placeId) {
      try {
        const details = await getPlaceDetailsWithReviews(googleKey, placeId);
        await sleep(350);
        if (details && details.reviews && details.reviews.length > 0) {
          reviewsText = details.reviews.map((t) => t.slice(0, 400)).join('\n---\n');
        }
      } catch (e) {
        console.warn(`[${i + 1}/${list.length}] ${name}: Places error ${e.message}`);
      }
    }

    const price = bar.price != null ? bar.price : 'unknown';
    const rating = bar.rating != null ? bar.rating : 'unknown';
    const reviewCount = bar.review_count != null ? bar.review_count : bar.user_ratings_total;
    const dance = bar.dance_floor || 'unknown';
    const vibes = Array.isArray(bar.vibes) ? bar.vibes.join(', ') : (bar.vibes || '');

    const barContext = [
      `Name: ${name}`,
      `Price (cheapest beer SEK): ${price}`,
      `Rating: ${rating}`,
      `Review count: ${reviewCount}`,
      `Dance floor: ${dance}`,
      `Vibes: ${vibes}`,
      reviewsText ? `Reviews:\n${reviewsText}` : '(No review text)',
    ].join('\n');

    try {
      const moods = await classifyBarWithOpenAI(openaiKey, barContext);
      await sleep(300);
      bar.moods = moods.length ? moods : (bar.moods || []);
      done++;
    } catch (e) {
      console.warn(`[${i + 1}/${list.length}] ${name}: OpenAI error ${e.message}`);
      bar.moods = bar.moods || [];
      failed++;
    }

    if ((i + 1) % 10 === 0) {
      console.log(`Processed ${i + 1}/${list.length} | ok: ${done} | failed: ${failed}`);
    }
  }

  fs.writeFileSync(BARS_PATH, JSON.stringify(list, null, 2), 'utf8');
  console.log('Wrote', BARS_PATH);
  console.log('Done. Categorized:', done, '| Failed:', failed);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
