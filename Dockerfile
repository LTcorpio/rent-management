# syntax=docker/dockerfile:1

# ===== Stage 1: 构建前端 =====
FROM node:20-alpine AS client-build
WORKDIR /build/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# ===== Stage 2: 构建服务端依赖（含 better-sqlite3 原生编译） =====
FROM node:20-alpine AS server-build
RUN apk add --no-cache python3 make g++
WORKDIR /build/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev

# ===== Stage 3: 运行时 =====
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
ENV PORT=9097
ENV DB_PATH=/data/data.db
WORKDIR /app

# 拷贝服务端源码与已编译依赖
COPY --from=server-build /build/server/node_modules ./server/node_modules
COPY server/src ./server/src
COPY server/package.json ./server/
COPY server/config ./server/config

# 拷贝前端构建产物（index.js 通过相对路径引用 ../../client/dist）
COPY --from=client-build /build/client/dist ./client/dist

# 数据库持久化目录（由 docker-compose 挂载到宿主机）
RUN mkdir -p /data

EXPOSE 9097
CMD ["node", "server/src/index.js"]
