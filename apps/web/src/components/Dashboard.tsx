import { useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import ReactECharts from 'echarts-for-react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  Activity,
  AlertCircle,
  BarChart3,
  Building2,
  CalendarClock,
  Database,
  FileText,
  LogOut,
  MapPin,
  PackageCheck,
  RefreshCcw,
  ShieldCheck,
  TrendingUp,
  Users,
} from 'lucide-react';
import { getDashboardSummary, type DashboardSummary } from '../api';
import { ReportsPage } from './ReportsPage';
import { ensureFirebaseSession, getClientFirestore } from '../lib/firebase';
import type { AuthSession } from '../lib/auth';
import { getDisplayClientName } from '../lib/client';

type DashboardProps = {
  session: AuthSession;
  onLogout: () => void;
};

function StatCard({ label, value, helper, icon: Icon }: { label: string; value: string; helper: string; icon: typeof Activity }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-3 text-3xl font-bold tracking-tight text-slate-950">{value}</p>
          <p className="mt-2 text-xs text-slate-500">{helper}</p>
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-brand-600">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function formatMetric(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat().format(value);
}

function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return '—';
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)}%`;
}

function EmptyPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 p-6 text-center">
      <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
        <Database className="h-5 w-5" />
      </div>
      <p className="font-semibold text-slate-900">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
    </div>
  );
}


function formatMapTitleDate(date: string) {
  return new Intl.DateTimeFormat('en-PH', { month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T00:00:00.000Z`));
}

function CallMap({ summary }: { summary: DashboardSummary | null }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const selectedNodeRef = useRef<Record<string, [number, number]>>({});
  const [selectedDate, setSelectedDate] = useState<string>(() => new Date().toLocaleDateString('en-CA'));
  const [selectedTerritory, setSelectedTerritory] = useState<string | null>(null);
  const mapboxToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined;
  const mapData = summary?.callMap ?? null;
  const availableDates = useMemo(() => Object.keys(mapData?.days ?? {}).sort(), [mapData?.days]);

  useEffect(() => {
    if (mapData?.selectedDate) setSelectedDate(mapData.selectedDate);
  }, [mapData?.selectedDate]);

  const selectedDay = mapData?.days?.[selectedDate] ?? null;
  const nodes = useMemo(() => selectedDay?.nodes ?? [], [selectedDay?.nodes]);
  const calls = selectedDay?.calls ?? [];
  const territories = selectedDay?.territories ?? [];
  const selectedTerritoryDetail = territories.find((territory) => territory.territoryId === selectedTerritory) ?? territories[0] ?? null;
  const panelTerritoryId = selectedTerritory ?? selectedTerritoryDetail?.territoryId ?? null;
  const panelCalls = panelTerritoryId ? calls.filter((call) => call.territoryId === panelTerritoryId) : [];

  function focusBounds(bounds: [number, number, number, number] | null | undefined) {
    const map = mapRef.current;
    if (!map || !bounds) return;
    map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 72, maxZoom: 15, duration: 500 });
  }

  function focusNode(nodeId: string | null) {
    const map = mapRef.current;
    if (!map || !nodeId) return;
    const lngLat = selectedNodeRef.current[nodeId];
    if (!lngLat) return;
    map.flyTo({ center: lngLat, zoom: Math.max(map.getZoom(), 15), duration: 500 });
  }

  useEffect(() => {
    if (!containerRef.current || !mapboxToken || mapRef.current) return;
    mapboxgl.accessToken = mapboxToken;
    mapRef.current = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/streets-v11',
      center: [120.9842, 14.5995],
      zoom: 11,
      attributionControl: false,
    });
    mapRef.current.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
    mapRef.current.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');

    return () => {
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [mapboxToken, nodes.length]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedDay) return;

    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = [];
    selectedNodeRef.current = {};

    for (const sourceId of ['call-sequences']) {
      if (map.getLayer(sourceId)) map.removeLayer(sourceId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    }

    const sequenceFeatures = selectedDay.sequences.map((sequence) => ({
      type: 'Feature' as const,
      properties: { territoryId: sequence.territoryId, color: sequence.color },
      geometry: { type: 'LineString' as const, coordinates: sequence.coordinates },
    }));

    const addLines = () => {
      if (map.getSource('call-sequences')) return;
      map.addSource('call-sequences', { type: 'geojson', data: { type: 'FeatureCollection', features: sequenceFeatures } });
      map.addLayer({
        id: 'call-sequences',
        type: 'line',
        source: 'call-sequences',
        paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.72 },
      });
    };
    if (map.loaded()) addLines(); else map.once('load', addLines);

    const bounds = new mapboxgl.LngLatBounds();
    nodes.forEach((node) => {
      const territory = territories.find((item) => item.territoryId === node.territoryId);
      const color = territory?.color ?? '#2563eb';
      const nodeCalls = calls.filter((call) => node.callIds.includes(call.id));
      const lngLat: [number, number] = [node.longitude, node.latitude];
      selectedNodeRef.current[node.id] = lngLat;
      bounds.extend(lngLat);

      const markerNode = document.createElement('div');
      markerNode.className = 'flex h-8 min-w-8 items-center justify-center rounded-full border-2 border-white px-2 text-[11px] font-bold text-white shadow-lg';
      markerNode.style.background = color;
      markerNode.style.opacity = node.hasInferredCalls ? '0.82' : '1';
      markerNode.textContent = node.callIds.length > 1 ? String(node.callIds.length) : String(node.sequenceStart);

      const popupRows = nodeCalls.map((call) => `
        <div style="border-top:1px solid #e5e7eb; padding-top:6px; margin-top:6px;">
          <div style="font-weight:700;">${call.timeLabel} · ${call.doctorName}</div>
          <div style="color:#475569;">${call.address}</div>
          ${call.gpsStatus !== 'actual' ? '<div style="color:#b45309; font-size:11px;">Approximate location from nearby GPS call</div>' : ''}
        </div>
      `).join('');
      const popup = new mapboxgl.Popup({ offset: 18 }).setHTML(`
        <div style="font-family: Inter, system-ui, sans-serif; font-size: 12px; line-height: 1.45; max-width:260px;">
          <div style="font-weight: 800; color:${color};">${node.territoryId}</div>
          ${popupRows}
        </div>
      `);

      markersRef.current.push(new mapboxgl.Marker({ element: markerNode, anchor: 'center' }).setLngLat(lngLat).setPopup(popup).addTo(map));
    });

    if (nodes.length) map.fitBounds(bounds, { padding: 64, maxZoom: 15, duration: 500 });
  }, [selectedDay, nodes, calls, territories]);

  const selectedTerritoryColor = selectedTerritoryDetail?.color ?? '#2563eb';

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-950">Call Map — {formatMapTitleDate(selectedDate)}</p>
          <p className="mt-1 text-sm text-slate-500">Actual calls by visit sequence using captured or inferred GPS coordinates.</p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="date"
            min={mapData?.cycle.startDate}
            max={mapData?.cycle.endDate}
            value={selectedDate}
            onChange={(event) => setSelectedDate(event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
          />
          <MapPin className="h-5 w-5 text-slate-400" />
        </div>
      </div>

      {territories.length > 1 ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {territories.map((territory) => (
            <button
              key={territory.territoryId}
              type="button"
              onClick={() => {
                setSelectedTerritory(territory.territoryId);
                focusBounds(territory.bounds);
              }}
              title={`${territory.medRepName ?? 'MedRep not available'} · ${territory.territoryDescription ?? 'Territory description not available'}`}
              className="inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition hover:bg-slate-50"
              style={{ borderColor: territory.color, color: territory.color, opacity: territory.faded ? 0.45 : 1 }}
            >
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: territory.color }} />
              {territory.territoryId} · {territory.callCount}
            </button>
          ))}
        </div>
      ) : null}

      {!mapboxToken ? (
        <div className="flex h-[26rem] items-center justify-center rounded-xl bg-slate-50 text-center text-sm text-slate-500">Mapbox access token is not configured.</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          <div className="relative h-[30rem] overflow-hidden rounded-xl border border-slate-200">
            <div ref={containerRef} className="h-full w-full" />
            {!nodes.length ? (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-50/90 text-center text-sm text-slate-500">No geotagged calls found for this date.</div>
            ) : null}
          </div>
          <aside className="max-h-[30rem] overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-slate-900" style={{ color: selectedTerritoryColor }}>{panelTerritoryId ?? 'Territory'}</p>
                <p className="text-xs font-medium text-slate-600">{selectedTerritoryDetail?.medRepName ?? 'MedRep not available'}</p>
                <p className="text-xs text-slate-500">{selectedTerritoryDetail?.territoryDescription ?? 'Territory description not available'} · {panelCalls.length} calls</p>
              </div>
            </div>
            <div className="space-y-2">
              {panelCalls.length ? panelCalls.map((call) => (
                <button key={call.id} type="button" onClick={() => focusNode(call.nodeId)} className="w-full rounded-lg bg-white p-3 text-left text-xs shadow-sm transition hover:ring-2 hover:ring-slate-200">
                  <div className="flex justify-between gap-2 font-semibold text-slate-900">
                    <span>{call.timeLabel}</span>
                    <span>#{call.sequence}</span>
                  </div>
                  <div className="mt-1 font-medium text-slate-700">{call.doctorName}</div>
                  <div className="mt-1 line-clamp-2 text-slate-500">{call.address}</div>
                  {call.gpsStatus !== 'actual' ? <div className="mt-1 text-[11px] font-medium text-amber-700">{call.gpsStatus === 'inferred' ? 'Approximate GPS' : 'No GPS'}</div> : null}
                </button>
              )) : <div className="rounded-lg bg-white p-4 text-sm text-slate-500">No calls for this territory/date.</div>}
            </div>
          </aside>
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">{calls.length} calls · {nodes.length} map nodes. Data is served by the DOXS API with user territory scope applied.</p>
    </div>
  );
}

function ActivityOverviewChart({ summary }: { summary: DashboardSummary | null }) {
  const points = summary?.activityOverview?.points ?? [];
  const option = {
    color: ['#2563eb', '#10b981'],
    tooltip: { trigger: 'axis' },
    legend: { top: 0, data: ['Target Calls', 'Actual Calls'] },
    grid: { top: 42, left: 38, right: 16, bottom: 50 },
    xAxis: {
      type: 'category',
      name: summary?.activityOverview?.xAxisTitle ?? '',
      nameLocation: 'middle',
      nameGap: 28,
      nameTextStyle: { color: '#64748b', fontWeight: 600 },
      data: points.map((point) => point.label),
      axisLabel: { interval: 0, color: '#64748b' },
      axisTick: { alignWithLabel: true },
    },
    yAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#64748b' }, splitLine: { lineStyle: { color: '#e2e8f0' } } },
    series: [
      {
        name: 'Target Calls',
        type: 'line',
        smooth: false,
        symbolSize: 6,
        data: points.map((point) => point.targetCalls),
        areaStyle: { opacity: 0.16 },
        lineStyle: { width: 3 },
        emphasis: { focus: 'series' },
      },
      {
        name: 'Actual Calls',
        type: 'line',
        smooth: false,
        symbolSize: 6,
        data: points.map((point) => point.actualCalls),
        areaStyle: { opacity: 0.18 },
        lineStyle: { width: 3 },
        emphasis: { focus: 'series' },
      },
    ],
  };

  if (!points.length) {
    return <div className="flex h-64 items-center justify-center rounded-xl bg-slate-50 text-sm text-slate-500">Activity series is not available yet.</div>;
  }

  return <ReactECharts option={option} style={{ height: 280, width: '100%' }} notMerge lazyUpdate />;
}

export function Dashboard({ session, onLogout }: DashboardProps) {
  const activeClientName = getDisplayClientName(session.clientSlug);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [subscriptionStatus, setSubscriptionStatus] = useState<'pending' | 'subscribed' | 'api-only'>('pending');
  const [activeSection, setActiveSection] = useState<'dashboard' | 'reports'>('dashboard');

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    async function loadDashboard() {
      setIsLoading(true);
      setSubscriptionStatus('pending');
      try {
        const result = await getDashboardSummary();
        if (cancelled) return;
        setSummary(result);

        try {
          const firebaseReady = await ensureFirebaseSession();
          const firestore = getClientFirestore();
          const cachePath = result.cache?.cachePath;
          if (!firebaseReady || !firestore || !cachePath) {
            setSubscriptionStatus('api-only');
            return;
          }

          unsubscribe = onSnapshot(
            doc(firestore, cachePath),
            (snapshot) => {
              if (!snapshot.exists()) return;
              setSummary(snapshot.data() as DashboardSummary);
              setSubscriptionStatus('subscribed');
            },
            () => {
              setSubscriptionStatus('api-only');
            },
          );
        } catch {
          if (!cancelled) setSubscriptionStatus('api-only');
        }
      } catch {
        if (!cancelled) {
          setSummary(null);
          setSubscriptionStatus('api-only');
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadDashboard();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const mssqlReady = summary?.dataSource.status === 'configured';

  return (
    <main className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <div>
            <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-brand-600">
              <span>{activeClientName} Console</span>
              <span className="text-slate-300">•</span>
              <span className="inline-flex items-center gap-1 text-emerald-600"><ShieldCheck className="h-4 w-4" /> Authenticated</span>
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">{activeSection === 'dashboard' ? 'Dashboard' : 'Reports'}</h1>
            <p className="mt-1 text-sm text-slate-500">Welcome, {session.user.displayName}. This workspace is scoped to {activeClientName}.</p>
          </div>
          <button className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50" onClick={onLogout}>
            <LogOut className="h-4 w-4" /> Logout
          </button>
        </div>
      </header>

      <section className="mx-auto max-w-7xl space-y-6 px-4 py-6 lg:px-8">
        <div className="flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          <button
            type="button"
            onClick={() => setActiveSection('dashboard')}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${activeSection === 'dashboard' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            Dashboard
          </button>
          <button
            type="button"
            onClick={() => setActiveSection('reports')}
            className={`rounded-xl px-4 py-2 text-sm font-semibold transition ${activeSection === 'reports' ? 'bg-brand-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-50'}`}
          >
            Reports
          </button>
        </div>

        {activeSection === 'reports' ? <ReportsPage clientName={activeClientName} /> : <>
        <div className={`rounded-2xl border p-4 text-sm ${mssqlReady ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>
          <div className="flex gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-none" />
            <div>
              <p className="font-semibold">{mssqlReady ? 'Live MSSQL metrics loaded' : 'MSSQL data source pending per client'}</p>
              <p className="mt-1 leading-6">Dashboard metrics are refreshed through the API, cached by business-rule scope in Firestore, and the browser subscribes to the cache for live updates.</p>
            </div>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Target Calls" value={formatMetric(summary?.metrics.targetCalls)} helper="Planned itinerary rows, month-to-date" icon={FileText} />
          <StatCard label="Actual Calls" value={formatMetric(summary?.metrics.actualCalls)} helper="Visited itinerary rows, month-to-date" icon={Users} />
          <StatCard label="Call Rate" value={formatPercent(summary?.metrics.callRate)} helper="Actual calls ÷ target calls" icon={TrendingUp} />
          <StatCard
            label="Doctors Reached"
            value={formatPercent(summary?.metrics.doctorsReachedRate)}
            helper={`${formatMetric(summary?.metrics.doctorsReached)} / ${formatMetric(summary?.metrics.doctorsPlanned)} planned doctors to date`}
            icon={RefreshCcw}
          />
        </div>

        <div className="grid gap-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-950">Activity overview</p>
                <p className="mt-1 text-sm text-slate-500">
                  Target and actual calls by day for the current cycle{summary?.activityOverview ? ` (${summary.activityOverview.startDate} to ${summary.activityOverview.endDate})` : ''}.
                </p>
              </div>
              <BarChart3 className="h-5 w-5 text-slate-400" />
            </div>
            <ActivityOverviewChart summary={summary} />
          </div>

          <CallMap summary={summary} />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <EmptyPanel title="Recent calls" description="Will show latest completed calls after detail/report queries are approved." />
          <EmptyPanel title="Field activity" description="Will show visit trends and per-user activity once detail query mapping is approved." />
          <EmptyPanel title="Upcoming operational items" description="Will show data freshness, sync alerts, and scheduled reports." />
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400"><CalendarClock className="h-4 w-4" />Business rules + scope cache: Firestore mirror, source data from per-client MSSQL.</div>
        </>}
      </section>
    </main>
  );
}
