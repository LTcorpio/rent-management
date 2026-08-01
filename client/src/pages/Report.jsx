import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { money, num, currentYM, yearOptions } from '../utils.js';
import MonthPicker from '../MonthPicker.jsx';

export default function Report() {
  const { year: cy, month: cm } = currentYM();
  const [year, setYear] = useState(cy);
  const [month, setMonth] = useState(cm);
  const [data, setData] = useState(null);
  const [yearData, setYearData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailTab, setDetailTab] = useState(''); // 房间明细楼层选项卡

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

  if (loading) return <div className="loading">加载中…</div>;
  if (!data) return <div className="empty">暂无数据</div>;

  const g = data.grand;
  const floors = Object.keys(data.floors || {});
  // 明细选项卡默认选第一个楼层
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

        {/* 核心指标卡 */}
        <div className="stat-grid">
          <div className="stat-card total"><div className="label">月总收入</div><div className="num">{money(g.total)}<span className="unit">元</span></div></div>
          <div className="stat-card rent"><div className="label">租金合计</div><div className="num">{money(g.rent)}<span className="unit">元</span></div></div>
          <div className="stat-card water"><div className="label">水费合计</div><div className="num">{money(g.water_fee)}<span className="unit">元</span></div></div>
          <div className="stat-card elec"><div className="label">电费合计</div><div className="num">{money(g.electricity_fee)}<span className="unit">元</span></div></div>
        </div>

        <div className="stat-grid">
          <div className="stat-card"><div className="label">用水量合计</div><div className="num">{num(g.water_usage)}<span className="unit">吨</span></div></div>
          <div className="stat-card"><div className="label">用电量合计</div><div className="num">{num(g.electricity_usage)}<span className="unit">度</span></div></div>
        </div>

        {/* 各月趋势（前置） */}
        {yearData && yearData.months.length > 0 && (
          <>
            <div className="section-title">{year}年各月趋势</div>
            <table className="report-table">
              <thead><tr><th>月份</th><th>水费(元)</th><th>电费(元)</th><th>租金(元)</th><th>合计(元)</th></tr></thead>
              <tbody>
                {yearData.months.map((m) => (
                  <tr key={m.month}><td>{m.month}月</td><td>{money(m.water_fee)}</td><td>{money(m.electricity_fee)}</td><td>{money(m.rent)}</td><td>{money(m.total)}</td></tr>
                ))}
              </tbody>
              <tfoot><tr><td>全年合计</td><td>{money(yearData.totals.water_fee)}</td><td>{money(yearData.totals.electricity_fee)}</td><td>{money(yearData.totals.rent)}</td><td>{money(yearData.totals.total)}</td></tr></tfoot>
            </table>
          </>
        )}

        {/* 楼层汇总 */}
        <div className="section-title">楼层汇总</div>
        {floors.map((f) => {
          const fs = data.floors[f];
          return (
            <div key={f} className="floor-summary">
              <div className="fs-head"><span>{f}（{fs.input_rooms}/{fs.rooms}间已抄）</span><span className="fs-total">{money(fs.total)} 元</span></div>
              <div className="fs-line"><span>水 {num(fs.water_usage)}吨 {money(fs.water_fee)}元</span><span>电 {num(fs.electricity_usage)}度 {money(fs.electricity_fee)}元</span><span>租 {money(fs.rent)}元</span></div>
            </div>
          );
        })}

        {/* 房间明细（选项卡切换） */}
        <div className="section-title">房间明细</div>
        {floors.length > 0 && (
          <>
            <div className="floor-tabs">
              {floors.map((f) => (
                <button key={f} className={curTab === f ? 'active' : ''} onClick={() => setDetailTab(f)}>{f}</button>
              ))}
            </div>
            {curTab && (
              <table className="report-table wide">
                <thead>
                  <tr><th>{curTab}</th><th>用水量(吨)</th><th>水费(元)</th><th>用电量(度)</th><th>电费(元)</th><th>租金(元)</th><th>合计(元)</th></tr>
                </thead>
                <tbody>
                  {data.floors[curTab].list.map((r) => (
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
                    <td>{num(data.floors[curTab].water_usage)}</td>
                    <td>{money(data.floors[curTab].water_fee)}</td>
                    <td>{num(data.floors[curTab].electricity_usage)}</td>
                    <td>{money(data.floors[curTab].electricity_fee)}</td>
                    <td>{money(data.floors[curTab].rent)}</td>
                    <td>{money(data.floors[curTab].total)}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </>
        )}
      </div>
    </>
  );
}
