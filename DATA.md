# Bar data and enrichment

The app uses **bars.json** for bar list, prices, opening hours, vibes, and (optionally) ratings and reviews.

## Adding more information (ratings, reviews, mood)

### Option 1: Google Places API (recommended)

Run the enrichment script to fetch **rating**, **review_count**, **photo**, and **place_id** from Google Places for each bar. The app uses these for:

- **Mood filtering**: Chill, Party, Dance, Date, Cheap, Top rated
- **Sidebar**: Shows star rating and review count when available

```bash
# Set your API key (Places API must be enabled in Google Cloud)
export GOOGLE_PLACES_API_KEY=your_key

# Enrich from existing bars.json (updates coordinates, adds rating/review_count/photo)
node scripts/update-bars-from-google-places.js bars.json
```

The script writes back to **bars.json**. It also derives **vibes** from dance_floor and rating (e.g. high-rated bars get "chill", "dating").

### Option 2: Scraper

If you prefer to scrape reviews or other sites:

1. **Output format**: Each bar in **bars.json** can include:
   - `rating` (number, e.g. 4.2)
   - `review_count` or `user_ratings_total` (number)
   - `vibes` (array of strings: `["chill","party","dating"]`)
   - `dance_floor` ("yes" / "no" / "unknown")
   - `dance_notes` (string)

2. **Mood filtering** uses:
   - `vibes` (from your data or from the script)
   - `dance_floor` and `dance_notes` for Dance/Party
   - `price` ≤ 50 for Cheap
   - `rating` ≥ 4 for Top rated

3. After scraping, merge the new fields into **bars.json** (same bar `id` or `bar_name`) and reload the app.

### Optional: AI / manual vibes

You can add or edit **vibes** per bar in bars.json (e.g. from reviews or manual tagging). Supported tags: `chill`, `party`, `dance`, `dating`, `girls-night`, `cheap`. The filter pills (Chill, Party, Dance, Date, Cheap, Top rated) use this data plus inferred tags from dance_floor and price.
