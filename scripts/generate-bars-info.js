#!/usr/bin/env node
/**
 * Reads bars.json and writes bars-info.csv for double-checking addresses and info.
 * Edit bars-info.csv in Excel/Sheets, then run: node scripts/geocode-bars-from-csv.js bars-info.csv
 * to regenerate bars.json with corrected/geocoded data.
 */

const fs = require('fs');
const path = require('path');

const BARS_JSON = path.resolve(__dirname, '../bars.json');
const OUT_CSV = path.resolve(__dirname, '../bars-info.csv');

function escapeCsv(val) {
  if (val == null) return '';
  const s = String(val).trim();
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

const bars = JSON.parse(fs.readFileSync(BARS_JSON, 'utf8'));
const header = ['id', 'bar_name', 'address', 'correct_address', 'lat', 'lng', 'price', 'opening_hours', 'dance_floor', 'dance_notes', 'last_updated'];
const rows = bars.map(b => [
  escapeCsv(b.id),
  escapeCsv(b.bar_name),
  escapeCsv(b.location || b.address),
  escapeCsv(b.correct_address || ''),
  escapeCsv(b.lat),
  escapeCsv(b.lng),
  escapeCsv(b.price),
  escapeCsv(typeof b.opening_hours === 'string' ? b.opening_hours : (b.opening_hours ? JSON.stringify(b.opening_hours) : '')),
  escapeCsv(b.dance_floor),
  escapeCsv(b.dance_notes),
  escapeCsv(b.last_updated)
]);
const csv = [header.join(','), ...rows.map(r => r.join(','))].join('\n');
fs.writeFileSync(OUT_CSV, '\uFEFF' + csv, 'utf8'); // BOM for Excel
console.log('Wrote', OUT_CSV, 'with', bars.length, 'bars');
process.exit(0);
