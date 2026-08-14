import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AlertCircle, FileText, Loader2, Play, RefreshCcw } from 'lucide-react';
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

function formatCell(value: unknown, format?: string) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'number') {
    const text = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
    return format === 'percent' ? `${text}%` : text;
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
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

  function selectReport(report: ReportDefinitionSummary) {
    setSelectedId(report.id);
    setFilters(initialFilters(report));
    setResult(null);
    setError(null);
  }

  async function handleRun(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedReport) return;
    setIsRunning(true);
    setError(null);
    setResult(null);
    try {
      const response = await runReport(selectedReport.id, filters);
      setResult(response);
      if (!response.ok) setError(response.message ?? 'Report failed.');
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Report request failed.');
    } finally {
      setIsRunning(false);
    }
  }

  const columns = result?.report?.columns?.length ? result.report.columns : selectedReport?.columns ?? [];
  const rows = result?.rows ?? [];

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

        <section className="space-y-6">
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

          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-5">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h3 className="text-base font-bold text-slate-950">Report output</h3>
                  <p className="mt-1 text-sm text-slate-500">
                    {result?.ok ? `${result.rowCount ?? rows.length} rows${result.truncated ? ' · truncated by max rows' : ''}` : 'Run a report to render results.'}
                  </p>
                </div>
                {result?.generatedAt ? <p className="text-xs text-slate-400">Generated {new Date(result.generatedAt).toLocaleString()}</p> : null}
              </div>
            </div>
            {rows.length ? (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      {columns.map((column) => (
                        <th key={column.id} className={`whitespace-nowrap px-4 py-3 ${alignClass(column.align)} text-xs font-bold uppercase tracking-wide text-slate-500`}>{column.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {rows.map((row, index) => (
                      <tr key={index} className="hover:bg-slate-50/80">
                        {columns.map((column) => (
                          <td key={column.id} className={`whitespace-nowrap px-4 py-3 ${alignClass(column.align)} text-slate-700`}>
                            {formatCell(row[column.id], column.format)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
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
