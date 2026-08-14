# DoXs2 Business Rules

Business rules captured so far for the DoXs2 / iDoXs modernization project.

These rules describe how the modern application should behave while it still relies on legacy client databases. Where a rule is not fully implemented yet, it is marked as planned/required so future development can follow the same operating model.

## 1. Multi-client rules

### 1.1 Client is resolved by hostname

DoXs2 uses one shared web application for multiple clients.

Examples:

- `oxford.idoxs.app` resolves to client `oxford`.
- `wert.idoxs.app` resolves to client `wert`.

The API must use the resolved client context when selecting credentials, database configuration, cache paths, report definitions, and business logic.

### 1.2 Session client must match requested client

If a user logs in under one client context, that session must not be silently reused for another client hostname.

Current rule:

- If session client and request hostname client do not match, the API clears the session and returns `401`.

### 1.3 Browser is not trusted for client enforcement

The frontend may display or pass client hints, but the API remains the enforcement point.

The API must resolve and validate client context server-side.

## 2. Authentication and user identity

### 2.1 Users authenticate through the API

Users log in through `/api/auth/login` using production-style credentials.

The API validates the user against the existing legacy/client auth source.

### 2.2 Session contents

The API session should carry:

- username
- display name
- roles
- client slug/context

### 2.3 Protected routes require a session

Any route that returns client operational data must require a valid session.

Unauthenticated calls return `401`.

## 3. Territory scope rules

Territory scope is a core business rule for iDoXs data.

### 3.1 Data visibility follows assigned territories

For user-facing operational data, users should only see records that belong to their assigned territories unless a confirmed global/admin role explicitly allows wider access.

### 3.2 API enforces territory scope

Frontend filters are not security controls.

The API must apply territory predicates server-side when reading MSSQL data or report results.

### 3.3 Empty territory scope is restrictive

For required territory-scoped reports/features, an empty territory list should return no data, not all data.

Implemented report behavior:

- Required territory scope with no territories becomes `and 1 = 0`.

### 3.4 Territory values are normalized

Territory identifiers should be trimmed, deduplicated, and sorted before being used for:

- SQL predicates
- cache scope hashes
- Firestore cache keys
- comparison/freshness checks

## 4. Dashboard business rules

The dashboard currently focuses on call activity and doctor reach metrics.

### 4.1 Target calls

Target calls are counted from itinerary/planned-call style data.

Current implementation direction:

- Count month-to-date rows using `ITINERARY_DATE` where available.
- Apply territory scope when provided.

### 4.2 Actual calls

Actual calls are counted from completed/visited-call style data.

Current implementation direction:

- Count month-to-date rows using `VISIT_DATE` where available.
- Apply territory scope when provided.

### 4.3 Call rate

Call rate is calculated as:

```text
actualCalls / targetCalls * 100
```

If `targetCalls` is null or zero, `callRate` should be null rather than divide by zero.

### 4.4 Doctors planned

Doctors planned is the distinct count of doctors in planned itinerary rows for the current period.

Current implementation direction:

- Distinct doctor count from itinerary data using `ITINERARY_DATE`.
- Apply territory scope.

### 4.5 Doctors reached

Doctors reached is the distinct count of doctors with actual visits for the current period.

Current implementation direction:

- Distinct doctor count from itinerary/visit data using `VISIT_DATE`.
- Apply territory scope.

### 4.6 Doctors reached rate

Doctors reached rate is calculated as:

```text
doctorsReached / doctorsPlanned * 100
```

If `doctorsPlanned` is null or zero, `doctorsReachedRate` should be null.

### 4.7 Activity overview

Activity overview compares target calls and actual calls by date within the current period.

Current implementation direction:

- Build daily points from period start to end.
- Count target calls by `ITINERARY_DATE`.
- Count actual calls by `VISIT_DATE`.
- Apply territory scope.
- Hide weekend points unless target or actual activity exists.

### 4.8 Call map

Call map displays visit/call activity grouped by day and territory.

Current implementation direction:

- Use current cycle/period date range.
- Group calls by territory.
- Sort calls by visit date/time sequence.
- Include doctor id, doctor name, PSR, territory id, address, and GPS fields where available.
- Use actual GPS coordinates when available.
- Mark coordinates as missing when not available.
- For display continuity, missing GPS may use nearest available coordinates as inferred display coordinates.
- Territory colors are deterministic from territory id.

## 5. Cache business rules

Firestore is used as a cache and modern app-data layer.

### 5.1 Cache scope

Dashboard cache scope should include:

- client id / client slug
- assigned territories or user fallback scope
- roles
- period key
- business rules version

### 5.2 Business rules version

Cache documents include a `businessRulesVersion`.

When metric formulas, scope logic, or material report behavior changes, the business rules version should be bumped so old cache entries are not treated as equivalent to new results.

Current version:

```text
1
```

### 5.3 Cache metadata

Cache responses should include metadata such as:

- cachePath
- scopeHash
- scopeKey
- viewKey
- periodKey
- businessRulesVersion
- generatedAt
- expiresAt
- source
- stale status/reason when applicable

### 5.4 Cache freshness

Dashboard cache freshness can be checked against itinerary territory watermarks.

If a territory’s latest visit/itinerary watermark advances, cache documents intersecting that territory should be marked stale or refreshed.

Current stale reason:

```text
itinerary-territory-watermark-advanced
```

### 5.5 Cache source values

Allowed cache source labels:

- `firestore-cache`
- `mssql-refresh`
- `api-fallback`

## 6. Report business rules

### 6.1 Reports are definitions, not hardcoded pages

DoXs2 report behavior should move from legacy PHP files toward Firestore report definition documents.

A report definition includes:

- title
- description/category
- client availability
- filters
- output types
- columns
- data source definition
- SQL template
- permission/scope rules

### 6.2 Reports must be read-only

Report SQL must be read-only.

Do not allow report definitions to perform writes, deletes, schema changes, credential reads, or unsafe side effects.

### 6.3 Report filters must be validated

Report filters must be defined in the report specification and validated by the API.

Examples:

- date filters
- text filters
- select filters
- number filters
- boolean filters

### 6.4 Report SQL must use bound parameters

User-provided values must be passed as bound parameters, not string-concatenated SQL.

### 6.5 Report territory scope is server-enforced

Report definitions may define territory scope as:

- required
- optional

If required and the user has no territories, the result should be empty.

## 7. Doctors / Territory Master List rules

The Doctors / TML page is the first delegated DaloBoy feature.

### 7.1 Users browse assigned doctor master data

Users should be able to browse doctors/TML records in their territory scope.

Legacy behavior to preserve:

- alphabetical browsing
- basic search
- territory master list style lookup

### 7.2 Do not load the full master list by default

The Doctors/TML page must not load every doctor for broad users in one request.

Required behavior:

- alphabet filter
- debounced search
- incremental loading/pagination
- server-side limit cap

### 7.3 Search should be safe for MSSQL

Avoid broad unbounded searches against large tables.

Recommended rules:

- Require at least 2-3 characters for broad search when no letter is selected.
- Prefer prefix searches where acceptable.
- Avoid default `%term%` full-table scans.
- Cache common alphabetical pages in Firestore.

### 7.4 Doctors cache should be scope-aware

Doctors/TML cache keys should include:

- client slug
- territory scope hash
- letter filter
- normalized search hash
- page/cursor
- business rules version

### 7.5 Doctor row minimum fields

Initial row fields can include:

- doctor id / code
- doctor name
- specialty
- territory id/name
- class/frequency if available
- clinic/address summary if safe and available

Exact fields must be confirmed by read-only schema inspection before final SQL.

## 8. Data safety rules

### 8.1 Frontend must not contain secrets

Never commit or expose:

- MSSQL credentials
- Firebase Admin credentials
- service account JSON
- SSH keys
- API secrets
- tokens/passwords

### 8.2 MSSQL access is API-only

The browser must never connect directly to MSSQL or legacy databases.

### 8.3 Prefer read-only operations

Until explicit write workflows are designed and approved, DoXs2 should treat legacy data as read-only.

### 8.4 Expensive queries need controls

Large or expensive data access must use:

- limits
- pagination/cursors
- territory predicates
- timeouts
- cache
- schema/index awareness where possible

## 9. Operational approval rules

### 9.1 Safe to run directly

Read-only checks are generally safe:

- health checks
- schema inspection
- count queries
- cache status checks
- deploy status checks

### 9.2 Requires explicit approval

Ask before:

- production data writes
- destructive database operations
- credential creation/rotation/deletion
- IAM/security group/firewall changes
- DNS changes
- production deploys with external impact if target is ambiguous

## 10. Current open business-rule questions

These still need confirmation as features are built:

1. Which roles count as global/admin for cross-territory access?
2. Which legacy table is the authoritative doctor master source per client?
3. Which territory table/view is authoritative for each client?
4. What is the accepted current cycle definition for every client?
5. Should Doctors/TML search include address/clinic fields or only doctor name/code?
6. What cache TTL is acceptable for doctor master data per client?
7. Which reports must exactly match legacy PHP output and which can be modernized?
