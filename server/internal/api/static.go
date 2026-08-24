package api

import (
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
)

// handleRoot 处理非 API 路径：前端静态资源托管与 SPA 回退。
// - /assets/*：带 hash 的静态资源，长期缓存（1 年，immutable）
// - / 与 /index.html：不缓存，确保总是拿到最新构建引用
// - 其他路径：先按静态文件查找（缓存 1 天），找不到回退 index.html
// - /api/* 未匹配路由：404 JSON
func (s *Server) handleRoot(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		jsonError(w, http.StatusNotFound, "not found")
		return
	}
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.NotFound(w, r)
		return
	}

	// 规范化路径，消除 .. 等穿越片段
	p := path.Clean("/" + r.URL.Path)

	switch {
	case p == "/" || p == "/index.html":
		s.serveFromDist(w, r, "index.html", "no-cache, no-store, must-revalidate")
	case strings.HasPrefix(p, "/assets/"):
		rel := strings.TrimPrefix(p, "/assets/")
		s.serveFromDist(w, r, filepath.Join("assets", rel), "public, max-age=31536000, immutable")
	default:
		rel := strings.TrimPrefix(p, "/")
		if rel != "" {
			if full := filepath.Join(s.clientDist, rel); isRegularFile(full) {
				w.Header().Set("Cache-Control", "public, max-age=86400")
				http.ServeFile(w, r, full)
				return
			}
		}
		s.serveFromDist(w, r, "index.html", "no-cache, no-store, must-revalidate")
	}
}

// serveFromDist 从前端构建产物目录发送文件；文件不存在时返回 404。
func (s *Server) serveFromDist(w http.ResponseWriter, r *http.Request, rel, cacheControl string) {
	full := filepath.Join(s.clientDist, rel)
	if !isRegularFile(full) {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Cache-Control", cacheControl)
	http.ServeFile(w, r, full)
}

func isRegularFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
