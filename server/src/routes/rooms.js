import { Router } from 'express';
import db from '../db.js';

const router = Router();

// 获取所有房间，按楼层分组，附带当前租客与上月读数（用于当月页 prev 基线）
router.get('/', (req, res) => {
  const rooms = db.prepare(`
    SELECT * FROM rooms ORDER BY
      CASE floor WHEN '一楼' THEN 1 WHEN '四五楼' THEN 2 ELSE 9 END,
      room_number
  `).all();

  // 当前租客
  const tenantStmt = db.prepare(`SELECT * FROM tenants WHERE room_id = ? AND is_current = 1 ORDER BY id DESC LIMIT 1`);
  // 该房间最近一条记录的读数（作为下月 prev 基线）
  const lastRecStmt = db.prepare(`
    SELECT water_reading, electricity_reading FROM monthly_records
    WHERE room_id = ? AND water_reading IS NOT NULL
    ORDER BY year DESC, month DESC LIMIT 1
  `);

  const grouped = {};
  for (const r of rooms) {
    const tenant = tenantStmt.get(r.id) || null;
    const last = lastRecStmt.get(r.id);
    const baselineWater = last ? last.water_reading : r.initial_water;
    const baselineElec = last ? last.electricity_reading : r.initial_electricity;
    const room = { ...r, current_tenant: tenant, baseline_water: baselineWater, baseline_electricity: baselineElec };
    if (!grouped[r.floor]) grouped[r.floor] = [];
    grouped[r.floor].push(room);
  }
  res.json(grouped);
});

// 更新房间预设
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { floor, room_number, monthly_rent, water_unit_price, electricity_unit_price, start_date, initial_water, initial_electricity } = req.body;
  try {
    db.prepare(`
      UPDATE rooms SET floor=?, room_number=?, monthly_rent=?, water_unit_price=?, electricity_unit_price=?, start_date=?, initial_water=?, initial_electricity=? WHERE id=?
    `).run(floor, room_number, monthly_rent, water_unit_price, electricity_unit_price, start_date, initial_water, initial_electricity, id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 新增房间
router.post('/', (req, res) => {
  const { floor, room_number, monthly_rent = 0, water_unit_price = 0, electricity_unit_price = 0, start_date, initial_water = 0, initial_electricity = 0 } = req.body;
  try {
    const info = db.prepare(`
      INSERT INTO rooms (floor, room_number, monthly_rent, water_unit_price, electricity_unit_price, start_date, initial_water, initial_electricity)
      VALUES (?,?,?,?,?,?,?,?)
    `).run(floor, room_number, monthly_rent, water_unit_price, electricity_unit_price, start_date, initial_water, initial_electricity);
    res.json({ id: info.lastInsertRowid });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

router.delete('/:id', (req, res) => {
  db.prepare('DELETE FROM rooms WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

export default router;
