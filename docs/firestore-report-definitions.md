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
