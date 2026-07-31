import { Router } from 'express';
import db from '../db.js';

const router = Router();

// 某房间全部租客历史
router.get('/', (req, res) => {
  const { roomId } = req.query;
  if (roomId) {
    const rows = db.prepare(`SELECT * FROM tenants WHERE room_id=? ORDER BY is_current DESC, id DESC`).all(roomId);
    return res.json(rows);
  }
  const rows = db.prepare(`
    SELECT t.*, r.room_number, r.floor FROM tenants t
    JOIN rooms r ON r.id = t.room_id
    ORDER BY t.is_current DESC, t.id DESC
  `).all();
  res.json(rows);
});

// 新增租客（同一房间若已有 current 租客，将旧的置为退租）
router.post('/', (req, res) => {
  const { room_id, name, id_card, occupants = 1, move_in_date } = req.body;
  if (!room_id || !name) return res.status(400).json({ error: 'room_id 与 name 必填' });
  const tx = db.transaction(() => {
    db.prepare(`UPDATE tenants SET is_current=0, move_out_date=COALESCE(move_out_date, date('now','localtime')) WHERE room_id=? AND is_current=1`).run(room_id);
    const info = db.prepare(`
      INSERT INTO tenants (room_id, name, id_card, occupants, move_in_date, is_current)
      VALUES (?,?,?,?,?,1)
    `).run(room_id, name, id_card || null, occupants, move_in_date || null);
    return info.lastInsertRowid;
  });
  const id = tx();
  res.json({ id });
});

// 更新租客信息
router.put('/:id', (req, res) => {
  const { name, id_card, occupants, move_in_date, move_out_date, is_current } = req.body;
  db.prepare(`
    UPDATE tenants SET name=?, id_card=?, occupants=?, move_in_date=?, move_out_date=?, is_current=? WHERE id=?
  `).run(name, id_card, occupants, move_in_date, move_out_date, is_current ? 1 : 0, req.params.id);
  res.json({ ok: true });
});

// 退租
router.post('/:id/moveout', (req, res) => {
  const { move_out_date } = req.body;
  db.prepare(`UPDATE tenants SET is_current=0, move_out_date=? WHERE id=?`).run(move_out_date || new Date().toISOString().slice(0, 10), req.params.id);
  res.json({ ok: true });
});

export default router;
