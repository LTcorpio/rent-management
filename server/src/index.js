import express from 'express';
import cors from 'cors';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import db from './db.js';
import roomsRouter from './routes/rooms.js';
import tenantsRouter from './routes/tenants.js';
import recordsRouter from './routes/records.js';
import reportRouter from './routes/report.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

app.use('/api/rooms', roomsRouter);
app.use('/api/tenants', tenantsRouter);
app.use('/api/records', recordsRouter);
app.use('/api/report', reportRouter);

// 健康检查
app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// 生产环境静态托管前端构建产物
const clientDist = join(__dirname, '..', '..', 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not found' });
    res.sendFile(join(clientDist, 'index.html'));
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
  const roomsCount = db.prepare('SELECT COUNT(*) AS c FROM rooms').get().c;
  console.log(`[server] 房租管理系统服务已启动: http://0.0.0.0:${PORT}`);
  console.log(`[server] 当前房间数: ${roomsCount}，局域网内手机访问本机 IP:${PORT} 即可使用`);
});
