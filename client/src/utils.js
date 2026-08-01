// 金额格式化：保留整数或两位小数
export function money(n) {
  if (n === null || n === undefined || n === '') return '--';
  const num = Number(n);
  if (!Number.isFinite(num)) return '--';
  return Number.isInteger(num) ? String(num) : num.toFixed(2);
}

export function num(n) {
  if (n === null || n === undefined || n === '') return '--';
  const num = Number(n);
  if (!Number.isFinite(num)) return '--';
  return Number.isInteger(num) ? String(num) : num.toFixed(2);
}

// 生成复制文本
export function buildCopyText({ roomNumber, month, tenantName, calc }) {
  const { waterUsage, waterFee, elecUsage, elecFee, rent, total } = calc;
  const head = tenantName ? `${tenantName}（${roomNumber}）${month}月` : `${roomNumber}房间${month}月`;
  const segs = [];
  if (waterUsage !== null && waterUsage !== undefined) segs.push(`用水${num(waterUsage)}吨${money(waterFee)}元`);
  if (elecUsage !== null && elecUsage !== undefined) segs.push(`用电${num(elecUsage)}度${money(elecFee)}元`);
  segs.push(`房租${money(rent)}元`);
  segs.push(`共计${money(total)}元`);
  return head + segs.join('、');
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fallthrough */ }
  // 兼容旧浏览器 / 非安全上下文（局域网 HTTP）
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (e) {
    return false;
  }
}

export function showToast(msg, ms = 1500) {
  let el = document.getElementById('__toast');
  if (!el) {
    el = document.createElement('div');
    el.id = '__toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.display = 'block';
  clearTimeout(el.__t);
  el.__t = setTimeout(() => { el.style.display = 'none'; }, ms);
}

export function currentYM() {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

export function monthOptions() {
  const opts = [];
  for (let m = 1; m <= 12; m++) opts.push(m);
  return opts;
}

export function yearOptions() {
  const start = 2026;
  const end = new Date().getFullYear() + 1;
  const opts = [];
  for (let y = start; y <= end; y++) opts.push(y);
  return opts;
}
