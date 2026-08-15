import { useEffect, useState } from 'react';
import { AlertCircle, Search, Stethoscope } from 'lucide-react';
import { getDoctors, type DoctorDirectoryRow } from '../api';

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
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  const [doctors, setDoctors] = useState<DoctorDirectoryRow[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [territoryCount, setTerritoryCount] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => window.clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (letter) params.set('letter', letter);
    if (debouncedSearch) params.set('search', debouncedSearch);
    window.history.replaceState(null, '', `/doctors${params.size ? `?${params.toString()}` : ''}`);

    let cancelled = false;
    setIsLoading(true);
    setError(null);
    void getDoctors({ letter: letter || undefined, search: debouncedSearch || undefined, limit: 50 })
      .then((result) => {
        if (cancelled) return;
        setDoctors(result.doctors);
        setNextCursor(result.nextCursor);
        setHasMore(result.hasMore);
        setTerritoryCount(result.territoryCount);
      })
      .catch((reason) => {
        if (cancelled) return;
        setDoctors([]);
        setNextCursor(null);
        setHasMore(false);
        setError(reason instanceof Error ? reason.message : 'Doctor directory request failed.');
      })
      .finally(() => { if (!cancelled) setIsLoading(false); });
    return () => { cancelled = true; };
  }, [letter, debouncedSearch]);

  async function loadMore() {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    setError(null);
    try {
      const result = await getDoctors({ letter: letter || undefined, search: debouncedSearch || undefined, cursor: nextCursor, limit: 50 });
      setDoctors((current) => [...current, ...result.doctors]);
      setNextCursor(result.nextCursor);
      setHasMore(result.hasMore);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load more doctors.');
    } finally {
      setIsLoadingMore(false);
    }
  }

  const dayTotals = weekLabels.map((_, weekIndex) => [1, 2, 3, 4, 5].map(
    (day) => doctors.filter((doctor) => doctor.visitDays[weekIndex] === day).length,
  ));
  const grandTotal = doctors.reduce((total, doctor) => total + plannedVisitCount(doctor), 0);

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
      </section>

      {error ? <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700"><AlertCircle className="h-5 w-5 flex-none" /><span>{error}</span></div> : null}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3 text-xs text-slate-500">
          <span>{isLoading ? 'Loading doctors…' : `${doctors.length} doctor-territory record${doctors.length === 1 ? '' : 's'} loaded`}</span>
          <span>{territoryCount ? `${territoryCount} territories in scope` : 'Manager/global scope'}</span>
        </div>
        {!isLoading && !doctors.length && !error ? <div className="p-10 text-center text-sm text-slate-500">No doctors match this filter.</div> : null}
        <div className="overflow-x-auto">
          <div className="min-w-[920px]">
            <div className="sticky top-0 z-10 grid grid-cols-[minmax(250px,1fr)_82px_repeat(5,minmax(105px,.55fr))] border-b border-slate-300 bg-white text-xs font-semibold text-slate-700">
              <div className="flex items-end px-4 py-3">Doctor / Territory</div>
              <div className="flex items-end justify-center border-l border-slate-200 px-2 py-3">Frequency</div>
              {weekLabels.map((week, weekIndex) => (
                <div key={week} className={`border-l border-slate-300 ${weekIndex % 2 ? 'bg-indigo-100' : 'bg-blue-50'}`}>
                  <div className="border-b border-slate-300 px-2 py-1.5 text-center">{week}</div>
                  <div className="grid grid-cols-5 text-[10px] font-medium text-slate-500">
                    {['M', 'Tu', 'W', 'Th', 'F'].map((day, dayIndex) => <div key={day} className="border-l border-slate-200 px-1 py-1 text-center first:border-l-0">{day}<span className="ml-1 font-bold text-slate-700">{dayTotals[weekIndex][dayIndex]}</span></div>)}
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
                      <div key={weekIndex} className={`flex items-center justify-center border-l border-slate-200 px-2 py-2 ${weekIndex % 2 ? 'bg-indigo-50/70' : 'bg-blue-50/60'}`}>
                        <span className={`flex h-7 min-w-9 items-center justify-center rounded-full px-2 text-xs font-bold ${day ? 'bg-brand-600 text-white shadow-sm' : 'border border-dashed border-slate-300 text-slate-300'}`}>{day ? dayLabels[day] : '—'}</span>
                      </div>
                    ))}
                  </article>
                );
              })}
            </div>
            {doctors.length ? <div className="grid grid-cols-[minmax(250px,1fr)_82px_repeat(5,minmax(105px,.55fr))] border-t border-slate-300 bg-slate-50 text-xs font-bold text-slate-700"><div className="px-4 py-2 text-right">Loaded-plan total</div><div className="border-l border-slate-200 px-2 py-2 text-center">{grandTotal}</div>{weekLabels.map((week, index) => <div key={week} className="border-l border-slate-200 px-2 py-2 text-center">{dayTotals[index].reduce((sum, count) => sum + count, 0)}</div>)}</div> : null}
          </div>
        </div>
        {hasMore ? <div className="border-t border-slate-200 p-4 text-center"><button type="button" onClick={() => void loadMore()} disabled={isLoadingMore} className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60">{isLoadingMore ? 'Loading…' : 'Load more doctors'}</button></div> : null}
      </section>
    </div>
  );
}
