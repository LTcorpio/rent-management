import { useState } from 'react';
import { Icon } from './Icon.jsx';

// 内联年月选择器：年份下拉框 + 1-12 月平铺网格
// 点击月份立即回调 onChange，便于快速查看当年不同月份数据
// archivedMonths: Set<"year-month">，已存档月份会禁用并标记
// collapsible: 默认收起为一行「年份 + 月份」，点击「切换月份」再展开网格
//              （当月页一屏要放进一间房的全部抄表内容，空间紧张）
export default function MonthPicker({ year, month, years, onChange, extra, archivedMonths, collapsible = false }) {
  const archivedSet = archivedMonths || new Set();
  const [open, setOpen] = useState(!collapsible);
  const cls = 'mp-inline' + (collapsible ? ' collapsible' : '') + (collapsible && open ? ' open' : '');
  return (
    <div className={cls}>
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
        {/* 年份已由左侧下拉框显示，这里只留月份，窄屏下省出宽度 */}
        <span className="mp-current">{month} 月</span>
        {extra}
        {collapsible && (
          <button type="button" className="mp-toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? '收起' : '切换月份'}
            <Icon name="chevron" className={'mp-chev' + (open ? '' : ' down')} />
          </button>
        )}
      </div>
      {open && (
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
      )}
    </div>
  );
}
