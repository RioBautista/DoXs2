# DoXs2 System Documentation

Readable architecture and operating notes for the current DoXs2 / iDoXs modernization stack.

## Executive summary

DoXs2 is the modern replacement layer for the legacy iDoXs / Doccsonline web experience.

The goal is not to connect the browser directly to old databases. Instead, DoXs2 introduces a safer architecture:

- modern React frontend
- authenticated API bridge
- client-aware routing by subdomain
- server-side MSSQL access
- territory-scoped data enforcement
- Firestore as a modern cache/config/documentation layer
- report definitions and mostly read-only reference data gradually moved into structured Firestore documents

This gives the team a path to modernize iDoXs features without immediately replacing every legacy database or business rule.

## Current deployed client model

The same DoXs2 web app can serve multiple client subdomains.

Current examples:

- `oxford.idoxs.app`
- `wert.idoxs.app`

Each hostname identifies the client context. The frontend and API use that context to resolve which client configuration, database, permissions, and scope should apply.

## High-level request flow

```text
User browser
  -> Firebase Hosting client subdomain
  -> React web app
  -> /api/* request
  -> Firebase Hosting rewrite / Google Cloud API service
  -> Node.js Fastify API
  -> session/client/territory validation
  -> Firestore cache/config lookup where available
  -> legacy MSSQL read-only query when needed
  -> normalized API response
  -> React UI
```

The browser never connects directly to MSSQL.

## Repository layout

```text
apps/web        React + Vite + Tailwind frontend
apps/api        Node.js/Fastify API bridge
packages/shared Shared TypeScript types
docs            Human-readable system documentation, feature briefs, and architecture notes
runbooks        Deployment and operator procedures
seeds           Example Firestore documents and seed data
```

## Frontend / Web UI

Technology:

- React
- Vite
- Tailwind CSS
- TypeScript
- Firebase Hosting

Current behavior:

- Protected app redirects unauthenticated users to `/login`.
- Client context is inferred from hostname, e.g. `oxford.idoxs.app` means client `oxford`.
- Browser requests go to `/api/*` only.
- Current main page is the dashboard.
- Planned pages include Reports and Doctors / Territory Master List.

Important frontend rule:

Do not put database credentials, Firebase Admin credentials, service account data, or legacy server credentials in browser code.

## API layer

Technology:

- Node.js
- Fastify
- TypeScript
- Cloud Run / Google Cloud deployment style
- Firebase Hosting rewrites for `/api/*`

Primary responsibilities:

- authenticate users
- issue and validate secure session cookies
- resolve client context from hostname/session
- protect against client/session mismatch
- resolve user territory scope
- run safe server-side data access
- read/write Firestore cache documents
- validate and execute report definitions
- expose normalized JSON responses to the frontend

Current implemented API areas:

- `/api/health`
- auth login/logout/session endpoints
- dashboard summary endpoint
- report definition listing and execution endpoints
- debug endpoints for development and schema/connection checks

## Authentication

Users log in through the DoXs2 API.

Flow:

1. User enters production-style credentials in the frontend.
2. Frontend sends credentials to `/api/auth/login`.
3. API validates credentials against the legacy/client database/auth source.
4. API creates a secure session cookie.
5. Session includes username, display name, roles, and client slug/context.
6. Future requests use the session cookie.

Security behavior:

- If no session exists, protected API routes return `401`.
- If the session client does not match the requested client hostname, the API clears the session and returns `401`.

## Data access

Current operational data still comes from legacy client MSSQL databases.

DoXs2 API rules:

- MSSQL connections are server-side only.
- Queries must be read-only unless an explicit write path is designed and approved.
- Queries must be scoped by client.
- Queries must be scoped by user territory where territory data is available.
- SQL parameters must be bound safely.
- Expensive queries should use timeouts, limits, paging, and Firestore cache.

## Territory scoping

Territory scope is a core safety and performance requirement.

For user-facing operational data:

- API resolves the user’s allowed territories.
- API applies the territory predicate server-side.
- Frontend filters are not trusted as security controls.
- If a user has no territory scope, endpoints should return an empty result unless global/admin access is explicitly confirmed.

## Firestore role

Firestore is the modern application data, cache, configuration, and documentation layer.

Current/planned Firestore uses:

1. Dashboard cache
   - Store dashboard summaries by client, user/scope, period, and freshness metadata.

2. Report definitions
   - Store reusable report specs instead of hardcoded PHP report files.

3. Doctors / TML cache
   - Cache mostly read-only doctor directory pages by client, territory scope, letter/search, and page cursor.

4. System documentation
   - Keep readable project documentation in repo and optionally mirror/publish relevant summaries into Firestore for console/admin visibility.

## Dashboard cache model

Dashboard summaries can be cached with metadata such as:

- cachePath
- scopeHash
- scopeKey
- viewKey
- periodKey
- businessRulesVersion
- generatedAt
- expiresAt
- source
- stale/freshness fields

Source values:

- `firestore-cache`
- `mssql-refresh`
- `api-fallback`

The goal is to reduce repeated dashboard hits against MSSQL while preserving freshness visibility.

### Scheduler and freshness policy

Dashboard freshness is driven by Firebase scheduled functions in `apps/api/src/firebase.ts`:

- `dashboardCacheFreshnessDaytime`: every minute from 8:00 AM through 11:59 PM Asia/Manila.
- `dashboardCacheFreshnessOvernight`: hourly from 12:00 MN through 7:59 AM Asia/Manila.
- `userTerritoryReplicaRefresh`: daily at 1:00 AM Asia/Manila.
- `doctorTmlCacheRefresh`: 12:00 MN, 5:00 AM, 11:00 AM, and 5:00 PM Asia/Manila.

The dashboard scheduler reads only ITINERARY rows newer than the stored Firestore watermark where possible. It stores essential call facts under:

```text
iDoXs_Clients/{clientId}/itineraryCalls/{cycle}/territories/{territoryId}/dates/{date}/calls/{callId}
```

Essential fields only are retained: cycle, territory, date, visit time, doctor, PSR, itinerary/visit dates, period fields, GPS fields, and source watermark. These documents are the Firestore-side call copy used to reduce repeated broad reads against client MSSQL.

On each scheduler run:

1. Read latest changed ITINERARY watermarks from MSSQL per client using the last Firestore watermark.
2. Upsert only new/changed essential call records to Firestore.
3. Mark only scope caches affected by changed territories as stale.
4. Refresh affected `scopeCaches/*/viewCaches/*` documents so Firestore listeners and dashboards receive cache updates automatically.

The scheduler no longer refreshes every existing dashboard scope on every minute if no affected territory changed.

Doctor/TML cache refresh writes first-page alphabetical cache documents under:

```text
iDoXs_Clients/{clientId}/doctorTmlCache/global/letters/{A-Z}
```

These are intended as low-frequency, mostly read-only cache seeds. User/scope-specific Doctor/TML reads should still enforce territory access server-side.

## Firestore report definitions

Legacy iDoXs reports were PHP files backed by reusable report/pivot classes.

DoXs2 report definitions are intended to be Firestore documents with:

- report id
- title
- description/category
- allowed client slugs
- filters
- columns
- output formats
- data source definition
- SQL template
- territory scope rules

The API report engine will:

- load the definition from Firestore
- validate user/client access
- validate and bind filters
- inject territory scope safely
- run a read-only MSSQL query
- return normalized report rows

See:

- `docs/firestore-report-definitions.md`
- `seeds/reportDefinitions/monthly-calls-per-doctor.json`

## Doctors / Territory Master List page

The Doctors/TML page is the next planned feature.

Legacy behavior:

- Browse doctor master list / Territory Master List.
- Alphabetical list.
- Basic search.
- Data visible according to territory scope.

Modern design goals:

- Avoid full master-list downloads.
- Avoid stressing MSSQL with repeated broad queries.
- Use incremental loading.
- Use Firestore cache where practical.
- Keep all credentials and MSSQL access server-side.

Recommended API:

```text
GET /api/doctors?letter=A&search=foo&cursor=...&limit=50
```

Recommended frontend behavior:

- Doctors/TML nav entry.
- Alphabet filter: All, A-Z, #.
- Debounced search box.
- 50-100 row incremental loading.
- Empty/loading/error states.

Recommended cache key inputs:

- clientSlug
- territory scope hash
- letter
- normalized search hash
- cursor/page
- business rules version

See:

- `docs/subagent-daloboy-doctors-page.md`

## Current deployment notes

Frontend hosting is configured in `firebase.json`.

Current hosting target:

```text
doccs-as
```

Cloud/API deployment notes are in:

```text
runbooks/deploy-doxs-api-cloudrun.md
```

## Business rules

Detailed business rules are maintained in:

```text
docs/business-rules.md
```

They are intentionally business-facing and cover:

- business role meanings
- client and territory principles
- Doctor Universe, Doctor Count, and Territory Master List definitions
- visit planning, actual call, target call, and doctor reach meanings
- dashboard and report business interpretation rules
- Doctors/TML business behavior
- data-quality and privacy interpretation rules

Infrastructure, API, cache, deployment, and enforcement details stay in this system documentation file instead.

## Operational guardrails

- No secrets in GitHub.
- No secrets in frontend code.
- No direct browser-to-MSSQL access.
- API must validate session and client context.
- API must enforce territory scope server-side.
- Broad legacy DB queries need limits, caching, and timeouts.
- Firestore cache freshness should be visible and debuggable.
- Destructive or account-level infra changes require explicit approval.

## Current status summary

The first GitHub version includes:

- React/Vite/Tailwind frontend scaffold.
- Fastify API bridge.
- shared TypeScript models.
- auth/session implementation pattern.
- dashboard summary/cache pattern.
- Firestore report definition direction.
- sample monthly calls report seed.
- DaloBoy brief for Doctors/TML page.
- deployment runbook and Docker/Cloud Run scaffolding.

This version is the working foundation for turning legacy iDoXs features into a safer, modern, multi-tenant web system.
