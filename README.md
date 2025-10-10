Rwanda Climate Resilience Dashboard (static frontend)

Overview
- Static HTML/JS/CSS frontend intended for GitHub Pages.
- Uses Supabase for storage (tables expected: `district_baselines`, `district_updates`, `district_alerts`).
- Fetches real-time data from Open-Meteo and runs simple anomaly detection.

Files
- `index.html` — main page
- `assets/style.css` — styles
- `assets/config.js` — configuration: fill Supabase URL/key and thresholds
- `assets/main.js` — app logic: fetch, compare, store, UI
- `data/districts_sample.json` — small sample of districts (replace with GeoJSON)

Setup
1. Create a Supabase project and add tables with minimal columns:
   - district_baselines: id(pk), name, latitude, longitude, avg_rainfall, avg_temperature
   - district_updates: id(pk), district_id(fk), timestamp, rainfall, temperature, humidity, windspeed
   - district_alerts: id(pk), district_id(fk), timestamp, severity, details

2. Open `assets/config.js` and set `SUPABASE_URL` and `SUPABASE_ANON_KEY`.

3. Deploy to GitHub Pages by pushing this folder to a repo and enabling Pages.

Notes & next steps
- Add authentication for secure insertions.
- Expand detection logic (drought indices, rolling windows).
- Implement server-side scheduled worker (e.g., Supabase Edge Function or GitHub Action) to run polling instead of client-side.
- Add notification integration (Twilio, WhatsApp API, SendGrid).

