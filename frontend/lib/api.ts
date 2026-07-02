import type {
  Forklift, Task, InventoryItem, InventoryItemTask, InventoryEvent,
  Alert, Event,
  AnalyticsSummary, ThroughputBucket, ForkliftTaskCount,
} from './types';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

async function get<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
  token?: string,
): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url.toString(), { cache: 'no-store', headers });
  if (!res.ok) throw new Error(`API ${res.status} – ${path}`);
  return res.json() as Promise<T>;
}

// ── Filter param types ────────────────────────────────────────────────────────

export interface TaskFilters {
  status?: Task['status'];
  type?: Task['type'];
}

export interface AlertFilters {
  severity?: Alert['severity'];
  include_resolved?: boolean;
}

export interface EventFilters {
  type?: string;
  limit?: number;
}

// ── Namespaced API helpers ────────────────────────────────────────────────────

export const api = {
  forklifts: {
    list: (token?: string) =>
      get<Forklift[]>('/forklifts', undefined, token),
  },

  tasks: {
    list: (filters?: TaskFilters, token?: string) =>
      get<Task[]>('/tasks', filters as Record<string, string | undefined>, token),
  },

  inventory: {
    list: (zone?: string, token?: string) =>
      get<InventoryItem[]>('/inventory', zone ? { zone } : undefined, token),

    getById: (id: number, token?: string) =>
      get<InventoryItem>(`/inventory/${id}`, undefined, token),

    getTasks: (id: number, token?: string) =>
      get<InventoryItemTask[]>(`/inventory/${id}/tasks`, undefined, token),

    getHistory: (id: number, token?: string) =>
      get<InventoryEvent[]>(`/inventory/${id}/history`, undefined, token),
  },

  alerts: {
    list: (filters?: AlertFilters, token?: string) =>
      get<Alert[]>('/alerts', filters as Record<string, string | boolean | undefined>, token),

    resolve: async (id: number, token?: string): Promise<Alert> => {
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `Bearer ${token}`;
      const res = await fetch(`${BASE}/alerts/${id}`, { method: 'PATCH', headers });
      if (!res.ok) throw new Error(`API ${res.status} – PATCH /alerts/${id}`);
      return res.json() as Promise<Alert>;
    },
  },

  events: {
    list: (filters?: EventFilters, token?: string) =>
      get<Event[]>('/events', filters as Record<string, string | number | undefined>, token),

    heatmap: (limit?: number, token?: string) =>
      get<Record<string, number>>('/events/heatmap', limit ? { limit } : undefined, token),
  },

  analytics: {
    summary: (token?: string) =>
      get<AnalyticsSummary>('/analytics/summary', undefined, token),

    throughput: (token?: string) =>
      get<ThroughputBucket[]>('/analytics/throughput', undefined, token),

    forkliftTasks: (token?: string) =>
      get<ForkliftTaskCount[]>('/analytics/forklift-tasks', undefined, token),
  },
} as const;
