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
    ('Torque Wrench 20-100Nm',        9, 'D4', NOW()),
    -- Zone E1
    ('Drive Belt 50mm',              45, 'E1', NOW()),
    ('Shaft Coupling 25mm',          22, 'E1', NOW()),
    ('Gear Pulley Set',              18, 'E1', NOW()),
    -- Zone E2  ← replenishment target
    ('Pneumatic Hose 8mm 5m',        30, 'E2', NOW()),
    ('Pressure Gauge 0-10bar',       14, 'E2', NOW()),
    ('Flow Control Valve 1/4in',      8, 'E2', NOW()),
    -- Zone E3
    ('Conveyor Chain Link 12B',      60, 'E3', NOW()),
    ('Tension Spring 50N',           90, 'E3', NOW()),
    ('Guide Rail 1m Aluminium',      25, 'E3', NOW()),
    -- Zone E4
    ('Servo Motor 200W',             12, 'E4', NOW()),
    ('Linear Rail 500mm',            20, 'E4', NOW()),
    ('Ball Screw 1m',                 8, 'E4', NOW()),
    -- Zone F1
    ('Temperature Sensor PT100',     35, 'F1', NOW()),
    ('Humidity Sensor Module',       28, 'F1', NOW()),
    ('Pressure Transmitter 4-20mA',  16, 'F1', NOW()),
    -- Zone F2
    ('Power Supply 24VDC 5A',        22, 'F2', NOW()),
    ('Circuit Breaker 16A',          40, 'F2', NOW()),
    ('Relay Module 8-channel',       18, 'F2', NOW()),
    -- Zone F3  ← replenishment target
    ('Industrial Switch 16-port',     5, 'F3', NOW()),
    ('Ethernet Cable Cat6 10m',      80, 'F3', NOW()),
    ('Fibre Optic Patch Cord 2m',    12, 'F3', NOW()),
    -- Zone F4
    ('PLC Input Module 16DI',        10, 'F4', NOW()),
    ('PLC Output Module 16DO',       10, 'F4', NOW()),
    ('HMI Panel 7 inch',              6, 'F4', NOW()),
    -- Zone G1  ← replenishment target
    ('Aluminium Sheet 2mm 1x2m',      7, 'G1', NOW()),
    ('Steel Plate 5mm 1x1m',         15, 'G1', NOW()),
    ('Copper Rod 10mm 1m',           30, 'G1', NOW()),
    -- Zone G2
    ('Rubber Sheet 10mm 1x1m',       20, 'G2', NOW()),
    ('Neoprene Gasket Roll 5m',      14, 'G2', NOW()),
    ('Fibreglass Panel 4mm',         10, 'G2', NOW()),
    -- Zone G3
    ('Resin Epoxy 1kg',              25, 'G3', NOW()),
    ('Bonding Adhesive 300ml',       40, 'G3', NOW()),
    ('Sealant Tube 310ml',           55, 'G3', NOW()),
    -- Zone G4
    ('Welding Wire 1mm 5kg',         18, 'G4', NOW()),
    ('Welding Rod E7016 5kg',        22, 'G4', NOW()),
    ('MIG Wire 0.8mm 15kg',          10, 'G4', NOW()),
    -- Zone H1
    ('Safety Harness Full Body',     14, 'H1', NOW()),
    ('Lanyard 1.8m Shock Absorb',    20, 'H1', NOW()),
    ('Fall Arrest Device',            8, 'H1', NOW()),
    -- Zone H2
    ('Chemical Resistant Gloves L',  60, 'H2', NOW()),
    ('Acid Apron PVC',               18, 'H2', NOW()),
    ('Face Shield Anti-splash',      24, 'H2', NOW()),
    -- Zone H3
    ('Dust Mask P3 Valved',          80, 'H3', NOW()),
    ('Half-face Respirator',         22, 'H3', NOW()),
    ('Gas Detector Personal 4-gas',   9, 'H3', NOW()),
    -- Zone H4  ← replenishment target
    ('Safety Cone 75cm',              6, 'H4', NOW()),
    ('Barrier Tape 500m Roll',       12, 'H4', NOW()),
    ('Warning Light Amber',          16, 'H4', NOW()),
    -- Zone I1
    ('Hex Bolt M10x50 100pk',        45, 'I1', NOW()),
    ('Hex Nut M10 100pk',            50, 'I1', NOW()),
    ('Flat Washer M10 200pk',        60, 'I1', NOW()),
    -- Zone I2
    ('Stainless Screw M6x20 50pk',   35, 'I2', NOW()),
    ('Rivet Aluminium 4mm 500pk',    28, 'I2', NOW()),
    ('Thread Insert M8 20pk',        40, 'I2', NOW()),
    -- Zone I3  ← replenishment target
    ('Anchor Bolt M12 10pk',          7, 'I3', NOW()),
    ('Chemical Anchor 300ml',        12, 'I3', NOW()),
    ('Expansion Bolt M10 20pk',      18, 'I3', NOW()),
    -- Zone I4
    ('Pipe Clamp 25mm 10pk',         30, 'I4', NOW()),
    ('Cable Clamp 20mm 20pk',        45, 'I4', NOW()),
    ('U-bolt 30mm 10pk',             25, 'I4', NOW()),
    -- Zone J1
    ('Cutting Disc 125mm 10pk',      40, 'J1', NOW()),
    ('Grinding Disc 180mm 5pk',      30, 'J1', NOW()),
    ('Flap Disc P80 5pk',            25, 'J1', NOW()),
    -- Zone J2  ← replenishment target
    ('Hydraulic Fluid ISO46 20L',     8, 'J2', NOW()),
    ('Gear Oil 220 20L',             10, 'J2', NOW()),
    ('Chain Lubricant 5L',           15, 'J2', NOW()),
    -- Zone J3
    ('Cleaning Solvent 5L',          20, 'J3', NOW()),
    ('Degreaser Spray 500ml',        35, 'J3', NOW()),
    ('Isopropanol 1L',               28, 'J3', NOW()),
    -- Zone J4
    ('Cable Duct 40x25mm 2m',        50, 'J4', NOW()),
    ('Heat Shrink Tubing 5mm 5m',    60, 'J4', NOW()),
    ('Cable Marker Set 200pk',       22, 'J4', NOW()),
    -- Zone K1  ← replenishment target
    ('Storage Bin 15L Blue',          9, 'K1', NOW()),
    ('Storage Bin 30L Red',          12, 'K1', NOW()),
    ('Divider Set for Bins',         20, 'K1', NOW()),
    -- Zone K2
    ('Sack Truck Foldable',          10, 'K2', NOW()),
    ('Platform Trolley 500kg',        6, 'K2', NOW()),
    ('Drum Trolley Stainless',        4, 'K2', NOW()),
    -- Zone K3
    ('Racking Beam 1800mm',          24, 'K3', NOW()),
    ('Racking Upright 3000mm',       16, 'K3', NOW()),
    ('Wire Mesh Deck 900x900mm',     20, 'K3', NOW()),
    -- Zone K4  ← replenishment target
    ('Stretch Wrap Machine',          4, 'K4', NOW()),
    ('Banding Tool Steel',            8, 'K4', NOW()),
    ('Corner Protector Pack 50pk',   30, 'K4', NOW())
ON CONFLICT (item_name) DO NOTHING;
