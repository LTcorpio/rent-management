import { useEffect, useState, useRef, useCallback } from 'react';
import { api } from '../api.js';
import { money, num, buildCopyText, copyText, showToast, currentYM, yearOptions } from '../utils.js';
import MonthPicker from '../MonthPicker.jsx';

// 当月收租：一屏一间房的引导式抄表。
// 长辈端（isAdmin=false）只填两个本期读数，上期读数只读展示，
// 不含改价/改上期/存档按钮；管理员端额外显示这些管理功能。
export default function CurrentMonth({ isAdmin = false }) {
  const { year: cy, month: cm } = currentYM();
  const [year, setYear] = useState(cy);
  const [month, setMonth] = useState(cm);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [index, setIndex] = useState(0);
  const [copiedId, setCopiedId] = useState(null);
  const [archiving, setArchiving] = useState(false);
  const [archivedMonths, setArchivedMonths] = useState(() => new Set());
  // 归档列表就绪前不加载数据：否则会先按当前月拉一次，再闪切到次月
  const [archivedReady, setArchivedReady] = useState(false);
  const saveTimers = useRef({});
  const dataRef = useRef(null);
  useEffect(() => { dataRef.current = data; }, [data]);

  // 加载已存档年月列表（用于在 MonthPicker 中禁用已存档月份），并据此决定初始月份：
  // 默认显示当前月；若当前月已归档（数据已锁定为只读），顺延到下一个未归档月份，
  // 避免一进页面就是不能再抄表的过去月份。跨年自动进位。
  useEffect(() => {
    api.getHistory().then((rows) => {
      const set = new Set(rows.map((r) => `${r.year}-${r.month}`));
      let y = cy;
      let m = cm;
      for (let i = 0; i < 36 && set.has(`${y}-${m}`); i++) {
        if (m === 12) { y += 1; m = 1; } else { m += 1; }
      }
      setArchivedMonths(set);
      if (y !== cy || m !== cm) { setYear(y); setMonth(m); }
      setArchivedReady(true);
    }).catch(() => setArchivedReady(true));
  }, []); // eslint-disable-line

  const load = useCallback(async () => {
    if (!archivedReady) return;
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
      setIndex(0);
    } catch (e) {
      showToast('加载失败: ' + e.message);
    } finally {
      setLoading(false);
    }
  }, [year, month, archivedReady]); // eslint-disable-line

  useEffect(() => { load(); }, [load]);

  // 输入即时更新本地 + 防抖保存
  // field 支持：water_reading / electricity_reading / prev_water / prev_elec / rent / water_price / elec_price
  const handleInput = (roomId, field, value, reset = false) => {
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
            if (reset) {
              // 「恢复默认」：清掉自定义，回到房间的默认上期读数
              updated[customKey] = null;
              updated[prevKey] = isWater ? item.default_prev_water : item.default_prev_elec;
            } else {
              // 清空输入框按 0 记；不能回落成默认读数，否则退格删到最后一个数字时会弹回原值
              const n = value === '' || value === null ? 0 : Number(value);
              updated[customKey] = n;
              updated[prevKey] = n;
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
    handleInput(roomId, type === 'water' ? 'prev_water' : 'prev_elec', '', true);
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

  // 按楼层顺序摊平成一条房间队列，逐间展示
  const rooms = data?.grouped
    ? Object.entries(data.grouped).flatMap(([floor, arr]) => arr.map((it) => ({ ...it, floor })))
    : [];
  const total = rooms.length;
  const safeIndex = total ? Math.min(Math.max(index, 0), total - 1) : 0;
  const current = rooms[safeIndex];
  const archived = total > 0 && rooms.every((i) => i.archived === 1);
  const hasAnyInput = rooms.some((i) => i.calc?.hasInput);

  const goPrev = () => setIndex((v) => Math.max(0, v - 1));
  const goNext = () => setIndex((v) => Math.min(total - 1, v + 1));

  return (
    <div className="page">
      {/* 标题已由顶部「当月」切换器表达，此处不再重复标题行，把高度留给房间内容 */}
      {/* extra 只在已存档时给：能进到本页的月份本来都是未存档的，不必再标「未存档」 */}
      <MonthPicker
        year={year}
        month={month}
        years={yearOptions()}
        onChange={(y, m) => { setYear(y); setMonth(m); }}
        archivedMonths={archivedMonths}
        extra={archived ? <span className="archived-tag">已存档</span> : null}
        collapsible
      />

      {/* 内容区：切换年月时遮罩 + 加载动画，保留 MonthPicker 可见 */}
      <div className="report-content-wrap cm-wrap">
        {data && (
          <div className={'report-content' + (loading ? ' masked' : '')}>
            {archived ? (
              <div className="empty">该月已存档，不再显示明细。可在「历史」查看或修改存档数据。</div>
            ) : total === 0 ? (
              <div className="empty">暂无房间，请到设置中添加</div>
            ) : (
              <RoomPanel
                key={current.room_id}
                item={current}
                index={safeIndex}
                total={total}
                isAdmin={isAdmin}
                month={month}
                onInput={handleInput}
                onResetPrev={handleResetPrev}
                onResetPrice={handleResetPrice}
                onCopy={handleCopy}
                onException={handleException}
                copied={copiedId === current.room_id}
              />
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

      {isAdmin && !archived && total > 0 && (
        <div className="archive-bar">
          <button onClick={handleArchive} disabled={archiving || !hasAnyInput}>
            {archiving ? '存档中…' : `保存并上传 ${year}年${month}月 数据`}
          </button>
        </div>
      )}

      {/* 翻页条固定在底部，不随内容滚动，避免一屏放不下时还要滑到底部才能翻间 */}
      {!archived && total > 0 && (
        <div className="step-nav">
          <button className="step-btn" onClick={goPrev} disabled={safeIndex === 0}>← 上一间</button>
          <button className="step-btn primary" onClick={goNext} disabled={safeIndex >= total - 1}>下一间 →</button>
        </div>
      )}
    </div>
  );
}

// 单间房面板：一屏一间，水表 / 电表上下分块；翻页条由外层固定渲染
function RoomPanel({
  item, index, total, isAdmin, month,
  onInput, onResetPrev, onResetPrice, onCopy, onException, copied,
}) {
  const { room, calc, tenant } = item;
  const [showPrice, setShowPrice] = useState(false);
  // 长辈端：上期读数默认只读，点「改」才展开输入行，避免误触改错基准读数
  const [showPrev, setShowPrev] = useState({ water: false, elec: false });
  // 输入框正在编辑的原始文本。state 里的值可能是数字（清空后会被记成 0 或 null），
  // 直接拿来当 value 会让退格删不干净；这里先存用户的原文，失焦后再交还给 state。
  const [draft, setDraft] = useState({});
  const shown = (k, committed) =>
    draft[k] !== undefined ? draft[k] : (committed === null || committed === undefined ? '' : String(committed));
  const editNum = (k, field, raw) => {
    setDraft((d) => ({ ...d, [k]: raw }));
    onInput(item.room_id, field, raw);
  };
  const endEdit = (k) => setDraft((d) => {
    const next = { ...d };
    delete next[k];
    return next;
  });

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

  const filled = (v) => v !== null && v !== undefined && v !== '';
  // 引导：先填水表，再填电表
  const nextField = !filled(item.water_reading) ? 'water' : !filled(item.electricity_reading) ? 'elec' : null;

  return (
    <div className="room-card">
      {/* 房间号 / 租客 / 进度 / 异常合并成一行，省下三行高度 */}
      <div className="room-head">
        <span className="room-no">{room.room_number}</span>
        {tenant ? (
          <span className="tenant-name">{tenant.name}{tenant.occupants ? ` · ${tenant.occupants}人` : ''}</span>
        ) : isAdmin ? (
          // 长辈端不显示「未设置租客」，避免误以为要自己去补；只在管理员端提示
          <span className="tenant-name no-tenant">未设置租客</span>
        ) : null}
        <span className="progress-text">第{index + 1}/{total}间</span>
        <button
          className={'exc-btn' + (hasException ? ' active' : '')}
          onClick={() => onException(item)}
          title="标记异常项"
        >
          {hasException ? '⚠ 异常' : '标记异常'}
        </button>
      </div>
      {hasException && <div className="exc-note">⚠ {item.exception_note}</div>}

      {/* 租金 / 单价：长辈端与管理员端都可见可改，编辑框默认收起，点「改价」才展开 */}
      <div className="room-meta">
        <span><b>租金</b> {money(effRent)}元/月{rentCustom && <i className="custom-flag">自定义</i>}</span>
        <span><b>水</b> {num(effWup)}元/吨{wupCustom && <i className="custom-flag">自定义</i>}</span>
        <span><b>电</b> {num(effEup)}元/度{eupCustom && <i className="custom-flag">自定义</i>}</span>
        <button className="link-btn toggle-price-btn" onClick={() => setShowPrice((v) => !v)}>
          {showPrice ? '收起' : '改价'}
        </button>
      </div>

      {showPrice && (
        <div className="price-edit">
          <div className="row-3">
            <div className="field">
              <label>月租金（元）</label>
              <input type="number" inputMode="decimal" step="1" value={shown('rent', rentCustom ? item.custom_monthly_rent : null)} onChange={(e) => editNum('rent', 'rent', e.target.value)} onBlur={() => endEdit('rent')} placeholder={num(room.monthly_rent)} />
            </div>
            <div className="field">
              <label>水单价（元/吨）</label>
              <input type="number" inputMode="decimal" step="1" value={shown('wup', wupCustom ? item.custom_water_unit_price : null)} onChange={(e) => editNum('wup', 'water_price', e.target.value)} onBlur={() => endEdit('wup')} placeholder={num(room.water_unit_price)} />
            </div>
            <div className="field">
              <label>电单价（元/度）</label>
              <input type="number" inputMode="decimal" step="1" value={shown('eup', eupCustom ? item.custom_electricity_unit_price : null)} onChange={(e) => editNum('eup', 'elec_price', e.target.value)} onBlur={() => endEdit('eup')} placeholder={num(room.electricity_unit_price)} />
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

      {/* 水表 */}
      <div className={'field-block' + (nextField === 'water' ? ' next' : '')}>
        <div className="fb-head">
          <span className="fb-label">水表读数（吨）</span>
          {nextField === 'water' && <span className="fb-flag">填这里</span>}
        </div>
        <div className="fb-input-wrap">
          <input
            className={'fb-input' + (isAdmin ? '' : ' has-prev')}
            type="number"
            inputMode="decimal"
            step="1"
            value={shown('water', item.water_reading)}
            onChange={(e) => editNum('water', 'water_reading', e.target.value)}
            onBlur={() => endEdit('water')}
            placeholder={`${room.room_number}水表读数`}
          />
          {/* 长辈端：上期示数贴在编辑框最右侧，与本期读数同框对照；整块可点开修正 */}
          {!isAdmin && (
            <button
              type="button"
              className={'prev-chip prev-chip-btn' + (showPrev.water ? ' open' : '')}
              onClick={() => setShowPrev((v) => ({ ...v, water: !v.water }))}
            >
              <span className="prev-stack">
                <i className="prev-cap">上期</i>
                <b className="prev-num">{num(item.prev_water_reading ?? 0)}</b>
              </span>
              <i className="prev-edit">{showPrev.water ? '收起' : '改'}</i>
            </button>
          )}
        </div>
        {(isAdmin || showPrev.water) && (
          <div className="prev-row">
            <span className="prev-label">上期</span>
            <input
              className="prev-input"
              type="number"
              inputMode="decimal"
              step="1"
              value={shown('prevWater', item.prev_water_reading)}
              onChange={(e) => editNum('prevWater', 'prev_water', e.target.value)}
              onBlur={() => endEdit('prevWater')}
              placeholder="0"
            />
            <span className="prev-unit">吨</span>
            {waterCustom && (
              <button className="reset-prev-btn" onClick={() => onResetPrev(item.room_id, 'water')}>恢复默认</button>
            )}
          </div>
        )}
      </div>

      {/* 电表 */}
      <div className={'field-block' + (nextField === 'elec' ? ' next' : '')}>
        <div className="fb-head">
          <span className="fb-label">电表读数（度）</span>
          {nextField === 'elec' && <span className="fb-flag">填这里</span>}
        </div>
        <div className="fb-input-wrap">
          <input
            className={'fb-input' + (isAdmin ? '' : ' has-prev')}
            type="number"
            inputMode="decimal"
            step="1"
            value={shown('elec', item.electricity_reading)}
            onChange={(e) => editNum('elec', 'electricity_reading', e.target.value)}
            onBlur={() => endEdit('elec')}
            placeholder={`${room.room_number}电表读数`}
          />
          {!isAdmin && (
            <button
              type="button"
              className={'prev-chip prev-chip-btn' + (showPrev.elec ? ' open' : '')}
              onClick={() => setShowPrev((v) => ({ ...v, elec: !v.elec }))}
            >
              <span className="prev-stack">
                <i className="prev-cap">上期</i>
                <b className="prev-num">{num(item.prev_electricity_reading ?? 0)}</b>
              </span>
              <i className="prev-edit">{showPrev.elec ? '收起' : '改'}</i>
            </button>
          )}
        </div>
        {(isAdmin || showPrev.elec) && (
          <div className="prev-row">
            <span className="prev-label">上期</span>
            <input
              className="prev-input"
              type="number"
              inputMode="decimal"
              step="1"
              value={shown('prevElec', item.prev_electricity_reading)}
              onChange={(e) => editNum('prevElec', 'prev_elec', e.target.value)}
              onBlur={() => endEdit('prevElec')}
              placeholder="0"
            />
            <span className="prev-unit">度</span>
            {elecCustom && (
              <button className="reset-prev-btn" onClick={() => onResetPrev(item.room_id, 'elec')}>恢复默认</button>
            )}
          </div>
        )}
      </div>

      {calc?.hasInput && (
        <div className="result">
          {/* 两栏：左侧水/电/房租各自独占一行，右侧单独一栏显示总计 */}
          <div className="result-main">
            <div className="result-rows">
              <div className="result-row water">
                <span>水 {num(calc.waterUsage)} 吨</span>
                <b>{money(calc.waterFee)}<i>元</i></b>
              </div>
              <div className="result-row elec">
                <span>电 {num(calc.elecUsage)} 度</span>
                <b>{money(calc.elecFee)}<i>元</i></b>
              </div>
              <div className="result-row rent">
                <span>房租</span>
                <b>{money(calc.rent)}<i>元</i></b>
              </div>
            </div>
            <div className="result-grand">
              <span className="rg-label">共计</span>
              <b className="rg-val">{money(calc.total)}<i>元</i></b>
            </div>
          </div>
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
