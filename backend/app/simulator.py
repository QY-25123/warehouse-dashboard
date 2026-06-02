"""
Warehouse simulator — runs every TICK_INTERVAL seconds.

Forklift status lifecycle:
  idle
   → moving_empty  (leg 1 — directed toward origin zone, no cargo)
   → loading       (leg 1, 3 ticks — picking up cargo at origin)
   → moving_loaded (leg 2 — directed toward destination, carrying cargo)
   → loading       (leg 2, 3 ticks — placing cargo at destination)
   → idle

Inventory effect at leg-2 loading completion (using task.inventory_item_id):
  inbound      → +random(5-15) qty in destination zone
  outbound     → -random(1-5) qty in origin zone (floored at 0)
  relocation   → move item.location_zone from origin to destination
  replenishment→ +random(10-20) qty in destination zone

Special zone coordinates (OUTSIDE the main 0-100 SVG grid):
  DOCK = (-10, 50)  — receiving dock, left of grid
  SHIP = (110, 50)  — shipping dock, right of grid
  STOR = (50, 110)  — storage area, below grid

Sensor fault (every 30 ticks):
  One random moving forklift → error for 5 ticks, then auto-idle.
  Its task → delayed immediately.

Five alert types:
  1. Forklift inactivity   — idle/error, no task, 5+ ticks    → warning
  2. Route congestion      — 3+ forklifts same zone           → warning
  3. Delayed task          — in-progress 20+ ticks            → warning
  4. Sensor disconnect     — injected fault                   → critical
  5. Inventory mismatch    — qty reaches 0 after outbound     → warning
"""

import asyncio
import logging
import math
import random
from datetime import datetime, timezone
from typing import Any

import asyncpg

from app.ws_manager import ConnectionManager

logger = logging.getLogger(__name__)

TICK_INTERVAL = 2.0

_tick_count: int = 0

# ── Zone centre coordinates ───────────────────────────────────────────────────
# Special zones sit OUTSIDE the 0-100 main grid so they render in their own
# SVG panels with a visible gap from the A1-D4 shelf zones.
_ZONE_COORDS: dict[str, tuple[float, float]] = {
    'A1': (12.5, 12.5), 'A2': (37.5, 12.5), 'A3': (62.5, 12.5), 'A4': (87.5, 12.5),
    'B1': (12.5, 37.5), 'B2': (37.5, 37.5), 'B3': (62.5, 37.5), 'B4': (87.5, 37.5),
    'C1': (12.5, 62.5), 'C2': (37.5, 62.5), 'C3': (62.5, 62.5), 'C4': (87.5, 62.5),
    'D1': (12.5, 87.5), 'D2': (37.5, 87.5), 'D3': (62.5, 87.5), 'D4': (87.5, 87.5),
    'DOCK': (-10.0,  50.0),
    'SHIP': (110.0,  50.0),
    'STOR': ( 50.0, 110.0),
}

# ── Per-task two-leg state machine ────────────────────────────────────────────
# task_id → { leg, phase, remaining, start_tick, target_x, target_y }
_task_state: dict[int, dict[str, Any]] = {}

# forklift_id → ticks remaining until auto-recovery from sensor fault
_sensor_fault_ticks: dict[int, int] = {}

# forklift_id → consecutive idle/error ticks with no active task
_idle_ticks: dict[int, int] = {}

# forklift_id → last known zone label (for zone-entry event deduplication)
_forklift_zones: dict[int, str] = {}

# forklift_id → task_id that was interrupted by a sensor fault.
# Preserved so _recover_sensors can resume the task from the same leg/phase.
_forklift_interrupted_task: dict[int, int] = {}


def _xy_to_zone(x: float, y: float) -> str:
    """Map coordinates to a zone label. x<0 → DOCK, x>100 → SHIP, y>100 → STOR."""
    if x < 0:   return 'DOCK'
    if x > 100: return 'SHIP'
    if y > 100: return 'STOR'
    col = min(int(x / 25), 3) + 1
    row = chr(ord('A') + min(int(y / 25), 3))
    return f"{row}{col}"


def _leg1_target(task_type: str, origin_zone: str) -> tuple[float, float]:
    if task_type == 'inbound':      return _ZONE_COORDS['DOCK']
    if task_type == 'replenishment': return _ZONE_COORDS['STOR']
    return _ZONE_COORDS.get(origin_zone, (50.0, 50.0))


def _leg2_target(task_type: str, destination_zone: str) -> tuple[float, float]:
    if task_type == 'outbound': return _ZONE_COORDS['SHIP']
    return _ZONE_COORDS.get(destination_zone, (50.0, 50.0))


# ── Public entry point ────────────────────────────────────────────────────────

async def run(pool: asyncpg.Pool, manager: ConnectionManager) -> None:
    global _tick_count
    while True:
        await asyncio.sleep(TICK_INTERVAL)
        _tick_count += 1
        try:
            await _tick(pool, manager)
        except Exception as exc:
            logger.error("Simulator tick failed: %s", exc, exc_info=True)


async def _tick(pool: asyncpg.Pool, manager: ConnectionManager) -> None:
    msgs: list[dict[str, Any]] = []
    tick_start = datetime.now(timezone.utc)
    async with pool.acquire() as conn:
        if _tick_count % 10 == 0:
            msgs += await _create_tasks(conn)
        msgs += await _assign_tasks(conn)
        msgs += await _advance_tasks(conn)
        msgs += await _recover_sensors(conn)
        if _tick_count % 30 == 0:
            msgs += await _inject_sensor_fault(conn)
        msgs += await _check_alerts(conn)
        new_event_rows = await conn.fetch(
            "SELECT id, type, payload, timestamp FROM events "
            "WHERE timestamp >= $1 ORDER BY timestamp ASC",
            tick_start,
        )
    for msg in msgs:
        await manager.broadcast(msg)
    if new_event_rows:
        await manager.broadcast({
            'type': 'tick_update',
            'new_events': [
                {
                    'id': r['id'],
                    'type': r['type'],
                    'payload': dict(r['payload']),
                    'timestamp': r['timestamp'].isoformat(),
                }
                for r in new_event_rows
            ],
        })


# ── Step 1: Task creation (every 10 ticks) ────────────────────────────────────

_TASK_CONFIGS: list[dict[str, Any]] = [
    {'type': 'inbound',       'origin': 'DOCK', 'destinations': ['A1','A2','A3','A4','B1','B2','B3','B4','C1','C2','C3','C4','D1','D2','D3','D4']},
    {'type': 'outbound',      'origins':        ['A1','A2','A3','A4','B1','B2','B3','B4','C1','C2','C3','C4','D1','D2','D3','D4'], 'destination': 'SHIP'},
    {'type': 'relocation',    'zones':          ['A1','A2','A3','A4','B1','B2','B3','B4','C1','C2','C3','C4','D1','D2','D3','D4']},
    {'type': 'replenishment', 'origin': 'STOR', 'destinations': ['A3','A4','C1','C4','D1','D4']},
]


async def _create_tasks(conn: asyncpg.Connection) -> list[dict]:
    msgs: list[dict] = []
    for _ in range(random.randint(1, 2)):
        cfg = random.choice(_TASK_CONFIGS)
        t_type = cfg['type']
        if t_type == 'inbound':
            origin, dest = cfg['origin'], random.choice(cfg['destinations'])
        elif t_type == 'outbound':
            origin, dest = random.choice(cfg['origins']), cfg['destination']
        elif t_type == 'relocation':
            zones  = cfg['zones']
            origin = random.choice(zones)
            dest   = random.choice([z for z in zones if z != origin])
        else:
            origin, dest = cfg['origin'], random.choice(cfg['destinations'])

        # Select the specific inventory item this task will move.
        item_id = await _select_inventory_item(conn, t_type, origin, dest)

        try:
            row = await conn.fetchrow(
                "INSERT INTO tasks (type, status, origin_zone, destination_zone, "
                "                   inventory_item_id, created_at, updated_at) "
                "VALUES ($1::task_type, 'pending', $2, $3, $4, NOW(), NOW()) "
                "RETURNING id, created_at, updated_at",
                t_type, origin, dest, item_id,
            )
            tid        = row['id']
            created_at = row['created_at'].isoformat()
            updated_at = row['updated_at'].isoformat()
            item_name: str | None = None
            if item_id:
                ir = await conn.fetchrow("SELECT item_name FROM inventory WHERE id=$1", item_id)
                if ir:
                    item_name = ir['item_name']
            await conn.execute(
                "INSERT INTO events (type, payload, timestamp) VALUES ($1, $2, NOW())",
                'task_created',
                {'task_id': tid, 'type': t_type, 'origin_zone': origin,
                 'destination_zone': dest, 'item_id': item_id},
            )
            # Broadcast as 'task_created' (not 'task_update') so the frontend
            # can prepend the new task rather than trying to map over it.
            msgs.append({
                'type': 'task_created',
                'payload': {
                    'id': tid, 'type': t_type,
                    'forklift_id': None, 'status': 'pending',
                    'origin_zone': origin, 'destination_zone': dest,
                    'inventory_item_id': item_id,
                    'item_name': item_name,
                    'created_at': created_at,
                    'updated_at': updated_at,
                },
            })
        except Exception as exc:
            logger.warning("Task creation failed: %s", exc)
    return msgs


async def _select_inventory_item(
    conn: asyncpg.Connection,
    task_type: str,
    origin_zone: str,
    destination_zone: str,
) -> int | None:
    try:
        if task_type == 'inbound':
            row = await conn.fetchrow(
                "SELECT id FROM inventory WHERE location_zone=$1 ORDER BY RANDOM() LIMIT 1",
                destination_zone,
            )
        elif task_type == 'outbound':
            row = await conn.fetchrow(
                "SELECT id FROM inventory WHERE location_zone=$1 AND quantity>0 "
                "ORDER BY RANDOM() LIMIT 1",
                origin_zone,
            )
        elif task_type == 'relocation':
            row = await conn.fetchrow(
                "SELECT id FROM inventory WHERE location_zone=$1 ORDER BY RANDOM() LIMIT 1",
                origin_zone,
            )
        else:  # replenishment
            row = await conn.fetchrow(
                "SELECT id FROM inventory WHERE location_zone=$1 ORDER BY quantity ASC LIMIT 1",
                destination_zone,
            )
        return row['id'] if row else None
    except Exception as exc:
        logger.warning("Inventory item selection failed: %s", exc)
        return None


# ── Step 2: Task assignment (every tick) ─────────────────────────────────────

async def _assign_tasks(conn: asyncpg.Connection) -> list[dict]:
    msgs: list[dict] = []
    try:
        pending = await conn.fetch(
            "SELECT id, type::text AS type, origin_zone, destination_zone, inventory_item_id "
            "FROM tasks WHERE status='pending' AND forklift_id IS NULL ORDER BY created_at"
        )
        idle = await conn.fetch(
            "SELECT id, name, x, y FROM forklifts WHERE status='idle' ORDER BY id"
        )
    except Exception as exc:
        logger.warning("Fetch for assignment failed: %s", exc)
        return msgs

    for task, fork in zip(pending, idle):
        tid, fid = task['id'], fork['id']
        t_type = task['type']
        tx, ty = _leg1_target(t_type, task['origin_zone'])
        try:
            await conn.execute(
                "UPDATE tasks "
                "SET status='in-progress'::task_status, forklift_id=$1, updated_at=NOW() "
                "WHERE id=$2",
                fid, tid,
            )
            await conn.execute(
                "UPDATE forklifts "
                "SET status='moving_empty'::forklift_status, last_updated=NOW() WHERE id=$1",
                fid,
            )
            await conn.execute(
                "INSERT INTO events (type, payload, timestamp) VALUES ($1, $2, NOW())",
                'task_assigned',
                {'task_id': tid, 'forklift_id': fid},
            )
            _task_state[tid] = {
                'leg': 1, 'phase': 'moving', 'remaining': 3,
                'start_tick': _tick_count,
                'target_x': tx, 'target_y': ty,
            }
            msgs.append({
                'type': 'task_update',
                'payload': {
                    'id': tid, 'type': t_type,
                    'forklift_id': fid, 'status': 'in-progress',
                    'origin_zone': task['origin_zone'],
                    'destination_zone': task['destination_zone'],
                },
            })
            msgs.append({
                'type': 'forklift_update',
                'payload': {
                    'id': fid, 'name': fork['name'],
                    'status': 'moving_empty',
                    'x': float(fork['x']), 'y': float(fork['y']),
                },
            })
        except Exception as exc:
            logger.warning("Assignment (task %d → forklift %d) failed: %s", tid, fid, exc)
    return msgs


# ── Step 3: Advance task state machine (every tick) ───────────────────────────

async def _advance_tasks(conn: asyncpg.Connection) -> list[dict]:
    msgs: list[dict] = []
    try:
        rows = await conn.fetch(
            "SELECT t.id, t.type::text AS type, t.forklift_id, "
            "       t.origin_zone, t.destination_zone, t.inventory_item_id, "
            "       f.name AS fname, f.status::text AS fstatus, f.x, f.y "
            "FROM tasks t "
            "JOIN forklifts f ON f.id = t.forklift_id "
            "WHERE t.status = 'in-progress' "
            "  AND f.status IN ('moving_empty', 'moving_loaded', 'loading')"
        )
    except Exception as exc:
        logger.warning("Fetch in-progress tasks failed: %s", exc)
        return msgs

    for row in rows:
        tid     = row['id']
        fid     = row['forklift_id']
        fstatus = row['fstatus']

        # Bootstrap state for tasks in-progress before the simulator started.
        if tid not in _task_state:
            if fstatus == 'loading':
                _task_state[tid] = {
                    'leg': 1, 'phase': 'loading', 'remaining': 3,
                    'start_tick': _tick_count, 'target_x': 0.0, 'target_y': 0.0,
                }
            elif fstatus == 'moving_loaded':
                l2x, l2y = _leg2_target(row['type'], row['destination_zone'])
                _task_state[tid] = {
                    'leg': 2, 'phase': 'moving', 'remaining': 3,
                    'start_tick': _tick_count, 'target_x': l2x, 'target_y': l2y,
                }
            else:  # moving_empty
                l1x, l1y = _leg1_target(row['type'], row['origin_zone'])
                _task_state[tid] = {
                    'leg': 1, 'phase': 'moving', 'remaining': 3,
                    'start_tick': _tick_count, 'target_x': l1x, 'target_y': l1y,
                }

        state = _task_state[tid]

        # ── Moving phase — directed step toward target ────────────────────────
        if state['phase'] == 'moving':
            cx, cy   = float(row['x']), float(row['y'])
            tx, ty   = state['target_x'], state['target_y']
            dx, dy   = tx - cx, ty - cy
            distance = math.sqrt(dx * dx + dy * dy)
            new_status = 'moving_empty' if state['leg'] == 1 else 'moving_loaded'

            if distance < 2.0:
                # Arrived — snap to target and begin loading.
                new_x, new_y = round(tx, 2), round(ty, 2)
                at_zone = row['origin_zone'] if state['leg'] == 1 else row['destination_zone']
                action  = 'pickup' if state['leg'] == 1 else 'dropoff'
                try:
                    await conn.execute(
                        "UPDATE forklifts SET x=$1, y=$2, "
                        "status='loading'::forklift_status, last_updated=NOW() WHERE id=$3",
                        new_x, new_y, fid,
                    )
                    zone = _xy_to_zone(new_x, new_y)
                    if _forklift_zones.get(fid) != zone:
                        _forklift_zones[fid] = zone
                        await conn.execute(
                            "INSERT INTO events (type, payload, timestamp) VALUES ($1, $2, NOW())",
                            'zone_entry', {'forklift_id': fid, 'zone': zone, 'x': new_x, 'y': new_y},
                        )
                    await conn.execute(
                        "INSERT INTO events (type, payload, timestamp) VALUES ($1, $2, NOW())",
                        'forklift_loading',
                        {'forklift_id': fid, 'zone': at_zone, 'action': action},
                    )
                except Exception as exc:
                    logger.warning("Arrival for forklift %d failed: %s", fid, exc)
                    continue
                state['phase']     = 'loading'
                state['remaining'] = 3
                msgs.append({
                    'type': 'forklift_update',
                    'payload': {'id': fid, 'name': row['fname'],
                                'status': 'loading', 'x': new_x, 'y': new_y},
                })
            else:
                # Still travelling.
                step  = min(4.0, distance)
                new_x = round(cx + (dx / distance) * step, 2)
                new_y = round(cy + (dy / distance) * step, 2)
                try:
                    await conn.execute(
                        "UPDATE forklifts SET x=$1, y=$2, last_updated=NOW() WHERE id=$3",
                        new_x, new_y, fid,
                    )
                    zone = _xy_to_zone(new_x, new_y)
                    if _forklift_zones.get(fid) != zone:
                        _forklift_zones[fid] = zone
                        await conn.execute(
                            "INSERT INTO events (type, payload, timestamp) VALUES ($1, $2, NOW())",
                            'zone_entry', {'forklift_id': fid, 'zone': zone, 'x': new_x, 'y': new_y},
                        )
                except Exception as exc:
                    logger.warning("Move forklift %d failed: %s", fid, exc)
                    continue
                msgs.append({
                    'type': 'forklift_update',
                    'payload': {'id': fid, 'name': row['fname'],
                                'status': new_status, 'x': new_x, 'y': new_y},
                })

        # ── Loading phase — wait out the countdown ────────────────────────────
        elif state['phase'] == 'loading':
            state['remaining'] -= 1
            if state['remaining'] > 0:
                continue

            if state['leg'] == 1:
                # Leg 1 done — start leg 2 (forklift now carries cargo).
                l2x, l2y = _leg2_target(row['type'], row['destination_zone'])
                try:
                    await conn.execute(
                        "UPDATE forklifts "
                        "SET status='moving_loaded'::forklift_status, last_updated=NOW() WHERE id=$1",
                        fid,
                    )
                    await conn.execute(
                        "INSERT INTO events (type, payload, timestamp) VALUES ($1, $2, NOW())",
                        'forklift_departed',
                        {'forklift_id': fid, 'from_zone': row['origin_zone'],
                         'to_zone': row['destination_zone'], 'leg': 2},
                    )
                except Exception as exc:
                    logger.warning("Leg 2 start for forklift %d failed: %s", fid, exc)
                    continue
                state.update({'leg': 2, 'phase': 'moving',
                              'target_x': l2x, 'target_y': l2y})
                msgs.append({
                    'type': 'forklift_update',
                    'payload': {'id': fid, 'name': row['fname'],
                                'status': 'moving_loaded',
                                'x': float(row['x']), 'y': float(row['y'])},
                })

            else:
                # Leg 2 done — apply inventory effect and complete task.
                await _apply_inventory_effect(
                    conn, row['type'],
                    row['inventory_item_id'],
                    row['origin_zone'],
                    row['destination_zone'],
                    msgs,
                )
                duration = _tick_count - state.get('start_tick', _tick_count)
                try:
                    await conn.execute(
                        "UPDATE tasks SET status='completed'::task_status, updated_at=NOW() WHERE id=$1",
                        tid,
                    )
                    await conn.execute(
                        "UPDATE forklifts SET status='idle'::forklift_status, last_updated=NOW() WHERE id=$1",
                        fid,
                    )
                    await conn.execute(
                        "INSERT INTO events (type, payload, timestamp) VALUES ($1, $2, NOW())",
                        'task_completed',
                        {'task_id': tid, 'type': row['type'], 'duration_ticks': duration},
                    )
                except Exception as exc:
                    logger.warning("Complete task %d failed: %s", tid, exc)
                    _task_state.pop(tid, None)
                    continue
                _task_state.pop(tid, None)
                msgs.append({
                    'type': 'task_update',
                    'payload': {
                        'id': tid, 'type': row['type'],
                        'forklift_id': fid, 'status': 'completed',
                        'origin_zone': row['origin_zone'],
                        'destination_zone': row['destination_zone'],
                    },
                })
                msgs.append({
                    'type': 'forklift_update',
                    'payload': {'id': fid, 'name': row['fname'],
                                'status': 'idle',
                                'x': float(row['x']), 'y': float(row['y'])},
                })

    return msgs


# ── Inventory effects (applied at leg-2 loading completion) ──────────────────

async def _apply_inventory_effect(
    conn: asyncpg.Connection,
    task_type: str,
    inventory_item_id: int | None,
    origin_zone: str,
    destination_zone: str,
    msgs: list[dict],
) -> None:
    if not inventory_item_id:
        return
    try:
        item = await conn.fetchrow(
            "SELECT id, item_name, quantity, location_zone FROM inventory WHERE id=$1",
            inventory_item_id,
        )
        if not item:
            return

        iid = item['id']

        if task_type == 'inbound':
            delta   = random.randint(5, 15)
            new_qty = item['quantity'] + delta
            await conn.execute(
                "UPDATE inventory SET quantity=$1, last_updated=NOW() WHERE id=$2",
                new_qty, iid,
            )
            await conn.execute(
                "INSERT INTO events (type, payload, timestamp) VALUES ($1, $2, NOW())",
                'inventory_restocked',
                {'item_id': iid, 'item_name': item['item_name'],
                 'delta': delta, 'new_qty': new_qty, 'zone': destination_zone},
            )
            msgs.append({'type': 'inventory_update', 'payload': {
                'id': iid, 'item_name': item['item_name'],
                'quantity': new_qty, 'location_zone': item['location_zone'],
            }})

        elif task_type == 'outbound':
            delta   = random.randint(1, 5)
            new_qty = max(0, item['quantity'] - delta)
            await conn.execute(
                "UPDATE inventory SET quantity=$1, last_updated=NOW() WHERE id=$2",
                new_qty, iid,
            )
            await conn.execute(
                "INSERT INTO events (type, payload, timestamp) VALUES ($1, $2, NOW())",
                'inventory_depleted',
                {'item_id': iid, 'item_name': item['item_name'],
                 'delta': -delta, 'new_qty': new_qty, 'zone': origin_zone},
            )
            msgs.append({'type': 'inventory_update', 'payload': {
                'id': iid, 'item_name': item['item_name'],
                'quantity': new_qty, 'location_zone': item['location_zone'],
            }})

        elif task_type == 'relocation':
            await conn.execute(
                "UPDATE inventory SET location_zone=$1, last_updated=NOW() WHERE id=$2",
                destination_zone, iid,
            )
            await conn.execute(
                "INSERT INTO events (type, payload, timestamp) VALUES ($1, $2, NOW())",
                'inventory_relocated',
                {'item_id': iid, 'item_name': item['item_name'],
                 'from_zone': origin_zone, 'to_zone': destination_zone},
            )
            msgs.append({'type': 'inventory_update', 'payload': {
                'id': iid, 'item_name': item['item_name'],
                'quantity': item['quantity'], 'location_zone': destination_zone,
            }})

        elif task_type == 'replenishment':
            delta   = random.randint(10, 20)
            new_qty = item['quantity'] + delta
            await conn.execute(
                "UPDATE inventory SET quantity=$1, last_updated=NOW() WHERE id=$2",
                new_qty, iid,
            )
            await conn.execute(
                "INSERT INTO events (type, payload, timestamp) VALUES ($1, $2, NOW())",
                'inventory_restocked',
                {'item_id': iid, 'item_name': item['item_name'],
                 'delta': delta, 'new_qty': new_qty, 'zone': destination_zone},
            )
            msgs.append({'type': 'inventory_update', 'payload': {
                'id': iid, 'item_name': item['item_name'],
                'quantity': new_qty, 'location_zone': item['location_zone'],
            }})
    except Exception as exc:
        logger.warning("Inventory effect for task type %s failed: %s", task_type, exc)


# ── Step 4: Sensor recovery (every tick) ─────────────────────────────────────

async def _recover_sensors(conn: asyncpg.Connection) -> list[dict]:
    msgs: list[dict] = []
    # Bootstrap: forklifts in error but not tracked (e.g. after a restart) would
    # never recover on their own. Add them with 1 tick so they recover this pass.
    orphaned = await conn.fetch("SELECT id FROM forklifts WHERE status='error'")
    for r in orphaned:
        if r['id'] not in _sensor_fault_ticks:
            _sensor_fault_ticks[r['id']] = 1
    for fid in list(_sensor_fault_ticks.keys()):
        _sensor_fault_ticks[fid] -= 1
        if _sensor_fault_ticks[fid] > 0:
            continue
        try:
            row = await conn.fetchrow(
                "SELECT id, name, x, y FROM forklifts WHERE id=$1 AND status='error'", fid,
            )
            if not row:
                _sensor_fault_ticks.pop(fid, None)
                _forklift_interrupted_task.pop(fid, None)
                continue

            tid   = _forklift_interrupted_task.pop(fid, None)
            state = _task_state.get(tid) if tid is not None else None

            if tid is not None and state is not None:
                # Resume the interrupted task from the exact leg/phase it was on.
                leg   = state.get('leg', 1)
                phase = state.get('phase', 'moving')
                if phase == 'loading':
                    resume_status = 'loading'
                elif leg == 2:
                    resume_status = 'moving_loaded'
                else:
                    resume_status = 'moving_empty'

                await conn.execute(
                    "UPDATE forklifts SET status=$1::forklift_status, last_updated=NOW() WHERE id=$2",
                    resume_status, fid,
                )
                await conn.execute(
                    "UPDATE tasks SET status='in-progress'::task_status, updated_at=NOW() WHERE id=$1",
                    tid,
                )
                await conn.execute(
                    "INSERT INTO events (type, payload, timestamp) VALUES ($1, $2, NOW())",
                    'task_resumed',
                    {'task_id': tid, 'forklift_id': fid,
                     'resumed_from': 'error', 'leg': leg, 'phase': phase},
                )
                await conn.execute(
                    "INSERT INTO events (type, payload, timestamp) VALUES ($1, $2, NOW())",
                    'forklift_status_change',
                    {'forklift_id': fid, 'from': 'error', 'to': resume_status},
                )
                msgs.append({'type': 'forklift_update', 'payload': {
                    'id': fid, 'name': row['name'],
                    'status': resume_status, 'x': float(row['x']), 'y': float(row['y']),
                }})
                msgs.append({'type': 'task_update', 'payload': {
                    'id': tid, 'status': 'in-progress', 'forklift_id': fid,
                }})
                logger.info("Forklift %d recovered → %s, task %d resumed (leg %d, %s)",
                            fid, resume_status, tid, leg, phase)
            else:
                # No interrupted task tracked (e.g. after a restart). Recover to idle
                # and re-queue any stuck delayed task so it can be reassigned.
                if tid is not None:
                    await conn.execute(
                        "UPDATE tasks "
                        "SET status='pending'::task_status, forklift_id=NULL, updated_at=NOW() "
                        "WHERE id=$1 AND status='delayed'",
                        tid,
                    )
                await conn.execute(
                    "UPDATE forklifts SET status='idle'::forklift_status, last_updated=NOW() WHERE id=$1",
                    fid,
                )
                await conn.execute(
                    "INSERT INTO events (type, payload, timestamp) VALUES ($1, $2, NOW())",
                    'forklift_status_change',
                    {'forklift_id': fid, 'from': 'error', 'to': 'idle'},
                )
                msgs.append({'type': 'forklift_update', 'payload': {
                    'id': fid, 'name': row['name'],
                    'status': 'idle', 'x': float(row['x']), 'y': float(row['y']),
                }})
                logger.info("Forklift %d sensor recovered → idle (no state to resume)", fid)
        except Exception as exc:
            logger.warning("Sensor recovery for forklift %d failed: %s", fid, exc)
        finally:
            _sensor_fault_ticks.pop(fid, None)
    return msgs


# ── Step 5: Sensor fault injection (every 30 ticks) ──────────────────────────

async def _inject_sensor_fault(conn: asyncpg.Connection) -> list[dict]:
    msgs: list[dict] = []
    try:
        candidates = await conn.fetch(
            "SELECT id, name, x, y FROM forklifts "
            "WHERE status IN ('moving_empty', 'moving_loaded')"
        )
    except Exception as exc:
        logger.warning("Fetch for sensor fault failed: %s", exc)
        return msgs

    if not candidates:
        return msgs

    target = random.choice(candidates)
    fid = target['id']
    try:
        task_row = await conn.fetchrow(
            "SELECT id, type::text AS type, origin_zone, destination_zone "
            "FROM tasks WHERE forklift_id=$1 AND status='in-progress'",
            fid,
        )
        await conn.execute(
            "UPDATE forklifts SET status='error'::forklift_status, last_updated=NOW() WHERE id=$1",
            fid,
        )
        await conn.execute(
            "INSERT INTO events (type, payload, timestamp) VALUES ($1, $2, NOW())",
            'sensor_disconnect', {'forklift_id': fid, 'reason': 'sensor_disconnect'},
        )
        _sensor_fault_ticks[fid] = 5

        if task_row:
            tid = task_row['id']
            # Preserve _task_state so recovery can resume from the same leg/phase/target.
            # Only record the mapping; do NOT pop from _task_state.
            _forklift_interrupted_task[fid] = tid
            await conn.execute(
                "UPDATE tasks SET status='delayed'::task_status, updated_at=NOW() WHERE id=$1",
                tid,
            )
            state = _task_state.get(tid, {})
            await conn.execute(
                "INSERT INTO events (type, payload, timestamp) VALUES ($1, $2, NOW())",
                'task_interrupted',
                {
                    'task_id': tid, 'forklift_id': fid,
                    'reason': 'forklift_error',
                    'leg': state.get('leg'), 'phase': state.get('phase'),
                },
            )
            msgs.append({'type': 'task_update', 'payload': {
                'id': tid, 'type': task_row['type'],
                'forklift_id': fid, 'status': 'delayed',
                'origin_zone': task_row['origin_zone'],
                'destination_zone': task_row['destination_zone'],
            }})

        msgs.append({'type': 'forklift_update', 'payload': {
            'id': fid, 'name': target['name'],
            'status': 'error', 'x': float(target['x']), 'y': float(target['y']),
        }})
        exists = await conn.fetchval(
            "SELECT 1 FROM alerts WHERE message LIKE $1 AND resolved=FALSE LIMIT 1",
            f"sensor_disconnect: forklift {fid}%",
        )
        if not exists:
            msg_text = (
                f"sensor_disconnect: forklift {fid} ({target['name']}) "
                f"has gone offline — auto-recovery in 5 ticks"
            )
            await conn.execute(
                "INSERT INTO alerts (severity, message, resolved, created_at) "
                "VALUES ('critical', $1, FALSE, NOW())",
                msg_text,
            )
            msgs.append({'type': 'alert', 'payload': {'severity': 'critical', 'message': msg_text}})
        logger.info("Sensor fault injected on forklift %d", fid)
    except Exception as exc:
        logger.warning("Sensor fault injection on forklift %d failed: %s", fid, exc)
    return msgs


# ── Step 6: Alert generation (every tick) ────────────────────────────────────

async def _check_alerts(conn: asyncpg.Connection) -> list[dict]:
    msgs: list[dict] = []

    # ── Alert 1: Forklift inactivity ──────────────────────────────────────────
    try:
        inactive = await conn.fetch(
            "SELECT f.id, f.name FROM forklifts f "
            "WHERE f.status IN ('idle', 'error') "
            "  AND NOT EXISTS ("
            "    SELECT 1 FROM tasks t "
            "    WHERE t.forklift_id = f.id AND t.status = 'in-progress'"
            "  )"
        )
    except Exception as exc:
        logger.warning("Fetch inactive forklifts failed: %s", exc)
        inactive = []

    active_ids = {r['id'] for r in inactive}
    for fid in list(_idle_ticks.keys()):
        if fid not in active_ids:
            _idle_ticks.pop(fid, None)
    for row in inactive:
        fid = row['id']
        _idle_ticks[fid] = _idle_ticks.get(fid, 0) + 1
        if _idle_ticks[fid] < 5:
            continue
        try:
            exists = await conn.fetchval(
                "SELECT 1 FROM alerts WHERE message LIKE $1 AND resolved=FALSE LIMIT 1",
                f"forklift_inactivity: forklift {fid}%",
            )
            if exists:
                continue
            msg_text = (
                f"forklift_inactivity: forklift {fid} ({row['name']}) "
                f"has been idle/offline for {_idle_ticks[fid]} ticks with no task assigned"
            )
            await conn.execute(
                "INSERT INTO alerts (severity, message, resolved, created_at) "
                "VALUES ('warning', $1, FALSE, NOW())",
                msg_text,
            )
            await conn.execute(
                "INSERT INTO events (type, payload, timestamp) VALUES ($1, $2, NOW())",
                'alert_triggered',
                {'forklift_id': fid, 'reason': 'forklift_inactivity', 'ticks': _idle_ticks[fid]},
            )
            msgs.append({'type': 'alert', 'payload': {'severity': 'warning', 'message': msg_text}})
        except Exception as exc:
            logger.warning("Inactivity alert for forklift %d failed: %s", fid, exc)

    # ── Alert 2: Route congestion ─────────────────────────────────────────────
    try:
        all_forklifts = await conn.fetch(
            "SELECT id, x, y FROM forklifts "
            "WHERE status IN ('moving_empty', 'moving_loaded', 'loading')"
        )
    except Exception as exc:
        logger.warning("Fetch forklifts for congestion failed: %s", exc)
        all_forklifts = []

    zone_counts: dict[str, int] = {}
    for r in all_forklifts:
        z = _xy_to_zone(float(r['x']), float(r['y']))
        zone_counts[z] = zone_counts.get(z, 0) + 1

    for zone, count in zone_counts.items():
        if count < 3:
            continue
        try:
            exists = await conn.fetchval(
                "SELECT 1 FROM alerts WHERE message LIKE $1 AND resolved=FALSE LIMIT 1",
                f"Zone {zone} congested%",
            )
            if exists:
                continue
            msg_text = f"Zone {zone} congested: {count} forklifts present"
            await conn.execute(
                "INSERT INTO alerts (severity, message, resolved, created_at) "
                "VALUES ('warning', $1, FALSE, NOW())",
                msg_text,
            )
            await conn.execute(
                "INSERT INTO events (type, payload, timestamp) VALUES ($1, $2, NOW())",
                'zone_congestion', {'zone': zone, 'forklift_count': count},
            )
            msgs.append({'type': 'alert', 'payload': {'severity': 'warning', 'message': msg_text}})
        except Exception as exc:
            logger.warning("Congestion alert for zone %s failed: %s", zone, exc)

    # ── Alert 3: Slow task (in-progress 20+ ticks, still running) ───────────
    for tid, state in list(_task_state.items()):
        if _tick_count - state.get('start_tick', _tick_count) < 20:
            continue
        try:
            task_row = await conn.fetchrow(
                "SELECT id, type::text AS type FROM tasks WHERE id=$1 AND status='in-progress'", tid,
            )
            if not task_row:
                continue
            exists = await conn.fetchval(
                "SELECT 1 FROM alerts WHERE message LIKE $1 AND resolved=FALSE LIMIT 1",
                f"slow_task: task {tid}%",
            )
            if exists:
                continue
            ticks    = _tick_count - state['start_tick']
            msg_text = (
                f"slow_task: task {tid} (type: {task_row['type']}) "
                f"in progress for {ticks} ticks without completing"
            )
            await conn.execute(
                "INSERT INTO alerts (severity, message, resolved, created_at) "
                "VALUES ('warning', $1, FALSE, NOW())",
                msg_text,
            )
            await conn.execute(
                "INSERT INTO events (type, payload, timestamp) VALUES ($1, $2, NOW())",
                'alert_triggered', {'task_id': tid, 'reason': 'slow_task', 'ticks': ticks},
            )
            msgs.append({'type': 'alert', 'payload': {'severity': 'warning', 'message': msg_text}})
        except Exception as exc:
            logger.warning("Delayed task alert for %d failed: %s", tid, exc)

    # ── Alert 5: Inventory mismatch (qty = 0) ─────────────────────────────────
    try:
        zero_items = await conn.fetch(
            "SELECT id, item_name, location_zone FROM inventory WHERE quantity=0"
        )
    except Exception as exc:
        logger.warning("Fetch zero-stock items failed: %s", exc)
        zero_items = []

    for item in zero_items:
        iid = item['id']
        try:
            exists = await conn.fetchval(
                "SELECT 1 FROM alerts WHERE message LIKE $1 AND resolved=FALSE LIMIT 1",
                f"inventory_mismatch: {item['item_name']}%",
            )
            if exists:
                continue
            msg_text = (
                f"inventory_mismatch: {item['item_name']} "
                f"in zone {item['location_zone']} qty=0"
            )
            await conn.execute(
                "INSERT INTO alerts (severity, message, resolved, created_at) "
                "VALUES ('warning', $1, FALSE, NOW())",
                msg_text,
            )
            await conn.execute(
                "INSERT INTO events (type, payload, timestamp) VALUES ($1, $2, NOW())",
                'alert_triggered',
                {'item_id': iid, 'item_name': item['item_name'],
                 'zone': item['location_zone'], 'reason': 'inventory_mismatch'},
            )
            msgs.append({'type': 'alert', 'payload': {'severity': 'warning', 'message': msg_text}})
        except Exception as exc:
            logger.warning("Inventory mismatch alert for item %d failed: %s", iid, exc)

    return msgs
