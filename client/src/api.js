const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `请求失败 ${res.status}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

export const api = {
  // 房间
  getRooms: () => request('/rooms'),
  updateRoom: (id, data) => request(`/rooms/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  addRoom: (data) => request('/rooms', { method: 'POST', body: JSON.stringify(data) }),
  deleteRoom: (id) => request(`/rooms/${id}`, { method: 'DELETE' }),

  // 租客
  getTenants: (roomId) => request(`/tenants${roomId ? `?roomId=${roomId}` : ''}`),
  addTenant: (data) => request('/tenants', { method: 'POST', body: JSON.stringify(data) }),
  updateTenant: (id, data) => request(`/tenants/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  moveoutTenant: (id, data) => request(`/tenants/${id}/moveout`, { method: 'POST', body: JSON.stringify(data) }),

  // 月度记录
  getMonth: (year, month) => request(`/records/month/${year}/${month}`),
  saveRecord: (data) => request('/records', { method: 'POST', body: JSON.stringify(data) }),
  archiveMonth: (year, month) => request(`/records/archive/${year}/${month}`, { method: 'POST' }),
  getHistory: () => request('/records/history'),
  getHistoryDetail: (year, month) => request(`/records/history/${year}/${month}`),

  // 报表
  getMonthReport: (year, month) => request(`/report/month/${year}/${month}`),
  getYearReport: (year) => request(`/report/year/${year}`),
};
