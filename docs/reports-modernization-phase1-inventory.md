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

## Global vs client-custom report strategy

DoXs2 should support two classes of reports:

### Global/core reports

Global reports are shared iDoXs business reports that should work across clients when the required legacy tables/columns exist. These should be prioritized first because they define the reusable report engine pattern.

Examples:

- Call Reach Report
- Daily Coverage Report
- Performance Report
- Doctor/call coverage summaries
- Login/activity reports, once auth/audit rules are stable

### Client-custom reports

Client-custom reports are reports that exist because of a specific client workflow, custom table/view, special export, or operational process. These should be supported by the same report engine, but not used as the first proof of the global pattern.

Examples:

- Oxford Sales Order / ETR reports
- client-specific Excel/download flows
- client-specific product/customer/order reports

Oxford ETR remains important, but it should move to the custom-report lane after the global report engine is validated.

## Validated first report batch

Boss Rio validated that the first three report pilots should be global/core reports:

1. Call Reach Report
2. Daily Coverage Report
3. Performance Report

### Pilot 1: Call Reach Report

Representative legacy file:

- `rptCallReachPerFrequency.php`

Legacy title observed:

- `Call Reach by Frequency`

Business purpose:

- Show how many doctors were reached versus the doctor universe, grouped by frequency and organizational scope.
- Help managers evaluate reach against expected call frequency.

Observed legacy grouping:

- Region
- District
- Territory
- Frequency

Observed legacy measures:

- Doctor Count
- Visited
- Percentage = `Visited / Doctor Count * 100`

Initial DoXs2 report goal:

- Table output first.
- Date/cycle filters.
- Territory scope enforcement.
- Group by region/district/territory/frequency where source fields exist.
- Validate counts against one known legacy output before broad rollout.

### Pilot 2: Daily Coverage Report

Representative legacy file:

- `rptDailyCoverageReport.php`

Business purpose:

- Show daily planned/covered activity by organizational scope.
- Support field execution review and daily coverage validation.

Observed legacy grouping:

- Region
- District
- Territory

Initial DoXs2 report goal:

- Table output first.
- Date filter or date range depending on business validation.
- Territory scope enforcement.
- Show daily planned/actual/coverage fields once the exact legacy column meanings are confirmed.

### Pilot 3: Performance Report

Representative legacy file:

- `rptPerformanceReport.php`

Business purpose:

- Show planned vs actual performance for the current cycle/period.
- Provide manager-level performance review by region, district, and territory.

Observed legacy grouping:

- Region
- District
- Territory

Observed legacy measures/formula:

- Planned
- Actual
- Acceptable
- Performance = `Actual / (Planned - Acceptable) * 100`

Initial DoXs2 report goal:

- Table output first.
- Cycle/period filters.
- Territory scope enforcement.
- Preserve the legacy business formula unless Boss Rio/team approves a revised formula.

## Updated migration order

1. Implement global report definition support for Call Reach Report.
2. Validate Call Reach against legacy output.
3. Implement Daily Coverage Report using the same engine.
4. Validate Daily Coverage against legacy output.
5. Implement Performance Report using the same engine.
6. Validate Performance against legacy output.
7. After the global pattern is stable, add client-custom report support and revisit Oxford ETR.

## Reports deliberately deferred

### Oxford Sales Order / ETR

Deferred from the first batch because these are mostly Oxford-specific reports. They remain useful, but they should be implemented as client-custom report definitions after the global report system is proven.

### Monthly Calls Per Doctor

Deferred from the first batch. It remains a good report-engine example and seed, but Boss Rio selected Call Reach, Daily Coverage, and Performance as the first validation targets.

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
