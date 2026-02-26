#!/usr/bin/env node
/** Extracts embedded bars from index.html and writes data/source-bars.json for the geocode script. */
const fs = require('fs');
const path = require('path');
const htmlPath = path.resolve(__dirname, '../index.html');
const outPath = path.resolve(__dirname, '../data/source-bars.json');
const html = fs.readFileSync(htmlPath, 'utf8');
const match = html.match(/<script\s+type="application\/json"\s+id="embedded-bars">([\s\S]*?)<\/script>/);
if (!match) {
  console.error('Could not find #embedded-bars in index.html');
  process.exit(1);
}
const json = match[1].trim();
const data = JSON.parse(json);
const dir = path.dirname(outPath);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(data, null, 2), 'utf8');
console.log('Wrote', outPath, 'with', data.length, 'bars');
process.exit(0);
