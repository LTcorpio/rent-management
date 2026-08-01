// 内联年月选择器：年份下拉框 + 1-12 月平铺网格
// 点击月份立即回调 onChange，便于快速查看当年不同月份数据
// archivedMonths: Set<"year-month">，已存档月份会禁用并标记
export default function MonthPicker({ year, month, years, onChange, extra, archivedMonths }) {
  const archivedSet = archivedMonths || new Set();
  return (
    <div className="mp-inline">
      <div className="mp-inline-head">
        <select
          className="mp-year-select"
          value={year}
          onChange={(e) => onChange(Number(e.target.value), month)}
        >
          {years.map((y) => (
            <option key={y} value={y}>{y} 年</option>
          ))}
        </select>
        <span className="mp-current">{year} 年 {month} 月</span>
        {extra}
      </div>
      <div className="mp-month-grid">
        {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
          if (archivedSet.has(`${year}-${m}`)) return null; // 已存档月份不显示入口
          return (
            <button
              key={m}
              type="button"
              className={'mp-month' + (m === month ? ' active' : '')}
              onClick={() => onChange(year, m)}
            >
              {m}
            </button>
          );
        })}
      </div>
    </div>
  );
}
