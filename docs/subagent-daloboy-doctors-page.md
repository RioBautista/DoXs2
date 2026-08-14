# DaloBoy sub-agent brief: iDoXs2 Doctors / TML page

Owner lane: DaloBoy
Coordinator: Nandy
Project: iDoXs2 / Doccsonline modernization
Repo: `DoXs2`

## Current architecture to follow

- `apps/web`: React + Vite + Tailwind frontend.
- `apps/api`: Node/Fastify API bridge.
- `packages/shared`: shared TypeScript response/data types.
- Sites such as `oxford.idoxs.app` and `wert.idoxs.app` serve the same frontend and infer client from hostname.
- Browser traffic must go through `/api/*`; never connect browser code directly to MSSQL.
- API authenticates via legacy/client DB and issues secure session cookie.
- MSSQL access is server-side only and scoped by client and user territories.
- Firestore is available as modern cache/config layer.

## First task: Doctors / Territory Master List page

Build the modern equivalent of the legacy Doccsonline Doctors page / TML browser.

Legacy behavior:

- Users browse their doctor master list / Territory Master List.
- Alphabetical list view.
- Basic search feature.
- User should only see doctors in territories within their scope.

## Product goal

Create a page usable by field users and managers without stressing client MSSQL. Treat the doctor/TML data as mostly read-only and cache-friendly.

## Recommended implementation shape

### Frontend

Add a new page/section in the React app:

- Navigation entry: `Doctors` or `TML`.
- Alphabet filter: `All`, `A-Z`, optionally `#` for non-alpha/blank names.
- Search box with debounce.
- Paginated/incremental loading, e.g. 50-100 rows per request.
- Clear loading/error/empty states.
- Row fields can start minimal:
  - doctor id / code
  - doctor name
  - specialty
  - territory id/name
  - class/frequency if available from legacy tables
  - clinic/address summary if safe and available

Do not load the full master list in one browser call for users with many territories.

### API

Add authenticated API endpoints under `/api/doctors`:

- `GET /api/doctors?letter=A&search=foo&cursor=...&limit=50`
- Optional: `GET /api/doctors/cache/status`

Endpoint requirements:

- Require existing session cookie.
- Resolve client from hostname/session, same pattern as dashboard/reports.
- Get user territories via existing `getClientUserTerritories()`.
- Enforce territory scope server-side.
- Cap `limit` to a safe maximum, e.g. 100.
- Validate query params and bind MSSQL parameters safely.
- Return cursor/page metadata for incremental loading.

### Caching strategy

Preferred: Firestore-backed cache with MSSQL fallback/refresh.

Cache key should include:

- clientSlug
- scope hash / territory set hash
- letter filter
- normalized search text hash
- page/cursor
- business rules/version

Cache metadata should include:

- generatedAt
- expiresAt
- source: firestore-cache | mssql-refresh | api-fallback
- territory list/hash
- row count/page size

TTL recommendation:

- Alphabetical/no-search pages: 6-24 hours.
- Search pages: 15-60 minutes, or avoid caching very short searches until 2-3 chars.

### MSSQL safety rules

- Never query without territory predicate unless user is explicitly global/admin and that behavior is confirmed.
- Reject or require minimum 2 chars for broad search if no letter is selected.
- Use `TOP (@limit)` or equivalent paging.
- Prefer indexed columns when discovered; inspect schema first before final SQL.
- Avoid `%term%` on large tables as the default path. Prefer prefix search (`term%`) where acceptable, or cache search indexes in Firestore later.
- Add short API timeout and logging around MSSQL calls.

## Expected deliverables

1. A short implementation plan after inspecting current app/API patterns.
2. Shared TypeScript types for doctor directory responses.
3. Fastify endpoint(s) with auth/client/territory enforcement.
4. React Doctors/TML page with alphabet filter, debounced search, and incremental loading.
5. Firestore cache helper or clear TODO seam if schema discovery blocks safe implementation.
6. Smoke test notes:
   - unauthenticated returns 401
   - wrong client/session mismatch returns 401
   - scoped user only gets scoped territories
   - large scope does not perform unbounded MSSQL query

## Files likely involved

- `apps/api/src/app.ts`
- new `apps/api/src/doctor-directory.ts`
- `apps/api/src/dashboard-cache.ts` as cache pattern reference
- `apps/web/src/api.ts`
- `apps/web/src/components/Dashboard.tsx`
- new frontend component such as `apps/web/src/components/DoctorsPage.tsx`
- `packages/shared/src/index.ts`

## Open questions / schema discovery

Before writing final SQL, inspect the Oxford/Wert legacy tables and columns. Likely tables/fields may include `DOCTOR`, `DOCTOR_CLINIC`, territory columns like `TERRITORY_ID`, and doctor columns like `MD_ID`, `LAST_NAME`, `FIRST_NAME`, `SPECIALTY_CODE`, `CLASS_CODE`, `FREQUENCY`. Confirm with read-only schema checks.

Keep all credentials server-side and never paste secrets into chat, code comments, or docs.
