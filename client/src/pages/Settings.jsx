import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { money, num, showToast } from '../utils.js';

export default function Settings() {
  const [grouped, setGrouped] = useState(null);
  const [activeFloor, setActiveFloor] = useState('');
  const [editing, setEditing] = useState(null); // room id being edited
  const [tenantRoom, setTenantRoom] = useState(null); // room id showing tenant panel

  const load = useCallback(async () => {
    try {
      const g = await api.getRooms();
      setGrouped(g);
      const fs = Object.keys(g);
      // 用函数式更新读取最新 activeFloor，避免闭包陈旧值导致保存后跳回一楼
      setActiveFloor((prev) => (fs.length && !fs.includes(prev) ? fs[0] : prev));
    } catch (e) { showToast('加载失败: ' + e.message); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const rooms = (grouped && grouped[activeFloor]) || [];

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">设置</h1>
        <div className="page-sub">管理房间预设与租客信息</div>
      </div>
      <div className="page">
        {grouped && Object.keys(grouped).length > 0 && (
          <div className="floor-tabs">
            {Object.keys(grouped).map((f) => (
              <button key={f} className={activeFloor === f ? 'active' : ''} onClick={() => setActiveFloor(f)}>{f}</button>
            ))}
          </div>
        )}

        {rooms.map((room) => (
          <div key={room.id} className="setting-card">
            <h3>{room.room_number} <span style={{ fontWeight: 400, color: '#9a9a9a', fontSize: 13 }}>{room.floor}</span></h3>
            <div className="room-meta" style={{ marginBottom: 8 }}>
              <span><b>租金</b> {money(room.monthly_rent)}</span>
              <span><b>水</b> {num(room.water_unit_price)}元/吨</span>
              <span><b>电</b> {num(room.electricity_unit_price)}元/度</span>
            </div>

            {editing === room.id ? (
              <RoomEditForm room={room} onDone={() => { setEditing(null); load(); }} onCancel={() => setEditing(null)} />
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button className="btn ghost sm" onClick={() => setEditing(room.id)}>编辑预设</button>
                  <button className="btn ghost sm" onClick={() => setTenantRoom(tenantRoom === room.id ? null : room.id)}>
                    {tenantRoom === room.id ? '收起租客' : '管理租客'}
                  </button>
                </div>
                {tenantRoom === room.id && <TenantPanel roomId={room.id} onChanged={load} />}
              </>
            )}
          </div>
        ))}

        <div className="setting-card">
          <h3>添加房间</h3>
          <RoomEditForm room={{ floor: activeFloor || '一楼', room_number: '', monthly_rent: 800, water_unit_price: 3, electricity_unit_price: 1 }} isNew onDone={load} onCancel={null} />
        </div>

        <div className="setting-card" style={{ fontSize: 12, color: '#9a9a9a', lineHeight: 1.7 }}>
          <b style={{ color: '#5a5a5a' }}>说明</b><br />
          · 房间预设首次启动从 server/config/rooms.config.json 导入，可在上方编辑或新增。<br />
          · 同一房间新增租客会自动将旧租客置为退租；月度记录会关联当月租客，便于租客流动时按租客归账。<br />
          · 抄表时「上期」读数自动取该房间最近一次记录，无记录则为 0，可在此基础上修改。<br />
          · 删除 data.db 可重置全部数据后重新从配置导入。
        </div>
      </div>
    </>
  );
}

function RoomEditForm({ room, isNew, onDone, onCancel }) {
  const [form, setForm] = useState(room);
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.room_number) return showToast('请填写房间号');
    if (!form.floor) return showToast('请选择楼层');
    setSaving(true);
    try {
      if (isNew) await api.addRoom(form);
      else await api.updateRoom(room.id, form);
      showToast('已保存');
      onDone();
    } catch (e) { showToast('保存失败: ' + e.message); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div className="row-2">
        <div className="field">
          <label>楼层</label>
          <select value={form.floor} onChange={(e) => set('floor', e.target.value)}>
            <option value="一楼">一楼</option>
            <option value="四五楼">四五楼</option>
          </select>
        </div>
        <div className="field">
          <label>房间号</label>
          <input value={form.room_number} onChange={(e) => set('room_number', e.target.value)} placeholder="如 101" />
        </div>
      </div>
      <div className="field">
        <label>月租金（元）</label>
        <input type="number" inputMode="decimal" value={form.monthly_rent} onChange={(e) => set('monthly_rent', Number(e.target.value))} />
      </div>
      <div className="row-2">
        <div className="field">
          <label>水费单价（元/吨）</label>
          <input type="number" inputMode="decimal" value={form.water_unit_price} onChange={(e) => set('water_unit_price', Number(e.target.value))} />
        </div>
        <div className="field">
          <label>电费单价（元/度）</label>
          <input type="number" inputMode="decimal" value={form.electricity_unit_price} onChange={(e) => set('electricity_unit_price', Number(e.target.value))} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn" onClick={submit} disabled={saving}>{saving ? '保存中…' : '保存'}</button>
        {onCancel && <button className="btn ghost" onClick={onCancel}>取消</button>}
      </div>
    </div>
  );
}

function TenantPanel({ roomId, onChanged }) {
  const [list, setList] = useState([]);
  const [name, setName] = useState('');
  const [idCard, setIdCard] = useState('');
  const [occupants, setOccupants] = useState(1);
  const [moveIn, setMoveIn] = useState(new Date().toISOString().slice(0, 10));
  const [adding, setAdding] = useState(false);

  const load = async () => {
    const rows = await api.getTenants(roomId);
    setList(rows);
  };
  useEffect(() => { load(); }, [roomId]); // eslint-disable-line

  const add = async () => {
    if (!name) return showToast('请填写户主姓名');
    setAdding(true);
    try {
      await api.addTenant({ room_id: roomId, name, id_card: idCard, occupants, move_in_date: moveIn });
      setName(''); setIdCard(''); setOccupants(1);
      showToast('已添加新租客');
      load(); onChanged();
    } catch (e) { showToast('添加失败: ' + e.message); }
    finally { setAdding(false); }
  };

  const moveout = async (id) => {
    if (!window.confirm('确认将该租客标记为退租？')) return;
    await api.moveoutTenant(id);
    load(); onChanged();
  };

  return (
    <div style={{ marginTop: 10, borderTop: '1px dashed #ececec', paddingTop: 8 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>租客记录</div>
      {list.length === 0 && <div style={{ fontSize: 12, color: '#9a9a9a' }}>暂无租客</div>}
      {list.map((t) => (
        <div key={t.id} className="tenant-row">
          <div>
            <div className="t-name">{t.name}</div>
            <div className="t-info">{t.occupants}人 · {t.id_card || '无身份证'} · 入住 {t.move_in_date || '—'}{t.move_out_date ? ` · 退租 ${t.move_out_date}` : ''}</div>
          </div>
          <span className={'badge ' + (t.is_current ? 'cur' : 'out')}>{t.is_current ? '当前' : '已退租'}</span>
          {t.is_current ? <button className="btn danger sm" onClick={() => moveout(t.id)}>退租</button> : null}
        </div>
      ))}

      <div style={{ marginTop: 10, fontSize: 13, fontWeight: 600 }}>新增租客（旧租客将自动退租）</div>
      <div className="row-2" style={{ marginTop: 6 }}>
        <div className="field"><label>户主姓名</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="姓名" /></div>
        <div className="field"><label>居住人数</label><input type="number" inputMode="numeric" value={occupants} onChange={(e) => setOccupants(Number(e.target.value))} /></div>
      </div>
      <div className="field"><label>身份证号（选填）</label><input value={idCard} onChange={(e) => setIdCard(e.target.value)} /></div>
      <div className="field"><label>入住日期</label><input type="date" value={moveIn} onChange={(e) => setMoveIn(e.target.value)} /></div>
      <button className="btn" onClick={add} disabled={adding} style={{ marginTop: 4 }}>{adding ? '添加中…' : '添加租客'}</button>
    </div>
  );
}
