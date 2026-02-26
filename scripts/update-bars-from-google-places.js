#!/usr/bin/env node
/**
 * Looks up each bar by name with Google Places API (Find Place from Text),
 * biased to Södermalm, and updates address + coordinates.
 *
 * Usage:
 *   GOOGLE_PLACES_API_KEY=your_key node scripts/update-bars-from-google-places.js [bars-info.csv|bars.json]
 *
 * Reads bars from bars-info.csv or bars.json. For each bar, calls Places API with
 * "{bar_name}, Södermalm, Stockholm" and locationbias to Södermalm. Uses the first
 * candidate's formatted_address and geometry. Writes bars.json; optionally
 * writes bars-info-updated.csv with correct_address filled.
 *
 * Requires: Google Cloud project with Places API (Legacy) enabled and an API key.
 * Billing must be enabled; Find Place has a free tier. Add GOOGLE_PLACES_API_KEY
 * to .env or set the env var.
 */

const fs = require('fs');
const path = require('path');

const inputArg = process.argv[2];
const INPUT_PATH = inputArg
  ? path.resolve(process.cwd(), inputArg)
  : path.resolve(__dirname, '../bars-info.csv');
const OUT_JSON = path.resolve(__dirname, '../bars.json');
const OUT_CSV = path.resolve(__dirname, '../bars-info-updated.csv');

// Södermalm center (approx), radius 2.5 km
const SODERMALM_LAT = 59.317;
const SODERMALM_LNG = 18.07;
const SODERMALM_RADIUS_M = 2500;

function getApiKey() {
  if (process.env.GOOGLE_PLACES_API_KEY) return process.env.GOOGLE_PLACES_API_KEY.trim();
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf8');
    for (const line of env.split(/\r?\n/)) {
      const trimmed = line.replace(/^\s+|\s*;+\s*$/g, '').trim();
      if (trimmed.startsWith('GOOGLE_PLACES_API_KEY')) {
        const eq = trimmed.indexOf('=');
        if (eq === -1) continue;
        let val = trimmed.slice(eq + 1).trim().replace(/\s*;+\s*$/, '');
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
          val = val.slice(1, -1);
        if (val) return val.trim();
      }
    }
  }
  return '';
}

function parseCSVLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      inQuotes = !inQuotes;
    } else if ((c === ',' && !inQuotes) || (c === '\n' && !inQuotes)) {
      out.push(cur.trim());
      cur = '';
      if (c === '\n') break;
    } else {
      cur += c;
    }
  }
  if (cur.length) out.push(cur.trim());
  return out;
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const header = parseCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const row = {};
    header.forEach((h, j) => {
      row[h] = values[j] ?? '';
    });
    rows.push(row);
  }
  return rows;
}

async function findPlaceFromText(apiKey, query) {
  const params = new URLSearchParams({
    input: query,
    inputtype: 'textquery',
    fields: 'formatted_address,name,geometry,place_id',
    locationbias: `circle:${SODERMALM_RADIUS_M}@${SODERMALM_LAT},${SODERMALM_LNG}`,
    key: apiKey,
    language: 'sv',
  });
  const url = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?${params}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    const msg = data.error_message || data.status || 'Places API error';
    if (msg.toLowerCase().includes('invalid') && msg.toLowerCase().includes('api key')) {
      const err = new Error(msg);
      err.code = 'INVALID_API_KEY';
      throw err;
    }
    throw new Error(msg);
  }
  const candidates = data.candidates || [];
  if (candidates.length === 0) return null;
  const c = candidates[0];
  const loc = c.geometry?.location;
  return {
    formatted_address: c.formatted_address || null,
    name: c.name || null,
    lat: loc?.lat != null ? Number(loc.lat) : null,
    lng: loc?.lng != null ? Number(loc.lng) : null,
    place_id: c.place_id || null,
  };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getPlaceDetails(apiKey, placeId) {
  const params = new URLSearchParams({
    place_id: placeId,
    fields: 'photos,rating',
    key: apiKey,
    language: 'en',
  });
  const url = `https://maps.googleapis.com/maps/api/place/details/json?${params}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== 'OK') return null;
  const result = data.result || {};
  const photoRef = result.photos?.[0]?.photo_reference || null;
  const rating = result.rating != null ? Number(result.rating) : null;
  return { photo_reference: photoRef, rating };
}

function deriveVibes(row, rating) {
  const vibes = [];
  const dance = String(row.dance_floor || '').toLowerCase();
  if (dance === 'yes') {
    vibes.push('party', 'girls-night');
  }
  if (rating != null && rating >= 4.2) {
    vibes.push('dating', 'chill');
  }
  if (vibes.length === 0) vibes.push('chill');
  return [...new Set(vibes)];
}

async function main() {
  const apiKey = getApiKey();
  if (!apiKey) {
    console.error('Set GOOGLE_PLACES_API_KEY in .env or environment.');
    process.exit(1);
  }

  let rows = [];
  const isJson = INPUT_PATH.toLowerCase().endsWith('.json');
  if (isJson && fs.existsSync(INPUT_PATH)) {
    const data = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf8'));
    rows = Array.isArray(data) ? data : (data.bars || data.data || []);
    console.log('Rows from JSON:', rows.length);
  } else if (!isJson && fs.existsSync(INPUT_PATH)) {
    rows = parseCSV(fs.readFileSync(INPUT_PATH, 'utf8'));
    console.log('Rows from CSV:', rows.length);
  } else {
    console.error('Input not found:', INPUT_PATH);
    process.exit(1);
  }

  console.log('Looking up bars with Google Places API (Södermalm bias)...');
  const bars = [];
  let updated = 0;
  let failed = 0;
  let invalidKeyReported = false;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const barName = (row.bar_name || row.name || 'Unknown').replace(/^"|"$/g, '');
    const query = `${barName}, Södermalm, Stockholm`;
    let place = null;
    try {
      place = await findPlaceFromText(apiKey, query);
      await sleep(350);
    } catch (e) {
      if (e.code === 'INVALID_API_KEY' && !invalidKeyReported) {
        console.error('Google Places API key is invalid or Places API is not enabled. Check Google Cloud Console.');
        invalidKeyReported = true;
      }
      console.error(`[${i + 1}/${rows.length}] ${barName}: ${e.message}`);
      failed++;
    }

    const correctAddr = (row.correct_address || '').trim().replace(/^"|"$/g, '') || null;
    const outAddress = correctAddr || (row.address || row.location || '').trim().replace(/^"|"$/g, '') || null;
    let lat = row.lat != null ? parseFloat(String(row.lat).replace(',', '.')) : null;
    let lng = row.lng != null ? parseFloat(String(row.lng).replace(',', '.')) : null;

    if (place?.formatted_address && place.lat != null && place.lng != null) {
      lat = place.lat;
      lng = place.lng;
      if (!correctAddr || correctAddr !== place.formatted_address) updated++;
    }
    const finalAddress = (place?.formatted_address || correctAddr || outAddress || '').trim() || null;

    let photo_reference = null;
    let placeRating = null;
    if (place?.place_id) {
      try {
        const details = await getPlaceDetails(apiKey, place.place_id);
        await sleep(200);
        if (details) {
          photo_reference = details.photo_reference || null;
          placeRating = details.rating;
        }
      } catch (_) {}
    }

    let opening_hours = row.opening_hours || null;
    if (opening_hours && typeof opening_hours === 'string' && (opening_hours.startsWith('{') || opening_hours.startsWith('"'))) {
      try {
        opening_hours = JSON.parse(opening_hours.replace(/^"|"$/g, '').replace(/""/g, '"'));
      } catch (_) {}
    }

    const barEntry = {
      id: row.id || barName.toLowerCase().replace(/\s+/g, '-'),
      bar_name: barName,
      location: finalAddress || outAddress || null,
      lat,
      lng,
      price: row.price != null ? parseInt(row.price, 10) : null,
      opening_hours,
      dance_floor: (row.dance_floor || 'unknown').toLowerCase(),
      dance_notes: row.dance_notes || null,
      last_updated: row.last_updated || null,
      place_id: place?.place_id || null,
      photo_reference: photo_reference || null,
      vibes: deriveVibes(row, placeRating),
    };
    if (place?.formatted_address) barEntry.correct_address = place.formatted_address;
    bars.push(barEntry);

    if ((i + 1) % 20 === 0) {
      console.log(`Processed ${i + 1}/${rows.length} | updated so far: ${updated}`);
    }
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify(bars, null, 2), 'utf8');
  console.log('Wrote', OUT_JSON, 'with', bars.length, 'bars');
  const withCoords = bars.filter((b) => b.lat != null && b.lng != null);
  console.log('Bars with coordinates:', withCoords.length, '| addresses updated from Places:', updated, '| failed lookups:', failed);

  // Optional: write CSV with correct_address for bars we got from Places
  const csvHeader = 'id,bar_name,address,correct_address,lat,lng,price,opening_hours,dance_floor,dance_notes,last_updated';
  const csvRows = bars.map((b) => {
    const escape = (v) => (v == null ? '' : String(v).includes(',') || String(v).includes('"') ? `"${String(v).replace(/"/g, '""')}"` : v);
    return [b.id, b.bar_name, b.location || '', (b.correct_address || ''), b.lat ?? '', b.lng ?? '', b.price ?? '', b.opening_hours ?? '', b.dance_floor ?? '', b.dance_notes ?? '', b.last_updated ?? ''].map(escape).join(',');
  });
  fs.writeFileSync(OUT_CSV, [csvHeader, ...csvRows].join('\n'), 'utf8');
  console.log('Wrote', OUT_CSV, '(use as bars-info.csv after review).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
