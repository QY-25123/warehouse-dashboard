// ── REST response types (mirror backend Pydantic models) ─────────────────────

export interface Forklift {
  id: number;
  name: string;
  status: 'idle' | 'moving_empty' | 'moving_loaded' | 'loading' | 'error';
  x: number;
  y: number;
  capacity: number;
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

export interface WsForkliftPositionPayload {
  id: number;
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

// ── Analytics types ───────────────────────────────────────────────────────────

export interface AnalyticsSummary {
  tasks_per_hour: number;
  fleet_utilization_pct: number;
  open_alerts: number;
  pending_tasks: number;
  active_tasks: number;
}

export interface ThroughputBucket {
  bucket: string;  // ISO timestamp
  count: number;
}

export interface ForkliftTaskCount {
  forklift_id: number;
  name: string;
  tasks_completed: number;
}

export type WsMessage =
  | { type: 'batch';              messages: WsMessage[] }
  | { type: 'forklift_update';    payload: WsForkliftPayload }
  | { type: 'forklift_position';  payload: WsForkliftPositionPayload }
  | { type: 'task_update';        payload: WsTaskPayload }
  | { type: 'task_created';       payload: WsTaskCreatedPayload }
  | { type: 'inventory_update';   payload: WsInventoryPayload }
  | { type: 'alert';              payload: WsAlertPayload }
  | { type: 'tick_update';        new_events: Event[] }
  | { type: 'telegram_message';   payload: WsTelegramPayload };

// ── Telegram workflow types ───────────────────────────────────────────────────

export type TelegramSessionState =
  | 'idle'
  | 'chatting'
  | 'awaiting_confirmation'
  | 'generating'
  | 'awaiting_plan_approval'
  | 'executing';

export interface TelegramMessage {
  direction: 'inbound' | 'outbound';
  content: string;
  timestamp: string;
}

export interface TelegramConversation {
  id: number;
  phone_number: string;
  state: TelegramSessionState;
  last_message: string | null;
  updated_at: string;
  has_pending_plan: boolean;
}

export interface TelegramConversationDetail {
  phone_number: string;
  state: TelegramSessionState;
  pending_plan: AIPlan | null;
  updated_at: string;
  messages: TelegramMessage[];
}

export interface WsTelegramPayload {
  phone_number: string;
  direction: 'inbound' | 'outbound';
  content: string;
  timestamp: string;
  state?: TelegramSessionState;
  plan?: AIPlan;
  tasks_created?: number;
}

// ── AI workflow types ─────────────────────────────────────────────────────────

export interface AITripAssignment {
  forklift_id: number;
  forklift_name: string;
  capacity: number;
  trips: number;
  units_assigned: number;
  dist_to_origin_svgu: number;
  estimated_ticks: number;
  estimated_seconds: number;
}

export interface AIPlan {
  ok: boolean;
  error?: string;
  task_type: 'inbound' | 'outbound' | 'relocation' | 'replenishment';
  item_id: number;
  item_name: string;
  quantity_requested: number;
  quantity_planned: number;
  quantity_available: number;
  insufficient_stock: boolean;
  origin_zone: string;
  destination_zone: string;
  assignments: AITripAssignment[];
  total_trips: number;
  total_forklifts_used: number;
  makespan_s: number;
}

export interface AIForkliftCapacity {
  id: number;
  name: string;
  status: string;
  capacity: number;
}
