// ── REST response types (mirror backend Pydantic models) ─────────────────────

export interface Forklift {
  id: number;
  name: string;
  status: 'idle' | 'moving_empty' | 'moving_loaded' | 'loading' | 'error';
  x: number;
  y: number;
  last_updated: string;
}

export interface Task {
  id: number;
  type: 'inbound' | 'outbound' | 'relocation' | 'replenishment';
  forklift_id: number | null;
  status: 'pending' | 'in-progress' | 'completed' | 'delayed' | 'out_of_stock';
  origin_zone: string | null;
  destination_zone: string | null;
  inventory_item_id: number | null;
  item_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface InventoryItem {
  id: number;
  item_name: string;
  quantity: number;
  location_zone: string;
  last_updated: string;
}

/** Task row returned by GET /inventory/:id/tasks — extends Task with forklift name. */
export interface InventoryItemTask extends Task {
  forklift_name: string | null;
}

/** Event from GET /inventory/:id/history (inventory_restocked / _depleted / _relocated). */
export interface InventoryEvent {
  id: number;
  type: string;
  payload: {
    item_id?: number;
    item_name?: string;
    delta?: number;
    new_qty?: number;
    zone?: string;
    from_zone?: string;
    to_zone?: string;
    task_id?: number;
  };
  timestamp: string;
}

export interface Alert {
  id: number;
  severity: 'info' | 'warning' | 'critical';
  message: string;
  resolved: boolean;
  created_at: string;
}

export interface Event {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

// ── WebSocket push message types (mirror simulator broadcast schema) ──────────

export interface WsForkliftPayload {
  id: number;
  name: string;
  status: Forklift['status'];
  x: number;
  y: number;
}

export interface WsTaskPayload {
  id: number;
  type: Task['type'];
  forklift_id: number | null;
  status: Task['status'];
  origin_zone: string | null;
  destination_zone: string | null;
  item_name?: string | null;
}

// Full task payload broadcast when the simulator creates a brand-new task.
// Includes created_at / updated_at so the frontend can add it directly to state.
export interface WsTaskCreatedPayload {
  id: number;
  type: Task['type'];
  forklift_id: null;
  status: 'pending';
  origin_zone: string | null;
  destination_zone: string | null;
  inventory_item_id: number | null;
  item_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface WsInventoryPayload {
  id: number;
  item_name: string;
  quantity: number;
  location_zone: string;
}

export interface WsAlertPayload {
  severity: Alert['severity'];
  message: string;
}

export type WsMessage =
  | { type: 'forklift_update';   payload: WsForkliftPayload }
  | { type: 'task_update';       payload: WsTaskPayload }
  | { type: 'task_created';      payload: WsTaskCreatedPayload }
  | { type: 'inventory_update';  payload: WsInventoryPayload }
  | { type: 'alert';             payload: WsAlertPayload }
  | { type: 'tick_update';       new_events: Event[] };
