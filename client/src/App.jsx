import { useEffect, useState } from 'react';
import { Routes, Route, NavLink, useLocation, Navigate } from 'react-router-dom';
import CurrentMonth from './pages/CurrentMonth.jsx';
import History from './pages/History.jsx';
import Report from './pages/Report.jsx';
import Settings from './pages/Settings.jsx';
import { Icon } from './Icon.jsx';
import { api } from './api.js';

// 权限由 SSO 身份决定：只有管理员（Authelia 分组含 admins）才显示
// 「设置」入口与当月页的「保存并上传」。局域网 IP:端口直连没有身份头，
// 一律按普通用户处理（隐藏上述功能）。
const allTabs = [
  { to: '/', label: '当月' },
  { to: '/history', label: '历史' },
  { to: '/report', label: '报表' },
  { to: '/settings', label: '设置' },
];

export default function App() {
  const loc = useLocation();
  // 初始按非管理员渲染，避免身份未返回时闪现管理功能
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    api.getMe()
      .then((me) => setIsAdmin(!!me?.isAdmin))
      .catch(() => setIsAdmin(false));
  }, []);

  const tabs = isAdmin ? allTabs : allTabs.filter((t) => t.to !== '/settings');

  const isActive = (to) =>
    to === '/history' ? loc.pathname.startsWith('/history') : loc.pathname === to;

  return (
    <div className="app">
      {/* 顶部栏：视图切换器（原底部导航改到这里）+ 刷新 */}
      <header className="topbar">
        <nav className="segmented">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.to === '/'}
              className={'seg-item' + (isActive(t.to) ? ' active' : '')}
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
        <button className="refresh-btn" onClick={() => window.location.reload()} aria-label="刷新">
          <Icon name="refresh" className="refresh-ico" />
        </button>
      </header>
      <Routes>
        <Route path="/" element={<CurrentMonth isAdmin={isAdmin} />} />
        <Route path="/history" element={<History />} />
        <Route path="/history/:year/:month" element={<History />} />
        <Route path="/report" element={<Report />} />
        <Route path="/settings" element={isAdmin ? <Settings /> : <Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
