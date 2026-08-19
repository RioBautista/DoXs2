import { useEffect, useState } from 'react';
import { AlertCircle, Check, Search, Stethoscope } from 'lucide-react';
import { getDoctorActualCalls, getDoctors, getDoctorTerritories, type DoctorDirectoryRow } from '../api';
import type { DoctorActualCallsResponse, DoctorDirectoryResponse } from '@doxs/shared';

type DoctorsPageProps = { clientName: string };
const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
const weekLabels = ['Wk 1', 'Wk 2', 'Wk 3', 'Wk 4', 'Wk 5'];
const dayLabels: Record<number, string> = { 1: 'M', 2: 'Tu', 3: 'W', 4: 'Th', 5: 'F' };

function plannedVisitCount(doctor: DoctorDirectoryRow) {
  return doctor.visitDays.filter((day) => day !== null).length;
}

export function DoctorsPage({ clientName }: DoctorsPageProps) {
  const initial = new URLSearchParams(window.location.search);
  const [letter, setLetter] = useState(initial.get('letter') ?? '');
  const [search, setSearch] = useState(initial.get('search') ?? '');
  const [territories, setTerritories] = useState<string[]>([]);
  const [selectedTerritory, setSelectedTerritory] = useState(initial.get('territory') ?? '');
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

  useEffect(() => {
    let cancelled = false;
    void getDoctorTerritories()
      .then((items) => {
        if (cancelled) return;
        setTerritories(items);
        setSelectedTerritory((current) => current && items.includes(current) ? current : (items[0] ?? ''));
      })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load doctor territories.'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (selectedTerritory) params.set('territory', selectedTerritory);
    if (letter) params.set('letter', letter);
    if (debouncedSearch) params.set('search', debouncedSearch);
    window.history.replaceState(null, '', `/doctors${params.size ? `?${params.toString()}` : ''}`);

    if (!selectedTerritory) return;

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
            territory: selectedTerritory,
            letter: letter || undefined,
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
  }, [letter, debouncedSearch, selectedTerritory]);

  useEffect(() => {
    if (!showActualCalls || !selectedTerritory) return;
    let cancelled = false;
    setActualCallsLoading(true);
    setError(null);
    void getDoctorActualCalls(selectedTerritory)
      .then((result) => {
        if (cancelled) return;
        setActualCalls(result.calls);
        setActualCycle(result.cycle);
      })
      .catch((reason) => { if (!cancelled) setError(reason instanceof Error ? reason.message : 'Could not load actual calls.'); })
      .finally(() => { if (!cancelled) setActualCallsLoading(false); });
    return () => { cancelled = true; };
  }, [showActualCalls, selectedTerritory]);

  const actualCallCells = new Map<string, number>();
  if (showActualCalls && actualCycle) {
    const cycleStart = new Date(`${actualCycle.startDate}T00:00:00.000Z`).getTime();
    for (const call of actualCalls) {
      const callDate = new Date(`${call.callDate}T00:00:00.000Z`);
      const dayNumber = callDate.getUTCDay();
      const weekIndex = Math.floor((Date.UTC(callDate.getUTCFullYear(), callDate.getUTCMonth(), callDate.getUTCDate()) - cycleStart) / (7 * 24 * 60 * 60 * 1000));
      if (weekIndex < 0 || weekIndex >= 5 || dayNumber < 1 || dayNumber > 5) continue;
      const key = `${call.doctorId}:${weekIndex}:${dayNumber}`;
      actualCallCells.set(key, (actualCallCells.get(key) ?? 0) + 1);
    }
  }

  const loadedDayTotals = weekLabels.map((_, weekIndex) => [1, 2, 3, 4, 5].map(
    (day) => doctors.filter((doctor) => doctor.visitDays[weekIndex] === day).length,
  ));
  const dayTotals = totals?.byWeekDay ?? loadedDayTotals;
  const grandTotal = totals?.grandTotal ?? doctors.reduce((total, doctor) => total + plannedVisitCount(doctor), 0);

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-blue-50 text-brand-600"><Stethoscope className="h-5 w-5" /></div>
            <div>
              <h2 className="text-lg font-bold text-slate-950">Doctors / Territory Master List</h2>
              <p className="mt-1 text-sm text-slate-500">Browse the {clientName} doctor list within your assigned territory scope.</p>
            </div>
          </div>
          <label className="relative block w-full lg:max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search surname, first name, or MD ID" className="w-full rounded-xl border border-slate-300 py-2.5 pl-10 pr-3 text-sm outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-blue-100" />
          </label>
        </div>
        <div className="mt-5 flex flex-wrap gap-1" aria-label="Filter doctors by surname initial">
          <button type="button" onClick={() => setLetter('')} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${!letter ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>All</button>
          {letters.map((item) => <button key={item} type="button" onClick={() => setLetter(item)} className={`rounded-lg px-2.5 py-1.5 text-xs font-semibold ${letter === item ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{item}</button>)}
        </div>
        <div className="mt-4 border-t border-slate-200 pt-4">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Territory</p>
          <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Doctor territories">
            {territories.map((territory) => <button key={territory} type="button" role="tab" aria-selected={selectedTerritory === territory} onClick={() => setSelectedTerritory(territory)} className={`flex-none rounded-lg border px-3 py-1.5 text-xs font-bold transition ${selectedTerritory === territory ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:bg-blue-50'}`}>{territory}</button>)}
          </div>
        </div>
      </section>

      {error ? <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle className="h-5 w-5 flex-none" /><span>{error}</span></div> : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-3 text-xs text-slate-500">
          <span>{isLoading ? 'Loading doctors…' : `${doctors.length} doctor-territory record${doctors.length === 1 ? '' : 's'} loaded${isIncrementallyLoading ? '…' : ''}`}</span>
          <div className="flex items-center gap-4">
            <label className="flex cursor-pointer items-center gap-2 font-semibold text-slate-700">
              <input type="checkbox" checked={showActualCalls} onChange={(event) => setShowActualCalls(event.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
              <span>{actualCallsLoading ? 'Loading actual calls…' : 'Show actual calls'}</span>
            </label>
            <span>{selectedTerritory ? `Territory ${selectedTerritory}` : territoryCount ? `${territoryCount} territories in scope` : 'Loading territory scope…'}</span>
          </div>
        </div>
        {!isLoading && !doctors.length && !error ? <div className="p-10 text-center text-sm text-slate-500">No doctors match this filter.</div> : null}
        <div className="max-h-[65vh] overflow-auto">
          <div className="min-w-[920px]">
            <div className="sticky top-0 z-10 grid grid-cols-[minmax(250px,1fr)_82px_repeat(5,minmax(105px,.55fr))] border-b border-slate-300 bg-white text-xs font-semibold text-slate-700">
              <div className="flex items-center px-4 py-3">Doctor / Territory</div>
              <div className="flex items-center justify-center border-l border-slate-200 px-2 py-3">Frequency</div>
              {weekLabels.map((week, weekIndex) => (
                <div key={week} className={`border-l border-slate-300 ${weekIndex % 2 ? 'bg-indigo-100' : 'bg-blue-50'}`}>
                  <div className="border-b border-slate-300 px-2 py-1.5 text-center">{week}</div>
                  <div className="grid grid-cols-5 text-[10px] font-medium text-slate-500">
                    {['M', 'Tu', 'W', 'Th', 'F'].map((day) => <div key={day} className="border-l border-slate-200 px-1 py-1 text-center first:border-l-0">{day}</div>)}
                  </div>
                  <div className="grid grid-cols-5 border-t border-slate-200 text-[10px] font-bold text-slate-700">
                    {dayTotals[weekIndex].map((total, dayIndex) => <div key={dayIndex} className="border-l border-slate-200 px-1 py-1 text-center first:border-l-0">{total}</div>)}
                  </div>
                </div>
              ))}
            </div>
            <div className="divide-y divide-slate-100">
              {doctors.map((doctor) => {
                const planned = plannedVisitCount(doctor);
                const mismatch = doctor.frequency !== null && doctor.frequency !== planned;
                return (
                  <article key={`${doctor.doctorId}:${doctor.territoryId}`} className="grid grid-cols-[minmax(250px,1fr)_82px_repeat(5,minmax(105px,.55fr))] hover:bg-slate-50">
                    <div className="min-w-0 px-4 py-2.5">
                      <p className="truncate text-sm font-semibold text-slate-950">{doctor.displayName || doctor.doctorId}</p>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">{doctor.doctorId} · {doctor.territoryId} · {[doctor.specialtyCode, doctor.classCode && `Class ${doctor.classCode}`].filter(Boolean).join(' · ') || 'No classification'}</p>
                    </div>
                    <div className="flex items-center justify-center border-l border-slate-200 px-2 py-2">
                      <span title={mismatch ? `${planned} planned visits do not match ${doctor.frequency}× frequency` : undefined} className={`rounded-md px-2 py-1 text-xs font-bold ${mismatch ? 'bg-red-600 text-white' : 'bg-slate-100 text-slate-700'}`}>{doctor.frequency ?? '—'}×</span>
                    </div>
                    {doctor.visitDays.map((day, weekIndex) => (
                      <div key={weekIndex} className={`grid grid-cols-5 border-l border-slate-300 ${weekIndex % 2 ? 'bg-indigo-50/70' : 'bg-blue-50/60'}`}>
                        {[1, 2, 3, 4, 5].map((dayNumber) => {
                          const actualCount = actualCallCells.get(`${doctor.doctorId}:${weekIndex}:${dayNumber}`) ?? 0;
                          const isPlanned = day === dayNumber;
                          return (
                            <div key={dayNumber} className="flex min-h-11 items-center justify-center border-l border-slate-200 first:border-l-0">
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
            {doctors.length ? <div className="grid grid-cols-[minmax(250px,1fr)_82px_repeat(5,minmax(105px,.55fr))] border-t border-slate-300 bg-slate-50 text-xs font-bold text-slate-700"><div className="px-4 py-2 text-right">Territory plan total</div><div className="border-l border-slate-200 px-2 py-2 text-center">{grandTotal}</div>{weekLabels.map((week, index) => <div key={week} className="border-l border-slate-200 px-2 py-2 text-center">{dayTotals[index].reduce((sum, count) => sum + count, 0)}</div>)}</div> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
