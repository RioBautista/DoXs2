import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, Loader2, Search, Stethoscope } from 'lucide-react';
import { getDashboardSummary, getDoctorActualCalls, getDoctors, getDoctorTerritories, type DoctorDirectoryRow } from '../api';
import type { DashboardMetrics, DoctorActualCallsResponse, DoctorDirectoryResponse } from '@doxs/shared';

type DoctorsPageProps = { clientName: string; selectedTerritoryId: string; onTerritoryChange: (territoryId: string) => void };
type DoctorTerritoryOption = { territoryId: string; territoryDescription?: string | null; medRepName?: string | null; metrics?: DashboardMetrics };
const weekLabels = ['Wk 1', 'Wk 2', 'Wk 3', 'Wk 4', 'Wk 5'];
const dayLabels: Record<number, string> = { 1: 'M', 2: 'Tu', 3: 'W', 4: 'Th', 5: 'F' };

function plannedVisitCount(doctor: DoctorDirectoryRow) {
  return doctor.visitDays.filter((day) => day !== null).length;
}

function manilaToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function LoadingState({ label }: { label: string }) {
  return <div className="flex items-center justify-center gap-2 text-sm font-medium text-slate-500"><Loader2 className="h-5 w-5 animate-spin text-brand-600" /><span>{label}</span></div>;
}


function territoryDisplayName(territory: Pick<DoctorTerritoryOption, 'territoryId' | 'territoryDescription'>) {
  return territory.territoryDescription ? `${territory.territoryId} — ${territory.territoryDescription}` : territory.territoryId;
}


export function DoctorsPage({ clientName, selectedTerritoryId, onTerritoryChange }: DoctorsPageProps) {
  const initial = new URLSearchParams(window.location.search);
  const [search, setSearch] = useState(initial.get('search') ?? '');
  const [territories, setTerritories] = useState<string[]>([]);
  const [territoryMetadata, setTerritoryMetadata] = useState<DoctorTerritoryOption[]>([]);
  const [territoriesLoading, setTerritoriesLoading] = useState(true);
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [doctors, setDoctors] = useState<DoctorDirectoryRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isIncrementallyLoading, setIsIncrementallyLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [territoryCount, setTerritoryCount] = useState(0);
  const [totals, setTotals] = useState<DoctorDirectoryResponse['totals']>();
  const [showActualCalls, setShowActualCalls] = useState(false);
  const [actualCalls, setActualCalls] = useState<DoctorActualCallsResponse['calls']>([]);
  const [actualCycle, setActualCycle] = useState<DoctorActualCallsResponse['cycle']>(null);
  const [actualCallsLoading, setActualCallsLoading] = useState(false);
  const [actualCallsLoaded, setActualCallsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void getDoctorTerritories()
      .then((items) => {
        if (cancelled) return;
        setTerritories(items);
        const requestedTerritory = initial.get('territory');
        const nextTerritory = requestedTerritory && items.includes(requestedTerritory) ? requestedTerritory : selectedTerritoryId !== 'ALL' && items.includes(selectedTerritoryId) ? selectedTerritoryId : selectedTerritoryId;
        if (nextTerritory !== selectedTerritoryId) onTerritoryChange(nextTerritory);
      })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load doctor territories.'); })
      .finally(() => { if (!cancelled) setTerritoriesLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    void getDashboardSummary()
      .then((result) => {
        if (cancelled) return;
        setTerritoryMetadata(result.territories ?? []);
      })
      .catch(() => {
        if (!cancelled) setTerritoryMetadata([]);
      });
    return () => { cancelled = true; };
  }, []);

  const effectiveDoctorTerritory = useMemo(() => {
    if (selectedTerritoryId !== 'ALL' && territories.includes(selectedTerritoryId)) return selectedTerritoryId;
    return territories[0] ?? '';
  }, [selectedTerritoryId, territories]);

  const territoryOptions = useMemo<DoctorTerritoryOption[]>(() => {
    const options = new Map<string, DoctorTerritoryOption>();
    for (const territoryId of territories) options.set(territoryId, { territoryId });
    for (const territory of territoryMetadata) {
      if (!territories.includes(territory.territoryId)) continue;
      const existing = options.get(territory.territoryId);
      options.set(territory.territoryId, { ...existing, ...territory });
    }
    return [...options.values()].sort((a, b) => a.territoryId.localeCompare(b.territoryId));
  }, [territories, territoryMetadata]);
  const selectedTerritoryOption = selectedTerritoryId === 'ALL' ? null : territoryOptions.find((territory) => territory.territoryId === selectedTerritoryId) ?? null;

  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedTerritoryId !== 'ALL') params.set('territory', selectedTerritoryId);
    if (debouncedSearch) params.set('search', debouncedSearch);
    window.history.replaceState(null, '', `/doctors${params.size ? `?${params.toString()}` : ''}`);

    if (!effectiveDoctorTerritory) return;

    let cancelled = false;
    setIsLoading(true);
    setIsIncrementallyLoading(false);
    setDoctors([]);
    setError(null);
    setTotals(undefined);

    void (async () => {
      let cursor: string | undefined;
      let firstBatch = true;
      try {
        do {
          const result = await getDoctors({
            territory: effectiveDoctorTerritory,
            search: debouncedSearch || undefined,
            cursor,
            limit: 10,
          });
          if (cancelled) return;

          setDoctors((current) => firstBatch ? result.doctors : [...current, ...result.doctors]);
          setTerritoryCount(result.territoryCount);
          setTotals(result.totals);
          cursor = result.nextCursor ?? undefined;

          if (firstBatch) {
            firstBatch = false;
            setIsLoading(false);
          }
          setIsIncrementallyLoading(result.hasMore);

          if (result.hasMore) {
            await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
          }
        } while (!cancelled && cursor);
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Doctor directory request failed.');
      } finally {
        if (!cancelled) {
          setIsLoading(false);
          setIsIncrementallyLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [debouncedSearch, effectiveDoctorTerritory, selectedTerritoryId]);

  useEffect(() => {
    if (!showActualCalls || !effectiveDoctorTerritory) return;
    let cancelled = false;
    setActualCallsLoading(true);
    setActualCallsLoaded(false);
    setError(null);
    void getDoctorActualCalls(effectiveDoctorTerritory)
      .then((result) => {
        if (cancelled) return;
        setActualCalls(result.calls);
        setActualCycle(result.cycle);
        setActualCallsLoaded(true);
      })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load actual calls.'); })
      .finally(() => { if (!cancelled) setActualCallsLoading(false); });
    return () => { cancelled = true; };
  }, [showActualCalls, effectiveDoctorTerritory]);

  const actualCallCells = new Map<string, number>();
  const actualWeekTotals = [0, 0, 0, 0, 0];
  if (showActualCalls && actualCycle) {
    const cycleStart = new Date(`${actualCycle.startDate}T00:00:00.000Z`).getTime();
    for (const call of actualCalls) {
      const callDate = new Date(`${call.callDate}T00:00:00.000Z`);
      const dayNumber = callDate.getUTCDay();
      const weekIndex = Math.floor((Date.UTC(callDate.getUTCFullYear(), callDate.getUTCMonth(), callDate.getUTCDate()) - cycleStart) / (7 * 24 * 60 * 60 * 1000));
      if (weekIndex < 0 || weekIndex >= 5) continue;
      actualWeekTotals[weekIndex] += 1;
      if (dayNumber < 1 || dayNumber > 5) continue;
      const key = `${call.doctorId}:${weekIndex}:${dayNumber}`;
      actualCallCells.set(key, (actualCallCells.get(key) ?? 0) + 1);
    }
  }

  const loadedDayTotals = weekLabels.map((_, weekIndex) => [1, 2, 3, 4, 5].map(
    (day) => doctors.filter((doctor) => doctor.visitDays[weekIndex] === day).length,
  ));
  const dayTotals = totals?.byWeekDay ?? loadedDayTotals;
  const grandTotal = totals?.grandTotal ?? doctors.reduce((total, doctor) => total + plannedVisitCount(doctor), 0);
  const actualGrandTotal = actualWeekTotals.reduce((sum, count) => sum + count, 0);
  const doctorsWithActualCalls = new Set(actualCalls.map((call) => call.doctorId));
  const todayDate = new Date(`${manilaToday()}T00:00:00.000Z`);
  const fallbackCycleStart = Date.UTC(todayDate.getUTCFullYear(), todayDate.getUTCMonth(), 1);
  const todayCycleStart = actualCycle ? new Date(`${actualCycle.startDate}T00:00:00.000Z`).getTime() : fallbackCycleStart;
  const todayWeekIndex = Math.floor((todayDate.getTime() - todayCycleStart) / (7 * 24 * 60 * 60 * 1000));
  const todayDayNumber = todayDate.getUTCDay();
  const isTodayColumn = (weekIndex: number, dayNumber: number) => weekIndex === todayWeekIndex && dayNumber === todayDayNumber;

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-blue-50 text-brand-600"><Stethoscope className="h-5 w-5" /></div>
            <div>
              <h2 className="text-lg font-bold text-slate-950">Doctors / Territory Master List</h2>
              <p className="mt-1 text-sm text-slate-500">Browse the {clientName} doctor list using the same territory scope as Dashboard.</p>
            </div>
          </div>
          <label className="relative block w-full lg:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search surname, first name, or MD ID" className="w-full rounded-xl border border-slate-300 py-2.5 pl-10 pr-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-blue-100" />
          </label>
        </div>
        <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-950">Dashboard territory scope</p>
              <p className="mt-1 text-sm text-slate-500">Doctors uses the same saved territory selection as Dashboard.</p>
            </div>
            <label className="flex min-w-72 flex-col gap-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Territory
              <select
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold normal-case tracking-normal text-slate-700 shadow-sm outline-none transition focus:border-brand-500 focus:ring-4 focus:ring-blue-100"
                value={selectedTerritoryId}
                onChange={(event) => onTerritoryChange(event.target.value)}
                disabled={territoriesLoading || !territories.length}
              >
                <option value="ALL">(ALL) All territories</option>
                {territoryOptions.map((territory) => <option key={territory.territoryId} value={territory.territoryId}>{territoryDisplayName(territory)}</option>)}
              </select>
            </label>
          </div>
          {territoriesLoading ? <div className="mt-4 flex justify-start py-1"><LoadingState label="Loading assigned territories…" /></div> : territories.length ? (
            <>
              {selectedTerritoryOption ? (
                <div className="mt-4 grid gap-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-600 md:grid-cols-3">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Territory</p>
                    <p className="mt-1 font-bold text-slate-950">{selectedTerritoryOption.territoryId}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Territory name</p>
                    <p className="mt-1 font-semibold text-slate-800">{selectedTerritoryOption.territoryDescription ?? 'Not available yet'}</p>
                  </div>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">MedRep</p>
                    <p className="mt-1 font-semibold text-slate-800">{selectedTerritoryOption.medRepName ?? 'Not available yet'}</p>
                  </div>
                </div>
              ) : null}
              {selectedTerritoryId === 'ALL' ? <p className="mt-3 text-xs text-slate-500">Dashboard is set to all territories. Doctor TML preview is showing {effectiveDoctorTerritory} because the doctor list loads one territory at a time.</p> : null}
            </>
          ) : <p className="mt-4 text-sm text-slate-500">No assigned territories were found for this account.</p>}
        </div>
      </section>

      {error ? <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle className="h-5 w-5 flex-none" /><span>{error}</span></div> : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3 text-xs text-slate-500">
          <span className="flex items-center gap-2">{isLoading || isIncrementallyLoading ? <Loader2 className="h-4 w-4 animate-spin text-brand-600" /> : null}{isLoading ? 'Loading doctors…' : `${doctors.length} doctor-territory record${doctors.length === 1 ? '' : 's'} loaded${isIncrementallyLoading ? '; loading more…' : ''}`}</span>
          <div className="flex items-center gap-4">
            <label className="flex cursor-pointer items-center gap-2 font-semibold text-slate-700">
              <input type="checkbox" checked={showActualCalls} onChange={(event) => setShowActualCalls(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
              <span>Show actual calls</span>
            </label>
            <span>{effectiveDoctorTerritory ? `Territory ${effectiveDoctorTerritory}${selectedTerritoryId === 'ALL' ? ' · dashboard ALL preview' : ''}` : territoryCount ? `${territoryCount} territories in scope` : 'Loading territory scope…'}</span>
          </div>
        </div>
        {showActualCalls && actualCallsLoading ? <div className="border-b border-slate-100 bg-emerald-50/40 px-5 py-3"><LoadingState label={`Checking actual-call count for ${effectiveDoctorTerritory}…`} /></div> : null}
        {showActualCalls && actualCallsLoaded && !actualCallsLoading && actualCalls.length === 0 ? <div className="border-b border-amber-100 bg-amber-50 px-5 py-3 text-center text-sm text-amber-800">Checked the current cycle: no actual calls were found for territory {effectiveDoctorTerritory}.</div> : null}
        {isLoading ? <div className="p-12"><LoadingState label={`Loading and counting doctors for ${effectiveDoctorTerritory}…`} /></div> : null}
        {!isLoading && !doctors.length && !error ? <div className="p-10 text-center"><p className="text-sm font-semibold text-slate-700">No matching doctors to display.</p><p className="mt-1 text-xs text-slate-500">The territory doctor count was checked after loading. Try clearing the search filter.</p></div> : null}
        <div className="max-h-[65vh] overflow-auto">
          <div className="min-w-[920px]">
            <div className="sticky top-0 z-10 grid grid-cols-[minmax(250px,1fr)_82px_repeat(5,minmax(105px,.55fr))] border-b border-slate-300 bg-white text-xs font-semibold text-slate-700">
              <div className="flex items-center px-4 py-3">Doctor / Territory</div>
              <div className="flex items-center justify-center border-l border-slate-200 px-2 py-3">Frequency</div>
              {weekLabels.map((week, weekIndex) => (
                <div key={week} className={`border-l border-slate-300 ${weekIndex % 2 ? 'bg-indigo-100' : 'bg-blue-50'}`}>
                  <div className="border-b border-slate-300 px-2 py-1.5 text-center">{week}</div>
                  <div className="grid grid-cols-5 text-[10px] font-medium text-slate-500">
                    {['M', 'Tu', 'W', 'Th', 'F'].map((day, dayIndex) => <div key={day} className={`border-l border-slate-200 px-1 py-1 text-center first:border-l-0 ${isTodayColumn(weekIndex, dayIndex + 1) ? 'bg-emerald-50 text-emerald-800' : ''}`}>{day}</div>)}
                  </div>
                  <div className="grid grid-cols-5 border-t border-slate-200 text-[10px] font-bold text-slate-700">
                    {dayTotals[weekIndex].map((total, dayIndex) => <div key={dayIndex} className={`border-l border-slate-200 px-1 py-1 text-center first:border-l-0 ${isTodayColumn(weekIndex, dayIndex + 1) ? 'bg-emerald-50 text-emerald-800' : ''}`}>{total}</div>)}
                  </div>
                </div>
              ))}
            </div>
            <div className="divide-y divide-slate-100">
              {doctors.map((doctor) => {
                const planned = plannedVisitCount(doctor);
                const mismatch = doctor.frequency !== null && doctor.frequency !== planned;
                const hasNoActualCalls = showActualCalls && actualCallsLoaded && !actualCallsLoading && !doctorsWithActualCalls.has(doctor.doctorId);
                return (
                  <article key={`${doctor.doctorId}:${doctor.territoryId}`} className={`grid grid-cols-[minmax(250px,1fr)_82px_repeat(5,minmax(105px,.55fr))] ${hasNoActualCalls ? 'bg-red-50/70 hover:bg-red-50' : 'hover:bg-slate-50'}`}>
                    <div className="min-w-0 px-4 py-2.5">
                      <p className="truncate text-sm font-semibold text-slate-950">{doctor.displayName || doctor.doctorId}</p>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">{doctor.doctorId} · {doctor.territoryId} · {[doctor.specialtyCode, doctor.classCode && `Class ${doctor.classCode}`].filter(Boolean).join(' · ') || 'No classification'}</p>
                    </div>
                    <div className="flex items-center justify-center border-l border-slate-200 px-2 py-2">
                      <span title={mismatch ? `${planned} planned visits do not match ${doctor.frequency}× frequency` : undefined} className={`rounded-md px-2 py-1 text-xs font-bold ${mismatch ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-700'}`}>{doctor.frequency ?? '—'}×</span>
                    </div>
                    {doctor.visitDays.map((day, weekIndex) => (
                      <div key={weekIndex} className={`grid grid-cols-5 border-l border-slate-300 ${hasNoActualCalls ? 'bg-red-50/70' : weekIndex % 2 ? 'bg-indigo-50/70' : 'bg-blue-50/60'}`}>
                        {[1, 2, 3, 4, 5].map((dayNumber) => {
                          const actualCount = actualCallCells.get(`${doctor.doctorId}:${weekIndex}:${dayNumber}`) ?? 0;
                          const isPlanned = day === dayNumber;
                          return (
                            <div key={dayNumber} className={`flex min-h-11 items-center justify-center border-l border-slate-200 first:border-l-0 ${isTodayColumn(weekIndex, dayNumber) ? 'bg-emerald-50/80' : ''}`}>
                              {actualCount ? (
                                <span title={`${actualCount} actual call${actualCount === 1 ? '' : 's'} · ${isPlanned ? 'As scheduled' : 'Not scheduled'}`} className={`flex h-6 w-6 items-center justify-center rounded-full text-white shadow-sm ${isPlanned ? 'bg-emerald-500' : 'bg-amber-400'}`}>
                                  <Check className="h-4 w-4 stroke-[3]" />
                                </span>
                              ) : isPlanned ? <span className="flex h-6 w-6 items-center justify-center bg-brand-600 text-[10px] font-bold text-white shadow-sm">{dayLabels[dayNumber]}</span> : null}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </article>
                );
              })}
            </div>
            {doctors.length ? <div className="grid grid-cols-[minmax(250px,1fr)_82px_repeat(5,minmax(105px,.55fr))] border-t border-slate-300 bg-slate-50 text-xs font-bold text-slate-700"><div className="px-4 py-2 text-right">{showActualCalls ? 'Territory total · actual / planned' : 'Territory plan total'}</div><div className="border-l border-slate-200 px-2 py-2 text-center">{showActualCalls ? `${actualCallsLoading ? '…' : actualGrandTotal} / ${grandTotal}` : grandTotal}</div>{weekLabels.map((week, index) => { const plannedWeekTotal = dayTotals[index].reduce((sum, count) => sum + count, 0); return <div key={week} className="border-l border-slate-200 px-2 py-2 text-center">{showActualCalls ? `${actualCallsLoading ? '…' : actualWeekTotals[index]} / ${plannedWeekTotal}` : plannedWeekTotal}</div>; })}</div> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
