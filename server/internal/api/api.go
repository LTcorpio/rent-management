// Package api 提供 HTTP 接口与静态资源托管，对应原 Node 版 Express 路由。
package api

import (
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"
)

// Server HTTP 服务：REST API + 前端静态托管。
type Server struct {
	db         *sql.DB
	clientDist string
}

// New 创建 HTTP Handler，注册全部路由（路径、方法与原版一致）。
func New(db *sql.DB, clientDist string) http.Handler {
	s := &Server{db: db, clientDist: clientDist}
	mux := http.NewServeMux()

	// 房间
	mux.HandleFunc("GET /api/rooms", s.listRooms)
	mux.HandleFunc("POST /api/rooms", s.createRoom)
	mux.HandleFunc("PUT /api/rooms/{id}", s.updateRoom)
	mux.HandleFunc("DELETE /api/rooms/{id}", s.deleteRoom)

	// 租客
	mux.HandleFunc("GET /api/tenants", s.listTenants)
	mux.HandleFunc("POST /api/tenants", s.createTenant)
	mux.HandleFunc("PUT /api/tenants/{id}", s.updateTenant)
	mux.HandleFunc("POST /api/tenants/{id}/moveout", s.moveoutTenant)

	// 月度记录
	mux.HandleFunc("GET /api/records/month/{year}/{month}", s.getMonth)
	mux.HandleFunc("POST /api/records", s.saveRecord)
	mux.HandleFunc("PUT /api/records/exception/{id}", s.markException)
	mux.HandleFunc("POST /api/records/archive/{year}/{month}", s.archiveMonth)
	mux.HandleFunc("GET /api/records/history", s.listHistory)
	mux.HandleFunc("GET /api/records/history/{year}/{month}", s.historyDetail)
	mux.HandleFunc("PUT /api/records/history/{id}", s.updateHistoryRecord)
	mux.HandleFunc("DELETE /api/records/history/{year}/{month}", s.deleteHistoryMonth)

	// 报表
	mux.HandleFunc("GET /api/report/month/{year}/{month}", s.monthReport)
	mux.HandleFunc("GET /api/report/year/{year}", s.yearReport)

	// 健康检查
	mux.HandleFunc("GET /api/health", s.health)

	// 身份：供前端做权限显隐（管理员才显示设置页与「保存并上传」）
	mux.HandleFunc("GET /api/me", s.me)

	// 其余路径：前端静态资源与 SPA 回退
	mux.HandleFunc("/", s.handleRoot)

	return cors(mux)
}

// health 健康检查：GET /api/health
func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":   true,
		"time": time.Now().UTC().Format("2006-01-02T15:04:05.000") + "Z",
	})
}

// me 身份查询：GET /api/me
//
// 身份来自反向代理注入的请求头，由 nginx + Authelia（auth_request）在
// https://rent.home.lan 上写入；局域网 IP:端口直连不带这些头，故视为未登录。
// 管理员判定：Remote-Groups 中以逗号分隔的组名包含 admins。
func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	// 身份随登录态变化，禁止任何缓存，避免切换账号后仍拿到旧身份
	w.Header().Set("Cache-Control", "no-store")
	user := r.Header.Get("Remote-User")
	groups := splitCSV(r.Header.Get("Remote-Groups"))
	writeJSON(w, http.StatusOK, map[string]any{
		"user":          user,
		"name":          r.Header.Get("Remote-Name"),
		"email":         r.Header.Get("Remote-Email"),
		"groups":        groups,
		"authenticated": user != "",
		"isAdmin":       hasGroup(groups, "admins"),
	})
}

// splitCSV 按逗号切分请求头中的列表（去除空白项），空串返回空切片。
func splitCSV(raw string) []string {
	out := []string{}
	for _, part := range strings.Split(raw, ",") {
		if part = strings.TrimSpace(part); part != "" {
			out = append(out, part)
		}
	}
	return out
}

// hasGroup 判断组列表中是否包含指定组名。
func hasGroup(groups []string, want string) bool {
	for _, g := range groups {
		if g == want {
			return true
		}
	}
	return false
}

// cors 与原版 cors() 默认行为一致：允许所有来源，处理预检请求。
func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Origin") != "" {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			// 预检请求直接返回 204
			if r.Method == http.MethodOptions && r.Header.Get("Access-Control-Request-Method") != "" {
				w.Header().Set("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE")
				if h := r.Header.Get("Access-Control-Request-Headers"); h != "" {
					w.Header().Set("Access-Control-Allow-Headers", h)
				}
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}

// writeJSON 输出 JSON 响应（与 Express res.json 的 Content-Type 一致）。
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

// jsonError 输出 {error: msg} 格式的错误响应。
func jsonError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

// readBody 读取 JSON 请求体（上限 2MB，与原版一致），返回键值映射。
// 空请求体视为 {}。保留"键不存在"与"值为 null"的区分，以复刻 JS 的
// undefined（未传）与 null（恢复默认）语义。
func readBody(w http.ResponseWriter, r *http.Request) (map[string]any, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, 2<<20)
	data, err := io.ReadAll(r.Body)
	if err != nil {
		jsonError(w, http.StatusBadRequest, "请求体读取失败")
		return nil, false
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		return map[string]any{}, true
	}
	var body map[string]any
	if err := json.Unmarshal(data, &body); err != nil {
		jsonError(w, http.StatusBadRequest, "invalid JSON body")
		return nil, false
	}
	if body == nil {
		body = map[string]any{}
	}
	return body, true
}
