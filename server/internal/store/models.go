// Package store 负责 SQLite 数据库的打开、建表、迁移、种子导入与行扫描。
// 对应原 Node 版 src/db.js。
package store

import "database/sql"

// Room 房间预设。JSON 字段名与原版接口响应保持一致（snake_case）。
type Room struct {
	ID                   int64   `json:"id"`
	Floor                string  `json:"floor"`
	RoomNumber           string  `json:"room_number"`
	MonthlyRent          float64 `json:"monthly_rent"`
	WaterUnitPrice       float64 `json:"water_unit_price"`
	ElectricityUnitPrice float64 `json:"electricity_unit_price"`
	CreatedAt            string  `json:"created_at"`
}

// Tenant 租客。
type Tenant struct {
	ID          int64   `json:"id"`
	RoomID      int64   `json:"room_id"`
	Name        string  `json:"name"`
	IDCard      *string `json:"id_card"`
	Occupants   *int64  `json:"occupants"`
	MoveInDate  *string `json:"move_in_date"`
	MoveOutDate *string `json:"move_out_date"`
	IsCurrent   int     `json:"is_current"`
	CreatedAt   string  `json:"created_at"`
}

// TenantJoinRow 租客关联房间信息（租客列表用）。
type TenantJoinRow struct {
	Tenant
	RoomNumber string `json:"room_number"`
	Floor      string `json:"floor"`
}

// MonthlyRecord 月度抄表记录。
type MonthlyRecord struct {
	ID                         int64     `json:"id"`
	RoomID                     int64     `json:"room_id"`
	TenantID                   *int64    `json:"tenant_id"`
	Year                       int       `json:"year"`
	Month                      int       `json:"month"`
	PrevWaterReading           float64   `json:"prev_water_reading"`
	PrevElectricityReading     float64   `json:"prev_electricity_reading"`
	PrevWaterCustom            *float64  `json:"prev_water_custom"`
	PrevElectricityCustom      *float64  `json:"prev_electricity_custom"`
	WaterReading               *float64  `json:"water_reading"`
	ElectricityReading         *float64  `json:"electricity_reading"`
	WaterUsage                 *float64  `json:"water_usage"`
	ElectricityUsage           *float64  `json:"electricity_usage"`
	WaterFee                   *float64  `json:"water_fee"`
	ElectricityFee             *float64  `json:"electricity_fee"`
	Rent                       *float64  `json:"rent"`
	Total                      *float64  `json:"total"`
	Archived                   int       `json:"archived"`
	Note                       *string   `json:"note"`
	CreatedAt                  string    `json:"created_at"`
	UpdatedAt                  string    `json:"updated_at"`
	ExceptionNote              *string   `json:"exception_note"`
	CustomMonthlyRent          *float64  `json:"custom_monthly_rent"`
	CustomWaterUnitPrice       *float64  `json:"custom_water_unit_price"`
	CustomElectricityUnitPrice *float64  `json:"custom_electricity_unit_price"`
}

// RecordJoinRow 月度记录关联房间与租客信息（历史明细 / 报表用）。
type RecordJoinRow struct {
	MonthlyRecord
	Floor                string  `json:"floor"`
	RoomNumber           string  `json:"room_number"`
	MonthlyRent          float64 `json:"monthly_rent"` // 房间预设月租金
	WaterUnitPrice       float64 `json:"water_unit_price"`
	ElectricityUnitPrice float64 `json:"electricity_unit_price"`
	TenantName           *string `json:"tenant_name"`
	TenantIDCard         *string `json:"tenant_id_card"`
	Occupants            *int64  `json:"occupants"`
}

// 显式列清单：不使用 SELECT *，保证新旧数据库（历史迁移列序不同）扫描位置稳定。
const (
	RoomCols    = "id, floor, room_number, monthly_rent, water_unit_price, electricity_unit_price, created_at"
	TenantCols  = "id, room_id, name, id_card, occupants, move_in_date, move_out_date, is_current, created_at"
	RecordCols  = "id, room_id, tenant_id, year, month, prev_water_reading, prev_electricity_reading, " +
		"prev_water_custom, prev_electricity_custom, water_reading, electricity_reading, " +
		"water_usage, electricity_usage, water_fee, electricity_fee, rent, total, archived, note, " +
		"created_at, updated_at, exception_note, custom_monthly_rent, custom_water_unit_price, custom_electricity_unit_price"
	RecordJoinCols = "mr.id, mr.room_id, mr.tenant_id, mr.year, mr.month, mr.prev_water_reading, mr.prev_electricity_reading, " +
		"mr.prev_water_custom, mr.prev_electricity_custom, mr.water_reading, mr.electricity_reading, " +
		"mr.water_usage, mr.electricity_usage, mr.water_fee, mr.electricity_fee, mr.rent, mr.total, mr.archived, mr.note, " +
		"mr.created_at, mr.updated_at, mr.exception_note, mr.custom_monthly_rent, mr.custom_water_unit_price, mr.custom_electricity_unit_price, " +
		"r.floor, r.room_number, r.monthly_rent, r.water_unit_price, r.electricity_unit_price, " +
		"t.name AS tenant_name, t.id_card AS tenant_id_card, t.occupants"
)

type rowScanner interface {
	Scan(dest ...any) error
}

func f64p(n sql.NullFloat64) *float64 {
	if n.Valid {
		return &n.Float64
	}
	return nil
}

func i64p(n sql.NullInt64) *int64 {
	if n.Valid {
		return &n.Int64
	}
	return nil
}

func sp(n sql.NullString) *string {
	if n.Valid {
		return &n.String
	}
	return nil
}

// ScanRoom 扫描一行 rooms 记录（列序须与 RoomCols 一致）。
func ScanRoom(sc rowScanner) (Room, error) {
	var r Room
	err := sc.Scan(&r.ID, &r.Floor, &r.RoomNumber, &r.MonthlyRent,
		&r.WaterUnitPrice, &r.ElectricityUnitPrice, &r.CreatedAt)
	return r, err
}

// ScanTenant 扫描一行 tenants 记录（列序须与 TenantCols 一致）。
func ScanTenant(sc rowScanner) (Tenant, error) {
	var t Tenant
	var idCard, moveIn, moveOut sql.NullString
	var occupants sql.NullInt64
	err := sc.Scan(&t.ID, &t.RoomID, &t.Name, &idCard, &occupants,
		&moveIn, &moveOut, &t.IsCurrent, &t.CreatedAt)
	if err != nil {
		return t, err
	}
	t.IDCard = sp(idCard)
	t.Occupants = i64p(occupants)
	t.MoveInDate = sp(moveIn)
	t.MoveOutDate = sp(moveOut)
	return t, nil
}

// ScanTenantJoin 扫描租客关联房间的行（t.* + r.room_number, r.floor）。
func ScanTenantJoin(sc rowScanner) (TenantJoinRow, error) {
	var row TenantJoinRow
	var idCard, moveIn, moveOut sql.NullString
	var occupants sql.NullInt64
	err := sc.Scan(&row.ID, &row.RoomID, &row.Name, &idCard, &occupants,
		&moveIn, &moveOut, &row.IsCurrent, &row.CreatedAt,
		&row.RoomNumber, &row.Floor)
	if err != nil {
		return row, err
	}
	row.IDCard = sp(idCard)
	row.Occupants = i64p(occupants)
	row.MoveInDate = sp(moveIn)
	row.MoveOutDate = sp(moveOut)
	return row, nil
}

// ScanMonthlyRecord 扫描一行 monthly_records 记录（列序须与 RecordCols 一致）。
func ScanMonthlyRecord(sc rowScanner) (MonthlyRecord, error) {
	var rec MonthlyRecord
	var tenantID sql.NullInt64
	var pwc, pec, wr, er, wu, eu, wf, ef, rent, total, cmr, cwp, cep sql.NullFloat64
	var note, exNote sql.NullString
	err := sc.Scan(
		&rec.ID, &rec.RoomID, &tenantID, &rec.Year, &rec.Month,
		&rec.PrevWaterReading, &rec.PrevElectricityReading, &pwc, &pec,
		&wr, &er, &wu, &eu, &wf, &ef, &rent, &total,
		&rec.Archived, &note, &rec.CreatedAt, &rec.UpdatedAt, &exNote,
		&cmr, &cwp, &cep,
	)
	if err != nil {
		return rec, err
	}
	rec.TenantID = i64p(tenantID)
	rec.PrevWaterCustom = f64p(pwc)
	rec.PrevElectricityCustom = f64p(pec)
	rec.WaterReading = f64p(wr)
	rec.ElectricityReading = f64p(er)
	rec.WaterUsage = f64p(wu)
	rec.ElectricityUsage = f64p(eu)
	rec.WaterFee = f64p(wf)
	rec.ElectricityFee = f64p(ef)
	rec.Rent = f64p(rent)
	rec.Total = f64p(total)
	rec.Note = sp(note)
	rec.ExceptionNote = sp(exNote)
	rec.CustomMonthlyRent = f64p(cmr)
	rec.CustomWaterUnitPrice = f64p(cwp)
	rec.CustomElectricityUnitPrice = f64p(cep)
	return rec, nil
}

// ScanRecordJoin 扫描月度记录关联房间/租客的行（列序须与 RecordJoinCols 一致）。
func ScanRecordJoin(sc rowScanner) (RecordJoinRow, error) {
	var row RecordJoinRow
	var tenantID sql.NullInt64
	var pwc, pec, wr, er, wu, eu, wf, ef, rent, total, cmr, cwp, cep sql.NullFloat64
	var note, exNote, tName, tIDCard sql.NullString
	var occupants sql.NullInt64
	err := sc.Scan(
		&row.MonthlyRecord.ID, &row.MonthlyRecord.RoomID, &tenantID, &row.Year, &row.Month,
		&row.PrevWaterReading, &row.PrevElectricityReading, &pwc, &pec,
		&wr, &er, &wu, &eu, &wf, &ef, &rent, &total,
		&row.Archived, &note, &row.CreatedAt, &row.UpdatedAt, &exNote,
		&cmr, &cwp, &cep,
		&row.Floor, &row.RoomNumber, &row.MonthlyRent, &row.WaterUnitPrice, &row.ElectricityUnitPrice,
		&tName, &tIDCard, &occupants,
	)
	if err != nil {
		return row, err
	}
	row.TenantID = i64p(tenantID)
	row.PrevWaterCustom = f64p(pwc)
	row.PrevElectricityCustom = f64p(pec)
	row.WaterReading = f64p(wr)
	row.ElectricityReading = f64p(er)
	row.WaterUsage = f64p(wu)
	row.ElectricityUsage = f64p(eu)
	row.WaterFee = f64p(wf)
	row.ElectricityFee = f64p(ef)
	row.Rent = f64p(rent)
	row.Total = f64p(total)
	row.Note = sp(note)
	row.ExceptionNote = sp(exNote)
	row.CustomMonthlyRent = f64p(cmr)
	row.CustomWaterUnitPrice = f64p(cwp)
	row.CustomElectricityUnitPrice = f64p(cep)
	row.TenantName = sp(tName)
	row.TenantIDCard = sp(tIDCard)
	row.Occupants = i64p(occupants)
	return row, nil
}
