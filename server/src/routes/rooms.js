import { Router } from 'express';
import db from '../db.js';

const router = Router();

// 某房间最近一次非空水/电读数（分开查）
const lastWaterStmt = db.prepare(`
  SELECT water_reading FROM monthly_records
  WHERE room_id = ? AND water_reading IS NOT NULL
  ORDER BY year DESC, month DESC LIMIT 1
`);
const lastElecStmt = db.prepare(`
  SELECT electricity_reading FROM monthly_records
  WHERE room_id = ? AND electricity_reading IS NOT NULL
  ORDER BY year DESC, month DESC LIMIT 1
`);

// 获取所有房间，按楼层分组，附带当前租客与最近读数（作为当月 prev 基线）
router.get('/', (req, res) => {
  const rooms = db.prepare(`
    SELECT * FROM rooms ORDER BY
      CASE floor WHEN '一楼' THEN 1 WHEN '四五楼' THEN 2 ELSE 9 END,
      room_number
  `).all();

  const tenantStmt = db.prepare(`SELECT * FROM tenants WHERE room_id = ? AND is_current = 1 ORDER BY id DESC LIMIT 1`);

  const grouped = {};
  for (const r of rooms) {
    const tenant = tenantStmt.get(r.id) || null;
    const lw = lastWaterStmt.get(r.id);
    const le = lastElecStmt.get(r.id);
    const baselineWater = lw ? lw.water_reading : 0;
    const baselineElec = le ? le.electricity_reading : 0;
    const room = { ...r, current_tenant: tenant, baseline_water: baselineWater, baseline_electricity: baselineElec };
    if (!grouped[r.floor]) grouped[r.floor] = [];
    grouped[r.floor].push(room);
  }
  res.json(grouped);
});

// 更新房间预设
router.put('/:id', (req, res) => {
  const { id } = req.params;
  const { floor, room_number, monthly_rent, water_unit_price, electricity_unit_price } = req.body;
  try {
    db.prepare(`
      UPDATE rooms SET floor=?, room_number=?, monthly_rent=?, water_unit_price=?, electricity_unit_price=? WHERE id=?
    `).run(floor, room_number, monthly_rent, water_unit_price, electricity_unit_price, id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// 新增房间
router.post('/', (req, res) => {
  const { floor, room_number, monthly_rent = 0, water_unit_price = 0, electricity_unit_price = 0 } = req.body;
  try {
    const info = db.prepare(`
      INSERT INTO rooms (floor, room_number, monthly_rent, water_unit_price, electricity_unit_price)
      VALUES (?,?,?,?,?)
    `).run(floor, room_number, monthly_rent, water_unit_price, electricity_unit_price);
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
