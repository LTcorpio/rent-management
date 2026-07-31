import { useEffect, useState } from 'react';
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
  useEffect(() => {
    api.getHistory().then(setList).catch((e) => showToast('加载失败: ' + e.message));
  }, []);

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">历史存档</h1>
        <div className="page-sub">点击查看各月明细，可复制历史房租信息</div>
      </div>
      <div className="page">
        {!list ? <div className="loading">加载中…</div> :
         list.length === 0 ? <div className="empty">暂无已存档月份<br />在「当月」页面保存上传后此处可查看</div> :
         list.map((r) => (
           <button key={`${r.year}-${r.month}`} className="history-item" onClick={() => navigate(`/history/${r.year}/${r.month}`)}>
             <div>
               <div className="ym">{r.year}年{r.month}月</div>
               <div className="breakdown">水 {money(r.total_water)} · 电 {money(r.total_elec)} · 租 {money(r.total_rent)} · {r.room_count}间</div>
             </div>
             <div className="sum">{money(r.total_amount)}</div>
           </button>
         ))}
      </div>
    </>
  );
}

function HistoryDetail({ year, month }) {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [copiedId, setCopiedId] = useState(null);

  useEffect(() => {
    api.getHistoryDetail(year, month).then(setData).catch((e) => showToast('加载失败: ' + e.message));
  }, [year, month]);

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

  if (!data) return <div className="loading">加载中…</div>;
  const floors = Object.keys(data.grouped);

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">{year}年{month}月 明细</h1>
        <div className="page-sub">
          <button className="link-btn" onClick={() => navigate('/history')}>← 返回历史列表</button>
        </div>
      </div>
      <div className="page">
        {floors.length === 0 && <div className="empty">该月暂无记录</div>}
        {floors.map((f) => (
          <div key={f}>
            <div className="section-title">{f}</div>
            {(data.grouped[f] || []).map((row) => (
              <div key={row.id} className="detail-row">
                <div className="dr-head">{row.room_number} {row.tenant_name ? `· ${row.tenant_name}` : ''}</div>
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
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}
