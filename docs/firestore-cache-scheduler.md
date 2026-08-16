# Firestore cache scheduler

This repo uses Firebase scheduled functions for cache freshness.

## Schedules

Source of truth: `apps/api/src/firebase.ts`. All schedules use `Asia/Manila`.

- `dashboardCacheFreshnessDaytime`
  - cron: `* 8-23 * * *`
  - cadence: every minute, 8:00 AM-11:59 PM
  - purpose: ITINERARY delta detection, essential call upserts, affected dashboard cache refresh.
- `dashboardCacheFreshnessOvernight`
  - cron: `0 0-7 * * *`
  - cadence: hourly, 12:00 MN-7:00 AM
  - purpose: same as daytime, reduced overnight cadence.
- `userTerritoryReplicaRefresh`
  - cron: `0 1 * * *`
  - cadence: daily at 1:00 AM
  - purpose: replicate MSSQL `vw_user_territories` / `user_territories` into Firestore.
- `doctorTmlCacheRefresh`
  - cron: `0 0,5,11,17 * * *`
  - cadence: 12:00 MN, 5:00 AM, 11:00 AM, 5:00 PM
  - purpose: seed Doctor/TML first-page alphabetical cache.


## User territory replica

User territory assignments are replicated from MSSQL to Firestore once daily at 1:00 AM Asia/Manila.

Source table preference:

1. `[dbo].[vw_user_territories]`
2. `[dbo].[user_territories]`

Firestore path:

```text
iDoXs_Clients/{clientId}/userTerritories/{userId}
```

Stored fields:

- `clientId`
- `userId`
- `territories`
- `territoryCount`
- `territoryHash`
- `disabled`
- `source`
- `replicatedAt`
- `lastSeenAt`
- `cachePath`

If a user disappears from MSSQL on a later full sync, the Firestore doc is retained but marked `disabled: true` with an empty `territories` array.

API territory resolution reads this Firestore replica first. MSSQL is fallback/seed only when the Firestore document is missing or Firestore read fails.

Manual seed performed on 2026-08-16 Asia/Manila:

- `wert`: 1,192 assignments, 180 users
- `oxford`: 503 assignments, 177 users

## ITINERARY delta strategy

The dashboard scheduler keeps per-client state in:

```text
iDoXs_Clients/{clientId}/systemState/itineraryFreshness
```

It uses the last global watermark to read only newer ITINERARY changes from MSSQL when the client schema exposes any of these columns:

- `last_updated`
- `sent_update_date`
- `VISIT_DATE`
- `ITINERARY_DATE`

The scheduler upserts essential call copies to Firestore at:

```text
iDoXs_Clients/{clientId}/itineraryCalls/{cycle}/territories/{territoryId}/dates/{date}/calls/{callId}
```

Stored fields are intentionally minimal: cycle, territory, date, visit time, doctor, PSR, itinerary date, visit date, period fields, latitude/longitude, and source watermark.

## Cache update flow

1. Detect changed territories from ITINERARY watermarks.
2. Insert/upsert only new or changed essential call documents into Firestore.
3. Mark affected scope caches stale.
4. Refresh only affected dashboard summary/activity caches.
5. Firestore listeners update dashboards automatically from the refreshed cache documents.

## Doctor/TML cache

The Doctor/TML scheduled refresh seeds global first-page A-Z cache documents:

```text
iDoXs_Clients/{clientId}/doctorTmlCache/global/letters/{letter}
```

These documents are cache seeds only. API reads must still enforce user/client territory scope.
