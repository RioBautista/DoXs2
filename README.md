# DOXS Modern

Modern TypeScript rewrite scaffold for the production UI.

- `apps/web` — React + Vite + Tailwind UI, deployable via Firebase Hosting.
- `apps/api` — Node.js/Fastify API bridge for auth and production database/API integration.

## Local development

```bash
npm install
npm run dev
```

Web: http://localhost:5173
API: http://localhost:8080

## Auth notes

The first login screen mirrors the production pattern at a safe level: username + password submitted to a backend bridge. Local development uses `DEV_LOGIN_MOCK=true` by default. Real production auth should be connected through `apps/api/src/auth.ts` after confirming the existing login endpoint/session behavior.
