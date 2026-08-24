package api

import (
	"database/sql/driver"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// 本文件复刻原 Node 版中 JS 值语义（Number()、truthy、?? 等），
// 保证前端传参的边界情况（缺省 / null / 空串 / 数字字符串）行为一致。

// jsNumber 复刻 JS Number(v)（v 来自 JSON 解码）。ok=false 表示结果为 NaN。
func jsNumber(v any) (float64, bool) {
	switch x := v.(type) {
	case nil: // Number(null) === 0
		return 0, true
	case bool:
		if x {
			return 1, true
		}
		return 0, true
	case float64:
		return x, true
	case string:
		s := strings.TrimSpace(x) // JS Number() 会忽略首尾空白
		if s == "" {
			return 0, true // Number('') === 0
		}
		f, err := strconv.ParseFloat(s, 64)
		if err != nil {
			return 0, false // NaN
		}
		return f, true
	default:
		return 0, false
	}
}

// numOrNil 复刻 calc.js 的 num()：null / undefined / 空串 / 不可解析 → nil。
func numOrNil(v any) *float64 {
	if v == nil {
		return nil
	}
	if s, ok := v.(string); ok && s == "" {
		return nil
	}
	f, ok := jsNumber(v)
	if !ok || math.IsNaN(f) || math.IsInf(f, 0) {
		return nil
	}
	return &f
}

// parseCustom 复刻 records.js 的 parseCustom：
// 未传（键不存在）→ 保留旧值（无旧值则 null）；null / 空串 → null（恢复默认）；
// 其他 → Number(v)（NaN / Infinity 在 SQLite 中落库为 NULL，故归一为 nil）。
func parseCustom(body map[string]any, key string, old *float64) *float64 {
	v, exists := body[key]
	if !exists {
		return old
	}
	if v == nil {
		return nil
	}
	if s, ok := v.(string); ok && s == "" {
		return nil
	}
	f, ok := jsNumber(v)
	if !ok || math.IsNaN(f) || math.IsInf(f, 0) {
		return nil
	}
	return &f
}

// truthy 复刻 JS 真值判断。
func truthy(v any) bool {
	switch x := v.(type) {
	case nil:
		return false
	case bool:
		return x
	case float64:
		return x != 0 && !math.IsNaN(x)
	case string:
		return x != ""
	default:
		return true
	}
}

// bindValue 将 JSON 解码值转为 SQL 绑定值（对齐 better-sqlite3 的绑定行为：
// 布尔绑定为 1/0，数字/字符串原样绑定，由 SQLite 列亲和性完成转换）。
func bindValue(v any) driver.Value {
	switch x := v.(type) {
	case nil:
		return nil
	case bool:
		if x {
			return int64(1)
		}
		return int64(0)
	case float64:
		return x
	case string:
		return x
	default:
		return fmt.Sprintf("%v", x)
	}
}

// orNull 复刻 JS 的 `v || null`：假值（含缺省/空串）→ NULL，真值原样绑定。
func orNull(v any) driver.Value {
	if truthy(v) {
		return bindValue(v)
	}
	return nil
}

// withDefault 复刻 JS 解构默认值 `const { k = def } = body`：仅键不存在时取默认。
func withDefault(body map[string]any, key string, def driver.Value) driver.Value {
	if v, exists := body[key]; exists {
		return bindValue(v)
	}
	return def
}

// bodyFloat 取请求体数值字段（缺省返回 def）。
func bodyFloat(body map[string]any, key string, def float64) float64 {
	if v, exists := body[key]; exists {
		if f, ok := jsNumber(v); ok {
			return f
		}
	}
	return def
}

// jsString 复刻 JS String(v)（用于 exception_note 等）。
func jsString(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case float64:
		return strconv.FormatFloat(x, 'f', -1, 64)
	case bool:
		if x {
			return "true"
		}
		return "false"
	case nil:
		return "null"
	default:
		return fmt.Sprintf("%v", x)
	}
}

// fval 将 *float64 转为可绑定/可序列化的值。
func fval(p *float64) any {
	if p == nil {
		return nil
	}
	return *p
}
