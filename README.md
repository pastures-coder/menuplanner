# Meal Planner — robust live hosting

## Architecture
GitHub repo → Cloudflare Pages → `/api/state` Pages Function → Google Apps Script → Google Sheet.

The browser never talks to Google directly, so multiple Google accounts, `/u/N/` routing, JSONP, iframe, CORS and browser third-party blocking no longer affect sync.

## Files
- `index.html` — Meal Planner UI
- `functions/api/state.js` — same-origin Cloudflare proxy
- `google-apps-script/Code.gs` — Google Sheet backend

## Cloudflare variables/secrets
In the Cloudflare Pages project add:
- `APPS_SCRIPT_URL` = canonical Apps Script deployment URL, `https://script.google.com/macros/s/.../exec`
- `HOUSEHOLD_KEY` = the value in the Google Sheet Settings tab

## Apps Script
Deploy `Code.gs` as a web app:
- Execute as: Me
- Who has access: Anyone
Use the canonical `/exec` URL as the Cloudflare `APPS_SCRIPT_URL` secret.

## Front-end login
On each phone/computer, open Settings in Meal Planner and enter the same household key once. It is stored only in that browser.
