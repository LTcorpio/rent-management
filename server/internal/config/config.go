// Package config 加载服务配置：从 .env 与环境变量读取监听端口和数据库路径，
// 行为对齐原 Node 版（dotenv 不覆盖已存在的环境变量）。
package config

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

// Config 服务配置。
type Config struct {
	Port       string // 监听端口，默认 3001
	DBPath     string // SQLite 数据库文件路径
	ClientDist string // 前端构建产物目录
}

// Load 读取 CWD 下 .env（不覆盖已有环境变量），再解析 PORT / DB_PATH。
// 约定：服务从 server/ 目录启动（与原 Node 版一致），
// 默认数据库为 server/data.db，前端产物位于项目根的 client/dist。
func Load() Config {
	loadDotEnv(".env")

	port := os.Getenv("PORT")
	if port == "" {
		port = "3001"
	}
	return Config{
		Port:       port,
		DBPath:     resolveDBPath(os.Getenv("DB_PATH")),
		ClientDist: filepath.Join("..", "client", "dist"),
	}
}

// resolveDBPath DB_PATH 语义与原版一致：
// 留空 → 默认 data.db；以 .db 结尾 → 直接使用；否则视为目录，在其下创建 data.db。
func resolveDBPath(p string) string {
	if p == "" {
		return "data.db"
	}
	if strings.HasSuffix(p, ".db") {
		return p
	}
	return filepath.Join(p, "data.db")
}

// loadDotEnv 解析 KEY=VALUE 格式的 .env 文件，已存在的环境变量不被覆盖。
func loadDotEnv(path string) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, val, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		val = strings.TrimSpace(val)
		// 去掉成对的引号
		if len(val) >= 2 && (val[0] == '"' || val[0] == '\'') && val[len(val)-1] == val[0] {
			val = val[1 : len(val)-1]
		}
		if key != "" && os.Getenv(key) == "" {
			os.Setenv(key, val)
		}
	}
}
