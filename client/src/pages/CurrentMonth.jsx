import { useEffect, useState, useRef, useCallback } from 'react';
import { api } from '../api.js';
import { money, num, buildCopyText, copyText, showToast, currentYM, monthOptions, yearOptions } from '../utils.js';

export default function CurrentMonth() {
  const { year: cy, month: cm } = currentYM();
  const [year, setYear] = useState(cy);
  const [month, setMonth] = useState(cm);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [floors, setFloors] = useState([]);
  const [activeFloor, setActiveFloor] = useState('');
  const [copiedId, setCopiedId] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const saveTimers = useRef({});
  const dataRef = useRef(null);
  useEffect(() => { dataRef.current = data; }, [data]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getMonth(year, month);
      setData(res);
      const fs = Object.keys(res.grouped);
      setFloors(fs);
      if (fs.length && !fs.includes(activeFloor)) setActiveFloor(fs[0]);
    } catch (e) {
      showToast('加载失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [year, month]); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  // 输入即时更新本地 + 防抖保存
  const handleInput = (roomId, field, value) => {
    setData((prev) => {
      if (!prev) return prev;
      const grouped = { ...prev.grouped };
      for (const f of Object.keys(grouped)) {
        grouped[f] = grouped[f].map((item) => {
          if (item.room_id !== roomId) return item;
          const room = item.room;
          const newReading = {
            ...item,
            [field]: value === '' ? null : Number(value),
          };
          const draft = {
            water_reading: newReading.water_reading,
            electricity_reading: newReading.electricity_reading,
            prev_water_reading: newReading.prev_water_reading,
            prev_electricity_reading: newReading.prev_electricity_reading,
          };
          const calc = calcLocal(room, draft);
          return { ...newReading, calc };
        });
      }
      return { ...prev, grouped };
    });

    // 防抖保存：从最新状态读取两个读数
    clearTimeout(saveTimers.current[roomId]);
    saveTimers.current[roomId] = setTimeout(async () => {
      try {
        const item = findItem(dataRef.current, roomId);
        await api.saveRecord({
          room_id: roomId, year, month,
          water_reading: item?.water_reading ?? null,
          electricity_reading: item?.electricity_reading ?? null,
        });
      } catch (err) {
        showToast('保存失败: ' + err.message);
      }
    }, 500);
  };

  const handleCopy = async (item) => {
    const text = buildCopyText({
      roomNumber: item.room.room_number,
      month,
      tenantName: item.tenant?.name,
      calc: item.calc,
    });
    const ok = await copyText(text);
    if (ok) {
      setCopiedId(item.room_id);
      showToast('已复制');
      setTimeout(() => setCopiedId(null), 1500);
    } else {
      showToast('复制失败，请手动选择文本');
    }
  };

  const handleArchive = async () => {
    if (!window.confirm(`确认将 ${year}年${month}月 的数据保存上传到服务端？\n上传后该月数据将存档，可在历史中查看。`)) return;
    setArchiving(true);
    try {
      await api.archiveMonth(year, month);
      showToast('已存档上传');
      await load();
    } catch (e) {
      showToast('存档失败: ' + e.message);
    } finally {
      setArchiving(false);
    }
  };

  if (loading) return <div className="loading">加载中…</div>;
  if (!data) return <div className="empty">暂无房间，请到设置中添加</div>;

  const items = data.grouped[activeFloor] || [];
  const allItems = Object.values(data.grouped).flat();
  const archived = allItems.length > 0 && allItems.every((i) => i.archived === 1);
  const hasAnyInput = allItems.some((i) => i.calc?.hasInput);

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">当月收租</h1>
        <div className="page-sub">输入抄表读数，自动计算房租，复制后发给租客</div>
      </div>

      <div className="page">
        <div className="month-bar tight">
          <select value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {yearOptions(5).map((y) => <option key={y} value={y}>{y}年</option>)}
          </select>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}>
            {monthOptions().map((m) => <option key={m} value={m}>{m}月</option>)}
          </select>
          {archived ? <span className="archived-tag">已存档</span> : <span className="draft-tag">未存档</span>}
        </div>

        {floors.length > 0 && (
          <div className="floor-tabs">
            {floors.map((f) => (
              <button key={f} className={activeFloor === f ? 'active' : ''} onClick={() => setActiveFloor(f)}>{f}</button>
            ))}
          </div>
        )}

        {items.map((item) => (
          <RoomCard key={item.room_id} item={item} onInput={handleInput} onCopy={handleCopy} copied={copiedId === item.room_id} archived={archived} />
        ))}

        {!archived && (
          <div className="archive-bar">
            <button onClick={handleArchive} disabled={archiving || !hasAnyInput}>
              {archiving ? '存档中…' : `保存并上传 ${year}年${month}月 数据`}
            </button>
          </div>
        )}
        {archived && <div className="empty">该月已存档，可在「历史」查看；如需修改请到历史页编辑</div>}
      </div>
    </>
  );
}

function RoomCard({ item, onInput, onCopy, copied, archived }) {
  const { room, calc, tenant } = item;
  return (
    <div className="room-card">
      <div className="room-head">
        <span className="room-no">{room.room_number}</span>
        {tenant ? <span className="tenant-name">{tenant.name}{tenant.occupants ? ` · ${tenant.occupants}人` : ''}</span> : <span className="tenant-name no-tenant">未设置租客</span>}
      </div>
      <div className="room-meta">
        <span><b>租金</b> {money(room.monthly_rent)}元/月</span>
        <span><b>水</b> {num(room.water_unit_price)}元/吨</span>
        <span><b>电</b> {num(room.electricity_unit_price)}元/度</span>
        <span><b>启用</b> {room.start_date || '—'}</span>
      </div>

      <div className="input-grid">
        <div className="input-cell">
          <label>水表读数（吨）</label>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={item.water_reading ?? ''}
            onChange={(e) => onInput(item.room_id, 'water_reading', e.target.value)}
            disabled={archived}
            placeholder="水表抄表"
          />
          <div className="prev">上期 {num(item.prev_water_reading)}</div>
        </div>
        <div className="input-cell">
          <label>电表读数（度）</label>
          <input
            type="number"
            inputMode="decimal"
            step="0.01"
            value={item.electricity_reading ?? ''}
            onChange={(e) => onInput(item.room_id, 'electricity_reading', e.target.value)}
            disabled={archived}
            placeholder="电表抄表"
          />
          <div className="prev">上期 {num(item.prev_electricity_reading)}</div>
        </div>
      </div>

      {calc?.hasInput && (
        <div className="result">
          <div className="result-row water"><span>用水 {num(calc.waterUsage)} 吨</span><span className="val">{money(calc.waterFee)} 元</span></div>
          <div className="result-row elec"><span>用电 {num(calc.elecUsage)} 度</span><span className="val">{money(calc.elecFee)} 元</span></div>
          <div className="result-row rent"><span>房租</span><span className="val">{money(calc.rent)} 元</span></div>
          <div className="result-row total"><span>共计</span><span className="val">{money(calc.total)} 元</span></div>
          <button className={'copy-btn' + (copied ? ' done' : '')} onClick={() => onCopy(item)}>
            {copied ? '✓ 已复制' : '复制房租信息'}
          </button>
          <div className="copy-preview">
            {buildCopyText({ roomNumber: room.room_number, month: item.month, tenantName: tenant?.name, calc })}
          </div>
        </div>
      )}
    </div>
  );
}

// 本地计算（与后端 calcRecord 一致），用于即时反馈
function calcLocal(room, rec) {
  const wr = rec.water_reading === null || rec.water_reading === undefined || rec.water_reading === '' ? null : Number(rec.water_reading);
  const er = rec.electricity_reading === null || rec.electricity_reading === undefined || rec.electricity_reading === '' ? null : Number(rec.electricity_reading);
  const pw = Number(rec.prev_water_reading) || 0;
  const pe = Number(rec.prev_electricity_reading) || 0;
  const r2 = (n) => (n === null ? null : Math.round((n + Number.EPSILON) * 100) / 100);
  const waterUsage = wr !== null ? r2(wr - pw) : null;
  const elecUsage = er !== null ? r2(er - pe) : null;
  const waterFee = waterUsage !== null ? r2(waterUsage * Number(room.water_unit_price)) : null;
  const elecFee = elecUsage !== null ? r2(elecUsage * Number(room.electricity_unit_price)) : null;
  const rent = Number(room.monthly_rent) || 0;
  const total = waterFee !== null && elecFee !== null ? r2(waterFee + elecFee + rent) : null;
  return { hasInput: wr !== null || er !== null, waterUsage, elecUsage, waterFee, elecFee, rent, total };
}

function findItem(data, roomId) {
  if (!data) return null;
  for (const f of Object.values(data.grouped)) {
    for (const it of f) if (it.room_id === roomId) return it;
  }
  return null;
}
