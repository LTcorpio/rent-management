import { Router } from 'express';
import db from '../db.js';
import { calcRecord } from '../calc.js';

const router = Router();

// 查询某房间在指定年月之前最近的有效（非空）水/电读数
// 跳过未抄表（读数为 NULL）的月份；都找不到则由调用方回退到房间初始读数
const prevWaterStmt = db.prepare(`
  SELECT water_reading FROM monthly_records
  WHERE room_id=? AND water_reading IS NOT NULL AND (year < ? OR (year=? AND month < ?))
  ORDER BY year DESC, month DESC LIMIT 1
`);
const prevElecStmt = db.prepare(`
  SELECT electricity_reading FROM monthly_records
  WHERE room_id=? AND electricity_reading IS NOT NULL AND (year < ? OR (year=? AND month < ?))
  ORDER BY year DESC, month DESC LIMIT 1
`);

function getPrevReadings(roomId, year, month, room) {
  const pw = prevWaterStmt.get(roomId, year, year, month);
  const pe = prevElecStmt.get(roomId, year, year, month);
  return {
    prevWater: pw ? pw.water_reading : room.initial_water,
    prevElec: pe ? pe.electricity_reading : room.initial_electricity,
  };
}

// 获取某年月所有房间记录；若某房间无记录则自动补一条草稿（prev 读数取上月/初始基线）
router.get('/month/:year/:month', (req, res) => {
  const { year, month } = req.params;
  const y = Number(year);
  const m = Number(month);

  const rooms = db.prepare(`
    SELECT * FROM rooms ORDER BY
      CASE floor WHEN '一楼' THEN 1 WHEN '四五楼' THEN 2 ELSE 9 END, room_number
  `).all();

  const tenantStmt = db.prepare(`SELECT * FROM tenants WHERE room_id=? AND is_current=1 ORDER BY id DESC LIMIT 1`);
  const recStmt = db.prepare(`SELECT * FROM monthly_records WHERE room_id=? AND year=? AND month=?`);
  const upsertDraft = db.prepare(`
    INSERT INTO monthly_records (room_id, tenant_id, year, month, prev_water_reading, prev_electricity_reading)
    VALUES (?,?,?,?,?,?)
    ON CONFLICT(room_id, year, month) DO UPDATE SET
      prev_water_reading=excluded.prev_water_reading,
      prev_electricity_reading=excluded.prev_electricity_reading
  `);

  const result = [];
  const grouped = {};
  for (const r of rooms) {
    let rec = recStmt.get(r.id, y, m);
    const { prevWater, prevElec } = getPrevReadings(r.id, y, m, r);
    const tenant = tenantStmt.get(r.id) || null;

    if (!rec) {
      upsertDraft.run(r.id, tenant?.id || null, y, m, prevWater, prevElec);
      rec = recStmt.get(r.id, y, m);
    } else {
      // 刷新 prev 基线与租客
      db.prepare(`UPDATE monthly_records SET prev_water_reading=?, prev_electricity_reading=?, tenant_id=COALESCE(?, tenant_id) WHERE id=?`)
        .run(prevWater, prevElec, tenant?.id || null, rec.id);
      rec = recStmt.get(r.id, y, m);
    }

    const calc = calcRecord(r, rec);
    const item = { ...rec, room: r, tenant: tenant, calc };
    result.push(item);
    if (!grouped[r.floor]) grouped[r.floor] = [];
    grouped[r.floor].push(item);
  }
  res.json({ year: y, month: m, grouped, list: result });
});

// 保存单条记录读数（输入即时保存草稿，archived=0）
router.post('/', (req, res) => {
  const { room_id, year, month, water_reading, electricity_reading, tenant_id, note } = req.body;
  const room = db.prepare(`SELECT * FROM rooms WHERE id=?`).get(room_id);
  if (!room) return res.status(404).json({ error: '房间不存在' });

  const existing = db.prepare(`SELECT * FROM monthly_records WHERE room_id=? AND year=? AND month=?`).get(room_id, year, month);
  let prevWater, prevElec;
  if (existing) {
    prevWater = existing.prev_water_reading;
    prevElec = existing.prev_electricity_reading;
  } else {
    ({ prevWater, prevElec } = getPrevReadings(room_id, year, month, room));
  }

  const draft = { water_reading, electricity_reading, prev_water_reading: prevWater, prev_electricity_reading: prevElec };
  const calc = calcRecord(room, draft);

  const info = db.prepare(`
    INSERT INTO monthly_records (room_id, tenant_id, year, month, prev_water_reading, prev_electricity_reading, water_reading, electricity_reading, water_usage, electricity_usage, water_fee, electricity_fee, rent, total, note, archived)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
    ON CONFLICT(room_id, year, month) DO UPDATE SET
      tenant_id=COALESCE(excluded.tenant_id, monthly_records.tenant_id),
      water_reading=excluded.water_reading,
      electricity_reading=excluded.electricity_reading,
      water_usage=excluded.water_usage,
      electricity_usage=excluded.electricity_usage,
      water_fee=excluded.water_fee,
      electricity_fee=excluded.electricity_fee,
      rent=excluded.rent,
      total=excluded.total,
      note=excluded.note,
      updated_at=datetime('now','localtime')
  `).run(room_id, tenant_id || null, year, month, prevWater, prevElec,
    water_reading ?? null, electricity_reading ?? null,
    calc.waterUsage, calc.elecUsage, calc.waterFee, calc.elecFee, calc.rent, calc.total, note || null);

  res.json({ ok: true, id: info.lastInsertRowid, calc });
});

// 存档：将某年月所有记录置为 archived=1（点击保存上传时调用）
router.post('/archive/:year/:month', (req, res) => {
  const { year, month } = req.params;
  const info = db.prepare(`UPDATE monthly_records SET archived=1, updated_at=datetime('now','localtime') WHERE year=? AND month=?`).run(year, month);
  res.json({ ok: true, archived: info.changes });
});

// 历史年月列表（已存档），含汇总
router.get('/history', (req, res) => {
  const rows = db.prepare(`
    SELECT year, month, archived,
      COUNT(*) AS room_count,
      SUM(total) AS total_amount,
      SUM(water_fee) AS total_water,
      SUM(electricity_fee) AS total_elec,
      SUM(rent) AS total_rent,
      SUM(water_usage) AS sum_water,
      SUM(electricity_usage) AS sum_elec
    FROM monthly_records
    WHERE archived=1
    GROUP BY year, month
    ORDER BY year DESC, month DESC
  `).all();
  res.json(rows);
});

// 历史某月明细（已存档）
router.get('/history/:year/:month', (req, res) => {
  const { year, month } = req.params;
  const y = Number(year); const m = Number(month);
  const rows = db.prepare(`
    SELECT mr.*, r.floor, r.room_number, r.monthly_rent, r.water_unit_price, r.electricity_unit_price,
           t.name AS tenant_name, t.id_card AS tenant_id_card, t.occupants
    FROM monthly_records mr
    JOIN rooms r ON r.id = mr.room_id
    LEFT JOIN tenants t ON t.id = mr.tenant_id
    WHERE mr.year=? AND mr.month=?
    ORDER BY CASE r.floor WHEN '一楼' THEN 1 WHEN '四五楼' THEN 2 ELSE 9 END, r.room_number
  `).all(y, m);
  const grouped = {};
  for (const row of rows) {
    if (!grouped[row.floor]) grouped[row.floor] = [];
    grouped[row.floor].push(row);
  }
  res.json({ year: y, month: m, grouped, list: rows });
});

export default router;
