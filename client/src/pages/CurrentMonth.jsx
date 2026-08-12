import { useEffect, useState, useRef, useCallback } from 'react';
import { api } from '../api.js';
import { money, num, buildCopyText, copyText, showToast, currentYM, yearOptions } from '../utils.js';
import MonthPicker from '../MonthPicker.jsx';

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
  const [archivedMonths, setArchivedMonths] = useState(() => new Set());
  const saveTimers = useRef({});
  const dataRef = useRef(null);
  useEffect(() => { dataRef.current = data; }, [data]);

  // 加载已存档年月列表（用于在 MonthPicker 中禁用已存档月份）
  useEffect(() => {
    api.getHistory().then((rows) => {
      setArchivedMonths(new Set(rows.map((r) => `${r.year}-${r.month}`)));
    }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getMonth(year, month);
      // 重新用本地 calc 规则计算（单项空=0，两项空=hasInput false）
      const grouped = {};
      for (const f of Object.keys(res.grouped)) {
        grouped[f] = res.grouped[f].map((item) => {
          const calcRoom = mergeCustomRoom(item.room, item);
          const draft = {
            water_reading: item.water_reading,
            electricity_reading: item.electricity_reading,
            prev_water_reading: item.prev_water_reading,
            prev_electricity_reading: item.prev_electricity_reading,
          };
          return { ...item, calc: calcLocal(calcRoom, draft) };
        });
      }
      setData({ ...res, grouped });
      const fs = Object.keys(grouped);
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
  // field 支持：water_reading / electricity_reading / prev_water / prev_elec / rent / water_price / elec_price
  const handleInput = (roomId, field, value) => {
    setData((prev) => {
      if (!prev) return prev;
      const grouped = { ...prev.grouped };
      for (const f of Object.keys(grouped)) {
        grouped[f] = grouped[f].map((item) => {
          if (item.room_id !== roomId) return item;
          const updated = { ...item };
          if (field === 'prev_water' || field === 'prev_elec') {
            // 编辑上期：写入 custom，同步生效的 prev
            const isWater = field === 'prev_water';
            const customKey = isWater ? 'prev_water_custom' : 'prev_electricity_custom';
            const prevKey = isWater ? 'prev_water_reading' : 'prev_electricity_reading';
            if (value === '' || value === null) {
              updated[customKey] = null;
              updated[prevKey] = isWater ? item.default_prev_water : item.default_prev_elec;
            } else {
              updated[customKey] = Number(value);
              updated[prevKey] = Number(value);
            }
          } else if (field === 'rent' || field === 'water_price' || field === 'elec_price') {
            // 当月覆盖租金/单价：写 custom，空=恢复预设
            const keyMap = { rent: 'custom_monthly_rent', water_price: 'custom_water_unit_price', elec_price: 'custom_electricity_unit_price' };
            updated[keyMap[field]] = value === '' || value === null ? null : Number(value);
          } else {
            updated[field] = value === '' ? null : Number(value);
          }
          // 合并 custom 值到 room 用于计算
          const calcRoom = mergeCustomRoom(item.room, updated);
          const draft = {
            water_reading: updated.water_reading,
            electricity_reading: updated.electricity_reading,
            prev_water_reading: updated.prev_water_reading,
            prev_electricity_reading: updated.prev_electricity_reading,
          };
          const calc = calcLocal(calcRoom, draft);
          return { ...updated, calc };
        });
      }
      return { ...prev, grouped };
    });

    // 防抖保存
    clearTimeout(saveTimers.current[roomId]);
    saveTimers.current[roomId] = setTimeout(async () => {
      try {
        const item = findItem(dataRef.current, roomId);
        await api.saveRecord({
          room_id: roomId, year, month,
          water_reading: item?.water_reading ?? null,
          electricity_reading: item?.electricity_reading ?? null,
          prev_water_custom: item?.prev_water_custom,
          prev_electricity_custom: item?.prev_electricity_custom,
          custom_monthly_rent: item?.custom_monthly_rent,
          custom_water_unit_price: item?.custom_water_unit_price,
          custom_electricity_unit_price: item?.custom_electricity_unit_price,
        });
      } catch (err) {
        showToast('保存失败: ' + err.message);
      }
    }, 500);
  };

  // 恢复默认租金/单价
  const handleResetPrice = (roomId, type) => {
    handleInput(roomId, type, '');
  };

  // 恢复默认上期读数
  const handleResetPrev = (roomId, type) => {
    handleInput(roomId, type === 'water' ? 'prev_water' : 'prev_elec', '');
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
      setArchivedMonths((prev) => new Set(prev).add(`${year}-${month}`));
      await load();
    } catch (e) {
      showToast('存档失败: ' + e.message);
    } finally {
      setArchiving(false);
    }
  };

  // 标记/取消异常项
  const handleException = async (item) => {
    const cur = item.exception_note || '';
    const note = window.prompt('标记异常项（填写异常原因，留空或清除则取消标记）：', cur);
    if (note === null) return; // 取消输入
    try {
      await api.markException(item.id, note);
      setData((prev) => {
        if (!prev) return prev;
        const grouped = { ...prev.grouped };
        for (const f of Object.keys(grouped)) {
          grouped[f] = grouped[f].map((it) => it.id === item.id ? { ...it, exception_note: note === '' ? null : note } : it);
        }
        return { ...prev, grouped };
      });
      showToast(note === '' ? '已取消异常标记' : '已标记异常');
    } catch (e) { showToast('标记失败: ' + e.message); }
  };

  // 派生数据仅在 data 存在时计算
  const items = data?.grouped?.[activeFloor] || [];
  const allItems = data ? Object.values(data.grouped).flat() : [];
  const archived = data && allItems.length > 0 && allItems.every((i) => i.archived === 1);
  const hasAnyInput = allItems.some((i) => i.calc?.hasInput);

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">当月收租</h1>
        <div className="page-sub">输入抄表读数，自动计算房租</div>
      </div>

      <div className="page">
        <MonthPicker
          year={year}
          month={month}
          years={yearOptions()}
          onChange={(y, m) => { setYear(y); setMonth(m); }}
          archivedMonths={archivedMonths}
          extra={archived ? <span className="archived-tag">已存档</span> : <span className="draft-tag">未存档</span>}
        />

        {/* 内容区：切换年月时遮罩 + 加载动画，保留 MonthPicker 可见 */}
        <div className="report-content-wrap">
          {data && (
            <div className={'report-content' + (loading ? ' masked' : '')}>
              {floors.length > 0 && !archived && (
                <div className="floor-tabs">
                  {floors.map((f) => (
                    <button key={f} className={activeFloor === f ? 'active' : ''} onClick={() => setActiveFloor(f)}>{f}</button>
                  ))}
                </div>
              )}

              {archived ? (
                <div className="empty">该月已存档，不再显示明细。可在「历史」查看或修改存档数据。</div>
              ) : (
                <>
                  {items.map((item) => (
                    <RoomCard key={item.room_id} item={item} onInput={handleInput} onResetPrev={handleResetPrev} onResetPrice={handleResetPrice} onCopy={handleCopy} onException={handleException} copied={copiedId === item.room_id} archived={archived} />
                  ))}

                  <div className="archive-bar">
                    <button onClick={handleArchive} disabled={archiving || !hasAnyInput}>
                      {archiving ? '存档中…' : `保存并上传 ${year}年${month}月 数据`}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* 加载遮罩：覆盖在内容区上方 */}
          {loading && (
            <div className="loading-overlay">
              <div className="spinner" />
              <span>加载中…</span>
            </div>
          )}

          {/* 首次加载且无数据 */}
          {!loading && !data && <div className="empty">暂无房间，请到设置中添加</div>}
        </div>
      </div>
    </>
  );
}

function RoomCard({ item, onInput, onResetPrev, onResetPrice, onCopy, onException, copied, archived }) {
  const { room, calc, tenant } = item;
  const waterCustom = item.prev_water_custom !== null && item.prev_water_custom !== undefined;
  const elecCustom = item.prev_electricity_custom !== null && item.prev_electricity_custom !== undefined;
  const rentCustom = item.custom_monthly_rent !== null && item.custom_monthly_rent !== undefined;
  const wupCustom = item.custom_water_unit_price !== null && item.custom_water_unit_price !== undefined;
  const eupCustom = item.custom_electricity_unit_price !== null && item.custom_electricity_unit_price !== undefined;
  const hasException = item.exception_note !== null && item.exception_note !== undefined && item.exception_note !== '';
  // 生效值（用于显示）
  const effRent = rentCustom ? item.custom_monthly_rent : room.monthly_rent;
  const effWup = wupCustom ? item.custom_water_unit_price : room.water_unit_price;
  const effEup = eupCustom ? item.custom_electricity_unit_price : room.electricity_unit_price;
  const [showPrice, setShowPrice] = useState(false);
  return (
    <div className="room-card">
      <div className="room-head">
        <span className="room-no">{room.room_number}</span>
        {tenant ? <span className="tenant-name">{tenant.name}{tenant.occupants ? ` · ${tenant.occupants}人` : ''}</span> : <span className="tenant-name no-tenant">未设置租客</span>}
        <button
          className={'exc-btn' + (hasException ? ' active' : '')}
          onClick={() => onException(item)}
          title="标记异常项"
        >
          {hasException ? '⚠ 异常' : '标记异常'}
        </button>
      </div>
      {hasException && <div className="exc-note">⚠ {item.exception_note}</div>}
      <div className="room-meta">
        <span><b>租金</b> {money(effRent)}元/月{rentCustom && <i className="custom-flag">自定义</i>}</span>
        <span><b>水</b> {num(effWup)}元/吨{wupCustom && <i className="custom-flag">自定义</i>}</span>
        <span><b>电</b> {num(effEup)}元/度{eupCustom && <i className="custom-flag">自定义</i>}</span>
        {!archived && (
          <button className="link-btn toggle-price-btn" onClick={() => setShowPrice((v) => !v)}>
            {showPrice ? '收起' : '改价'}
          </button>
        )}
      </div>

      {showPrice && !archived && (
        <div className="price-edit">
          <div className="row-3">
            <div className="field">
              <label>月租金（元）</label>
              <input type="number" inputMode="decimal" step="1" value={rentCustom ? item.custom_monthly_rent : ''} onChange={(e) => onInput(item.room_id, 'rent', e.target.value)} placeholder={num(room.monthly_rent)} />
            </div>
            <div className="field">
              <label>水单价（元/吨）</label>
              <input type="number" inputMode="decimal" step="1" value={wupCustom ? item.custom_water_unit_price : ''} onChange={(e) => onInput(item.room_id, 'water_price', e.target.value)} placeholder={num(room.water_unit_price)} />
            </div>
            <div className="field">
              <label>电单价（元/度）</label>
              <input type="number" inputMode="decimal" step="1" value={eupCustom ? item.custom_electricity_unit_price : ''} onChange={(e) => onInput(item.room_id, 'elec_price', e.target.value)} placeholder={num(room.electricity_unit_price)} />
            </div>
          </div>
          {(rentCustom || wupCustom || eupCustom) && (
            <button className="reset-prev-btn" onClick={() => { setShowPrice(false); if (rentCustom) onResetPrice(item.room_id, 'rent'); if (wupCustom) onResetPrice(item.room_id, 'water_price'); if (eupCustom) onResetPrice(item.room_id, 'elec_price'); }}>
              恢复预设
            </button>
          )}
          <div className="price-edit-hint">留空使用房间预设；输入后仅当月生效，不影响其他月份</div>
        </div>
      )}

      <div className="input-grid">
        <div className="input-cell">
          <label>水表读数（吨）</label>
          <input
            type="number"
            inputMode="decimal"
            step="1"
            value={item.water_reading ?? ''}
            onChange={(e) => onInput(item.room_id, 'water_reading', e.target.value)}
            disabled={archived}
            placeholder="水表抄表"
          />
          <div className="prev-row">
            <span className="prev-label">上期</span>
            <input
              type="number"
              inputMode="decimal"
              step="1"
              className="prev-input"
              value={item.prev_water_reading ?? ''}
              onChange={(e) => onInput(item.room_id, 'prev_water', e.target.value)}
              disabled={archived}
              placeholder="0"
            />
            {waterCustom && !archived && (
              <button className="reset-prev-btn" onClick={() => onResetPrev(item.room_id, 'water')}>恢复默认</button>
            )}
          </div>
        </div>
        <div className="input-cell">
          <label>电表读数（度）</label>
          <input
            type="number"
            inputMode="decimal"
            step="1"
            value={item.electricity_reading ?? ''}
            onChange={(e) => onInput(item.room_id, 'electricity_reading', e.target.value)}
            disabled={archived}
            placeholder="电表抄表"
          />
          <div className="prev-row">
            <span className="prev-label">上期</span>
            <input
              type="number"
              inputMode="decimal"
              step="1"
              className="prev-input"
              value={item.prev_electricity_reading ?? ''}
              onChange={(e) => onInput(item.room_id, 'prev_elec', e.target.value)}
              disabled={archived}
              placeholder="0"
            />
            {elecCustom && !archived && (
              <button className="reset-prev-btn" onClick={() => onResetPrev(item.room_id, 'elec')}>恢复默认</button>
            )}
          </div>
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

// 合并房间预设与当月覆盖值，用于本地计算
function mergeCustomRoom(room, item) {
  return {
    ...room,
    monthly_rent: item.custom_monthly_rent !== null && item.custom_monthly_rent !== undefined ? item.custom_monthly_rent : room.monthly_rent,
    water_unit_price: item.custom_water_unit_price !== null && item.custom_water_unit_price !== undefined ? item.custom_water_unit_price : room.water_unit_price,
    electricity_unit_price: item.custom_electricity_unit_price !== null && item.custom_electricity_unit_price !== undefined ? item.custom_electricity_unit_price : room.electricity_unit_price,
  };
}

// 本地计算（当月页专用规则）：单项空=按 0 计算，两项均空=hasInput false（外层不显示结果）
// hasWater/hasElec 标记是否实际输入，用于复制文本决定是否包含该行
function calcLocal(room, rec) {
  const wr = rec.water_reading === null || rec.water_reading === undefined || rec.water_reading === '' ? null : Number(rec.water_reading);
  const er = rec.electricity_reading === null || rec.electricity_reading === undefined || rec.electricity_reading === '' ? null : Number(rec.electricity_reading);
  const pw = Number(rec.prev_water_reading) || 0;
  const pe = Number(rec.prev_electricity_reading) || 0;
  const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const hasWater = wr !== null;
  const hasElec = er !== null;
  const waterUsage = hasWater ? r2(wr - pw) : 0;
  const elecUsage = hasElec ? r2(er - pe) : 0;
  const waterFee = r2(waterUsage * Number(room.water_unit_price));
  const elecFee = r2(elecUsage * Number(room.electricity_unit_price));
  const rent = Number(room.monthly_rent) || 0;
  const total = r2(waterFee + elecFee + rent);
  return { hasInput: hasWater || hasElec, hasWater, hasElec, waterUsage, elecUsage, waterFee, elecFee, rent, total };
}

function findItem(data, roomId) {
  if (!data) return null;
  for (const f of Object.values(data.grouped)) {
    for (const it of f) if (it.room_id === roomId) return it;
  }
  return null;
}
