// 苹果 SF Symbols 风格图标（细线描边，active 时由 CSS currentColor 控制）
// 24x24 viewBox，stroke-width 1.8，圆角线帽

export function Icon({ name, className }) {
  const p = icons[name];
  return (
    <svg className={className} width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {p}
    </svg>
  );
}

const icons = {
  // 房屋（SF Symbol: house）
  home: (
    <>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
      <path d="M9.5 21v-6h5v6" />
    </>
  ),
  // 日历（SF Symbol: calendar）
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2.5" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3v4M16 3v4" />
      <path d="M7.5 14h3M13.5 14h3M7.5 17.5h3M13.5 17.5h3" />
    </>
  ),
  // 图表（SF Symbol: chart.bar.xaxis）
  chart: (
    <>
      <path d="M3.5 20.5h17" />
      <path d="M7 20.5V11M12 20.5V6M17 20.5v-7" />
    </>
  ),
  // 齿轮（Lucide settings 图标，真正的齿轮形状）
  gear: (
    <>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  // 刷新（SF Symbol: arrow.clockwise）
  refresh: (
    <>
      <path d="M20 11.5A8 8 0 1 1 17.3 5.6" />
      <path d="M20 4v5h-5" />
    </>
  ),
  // 向上箭头（用于抽屉展开/收起指示）
  chevron: (
    <>
      <path d="M6 15l6-6 6 6" />
    </>
  ),
};
