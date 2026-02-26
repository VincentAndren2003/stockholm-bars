#!/usr/bin/env node
/**
 * Geocodes every bar's "location" with Mapbox and writes bars.json for the website.
 * Usage:
 *   node scripts/geocode-bars-from-csv.js [path-to-csv]
 *   node scripts/geocode-bars-from-csv.js data/source-bars.json
 * CSV path defaults to ../../Downloads/Newbars1_rows.csv. JSON = array of { bar_name, location, id, price, ... }.
 * Run once, then the site loads bars.json with no geocoding on load.
 */

const fs = require('fs');
const path = require('path');

const inputArg = process.argv[2];
const defaultCsv = path.resolve(__dirname, '../../Downloads/Newbars1_rows.csv');
const INPUT_PATH = inputArg ? path.resolve(process.cwd(), inputArg) : defaultCsv;
const OUT_PATH = path.resolve(__dirname, '../bars.json');
const ENV_CONFIG_PATH = path.resolve(__dirname, '../env-config.js');

function getToken() {
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const env = fs.readFileSync(envPath, 'utf8');
    const m = env.match(/MAPBOX_TOKEN\s*=\s*["']?([^"'\s]+)/);
    if (m) return m[1];
  }
  if (fs.existsSync(ENV_CONFIG_PATH)) {
    const content = fs.readFileSync(ENV_CONFIG_PATH, 'utf8');
    const m = content.match(/MAPBOX_TOKEN\s*=\s*["']([^"']+)["']/);
    if (m) return m[1];
  }
  return process.env.MAPBOX_TOKEN || '';
}

function addressKey(loc) {
  if (!loc || typeof loc !== 'string') return '';
  return loc.trim().replace(/\s+/g, ' ');
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
    header.forEach((h, j) => { row[h] = values[j] ?? ''; });
    rows.push(row);
  }
  return rows;
}

async function geocodePhoton(address, logFirst) {
  if (!address || !address.trim() || /^null$/i.test(address)) return null;
  const query = address.includes('Stockholm') ? address : address + ', Stockholm, Sweden';
  const params = new URLSearchParams({ q: query, limit: 1, lang: 'en' });
  const url = `https://photon.komoot.io/api/?${params}`;
  try {
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const text = await res.text();
    if (logFirst) console.log('Photon:', res.status, '| length:', text.length);
    const data = JSON.parse(text);
    const features = data.features;
    if (features && features.length > 0) {
      const coord = features[0].geometry?.coordinates;
      if (coord && coord.length >= 2) return [Number(coord[0]), Number(coord[1])];
    }
  } catch (e) { if (logFirst) console.error('Geocode error:', e.message); }
  return null;
}

async function main() {
  let rows = [];
  const isJson = INPUT_PATH.toLowerCase().endsWith('.json');
  if (isJson && fs.existsSync(INPUT_PATH)) {
    const data = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf8'));
    rows = Array.isArray(data) ? data : (data.bars || data.data || []);
    console.log('Rows from JSON:', rows.length);
  } else if (!isJson && fs.existsSync(INPUT_PATH)) {
    const csvText = fs.readFileSync(INPUT_PATH, 'utf8');
    rows = parseCSV(csvText);
    console.log('Rows from CSV:', rows.length);
  } else {
    console.error('Input not found:', INPUT_PATH);
    process.exit(1);
  }

  console.log('Geocoding with Photon (Komoot)...');
  const coordCache = new Map();
  const bars = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const location = (row.correct_address || row.location || row.address || '').trim().replace(/^"|"$/g, '');
    const barName = (row.bar_name || row.name || 'Unknown').replace(/^"|"$/g, '');
    let lat = row.lat != null ? parseFloat(String(row.lat).replace(',', '.')) : null;
    let lng = row.lng != null ? parseFloat(String(row.lng).replace(',', '.')) : null;

    if (location && location.length > 2 && !/^null$/i.test(location)) {
      const key = addressKey(location);
      if (!coordCache.has(key)) {
        const logFirst = coordCache.size === 0;
        const center = await geocodePhoton(location, logFirst);
        if (center) coordCache.set(key, { lng: center[0], lat: center[1] });
        await new Promise(r => setTimeout(r, 250));
      }
      const cached = coordCache.get(key);
      if (cached) { lng = cached.lng; lat = cached.lat; }
    }

    let opening_hours = row.opening_hours || null;
    if (opening_hours && typeof opening_hours === 'string' && (opening_hours.startsWith('{') || opening_hours.startsWith('"'))) {
      try { opening_hours = JSON.parse(opening_hours.replace(/^"|"$/g, '').replace(/""/g, '"')); } catch (_) {}
    }

    const correctAddr = (row.correct_address || '').trim().replace(/^"|"$/g, '') || null;
    const outAddress = correctAddr || (row.location || row.address || '').trim().replace(/^"|"$/g, '') || null;
    const barEntry = {
      id: row.id || barName.toLowerCase().replace(/\s+/g, '-'),
      bar_name: barName,
      location: outAddress || null,
      lat: lat,
      lng: lng,
      price: row.price != null ? parseInt(row.price, 10) : null,
      opening_hours: opening_hours,
      dance_floor: (row.dance_floor || 'unknown').toLowerCase(),
      dance_notes: row.dance_notes || null,
      last_updated: row.last_updated || null
    };
    if (correctAddr) barEntry.correct_address = correctAddr;
    bars.push(barEntry);
    if ((i + 1) % 15 === 0) console.log('Processed', i + 1, '/', rows.length, '| unique addresses geocoded:', coordCache.size);
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(bars, null, 2), 'utf8');
  console.log('Wrote', OUT_PATH, 'with', bars.length, 'bars');
  const withCoords = bars.filter(b => b.lat != null && b.lng != null);
  console.log('Bars with coordinates:', withCoords.length);
}

main().catch(e => { console.error(e); process.exit(1); });
