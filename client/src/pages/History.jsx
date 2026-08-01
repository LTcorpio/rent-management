import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { money, num, buildCopyText, copyText, showToast } from '../utils.js';

export default function History() {
  const { year, month } = useParams();
  if (year && month) {
    return <HistoryDetail year={Number(year)} month={Number(month)} />;
  }
  return <HistoryList />;
}

function HistoryList() {
  const navigate = useNavigate();
  const [list, setList] = useState(null);
  const load = useCallback(async () => {
    try { setList(await api.getHistory()); }
    catch (e) { showToast('加载失败: ' + e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const handleDelete = async (year, month) => {
    if (!window.confirm(`确认删除 ${year}年${month}月 的整月存档？\n该操作不可恢复，将删除该月所有房间的记录。`)) return;
    try {
      await api.deleteHistoryMonth(year, month);
      showToast('已删除');
      load();
    } catch (e) { showToast('删除失败: ' + e.message); }
  };

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">历史存档</h1>
        <div className="page-sub">点击查看各月明细，可修改或删除存档</div>
      </div>
      <div className="page">
        {!list ? <div className="loading">加载中…</div> :
         list.length === 0 ? <div className="empty">暂无已存档月份<br />在「当月」页面保存上传后此处可查看</div> :
         list.map((r) => (
           <div key={`${r.year}-${r.month}`} className="history-item">
             <button className="history-item-main" onClick={() => navigate(`/history/${r.year}/${r.month}`)}>
               <div>
                 <div className="ym">{r.year} 年 {r.month} 月</div>
                 <div className="breakdown">水 {money(r.total_water)} · 电 {money(r.total_elec)} · 租 {money(r.total_rent)} · {r.valid_room_count}/{r.room_count} 间</div>
               </div>
               <div className="sum">{money(r.total_amount)}</div>
             </button>
             <button className="del-btn" onClick={() => handleDelete(r.year, r.month)} aria-label="删除">删除</button>
           </div>
         ))}
      </div>
    </>
  );
}

function HistoryDetail({ year, month }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [copiedId, setCopiedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editWater, setEditWater] = useState('');
  const [editElec, setEditElec] = useState('');
  const [editPrevWater, setEditPrevWater] = useState('');
  const [editPrevElec, setEditPrevElec] = useState('');
  const [editRent, setEditRent] = useState('');
  const [editWup, setEditWup] = useState('');
  const [editEup, setEditEup] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { setData(await api.getHistoryDetail(year, month)); }
    catch (e) { showToast('加载失败: ' + e.message); }
  }, [year, month]);
  useEffect(() => { load(); }, [load]);

  const handleCopy = async (row) => {
    const calc = {
      waterUsage: row.water_usage, elecUsage: row.electricity_usage,
      waterFee: row.water_fee, elecFee: row.electricity_fee, rent: row.rent, total: row.total,
    };
    const text = buildCopyText({ roomNumber: row.room_number, month, tenantName: row.tenant_name, calc });
    const ok = await copyText(text);
    if (ok) { setCopiedId(row.id); showToast('已复制'); setTimeout(() => setCopiedId(null), 1500); }
    else showToast('复制失败');
  };

  const startEdit = (row) => {
    setEditingId(row.id);
    setEditWater(row.water_reading ?? '');
    setEditElec(row.electricity_reading ?? '');
    setEditPrevWater(row.prev_water_reading ?? '');
    setEditPrevElec(row.prev_electricity_reading ?? '');
    setEditRent(row.rent ?? row.monthly_rent ?? '');
    setEditWup(row.water_unit_price ?? '');
    setEditEup(row.electricity_unit_price ?? '');
  };

  const saveEdit = async (row) => {
    setSaving(true);
    try {
      const res = await api.updateHistoryRecord(row.id, {
        water_reading: editWater,
        electricity_reading: editElec,
        prev_water_reading: editPrevWater,
        prev_electricity_reading: editPrevElec,
        monthly_rent: editRent,
        water_unit_price: editWup,
        electricity_unit_price: editEup,
      });
      // 更新本地
      setData((prev) => {
        if (!prev) return prev;
        const grouped = { ...prev.grouped };
        for (const f of Object.keys(grouped)) {
          grouped[f] = grouped[f].map((it) => it.id === row.id ? {
            ...it,
            water_reading: editWater === '' ? null : Number(editWater),
            electricity_reading: editElec === '' ? null : Number(editElec),
            prev_water_reading: res.prev_water_reading,
            prev_electricity_reading: res.prev_electricity_reading,
            water_usage: res.calc.waterUsage, electricity_usage: res.calc.elecUsage,
            water_fee: res.calc.waterFee, electricity_fee: res.calc.elecFee,
            rent: res.calc.rent, total: res.calc.total,
          } : it);
        }
        return { ...prev, grouped };
      });
      setEditingId(null);
      showToast('已修改并重算');
    } catch (e) { showToast('保存失败: ' + e.message); }
    finally { setSaving(false); }
  };

  // 标记/取消异常项
  const handleException = async (row) => {
    const cur = row.exception_note || '';
    const note = window.prompt('标记异常项（填写异常原因，留空或清除则取消标记）：', cur);
    if (note === null) return;
    try {
      const res = await api.markException(row.id, note);
      setData((prev) => {
        if (!prev) return prev;
        const grouped = { ...prev.grouped };
        for (const f of Object.keys(grouped)) {
          grouped[f] = grouped[f].map((it) => it.id === row.id ? { ...it, exception_note: res.exception_note } : it);
        }
        return { ...prev, grouped };
      });
      showToast(note === '' ? '已取消异常标记' : '已标记异常');
    } catch (e) { showToast('标记失败: ' + e.message); }
  };

  const [hideNoTotal, setHideNoTotal] = useState(() => {
    try { return localStorage.getItem('hideNoTotal') !== '0'; } catch { return true; }
  });
  const toggleHideNoTotal = (v) => {
    setHideNoTotal(v);
    try { localStorage.setItem('hideNoTotal', v ? '1' : '0'); } catch {}
  };

  if (!data) return <div className="loading">加载中…</div>;
  const floors = Object.keys(data.grouped);

  // 过滤：隐藏无总租金的房间（total 为 null/0/undefined）
  const filterRow = (row) => !hideNoTotal || (row.total !== null && row.total !== undefined && Number(row.total) !== 0);
  const totalCount = Object.values(data.grouped).flat().length;
  const shownCount = Object.values(data.grouped).flat().filter(filterRow).length;

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">{year} 年 {month} 月 明细</h1>
        <div className="page-sub">
          <button className="link-btn" onClick={() => navigate('/history')}>← 返回历史列表</button>
        </div>
      </div>
      <div className="page">
        <label className="filter-toggle">
          <input type="checkbox" checked={hideNoTotal} onChange={(e) => toggleHideNoTotal(e.target.checked)} />
          <span>隐藏无总租金的房间{hideNoTotal && `（${shownCount}/${totalCount}）`}</span>
        </label>
        {floors.length === 0 && <div className="empty">该月暂无记录</div>}
        {floors.map((f) => {
          const rows = (data.grouped[f] || []).filter(filterRow);
          if (rows.length === 0) return null;
          return (
          <div key={f}>
            <div className="section-title">{f}</div>
            {rows.map((row) => (
              <div key={row.id} className="detail-row">
                <div className="dr-head">
                  {row.room_number} {row.tenant_name ? `· ${row.tenant_name}` : ''}
                  {editingId !== row.id && (
                    <div style={{ float: 'right', display: 'flex', gap: 8 }}>
                      <button
                        className={'link-btn' + (row.exception_note ? ' exc-link' : '')}
                        onClick={() => handleException(row)}
                      >
                        {row.exception_note ? '⚠ 异常' : '标记异常'}
                      </button>
                      <button className="link-btn" onClick={() => startEdit(row)}>修改</button>
                    </div>
                  )}
                </div>
                {row.exception_note && <div className="exc-note">⚠ {row.exception_note}</div>}
                {editingId === row.id ? (
                  <div className="edit-form">
                    <div className="row-2">
                      <div className="field">
                        <label>水表读数（本期）</label>
                        <input type="number" inputMode="decimal" step="1" value={editWater} onChange={(e) => setEditWater(e.target.value)} placeholder="留空表示未抄表" />
                      </div>
                      <div className="field">
                        <label>电表读数（本期）</label>
                        <input type="number" inputMode="decimal" step="1" value={editElec} onChange={(e) => setEditElec(e.target.value)} placeholder="留空表示未抄表" />
                      </div>
                    </div>
                    <div className="row-2">
                      <div className="field">
                        <label>上期水读数</label>
                        <input type="number" inputMode="decimal" step="1" value={editPrevWater} onChange={(e) => setEditPrevWater(e.target.value)} />
                      </div>
                      <div className="field">
                        <label>上期电读数</label>
                        <input type="number" inputMode="decimal" step="1" value={editPrevElec} onChange={(e) => setEditPrevElec(e.target.value)} />
                      </div>
                    </div>
                    <div className="row-3">
                      <div className="field">
                        <label>月租金（元）</label>
                        <input type="number" inputMode="decimal" step="1" value={editRent} onChange={(e) => setEditRent(e.target.value)} />
                      </div>
                      <div className="field">
                        <label>水单价（元/吨）</label>
                        <input type="number" inputMode="decimal" step="1" value={editWup} onChange={(e) => setEditWup(e.target.value)} />
                      </div>
                      <div className="field">
                        <label>电单价（元/度）</label>
                        <input type="number" inputMode="decimal" step="1" value={editEup} onChange={(e) => setEditEup(e.target.value)} />
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                      <button className="btn" onClick={() => saveEdit(row)} disabled={saving}>{saving ? '保存中…' : '保存并重算'}</button>
                      <button className="btn ghost" onClick={() => setEditingId(null)} disabled={saving}>取消</button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="dr-line">
                      上期水 {num(row.prev_water_reading)} → 本期 {num(row.water_reading)}，用水 {num(row.water_usage)} 吨 {money(row.water_fee)} 元
                    </div>
                    <div className="dr-line">
                      上期电 {num(row.prev_electricity_reading)} → 本期 {num(row.electricity_reading)}，用电 {num(row.electricity_usage)} 度 {money(row.electricity_fee)} 元
                    </div>
                    <div className="dr-line">房租 {money(row.rent)} 元</div>
                    <div className="dr-total">共计 {money(row.total)} 元</div>
                    <button className={'btn ghost sm'} style={{ marginTop: 6 }} onClick={() => handleCopy(row)}>
                      {copiedId === row.id ? '✓ 已复制' : '复制房租信息'}
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
          );
        })}
      </div>
    </>
  );
}
