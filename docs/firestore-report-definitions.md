# Firestore report definitions

Reusable reports live in Firestore collection `reportDefinitions` by default. The API reads these documents with Firebase Admin, validates them, applies auth/client/territory scope, then runs the read-only MSSQL query server-side.

## Document shape

```json
{
  "title": "Monthly Calls Per Doctor",
  "description": "Cycle-to-date call count by territory and doctor.",
  "category": "Field Activity",
  "status": "enabled",
  "clientSlugs": ["wert"],
  "allowedRoles": ["admin", "district manager", "manager", "medical representative"],
  "outputs": ["html", "csv"],
  "filters": [
    { "id": "startDate", "label": "Start date", "type": "date", "required": true },
    { "id": "endDate", "label": "End date", "type": "date", "required": true }
  ],
  "columns": [
    { "id": "territory_id", "label": "Territory" },
    { "id": "doctor_name", "label": "Doctor" },
    { "id": "calls", "label": "Calls", "type": "number", "align": "right" }
  ],
  "source": {
    "type": "mssql",
    "maxRows": 1000,
    "territoryScope": { "mode": "required" },
    "sql": "select ... where ... {{territoryPredicate:i.TERRITORY_ID}}"
  }
}
```

## SQL rules

- SQL is stored only in Firestore and executed only by the API, never by the browser.
- Only read-only `select` / `with` queries are accepted.
- Multiple statements and write/DDL keywords are blocked defensively.
- Filter placeholders use MSSQL named parameters, e.g. `@startDate`, `@endDate`.
- Territory scoping is inserted with `{{territoryPredicate:alias.TERRITORY_ID}}`.
  - `required`: empty territory scope becomes `and 1 = 0`.
  - `optional`: empty territory scope removes the predicate.
  - `none`: predicate is not applied.

## API endpoints

- `GET /api/reports` lists definitions available to the current session.
- `GET /api/reports/:reportId/run?startDate=2026-08-01&endDate=2026-08-31` executes one report.


## Seed definitions

Initial global/core report definitions are stored under:

```text
seeds/reportDefinitions/
```

Current Phase 2 definitions:

- `call-reach-by-frequency.json`
- `daily-coverage-report.json`
- `performance-report.json`
- `monthly-calls-per-doctor.json` remains as an example/deferred report

Dry-run the seed loader:

```bash
npm run seed:reports:dry-run
```

Write definitions to Firestore after approval and with Firebase Admin credentials available:

```bash
REPORTS_COLLECTION=reportDefinitions npm run seed:reports
```

The first three definitions are global/core reports, so `clientSlugs` is intentionally empty. Client-specific reports, such as Oxford Sales Order / ETR, should use explicit `clientSlugs` when added later.


## Readable business formula fields

In addition to the executable `source.sql`, report definitions should include readable metadata for admins and business reviewers in Firestore:

```json
{
  "businessFormulas": [
    {
      "id": "performance",
      "label": "Performance %",
      "description": "Actual calls divided by effective planned calls after acceptable misses.",
      "formula": "Actual / (Planned - Acceptable) * 100",
      "zeroDenominatorBehavior": "return null when Planned - Acceptable is zero"
    }
  ],
  "dataSourceDefinition": {
    "type": "mssql",
    "classification": "global-core-report",
    "legacyReportFile": "rptPerformanceReport.php",
    "primaryTables": ["ITINERARY", "PSR_ITINERARY", "PSR"],
    "requiredFields": {
      "ITINERARY": ["MONTH", "YEAR", "TERRITORY_ID"]
    },
    "scopeRules": ["client context", "required territory scope"],
    "filtersApplied": ["fiscalYear", "periodCode"],
    "grain": "district + territory",
    "notes": "Human-readable notes for reviewers."
  }
}
```

`businessFormulas` is for business/audit readability. `dataSourceDefinition` explains where the report data comes from and how it is scoped. `source.sql` remains the executable API source.
