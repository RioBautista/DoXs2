import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Download, FileText, Loader2, Maximize2, Minimize2, Play, Printer, RefreshCcw } from 'lucide-react';
import { listReports, runReport, type ReportDefinitionSummary, type ReportRunResult } from '../api';
import { Button } from './ui/Button';
import { Input } from './ui/Input';

type ReportsPageProps = {
  clientName: string;
};

type FilterState = Record<string, string>;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function currentYear() {
  return String(new Date().getFullYear());
}

function currentMonth() {
  return String(new Date().getMonth() + 1);
}

function initialFilters(report: ReportDefinitionSummary | null): FilterState {
  const values: FilterState = {};
  for (const filter of report?.filters ?? []) {
    if (filter.defaultValue !== undefined && filter.defaultValue !== null) values[filter.id] = String(filter.defaultValue);
    else if (filter.type === 'date') values[filter.id] = todayIso();
    else if (/fiscalYear/i.test(filter.id)) values[filter.id] = currentYear();
    else if (/periodCode|month/i.test(filter.id)) values[filter.id] = currentMonth();
    else values[filter.id] = '';
  }
  return values;
}

function alignClass(align?: 'left' | 'right' | 'center') {
  if (align === 'right') return 'text-right';
  if (align === 'center') return 'text-center';
  return 'text-left';
}

function formatDateLike(value: unknown, withTime = false) {
  if (value instanceof Date) return value.toLocaleDateString('en-US');
  const text = String(value ?? '').trim();
  if (!text) return '';
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}:\d{2}))?/);
  if (!match) return text;
  const date = `${match[2]}/${match[3]}/${match[1]}`;
  return withTime && match[4] ? `${date} ${match[4]}` : date;
}

function formatCell(value: unknown, format?: string, type?: 'text' | 'number' | 'date' | 'datetime' | 'boolean') {
  if (value === null || value === undefined || value === '') return '—';
  if (type === 'date') return formatDateLike(value);
  if (type === 'datetime') return formatDateLike(value, true);
  if (typeof value === 'number') {
    const text = new Intl.NumberFormat(undefined, { minimumFractionDigits: format === 'percent' ? 2 : 0, maximumFractionDigits: 2 }).format(value);
    return format === 'percent' ? `${text}%` : text;
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function csvEscape(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

const CTD_COLUMN_IDS = new Set(['ctd_customer_count', 'ctd_visited', 'ctd_percentage']);
const YTD_COLUMN_IDS = new Set(['ytd_customer_count', 'ytd_visited', 'ytd_percentage']);

type ReportColumn = ReportDefinitionSummary['columns'][number];

type ColumnGroup = { key: string; label: string; columns: ReportColumn[]; kind: 'ctd' | 'ytd' | 'day' };

function buildColumnGroups(columns: ReportColumn[]) {
  const groups: ColumnGroup[] = [];
  const groupedColumnIds = new Set<string>();

  const ctdColumns = columns.filter((column) => column.id.startsWith('ctd_'));
  const ytdColumns = columns.filter((column) => column.id.startsWith('ytd_'));
  if (ctdColumns.length && ytdColumns.length) {
    groups.push({ key: 'ctd', label: 'CTD', columns: ctdColumns, kind: 'ctd' });
    groups.push({ key: 'ytd', label: 'YTD', columns: ytdColumns, kind: 'ytd' });
    for (const column of [...ctdColumns, ...ytdColumns]) groupedColumnIds.add(column.id);
    return { groups, rowHeaderColumns: columns.filter((column) => !groupedColumnIds.has(column.id)) };
  }

  for (const column of columns) {
    const match = column.id.match(/^d(\d{2})_(ap|up|all)$/);
    if (!match) continue;
    let group = groups.find((item) => item.key === match[1]);
    if (!group) {
      group = { key: match[1], label: match[1], columns: [], kind: 'day' };
      groups.push(group);
    }
    group.columns.push(column);
    groupedColumnIds.add(column.id);
  }

  return { groups, rowHeaderColumns: groups.length ? columns.filter((column) => !groupedColumnIds.has(column.id)) : columns };
}

function reportRowType(row: Record<string, unknown>) {
  return String(row.__rowType ?? '').trim();
}

function rowClass(row: Record<string, unknown>, index: number) {
  const type = reportRowType(row);
  if (type === 'territory-total') return 'bg-sky-50 font-bold';
  if (type === 'district-total') return 'bg-blue-100 font-bold';
  if (type === 'region-total') return 'bg-indigo-100 font-bold';
  if (type === 'grand-total') return 'bg-amber-200 font-bold';
  if (type.endsWith('-total')) return 'bg-slate-100 font-bold';
  return index % 2 === 0 ? 'bg-white' : 'bg-slate-50/40';
}

function groupedColumnLabel(column: ReportColumn) {
  const dayMatch = column.id.match(/^d\d{2}_(ap|up|all)$/);
  if (dayMatch) return dayMatch[1].toUpperCase() === 'ALL' ? 'All' : dayMatch[1].toUpperCase();
  return column.label;
}

function groupHeaderClass(group: ColumnGroup['kind']) {
  if (group === 'ctd') return 'bg-[#1f4e79]';
  if (group === 'day') return 'bg-[#1f4e79]';
  return 'bg-[navy]';
}

function groupReports(reports: ReportDefinitionSummary[]) {
  return reports.reduce<Record<string, ReportDefinitionSummary[]>>((groups, report) => {
    const category = report.category || 'Reports';
    groups[category] = groups[category] ?? [];
    groups[category].push(report);
    return groups;
  }, {});
}

export function ReportsPage({ clientName }: ReportsPageProps) {
  const [reports, setReports] = useState<ReportDefinitionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<FilterState>({});
  const [result, setResult] = useState<ReportRunResult | null>(null);
  const [isLoadingList, setIsLoadingList] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isOutputFullscreen, setIsOutputFullscreen] = useState(false);

  const selectedReport = reports.find((report) => report.id === selectedId) ?? reports[0] ?? null;
  const groupedReports = useMemo(() => groupReports(reports), [reports]);

  useEffect(() => {
    let cancelled = false;
    async function loadReports() {
      setIsLoadingList(true);
      setError(null);
      try {
        const response = await listReports();
        if (cancelled) return;
        if (!response.ok) throw new Error(response.message ?? 'Unable to load reports.');
        setReports(response.reports ?? []);
        const first = response.reports?.[0] ?? null;
        setSelectedId((current) => current ?? first?.id ?? null);
        setFilters(initialFilters(first));
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Unable to load reports.');
      } finally {
        if (!cancelled) setIsLoadingList(false);
      }
    }
    void loadReports();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!isOutputFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOutputFullscreen(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOutputFullscreen]);

  function selectReport(report: ReportDefinitionSummary) {
    setSelectedId(report.id);
    setFilters(initialFilters(report));
    setResult(null);
    setError(null);
    setIsOutputFullscreen(false);
  }

  async function runReportById(reportId: string, nextFilters: FilterState) {
    setSelectedId(reportId);
    setFilters(nextFilters);
    setIsOutputFullscreen(false);
    setIsRunning(true);
    setError(null);
    setResult(null);
    try {
      const response = await runReport(reportId, nextFilters);
      setResult(response);
      if (!response.ok) setError(response.message ?? 'Report failed.');
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Report request failed.');
    } finally {
      setIsRunning(false);
    }
  }

  async function handleRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedReport) return;
    await runReportById(selectedReport.id, filters);
  }

  async function openTaggingVerificationDetail(row: Record<string, unknown>) {
    const territoryId = String(row.detail_territory_id ?? '').trim();
    const rawVisitDate = row.detail_visit_date;
    const visitDate = typeof rawVisitDate === 'string' ? rawVisitDate.slice(0, 10) : '';
    if (!territoryId || !/^\d{4}-\d{2}-\d{2}/.test(visitDate)) return;
    await runReportById('tagging-verification-detail', { territoryId, visitDate: visitDate.slice(0, 10) });
  }

  function isTaggingVerificationDetailsCell(row: Record<string, unknown>, column: ReportColumn) {
    return selectedReport?.id === 'tagging-verification' && column.id === 'details' && reportRowType(row) === 'detail';
  }

  function renderCell(row: Record<string, unknown>, column: ReportColumn) {
    if (isTaggingVerificationDetailsCell(row, column)) {
      return (
        <button
          type="button"
          onClick={() => void openTaggingVerificationDetail(row)}
          className="font-semibold text-brand-700 underline decoration-brand-300 underline-offset-2 hover:text-brand-800"
        >
          details
        </button>
      );
    }
    return formatCell(row[column.id], column.format, column.type);
  }

  function downloadCsv() {
    if (!selectedReport || !rows.length || !columns.length) return;
    const lines = [
      columns.map((column) => csvEscape(column.label)).join(','),
      ...rows.map((row) => columns.map((column) => csvEscape(formatCell(row[column.id], column.format, column.type))).join(',')),
    ];
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedReport.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'report'}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }


  const columns = result?.report?.columns?.length ? result.report.columns : selectedReport?.columns ?? [];
  const rows = result?.rows ?? [];
  const { groups: columnGroups, rowHeaderColumns } = buildColumnGroups(columns);
  const hasGroupedOutput = columnGroups.length > 0;
  const generatedLabel = result?.generatedAt ? new Date(result.generatedAt).toLocaleString() : null;
  const outputShellClass = isOutputFullscreen
    ? 'fixed inset-0 z-50 flex flex-col rounded-none border-0 bg-white shadow-2xl print:static print:block print:shadow-none'
    : 'min-w-0 rounded-2xl border border-slate-200 bg-white shadow-sm print:border-0 print:shadow-none';
  const outputBodyClass = isOutputFullscreen ? 'flex min-h-0 flex-1 flex-col bg-white p-6 print:p-0' : 'min-w-0 bg-white p-4 print:p-0';
  const tableContainerClass = isOutputFullscreen
    ? 'min-h-0 flex-1 overflow-auto border border-slate-300 print:max-h-none print:overflow-visible'
    : 'max-h-[65vh] max-w-full overflow-auto overscroll-contain border border-slate-300 print:max-h-none print:overflow-visible';
  const tableClass = isOutputFullscreen
    ? 'min-w-full border-collapse bg-white font-[Arial] text-[10px] leading-tight text-black'
    : 'w-full min-w-max border-collapse bg-white font-[Arial] text-[8.5px] leading-tight text-black';
  const headerCellClass = isOutputFullscreen ? 'px-2 py-1.5 text-[12px]' : 'px-1.5 py-1 text-[9px]';
  const dataCellClass = isOutputFullscreen ? 'px-2 py-1' : 'px-1.5 py-0.5';
  const numberCellClass = isOutputFullscreen ? 'text-[12px]' : 'text-[9px]';
  const textCellClass = isOutputFullscreen ? 'text-[10pt]' : 'text-[9px]';

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-brand-700">
              <FileText className="h-3.5 w-3.5" /> Reports Engine
            </div>
            <h2 className="mt-3 text-xl font-bold tracking-tight text-slate-950">{clientName} Reports</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              Reports are rendered dynamically from Firestore definitions. Filters, columns, territory scope, formulas, and the MSSQL data source are controlled by the report specification; the browser only calls the API.
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
          >
            <RefreshCcw className="h-4 w-4" /> Reload
          </button>
        </div>
      </div>

      {error ? (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          <div className="flex gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-none" />
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[20rem_1fr]">
        <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="px-2 text-xs font-bold uppercase tracking-wide text-slate-400">Available reports</p>
          {isLoadingList ? (
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Loading reports…</div>
          ) : reports.length ? (
            <div className="mt-4 space-y-5">
              {Object.entries(groupedReports).map(([category, items]) => (
                <div key={category}>
                  <p className="mb-2 px-2 text-xs font-semibold text-slate-500">{category}</p>
                  <div className="space-y-1">
                    {items.map((report) => (
                      <button
                        key={report.id}
                        type="button"
                        onClick={() => selectReport(report)}
                        className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${selectedReport?.id === report.id ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-700 hover:bg-slate-50'}`}
                      >
                        <span className="block font-semibold">{report.title}</span>
                        {report.description ? <span className={`mt-1 block text-xs leading-5 ${selectedReport?.id === report.id ? 'text-blue-50' : 'text-slate-500'}`}>{report.description}</span> : null}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-xl bg-slate-50 p-3 text-sm text-slate-500">No report definitions are available for this user/client yet.</div>
          )}
        </aside>

        <section className="min-w-0 space-y-6">
          <form className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm" onSubmit={handleRun}>
            {selectedReport ? (
              <>
                <div className="mb-5">
                  <h3 className="text-lg font-bold text-slate-950">{selectedReport.title}</h3>
                  {selectedReport.description ? <p className="mt-1 text-sm leading-6 text-slate-500">{selectedReport.description}</p> : null}
                </div>
                <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {selectedReport.filters.map((filter) => (
                    <div key={filter.id}>
                      {filter.type === 'select' ? (
                        <label className="block text-sm font-medium text-slate-700">
                          {filter.label}{filter.required ? <span className="text-red-500"> *</span> : null}
                          <select
                            className="mt-2 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-blue-100"
                            required={filter.required}
                            value={filters[filter.id] ?? ''}
                            onChange={(event) => setFilters((current) => ({ ...current, [filter.id]: event.target.value }))}
                          >
                            <option value="">Select…</option>
                            {(filter.options ?? []).map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                        </label>
                      ) : (
                        <Input
                          label={filter.label}
                          name={filter.id}
                          type={filter.type === 'number' ? 'number' : filter.type === 'date' ? 'date' : 'text'}
                          required={filter.required}
                          value={filters[filter.id] ?? ''}
                          onChange={(event) => setFilters((current) => ({ ...current, [filter.id]: event.target.value }))}
                        />
                      )}
                    </div>
                  ))}
                </div>
                <div className="mt-6 flex flex-wrap items-center gap-3">
                  <Button type="submit" isLoading={isRunning}><Play className="h-4 w-4" /> Run report</Button>
                  <p className="text-xs text-slate-500">Output: {(selectedReport.outputs ?? ['html']).join(', ')}</p>
                </div>
              </>
            ) : (
              <div className="rounded-xl bg-slate-50 p-6 text-center text-sm text-slate-500">Select a report to configure filters.</div>
            )}
          </form>

          <div className={outputShellClass}>
            <div className="border-b border-slate-200 p-5 print:hidden">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-950">Report output</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {result?.ok ? `${result.rowCount ?? rows.length} rows${result.truncated ? ' · truncated by max rows' : ''}` : 'Run a report to render results.'}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {generatedLabel ? <p className="mr-2 text-xs text-slate-400">Generated {generatedLabel}</p> : null}
                  <button type="button" disabled={!rows.length} onClick={downloadCsv} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                    <Download className="h-3.5 w-3.5" /> Excel / CSV
                  </button>
                  <button type="button" disabled={!rows.length} onClick={() => window.print()} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                    <Printer className="h-3.5 w-3.5" /> Print
                  </button>
                  <button type="button" disabled={!rows.length} onClick={() => setIsOutputFullscreen((current) => !current)} className="inline-flex items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40">
                    {isOutputFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />} {isOutputFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
                  </button>
                </div>
              </div>
            </div>
            {rows.length ? (
              <div className={outputBodyClass}>
                <div className="mb-3 text-center">
                  <h4 className="text-lg font-bold uppercase tracking-wide text-slate-950 print:text-black">{selectedReport?.title}</h4>
                  <p className="mt-1 text-xs text-slate-500 print:text-black">{clientName}{generatedLabel ? ` · ${generatedLabel}` : ''}</p>
                </div>
                <div id="tbl-container" className={tableContainerClass}>
                  <table id="tbl" className={tableClass}>
                    <thead>
                      {hasGroupedOutput ? (
                        <>
                          <tr>
                            {rowHeaderColumns.map((column) => (
                              <th key={column.id} rowSpan={2} id="ctitle" className={`sticky top-0 z-10 whitespace-nowrap border border-white bg-[navy] ${headerCellClass} ${alignClass(column.align)} text-center font-bold uppercase text-white print:static`}>{column.label}</th>
                            ))}
                            {columnGroups.map((group) => (
                              <th key={group.key} colSpan={group.columns.length} className={`sticky top-0 z-10 whitespace-nowrap border border-white ${headerCellClass} text-center font-bold uppercase text-white print:static ${groupHeaderClass(group.kind)}`}>{group.label}</th>
                            ))}
                          </tr>
                          <tr>
                            {columnGroups.flatMap((group) => group.columns.map((column) => (
                              <th key={column.id} id="ctitle" className={`sticky top-6 z-10 whitespace-nowrap border border-white ${headerCellClass} ${alignClass(column.align)} text-center font-bold uppercase text-white print:static ${groupHeaderClass(group.kind)}`}>{groupedColumnLabel(column)}</th>
                            )))}
                          </tr>
                        </>
                      ) : (
                        <tr>
                          {columns.map((column) => (
                            <th key={column.id} id="ctitle" className={`sticky top-0 z-10 whitespace-nowrap border border-white bg-[navy] ${headerCellClass} ${alignClass(column.align)} text-center font-bold uppercase text-white print:static`}>{column.label}</th>
                          ))}
                        </tr>
                      )}
                    </thead>
                    <tbody>
                      {rows.map((row, index) => (
                        <tr key={index} className={rowClass(row, index)}>
                          {columns.map((column) => (
                            <td key={column.id} id={column.type === 'number' ? 'decimal' : 'data'} className={`whitespace-nowrap border border-[#cccccc] ${dataCellClass} ${alignClass(column.align)} ${column.type === 'number' ? `text-right ${numberCellClass}` : `text-left ${textCellClass}`} ${reportRowType(row) !== 'detail' && column.id === 'territory' ? 'text-center' : ''}`}>
                              {renderCell(row, column)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="p-8 text-center text-sm text-slate-500">
                {result?.ok ? 'The report ran successfully but returned no rows.' : 'No report output yet.'}
              </div>
            )}
          </div>

        </section>
      </div>
    </div>
  );
}
