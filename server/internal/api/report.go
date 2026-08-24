package api

import (
	"database/sql"
	"net/http"
	"strconv"

	"rent-management/server/internal/jsonx"
	"rent-management/server/internal/store"
)

// floorSummary 月报表楼层汇总。
type floorSummary struct {
	Total            float64              `json:"total"`
	WaterFee         float64              `json:"water_fee"`
	ElectricityFee   float64              `json:"electricity_fee"`
	Rent             float64              `json:"rent"`
	WaterUsage       float64              `json:"water_usage"`
	ElectricityUsage float64              `json:"electricity_usage"`
	Rooms            int                  `json:"rooms"`
	InputRooms       int                  `json:"input_rooms"`
	List             []store.RecordJoinRow `json:"list"`
}

// grandSummary 月报表总汇总。
type grandSummary struct {
	Total            float64 `json:"total"`
	WaterFee         float64 `json:"water_fee"`
	ElectricityFee   float64 `json:"electricity_fee"`
	Rent             float64 `json:"rent"`
	WaterUsage       float64 `json:"water_usage"`
	ElectricityUsage float64 `json:"electricity_usage"`
	Rooms            int     `json:"rooms"`
	InputRooms       int     `json:"input_rooms"`
}

// yearMonthRow 年度趋势按月汇总行。
type yearMonthRow struct {
	Month              int      `json:"month"`
	Total              *float64 `json:"total"`
	WaterFee           *float64 `json:"water_fee"`
	ElectricityFee     *float64 `json:"electricity_fee"`
	Rent               *float64 `json:"rent"`
	WaterUsage         *float64 `json:"water_usage"`
	ElectricityUsage   *float64 `json:"electricity_usage"`
	Rooms              int64    `json:"rooms"`
}

// yearTotals 年度合计。
type yearTotals struct {
	Total          float64 `json:"total"`
	WaterFee       float64 `json:"water_fee"`
	ElectricityFee float64 `json:"electricity_fee"`
	Rent           float64 `json:"rent"`
}

func deref(p *float64) float64 {
	if p == nil {
		return 0
	}
	return *p
}

// monthReport 某月报表：按楼层汇总 + 房间明细，一页纸呈现。
func (s *Server) monthReport(w http.ResponseWriter, r *http.Request) {
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

	floors := jsonx.New[floorSummary]()
	var grand grandSummary
	for _, row := range rows {
		fs, exists := floors.Get(row.Floor)
		if !exists {
			fs = floorSummary{List: []store.RecordJoinRow{}}
		}
		fs.Rooms++
		if row.Total != nil {
			fs.Total += *row.Total
			fs.WaterFee += deref(row.WaterFee)
			fs.ElectricityFee += deref(row.ElectricityFee)
			fs.Rent += deref(row.Rent)
			fs.WaterUsage += deref(row.WaterUsage)
			fs.ElectricityUsage += deref(row.ElectricityUsage)
			fs.InputRooms++
		}
		fs.List = append(fs.List, row)
		floors.Set(row.Floor, fs)
	}
	for _, key := range floors.Keys() {
		f, _ := floors.Get(key)
		grand.Total += f.Total
		grand.WaterFee += f.WaterFee
		grand.ElectricityFee += f.ElectricityFee
		grand.Rent += f.Rent
		grand.WaterUsage += f.WaterUsage
		grand.ElectricityUsage += f.ElectricityUsage
		grand.Rooms += f.Rooms
		grand.InputRooms += f.InputRooms
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"year": y, "month": m, "floors": floors, "grand": grand,
	})
}

// yearReport 年度趋势：按月汇总（仅已存档）。
func (s *Server) yearReport(w http.ResponseWriter, r *http.Request) {
	y, yerr := strconv.Atoi(r.PathValue("year"))
	if yerr != nil {
		jsonError(w, http.StatusBadRequest, "invalid year")
		return
	}
	rows, err := s.db.Query(`
		SELECT month,
			SUM(total) AS total, SUM(water_fee) AS water_fee, SUM(electricity_fee) AS electricity_fee,
			SUM(rent) AS rent, SUM(water_usage) AS water_usage, SUM(electricity_usage) AS electricity_usage,
			COUNT(*) AS rooms
		FROM monthly_records
		WHERE year=? AND archived=1
		GROUP BY month ORDER BY month`, y)
	if err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	defer rows.Close()

	months := []yearMonthRow{}
	totals := yearTotals{}
	for rows.Next() {
		var row yearMonthRow
		var total, waterFee, elecFee, rent, waterUsage, elecUsage sql.NullFloat64
		if err := rows.Scan(&row.Month, &total, &waterFee, &elecFee, &rent,
			&waterUsage, &elecUsage, &row.Rooms); err != nil {
			jsonError(w, http.StatusInternalServerError, err.Error())
			return
		}
		row.Total = f64p(total)
		row.WaterFee = f64p(waterFee)
		row.ElectricityFee = f64p(elecFee)
		row.Rent = f64p(rent)
		row.WaterUsage = f64p(waterUsage)
		row.ElectricityUsage = f64p(elecUsage)
		months = append(months, row)

		totals.Total += deref(row.Total)
		totals.WaterFee += deref(row.WaterFee)
		totals.ElectricityFee += deref(row.ElectricityFee)
		totals.Rent += deref(row.Rent)
	}
	if err := rows.Err(); err != nil {
		jsonError(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"year": y, "months": months, "totals": totals,
	})
}
