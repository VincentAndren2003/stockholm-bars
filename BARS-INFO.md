# Bars info – double-check addresses and data

**All bars are supposed to be on Södermalm, Stockholm.** The addresses in the original database have **not** been looked up online for each bar. Spot checks show errors:

- **Älgen Bar** – Database had "Hornsgatan 66". Correct address: **Långholmsgatan 42, 117 33 Stockholm** (Södermalm).
- **Kvarnen** – "Tjärhovsgatan 4" is correct (Södermalm).
- Many bars were given the same placeholder (e.g. "Hornsgatan 66") although only a couple of venues are at that address in reality.

So you should verify addresses (e.g. Google Maps or “\[bar name\] Stockholm Södermalm”) and put the **verified address** in the **correct_address** column.

**Optional: Google Places API** – You can use the Google Places API to look up each bar by name and get verified addresses and coordinates (biased to Södermalm). Add `GOOGLE_PLACES_API_KEY` to `.env`, then run:

```bash
node scripts/update-bars-from-google-places.js bars-info.csv
```

This writes **bars.json** and **bars-info-updated.csv**. Review the CSV, then replace `bars-info.csv` if you're happy. You need a Google Cloud project with Places API (Legacy) enabled and billing; Find Place has a free tier.

---

**bars-info.csv** columns:

| Column           | What it is |
|------------------|------------|
| id               | Bar slug (used in the app) |
| bar_name         | Display name |
| address          | Current address in the data (may be wrong) |
| **correct_address** | **Fill in the real address after checking online. Geocoding uses this if present.** |
| lat, lng         | Coordinates (updated when you re-run geocode) |
| price            | Cheapest beer (SEK) |
| opening_hours    | Hours text or JSON |
| dance_floor      | yes / no / unknown |
| dance_notes      | Optional notes |
| last_updated     | When the row was last updated |

## How to use

1. **Open `bars-info.csv`** in Excel or Google Sheets.
2. **Look up each bar** (e.g. search “\[bar name\] Stockholm address” or use Google Maps). All bars should be on **Södermalm**.
3. **Put the verified address** in the **correct_address** column (leave empty if you haven’t checked yet). Use format like: `Street name number, postcode Stockholm` or `Street, Södermalm, Stockholm`.
4. **Save the CSV** (same columns and header).
5. **Regenerate the map data:**
   ```bash
   node scripts/geocode-bars-from-csv.js bars-info.csv
   ```
   This uses **correct_address** when present, otherwise **address**, geocodes in Stockholm, and writes **bars.json**.
6. **Commit and push** `bars.json` (and optionally `bars-info.csv`) so GitHub Pages uses the updated data.

## Regenerating the CSV from bars.json

To refresh the CSV from the current bars (e.g. after editing JSON):

```bash
node scripts/generate-bars-info.js
```

This overwrites **bars-info.csv** with the current **bars.json**. Any **correct_address** you added in the CSV is saved into bars.json when you run the geocode script, so the next time you run the generator it will show those corrected addresses again.
