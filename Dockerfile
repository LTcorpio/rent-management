# syntax=docker/dockerfile:1

# ===== Stage 1: 构建前端 =====
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS client-build
WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ===== Stage 2: 构建服务端（Go 静态编译，无需 cgo） =====
FROM golang:1.26-alpine@sha256:8ac98ca534ac3f51e1f420a1dd2c15e74c75cfa0f23f3ad27eb5d7236c349a0c AS server-build
WORKDIR /build/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

# ===== Stage 3: 运行时 =====
FROM alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc AS runtime
ENV PORT=9097
ENV DB_PATH=/data/data.db
# 工作目录设为 /app/server：与本地开发一致（config 位于 ./config，前端产物位于 ../client/dist）
WORKDIR /app/server

# 拷贝服务端二进制与房间配置
COPY --from=server-build /out/server ./server
COPY server/config ./config

# 拷贝前端构建产物（相对路径 ../client/dist）
COPY --from=client-build /build/client/dist ../client/dist

# 数据库持久化目录（由 docker-compose 挂载到宿主机）
RUN mkdir -p /data

EXPOSE 9097
CMD ["./server"]
