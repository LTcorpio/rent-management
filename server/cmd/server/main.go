// 房屋收租管理系统 - 服务端入口。
// 对应原 Node 版 src/index.js：启动 HTTP 服务，托管 REST API 与前端构建产物。
package main

import (
	"context"
	"errors"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

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

	// 监听 SIGINT/SIGTERM，优雅停机：先停 HTTP 等待在途请求结束，
	// 再关闭数据库（checkpoint + 清理临时文件），避免 -wal/-shm 残留。
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	errCh := make(chan error, 1)
	go func() {
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		log.Fatalf("[server] 启动失败: %v", err)
	case <-ctx.Done():
		log.Println("[server] 收到退出信号，正在优雅停机...")
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("[server] HTTP 停机异常: %v", err)
	}

	if err := st.Close(); err != nil {
		log.Printf("[db] 关闭数据库异常: %v", err)
	}
	log.Println("[server] 服务已退出，数据库已安全关闭")
}
