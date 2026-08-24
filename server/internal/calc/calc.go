// Package calc 提供房租费用计算逻辑。
// 用量 = 当期读数 - 上期读数；费用 = 用量 * 单价。
// 计算规则与数值舍入行为与原 Node 版 calc.js 保持一致。
package calc

import "math"

// jsEpsilon 与 JS 的 Number.EPSILON 一致。
const jsEpsilon = 2.220446049250313e-16

// jsRound 复刻 JS Math.round：四舍五入，.5 向 +Infinity 方向取整。
func jsRound(x float64) float64 {
	return math.Floor(x + 0.5)
}

// Round2 保留两位小数，等价于 JS 的 Math.round((n + Number.EPSILON) * 100) / 100。
func Round2(n float64) float64 {
	return jsRound((n+jsEpsilon)*100) / 100
}

// RoomPrices 房间计价参数（已合并当月覆盖值）。
type RoomPrices struct {
	MonthlyRent          float64
	WaterUnitPrice       float64
	ElectricityUnitPrice float64
}

// Readings 一次抄表输入：当期读数可空（未抄表），上期读数必填（默认 0）。
type Readings struct {
	WaterReading       *float64
	ElectricityReading *float64
	PrevWaterReading   float64
	PrevElecReading    float64
}

// Calc 计算结果。JSON 字段名（camelCase）为前端既有契约，不可变更。
type Calc struct {
	HasInput   bool     `json:"hasInput"`
	WaterUsage *float64 `json:"waterUsage"`
	ElecUsage  *float64 `json:"elecUsage"`
	WaterFee   *float64 `json:"waterFee"`
	ElecFee    *float64 `json:"elecFee"`
	Rent       *float64 `json:"rent"`
	Total      *float64 `json:"total"`
}

func ptr(n float64) *float64 { return &n }

// Record 计算一条月度记录的费用。
func Record(room RoomPrices, rec Readings) Calc {
	var waterUsage, elecUsage, waterFee, elecFee, total *float64

	if rec.WaterReading != nil {
		waterUsage = ptr(Round2(*rec.WaterReading - rec.PrevWaterReading))
	}
	if rec.ElectricityReading != nil {
		elecUsage = ptr(Round2(*rec.ElectricityReading - rec.PrevElecReading))
	}
	if waterUsage != nil {
		waterFee = ptr(Round2(*waterUsage * room.WaterUnitPrice))
	}
	if elecUsage != nil {
		elecFee = ptr(Round2(*elecUsage * room.ElectricityUnitPrice))
	}
	rent := room.MonthlyRent
	if waterFee != nil && elecFee != nil {
		total = ptr(Round2(*waterFee + *elecFee + rent))
	}
	return Calc{
		HasInput:   rec.WaterReading != nil || rec.ElectricityReading != nil,
		WaterUsage: waterUsage,
		ElecUsage:  elecUsage,
		WaterFee:   waterFee,
		ElecFee:    elecFee,
		Rent:       ptr(rent),
		Total:      total,
	}
}
