// 房租计算辅助
// 用量 = 当期读数 - 上期读数；费用 = 用量 * 单价
export function calcRecord(room, record) {
  const waterReading = num(record.water_reading);
  const elecReading = num(record.electricity_reading);
  const prevWater = num(record.prev_water_reading);
  const prevElec = num(record.prev_electricity_reading);

  const hasInput = waterReading !== null || elecReading !== null;
  const waterUsage = waterReading !== null ? round2(waterReading - prevWater) : null;
  const elecUsage = elecReading !== null ? round2(elecReading - prevElec) : null;
  const waterFee = waterUsage !== null ? round2(waterUsage * num(room.water_unit_price)) : null;
  const elecFee = elecUsage !== null ? round2(elecUsage * num(room.electricity_unit_price)) : null;
  const rent = num(room.monthly_rent);
  const total =
    waterFee !== null && elecFee !== null ? round2(waterFee + elecFee + rent) : null;

  return { hasInput, waterUsage, elecUsage, waterFee, elecFee, rent, total };
}

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function round2(n) {
  if (n === null || n === undefined) return null;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

// 生成复制文本：「101房间8月用水10吨30元、用电50度30元，房租800元，共计860元」
export function buildCopyText({ roomNumber, month, tenantName, calc }) {
  const { waterUsage, waterFee, elecUsage, elecFee, rent, total } = calc;
  const parts = [`${roomNumber}房间${month}月`];
  if (tenantName) parts[0] = `${tenantName}（${roomNumber}）${month}月`;
  const segs = [];
  if (waterUsage !== null) segs.push(`用水${waterUsage}吨${waterFee}元`);
  if (elecUsage !== null) segs.push(`用电${elecUsage}度${elecFee}元`);
  segs.push(`房租${rent}元`);
  segs.push(`共计${total}元`);
  return parts[0] + segs.join('、');
}
