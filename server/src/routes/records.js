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

function getPrevReadings(roomId, year, month) {
  const pw = prevWaterStmt.get(roomId, year, year, month);
  const pe = prevElecStmt.get(roomId, year, year, month);
  return {
    prevWater: pw ? pw.water_reading : 0,
    prevElec: pe ? pe.electricity_reading : 0,
  };
}

// 合并房间预设与当月覆盖值：custom 非 null 时覆盖对应字段，用于计算
function mergeCustom(room, rec) {
  return {
    ...room,
    monthly_rent: rec.custom_monthly_rent !== null && rec.custom_monthly_rent !== undefined ? rec.custom_monthly_rent : room.monthly_rent,
    water_unit_price: rec.custom_water_unit_price !== null && rec.custom_water_unit_price !== undefined ? rec.custom_water_unit_price : room.water_unit_price,
    electricity_unit_price: rec.custom_electricity_unit_price !== null && rec.custom_electricity_unit_price !== undefined ? rec.custom_electricity_unit_price : room.electricity_unit_price,
  };
}

// 获取某年月所有房间记录；若某房间无记录则自动补一条草稿（prev 读数取最近一次记录，无则 0）
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
  // 刷新默认基线（仅当用户未自定义时）
  const refreshDefault = db.prepare(`
    UPDATE monthly_records SET prev_water_reading=?, prev_electricity_reading=?, tenant_id=COALESCE(?, tenant_id)
    WHERE id=? AND prev_water_custom IS NULL AND prev_electricity_custom IS NULL
  `);
  // 仅刷新租客（用户自定义了 prev 时，不碰 prev）
  const refreshTenantOnly = db.prepare(`
    UPDATE monthly_records SET tenant_id=COALESCE(?, tenant_id) WHERE id=?
  `);

  const result = [];
  const grouped = {};
  for (const r of rooms) {
    let rec = recStmt.get(r.id, y, m);
    const { prevWater: defWater, prevElec: defElec } = getPrevReadings(r.id, y, m);
    const tenant = tenantStmt.get(r.id) || null;

    if (!rec) {
      upsertDraft.run(r.id, tenant?.id || null, y, m, defWater, defElec);
      rec = recStmt.get(r.id, y, m);
    } else if (rec.archived === 1) {
      // 已存档：不刷新 prev/单价，保留历史修改值，仅刷新租客
      refreshTenantOnly.run(tenant?.id || null, rec.id);
      rec = recStmt.get(r.id, y, m);
    } else if (rec.prev_water_custom === null && rec.prev_electricity_custom === null) {
      // 用户未自定义：刷新默认基线（防新增记录后基线变化）
      refreshDefault.run(defWater, defElec, tenant?.id || null, rec.id);
      rec = recStmt.get(r.id, y, m);
    } else {
      // 用户自定义了至少一项：只刷新租客，保留 custom 与已计算的 prev
      refreshTenantOnly.run(tenant?.id || null, rec.id);
      rec = recStmt.get(r.id, y, m);
    }

    const calc = calcRecord(mergeCustom(r, rec), rec);
    const item = { ...rec, room: r, tenant, calc, default_prev_water: defWater, default_prev_elec: defElec };
    result.push(item);
    if (!grouped[r.floor]) grouped[r.floor] = [];
    grouped[r.floor].push(item);
  }
  res.json({ year: y, month: m, grouped, list: result });
});

// 保存单条记录读数（输入即时保存草稿，archived=0）
// 支持自定义上期读数：传 prev_water_custom/prev_electricity_custom（null=恢复默认，数字=自定义）
router.post('/', (req, res) => {
  const { room_id, year, month, water_reading, electricity_reading, tenant_id, note,
          prev_water_custom, prev_electricity_custom,
          custom_monthly_rent, custom_water_unit_price, custom_electricity_unit_price } = req.body;
  const room = db.prepare(`SELECT * FROM rooms WHERE id=?`).get(room_id);
  if (!room) return res.status(404).json({ error: '房间不存在' });

  // 自动默认基线
  const def = getPrevReadings(room_id, year, month);

  const existing = db.prepare(`SELECT * FROM monthly_records WHERE room_id=? AND year=? AND month=?`).get(room_id, year, month);
  // 解析 custom：undefined 表示不变；null 表示恢复默认；数字表示自定义
  const parseCustom = (val, oldVal) => {
    if (val === undefined) return oldVal ?? null;
    if (val === null || val === '') return null;
    return Number(val);
  };
  const newWaterCustom = parseCustom(prev_water_custom, existing?.prev_water_custom);
  const newElecCustom = parseCustom(prev_electricity_custom, existing?.prev_electricity_custom);
  const newRentCustom = parseCustom(custom_monthly_rent, existing?.custom_monthly_rent);
  const newWupCustom = parseCustom(custom_water_unit_price, existing?.custom_water_unit_price);
  const newEupCustom = parseCustom(custom_electricity_unit_price, existing?.custom_electricity_unit_price);
  // 生效 prev：custom 优先，否则默认
  const prevWater = newWaterCustom !== null ? newWaterCustom : def.prevWater;
  const prevElec = newElecCustom !== null ? newElecCustom : def.prevElec;

  // 计算用 room：合并当月覆盖值
  const calcRoom = mergeCustom(room, {
    custom_monthly_rent: newRentCustom,
    custom_water_unit_price: newWupCustom,
    custom_electricity_unit_price: newEupCustom,
  });
  const draft = { water_reading, electricity_reading, prev_water_reading: prevWater, prev_electricity_reading: prevElec };
  const calc = calcRecord(calcRoom, draft);

  const info = db.prepare(`
    INSERT INTO monthly_records (room_id, tenant_id, year, month, prev_water_reading, prev_electricity_reading, prev_water_custom, prev_electricity_custom, custom_monthly_rent, custom_water_unit_price, custom_electricity_unit_price, water_reading, electricity_reading, water_usage, electricity_usage, water_fee, electricity_fee, rent, total, note, archived)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)
    ON CONFLICT(room_id, year, month) DO UPDATE SET
      tenant_id=COALESCE(excluded.tenant_id, monthly_records.tenant_id),
      prev_water_reading=excluded.prev_water_reading,
      prev_electricity_reading=excluded.prev_electricity_reading,
      prev_water_custom=excluded.prev_water_custom,
      prev_electricity_custom=excluded.prev_electricity_custom,
      custom_monthly_rent=excluded.custom_monthly_rent,
      custom_water_unit_price=excluded.custom_water_unit_price,
      custom_electricity_unit_price=excluded.custom_electricity_unit_price,
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
  `).run(room_id, tenant_id || null, year, month, prevWater, prevElec, newWaterCustom, newElecCustom,
    newRentCustom, newWupCustom, newEupCustom,
    water_reading ?? null, electricity_reading ?? null,
    calc.waterUsage, calc.elecUsage, calc.waterFee, calc.elecFee, calc.rent, calc.total, note || null);

  res.json({ ok: true, id: info.lastInsertRowid, calc, prev_water_reading: prevWater, prev_electricity_reading: prevElec, prev_water_custom: newWaterCustom, prev_electricity_custom: newElecCustom, custom_monthly_rent: newRentCustom, custom_water_unit_price: newWupCustom, custom_electricity_unit_price: newEupCustom, default_prev_water: def.prevWater, default_prev_elec: def.prevElec });
});

// 标记/取消异常项：传 exception_note（空字符串或 null=取消标记，非空=标记异常并记录原因）
router.put('/exception/:id', (req, res) => {
  const { id } = req.params;
  const { exception_note } = req.body;
  const note = exception_note === undefined ? null : (exception_note === '' ? null : String(exception_note));
  const info = db.prepare(`UPDATE monthly_records SET exception_note=?, updated_at=datetime('now','localtime') WHERE id=?`).run(note, id);
  if (info.changes === 0) return res.status(404).json({ error: '记录不存在' });
  res.json({ ok: true, exception_note: note });
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
      SUM(CASE WHEN total IS NOT NULL AND total != 0 THEN 1 ELSE 0 END) AS valid_room_count,
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

// 修改历史存档某房间记录（已存档也可改），支持修改读数、上期读数、当月租金与水电单价，自动重算费用
// 注：monthly_rent/water_unit_price/electricity_unit_price/prev_* 同时写入 custom_* 列，
// 确保当月页通过 mergeCustom 重算时与历史页一致
router.put('/history/:id', (req, res) => {
  const { id } = req.params;
  const {
    water_reading, electricity_reading,
    prev_water_reading, prev_electricity_reading,
    monthly_rent, water_unit_price, electricity_unit_price,
  } = req.body;
  const rec = db.prepare(`SELECT * FROM monthly_records WHERE id=?`).get(id);
  if (!rec) return res.status(404).json({ error: '记录不存在' });
  const room = db.prepare(`SELECT * FROM rooms WHERE id=?`).get(rec.room_id);

  const wr = water_reading === '' || water_reading === undefined ? null : Number(water_reading);
  const er = electricity_reading === '' || electricity_reading === undefined ? null : Number(electricity_reading);
  // 上期读数：未传则保留原值；同时同步 custom 列（已存档后 prev 不再自动刷新，写入 custom 固定）
  const pw = prev_water_reading === '' || prev_water_reading === undefined ? rec.prev_water_reading : Number(prev_water_reading);
  const pe = prev_electricity_reading === '' || prev_electricity_reading === undefined ? rec.prev_electricity_reading : Number(prev_electricity_reading);
  const pwCustom = prev_water_reading === '' || prev_water_reading === undefined ? rec.prev_water_custom : (prev_water_reading === '' ? null : Number(prev_water_reading));
  const peCustom = prev_electricity_reading === '' || prev_electricity_reading === undefined ? rec.prev_electricity_custom : (prev_electricity_reading === '' ? null : Number(prev_electricity_reading));
  // 当月单价/租金：未传则保留原 custom（无 custom 则用房间预设）
  const parsePrice = (val, oldCustom, roomDefault) => {
    if (val === '' || val === undefined) return oldCustom ?? null; // 未传=保留原 custom
    if (val === null) return null;
    return Number(val);
  };
  const rentCustom = parsePrice(monthly_rent, rec.custom_monthly_rent, room.monthly_rent);
  const wupCustom = parsePrice(water_unit_price, rec.custom_water_unit_price, room.water_unit_price);
  const eupCustom = parsePrice(electricity_unit_price, rec.custom_electricity_unit_price, room.electricity_unit_price);
  // 生效值：custom 非 null 用 custom，否则用房间预设
  const rent = rentCustom !== null ? rentCustom : room.monthly_rent;
  const wup = wupCustom !== null ? wupCustom : room.water_unit_price;
  const eup = eupCustom !== null ? eupCustom : room.electricity_unit_price;

  const calcRoom = { ...room, monthly_rent: rent, water_unit_price: wup, electricity_unit_price: eup };
  const calc = calcRecord(calcRoom, {
    water_reading: wr,
    electricity_reading: er,
    prev_water_reading: pw,
    prev_electricity_reading: pe,
  });

  db.prepare(`
    UPDATE monthly_records SET
      water_reading=?, electricity_reading=?,
      prev_water_reading=?, prev_electricity_reading=?,
      prev_water_custom=?, prev_electricity_custom=?,
      custom_monthly_rent=?, custom_water_unit_price=?, custom_electricity_unit_price=?,
      water_usage=?, electricity_usage=?,
      water_fee=?, electricity_fee=?, rent=?, total=?,
      updated_at=datetime('now','localtime')
    WHERE id=?
  `).run(wr, er, pw, pe, pwCustom, peCustom,
    rentCustom, wupCustom, eupCustom,
    calc.waterUsage, calc.elecUsage, calc.waterFee, calc.elecFee, calc.rent, calc.total, id);

  res.json({ ok: true, calc, prev_water_reading: pw, prev_electricity_reading: pe, rent: calc.rent });
});

// 删除整个年月的存档（及其草稿记录）
router.delete('/history/:year/:month', (req, res) => {
  const { year, month } = req.params;
  const info = db.prepare(`DELETE FROM monthly_records WHERE year=? AND month=?`).run(year, month);
  res.json({ ok: true, deleted: info.changes });
});

export default router;
