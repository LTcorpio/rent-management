# 房屋收租管理系统

面向小型出租物业的月度收租管理工具，支持房间/租客管理、水电抄表自动计费、月度存档、历史回溯与数据报表。前后端一体化部署，适配手机与桌面浏览器，支持 Docker 容器化运行。

## 功能特性

- **当月收租**：按楼层分Tab录入水/电表读数，自动按单价计算费用与合计；支持当月自定义租金/单价/上期读数；一键复制房租信息文本发送给租客；标记异常项；存档上传当月数据。
- **历史存档**：按年份筛选查看已存档月份，点击进入明细页可修改读数并自动重算费用，支持删除整月存档。
- **数据报表**：核心指标卡（月总收入/租金/水费/电费/用水用电量）+ 各房间明细（按楼层切换，含楼层汇总卡片与明细表）；年度各月趋势底部抽屉（默认收起，展开时背景遮罩）。
- **设置（仅本机访问可见）**：管理房间预设（楼层/房间号/月租金/水电单价）、租客记录（入住/退租）；首次启动从配置文件自动导入房间。

## 技术栈

- 前端：React 18 + React Router + Vite
- 后端：Node.js + Express + better-sqlite3 (SQLite)
- 部署：Docker / docker-compose

## 目录结构

```
rent-management/
├── client/                 # 前端
│   ├── src/
│   │   ├── pages/          # 当月/历史/报表/设置 页面
│   │   ├── App.jsx         # 路由与底部导航
│   │   ├── api.js          # 后端 API 封装
│   │   ├── utils.js        # 金额/数字格式化、复制、计算辅助
│   │   ├── Icon.jsx        # SF Symbols 风格 SVG 图标
│   │   ├── MonthPicker.jsx # 内联年月选择器
│   │   └── styles.css      # 全局样式
│   ├── index.html
│   ├── vite.config.js      # 自动读取 server/.env 的 PORT 做代理
│   └── package.json
├── server/                 # 后端
│   ├── src/
│   │   ├── index.js        # Express 入口，加载 dotenv
│   │   ├── db.js           # SQLite 连接、建表、迁移、种子导入
│   │   ├── calc.js         # 费用计算逻辑
│   │   └── routes/         # rooms / tenants / records / report
│   ├── config/rooms.config.json   # 房间初始配置
│   ├── .env.example        # 环境变量模板
│   └── package.json
├── Dockerfile              # 多阶段构建（前端构建+后端运行时）
├── docker-compose.yml      # 容器编排，数据库持久化到宿主机
└── .gitignore
```

## 快速开始

### 本地开发

1. **后端**：
   ```bash
   cd server
   cp .env.example .env       # 按需修改 PORT / DB_PATH
   npm install
   npm run dev                # 默认监听 http://localhost:9097
   ```

2. **前端**（另开终端）：
   ```bash
   cd client
   npm install
   npm run dev                # 默认监听 http://localhost:5173，API 自动代理到后端
   ```

   浏览器访问 `http://localhost:5173` 即可，享受 HMR 热更新。

### 环境变量

在 `server/.env` 中配置（本地开发用，已在 `.gitignore` 中）：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `PORT` | 后端监听端口 | `3001`（Docker 中为 `9097`） |
| `DB_PATH` | SQLite 数据库文件路径；留空使用 `server/data.db`；指定目录时在该目录下创建 `data.db` | `server/data.db` |

> 前端 `vite.config.js` 会自动读取 `server/.env` 中的 `PORT`，保持前后端端口同步，无需手动维护代理目标。

### Docker 部署

```bash
docker compose up -d         # 构建并启动容器
```

- 容器端口：`9097`（宿主机映射 `9097:9097`）
- 数据库持久化目录：`/Users/ltcorpio/Library/CloudStorage/OneDrive-Personal/DockerData/rent-management`（可在 `docker-compose.yml` 修改）
- 访问：`http://<服务器IP>:9097`

## 使用说明

### 首次启动

数据库初始化时会自动从 `server/config/rooms.config.json` 导入房间预设。如需调整初始房间，编辑该配置文件后删除 `data.db` 重置。

### 当月抄表流程

1. 进入「当月」页面，选择年月
2. 按楼层切换Tab，依次录入各房间的水表/电表读数
   - 仅填一项时，另一项按 0 计算
   - 两项均空时不显示计算结果
   - 可展开"改价"临时修改当月租金/单价，不影响其他月份
   - 可修改"上期"读数（默认取最近一次有效记录）
3. 点击「复制房租信息」复制文本，粘贴发送给租客
4. 全部录入完成后点击底部「保存并上传」存档

### 历史回溯

- 「历史」页面按年份筛选查看已存档月份
- 点击某月进入明细，可修改读数/上期/单价，保存后自动重算
- 可删除整月存档

### 报表查看

- 「报表」页面选择年月，查看核心指标与各房间明细（按楼层切换）
- 底部「各月趋势」抽屉默认收起，点击展开查看全年月度趋势，点击抽屉外或遮罩收起

### 访问控制

「设置」页面仅在以下本机访问场景显示：
- `localhost`
- `127.0.0.1`
- `::1`

通过局域网 IP 或外部地址访问时，底部导航不显示「设置」入口，直接访问 `/settings` 会重定向到首页。

## 数据安全

- SQLite 数据库单文件存储，便于备份（直接复制 `data.db`）
- Docker 部署时数据库挂载到宿主机目录，容器重建数据不丢失
- 建议定期备份 `data.db` 文件
