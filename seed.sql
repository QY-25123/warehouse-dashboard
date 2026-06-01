-- Seed Data for Real-Time Warehouse Dashboard
-- All timestamps anchored to NOW() so data stays fresh on each load.

-- ─── Forklifts (10) ───────────────────────────────────────────────────────────
-- moving_empty = en-route to pickup  |  moving_loaded = en-route to dropoff
INSERT INTO forklifts (name, status, x, y, last_updated) VALUES
    ('FL-001', 'idle',          12.50,  8.00, NOW() - INTERVAL '2 minutes'),
    ('FL-002', 'moving_empty',  34.75, 22.50, NOW() - INTERVAL '30 seconds'),
    ('FL-003', 'loading',       56.00, 45.00, NOW() - INTERVAL '5 minutes'),
    ('FL-004', 'idle',          78.25, 67.75, NOW() - INTERVAL '15 minutes'),
    ('FL-005', 'moving_empty',  23.00, 89.50, NOW() - INTERVAL '1 minute'),
    ('FL-006', 'error',         90.50, 12.25, NOW() - INTERVAL '20 minutes'),
    ('FL-007', 'loading',       45.00, 55.00, NOW() - INTERVAL '3 minutes'),
    ('FL-008', 'idle',          67.80, 30.60, NOW() - INTERVAL '10 minutes'),
    ('FL-009', 'moving_empty',  15.40, 73.20, NOW() - INTERVAL '45 seconds'),
    ('FL-010', 'error',         82.10, 41.90, NOW() - INTERVAL '25 minutes');

-- ─── Inventory (50 items across zones A1–D4) ──────────────────────────────────
-- Inserted before tasks so inventory IDs are available as FKs.
INSERT INTO inventory (item_name, quantity, location_zone, last_updated) VALUES
    -- Zone A1  (ids 1-4)
    ('Industrial Bolts M8',         340, 'A1', NOW() - INTERVAL '1 hour'),
    ('Safety Gloves L',             120, 'A1', NOW() - INTERVAL '2 hours'),
    ('Pallet Wrap 500m',             45, 'A1', NOW() - INTERVAL '30 minutes'),
    ('Steel Brackets 10cm',         200, 'A1', NOW() - INTERVAL '3 hours'),
    -- Zone A2  (ids 5-8)
    ('Hydraulic Oil 5L',             30, 'A2', NOW() - INTERVAL '4 hours'),
    ('Conveyor Belt Segment',        12, 'A2', NOW() - INTERVAL '5 hours'),
    ('Cable Ties 100pk',            500, 'A2', NOW() - INTERVAL '1 hour'),
    ('Lubricant Spray 400ml',        88, 'A2', NOW() - INTERVAL '2 hours'),
    -- Zone A3  (ids 9-12)  ← low stock, replenishment target
    ('Forklift Battery 48V',          6, 'A3', NOW() - INTERVAL '6 hours'),
    ('Wire Rope 10m',                22, 'A3', NOW() - INTERVAL '7 hours'),
    ('Hex Key Set',                  55, 'A3', NOW() - INTERVAL '2 hours'),
    ('Anti-Slip Mat 1x2m',           30, 'A3', NOW() - INTERVAL '3 hours'),
    -- Zone A4  (ids 13-15) ← low stock, replenishment target
    ('Barcode Scanner BT',            9, 'A4', NOW() - INTERVAL '8 hours'),
    ('Label Printer Ribbon',         75, 'A4', NOW() - INTERVAL '1 hour'),
    ('Shelving Unit 180cm',          14, 'A4', NOW() - INTERVAL '5 hours'),
    -- Zone B1  (ids 16-19)
    ('Cardboard Boxes S',           600, 'B1', NOW() - INTERVAL '20 minutes'),
    ('Cardboard Boxes L',           250, 'B1', NOW() - INTERVAL '45 minutes'),
    ('Bubble Wrap Roll 50m',         40, 'B1', NOW() - INTERVAL '1 hour'),
    ('Foam Corner Guards',          180, 'B1', NOW() - INTERVAL '2 hours'),
    -- Zone B2  (ids 20-22)
    ('Tape Dispenser',               35, 'B2', NOW() - INTERVAL '3 hours'),
    ('Stretch Film 23mu',           110, 'B2', NOW() - INTERVAL '4 hours'),
    ('Wooden Pallets EUR',           60, 'B2', NOW() - INTERVAL '1 hour'),
    -- Zone B3  (ids 23-25)
    ('Plastic Bins 30L',             95, 'B3', NOW() - INTERVAL '5 hours'),
    ('Divider Panels',               48, 'B3', NOW() - INTERVAL '2 hours'),
    ('Label Holders A4',            200, 'B3', NOW() - INTERVAL '6 hours'),
    -- Zone B4  (ids 26-28)
    ('Hand Truck Rubber Wheels',     10, 'B4', NOW() - INTERVAL '7 hours'),
    ('Packing Peanuts 50L',          28, 'B4', NOW() - INTERVAL '3 hours'),
    ('Vacuum Sealer Bags',          150, 'B4', NOW() - INTERVAL '1 hour'),
    -- Zone C1  (ids 29-32)
    ('Electronic Sensor Module',     17, 'C1', NOW() - INTERVAL '8 hours'),
    ('PLC Control Unit',              4, 'C1', NOW() - INTERVAL '9 hours'),
    ('Proximity Switch NPN',         33, 'C1', NOW() - INTERVAL '2 hours'),
    ('LED Strip Light 5m',           42, 'C1', NOW() - INTERVAL '4 hours'),
    -- Zone C2  (ids 33-35)
    ('Network Switch 8-port',         5, 'C2', NOW() - INTERVAL '10 hours'),
    ('RFID Tag Roll 500',            160, 'C2', NOW() - INTERVAL '1 hour'),
    ('USB-C Cable 2m',              210, 'C2', NOW() - INTERVAL '2 hours'),
    -- Zone C3  (ids 36-39)
    ('Safety Helmet White',          80, 'C3', NOW() - INTERVAL '3 hours'),
    ('Hi-Vis Vest M',               130, 'C3', NOW() - INTERVAL '1 hour'),
    ('Steel-Toe Boot Size 43',       20, 'C3', NOW() - INTERVAL '5 hours'),
    ('Ear Protectors',               65, 'C3', NOW() - INTERVAL '4 hours'),
    -- Zone C4  (ids 40-42) ← low stock, replenishment target
    ('First Aid Kit',                 8, 'C4', NOW() - INTERVAL '11 hours'),
    ('Fire Extinguisher CO2',         3, 'C4', NOW() - INTERVAL '12 hours'),
    ('Spill Kit 20L',                10, 'C4', NOW() - INTERVAL '6 hours'),
    -- Zone D1  (ids 43-45)
    ('Motor Drive Inverter',          7, 'D1', NOW() - INTERVAL '13 hours'),
    ('Gearbox 1:20',                  5, 'D1', NOW() - INTERVAL '8 hours'),
    ('Bearing SKF 6205',             90, 'D1', NOW() - INTERVAL '2 hours'),
    -- Zone D2  (ids 46-48)
    ('O-Ring Kit 100pk',             55, 'D2', NOW() - INTERVAL '3 hours'),
    ('Pneumatic Cylinder 50mm',      12, 'D2', NOW() - INTERVAL '7 hours'),
    ('Solenoid Valve 24VDC',         18, 'D2', NOW() - INTERVAL '4 hours'),
    -- Zone D3  (id 49)
    ('Grease Gun 400ml',             22, 'D3', NOW() - INTERVAL '5 hours'),
    -- Zone D4  (id 50) ← low stock, replenishment target
    ('Torque Wrench 20-100Nm',        9, 'D4', NOW() - INTERVAL '6 hours');

-- ─── Tasks (30: 8 inbound · 8 outbound · 7 relocation · 7 replenishment) ──────
-- inventory_item_id: the specific item being moved by each task.
--   inbound      → item in destination zone
--   outbound     → item in origin zone (qty > 0)
--   relocation   → item in origin zone
--   replenishment→ lowest-qty item in destination zone
INSERT INTO tasks (type, forklift_id, status, origin_zone, destination_zone, inventory_item_id, created_at, updated_at) VALUES
    -- ── inbound ───────────────────────────────────────────────────────────────
    ('inbound', 1,    'completed',   'DOCK','A1', 1,  NOW()-INTERVAL '4 hours',    NOW()-INTERVAL '3 hours 30 minutes'),
    ('inbound', 4,    'completed',   'DOCK','B2', 20, NOW()-INTERVAL '2 hours',    NOW()-INTERVAL '1 hour 30 minutes'),
    ('inbound', 2,    'in-progress', 'DOCK','C3', 36, NOW()-INTERVAL '20 minutes', NOW()-INTERVAL '5 minutes'),
    ('inbound', 5,    'in-progress', 'DOCK','D1', 43, NOW()-INTERVAL '15 minutes', NOW()-INTERVAL '3 minutes'),
    ('inbound', NULL, 'pending',     'DOCK','A3', 9,  NOW()-INTERVAL '5 minutes',  NOW()-INTERVAL '5 minutes'),
    ('inbound', NULL, 'pending',     'DOCK','B4', 26, NOW()-INTERVAL '3 minutes',  NOW()-INTERVAL '3 minutes'),
    ('inbound', NULL, 'delayed',     'DOCK','C1', 30, NOW()-INTERVAL '3 hours',    NOW()-INTERVAL '2 hours'),
    ('inbound', NULL, 'delayed',     'DOCK','D4', 50, NOW()-INTERVAL '90 minutes', NOW()-INTERVAL '60 minutes'),
    -- ── outbound ──────────────────────────────────────────────────────────────
    ('outbound', 8,    'completed',   'B1','SHIP', 16, NOW()-INTERVAL '6 hours',    NOW()-INTERVAL '5 hours'),
    ('outbound', 1,    'completed',   'C2','SHIP', 33, NOW()-INTERVAL '3 hours',    NOW()-INTERVAL '2 hours 30 minutes'),
    ('outbound', 3,    'in-progress', 'A2','SHIP', 6,  NOW()-INTERVAL '25 minutes', NOW()-INTERVAL '10 minutes'),
    ('outbound', 7,    'in-progress', 'D3','SHIP', 49, NOW()-INTERVAL '30 minutes', NOW()-INTERVAL '5 minutes'),
    ('outbound', NULL, 'pending',     'A4','SHIP', 13, NOW()-INTERVAL '8 minutes',  NOW()-INTERVAL '8 minutes'),
    ('outbound', NULL, 'pending',     'B3','SHIP', 24, NOW()-INTERVAL '6 minutes',  NOW()-INTERVAL '6 minutes'),
    ('outbound', NULL, 'delayed',     'C4','SHIP', 40, NOW()-INTERVAL '4 hours',    NOW()-INTERVAL '3 hours'),
    ('outbound', 6,   'delayed',      'D2','SHIP', 47, NOW()-INTERVAL '90 minutes', NOW()-INTERVAL '60 minutes'),
    -- ── relocation ────────────────────────────────────────────────────────────
    ('relocation', 4,    'completed',   'A1','D4', 2,  NOW()-INTERVAL '7 hours',    NOW()-INTERVAL '6 hours'),
    ('relocation', 8,    'completed',   'B3','C1', 25, NOW()-INTERVAL '5 hours',    NOW()-INTERVAL '4 hours'),
    ('relocation', 9,    'in-progress', 'C2','A4', 35, NOW()-INTERVAL '10 minutes', NOW()-INTERVAL '2 minutes'),
    ('relocation', NULL, 'pending',     'D1','B2', 44, NOW()-INTERVAL '4 minutes',  NOW()-INTERVAL '4 minutes'),
    ('relocation', NULL, 'pending',     'A2','C3', 8,  NOW()-INTERVAL '2 minutes',  NOW()-INTERVAL '2 minutes'),
    ('relocation', NULL, 'delayed',     'B4','D2', 28, NOW()-INTERVAL '3 hours',    NOW()-INTERVAL '2 hours'),
    ('relocation', NULL, 'delayed',     'C3','A1', 38, NOW()-INTERVAL '1 hour',     NOW()-INTERVAL '30 minutes'),
    -- ── replenishment ─────────────────────────────────────────────────────────
    ('replenishment', 5,    'completed', 'STOR','C4', 41, NOW()-INTERVAL '8 hours',    NOW()-INTERVAL '7 hours'),
    ('replenishment', 4,    'completed', 'STOR','A3', 9,  NOW()-INTERVAL '6 hours',    NOW()-INTERVAL '5 hours'),
    ('replenishment', 8,    'completed', 'STOR','A4', 13, NOW()-INTERVAL '10 hours',   NOW()-INTERVAL '9 hours'),
    ('replenishment', NULL, 'pending',   'STOR','C4', 42, NOW()-INTERVAL '7 minutes',  NOW()-INTERVAL '7 minutes'),
    ('replenishment', NULL, 'pending',   'STOR','A3', 10, NOW()-INTERVAL '5 minutes',  NOW()-INTERVAL '5 minutes'),
    ('replenishment', NULL, 'delayed',   'STOR','D4', 50, NOW()-INTERVAL '2 hours',    NOW()-INTERVAL '90 minutes'),
    ('replenishment', 10,  'delayed',    'STOR','C1', 30, NOW()-INTERVAL '45 minutes', NOW()-INTERVAL '30 minutes');

-- ─── Events (40, spread across last 12 hours) ─────────────────────────────────
INSERT INTO events (type, payload, timestamp) VALUES
    ('forklift_status_change', '{"forklift_id":6,"from":"moving_empty","to":"error","reason":"sensor_fault"}',                          NOW()-INTERVAL '11 hours 50 minutes'),
    ('task_created',           '{"task_id":7,"type":"inbound","origin_zone":"DOCK","destination_zone":"C1"}',                           NOW()-INTERVAL '11 hours 40 minutes'),
    ('sensor_disconnect',      '{"forklift_id":6,"reason":"sensor_disconnect"}',                                                        NOW()-INTERVAL '11 hours 35 minutes'),
    ('task_assigned',          '{"task_id":1,"forklift_id":1}',                                                                         NOW()-INTERVAL '11 hours'),
    ('forklift_departed',      '{"forklift_id":1,"from_zone":"DOCK","to_zone":"A1","leg":2}',                                           NOW()-INTERVAL '10 hours 45 minutes'),
    ('forklift_loading',       '{"forklift_id":1,"zone":"A1","action":"dropoff"}',                                                      NOW()-INTERVAL '10 hours 30 minutes'),
    ('inventory_restocked',    '{"zone":"A1","item_id":1,"item_name":"Industrial Bolts M8","delta":10,"new_qty":340}',                  NOW()-INTERVAL '10 hours'),
    ('task_completed',         '{"task_id":1,"type":"inbound","duration_ticks":14}',                                                    NOW()-INTERVAL '10 hours'),
    ('task_created',           '{"task_id":9,"type":"outbound","origin_zone":"B1","destination_zone":"SHIP"}',                          NOW()-INTERVAL '9 hours 30 minutes'),
    ('task_assigned',          '{"task_id":9,"forklift_id":8}',                                                                         NOW()-INTERVAL '9 hours 20 minutes'),
    ('forklift_loading',       '{"forklift_id":8,"zone":"B1","action":"pickup"}',                                                       NOW()-INTERVAL '9 hours'),
    ('inventory_depleted',     '{"zone":"B1","item_id":16,"item_name":"Cardboard Boxes S","delta":-3,"new_qty":597}',                   NOW()-INTERVAL '8 hours 45 minutes'),
    ('forklift_departed',      '{"forklift_id":8,"from_zone":"B1","to_zone":"SHIP","leg":2}',                                           NOW()-INTERVAL '8 hours 40 minutes'),
    ('task_completed',         '{"task_id":9,"type":"outbound","duration_ticks":14}',                                                   NOW()-INTERVAL '8 hours'),
    ('task_created',           '{"task_id":17,"type":"relocation","origin_zone":"A1","destination_zone":"D4"}',                         NOW()-INTERVAL '7 hours 30 minutes'),
    ('task_assigned',          '{"task_id":17,"forklift_id":4}',                                                                        NOW()-INTERVAL '7 hours 20 minutes'),
    ('inventory_relocated',    '{"item_id":2,"item_name":"Safety Gloves L","from_zone":"A1","to_zone":"D4"}',                           NOW()-INTERVAL '6 hours 30 minutes'),
    ('task_completed',         '{"task_id":17,"type":"relocation","duration_ticks":14}',                                                NOW()-INTERVAL '6 hours'),
    ('task_created',           '{"task_id":24,"type":"replenishment","origin_zone":"STOR","destination_zone":"C4"}',                    NOW()-INTERVAL '5 hours 30 minutes'),
    ('task_assigned',          '{"task_id":24,"forklift_id":5}',                                                                        NOW()-INTERVAL '5 hours 20 minutes'),
    ('inventory_restocked',    '{"zone":"C4","item_id":41,"item_name":"Fire Extinguisher CO2","delta":15,"new_qty":18}',                NOW()-INTERVAL '4 hours'),
    ('task_completed',         '{"task_id":24,"type":"replenishment","duration_ticks":14}',                                             NOW()-INTERVAL '4 hours'),
    ('task_delayed',           '{"task_id":7,"type":"inbound","reason":"timeout"}',                                                     NOW()-INTERVAL '3 hours 30 minutes'),
    ('zone_entry',             '{"forklift_id":9,"zone":"C2","x":38.5,"y":65.2}',                                                      NOW()-INTERVAL '2 hours 30 minutes'),
    ('zone_congestion',        '{"zone":"B2","forklift_count":3}',                                                                      NOW()-INTERVAL '2 hours'),
    ('alert_triggered',        '{"alert_id":5,"severity":"warning","message":"Zone B2 congested: 3 forklifts present"}',               NOW()-INTERVAL '2 hours'),
    ('task_created',           '{"task_id":3,"type":"inbound","origin_zone":"DOCK","destination_zone":"C3"}',                           NOW()-INTERVAL '1 hour 30 minutes'),
    ('task_assigned',          '{"task_id":3,"forklift_id":2}',                                                                         NOW()-INTERVAL '1 hour 20 minutes'),
    ('forklift_loading',       '{"forklift_id":2,"zone":"DOCK","action":"pickup"}',                                                     NOW()-INTERVAL '1 hour'),
    ('task_created',           '{"task_id":11,"type":"outbound","origin_zone":"A2","destination_zone":"SHIP"}',                         NOW()-INTERVAL '50 minutes'),
    ('task_assigned',          '{"task_id":11,"forklift_id":3}',                                                                        NOW()-INTERVAL '45 minutes'),
    ('zone_entry',             '{"forklift_id":3,"zone":"A2","x":32.1,"y":18.7}',                                                      NOW()-INTERVAL '40 minutes'),
    ('task_created',           '{"task_id":19,"type":"relocation","origin_zone":"C2","destination_zone":"A4"}',                         NOW()-INTERVAL '20 minutes'),
    ('task_assigned',          '{"task_id":19,"forklift_id":9}',                                                                        NOW()-INTERVAL '18 minutes'),
    ('forklift_status_change', '{"forklift_id":10,"from":"moving_empty","to":"error","reason":"sensor_fault"}',                         NOW()-INTERVAL '10 minutes'),
    ('sensor_disconnect',      '{"forklift_id":10,"reason":"sensor_disconnect"}',                                                       NOW()-INTERVAL '10 minutes'),
    ('alert_triggered',        '{"alert_id":7,"severity":"critical","message":"FL-010 sensor disconnect"}',                             NOW()-INTERVAL '10 minutes'),
    ('zone_entry',             '{"forklift_id":5,"zone":"D4","x":87.5,"y":87.5}',                                                      NOW()-INTERVAL '5 minutes'),
    ('inventory_restocked',    '{"zone":"A3","item_id":9,"item_name":"Forklift Battery 48V","delta":14,"new_qty":20}',                  NOW()-INTERVAL '4 hours'),
    ('task_completed',         '{"task_id":25,"type":"replenishment","duration_ticks":14}',                                             NOW()-INTERVAL '4 hours');

-- ─── Alerts (10) ──────────────────────────────────────────────────────────────
INSERT INTO alerts (severity, message, resolved, created_at) VALUES
    ('critical', 'FL-006 sensor fault – forklift taken offline',                              TRUE,  NOW()-INTERVAL '11 hours 50 minutes'),
    ('warning',  'FL-006 requires scheduled maintenance before return to service',            FALSE, NOW()-INTERVAL '11 hours 35 minutes'),
    ('warning',  'delayed_task: task 7 (type: inbound) did not complete on time',            FALSE, NOW()-INTERVAL '3 hours 30 minutes'),
    ('warning',  'Zone B2 congested: 3 forklifts present',                                   FALSE, NOW()-INTERVAL '2 hours'),
    ('warning',  'delayed_task: task 15 (type: outbound) did not complete on time',          FALSE, NOW()-INTERVAL '2 hours 30 minutes'),
    ('info',     'Daily inventory sync completed successfully',                               TRUE,  NOW()-INTERVAL '1 hour 30 minutes'),
    ('critical', 'FL-010 sensor fault – forklift taken offline',                             FALSE, NOW()-INTERVAL '10 minutes'),
    ('warning',  'forklift_inactivity: forklift 6 (FL-006) idle/error for 5 ticks',         FALSE, NOW()-INTERVAL '8 hours'),
    ('warning',  'inventory_mismatch: PLC Control Unit in zone C1 qty=0',                    FALSE, NOW()-INTERVAL '6 hours'),
    ('info',     'Forklift battery FL-003 at 25% – recommend charging after current task',  FALSE, NOW()-INTERVAL '3 minutes');
