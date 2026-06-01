import type {
  Forklift, Task, InventoryItem, InventoryItemTask, InventoryEvent,
  Alert, Event,
} from './types';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

async function get<T>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  const res = await fetch(url.toString(), { cache: 'no-store' });
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
    list: () =>
      get<Forklift[]>('/forklifts'),
  },

  tasks: {
    list: (filters?: TaskFilters) =>
      get<Task[]>('/tasks', filters as Record<string, string | undefined>),
  },

  inventory: {
    list: (zone?: string) =>
      get<InventoryItem[]>('/inventory', zone ? { zone } : undefined),

    getById: (id: number) =>
      get<InventoryItem>(`/inventory/${id}`),

    getTasks: (id: number) =>
      get<InventoryItemTask[]>(`/inventory/${id}/tasks`),

    getHistory: (id: number) =>
      get<InventoryEvent[]>(`/inventory/${id}/history`),
  },

  alerts: {
    list: (filters?: AlertFilters) =>
      get<Alert[]>('/alerts', filters as Record<string, string | boolean | undefined>),

    resolve: async (id: number): Promise<Alert> => {
      const res = await fetch(`${BASE}/alerts/${id}`, { method: 'PATCH' });
      if (!res.ok) throw new Error(`API ${res.status} – PATCH /alerts/${id}`);
      return res.json() as Promise<Alert>;
    },
  },

  events: {
    list: (filters?: EventFilters) =>
      get<Event[]>('/events', filters as Record<string, string | number | undefined>),
  },
} as const;
