// 房屋收租管理系统 - 服务端入口。
// 对应原 Node 版 src/index.js：启动 HTTP 服务，托管 REST API 与前端构建产物。
package main

import (
	"log"
	"net/http"

	"rent-management/server/internal/api"
	"rent-management/server/internal/config"
	"rent-management/server/internal/store"
)

func main() {
	cfg := config.Load()

	log.Printf("[db] 数据库路径: %s", cfg.DBPath)
	st := store.Open(cfg.DBPath)
	defer st.Close()

	handler := api.New(st.DB(), cfg.ClientDist)

	var roomsCount int
	if err := st.DB().QueryRow("SELECT COUNT(*) AS c FROM rooms").Scan(&roomsCount); err != nil {
		log.Fatalf("[server] 查询房间数失败: %v", err)
	}

	srv := &http.Server{Addr: "0.0.0.0:" + cfg.Port, Handler: handler}
	log.Printf("[server] 房租管理系统服务已启动: http://0.0.0.0:%s", cfg.Port)
	log.Printf("[server] 当前房间数: %d，局域网内手机访问本机 IP:%s 即可使用", roomsCount, cfg.Port)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("[server] 启动失败: %v", err)
	}
}
