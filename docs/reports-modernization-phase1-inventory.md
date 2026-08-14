# Reports Modernization — Phase 1 Inventory and Classification

Status: Phase 1 draft for validation
Coordinator: Nandy
Project: DoXs2 / iDoXs modernization

## Goal

Inventory the legacy Doccsonline/iDoXs report landscape and choose the safest first reports to migrate into the DoXs2 report engine.

This phase does not change production behavior. It only classifies legacy reports and proposes migration priority.

## Sources inspected

Local pulled/copied legacy report sources currently available in the Nandy workspace:

- `reports/live-status/prod-doccs-module-full/reports/`
- `reports/doccs-as-code-review/live-pull/target_reports/support/`
- `.tmp/oxford_reports/`
- prior Oxford ETR investigation files and fixed report copies

## Inventory summary

Initial scan found about 89 PHP report or report-like files after excluding most generic class/helper files. Many are duplicates, backups, client-specific variants, or temporary investigation copies.

Business-facing report families identified:

1. Doctor Calls / Coverage
2. Performance / KPI reports
3. Itinerary / Coverage reports
4. Sales / ETR reports
5. GPS / Tagging reports
6. Login / Activity Audit reports
7. Territory / Master Data reports
8. Other / needs review

## Classification

### 1. Doctor Calls / Coverage

Representative legacy files:

- `rptMonthlyCallsPerDoctor.php`
- `rptDoctorCallDetail.php`
- `rpt2DoctorCallDetail.php`
- `rptDoctorCallNotes.php`
- `rptDoctorCountPerFreq.php`

Business purpose:

- Show doctor-level activity.
- Track planned vs actual doctor contact.
- Support doctor reach, frequency, and call detail validation.

Migration priority: High

Reason:

- Closely matches dashboard business rules already documented.
- Uses core tables we are already touching: itinerary, doctor, doctor clinic, territory.
- Strong fit for generic report definitions and reusable filters.

Recommended pilot:

- `Monthly Calls Per Doctor`

### 2. Performance / KPI reports

Representative legacy files:

- `rptPerformanceReport.php`
- `rptPerformanceReportByFreq.php`
- `rptPerformanceReportPerClass.php`
- `rptPerformanceReportPerSpecialty.php`
- `rptCallRateByTeam.php`
- `rptCallFrequencyReport.php`
- `rptCallReachPerFrequency.php`
- `rptCallConcentration.php`

Business purpose:

- Summarize team, territory, doctor class, specialty, frequency, and reach performance.
- Support management review by region/district/territory.

Migration priority: High after first pilot

Reason:

- These are likely high-value manager reports.
- They depend on the same definitions as dashboard metrics, so we should stabilize business formulas first.

Recommended approach:

- Migrate after Monthly Calls Per Doctor validates the report engine.
- Avoid cloning each variation manually; define a reusable report family pattern.

### 3. Itinerary / Coverage reports

Representative legacy files:

- `rptDailyCoverageReport.php`
- `rptDailyCoverageReportTotal.php`
- `rptItineraryOverview.php`
- `rptMissedCallSummary.php`
- `rptCTDSummary.php`
- `rptCTDSummaryDetail.php`

Business purpose:

- Show plan coverage, missed calls, cycle-to-date summaries, and daily execution.

Migration priority: Medium-high

Reason:

- Important for operations and field execution.
- Needs careful agreement on current cycle/date logic.

Recommended pilot candidate:

- `Daily Coverage Report` or `Missed Call Summary`, after dashboard formulas are validated.

### 4. Sales / ETR reports

Representative legacy files:

- `rptSalesOrderETR_6.php`
- `rptSalesOrderETR_7.php`
- `rptSalesOrderAllETR.php`
- `rptSalesOrderDownloadedETR.php`
- `rpt2SalesOrderDetailsETR.php`
- `rpt2SalesOrderDownloadedETR.php`
- Oxford fixed copies from the ETR investigation

Business purpose:

- Sales order summary and detail reporting.
- ETR/download tracking and Excel export workflows.
- Operational validation of sales order transmission/download state.

Migration priority: High, but as a separate report family

Reason:

- We already investigated and fixed parts of this legacy path.
- These reports are operationally important but more complex than the basic doctor/call reports.
- Some variants have old browser/XHR/download behavior that should be redesigned, not directly cloned.

Recommended pilot:

- `Sales Order ETR Detail` as table output first.
- Excel/download parity should come after table correctness is validated.

### 5. GPS / Tagging reports

Representative legacy files:

- `rptTaggingVerification.php`
- `rptTaggingVerificationDetail.php`
- `rptProcessLocations.php`

Business purpose:

- Validate GPS/tagging/location activity.
- Support field compliance review.

Migration priority: Medium

Reason:

- Important, but needs privacy and display decisions.
- Good candidate after call map behavior and data privacy rules are settled.

### 6. Login / Activity Audit reports

Representative legacy files:

- `rptLoginReport.php`
- `rptDMLoginReport.php`
- `rptDailyLoginReport.php`

Business purpose:

- Show user login/activity patterns.
- Support audit and adoption tracking.

Migration priority: Medium-low

Reason:

- Useful, but not the first business-critical reporting path.
- Can be migrated once auth/session modernization is stable.

### 7. Territory / Master Data reports

Representative legacy files:

- `rptTerritoryStatistics.php`
- `TerritoryStatDetail.php`

Business purpose:

- Territory-level master/statistical views.
- Related to Doctors/TML work and manager scope.

Migration priority: Medium-high

Reason:

- Useful bridge with the Doctors/TML page.
- Should be coordinated with DaloBoy’s Doctors/TML work so we do not duplicate queries or cache models.

### 8. Other / needs review

Examples:

- helper/test files
- old copies
- sample receiving files
- client-specific experimental variants
- support classes and framework wrappers

Migration priority: Low until a user requests a specific report.

## Recommended migration order

### Pilot 1: Monthly Calls Per Doctor

Why first:

- Business meaning is clear.
- Already represented in `seeds/reportDefinitions/monthly-calls-per-doctor.json`.
- Uses doctor/territory/call data aligned with current dashboard rules.
- Good validation target for territory scope, date filters, dynamic columns, and generic table rendering.

Validation goal:

- Confirm numbers against legacy for one client/user/date range.

### Pilot 2: Sales Order ETR Detail

Why second:

- Operationally important for Oxford.
- We already have strong context from recent ETR fixes.
- Good test of a more complex report with many fields and potential export needs.

Validation goal:

- Match legacy table output first.
- Add Excel/download parity after correctness is confirmed.

### Pilot 3: Territory / Doctor Coverage Summary

Why third:

- Supports managers.
- Bridges Reports and Doctors/TML.
- Helps define reusable doctor universe / reach / coverage formulas.

Validation goal:

- Confirm territory-scope behavior and doctor counts with business users.

## Technical implications for Phase 2

The current DoXs2 API already has early report-engine support:

- list report definitions
- run report definition
- territory predicate injection
- bound filter parameters
- session/client checks

Phase 2 should improve this into a production-ready pattern:

1. Tighten report SQL safety checks.
2. Add default row limits.
3. Add consistent date filter handling.
4. Add report result metadata.
5. Add clearer error messages for invalid definitions.
6. Add Firestore seed/deploy path for selected pilot definitions.

## Validation questions for Boss Rio / team

Before Phase 2, please validate:

1. Is `Monthly Calls Per Doctor` the correct first pilot?
2. Should `Sales Order ETR Detail` be second, or should Sales Order Summary come first?
3. For pilot reports, is table output enough first, with Excel export later?
4. Should we prioritize Oxford first before Wert?
5. Are there any legacy reports that users depend on daily and must be added to the first batch?

## Phase 1 recommendation

Proceed with this first batch:

1. Monthly Calls Per Doctor
2. Sales Order ETR Detail
3. Territory / Doctor Coverage Summary

Hold the broader performance/KPI report family until the first pilot validates report definitions, territory scope, date filtering, and generic UI behavior.
