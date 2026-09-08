# Meal Planner — Cloudflare Worker + Static Assets

Repository layout:

- `public/index.html` — Meal Planner UI (public static asset)
- `src/worker.js` — Cloudflare Worker API code (server-side; not public)
- `wrangler.jsonc` — explicit Cloudflare deployment configuration
- `google-apps-script/Code.gs` — backup of the Google Apps Script backend; not deployed as a static asset

Cloudflare deployment command: `npx wrangler deploy`

Required Cloudflare Worker variables/secrets:

- `APPS_SCRIPT_URL` = canonical Apps Script URL ending `/macros/s/.../exec`
- `HOUSEHOLD_KEY` = same household key stored in the Sheet

After deployment, test:

`https://YOUR-WORKER-DOMAIN/api/health`

Expected response has `ok: true`, `appsScriptConfigured: true`, and `householdKeyConfigured: true`.
