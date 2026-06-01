import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Database,
  MessageCircle,
  RefreshCw,
  Shield,
  XCircle,
  ChevronDown,
  ChevronUp,
  Filter,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useClinicPreferences } from '../context/ClinicPreferencesContext';
import { operationalMonitoringService } from '../services/api';
import { canViewOperations, canResolveOperationalEvents } from '../utils/permissions';

// ─── Types ────────────────────────────────────────────────────────────────────

interface HealthData {
  status: 'ok' | 'warning' | 'error';
  database: string;
  whatsapp: { connections: number; connected: number; error: number };
  recentErrors: number;
  unresolvedEvents: number;
  failedSends24h: number;
  lastWebhookAt: string | null;
  lastMessageSentAt: string | null;
}

interface AuditLog {
  id: string;
  organizationId: string;
  clinicId: string | null;
  actorUserId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  description: string | null;
  metadata: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
}

interface AuditLogsResponse {
  total: number;
  page: number;
  limit: number;
  data: AuditLog[];
}

interface OperationalEvent {
  id: string;
  organizationId: string;
  clinicId: string | null;
  severity: 'info' | 'warning' | 'error' | 'critical';
  source: string;
  message: string;
  metadata: Record<string, unknown> | null;
  resolvedAt: string | null;
  resolvedById: string | null;
  createdAt: string;
}

interface EventsResponse {
  total: number;
  page: number;
  limit: number;
  data: OperationalEvent[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function SeverityBadge({ severity }: { severity: string }) {
  const map: Record<string, string> = {
    info:     'bg-blue-100 text-blue-800',
    warning:  'bg-yellow-100 text-yellow-800',
    error:    'bg-red-100 text-red-800',
    critical: 'bg-red-200 text-red-900 font-bold',
  };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${map[severity] ?? 'bg-gray-100 text-gray-700'}`}>
      {severity}
    </span>
  );
}

function StatusBadge({ status }: { status: 'ok' | 'warning' | 'error' | string }) {
  if (status === 'ok')      return <span className="inline-flex items-center gap-1 text-green-600 font-medium"><CheckCircle className="w-4 h-4" /> OK</span>;
  if (status === 'warning') return <span className="inline-flex items-center gap-1 text-yellow-600 font-medium"><AlertTriangle className="w-4 h-4" /> Warning</span>;
  return <span className="inline-flex items-center gap-1 text-red-600 font-medium"><XCircle className="w-4 h-4" /> Error</span>;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function OperationsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { formatDateTime } = useClinicPreferences();
  const fmtDate = (iso: string | null | undefined) => iso ? formatDateTime(iso) : '—';

  // Access guard
  useEffect(() => {
    if (user && !canViewOperations(user)) {
      navigate('/dashboard');
    }
  }, [user, navigate]);

  const [health, setHealth]         = useState<HealthData | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);

  const [auditLogs, setAuditLogs]   = useState<AuditLogsResponse | null>(null);
  const [auditPage, setAuditPage]   = useState(1);
  const [auditFilters, setAuditFilters] = useState({ action: '', entityType: '', actorUserId: '', from: '', to: '' });
  const [auditLoading, setAuditLoading] = useState(false);

  const [events, setEvents]         = useState<EventsResponse | null>(null);
  const [eventPage, setEventPage]   = useState(1);
  const [eventFilters, setEventFilters] = useState({ severity: '', source: '', status: 'unresolved' });
  const [eventsLoading, setEventsLoading] = useState(false);

  const [resolving, setResolving]   = useState<string | null>(null);

  // ── Health ───────────────────────────────────────────────────────────────

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const res = await operationalMonitoringService.getHealth();
      setHealth(res.data);
    } catch {
      // ignore
    } finally {
      setHealthLoading(false);
    }
  }, []);

  // ── Audit Logs ───────────────────────────────────────────────────────────

  const loadAuditLogs = useCallback(async () => {
    setAuditLoading(true);
    try {
      const params: Record<string, unknown> = { page: auditPage, limit: 50 };
      if (auditFilters.action)      params.action      = auditFilters.action;
      if (auditFilters.entityType)  params.entityType  = auditFilters.entityType;
      if (auditFilters.actorUserId) params.actorUserId = auditFilters.actorUserId;
      if (auditFilters.from)        params.from        = auditFilters.from;
      if (auditFilters.to)          params.to          = auditFilters.to;
      const res = await operationalMonitoringService.getAuditLogs(params as any);
      setAuditLogs(res.data);
    } catch {
      // ignore
    } finally {
      setAuditLoading(false);
    }
  }, [auditPage, auditFilters]);

  // ── Events ───────────────────────────────────────────────────────────────

  const loadEvents = useCallback(async () => {
    setEventsLoading(true);
    try {
      const params: Record<string, unknown> = { page: eventPage, limit: 50 };
      if (eventFilters.severity) params.severity = eventFilters.severity;
      if (eventFilters.source)   params.source   = eventFilters.source;
      if (eventFilters.status)   params.status   = eventFilters.status;
      const res = await operationalMonitoringService.getEvents(params as any);
      setEvents(res.data);
    } catch {
      // ignore
    } finally {
      setEventsLoading(false);
    }
  }, [eventPage, eventFilters]);

  useEffect(() => { loadHealth(); }, [loadHealth]);
  useEffect(() => { loadAuditLogs(); }, [loadAuditLogs]);
  useEffect(() => { loadEvents(); }, [loadEvents]);

  // ── Resolve event ────────────────────────────────────────────────────────

  const handleResolve = async (id: string) => {
    if (!canResolveOperationalEvents(user)) return;
    setResolving(id);
    try {
      await operationalMonitoringService.resolveEvent(id);
      await loadEvents();
    } catch {
      // ignore
    } finally {
      setResolving(null);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Shield className="w-7 h-7 text-indigo-600" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Operational Monitoring</h1>
            <p className="text-sm text-gray-500">System health, audit logs and operational events</p>
          </div>
        </div>
        <button
          onClick={() => { loadHealth(); loadAuditLogs(); loadEvents(); }}
          className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg text-sm hover:bg-gray-50"
        >
          <RefreshCw className="w-4 h-4" /> Refresh
        </button>
      </div>

      {/* ── System Health Cards ─────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <Activity className="w-5 h-5 text-indigo-500" /> System Health
        </h2>
        {healthLoading ? (
          <p className="text-gray-400 text-sm">Loading health…</p>
        ) : health ? (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {/* Overall */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 mb-1">Overall Status</p>
              <StatusBadge status={health.status} />
            </div>
            {/* Database */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><Database className="w-3 h-3" /> Database</p>
              <StatusBadge status={health.database} />
            </div>
            {/* WhatsApp */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 mb-1 flex items-center gap-1"><MessageCircle className="w-3 h-3" /> WhatsApp</p>
              <p className="text-sm font-medium">
                {health.whatsapp.connected}/{health.whatsapp.connections} connected
                {health.whatsapp.error > 0 && (
                  <span className="ml-2 text-red-600">({health.whatsapp.error} error)</span>
                )}
              </p>
            </div>
            {/* Recent Errors */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 mb-1">Errors (24h)</p>
              <p className={`text-2xl font-bold ${health.recentErrors > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {health.recentErrors}
              </p>
            </div>
            {/* Unresolved Events */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 mb-1">Unresolved Events</p>
              <p className={`text-2xl font-bold ${health.unresolvedEvents > 0 ? 'text-yellow-600' : 'text-green-600'}`}>
                {health.unresolvedEvents}
              </p>
            </div>
            {/* Failed Sends */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 mb-1">Failed Sends (24h)</p>
              <p className={`text-2xl font-bold ${health.failedSends24h > 0 ? 'text-orange-600' : 'text-green-600'}`}>
                {health.failedSends24h}
              </p>
            </div>
            {/* Last Webhook */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 mb-1">Last Webhook</p>
              <p className="text-xs text-gray-700">{fmtDate(health.lastWebhookAt)}</p>
            </div>
            {/* Last Message Sent */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-500 mb-1">Last Message Sent</p>
              <p className="text-xs text-gray-700">{fmtDate(health.lastMessageSentAt)}</p>
            </div>
          </div>
        ) : (
          <p className="text-gray-400 text-sm">Health data unavailable</p>
        )}
      </section>

      {/* ── Operational Events ──────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-500" /> Operational Events
            {events && <span className="text-sm font-normal text-gray-400">({events.total})</span>}
          </h2>
        </div>

        {/* Event Filters */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-1">Severity</label>
              <select
                className="border rounded px-2 py-1 text-sm"
                value={eventFilters.severity}
                onChange={e => { setEventFilters(f => ({ ...f, severity: e.target.value })); setEventPage(1); }}
              >
                <option value="">All</option>
                <option value="info">Info</option>
                <option value="warning">Warning</option>
                <option value="error">Error</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Source</label>
              <select
                className="border rounded px-2 py-1 text-sm"
                value={eventFilters.source}
                onChange={e => { setEventFilters(f => ({ ...f, source: e.target.value })); setEventPage(1); }}
              >
                <option value="">All</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="appointment">Appointment</option>
                <option value="finance">Finance</option>
                <option value="auth">Auth</option>
                <option value="system">System</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Status</label>
              <select
                className="border rounded px-2 py-1 text-sm"
                value={eventFilters.status}
                onChange={e => { setEventFilters(f => ({ ...f, status: e.target.value })); setEventPage(1); }}
              >
                <option value="">All</option>
                <option value="unresolved">Unresolved</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {eventsLoading ? (
            <p className="p-4 text-gray-400 text-sm">Loading events…</p>
          ) : events && events.data.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Severity</th>
                  <th className="px-4 py-3 text-left">Source</th>
                  <th className="px-4 py-3 text-left">Message</th>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {events.data.map(ev => (
                  <tr key={ev.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3"><SeverityBadge severity={ev.severity} /></td>
                    <td className="px-4 py-3 text-gray-600">{ev.source}</td>
                    <td className="px-4 py-3 text-gray-800 max-w-xs truncate">{ev.message}</td>
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDate(ev.createdAt)}</td>
                    <td className="px-4 py-3">
                      {ev.resolvedAt
                        ? <span className="inline-flex items-center gap-1 text-green-600 text-xs"><CheckCircle className="w-3 h-3" /> Resolved</span>
                        : <span className="text-xs text-yellow-600">Open</span>}
                    </td>
                    <td className="px-4 py-3">
                      {!ev.resolvedAt && canResolveOperationalEvents(user) && (
                        <button
                          onClick={() => handleResolve(ev.id)}
                          disabled={resolving === ev.id}
                          className="px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 disabled:opacity-50"
                        >
                          {resolving === ev.id ? 'Resolving…' : 'Resolve'}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="p-4 text-gray-400 text-sm">No operational events found.</p>
          )}
        </div>

        {/* Events Pagination */}
        {events && events.total > events.limit && (
          <div className="flex justify-between items-center mt-3 text-sm text-gray-500">
            <span>Showing {(eventPage - 1) * events.limit + 1}–{Math.min(eventPage * events.limit, events.total)} of {events.total}</span>
            <div className="flex gap-2">
              <button disabled={eventPage <= 1} onClick={() => setEventPage(p => p - 1)} className="px-3 py-1 border rounded disabled:opacity-40">
                <ChevronDown className="w-4 h-4 rotate-90" />
              </button>
              <button disabled={eventPage * events.limit >= events.total} onClick={() => setEventPage(p => p + 1)} className="px-3 py-1 border rounded disabled:opacity-40">
                <ChevronUp className="w-4 h-4 rotate-90" />
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Audit Logs ──────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <Shield className="w-5 h-5 text-indigo-500" /> Audit Logs
            {auditLogs && <span className="text-sm font-normal text-gray-400">({auditLogs.total})</span>}
          </h2>
        </div>

        {/* Audit Filters */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs text-gray-500 mb-1"><Filter className="w-3 h-3 inline mr-1" />Action</label>
              <input
                type="text"
                placeholder="e.g. branch_created"
                className="border rounded px-2 py-1 text-sm w-44"
                value={auditFilters.action}
                onChange={e => { setAuditFilters(f => ({ ...f, action: e.target.value })); setAuditPage(1); }}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Entity Type</label>
              <input
                type="text"
                placeholder="e.g. payment"
                className="border rounded px-2 py-1 text-sm w-36"
                value={auditFilters.entityType}
                onChange={e => { setAuditFilters(f => ({ ...f, entityType: e.target.value })); setAuditPage(1); }}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">From</label>
              <input
                type="date"
                className="border rounded px-2 py-1 text-sm"
                value={auditFilters.from}
                onChange={e => { setAuditFilters(f => ({ ...f, from: e.target.value })); setAuditPage(1); }}
              />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">To</label>
              <input
                type="date"
                className="border rounded px-2 py-1 text-sm"
                value={auditFilters.to}
                onChange={e => { setAuditFilters(f => ({ ...f, to: e.target.value })); setAuditPage(1); }}
              />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {auditLoading ? (
            <p className="p-4 text-gray-400 text-sm">Loading audit logs…</p>
          ) : auditLogs && auditLogs.data.length > 0 ? (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Date / Time</th>
                  <th className="px-4 py-3 text-left">Actor</th>
                  <th className="px-4 py-3 text-left">Action</th>
                  <th className="px-4 py-3 text-left">Entity</th>
                  <th className="px-4 py-3 text-left">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {auditLogs.data.map(log => (
                  <tr key={log.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{fmtDate(log.createdAt)}</td>
                    <td className="px-4 py-3">
                      {log.actorUserId ? (
                        <div>
                          <span className="text-gray-700 text-xs font-mono">{log.actorUserId.slice(0, 8)}…</span>
                          {log.actorRole && <span className="ml-1 text-gray-400 text-xs">({log.actorRole})</span>}
                        </div>
                      ) : <span className="text-gray-400">system</span>}
                    </td>
                    <td className="px-4 py-3">
                      <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs text-indigo-700">{log.action}</code>
                    </td>
                    <td className="px-4 py-3 text-gray-600">
                      <span>{log.entityType}</span>
                      {log.entityId && <span className="ml-1 text-gray-400 text-xs">{log.entityId.slice(0, 8)}…</span>}
                    </td>
                    <td className="px-4 py-3 text-gray-600 max-w-xs truncate">{log.description ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="p-4 text-gray-400 text-sm">No audit logs found.</p>
          )}
        </div>

        {/* Audit Pagination */}
        {auditLogs && auditLogs.total > auditLogs.limit && (
          <div className="flex justify-between items-center mt-3 text-sm text-gray-500">
            <span>Showing {(auditPage - 1) * auditLogs.limit + 1}–{Math.min(auditPage * auditLogs.limit, auditLogs.total)} of {auditLogs.total}</span>
            <div className="flex gap-2">
              <button disabled={auditPage <= 1} onClick={() => setAuditPage(p => p - 1)} className="px-3 py-1 border rounded disabled:opacity-40">
                Prev
              </button>
              <button disabled={auditPage * auditLogs.limit >= auditLogs.total} onClick={() => setAuditPage(p => p + 1)} className="px-3 py-1 border rounded disabled:opacity-40">
                Next
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
