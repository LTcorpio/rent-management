package api

import (
	"database/sql"
	"net/http"

	"rent-management/server/internal/jsonx"
	"rent-management/server/internal/store"
)

// floorOrder 楼楼排序：一楼 → 四五楼 → 其他（与原版 SQL 一致）。
const floorOrder = "CASE floor WHEN '一楼' THEN 1 WHEN '四五楼' THEN 2 ELSE 9 END"

// roomListItem 房间 + 当前租客 + 基线读数（GET /api/rooms 响应项）。
type roomListItem struct {
	store.Room
	CurrentTenant       *store.Tenant `json:"current_tenant"`
	BaselineWater       float64       `json:"baseline_water"`
	BaselineElectricity float64       `json:"baseline_electricity"`
}

// queryRooms 查询全部房间（按楼层、房间号排序）。
func (s *Server) queryRooms() ([]store.Room, error) {
	rows, err := s.db.Query("SELECT " + store.RoomCols + " FROM rooms ORDER BY " + floorOrder + ", room_number")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var rooms []store.Room
	for rows.Next() {
		r, err := store.ScanRoom(rows)
		if err != nil {
			return nil, err
		}
		rooms = append(rooms, r)
	}
	return rooms, rows.Err()
}

// getRoom 按 id 查询房间，不存在返回 nil。
func (s *Server) getRoom(id int64) (*store.Room, error) {
	row := s.db.QueryRow("SELECT "+store.RoomCols+" FROM rooms WHERE id=?", id)
	r, err := store.ScanRoom(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &r, nil
}

// currentTenant 某房间当前租客（is_current=1 中 id 最大的一条）。
func (s *Server) currentTenant(roomID int64) *store.Tenant {
	row := s.db.QueryRow(
		"SELECT "+store.TenantCols+" FROM tenants WHERE room_id=? AND is_current=1 ORDER BY id DESC LIMIT 1", roomID)
	t, err := store.ScanTenant(row)
	if err != nil {
		return nil
	}
	return &t
}

// lastReadings 某房间最近一次非空水/电读数（分开查询，无记录则为 0）。
func (s *Server) lastReadings(roomID int64) (water, electricity float64) {
	var lw, le sql.NullFloat64
	_ = s.db.QueryRow(`
		SELECT water_reading FROM monthly_records
		WHERE room_id = ? AND water_reading IS NOT NULL
		ORDER BY year DESC, month DESC LIMIT 1`, roomID).Scan(&lw)
	_ = s.db.QueryRow(`
		SELECT electricity_reading FROM monthly_records
		WHERE room_id = ? AND electricity_reading IS NOT NULL
		ORDER BY year DESC, month DESC LIMIT 1`, roomID).Scan(&le)
	if lw.Valid {
		water = lw.Float64
	}
	if le.Valid {
		electricity = le.Float64
	}
	return water, electricity
}

// listRooms 获取所有房间，按楼层分组，附带当前租客与最近读数（作为当月 prev 基线）。
func (s *Server) listRooms(w http.ResponseWriter, _ *http.Request) {
	rooms, err := s.queryRooms()
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	grouped := jsonx.New[[]roomListItem]()
	for _, room := range rooms {
		tenant := s.currentTenant(room.ID)
		baselineWater, baselineElec := s.lastReadings(room.ID)
		jsonx.AppendTo(grouped, room.Floor, roomListItem{
			Room:                room,
			CurrentTenant:       tenant,
			BaselineWater:       baselineWater,
			BaselineElectricity: baselineElec,
		})
	}
	writeJSON(w, http.StatusOK, grouped)
}

// updateRoom 更新房间预设：PUT /api/rooms/:id
func (s *Server) updateRoom(w http.ResponseWriter, r *http.Request) {
	body, ok := readBody(w, r)
	if !ok {
		return
	}
	// 路径参数原样绑定，交由 SQLite 列亲和性转换（非数字 id 不匹配任何行，与原版一致）
	_, err := s.db.Exec(`
		UPDATE rooms SET floor=?, room_number=?, monthly_rent=?, water_unit_price=?, electricity_unit_price=? WHERE id=?`,
		bindValue(body["floor"]), bindValue(body["room_number"]),
		bindValue(body["monthly_rent"]), bindValue(body["water_unit_price"]),
		bindValue(body["electricity_unit_price"]), r.PathValue("id"))
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// createRoom 新增房间：POST /api/rooms
func (s *Server) createRoom(w http.ResponseWriter, r *http.Request) {
	body, ok := readBody(w, r)
	if !ok {
		return
	}
	res, err := s.db.Exec(`
		INSERT INTO rooms (floor, room_number, monthly_rent, water_unit_price, electricity_unit_price)
		VALUES (?,?,?,?,?)`,
		bindValue(body["floor"]), bindValue(body["room_number"]),
		withDefault(body, "monthly_rent", float64(0)),
		withDefault(body, "water_unit_price", float64(0)),
		withDefault(body, "electricity_unit_price", float64(0)))
	if err != nil {
		jsonError(w, http.StatusBadRequest, err.Error())
		return
	}
	id, _ := res.LastInsertId()
	writeJSON(w, http.StatusOK, map[string]any{"id": id})
}

// deleteRoom 删除房间：DELETE /api/rooms/:id
func (s *Server) deleteRoom(w http.ResponseWriter, r *http.Request) {
	_, _ = s.db.Exec("DELETE FROM rooms WHERE id=?", r.PathValue("id"))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
