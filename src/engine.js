// Pure, deterministic calculation; dates are shop-local calendar dates, never timestamps.
export const ROUTE = Object.freeze({ prep: 2, sea: 30, air: 10, customs: 5, shelf: 5 });
export const POLICIES = Object.freeze({ A: { safety: 21, review: 21, air: true }, B: { safety: 10, review: 14, air: true }, C: { safety: 5, review: 7, air: false } });
const DAY = 86400000;
export function dateNumber(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw Error('日期必须为 YYYY-MM-DD');
  const n = Date.parse(s + 'T00:00:00Z');
  if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== s) throw Error('日期无效：' + s);
  return n / DAY;
}
export const dateAt = n => new Date(n * DAY).toISOString().slice(0, 10);
function count(v, label) { if (!Number.isSafeInteger(v) || v < 0) throw Error(label + ' 必须为非负整数，缺失值不能代零'); }
export function validate(data, market) {
  if (!data || typeof data !== 'object') throw Error('数据必须为对象');
  dateNumber(data.asOf);
  for (const kind of ['sales', 'inventory', 'pipeline']) {
    if (!Array.isArray(data[kind])) throw Error(kind + ' 必须为数组');
    const keys = new Set();
    for (const r of data[kind]) {
      if (!r || !['US', 'DE'].includes(r.market) || (market && r.market !== market)) throw Error('导入数据包含其他市场或无效市场');
      if (r.product != null && (typeof r.product !== 'string' || !r.product.trim())) throw Error('product 必须为非空文本');
      if (typeof r.sku !== 'string' || !r.sku.trim()) throw Error('SKU 必须为非空文本（保留前导零）');
      if (kind === 'sales') {
        dateNumber(r.date); count(r.units, '销量');
        if (r.date > data.asOf) throw Error('销量日期不能晚于分析日期');
        if (r.in_stock !== undefined && typeof r.in_stock !== 'boolean') throw Error('in_stock 必须为布尔值');
        if (r.in_stock === false && r.units > 0) throw Error('不可售日销量必须为零');
      } else {
        count(r[kind === 'inventory' ? 'available' : 'qty'], '数量');
        const date = kind === 'inventory' ? r.snapshot_date : r.eta;
        if (date) dateNumber(date);
        const id = kind === 'inventory' ? (r.warehouse || '') : r.shipment_id;
        if (kind === 'inventory' || id) {
          const k = JSON.stringify([r.market, r.sku, id]);
          if (keys.has(k)) throw Error('重复库存快照或在途单：' + r.sku);
          keys.add(k);
        }
      }
    }
  }
  for (const r of Object.values(data.routes || {})) for (const k of Object.keys(ROUTE)) if (r[k] !== undefined) { count(r[k], k); if (r[k] > 365) throw Error('运输参数不能超过365天'); }
  for (const v of Object.values(data.overrides || {})) if (!POLICIES[v]) throw Error('策略只能为 A/B/C');
  for (const s of Object.values(data.productSignals || {})) {
    if (s.discontinued !== undefined && typeof s.discontinued !== 'boolean') throw Error('discontinued 必须为布尔值');
    for (const k of ['unitCost','airExtra','recoveryPct','topCreatorShare']) if (s[k] != null && (!Number.isFinite(s[k]) || s[k] < 0 || (k.endsWith('Pct') || k === 'topCreatorShare') && s[k] > 100)) throw Error('经营参数无效：' + k);
    if (s.contribution != null && !Number.isFinite(s.contribution)) throw Error('贡献利润无效');
    if (s.demandMultiplier != null && (!Number.isFinite(s.demandMultiplier) || s.demandMultiplier < 0.1 || s.demandMultiplier > 5)) throw Error('需求倍率须为0.1–5');
    if (s.actionOverride && !['grow','hold','reduce','stop'].includes(s.actionOverride)) throw Error('经营动作无效');
  }
  return data;
}
function stats(rows, now) {
  const first = rows.length ? Math.max(now - 59, rows.reduce((min,r)=>Math.min(min,dateNumber(r.date)),now)) : now;
  const daily = [];
  for (let n = first; n <= now; n++) {
    const rs = rows.filter(r => dateNumber(r.date) === n);
    daily.push({ units: rs.reduce((s,r) => s + r.units, 0), out: rs.some(r => r.in_stock === false), known: rs.length > 0 && rs.every(r => typeof r.in_stock === 'boolean') });
  }
  const avg = days => { const a = daily.slice(-days).filter(d => !d.out); return a.length ? a.reduce((s,d) => s + d.units, 0) / a.length : 0; };
  const m = avg(30), a = daily.slice(-30).filter(d => !d.out);
  const cv = m ? Math.sqrt(a.reduce((s,d) => s + (d.units - m) ** 2, 0) / a.length) / m : 0;
  return { span: daily.length, m, ratio: m ? avg(7) / m : 0, cv, demand: avg(7)*0.5 + avg(14)*0.3 + m*0.2, complete: daily.slice(-30).every(d => d.known), out: daily.slice(-30).filter(d => d.out).length };
}
function simulate(initial, demand, supply, horizon, asOf, seaDay, airDay, sea = 0, air = 0) {
  let stock = initial, lost = 0, first = null, beforeAir = 0;
  const daily = [];
  for (let day = 0; day < horizon; day++) {
    const incoming = (supply.get(day) || 0) + (day === seaDay ? sea : 0) + (day === airDay ? air : 0);
    stock += incoming;
    const loss = Math.max(0, demand - stock);
    stock = Math.max(0, stock - demand); lost += loss;
    if (loss > 1e-8 && first === null) first = dateAt(asOf + day);
    if (day < airDay) beforeAir += loss;
    daily.push({ date: dateAt(asOf + day), incoming, stock, lost: loss });
  }
  return { stock, lost, first, beforeAir, daily };
}
// Minimal shipment that maintains end-of-day safety; shortages before arrival are lost sales.
function required(initial, demand, supply, start, end, safety, otherDay = -1, otherQty = 0) {
  let stock = initial;
  for (let d = 0; d < start; d++) stock = Math.max(0, stock + (supply.get(d)||0) + (d===otherDay?otherQty:0) - demand);
  let minimum = Infinity;
  for (let d = start; d < end; d++) { stock += (supply.get(d)||0) + (d===otherDay?otherQty:0) - demand; minimum = Math.min(minimum, stock); }
  return Math.max(0, Math.ceil(safety - minimum - 1e-8));
}
export function plan(data, market) {
  validate(data, market);
  const now = dateNumber(data.asOf), route = { ...ROUTE, ...data.routes?.[market] };
  const seaDay = route.prep + route.sea + route.customs + route.shelf, airDay = route.prep + route.air + route.customs + route.shelf;
  if (seaDay <= airDay || airDay < 1) throw Error('海运总时效须大于空运，空运总时效须至少1天');
  const skus = [...new Set([...data.sales,...data.inventory,...data.pipeline].map(r => r.sku))];
  const groups = new Map();
  for (const sku of skus) {
    const rs = [...data.inventory,...data.sales,...data.pipeline].filter(r=>r.sku===sku);
    const products = [...new Set(rs.map(r=>r.product).filter(Boolean))];
    if (products.length > 1) throw Error('同一 SKU 对应多个产品：' + sku);
    const product = products[0] || sku;
    if (!groups.has(product)) groups.set(product, []);
    groups.get(product).push(sku);
  }
  const products = [], items = [];
  for (const [product, members] of groups) {
    const signal = data.productSignals?.[market+'|'+product] || {};
    const st = stats(data.sales.filter(r=>members.includes(r.sku)), now);
    const inv = data.inventory.filter(r=>members.includes(r.sku));
    const available = inv.reduce((s,r)=>s+r.available,0), cover = st.m ? available/st.m : null;
    let recommended = 'B', action = 'hold', reason = '增长证据不足，按平衡策略观察';
    if (st.span < 14 || !st.m || cover > 90 || st.ratio < .6 || st.ratio > 2 || st.cv > 1.2 || ['single','campaign'].includes(signal.source) || signal.topCreatorShare > 60) { recommended = 'C'; reason = '历史不足、需求波动或库存偏高，先小批验证'; }
    else if (st.span >= 28 && st.m >= 2 && st.cv <= .8 && st.ratio >= .85 && st.out <= 3) { recommended = 'A'; reason = '历史较稳定，优先降低缺货风险'; }
    if (signal.discontinued || signal.contribution != null && signal.contribution <= 0 || st.span >= 28 && st.complete && !st.out && !st.m) { action = 'stop'; reason = '明确停推、贡献不为正或长期可售无销量'; }
    else if (cover > 90 || st.span >= 14 && st.complete && !st.out && st.ratio < .6) { action = 'reduce'; recommended = 'C'; reason = '库存覆盖偏高或完整可售记录显示需求下滑'; }
    else if (st.span >= 28 && st.ratio >= 1.2 && st.ratio <= 2 && st.cv <= .8 && st.complete && st.out <= 3 && signal.contribution > 0 && (signal.source === 'organic' || signal.source === 'multi' && signal.topCreatorShare <= 50)) { action = 'grow'; recommended = 'A'; reason = '持续增长、有利润及分散流量证据'; }
    const policy = data.overrides?.[market+'|'+product] || recommended, cfg = POLICIES[policy], adoptedAction = signal.actionOverride || action;
    products.push({ product, recommended, policy, action, adoptedAction, reason });
    for (const sku of members) {
      const rows = data.sales.filter(r=>r.sku===sku), snapshots = inv.filter(r=>r.sku===sku), meta = snapshots[0] || rows[0] || {};
      const warnings = [];
      const valid = snapshots.length > 0 && snapshots.every(r=>r.snapshot_date===data.asOf);
      if (!valid) warnings.push('缺少当日库存快照：禁止执行数量');
      const ss = stats(rows, now), demand = ss.demand * (signal.demandMultiplier || 1);
      if (!ss.complete) warnings.push('可售记录不完整，需求可能低估');
      if (ss.span < 14) warnings.push('历史不足14天');
      if (!meta.product) warnings.push('缺产品字段，按独立SKU计算');
      const supply = new Map();
      for (const r of data.pipeline.filter(r=>r.sku===sku)) {
        if (['received','completed','cancelled','已入库','已完成','已取消'].includes(r.status)) continue;
        if (!r.shipment_id) { warnings.push('在途缺发货单号，未计入'); continue; }
        if (!r.eta || dateNumber(r.eta) < now) { warnings.push('在途可售ETA未知或逾期，未计入'); continue; }
        const d = dateNumber(r.eta) - now; supply.set(d,(supply.get(d)||0)+r.qty);
      }
      const stock = snapshots.reduce((s,r)=>s+r.available,0), horizon = seaDay + cfg.review, safety = demand*cfg.safety;
      const airReference = demand ? required(stock,demand,supply,airDay,seaDay,safety) : 0;
      const economicsBlock = signal.contribution != null && signal.airExtra != null && signal.contribution - signal.airExtra <= 0;
      if (economicsBlock) warnings.push('空运后贡献不为正，暂停空运');
      let air = cfg.air && !economicsBlock ? airReference : 0;
      let sea = demand ? required(stock,demand,supply,seaDay,horizon,safety,airDay,air) : 0;
      if (adoptedAction === 'stop') air = sea = 0;
      const base = simulate(stock,demand,supply,horizon,now,seaDay,airDay,sea,air);
      const existing = simulate(stock,demand,supply,horizon,now,seaDay,airDay);
      const low = simulate(stock,demand*.7,supply,horizon,now,seaDay,airDay,sea,air), high = simulate(stock,demand*1.3,supply,horizon,now,seaDay,airDay,sea,air);
      const extraStock = Math.max(0,low.stock-base.stock), extraLost = Math.max(0,high.lost-base.lost);
      const safetyDate = existing.daily.find(d=>d.stock < safety)?.date;
      warnings.push('MOQ、箱规、预算与国内供给尚未计入');
      if (signal.contribution == null || signal.airExtra == null) warnings.push('利润或运费未知，未验证空运经济性');
      items.push({ market, product, sku, color: meta.color || '', size: meta.size || '', policy, demand, available: valid?stock:null, pipeline: [...supply.values()].reduce((s,q)=>s+q,0), air: valid?air:null, sea: valid?sea:null, airReference: valid?airReference:null, airDate: dateAt(now+airDay), seaDate: dateAt(now+seaDay), firstStockout: valid?existing.first:null, latestAirStart: valid&&safetyDate?dateAt(dateNumber(safetyDate)-airDay):null, latestSeaStart: valid&&safetyDate?dateAt(dateNumber(safetyDate)-seaDay):null, lost: valid?base.lost:null, beforeAir: valid?base.beforeAir:null, daily: valid?base.daily:[], scenario: valid?{ extraStock, extraLost, capital: signal.unitCost!=null?extraStock*signal.unitCost:null, markdown: signal.unitCost!=null&&signal.recoveryPct!=null?extraStock*signal.unitCost*(1-signal.recoveryPct/100):null, missedContribution: signal.contribution>0?extraLost*signal.contribution:null }:null, warnings });
    }
  }
  return { market, asOf: data.asOf, route, products, items };
}
