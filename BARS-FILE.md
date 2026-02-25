# Using a bars file instead of the database

If you put a file named **`bars.json`** in the same folder as `index.html` (project root), the map will **load bars from that file first** and ignore the database. That way you can:

1. **Paste all your bar data** into `bars.json`
2. **Use correct coordinates** – get lat/lng from Google Maps (right‑click on the building → “What’s here?” or copy from the URL), and paste them into each bar. No geocoding = no wrong positions.
3. **Edit everything in one place** – names, addresses, opening hours, price, dance floor, etc.

## Format of `bars.json`

Either a **JSON array** of bars:

```json
[
  {
    "bar_name": "Älgen",
    "location": "Götgatan 12, 118 46 Stockholm",
    "lat": 59.31724,
    "lng": 18.06861,
    "price": 85,
    "cheapest_beer_name": "Falcon",
    "opening_hours": "Mon–Thu 16–01, Fri–Sat 14–03",
    "website": "https://example.com",
    "dance_floor": "yes",
    "dance_notes": null
  }
]
```

Or an object with a `bars` (or `data`) array:

```json
{
  "bars": [
    { "bar_name": "...", "location": "...", "lat": 59.31, "lng": 18.06, ... }
  ]
}
```

## Field names

You can use any of these; the app accepts the first it finds:

| Data          | Accepted keys |
|---------------|----------------|
| Name          | `bar_name`, `name` |
| Address       | `location`, `address`, `full_address` |
| Coordinates   | `lat`, `latitude` and `lng`, `longitude` |
| Price         | `price`, `cheapest_beer_sek` |
| Beer name     | `cheapest_beer_name`, `beer_name` |
| Opening hours | `opening_hours`, `openingHours`, `hours` |
| Website       | `website`, `url` |
| Dance floor   | `dance_floor`, `danceFloor` (value: `yes` / `no` / or text) |
| Dance notes   | `dance_notes`, `danceNotes` |

## Getting correct lat/lng

1. Open **Google Maps**, find the bar’s building.
2. **Right‑click** on the building → **“What’s here?”**.
3. Copy the **latitude** and **longitude** from the small popup (e.g. `59.317240, 18.068610`).
4. In `bars.json`, set `"lat": 59.31724` and `"lng": 18.06861` (use at least 4–5 decimals).

Once `lat` and `lng` are in the file, the map uses them directly and does not geocode, so positions stay correct.

## Deploying with the file

- **Locally:** Put `bars.json` next to `index.html` and open the page (or use a local server).
- **GitHub Pages:** Add `bars.json` to the repo and push; the site will fetch it from the same origin.

If `bars.json` is missing or empty, the app falls back to loading from Supabase as before.
