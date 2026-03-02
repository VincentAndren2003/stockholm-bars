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

// Manual corrections for bars where we have strong local knowledge
// and want to enforce specific moods regardless of LLM noise.
const MANUAL_MOOD_OVERRIDES = {
  // Example: classic cozy date bar at Mariatorget
  'morfar-ginko': ['first_date', 'chill_date', 'chill_hangout', 'group_friends']
};

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
  const systemPrompt = `You are a Stockholm bar expert. Given structured information and real review snippets about a bar, assign one or more mood categories.

Categories (use exactly these slugs, no others): ${MOODS.join(', ')}.

Definitions (be strict and consistent):
- first_date: Excellent for a **first date**. Cozy, intimate or romantic. Easy to talk (not too loud), feels a bit special, often wine/cocktails or nicer atmosphere. If multiple reviews clearly mention "date night", "first date", "romantic", or similar, strongly prefer including first_date.
- third_date: Great for a **later date** once people know each other. Can be slightly more intimate, food- or wine-focused, or a bit more adventurous. Not mainly a cheap pre-party or loud student bar.
- chill_date: Relaxed date vibe: comfortable, cozy, not stressful. Good for a casual date, even if it is not fancy.
- party_night: Mainly for partying: loud, dancing, DJs, clubby, shots, big groups, pre-party/after-party, or strong "night out" energy.
- chill_hangout: Casual hangout or local bar for friends. Good to sit and talk or have a beer, but not especially focused on romance.
- group_friends: Specifically described as good for groups, big tables, after work, colleagues, birthdays, or large friend groups.
- cheap_night_out: Strongly budget-focused: cheap beers, student vibe, explicit mentions of low prices or bargains.

Important rules:
- Do NOT assign first_date or third_date to bars that are primarily loud, chaotic party spots unless reviews clearly describe them as nice for dates.
- If reviews strongly mention cozy/romantic/vibey date atmosphere, ALWAYS include at least one of first_date, third_date, or chill_date.
- Bars can have multiple moods. For example, a cozy wine bar that is also good for groups can be ["first_date","chill_hangout","group_friends"].
- If information is very weak or generic, fall back to chill_hangout or group_friends based on what fits best, but avoid overusing first_date.

Reply with ONLY a JSON array of slugs (no comments, no extra text), e.g. ["chill_date","cheap_night_out"].`;

  const userPrompt = `Bar info and reviews (Stockholm):

${barContext}

Return ONLY a JSON array of mood slugs from this list: ${MOODS.join(', ')}.`;

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

    const price = bar.price != null ? Number(bar.price) : null;
    const rating = bar.rating != null ? Number(bar.rating) : null;
    const reviewCount = bar.review_count != null ? bar.review_count : bar.user_ratings_total;
    const dance = bar.dance_floor || 'unknown';
    const vibesArr = Array.isArray(bar.vibes) ? bar.vibes : (bar.vibes ? String(bar.vibes).split(/[,;]/).map((v) => v.trim()).filter(Boolean) : []);
    const vibes = vibesArr.join(', ');
    const location = bar.correct_address || bar.location || '';

    // Simple heuristic hint for the LLM: candidate date bar if decent rating, moderate price, and no dance floor.
    const likelyDateHeuristic =
      (rating != null && rating >= 4.0) &&
      (price != null && price >= 60 && price <= 140) &&
      (dance === 'no');

    const barContext = [
      `Name: ${name}`,
      location ? `Location: ${location}` : null,
      `Price (cheapest beer SEK): ${price != null ? price : 'unknown'}`,
      `Rating: ${rating != null ? rating : 'unknown'}`,
      `Review count: ${reviewCount != null ? reviewCount : 'unknown'}`,
      `Dance floor: ${dance}`,
      `Vibes: ${vibes || 'none'}`,
      `Heuristic_likely_date_bar: ${likelyDateHeuristic ? 'yes' : 'no'}`,
      reviewsText ? `Reviews:\n${reviewsText}` : '(No review text)',
    ].filter(Boolean).join('\n');

    try {
      const llmMoods = await classifyBarWithOpenAI(openaiKey, barContext);
      await sleep(300);

      // Start from any existing moods to keep previous manual edits,
      // then merge in LLM output.
      const finalMoods = Array.isArray(bar.moods) ? bar.moods.slice() : [];
      for (const m of Array.isArray(llmMoods) ? llmMoods : []) {
        if (MOODS.includes(m) && !finalMoods.includes(m)) finalMoods.push(m);
      }

      const textBlob = [
        reviewsText || '',
        vibesArr.join(' '),
        location || '',
      ].join(' ').toLowerCase();

      const hasDateMood = finalMoods.some((m) =>
        m === 'first_date' || m === 'third_date' || m === 'chill_date'
      );

      // If reviews clearly talk about dates/romance but no date mood was assigned,
      // gently correct by adding a suitable date mood.
      const dateRegex = /(date night|first date|romantic|cozy|cosy|intimate|dejta|dejten|dejtnight|vinbar|wine bar|cocktail bar)/i;
      if (!hasDateMood && dateRegex.test(textBlob)) {
        if (rating != null && rating >= 4.0 && price != null && price >= 70) {
          if (!finalMoods.includes('first_date')) finalMoods.push('first_date');
        } else {
          if (!finalMoods.includes('chill_date')) finalMoods.push('chill_date');
        }
      }

      // Apply manual overrides for bars we strongly care about.
      const override = MANUAL_MOOD_OVERRIDES[bar.id];
      if (override && Array.isArray(override)) {
        for (const m of override) {
          if (MOODS.includes(m) && !finalMoods.includes(m)) finalMoods.push(m);
        }
      }

      bar.moods = finalMoods;
      done++;
    } catch (e) {
      console.warn(`[${i + 1}/${list.length}] ${name}: OpenAI error ${e.message}`);
      bar.moods = Array.isArray(bar.moods) ? bar.moods : [];
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
