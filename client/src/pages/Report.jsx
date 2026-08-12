import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from '../api.js';
import { money, num, currentYM, yearOptions } from '../utils.js';
import MonthPicker from '../MonthPicker.jsx';
import { Icon } from '../Icon.jsx';

export default function Report() {
  const { year: cy, month: cm } = currentYM();
  const [year, setYear] = useState(cy);
  const [month, setMonth] = useState(cm);
  const [data, setData] = useState(null);
  const [yearData, setYearData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [trendOpen, setTrendOpen] = useState(false);
  const [detailTab, setDetailTab] = useState(''); // 房间明细楼层选项卡
  const drawerRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [m, y] = await Promise.all([
        api.getMonthReport(year, month),
        api.getYearReport(year).catch(() => null),
      ]);
      setData(m);
      setYearData(y);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => { load(); }, [load]);

  // 趋势抽屉展开时，点击抽屉外部自动收起
  useEffect(() => {
    if (!trendOpen) return;
    const onDocClick = (e) => {
      if (drawerRef.current && !drawerRef.current.contains(e.target)) setTrendOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('touchstart', onDocClick);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('touchstart', onDocClick);
    };
  }, [trendOpen]);

  const floors = data ? Object.keys(data.floors || {}) : [];
  const curTab = detailTab && floors.includes(detailTab) ? detailTab : (floors[0] || '');

  return (
    <>
      <div className="page-header">
        <h1 className="page-title">数据报表</h1>
        <div className="page-sub">{year}年{month}月 核心数据一览</div>
      </div>

      <div className="page">
        <MonthPicker
          year={year}
          month={month}
          years={yearOptions()}
          onChange={(y, m) => { setYear(y); setMonth(m); }}
        />

        {/* 内容区：切换年月时遮罩 + 加载动画，保留 MonthPicker 可见 */}
        <div className="report-content-wrap">
          {data && (
            <div className={'report-content' + (loading ? ' masked' : '')}>
              {/* 核心指标卡 */}
              <div className="stat-grid">
                <div className="stat-card total"><div className="label">月总收入</div><div className="num">{money(data.grand.total)}<span className="unit">元</span></div></div>
                <div className="stat-card rent"><div className="label">租金合计</div><div className="num">{money(data.grand.rent)}<span className="unit">元</span></div></div>
                <div className="stat-card water"><div className="label">水费合计</div><div className="num">{money(data.grand.water_fee)}<span className="unit">元</span></div></div>
                <div className="stat-card elec"><div className="label">电费合计</div><div className="num">{money(data.grand.electricity_fee)}<span className="unit">元</span></div></div>
              </div>

              <div className="stat-grid">
                <div className="stat-card"><div className="label">用水量合计</div><div className="num">{num(data.grand.water_usage)}<span className="unit">吨</span></div></div>
                <div className="stat-card"><div className="label">用电量合计</div><div className="num">{num(data.grand.electricity_usage)}<span className="unit">度</span></div></div>
              </div>

              {/* 各房间明细（按楼层切换，汇总卡片+明细表合并） */}
              <div className="section-title">各房间明细</div>
              {floors.length === 0 && <div className="empty">该月暂无记录</div>}
              {floors.length > 0 && curTab && (
                <>
                  <div className="floor-tabs">
                    {floors.map((f) => (
                      <button key={f} className={curTab === f ? 'active' : ''} onClick={() => setDetailTab(f)}>{f}</button>
                    ))}
                  </div>
                  {(() => {
                    const fs = data.floors[curTab];
                    return (
                      <div className="floor-section">
                        <div className="floor-summary">
                          <div className="fs-head">
                            <span>{curTab}（{fs.input_rooms}/{fs.rooms}间已抄）</span>
                            <span className="fs-total">{money(fs.total)} 元</span>
                          </div>
                          <div className="fs-line">
                            <span>水 {num(fs.water_usage)}吨 {money(fs.water_fee)}元</span>
                            <span>电 {num(fs.electricity_usage)}度 {money(fs.electricity_fee)}元</span>
                            <span>租 {money(fs.rent)}元</span>
                          </div>
                        </div>
                        <table className="report-table wide">
                          <thead>
                            <tr>
                              <th>{curTab}</th><th>用水量(吨)</th><th>水费(元)</th><th>用电量(度)</th><th>电费(元)</th><th>租金(元)</th><th>合计(元)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {fs.list.map((r) => (
                              <tr key={r.id} className={r.total === null ? 'no-input' : ''}>
                                <td>{r.room_number}{r.tenant_name ? ` ${r.tenant_name}` : ''}</td>
                                <td>{r.water_usage === null ? '—' : num(r.water_usage)}</td>
                                <td>{r.water_fee === null ? '—' : money(r.water_fee)}</td>
                                <td>{r.electricity_usage === null ? '—' : num(r.electricity_usage)}</td>
                                <td>{r.electricity_fee === null ? '—' : money(r.electricity_fee)}</td>
                                <td>{money(r.rent)}</td>
                                <td>{r.total === null ? '—' : money(r.total)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr>
                              <td>小计</td>
                              <td>{num(fs.water_usage)}</td>
                              <td>{money(fs.water_fee)}</td>
                              <td>{num(fs.electricity_usage)}</td>
                              <td>{money(fs.electricity_fee)}</td>
                              <td>{money(fs.rent)}</td>
                              <td>{money(fs.total)}</td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    );
                  })()}
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
          {!loading && !data && <div className="empty">暂无数据</div>}
        </div>
      </div>

      {/* 抽屉展开时的背景遮罩 */}
      <div className={'trend-backdrop' + (trendOpen ? ' show' : '')} onClick={() => setTrendOpen(false)} />

      {/* 底部抽屉：年度各月趋势，默认收起，悬空圆角 */}
      {yearData && yearData.months.length > 0 && (
        <div className={'trend-drawer' + (trendOpen ? ' open' : '')} ref={drawerRef}>
          <button className="trend-drawer-handle" onClick={() => setTrendOpen((v) => !v)}>
            <span>{year}年各月趋势</span>
            <Icon name="chevron" className={'trend-chev' + (trendOpen ? ' open' : '')} />
          </button>
          <div className="trend-drawer-body">
            <table className="report-table">
              <thead><tr><th>月份</th><th>水费(元)</th><th>电费(元)</th><th>租金(元)</th><th>合计(元)</th></tr></thead>
              <tbody>
                {yearData.months.map((m) => (
                  <tr key={m.month}><td>{m.month}月</td><td>{money(m.water_fee)}</td><td>{money(m.electricity_fee)}</td><td>{money(m.rent)}</td><td>{money(m.total)}</td></tr>
                ))}
              </tbody>
              <tfoot><tr><td>全年合计</td><td>{money(yearData.totals.water_fee)}</td><td>{money(yearData.totals.electricity_fee)}</td><td>{money(yearData.totals.rent)}</td><td>{money(yearData.totals.total)}</td></tr></tfoot>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
