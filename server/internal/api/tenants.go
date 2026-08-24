package api

import (
	"net/http"
	"time"

	"rent-management/server/internal/store"
)

// listTenants 查询租客：GET /api/tenants[?roomId=x]
// 指定 roomId 时返回该房间全部租客历史；否则返回全部租客并附带房间信息。
func (s *Server) listTenants(w http.ResponseWriter, r *http.Request) {
	if roomID := r.URL.Query().Get("roomId"); roomID != "" {
		rows, err := s.db.Query(
			"SELECT "+store.TenantCols+" FROM tenants WHERE room_id=? ORDER BY is_current DESC, id DESC", roomID)
		if err != nil {
			jsonError(w, http.StatusInternalServerError, err.Error())
			return
		}
		defer rows.Close()
		list := []store.Tenant{}
		for rows.Next() {
			t, err := store.ScanTenant(rows)
			if err != nil {
				jsonError(w, http.StatusInternalServerError, err.Error())
				return
			}
			list = append(list, t)
		}
		if err := rows.Err(); err != nil {
			jsonError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, list)
		return
	}

	rows, err := s.db.Query(`
		SELECT t.id, t.room_id, t.name, t.id_card, t.occupants, t.move_in_date, t.move_out_date, t.is_current, t.created_at,
			r.room_number, r.floor
		FROM tenants t
		JOIN rooms r ON r.id = t.room_id
		ORDER BY t.is_current DESC, t.id DESC`)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()
	list := []store.TenantJoinRow{}
	for rows.Next() {
		row, err := store.ScanTenantJoin(rows)
		if err != nil {
			jsonError(w, http.StatusInternalServerError, err.Error())
			return
		}
		list = append(list, row)
	}
	if err := rows.Err(); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, list)
}

// createTenant 新增租客：POST /api/tenants
// 同一房间若已有 current 租客，将旧的置为退租。
func (s *Server) createTenant(w http.ResponseWriter, r *http.Request) {
	body, ok := readBody(w, r)
	if !ok {
		return
	}
	roomID, hasRoom := body["room_id"]
	name, hasName := body["name"]
	if !hasRoom || !truthy(roomID) || !hasName || !truthy(name) {
		jsonError(w, http.StatusBadRequest, "room_id 与 name 必填")
		return
	}

	// occupants 解构默认值：仅未传时取 1（显式 null 保留 null）
	occupants, hasOccupants := body["occupants"]
	if !hasOccupants {
		occupants = float64(1)
	}

	tx, err := s.db.Begin()
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer tx.Rollback()

	if _, err := tx.Exec(
		`UPDATE tenants SET is_current=0, move_out_date=COALESCE(move_out_date, date('now','localtime')) WHERE room_id=? AND is_current=1`,
		bindValue(roomID)); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	res, err := tx.Exec(`
		INSERT INTO tenants (room_id, name, id_card, occupants, move_in_date, is_current)
		VALUES (?,?,?,?,?,1)`,
		bindValue(roomID), bindValue(name), orNull(body["id_card"]),
		bindValue(occupants), orNull(body["move_in_date"]))
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	if err := tx.Commit(); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	id, _ := res.LastInsertId()
	writeJSON(w, http.StatusOK, map[string]any{"id": id})
}

// updateTenant 更新租客信息：PUT /api/tenants/:id
func (s *Server) updateTenant(w http.ResponseWriter, r *http.Request) {
	body, ok := readBody(w, r)
	if !ok {
		return
	}
	isCurrent := int64(0)
	if truthy(body["is_current"]) {
		isCurrent = 1
	}
	_, err := s.db.Exec(`
		UPDATE tenants SET name=?, id_card=?, occupants=?, move_in_date=?, move_out_date=?, is_current=? WHERE id=?`,
		bindValue(body["name"]), bindValue(body["id_card"]), bindValue(body["occupants"]),
		bindValue(body["move_in_date"]), bindValue(body["move_out_date"]),
		isCurrent, r.PathValue("id"))
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// moveoutTenant 退租：POST /api/tenants/:id/moveout
func (s *Server) moveoutTenant(w http.ResponseWriter, r *http.Request) {
	body, ok := readBody(w, r)
	if !ok {
		return
	}
	// 默认退租日期取当前 UTC 日期（与原版 toISOString().slice(0,10) 一致）
	moveOutDate := orNull(body["move_out_date"])
	if moveOutDate == nil {
		moveOutDate = time.Now().UTC().Format("2006-01-02")
	}
	if _, err := s.db.Exec(
		`UPDATE tenants SET is_current=0, move_out_date=? WHERE id=?`,
		moveOutDate, r.PathValue("id")); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
