import { useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import ReactECharts from 'echarts-for-react';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import {
  Activity,
  AlertCircle,
  BarChart3,
  CalendarClock,
  Database,
  FileText,
  MapPin,
  RefreshCcw,
  TrendingUp,
  Users,
} from 'lucide-react';
import { getDashboardActivityOverview, getDashboardCallMapScope, getDashboardCallMapTerritoryDate, getDashboardSummary, type DashboardSummary } from '../api';
import type { DashboardActivityOverview, DashboardCallMap, DashboardCallMapDay, DashboardCallMapTerritory } from '@doxs/shared';
import { ensureFirebaseSession, getClientFirestore } from '../lib/firebase';
import type { AuthSession } from '../lib/auth';

type DashboardProps = {
  session: AuthSession;
};

function StatCard({ label, value, helper, icon: Icon, isLoading = false }: { label: string; value: string; helper: string; icon: typeof Activity; isLoading?: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-500">{label}</p>
          {isLoading ? (
            <div className="mt-4 h-8 w-24 animate-pulse rounded-lg bg-slate-200" aria-label={`${label} loading`} />
          ) : (
            <p className="mt-3 text-3xl font-bold tracking-tight text-slate-950">{value}</p>
          )}
          {isLoading ? <div className="mt-3 h-3 w-40 animate-pulse rounded-full bg-slate-100" /> : <p className="mt-2 text-xs text-slate-500">{helper}</p>}
        </div>
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-50 text-brand-600">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function LoadingIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-3 text-sm font-medium text-slate-500" role="status" aria-live="polite">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-slate-300 border-t-brand-600" />
      <span>{label}</span>
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

const TERRITORY_PALETTE = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2', '#be123c', '#4f46e5', '#65a30d', '#c026d3'];

function territoryColor(territoryId: string) {
  let hash = 0;
  for (const char of territoryId) hash = ((hash << 5) - hash + char.charCodeAt(0)) | 0;
  return TERRITORY_PALETTE[Math.abs(hash) % TERRITORY_PALETTE.length];
}

function pendingTerritory(territoryId: string): DashboardCallMapTerritory {
  return {
    territoryId,
    color: territoryColor(territoryId),
    medRepName: null,
    territoryDescription: null,
    callCount: 0,
    gpsCallCount: 0,
    hasGpsCalls: false,
    faded: true,
    bounds: null,
  };
}

function emptyCallMapDay(date: string, territoryIds: string[] = []): DashboardCallMapDay {
  return { date, territories: territoryIds.map(pendingTerritory), calls: [], nodes: [], sequences: [] };
}

function mergeCallMapDay(current: DashboardCallMap | null, cycle: DashboardCallMap['cycle'], selectedDate: string, day: DashboardCallMapDay): DashboardCallMap {
  const existingDay = current?.days?.[day.date] ?? emptyCallMapDay(day.date);
  const territoryIds = new Set(day.territories.map((territory) => territory.territoryId));
  const mergedDay: DashboardCallMapDay = {
    date: day.date,
    territories: [...existingDay.territories.filter((territory) => !territoryIds.has(territory.territoryId)), ...day.territories]
      .sort((a, b) => a.territoryId.localeCompare(b.territoryId)),
    calls: [...existingDay.calls.filter((call) => !territoryIds.has(call.territoryId)), ...day.calls]
      .sort((a, b) => a.territoryId.localeCompare(b.territoryId) || a.sequence - b.sequence),
    nodes: [...existingDay.nodes.filter((node) => !territoryIds.has(node.territoryId)), ...day.nodes]
      .sort((a, b) => a.territoryId.localeCompare(b.territoryId) || a.sequenceStart - b.sequenceStart),
    sequences: [...existingDay.sequences.filter((sequence) => !territoryIds.has(sequence.territoryId)), ...day.sequences]
      .sort((a, b) => a.territoryId.localeCompare(b.territoryId)),
  };
  const days = { ...(current?.days ?? {}), [day.date]: mergedDay };
  return {
    selectedDate,
    cycle,
    days,
    points: days[selectedDate]?.calls ?? [],
  };
}

function CallMap({ callMap, status, progress, selectedDate, onDateChange, loadedTerritoryIds, loadingTerritoryIds, onTerritorySelect }: { callMap: DashboardCallMap | null; status: 'loading' | 'loaded' | 'error'; progress?: { loaded: number; total: number }; selectedDate: string; onDateChange: (date: string) => void; loadedTerritoryIds: Set<string>; loadingTerritoryIds: Set<string>; onTerritorySelect: (territoryId: string) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const selectedNodeRef = useRef<Record<string, [number, number]>>({});
  const [selectedTerritory, setSelectedTerritory] = useState<string | null>(null);
  const mapboxToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN as string | undefined;
  const [mapError, setMapError] = useState<string | null>(null);
  const mapData = callMap?.cycle && callMap?.days ? callMap : null;
  const selectedDay = mapData?.days?.[selectedDate] ?? null;
  const nodes = useMemo(() => selectedDay?.nodes ?? [], [selectedDay?.nodes]);
  const calls = useMemo(() => selectedDay?.calls ?? [], [selectedDay?.calls]);
  const territories = useMemo(() => selectedDay?.territories ?? [], [selectedDay?.territories]);
  const selectedTerritoryDetail = territories.find((territory) => territory.territoryId === selectedTerritory) ?? territories[0] ?? null;
  const panelTerritoryId = selectedTerritory ?? selectedTerritoryDetail?.territoryId ?? null;
  const panelCalls = panelTerritoryId ? calls.filter((call) => call.territoryId === panelTerritoryId) : [];

  function zoomOutMap() {
    const map = mapRef.current;
    if (!map) return;
    if (nodes.length) {
      const bounds = new mapboxgl.LngLatBounds();
      nodes.forEach((node) => bounds.extend([node.longitude, node.latitude]));
      map.fitBounds(bounds, { padding: 64, maxZoom: 12, duration: 500 });
      return;
    }
    map.flyTo({ center: [120.9842, 14.5995], zoom: 9, duration: 500 });
  }

  function focusBounds(bounds: [number, number, number, number] | null | undefined) {
    const map = mapRef.current;
    if (!map || !bounds) {
      zoomOutMap();
      return;
    }
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
    if (!containerRef.current || mapRef.current) return;
    try {
      if (mapboxToken) mapboxgl.accessToken = mapboxToken;
      mapRef.current = new mapboxgl.Map({
      container: containerRef.current,
      style: mapboxToken ? 'mapbox://styles/mapbox/streets-v11' : {
        version: 8,
        sources: {
          'osm-raster': {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm-raster', type: 'raster', source: 'osm-raster' }],
      },
      center: [120.9842, 14.5995],
      zoom: 11,
      attributionControl: false,
    });
      mapRef.current.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-right');
      mapRef.current.addControl(new mapboxgl.AttributionControl({ compact: true }), 'bottom-right');
      setMapError(null);
    } catch (error) {
      setMapError(error instanceof Error ? error.message : 'Map could not initialize in this browser.');
    }

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

    const sequenceFeatures = (selectedDay.sequences ?? []).map((sequence) => ({
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
            min={mapData?.cycle?.startDate}
            max={mapData?.cycle?.endDate}
            value={selectedDate}
            onChange={(event) => onDateChange(event.target.value)}
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700"
          />
          <MapPin className="h-5 w-5 text-slate-400" />
        </div>
      </div>

      {territories.length > 1 ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {territories.map((territory) => {
            const isLoaded = loadedTerritoryIds.has(territory.territoryId);
            const isLoadingTerritory = loadingTerritoryIds.has(territory.territoryId);
            const hasGpsCall = (territory.gpsCallCount ?? 0) > 0;
            return (
              <button
                key={territory.territoryId}
                type="button"
                onClick={() => {
                  setSelectedTerritory(territory.territoryId);
                  if (!isLoaded) onTerritorySelect(territory.territoryId);
                  if (hasGpsCall) focusBounds(territory.bounds);
                  else zoomOutMap();
                }}
                title={`${territory.medRepName ?? (isLoaded ? 'MedRep not available' : 'Territory metadata loading')} · ${territory.territoryDescription ?? (isLoaded ? 'Territory description not available' : 'Click to load this territory now')}`}
                className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold transition hover:bg-slate-50 ${isLoadingTerritory ? 'ring-2 ring-slate-200' : ''}`}
                style={{ borderColor: territory.color, color: territory.color, opacity: isLoaded ? 1 : 0.45 }}
              >
                {hasGpsCall ? <span className="h-2.5 w-2.5 rounded-full" style={{ background: territory.color }} /> : null}
                {territory.territoryId} · {isLoaded ? territory.callCount : '…'}
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
          {!mapboxToken ? (
            <div className="lg:col-span-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">Mapbox token is not configured for this build, so the call map is using OpenStreetMap tiles as a safe fallback.</div>
          ) : null}
          <div className="relative h-[30rem] overflow-hidden rounded-xl border border-slate-200">
            <div ref={containerRef} className="h-full w-full" />
            {mapError ? (
              <div className="absolute inset-0 flex items-center justify-center bg-red-50/95 p-6 text-center text-sm text-red-700">Map could not initialize: {mapError}</div>
            ) : status === 'loading' && !calls.length ? (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-50/90"><LoadingIndicator label={progress?.total ? `Loading territories ${progress.loaded}/${progress.total}…` : 'Loading call map…'} /></div>
            ) : status === 'error' ? (
              <div className="absolute inset-0 flex items-center justify-center bg-amber-50/95 p-6 text-center text-sm text-amber-700">Call map is still unavailable. Metrics remain visible while the map API recovers.</div>
            ) : !calls.length ? (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-50/90 text-center text-sm text-slate-500">No calls found for this date.</div>
            ) : !nodes.length ? (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-50/90 p-6 text-center text-sm text-slate-500">Calls loaded, but no valid GPS coordinates were found for this date.</div>
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
              {status === 'loading' && panelTerritoryId && !loadedTerritoryIds.has(panelTerritoryId) ? <div className="rounded-lg bg-white p-4"><LoadingIndicator label={loadingTerritoryIds.has(panelTerritoryId) ? `Loading ${panelTerritoryId} now…` : 'Click a territory chip to prioritize it…'} /></div> : panelCalls.length ? panelCalls.map((call) => (
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
      <p className="mt-3 text-xs text-slate-500">{calls.length} calls · {nodes.length} map nodes. {status === 'loading' && progress?.total ? `Loaded ${progress.loaded}/${progress.total} territories. ` : ''}Data is served by territory/date map documents with user territory scope applied.</p>
    </div>
  );
}

function ActivityOverviewChart({ activityOverview, status }: { activityOverview: DashboardActivityOverview | null; status: 'loading' | 'loaded' | 'error' }) {
  const points = activityOverview?.points ?? [];
  const option = {
    color: ['#2563eb', '#10b981'],
    tooltip: { trigger: 'axis' },
    legend: { top: 0, data: ['Target Calls', 'Actual Calls'] },
    grid: { top: 42, left: 38, right: 16, bottom: 50 },
    xAxis: {
      type: 'category',
      name: activityOverview?.xAxisTitle ?? '',
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

  if (status === 'loading') {
    return <div className="flex h-64 items-center justify-center rounded-xl bg-slate-50"><LoadingIndicator label="Loading activity overview…" /></div>;
  }

  if (status === 'error') {
    return <div className="flex h-64 items-center justify-center rounded-xl bg-amber-50 px-6 text-center text-sm text-amber-700">Activity overview is still unavailable. Other dashboard panels continue loading independently.</div>;
  }

  if (!points.length) {
    return <div className="flex h-64 items-center justify-center rounded-xl bg-slate-50 text-sm text-slate-500">Activity series is not available yet.</div>;
  }

  return <ReactECharts option={option} style={{ height: 280, width: '100%' }} notMerge lazyUpdate />;
}

export function Dashboard({ session }: DashboardProps) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [subscriptionStatus, setSubscriptionStatus] = useState<'pending' | 'subscribed' | 'api-only'>('pending');
  const [activityStatus, setActivityStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [callMapStatus, setCallMapStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [activityOverview, setActivityOverview] = useState<DashboardActivityOverview | null>(null);
  const [callMap, setCallMap] = useState<DashboardCallMap | null>(null);
  const [callMapCycle, setCallMapCycle] = useState<DashboardCallMap['cycle'] | null>(null);
  const [callMapTerritories, setCallMapTerritories] = useState<string[]>([]);
  const [selectedCallMapDate, setSelectedCallMapDate] = useState<string>(() => new Date().toLocaleDateString('en-CA'));
  const [callMapLoadedCount, setCallMapLoadedCount] = useState(0);
  const [loadedTerritoryIds, setLoadedTerritoryIds] = useState<Set<string>>(() => new Set());
  const [loadingTerritoryIds, setLoadingTerritoryIds] = useState<Set<string>>(() => new Set());
  const loadTerritoryNowRef = useRef<((territoryId: string) => void) | null>(null);

  useEffect(() => {
    let cancelled = false;

    setIsLoading(true);
    void getDashboardSummary()
      .then((result) => {
        if (!cancelled) setSummary(result);
      })
      .catch(() => {
        if (!cancelled) {
          setSummary(null);
          setSubscriptionStatus('api-only');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    setActivityStatus('loading');
    void getDashboardActivityOverview()
      .then((activityResult) => {
        if (cancelled) return;
        if (activityResult.ok && activityResult.activityOverview) {
          setActivityOverview(activityResult.activityOverview ?? null);
          setActivityStatus('loaded');
        } else {
          setActivityOverview(null);
          setActivityStatus(activityResult.ok ? 'loaded' : 'error');
        }
      })
      .catch(() => {
        if (!cancelled) setActivityStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    setCallMapStatus('loading');
    void getDashboardCallMapScope()
      .then((scopeResult) => {
        if (cancelled) return;
        if (scopeResult.ok && scopeResult.cycle && scopeResult.selectedDate) {
          setCallMapCycle(scopeResult.cycle);
          setSelectedCallMapDate(scopeResult.selectedDate);
          setCallMapTerritories(scopeResult.territories ?? []);
        } else {
          setCallMapCycle(null);
          setCallMapTerritories([]);
          setCallMapLoadedCount(0);
          setLoadedTerritoryIds(new Set());
          setLoadingTerritoryIds(new Set());
          setCallMapStatus(scopeResult.ok ? 'loaded' : 'error');
        }
      })
      .catch(() => {
        if (!cancelled) setCallMapStatus('error');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;
    const cachePath = summary?.cache?.cachePath;

    setSubscriptionStatus('pending');
    if (!cachePath) {
      setSubscriptionStatus(summary ? 'api-only' : 'pending');
      return () => {
        cancelled = true;
      };
    }

    void (async () => {
      try {
        const firebaseReady = await ensureFirebaseSession();
        const firestore = getClientFirestore();
        if (cancelled) return;
        if (!firebaseReady || !firestore) {
          setSubscriptionStatus('api-only');
          return;
        }

        unsubscribe = onSnapshot(
          doc(firestore, cachePath),
          (snapshot) => {
            if (!snapshot.exists()) return;
            const cachedSummary = snapshot.data() as DashboardSummary;
            setSummary(cachedSummary);
            setSubscriptionStatus('subscribed');
          },
          () => {
            setSubscriptionStatus('api-only');
          },
        );
      } catch {
        if (!cancelled) setSubscriptionStatus('api-only');
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [summary?.cache?.cachePath]);

  useEffect(() => {
    if (!callMapCycle || !selectedCallMapDate) return;
    let cancelled = false;
    const territories = [...callMapTerritories];
    const completedTerritories = new Set<string>();
    const inFlightTerritories = new Set<string>();
    let successfulLoads = 0;
    let completedLoads = 0;

    setCallMapLoadedCount(0);
    setLoadedTerritoryIds(new Set());
    setLoadingTerritoryIds(new Set());
    setCallMap({ selectedDate: selectedCallMapDate, cycle: callMapCycle, days: { [selectedCallMapDate]: emptyCallMapDay(selectedCallMapDate, territories) }, points: [] });

    if (!territories.length) {
      setCallMapStatus('loaded');
      loadTerritoryNowRef.current = null;
      return () => { cancelled = true; };
    }

    setCallMapStatus('loading');

    const loadTerritory = async (territoryId: string) => {
      if (cancelled || completedTerritories.has(territoryId) || inFlightTerritories.has(territoryId)) return;
      inFlightTerritories.add(territoryId);
      setLoadingTerritoryIds((current) => new Set(current).add(territoryId));
      try {
        const result = await getDashboardCallMapTerritoryDate(territoryId, selectedCallMapDate);
        if (cancelled) return;
        if (result.ok && result.day) {
          successfulLoads += 1;
          setCallMap((current) => mergeCallMapDay(current, result.cycle ?? callMapCycle, selectedCallMapDate, result.day!));
        }
      } finally {
        inFlightTerritories.delete(territoryId);
        if (!cancelled) {
          completedTerritories.add(territoryId);
          completedLoads += 1;
          setLoadedTerritoryIds((current) => new Set(current).add(territoryId));
          setLoadingTerritoryIds((current) => {
            const next = new Set(current);
            next.delete(territoryId);
            return next;
          });
          setCallMapLoadedCount(completedLoads);
          if (completedLoads >= territories.length) setCallMapStatus(successfulLoads > 0 ? 'loaded' : 'error');
        }
      }
    };

    loadTerritoryNowRef.current = (territoryId: string) => {
      if (!territories.includes(territoryId)) return;
      void loadTerritory(territoryId);
    };

    void (async () => {
      for (const territoryId of territories) {
        if (cancelled) return;
        await loadTerritory(territoryId);
      }
    })();

    return () => {
      cancelled = true;
      loadTerritoryNowRef.current = null;
    };
  }, [callMapCycle, callMapTerritories, selectedCallMapDate]);

  const mssqlReady = summary?.dataSource?.status === 'configured';

  return (
    <>
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
          <StatCard label="Target Calls" value={formatMetric(summary?.metrics?.targetCalls)} helper="Planned itinerary rows, month-to-date" icon={FileText} isLoading={isLoading} />
          <StatCard label="Actual Calls" value={formatMetric(summary?.metrics?.actualCalls)} helper="Visited itinerary rows, month-to-date" icon={Users} isLoading={isLoading} />
          <StatCard label="Call Rate" value={formatPercent(summary?.metrics?.callRate)} helper="Actual calls ÷ target calls" icon={TrendingUp} isLoading={isLoading} />
          <StatCard
            label="Doctors Reached"
            value={formatPercent(summary?.metrics?.doctorsReachedRate)}
            helper={`${formatMetric(summary?.metrics?.doctorsReached)} / ${formatMetric(summary?.metrics?.doctorsPlanned)} planned doctors to date`}
            icon={RefreshCcw}
            isLoading={isLoading}
          />
        </div>

        <div className="grid gap-6">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-semibold text-slate-950">Activity overview</p>
                <p className="mt-1 text-sm text-slate-500">
                  Target and actual calls by day for the current cycle{activityOverview ? ` (${activityOverview.startDate} to ${activityOverview.endDate})` : ''}.
                </p>
              </div>
              <BarChart3 className="h-5 w-5 text-slate-400" />
            </div>
            <ActivityOverviewChart activityOverview={activityOverview} status={activityStatus} />
          </div>

          <CallMap callMap={callMap} status={callMapStatus} progress={{ loaded: callMapLoadedCount, total: callMapTerritories.length }} selectedDate={selectedCallMapDate} onDateChange={setSelectedCallMapDate} loadedTerritoryIds={loadedTerritoryIds} loadingTerritoryIds={loadingTerritoryIds} onTerritorySelect={(territoryId) => loadTerritoryNowRef.current?.(territoryId)} />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <EmptyPanel title="Recent calls" description="Will show latest completed calls after detail/report queries are approved." />
          <EmptyPanel title="Field activity" description="Will show visit trends and per-user activity once detail query mapping is approved." />
          <EmptyPanel title="Upcoming operational items" description="Will show data freshness, sync alerts, and scheduled reports." />
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400"><CalendarClock className="h-4 w-4" />Business rules + scope cache: Firestore mirror, source data from per-client MSSQL.</div>
    </>
  );
}
