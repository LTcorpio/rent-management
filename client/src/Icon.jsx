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
  // 齿轮（SF Symbol: gearshape）
  gear: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3" />
    </>
  ),
};
