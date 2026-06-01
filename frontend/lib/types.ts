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
  status: 'pending' | 'in-progress' | 'completed' | 'delayed';
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
  | { type: 'inventory_update';  payload: WsInventoryPayload }
  | { type: 'alert';             payload: WsAlertPayload };
