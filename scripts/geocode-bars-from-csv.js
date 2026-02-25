#!/usr/bin/env node
/**
 * Reads Newbars1_rows.csv, geocodes each bar's "location" with Mapbox,
 * writes bars.json with correct lat/lng for the website.
 * Usage: node scripts/geocode-bars-from-csv.js [path-to-csv]
 * CSV path defaults to ../Downloads/Newbars1_rows.csv or same folder as script.
 */

const fs = require('fs');
const path = require('path');

const CSV_PATH = path.resolve(__dirname, process.argv[2] || '../../Downloads/Newbars1_rows.csv');
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

async function geocode(address, token) {
  if (!address || !token || address === 'null') return null;
  const query = encodeURIComponent(address.includes('Stockholm') ? address : address + ', Stockholm, Sweden');
  const bbox = '17.95,59.28,18.15,59.36';
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${token}&country=se&types=address,place,poi&limit=1&bbox=${bbox}&proximity=18.0686,59.3172`;
  try {
    const res = await fetch(url);
    const data = await res.json();
    if (data.features && data.features.length > 0) return data.features[0].center;
  } catch (e) {}
  return null;
}

async function main() {
  const token = getToken();
  if (!token) {
    console.error('No MAPBOX_TOKEN in env-config.js or .env');
    process.exit(1);
  }

  if (!fs.existsSync(CSV_PATH)) {
    console.error('CSV not found:', CSV_PATH);
    process.exit(1);
  }

  const csvText = fs.readFileSync(CSV_PATH, 'utf8');
  const rows = parseCSV(csvText);
  console.log('Rows from CSV:', rows.length);

  const bars = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const location = (row.location || '').trim().replace(/^"|"$/g, '');
    const barName = (row.bar_name || row.name || 'Unknown').replace(/^"|"$/g, '');
    let lat = row.lat ? parseFloat(String(row.lat).replace(',', '.')) : null;
    let lng = row.lng ? parseFloat(String(row.lng).replace(',', '.')) : null;

    if (location && (!lat || !lng || (lat === 59.31667 && lng === 18.06745))) {
      const center = await geocode(location, token);
      if (center) {
        lng = center[0];
        lat = center[1];
      }
      await new Promise(r => setTimeout(r, 120));
    }

    let opening_hours = row.opening_hours || null;
    if (opening_hours && typeof opening_hours === 'string' && (opening_hours.startsWith('{') || opening_hours.startsWith('"'))) {
      try { opening_hours = JSON.parse(opening_hours.replace(/^"|"$/g, '').replace(/""/g, '"')); } catch (_) {}
    }

    bars.push({
      id: row.id || barName.toLowerCase().replace(/\s+/g, '-'),
      bar_name: barName,
      location: location || null,
      lat: lat,
      lng: lng,
      price: row.price ? parseInt(row.price, 10) : null,
      opening_hours: opening_hours,
      dance_floor: (row.dance_floor || 'unknown').toLowerCase(),
      dance_notes: row.dance_notes || null,
      last_updated: row.last_updated || null
    });
    if ((i + 1) % 10 === 0) console.log('Geocoded', i + 1, '/', rows.length);
  }

  fs.writeFileSync(OUT_PATH, JSON.stringify(bars, null, 2), 'utf8');
  console.log('Wrote', OUT_PATH, 'with', bars.length, 'bars');
  const withCoords = bars.filter(b => b.lat != null && b.lng != null);
  console.log('Bars with coordinates:', withCoords.length);
}

main().catch(e => { console.error(e); process.exit(1); });
