package api

import (
	"database/sql"
	"net/http"
	"strconv"

	"rent-management/server/internal/calc"
	"rent-management/server/internal/jsonx"
	"rent-management/server/internal/store"
)

// monthItem GET /api/records/month/:year/:month 响应项：
// 月度记录 + 房间 + 租客 + 计算结果 + 默认基线。
type monthItem struct {
	store.MonthlyRecord
	Room             *store.Room `json:"room"`
	Tenant           *store.Tenant `json:"tenant"`
	Calc             calc.Calc   `json:"calc"`
	DefaultPrevWater float64     `json:"default_prev_water"`
	DefaultPrevElec  float64     `json:"default_prev_elec"`
}

// saveRecordResp POST /api/records 响应。
type saveRecordResp struct {
	OK                         bool         `json:"ok"`
	ID                         int64        `json:"id"`
	Calc                       calc.Calc    `json:"calc"`
	PrevWaterReading           float64      `json:"prev_water_reading"`
	PrevElectricityReading     float64      `json:"prev_electricity_reading"`
	PrevWaterCustom            *float64     `json:"prev_water_custom"`
	PrevElectricityCustom      *float64     `json:"prev_electricity_custom"`
	CustomMonthlyRent          *float64     `json:"custom_monthly_rent"`
	CustomWaterUnitPrice       *float64     `json:"custom_water_unit_price"`
	CustomElectricityUnitPrice *float64     `json:"custom_electricity_unit_price"`
	DefaultPrevWater           float64      `json:"default_prev_water"`
	DefaultPrevElec            float64      `json:"default_prev_elec"`
}

// updateHistoryResp PUT /api/records/history/:id 响应。
type updateHistoryResp struct {
	OK                     bool      `json:"ok"`
	Calc                   calc.Calc `json:"calc"`
	PrevWaterReading       *float64  `json:"prev_water_reading"`
	PrevElectricityReading *float64  `json:"prev_electricity_reading"`
	Rent                   *float64  `json:"rent"`
}

// historySummary GET /api/records/history 响应行（已存档年月汇总）。
type historySummary struct {
	Year           int      `json:"year"`
	Month          int      `json:"month"`
	Archived       int      `json:"archived"`
	RoomCount      int64    `json:"room_count"`
	ValidRoomCount int64    `json:"valid_room_count"`
	TotalAmount    *float64 `json:"total_amount"`
	TotalWater     *float64 `json:"total_water"`
	TotalElec      *float64 `json:"total_elec"`
	TotalRent      *float64 `json:"total_rent"`
	SumWater       *float64 `json:"sum_water"`
	SumElec        *float64 `json:"sum_elec"`
}

// prevReadings 查询某房间在指定年月之前最近的有效（非空）水/电读数。
// 跳过未抄表（读数为 NULL）的月份；找不到则返回 0。
func (s *Server) prevReadings(roomID int64, year, month int) (prevWater, prevElec float64) {
	var pw, pe sql.NullFloat64
	_ = s.db.QueryRow(`
		SELECT water_reading FROM monthly_records
		WHERE room_id=? AND water_reading IS NOT NULL AND (year < ? OR (year=? AND month < ?))
		ORDER BY year DESC, month DESC LIMIT 1`, roomID, year, year, month).Scan(&pw)
	_ = s.db.QueryRow(`
		SELECT electricity_reading FROM monthly_records
		WHERE room_id=? AND electricity_reading IS NOT NULL AND (year < ? OR (year=? AND month < ?))
		ORDER BY year DESC, month DESC LIMIT 1`, roomID, year, year, month).Scan(&pe)
	if pw.Valid {
		prevWater = pw.Float64
	}
	if pe.Valid {
		prevElec = pe.Float64
	}
	return prevWater, prevElec
}

// getRecordByRoomMonth 查询某房间某年月的记录，不存在返回 nil。
func (s *Server) getRecordByRoomMonth(roomID int64, year, month int) *store.MonthlyRecord {
	row := s.db.QueryRow(
		"SELECT "+store.RecordCols+" FROM monthly_records WHERE room_id=? AND year=? AND month=?", roomID, year, month)
	rec, err := store.ScanMonthlyRecord(row)
	if err != nil {
		return nil
	}
	return &rec
}

// effectivePrices 合并房间预设与当月覆盖值：custom 非 null 时覆盖对应字段，用于计算。
func effectivePrices(room store.Room, rec *store.MonthlyRecord) calc.RoomPrices {
	p := calc.RoomPrices{
		MonthlyRent:          room.MonthlyRent,
		WaterUnitPrice:       room.WaterUnitPrice,
		ElectricityUnitPrice: room.ElectricityUnitPrice,
	}
	if rec.CustomMonthlyRent != nil {
		p.MonthlyRent = *rec.CustomMonthlyRent
	}
	if rec.CustomWaterUnitPrice != nil {
		p.WaterUnitPrice = *rec.CustomWaterUnitPrice
	}
	if rec.CustomElectricityUnitPrice != nil {
		p.ElectricityUnitPrice = *rec.CustomElectricityUnitPrice
	}
	return p
}

// getMonth 获取某年月所有房间记录；若某房间无记录则自动补一条草稿
// （prev 读数取最近一次记录，无则 0）。
func (s *Server) getMonth(w http.ResponseWriter, r *http.Request) {
	y, yerr := strconv.Atoi(r.PathValue("year"))
	m, merr := strconv.Atoi(r.PathValue("month"))
	if yerr != nil || merr != nil {
		jsonError(w, http.StatusBadRequest, "invalid year or month")
		return
	}
	rooms, err := s.queryRooms()
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	exec := func(query string, args ...any) bool {
		if _, err := s.db.Exec(query, args...); err != nil {
			jsonError(w, http.StatusInternalServerError, err.Error())
			return false
		}
		return true
	}

	grouped := jsonx.New[[]monthItem]()
	list := []monthItem{}
	for _, room := range rooms {
		defWater, defElec := s.prevReadings(room.ID, y, m)
		tenant := s.currentTenant(room.ID)
		var tenantID any // COALESCE(?, tenant_id)：租客为空时保留原值
		if tenant != nil {
			tenantID = tenant.ID
		}
		rec := s.getRecordByRoomMonth(room.ID, y, m)

		switch {
		case rec == nil:
			// 无记录：插入草稿
			if !exec(`
				INSERT INTO monthly_records (room_id, tenant_id, year, month, prev_water_reading, prev_electricity_reading)
				VALUES (?,?,?,?,?,?)
				ON CONFLICT(room_id, year, month) DO UPDATE SET
					prev_water_reading=excluded.prev_water_reading,
					prev_electricity_reading=excluded.prev_electricity_reading`,
				room.ID, tenantID, y, m, defWater, defElec) {
				return
			}
			rec = s.getRecordByRoomMonth(room.ID, y, m)
		case rec.Archived == 1:
			// 已存档：不刷新 prev/单价，保留历史修改值，仅刷新租客
			if !exec(`UPDATE monthly_records SET tenant_id=COALESCE(?, tenant_id) WHERE id=?`, tenantID, rec.ID) {
				return
			}
			rec = s.getRecordByRoomMonth(room.ID, y, m)
		case rec.PrevWaterCustom == nil && rec.PrevElectricityCustom == nil:
			// 用户未自定义：刷新默认基线（防新增记录后基线变化）
			if !exec(`
				UPDATE monthly_records SET prev_water_reading=?, prev_electricity_reading=?, tenant_id=COALESCE(?, tenant_id)
				WHERE id=? AND prev_water_custom IS NULL AND prev_electricity_custom IS NULL`,
				defWater, defElec, tenantID, rec.ID) {
				return
			}
			rec = s.getRecordByRoomMonth(room.ID, y, m)
		default:
			// 用户自定义了至少一项：只刷新租客，保留 custom 与已计算的 prev
			if !exec(`UPDATE monthly_records SET tenant_id=COALESCE(?, tenant_id) WHERE id=?`, tenantID, rec.ID) {
				return
			}
			rec = s.getRecordByRoomMonth(room.ID, y, m)
		}
		if rec == nil {
			continue
		}

		c := calc.Record(effectivePrices(room, rec), calc.Readings{
			WaterReading:       rec.WaterReading,
			ElectricityReading: rec.ElectricityReading,
			PrevWaterReading:   rec.PrevWaterReading,
			PrevElecReading:    rec.PrevElectricityReading,
		})
		roomCopy, tenantCopy := room, tenant
		item := monthItem{
			MonthlyRecord:   *rec,
			Room:            &roomCopy,
			Tenant:          tenantCopy,
			Calc:            c,
			DefaultPrevWater: defWater,
			DefaultPrevElec:  defElec,
		}
		list = append(list, item)
		jsonx.AppendTo(grouped, room.Floor, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"year": y, "month": m, "grouped": grouped, "list": list,
	})
}

// saveRecord 保存单条记录读数（输入即时保存草稿，archived=0）。
// 支持自定义上期读数与当月价格：null=恢复默认，数字=自定义，未传=保持不变。
func (s *Server) saveRecord(w http.ResponseWriter, r *http.Request) {
	body, ok := readBody(w, r)
	if !ok {
		return
	}

	roomIDF, roomIDOk := jsNumber(body["room_id"])
	var roomID int64 = -1
	if roomIDOk && body["room_id"] != nil {
		roomID = int64(roomIDF)
	}
	room, err := s.getRoom(roomID)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if room == nil {
		jsonError(w, http.StatusNotFound, "房间不存在")
		return
	}

	year := int(bodyFloat(body, "year", 0))
	month := int(bodyFloat(body, "month", 0))

	// 自动默认基线
	defWater, defElec := s.prevReadings(roomID, year, month)

	// 解析 custom：未传表示不变；null 表示恢复默认；数字表示自定义
	var oldWC, oldEC, oldMR, oldWP, oldEP *float64
	if existing := s.getRecordByRoomMonth(roomID, year, month); existing != nil {
		oldWC, oldEC = existing.PrevWaterCustom, existing.PrevElectricityCustom
		oldMR, oldWP, oldEP = existing.CustomMonthlyRent, existing.CustomWaterUnitPrice, existing.CustomElectricityUnitPrice
	}
	newWaterCustom := parseCustom(body, "prev_water_custom", oldWC)
	newElecCustom := parseCustom(body, "prev_electricity_custom", oldEC)
	newRentCustom := parseCustom(body, "custom_monthly_rent", oldMR)
	newWupCustom := parseCustom(body, "custom_water_unit_price", oldWP)
	newEupCustom := parseCustom(body, "custom_electricity_unit_price", oldEP)

	// 生效 prev：custom 优先，否则默认
	prevWater, prevElec := defWater, defElec
	if newWaterCustom != nil {
		prevWater = *newWaterCustom
	}
	if newElecCustom != nil {
		prevElec = *newElecCustom
	}

	// 计算用单价：合并当月覆盖值
	prices := calc.RoomPrices{
		MonthlyRent:          room.MonthlyRent,
		WaterUnitPrice:       room.WaterUnitPrice,
		ElectricityUnitPrice: room.ElectricityUnitPrice,
	}
	if newRentCustom != nil {
		prices.MonthlyRent = *newRentCustom
	}
	if newWupCustom != nil {
		prices.WaterUnitPrice = *newWupCustom
	}
	if newEupCustom != nil {
		prices.ElectricityUnitPrice = *newEupCustom
	}

	c := calc.Record(prices, calc.Readings{
		WaterReading:       numOrNil(body["water_reading"]),
		ElectricityReading: numOrNil(body["electricity_reading"]),
		PrevWaterReading:   prevWater,
		PrevElecReading:    prevElec,
	})

	if _, err := s.db.Exec(`
		INSERT INTO monthly_records (room_id, tenant_id, year, month, prev_water_reading, prev_electricity_reading, prev_water_custom, prev_electricity_custom, custom_monthly_rent, custom_water_unit_price, custom_electricity_unit_price, water_reading, electricity_reading, water_usage, electricity_usage, water_fee, electricity_fee, rent, total, note, archived)
		VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
		ON CONFLICT(room_id, year, month) DO UPDATE SET
			tenant_id=COALESCE(excluded.tenant_id, monthly_records.tenant_id),
			prev_water_reading=excluded.prev_water_reading,
			prev_electricity_reading=excluded.prev_electricity_reading,
			prev_water_custom=excluded.prev_water_custom,
			prev_electricity_custom=excluded.prev_electricity_custom,
			custom_monthly_rent=excluded.custom_monthly_rent,
			custom_water_unit_price=excluded.custom_water_unit_price,
			custom_electricity_unit_price=excluded.custom_electricity_unit_price,
			water_reading=excluded.water_reading,
			electricity_reading=excluded.electricity_reading,
			water_usage=excluded.water_usage,
			electricity_usage=excluded.electricity_usage,
			water_fee=excluded.water_fee,
			electricity_fee=excluded.electricity_fee,
			rent=excluded.rent,
			total=excluded.total,
			note=excluded.note,
			updated_at=datetime('now','localtime')`,
		roomID, orNull(body["tenant_id"]), year, month, prevWater, prevElec,
		fval(newWaterCustom), fval(newElecCustom),
		fval(newRentCustom), fval(newWupCustom), fval(newEupCustom),
		fval(numOrNil(body["water_reading"])), fval(numOrNil(body["electricity_reading"])),
		fval(c.WaterUsage), fval(c.ElecUsage), fval(c.WaterFee), fval(c.ElecFee),
		fval(c.Rent), fval(c.Total), orNull(body["note"])); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	var id int64
	_ = s.db.QueryRow("SELECT id FROM monthly_records WHERE room_id=? AND year=? AND month=?", roomID, year, month).Scan(&id)

	writeJSON(w, http.StatusOK, saveRecordResp{
		OK:                         true,
		ID:                         id,
		Calc:                       c,
		PrevWaterReading:           prevWater,
		PrevElectricityReading:     prevElec,
		PrevWaterCustom:            newWaterCustom,
		PrevElectricityCustom:      newElecCustom,
		CustomMonthlyRent:          newRentCustom,
		CustomWaterUnitPrice:       newWupCustom,
		CustomElectricityUnitPrice: newEupCustom,
		DefaultPrevWater:           defWater,
		DefaultPrevElec:            defElec,
	})
}

// markException 标记/取消异常项：PUT /api/records/exception/:id
// 传 exception_note（空字符串或 null=取消标记，非空=标记异常并记录原因）。
func (s *Server) markException(w http.ResponseWriter, r *http.Request) {
	body, ok := readBody(w, r)
	if !ok {
		return
	}
	var note any
	if v, exists := body["exception_note"]; exists && v != nil && v != "" {
		if str, isStr := v.(string); isStr {
			note = str
		} else {
			note = jsString(v)
		}
	}
	res, err := s.db.Exec(
		`UPDATE monthly_records SET exception_note=?, updated_at=datetime('now','localtime') WHERE id=?`,
		note, r.PathValue("id"))
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	changes, _ := res.RowsAffected()
	if changes == 0 {
		jsonError(w, http.StatusNotFound, "记录不存在")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "exception_note": note})
}

// archiveMonth 存档：将某年月所有记录置为 archived=1。
func (s *Server) archiveMonth(w http.ResponseWriter, r *http.Request) {
	res, err := s.db.Exec(
		`UPDATE monthly_records SET archived=1, updated_at=datetime('now','localtime') WHERE year=? AND month=?`,
		r.PathValue("year"), r.PathValue("month"))
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	changes, _ := res.RowsAffected()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "archived": changes})
}

// listHistory 历史年月列表（已存档），含汇总。
func (s *Server) listHistory(w http.ResponseWriter, _ *http.Request) {
	rows, err := s.db.Query(`
		SELECT year, month, archived,
			COUNT(*) AS room_count,
			SUM(CASE WHEN total IS NOT NULL AND total != 0 THEN 1 ELSE 0 END) AS valid_room_count,
			SUM(total) AS total_amount,
			SUM(water_fee) AS total_water,
			SUM(electricity_fee) AS total_elec,
			SUM(rent) AS total_rent,
			SUM(water_usage) AS sum_water,
			SUM(electricity_usage) AS sum_elec
		FROM monthly_records
		WHERE archived=1
		GROUP BY year, month
		ORDER BY year DESC, month DESC`)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	list := []historySummary{}
	for rows.Next() {
		var row historySummary
		var totalAmount, totalWater, totalElec, totalRent, sumWater, sumElec sql.NullFloat64
		if err := rows.Scan(&row.Year, &row.Month, &row.Archived, &row.RoomCount,
			&row.ValidRoomCount, &totalAmount, &totalWater, &totalElec, &totalRent, &sumWater, &sumElec); err != nil {
			jsonError(w, http.StatusInternalServerError, err.Error())
			return
		}
		row.TotalAmount = f64p(totalAmount)
		row.TotalWater = f64p(totalWater)
		row.TotalElec = f64p(totalElec)
		row.TotalRent = f64p(totalRent)
		row.SumWater = f64p(sumWater)
		row.SumElec = f64p(sumElec)
		list = append(list, row)
	}
	if err := rows.Err(); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// f64p 将 sql.NullFloat64 转为指针。
func f64p(n sql.NullFloat64) *float64 {
	if n.Valid {
		return &n.Float64
	}
	return nil
}

// queryRecordJoinRows 查询某年月的记录联表行（历史明细 / 月报表共用）。
func (s *Server) queryRecordJoinRows(year, month int) ([]store.RecordJoinRow, error) {
	rows, err := s.db.Query(`
		SELECT ` + store.RecordJoinCols + `
		FROM monthly_records mr
		JOIN rooms r ON r.id = mr.room_id
		LEFT JOIN tenants t ON t.id = mr.tenant_id
		WHERE mr.year=? AND mr.month=?
		ORDER BY ` + floorOrder + ", r.room_number", year, month)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []store.RecordJoinRow{}
	for rows.Next() {
		row, err := store.ScanRecordJoin(rows)
		if err != nil {
			return nil, err
		}
		list = append(list, row)
	}
	return list, rows.Err()
}

// historyDetail 历史某月明细（已存档）。
func (s *Server) historyDetail(w http.ResponseWriter, r *http.Request) {
	y, yerr := strconv.Atoi(r.PathValue("year"))
	m, merr := strconv.Atoi(r.PathValue("month"))
	if yerr != nil || merr != nil {
		jsonError(w, http.StatusBadRequest, "invalid year or month")
		return
	}
	rows, err := s.queryRecordJoinRows(y, m)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	grouped := jsonx.New[[]store.RecordJoinRow]()
	for _, row := range rows {
		jsonx.AppendTo(grouped, row.Floor, row)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"year": y, "month": m, "grouped": grouped, "list": rows,
	})
}

// histNum 历史记录修改的读数语义：未传或空串 → null；其他 → Number(v)。
func histNum(body map[string]any, key string) *float64 {
	v, exists := body[key]
	if !exists || v == "" {
		return nil
	}
	f, ok := jsNumber(v)
	if !ok || isNaNOrInf(f) {
		return nil
	}
	return &f
}

// histPrev 历史记录修改的上期读数：未传或空串 → 保留原值；其他 → Number(v)。
func histPrev(body map[string]any, key string, old float64) *float64 {
	v, exists := body[key]
	if !exists || v == "" {
		return &old
	}
	f, ok := jsNumber(v)
	if !ok || isNaNOrInf(f) {
		return nil // NaN 在 SQLite 中落库为 NULL，将触发 NOT NULL 约束（与原版一致报错）
	}
	return &f
}

// histPrevCustom 历史记录修改的上期读数 custom 同步值：
// 未传或空串 → 保留原 custom；其他 → Number(v)。
func histPrevCustom(body map[string]any, key string, old *float64) *float64 {
	v, exists := body[key]
	if !exists || v == "" {
		return old
	}
	f, ok := jsNumber(v)
	if !ok || isNaNOrInf(f) {
		return nil
	}
	return &f
}

// histPrice 历史记录修改的当月价格 custom 值：
// 未传或空串 → 保留原 custom（无 custom 则 null）；null → null；其他 → Number(v)。
func histPrice(body map[string]any, key string, oldCustom *float64) *float64 {
	v, exists := body[key]
	if !exists || v == "" {
		return oldCustom
	}
	if v == nil {
		return nil
	}
	f, ok := jsNumber(v)
	if !ok || isNaNOrInf(f) {
		return nil
	}
	return &f
}

func isNaNOrInf(f float64) bool {
	return f != f || f > 1.7976931348623157e308 || f < -1.7976931348623157e308
}

// updateHistoryRecord 修改历史存档某房间记录（已存档也可改），
// 支持修改读数、上期读数、当月租金与水电单价，自动重算费用。
// 注：monthly_rent/water_unit_price/electricity_unit_price/prev_* 同时写入 custom_* 列，
// 确保当月页通过 effectivePrices 重算时与历史页一致。
func (s *Server) updateHistoryRecord(w http.ResponseWriter, r *http.Request) {
	body, ok := readBody(w, r)
	if !ok {
		return
	}
	row := s.db.QueryRow("SELECT "+store.RecordCols+" FROM monthly_records WHERE id=?", r.PathValue("id"))
	rec, err := store.ScanMonthlyRecord(row)
	if err == sql.ErrNoRows {
		jsonError(w, http.StatusNotFound, "记录不存在")
		return
	}
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	room, err := s.getRoom(rec.RoomID)
	if err != nil || room == nil {
		jsonError(w, http.StatusInternalServerError, "房间不存在")
		return
	}

	wr := histNum(body, "water_reading")
	er := histNum(body, "electricity_reading")
	pw := histPrev(body, "prev_water_reading", rec.PrevWaterReading)
	pe := histPrev(body, "prev_electricity_reading", rec.PrevElectricityReading)
	// 上期读数同时同步 custom 列（已存档后 prev 不再自动刷新，写入 custom 固定）
	pwCustom := histPrevCustom(body, "prev_water_reading", rec.PrevWaterCustom)
	peCustom := histPrevCustom(body, "prev_electricity_reading", rec.PrevElectricityCustom)
	// 当月单价/租金：未传则保留原 custom（无 custom 则用房间预设）
	rentCustom := histPrice(body, "monthly_rent", rec.CustomMonthlyRent)
	wupCustom := histPrice(body, "water_unit_price", rec.CustomWaterUnitPrice)
	eupCustom := histPrice(body, "electricity_unit_price", rec.CustomElectricityUnitPrice)

	// 生效值：custom 非 null 用 custom，否则用房间预设
	prices := calc.RoomPrices{
		MonthlyRent:          room.MonthlyRent,
		WaterUnitPrice:       room.WaterUnitPrice,
		ElectricityUnitPrice: room.ElectricityUnitPrice,
	}
	if rentCustom != nil {
		prices.MonthlyRent = *rentCustom
	}
	if wupCustom != nil {
		prices.WaterUnitPrice = *wupCustom
	}
	if eupCustom != nil {
		prices.ElectricityUnitPrice = *eupCustom
	}

	var prevWater, prevElec float64
	if pw != nil {
		prevWater = *pw
	}
	if pe != nil {
		prevElec = *pe
	}
	c := calc.Record(prices, calc.Readings{
		WaterReading:       wr,
		ElectricityReading: er,
		PrevWaterReading:   prevWater,
		PrevElecReading:    prevElec,
	})

	if _, err := s.db.Exec(`
		UPDATE monthly_records SET
			water_reading=?, electricity_reading=?,
			prev_water_reading=?, prev_electricity_reading=?,
			prev_water_custom=?, prev_electricity_custom=?,
			custom_monthly_rent=?, custom_water_unit_price=?, custom_electricity_unit_price=?,
			water_usage=?, electricity_usage=?,
			water_fee=?, electricity_fee=?, rent=?, total=?,
			updated_at=datetime('now','localtime')
		WHERE id=?`,
		fval(wr), fval(er), fval(pw), fval(pe), fval(pwCustom), fval(peCustom),
		fval(rentCustom), fval(wupCustom), fval(eupCustom),
		fval(c.WaterUsage), fval(c.ElecUsage), fval(c.WaterFee), fval(c.ElecFee),
		fval(c.Rent), fval(c.Total), r.PathValue("id")); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}

	writeJSON(w, http.StatusOK, updateHistoryResp{
		OK:                     true,
		Calc:                   c,
		PrevWaterReading:       pw,
		PrevElectricityReading: pe,
		Rent:                   c.Rent,
	})
}

// deleteHistoryMonth 删除整个年月的存档（及其草稿记录）。
func (s *Server) deleteHistoryMonth(w http.ResponseWriter, r *http.Request) {
	res, err := s.db.Exec(
		"DELETE FROM monthly_records WHERE year=? AND month=?", r.PathValue("year"), r.PathValue("month"))
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	changes, _ := res.RowsAffected()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "deleted": changes})
}
