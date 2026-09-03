package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"

	_ "modernc.org/sqlite" // 纯 Go SQLite 驱动，无需 cgo
)

// Store 持有 SQLite 连接。
// 与原 better-sqlite3 的同步语义对齐：限制为单连接串行访问，避免并发写锁冲突。
type Store struct {
	db     *sql.DB
	path   string
	closed sync.Once
}

const schema = `
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
`

// Open 打开数据库（WAL 模式），执行建表、迁移与首次启动种子导入。
func Open(path string) *Store {
	db, err := sql.Open("sqlite", path)
	if err != nil {
		log.Fatalf("[db] 打开数据库失败: %v", err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)

	s := &Store{db: db, path: path}
	if _, err := db.Exec("PRAGMA journal_mode = WAL"); err != nil {
		log.Fatalf("[db] 设置 WAL 模式失败: %v", err)
	}
	s.migrate()
	s.seed()
	return s
}

// DB 暴露底层连接供 API 层查询使用。
func (s *Store) DB() *sql.DB { return s.db }

// Close 关闭数据库连接。
// 关闭前先执行 wal_checkpoint(TRUNCATE)：把 WAL 中已提交事务写回主库，
// 数据库层自动回滚尚未提交的事务；正常关闭后 SQLite 会删除 -wal/-shm 临时文件，
// 最后再兜底清理可能残留的空临时文件，保证数据目录干净。
func (s *Store) Close() error {
	var err error
	s.closed.Do(func() {
		if _, e := s.db.Exec("PRAGMA wal_checkpoint(TRUNCATE)"); e != nil {
			log.Printf("[db] WAL checkpoint 失败（继续关闭）: %v", e)
		}
		err = s.db.Close()
		s.cleanupSidecarFiles()
	})
	return err
}

// cleanupSidecarFiles 兜底清理 -wal/-shm 残留文件。
// 仅删除 0 字节的残留文件；checkpoint 已在此前执行，非空文件保留并告警，
// 绝不删除可能含未落盘数据的 WAL，避免丢数据。
func (s *Store) cleanupSidecarFiles() {
	for _, suffix := range []string{"-wal", "-shm"} {
		p := s.path + suffix
		info, err := os.Stat(p)
		if err != nil || info.IsDir() {
			continue
		}
		if info.Size() == 0 {
			if err := os.Remove(p); err != nil {
				log.Printf("[db] 清理临时文件失败 %s: %v", p, err)
			} else {
				log.Printf("[db] 已清理残留临时文件: %s", filepath.Base(p))
			}
		} else {
			log.Printf("[db] 警告: %s 非空（%d 字节），已保留，请检查数据库状态", filepath.Base(p), info.Size())
		}
	}
}

func (s *Store) migrate() {
	if _, err := s.db.Exec(schema); err != nil {
		log.Fatalf("[db] 建表失败: %v", err)
	}

	// Migration：monthly_records 增加自定义列（旧库补列，新库建表时已含）
	cols := s.tableColumns("monthly_records")
	addCol := func(name, ddl, logMsg string) {
		if !slices.Contains(cols, name) {
			if _, err := s.db.Exec(fmt.Sprintf("ALTER TABLE monthly_records ADD COLUMN %s", ddl)); err != nil {
				log.Fatalf("[db] 迁移 monthly_records 失败: %v", err)
			}
			log.Printf("[db] 迁移 monthly_records：新增 %s", logMsg)
		}
	}
	addCol("prev_water_custom", "prev_water_custom REAL", "prev_water_custom 列")
	addCol("prev_electricity_custom", "prev_electricity_custom REAL", "prev_electricity_custom 列")
	addCol("exception_note", "exception_note TEXT", "exception_note 列（异常项标记）")
	// 当月覆盖值：NULL=用房间预设，非空=当月自定义
	addCol("custom_monthly_rent", "custom_monthly_rent REAL", "custom_monthly_rent 列")
	addCol("custom_water_unit_price", "custom_water_unit_price REAL", "custom_water_unit_price 列")
	addCol("custom_electricity_unit_price", "custom_electricity_unit_price REAL", "custom_electricity_unit_price 列")

	// Migration：旧 rooms 表含 start_date/initial_water/initial_electricity 时重建为精简结构
	var roomSQL sql.NullString
	_ = s.db.QueryRow(`SELECT sql FROM sqlite_master WHERE type='table' AND name='rooms'`).Scan(&roomSQL)
	if roomSQL.Valid && (strings.Contains(roomSQL.String, "initial_water") || strings.Contains(roomSQL.String, "start_date")) {
		log.Println("[db] 迁移 rooms 表：移除 start_date/initial_water/initial_electricity")
		stmts := []string{
			`ALTER TABLE rooms RENAME TO rooms_old`,
			`CREATE TABLE rooms (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				floor TEXT NOT NULL,
				room_number TEXT NOT NULL,
				monthly_rent REAL NOT NULL DEFAULT 0,
				water_unit_price REAL NOT NULL DEFAULT 0,
				electricity_unit_price REAL NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
				UNIQUE(floor, room_number)
			)`,
			`INSERT INTO rooms (id, floor, room_number, monthly_rent, water_unit_price, electricity_unit_price, created_at)
			 SELECT id, floor, room_number, monthly_rent, water_unit_price, electricity_unit_price, created_at FROM rooms_old`,
			`DROP TABLE rooms_old`,
		}
		for _, stmt := range stmts {
			if _, err := s.db.Exec(stmt); err != nil {
				log.Fatalf("[db] 迁移 rooms 表失败: %v", err)
			}
		}
	}
}

func (s *Store) tableColumns(table string) []string {
	rows, err := s.db.Query(fmt.Sprintf("PRAGMA table_info(%s)", table))
	if err != nil {
		return nil
	}
	defer rows.Close()
	var cols []string
	for rows.Next() {
		var cid int64
		var name, colType string
		var notNull, pk int64
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &colType, &notNull, &dflt, &pk); err != nil {
			return nil
		}
		cols = append(cols, name)
	}
	return cols
}

// seed 首次启动（rooms 表为空）时从 config/rooms.config.json 导入房间预设。
func (s *Store) seed() {
	var count int64
	if err := s.db.QueryRow("SELECT COUNT(*) AS c FROM rooms").Scan(&count); err != nil {
		log.Fatalf("[db] 查询房间数失败: %v", err)
	}
	if count > 0 {
		return
	}

	raw, err := os.ReadFile(filepath.Join("config", "rooms.config.json"))
	if err != nil {
		log.Printf("[db] 读取房间配置失败: %v", err)
		return
	}
	var config struct {
		Rooms []struct {
			Floor                string  `json:"floor"`
			RoomNumber           string  `json:"roomNumber"`
			MonthlyRent          float64 `json:"monthlyRent"`
			WaterUnitPrice       float64 `json:"waterUnitPrice"`
			ElectricityUnitPrice float64 `json:"electricityUnitPrice"`
		} `json:"rooms"`
	}
	if err := json.Unmarshal(raw, &config); err != nil {
		log.Printf("[db] 读取房间配置失败: %v", err)
		return
	}

	tx, err := s.db.Begin()
	if err != nil {
		log.Fatalf("[db] 开启事务失败: %v", err)
	}
	defer tx.Rollback()
	for _, r := range config.Rooms {
		if _, err := tx.Exec(
			`INSERT INTO rooms (floor, room_number, monthly_rent, water_unit_price, electricity_unit_price)
			 VALUES (?,?,?,?,?)`,
			r.Floor, r.RoomNumber, r.MonthlyRent, r.WaterUnitPrice, r.ElectricityUnitPrice,
		); err != nil {
			log.Fatalf("[db] 导入房间失败: %v", err)
		}
	}
	if err := tx.Commit(); err != nil {
		log.Fatalf("[db] 导入房间失败: %v", err)
	}
	log.Printf("[db] 已从配置导入 %d 个房间", len(config.Rooms))
}
