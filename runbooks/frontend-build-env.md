# Frontend build environment

## Mapbox

The dashboard call map requires `VITE_MAPBOX_ACCESS_TOKEN` at Vite build time.

Canonical stored copy:

- Firebase Secret Manager secret: `VITE_MAPBOX_ACCESS_TOKEN`
- Project: `doxs2-e3d72`

For local/dev deploys, export it before building Hosting:

```bash
export VITE_MAPBOX_ACCESS_TOKEN="$(firebase functions:secrets:access VITE_MAPBOX_ACCESS_TOKEN --project doxs2-e3d72)"
npm run build -w @doxs/web
firebase deploy --only hosting:doccs-as --project doxs2-e3d72
```

Do not commit the token into `.env`, docs, or source files.
