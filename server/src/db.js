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
  prev_water_custom REAL,
  prev_electricity_custom REAL,
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

// ===== Migration：monthly_records 增加 prev_water_custom/prev_electricity_custom 列 =====
{
  const cols = db.prepare(`PRAGMA table_info(monthly_records)`).all();
  const names = cols.map((c) => c.name);
  if (!names.includes('prev_water_custom')) {
    db.exec(`ALTER TABLE monthly_records ADD COLUMN prev_water_custom REAL`);
    console.log('[db] 迁移 monthly_records：新增 prev_water_custom 列');
  }
  if (!names.includes('prev_electricity_custom')) {
    db.exec(`ALTER TABLE monthly_records ADD COLUMN prev_electricity_custom REAL`);
    console.log('[db] 迁移 monthly_records：新增 prev_electricity_custom 列');
  }
  if (!names.includes('exception_note')) {
    db.exec(`ALTER TABLE monthly_records ADD COLUMN exception_note TEXT`);
    console.log('[db] 迁移 monthly_records：新增 exception_note 列（异常项标记）');
  }
  // 当月覆盖值：NULL=用房间预设，非空=当月自定义
  if (!names.includes('custom_monthly_rent')) {
    db.exec(`ALTER TABLE monthly_records ADD COLUMN custom_monthly_rent REAL`);
    console.log('[db] 迁移 monthly_records：新增 custom_monthly_rent 列');
  }
  if (!names.includes('custom_water_unit_price')) {
    db.exec(`ALTER TABLE monthly_records ADD COLUMN custom_water_unit_price REAL`);
    console.log('[db] 迁移 monthly_records：新增 custom_water_unit_price 列');
  }
  if (!names.includes('custom_electricity_unit_price')) {
    db.exec(`ALTER TABLE monthly_records ADD COLUMN custom_electricity_unit_price REAL`);
    console.log('[db] 迁移 monthly_records：新增 custom_electricity_unit_price 列');
  }
}

// ===== Migration：旧 rooms 表含 start_date/initial_water/initial_electricity 时重建为精简结构 =====
{
  const col = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='rooms'`).get();
  if (col && (col.sql.includes('initial_water') || col.sql.includes('start_date'))) {
    console.log('[db] 迁移 rooms 表：移除 start_date/initial_water/initial_electricity');
    db.exec(`
      ALTER TABLE rooms RENAME TO rooms_old;
      CREATE TABLE rooms (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        floor TEXT NOT NULL,
        room_number TEXT NOT NULL,
        monthly_rent REAL NOT NULL DEFAULT 0,
        water_unit_price REAL NOT NULL DEFAULT 0,
        electricity_unit_price REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
        UNIQUE(floor, room_number)
      );
      INSERT INTO rooms (id, floor, room_number, monthly_rent, water_unit_price, electricity_unit_price, created_at)
      SELECT id, floor, room_number, monthly_rent, water_unit_price, electricity_unit_price, created_at FROM rooms_old;
      DROP TABLE rooms_old;
    `);
  }
}

// ===== 首次启动种子导入 =====
const countRow = db.prepare('SELECT COUNT(*) AS c FROM rooms').get();
if (countRow.c === 0) {
  const configPath = join(__dirname, '..', 'config', 'rooms.config.json');
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);
    const insert = db.prepare(`
      INSERT INTO rooms (floor, room_number, monthly_rent, water_unit_price, electricity_unit_price)
      VALUES (@floor, @roomNumber, @monthlyRent, @waterUnitPrice, @electricityUnitPrice)
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
