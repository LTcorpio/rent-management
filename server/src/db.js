import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbPath = join(__dirname, '..', 'data.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');

// ===== 建表 =====
db.exec(`
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  floor TEXT NOT NULL,
  room_number TEXT NOT NULL,
  monthly_rent REAL NOT NULL DEFAULT 0,
  water_unit_price REAL NOT NULL DEFAULT 0,
  electricity_unit_price REAL NOT NULL DEFAULT 0,
  start_date TEXT,
  initial_water REAL NOT NULL DEFAULT 0,
  initial_electricity REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(floor, room_number)
);

CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  id_card TEXT,
  occupants INTEGER DEFAULT 1,
  move_in_date TEXT,
  move_out_date TEXT,
  is_current INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (room_id) REFERENCES rooms(id)
);

CREATE TABLE IF NOT EXISTS monthly_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id INTEGER NOT NULL,
  tenant_id INTEGER,
  year INTEGER NOT NULL,
  month INTEGER NOT NULL,
  prev_water_reading REAL NOT NULL DEFAULT 0,
  prev_electricity_reading REAL NOT NULL DEFAULT 0,
  water_reading REAL,
  electricity_reading REAL,
  water_usage REAL,
  electricity_usage REAL,
  water_fee REAL,
  electricity_fee REAL,
  rent REAL,
  total REAL,
  archived INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  UNIQUE(room_id, year, month)
);
`);

// ===== 首次启动种子导入 =====
const countRow = db.prepare('SELECT COUNT(*) AS c FROM rooms').get();
if (countRow.c === 0) {
  const configPath = join(__dirname, '..', 'config', 'rooms.config.json');
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    const insert = db.prepare(`
      INSERT INTO rooms (floor, room_number, monthly_rent, water_unit_price, electricity_unit_price, start_date, initial_water, initial_electricity)
      VALUES (@floor, @roomNumber, @monthlyRent, @waterUnitPrice, @electricityUnitPrice, @startDate, @initialWater, @initialElectricity)
    `);
    const tx = db.transaction((rooms) => {
      for (const r of rooms) insert.run(r);
    });
    tx(config.rooms || []);
    console.log(`[db] 已从配置导入 ${config.rooms?.length || 0} 个房间`);
  } catch (e) {
    console.warn('[db] 读取房间配置失败:', e.message);
  }
}

export default db;
