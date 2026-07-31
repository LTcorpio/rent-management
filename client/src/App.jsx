import { Routes, Route, NavLink, useLocation } from 'react-router-dom';
import CurrentMonth from './pages/CurrentMonth.jsx';
import History from './pages/History.jsx';
import Report from './pages/Report.jsx';
import Settings from './pages/Settings.jsx';
import { Icon } from './Icon.jsx';

const tabs = [
  { to: '/', label: '当月', icon: 'home' },
  { to: '/history', label: '历史', icon: 'calendar' },
  { to: '/report', label: '报表', icon: 'chart' },
  { to: '/settings', label: '设置', icon: 'gear' },
];

export default function App() {
  const loc = useLocation();
  return (
    <div className="app">
      <Routes>
        <Route path="/" element={<CurrentMonth />} />
        <Route path="/history" element={<History />} />
        <Route path="/history/:year/:month" element={<History />} />
        <Route path="/report" element={<Report />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
      <nav className="tabbar">
        {tabs.map((t) => {
          const active = loc.pathname === t.to || (t.to === '/history' && loc.pathname.startsWith('/history')) || (t.to === '/' && loc.pathname === '/');
          return (
            <NavLink key={t.to} to={t.to} end={t.to === '/'} className={'tabitem' + (active ? ' active' : '')}>
              <Icon name={t.icon} className="tab-ico" />
              <span>{t.label}</span>
            </NavLink>
          );
        })}
      </nav>
    </div>
  );
}
