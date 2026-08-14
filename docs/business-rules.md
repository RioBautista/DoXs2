# DoXs2 Business Rules

Business rules for the DoXs2 / iDoXs modernization project.

This document is intentionally business-facing. It defines terms, expected behavior, workflow rules, and report meanings in plain language. Details about how the product is built or operated belong in `docs/system-documentation.md`.

## 1. Purpose

DoXs2 should preserve the business meaning of iDoXs while modernizing the user experience.

The system must help sales, field, district, and management users answer business questions such as:

- Who are the doctors assigned to each territory?
- Which doctors were planned for visits?
- Which doctors were actually reached?
- How well did each MedRep, territory, district, or client perform against plan?
- Which reports should match the legacy iDoXs interpretation of the data?

When there is disagreement about what a term means, the business meaning should be clarified here before reports or dashboards are treated as final.

## 2. Business roles

### 2.1 MedRep / Medical Representative

A MedRep is the field user responsible for covering doctors and clinics within an assigned territory.

Typical business responsibilities:

- maintain or submit a Territory Master List when required
- prepare or submit a visit plan / itinerary
- visit doctors according to approved coverage plans
- record actual call or visit activity

### 2.2 District Manager

A District Manager supervises MedReps within a district or area of responsibility.

Typical business responsibilities:

- review MedRep plans and territory lists
- approve or reject submitted plans/lists when the workflow requires approval
- monitor coverage, doctor reach, call rate, and activity performance

### 2.3 Manager / Brand Manager / Admin

Management users may review broader activity across multiple territories, districts, or clients depending on the business permission granted to them.

Business visibility should follow the role’s responsibility. A user should not automatically see all business data unless their business role explicitly requires that level of visibility.

## 3. Client and territory principles

### 3.1 Client context

Business data belongs to a specific client/company.

Examples:

- Oxford business data should be interpreted as Oxford data.
- Wert business data should be interpreted as Wert data.

Reports and dashboards should clearly indicate or imply which client context they represent.

### 3.2 Territory ownership

Territory is the primary business scope for MedRep coverage.

A territory represents the assigned coverage area/list of a MedRep or team for a planning period. When reports summarize performance, the territory should be treated as a key business dimension.

### 3.3 Territory visibility

Users should see the territories relevant to their assigned business responsibility.

Typical expectation:

- MedReps see their own assigned territory or territories.
- District Managers see territories under their district or supervision.
- Higher management sees wider scopes only when that is part of their role.

### 3.4 Empty or unclear assignment

If a user has no clear assigned territory or business scope, reports should not assume they are allowed to view everything.

The correct assignment should be confirmed before broad visibility is granted.

## 4. Doctor and territory list definitions

### 4.1 Doctor Universe

The Doctor Universe is the overall pool of unique doctors recognized by the business for a client.

Business meaning:

- It represents the client’s known doctor population.
- A doctor should ideally be counted once even if the doctor appears in multiple lists, clinics, plans, or visits.
- If duplicate doctor records exist, the business must define how they should be treated before final reporting.

Preferred business identifier:

- PRC license number is the preferred real-world identifier when available and reliable.

Caution:

- Birthday-based matching is discouraged because birthdays may be optional, incomplete, or privacy-sensitive.
- Fallback matching should be explicitly agreed per client when PRC or another trusted unique identifier is missing.

### 4.2 Doctor Count

Doctor Count is the number of different doctors included in a specific business context.

Examples:

- doctors in a territory
- doctors planned for visits
- doctors actually visited
- doctors reached within a period

Business meaning:

- The same doctor should count only once within the same counting context.
- The report must state the context clearly, because “doctor count” can mean different things depending on whether the list is planned, actual, assigned, reached, or universe-level.

### 4.3 Territory Master List

The Territory Master List is the doctor list assigned to or submitted by a MedRep for territory coverage.

Business meaning:

- It defines which doctors belong to a MedRep’s territory or coverage responsibility for a planning period.
- It is commonly tied to visit planning and management approval.
- It may represent a draft, submitted, approved, rejected, or historical list depending on workflow status.

Business workflow:

1. MedRep prepares or submits the list.
2. District Manager reviews the submitted list when approval is required.
3. Approved lists become the basis for planning, coverage, and performance expectations.

Reporting requirement:

- Reports using the Territory Master List should state whether they are using draft, submitted, approved, current, or historical lists.

### 4.4 Doctor assignment to territory

A doctor may appear in one or more territories depending on business rules and client setup.

Before treating a doctor as duplicated or incorrectly assigned, confirm whether the client allows:

- shared doctors
- multi-clinic coverage
- cross-territory coverage
- temporary reassignment
- historical territory movement

## 5. Visit planning and call activity

### 5.1 Visit Plan / Itinerary

A Visit Plan or Itinerary is the planned schedule of doctor calls for a MedRep and period.

Business meaning:

- It represents intended activity, not necessarily completed activity.
- It is used as the basis for target calls and planned doctor coverage.
- Depending on client workflow, it may require submission and approval.

### 5.2 Actual Call / Actual Visit

An Actual Call or Actual Visit is a visit that was performed or recorded as completed.

Business meaning:

- It represents field activity that actually happened or was reported as completed.
- It should be distinguished from planned calls.
- Reports must not mix planned and actual calls without labeling them clearly.

### 5.3 Target Calls

Target Calls are the planned calls expected for a period.

Business meaning:

- Target calls come from the approved or accepted planning basis for the selected period.
- Target calls are used as the denominator for call-rate performance.
- If a plan is not final or approved, reports should clarify whether targets are draft or approved.

### 5.4 Actual Calls

Actual Calls are completed or recorded visits within the selected period.

Business meaning:

- Actual calls are used to measure execution against plan.
- Actual calls should be reported separately from target calls.
- If cancellation, missed-call, or reschedule statuses are included or excluded, the report must state the rule.

### 5.5 Call Rate

Call Rate measures actual calls against target calls.

Business formula:

```text
Actual Calls / Target Calls × 100
```

Business rule:

- If there are no target calls, call rate should be shown as not applicable rather than forced to zero or infinity.
- Reports should label whether call rate is cycle-to-date, month-to-date, date-range, territory-level, MedRep-level, district-level, or client-level.

### 5.6 Doctors Planned

Doctors Planned is the number of distinct doctors included in the visit plan for the selected business period and scope.

Business meaning:

- It measures intended doctor coverage.
- A doctor planned multiple times within the same context should count once for doctor-planned count, unless the report explicitly measures planned call frequency instead.

### 5.7 Doctors Reached

Doctors Reached is the number of distinct doctors with actual completed visits in the selected business period and scope.

Business meaning:

- It measures actual doctor coverage.
- A doctor visited multiple times within the same context should count once for doctors reached, unless the report explicitly measures call frequency.

### 5.8 Doctors Reached Rate

Doctors Reached Rate measures how much of the planned doctor coverage was actually reached.

Business formula:

```text
Doctors Reached / Doctors Planned × 100
```

Business rule:

- If there are no planned doctors, doctors reached rate should be shown as not applicable.

## 6. Period and date rules

### 6.1 Reporting period

A reporting period is the business date range used for a dashboard, report, or performance review.

Examples:

- day
- week
- cycle
- month-to-date
- quarter-to-date
- custom date range

Reports should clearly show the reporting period used.

### 6.2 Current cycle

Current cycle means the active business cycle for the client.

If cycle definitions differ per client, the client-specific definition should be documented before cycle-based reports are considered final.

### 6.3 Date-range reports

When a report accepts a start date and end date, the report should clearly state whether both dates are included.

Default business expectation:

- start date is included
- end date is included

## 7. Dashboard business meanings

### 7.1 Home dashboard

The Home dashboard gives a quick operational view of field activity and coverage.

It should prioritize business clarity over internal detail.

At minimum, dashboard cards and charts should make clear:

- what period is being shown
- what territory or user scope is being shown
- whether values are planned, actual, or calculated

### 7.2 Activity overview

Activity overview compares planned activity and actual activity across dates within the selected period.

Business meaning:

- It helps managers see whether activity is happening according to plan.
- Days without planned or actual activity may be hidden or de-emphasized if they are not useful for decision-making.

### 7.3 Call map

Call map shows field visit activity geographically.

Business meaning:

- It helps review coverage movement and visit sequencing.
- Missing location data should be visible as a data-quality issue, not silently treated as accurate location data.
- If a display uses inferred or approximate locations for continuity, that should be clearly labeled.

## 8. Report business rules

### 8.1 Reports are business definitions

A report should have a clear business purpose before it is built.

Each report should define:

- report title
- plain-language purpose
- intended users/roles
- client availability if client-specific
- required filters
- output columns and meanings
- business formula or counting rule
- known exclusions or assumptions

### 8.2 Reports should avoid ambiguous metric names

If a metric name can mean multiple things, the report should qualify it.

Examples:

- “Doctor Count” should specify universe, assigned, planned, reached, or visited.
- “Calls” should specify target, actual, missed, cancelled, or total.
- “Coverage” should specify doctor coverage, territory coverage, or call completion.

### 8.3 Reports should preserve legacy meaning where required

Some reports must match legacy iDoXs output exactly for continuity.

For each report, business owners should decide whether it is:

- legacy-compatible: must match legacy meaning/output closely
- modernized: may improve labels, filters, grouping, or interpretation
- new: created for DoXs2 and not expected to match a legacy report

### 8.4 Report filters are business controls

Filters should reflect how users think about the report.

Common filters:

- client
- territory
- district
- MedRep
- reporting period
- doctor specialty
- doctor class
- product/brand when relevant
- report status such as draft/submitted/approved

### 8.5 Report status should be explicit

If a report depends on workflow state, it should state which status is included.

Examples:

- draft plans
- submitted plans
- approved plans
- rejected plans
- completed visits
- missed calls
- cancelled calls

## 9. Doctors / TML page business rules

### 9.1 Purpose

The Doctors / Territory Master List page lets users browse the doctor list relevant to their business scope.

It supports territory review, planning validation, and doctor lookup.

### 9.2 Expected browsing behavior

Users should be able to browse doctors in a practical way, such as:

- alphabetically by doctor name
- by search term
- by territory
- by specialty or class when useful

### 9.3 Business fields

Initial business fields may include:

- doctor code or identifier
- doctor name
- specialty
- territory
- class/frequency if used by the client
- clinic or address summary when appropriate

Exact field labels should follow business terminology used by the client.

### 9.4 Privacy and sensitivity

Doctor personal data should be limited to what is needed for the business task.

Birthday, personal contact details, and other sensitive information should not be shown or used for matching unless explicitly approved for a valid business reason.

## 10. Data quality and interpretation rules

### 10.1 Missing data

Missing data should be visible where it affects business interpretation.

Examples:

- missing PRC/license identifier
- missing territory assignment
- missing doctor specialty
- missing GPS/location
- missing approval status

### 10.2 Duplicate records

Possible duplicate doctors or territory records should not be silently merged unless the business matching rule is documented.

### 10.3 Historical changes

Reports should distinguish current assignments from historical assignments when the difference matters.

Examples:

- doctor moved to another territory
- MedRep reassigned
- district structure changed
- doctor removed from an approved list

## 11. Open business questions

These require business confirmation before reports are finalized:

1. Which roles are allowed to view cross-territory or all-client summaries?
2. What is the authoritative definition of Doctor Universe per client?
3. What fallback matching rule should be used when PRC/license number is missing?
4. Can doctors belong to multiple territories at the same time?
5. Which Territory Master List status should dashboards use by default: draft, submitted, approved, or current active?
6. What is the official current-cycle definition for Oxford and Wert?
7. Which reports must exactly match legacy iDoXs outputs?
8. Which doctor personal fields are approved for display or matching?
9. How should missed, cancelled, rescheduled, and invalid calls affect call-rate reports?
10. Should weekend or holiday activity be included by default in activity reports?
