-- Reference data only — tasks, events, and alerts are generated organically
-- by the simulator from tick 1. This file is safe to re-run (ON CONFLICT DO NOTHING).

-- ─── Forklifts (10) ───────────────────────────────────────────────────────────
-- Positions and status are overwritten by entrypoint.sh on every start.
INSERT INTO forklifts (name, status, x, y, last_updated) VALUES
    ('FL-001', 'idle', 12.5, 12.5, NOW()),
    ('FL-002', 'idle', 37.5, 12.5, NOW()),
    ('FL-003', 'idle', 62.5, 12.5, NOW()),
    ('FL-004', 'idle', 87.5, 12.5, NOW()),
    ('FL-005', 'idle', 12.5, 37.5, NOW()),
    ('FL-006', 'idle', 37.5, 37.5, NOW()),
    ('FL-007', 'idle', 62.5, 37.5, NOW()),
    ('FL-008', 'idle', 87.5, 37.5, NOW()),
    ('FL-009', 'idle', 12.5, 62.5, NOW()),
    ('FL-010', 'idle', 37.5, 62.5, NOW())
ON CONFLICT (name) DO NOTHING;

-- ─── Inventory (50 items across zones A1–D4) ──────────────────────────────────
INSERT INTO inventory (item_name, quantity, location_zone, last_updated) VALUES
    -- Zone A1
    ('Industrial Bolts M8',         340, 'A1', NOW()),
    ('Safety Gloves L',             120, 'A1', NOW()),
    ('Pallet Wrap 500m',             45, 'A1', NOW()),
    ('Steel Brackets 10cm',         200, 'A1', NOW()),
    -- Zone A2
    ('Hydraulic Oil 5L',             30, 'A2', NOW()),
    ('Conveyor Belt Segment',        12, 'A2', NOW()),
    ('Cable Ties 100pk',            500, 'A2', NOW()),
    ('Lubricant Spray 400ml',        88, 'A2', NOW()),
    -- Zone A3  ← low stock, replenishment target
    ('Forklift Battery 48V',          6, 'A3', NOW()),
    ('Wire Rope 10m',                22, 'A3', NOW()),
    ('Hex Key Set',                  55, 'A3', NOW()),
    ('Anti-Slip Mat 1x2m',           30, 'A3', NOW()),
    -- Zone A4  ← low stock, replenishment target
    ('Barcode Scanner BT',            9, 'A4', NOW()),
    ('Label Printer Ribbon',         75, 'A4', NOW()),
    ('Shelving Unit 180cm',          14, 'A4', NOW()),
    -- Zone B1
    ('Cardboard Boxes S',           600, 'B1', NOW()),
    ('Cardboard Boxes L',           250, 'B1', NOW()),
    ('Bubble Wrap Roll 50m',         40, 'B1', NOW()),
    ('Foam Corner Guards',          180, 'B1', NOW()),
    -- Zone B2
    ('Tape Dispenser',               35, 'B2', NOW()),
    ('Stretch Film 23mu',           110, 'B2', NOW()),
    ('Wooden Pallets EUR',           60, 'B2', NOW()),
    -- Zone B3
    ('Plastic Bins 30L',             95, 'B3', NOW()),
    ('Divider Panels',               48, 'B3', NOW()),
    ('Label Holders A4',            200, 'B3', NOW()),
    -- Zone B4
    ('Hand Truck Rubber Wheels',     10, 'B4', NOW()),
    ('Packing Peanuts 50L',          28, 'B4', NOW()),
    ('Vacuum Sealer Bags',          150, 'B4', NOW()),
    -- Zone C1
    ('Electronic Sensor Module',     17, 'C1', NOW()),
    ('PLC Control Unit',              4, 'C1', NOW()),
    ('Proximity Switch NPN',         33, 'C1', NOW()),
    ('LED Strip Light 5m',           42, 'C1', NOW()),
    -- Zone C2
    ('Network Switch 8-port',         5, 'C2', NOW()),
    ('RFID Tag Roll 500',            160, 'C2', NOW()),
    ('USB-C Cable 2m',              210, 'C2', NOW()),
    -- Zone C3
    ('Safety Helmet White',          80, 'C3', NOW()),
    ('Hi-Vis Vest M',               130, 'C3', NOW()),
    ('Steel-Toe Boot Size 43',       20, 'C3', NOW()),
    ('Ear Protectors',               65, 'C3', NOW()),
    -- Zone C4  ← low stock, replenishment target
    ('First Aid Kit',                 8, 'C4', NOW()),
    ('Fire Extinguisher CO2',         3, 'C4', NOW()),
    ('Spill Kit 20L',                10, 'C4', NOW()),
    -- Zone D1
    ('Motor Drive Inverter',          7, 'D1', NOW()),
    ('Gearbox 1:20',                  5, 'D1', NOW()),
    ('Bearing SKF 6205',             90, 'D1', NOW()),
    -- Zone D2
    ('O-Ring Kit 100pk',             55, 'D2', NOW()),
    ('Pneumatic Cylinder 50mm',      12, 'D2', NOW()),
    ('Solenoid Valve 24VDC',         18, 'D2', NOW()),
    -- Zone D3
    ('Grease Gun 400ml',             22, 'D3', NOW()),
    -- Zone D4  ← low stock, replenishment target
    ('Torque Wrench 20-100Nm',        9, 'D4', NOW())
ON CONFLICT (item_name) DO NOTHING;
