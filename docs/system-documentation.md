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

They currently cover:

- multi-client hostname/session behavior
- authentication and session rules
- territory scoping
- dashboard metric formulas
- Firestore cache rules
- report execution rules
- Doctors/TML rules
- data safety and approval rules

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
