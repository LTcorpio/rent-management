import { Router } from 'express';
import db from '../db.js';

const router = Router();

// 某月报表：按楼层汇总 + 房间明细，一页纸呈现
router.get('/month/:year/:month', (req, res) => {
  const y = Number(req.params.year);
  const m = Number(req.params.month);

  const rows = db.prepare(`
    SELECT mr.*, r.floor, r.room_number, r.monthly_rent, r.water_unit_price, r.electricity_unit_price,
           t.name AS tenant_name, t.id_card AS tenant_id_card, t.occupants
    FROM monthly_records mr
    JOIN rooms r ON r.id = mr.room_id
    LEFT JOIN tenants t ON t.id = mr.tenant_id
    WHERE mr.year=? AND mr.month=?
    ORDER BY CASE r.floor WHEN '一楼' THEN 1 WHEN '四五楼' THEN 2 ELSE 9 END, r.room_number
  `).all(y, m);

  const floors = {};
  let grand = { total: 0, water_fee: 0, electricity_fee: 0, rent: 0, water_usage: 0, electricity_usage: 0, rooms: 0, input_rooms: 0 };
  for (const r of rows) {
    if (!floors[r.floor]) floors[r.floor] = { total: 0, water_fee: 0, electricity_fee: 0, rent: 0, water_usage: 0, electricity_usage: 0, rooms: 0, input_rooms: 0, list: [] };
    const f = floors[r.floor];
    f.rooms++;
    if (r.total !== null) {
      f.total += r.total; f.water_fee += r.water_fee || 0; f.electricity_fee += r.electricity_fee || 0;
      f.rent += r.rent || 0; f.water_usage += r.water_usage || 0; f.electricity_usage += r.electricity_usage || 0;
      f.input_rooms++;
    }
    f.list.push(r);
  }
  for (const f of Object.values(floors)) {
    grand.total += f.total; grand.water_fee += f.water_fee; grand.electricity_fee += f.electricity_fee;
    grand.rent += f.rent; grand.water_usage += f.water_usage; grand.electricity_usage += f.electricity_usage;
    grand.rooms += f.rooms; grand.input_rooms += f.input_rooms;
  }
  res.json({ year: y, month: m, floors, grand });
});

// 年度趋势：按月汇总
router.get('/year/:year', (req, res) => {
  const y = Number(req.params.year);
  const rows = db.prepare(`
    SELECT month,
      SUM(total) AS total, SUM(water_fee) AS water_fee, SUM(electricity_fee) AS electricity_fee,
      SUM(rent) AS rent, SUM(water_usage) AS water_usage, SUM(electricity_usage) AS electricity_usage,
      COUNT(*) AS rooms
    FROM monthly_records
    WHERE year=? AND archived=1
    GROUP BY month ORDER BY month
  `).all(y);
  const totals = rows.reduce((a, r) => {
    a.total += r.total || 0; a.water_fee += r.water_fee || 0; a.electricity_fee += r.electricity_fee || 0; a.rent += r.rent || 0;
    return a;
  }, { total: 0, water_fee: 0, electricity_fee: 0, rent: 0 });
  res.json({ year: y, months: rows, totals });
});

export default router;
