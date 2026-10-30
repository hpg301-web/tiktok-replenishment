import './style.css';
import { plan, validate, ROUTE } from './engine.js';
import { normalizeImport } from './importer.js';
import { confirmImport } from './import-ui.js';
import { openUpdates } from './update-ui.js';
import { createReminderClient } from './reminder-ui.js';
import { openClassification } from './classification-ui.js';
import { emptyData, demoData, parseImportFile, csv } from './data.js';
const market = location.pathname === '/de.html' ? 'DE' : 'US';
const key = 'stockpilot.v1.'+market;
const name = market === 'US' ? '美国' : '德国';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = value => value == null ? '待核实' : Number(value.toFixed(1)).toLocaleString('zh-CN');
const actionNames = { grow:'加仓',hold:'维持',reduce:'减仓',stop:'停止补货' };
let data = emptyData(), isDemo = false, message = '', result, storageWarning = '';
let shared=false, revision=0, busy=0, serverMode={};
const expandedSpus=new Set();
const reminders=createReminderClient({api,mode:()=>serverMode});
try { const saved = localStorage.getItem(key); if (saved) { const s=JSON.parse(saved); validate(s.data,market); data=s.data; isDemo=s.isDemo===true; } } catch { storageWarning='本地保存数据无法读取。未覆盖原数据，请先导出或检查浏览器存储。'; }
async function commit(next, demo=isDemo) {
  validate(next,market); plan(next,market); // Atomic: bad imports never replace the current workspace.
  if(shared) {
    const saved=await api('/api/workspace/'+market,{method:'PUT',headers:{'Content-Type':'application/json','If-Match':String(revision)},body:JSON.stringify({data:next,isDemo:demo})});
    revision=saved.revision;
  } else try { localStorage.setItem(key,JSON.stringify({data:next,isDemo:demo})); } catch { throw Error('浏览器存储不可用或空间不足；工作区未更改。请先导出备份'); }
  if(shared)setTimeout(()=>{if(document.querySelector('#logout'))void reminders.refresh();},800);
  data=next; isDemo=demo; message=shared?'已更新并保存到团队主机':'已更新并保存到当前浏览器'; render();
}
function download(name, content, type='application/json') {
  const url=URL.createObjectURL(new Blob([content],{type})), a=document.createElement('a'); a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function run(fn) { return async e=>{ busy++;try { await fn(e); } catch(error) { message=error.message; const el=document.querySelector('#notice');if(el){el.textContent=message;el.setAttribute('role','alert');} } finally {busy--;} }; }
function render() {
  const visibleGroups=document.querySelectorAll('details.product[data-spu]');
  if(visibleGroups.length){expandedSpus.clear();visibleGroups.forEach(group=>{if(group.open)expandedSpus.add(group.dataset.spu);});}
  result=plan(data,market);
  const unmatched=[...new Set(data.sales.map(r=>r.sku))].filter(sku=>!data.inventory.some(r=>r.sku===sku));
  const items=result.items, valid=items.filter(i=>i.sea!==null), total=field=>valid.reduce((s,i)=>s+i[field],0), risks=items.filter(i=>i.available===null || i.lost>0).length;
  document.querySelector('#app').innerHTML=`
  <aside><a class="brand" href="/us.html"><span class="brand-icon">S</span> StockPilot<span class="beta">BETA</span></a><div class="side-label">TIKTOK SHOP · 库存管理</div><nav aria-label="市场"><a href="/us.html" class="${market==='US'?'active':''}">US <span>美国工作区</span></a><a href="/de.html" class="${market==='DE'?'active':''}">DE <span>德国工作区</span></a></nav><div class="side-note"><span class="dot"></span> ${shared?'团队共用工作区':'本地工作区'}<br><small>${shared?'数据统一保存到主机':'文件在浏览器内处理'}<br>美德数据独立保存</small></div></aside>
  <main><header><div><span class="eyebrow">REPLENISHMENT PLANNER / ${market}</span><h1>${name}补货工作台</h1><p>从销量到下一批库存，让每一次补货有据可依。</p></div><div class="header-actions">${shared?'<button id="refresh">载入最新数据</button><button id="reminder-center">补货提醒</button><button id="check-update">检查更新</button><button id="logout">退出登录</button>':''}<button id="backup">导出工作区</button><button id="export" class="primary" ${items.length?'':'disabled'}>导出补货清单 ↗</button></div></header>
  <div class="toolbar"><label>分析日期 <input id="asOf" type="date" value="${esc(data.asOf)}"></label><span>币种 ${market==='US'?'USD':'EUR'} · 自然日</span><span class="status">${isDemo?'演示数据 · 不用于采购':shared?'团队共用 · 版本 '+revision:'实际数据工作区'}</span></div>
  <p id="notice" role="status" aria-live="polite">${esc(storageWarning||message)}</p>
  <section class="metrics" aria-label="计划概览"><article><span>待处理风险</span><strong>${risks}<small> 个 SKU</small></strong><p>缺货或库存待核实</p></article><article><span>海运建议</span><strong>${num(total('sea'))}<small> 件</small></strong><p>预计可售 ${items[0]?.seaDate || '—'}</p></article><article><span>空运建议</span><strong>${num(total('air'))}<small> 件</small></strong><p>预计可售 ${items[0]?.airDate || '—'}</p></article><article><span>空运到货前缺口</span><strong>${num(total('beforeAir'))}<small> 件</small></strong><p>新增空运也无法弥补的缺货</p></article></section>
  <section class="panel"><div class="section-title"><div><span class="eyebrow">01 / DATA WORKSPACE</span><h2>准备你的数据</h2></div><button id="demo">载入演示数据</button></div><div class="imports">${[['sales','销量记录','有效出库件数，排除取消、未付款'],['inventory','可用库存','当日销售开始前的 TikTok 专用仓快照'],['pipeline','在途发货','剩余未入库件数；ETA 为上架可售日']].map(([kind,title,desc])=>`<div class="import-card"><span class="file-icon">↥</span><h3>${title}</h3><p>${desc}</p><div><label class="upload">导入 CSV / XLSX<input type="file" data-kind="${kind}" accept=".csv,.xlsx"></label><button class="text" data-template="${kind}">下载模板</button></div><small>${data[kind].length} 条记录 · 导入将替换此表</small>${data.imports?.[kind]?`<p class="import-note">${esc(data.imports[kind].source)} · 接受${data.imports[kind].accepted}条 / 排除${data.imports[kind].excluded.length}条</p>`:''}</div>`).join('')}</div><div class="panel-foot"><label class="upload subtle">恢复 JSON 工作区<input id="json" type="file" accept=".json"></label><span>支持 TikTok/领星原始导出 · 自动识别工作表和字段 · SKU保留前导零</span><button class="text danger" id="clear">清空当前市场</button></div></section>
  ${data.imports?`<details class="panel settings"><summary>导入识别报告与数据提醒</summary>${Object.values(data.imports).map(r=>`<h3>${esc(r.source)} · ${esc(r.fileName)} · ${esc(r.sheet)}</h3><p>原始${r.total}条；接受${r.accepted}条；排除${r.excluded.length}条；输出${r.output}条；合计${r.units??'—'}件。${r.kind==='pipeline'?'其中可计入准时供给 '+(r.eligibleUnits??'—')+' 件。':''}${r.snapshotDate?'快照日期 '+esc(r.snapshotDate):''}</p><p>${(r.warnings||[]).map(esc).join('；')}</p><p>${r.mapping.map(m=>esc(m.column)+' → '+esc(m.field)).join('；')}</p>`).join('')}<p>${unmatched.length?'跨表匹配：'+unmatched.length+'个销售SKU未匹配库存，相关补货数量保持待核实。':'已导入销量的SKU均已匹配库存记录；仍需检查快照日期。'}完整排除行号和原因保存在导出JSON的 imports 字段。没有将买家个人信息带入工作区。</p></details>`:''}
  <section class="panel"><div class="section-title"><div><span class="eyebrow">02 / REPLENISHMENT PLAN</span><h2>备货建议</h2><p>先查看SPU，点击展开对应SKU建议</p></div><span class="muted">${items.length} 个 SKU · ${result.products.length} 个产品</span><button id="classify-skus">手动归类SKU</button></div>
  ${items.length?result.products.map(p=>{const group=items.filter(i=>i.product===p.product);const missing=group.filter(i=>i.available===null).length;const knownProduct=group.some(i=>i.productSource!=='unknown');return `<details class="product" data-spu="${esc(p.product)}" ${expandedSpus.has(p.product)?'open':''}><summary class="product-head"><div><span class="eyebrow">${knownProduct?'SPU / 产品':'SPU待识别 / 暂按SKU'}</span><h3>${esc(p.product)}</h3><p>${esc(p.reason)}</p></div><div class="spu-overview"><span>${group.length} 个 SKU · ${actionNames[p.adoptedAction]} · 策略 ${p.policy}</span>${missing?`<small class="overdue">${missing} 个SKU数量待核实</small>`:''}<span class="spu-expand">点击展开SKU备货建议</span></div></summary><div class="product-content"><button class="text classify-group" data-classify-group="${esc(p.product)}">${knownProduct?'调整该组SKU归类':'将该SKU归入SPU'}</button><div class="policy"><span>${actionNames[p.adoptedAction]} · 推荐 ${p.recommended}</span><label>采用策略 <select data-product="${esc(p.product)}"><option value="">自动推荐</option>${['A','B','C'].map(v=>`<option value="${v}" ${data.overrides?.[market+'|'+p.product]===v?'selected':''}>${v} · ${{A:'优先不断货',B:'平衡',C:'轻库存'}[v]}</option>`).join('')}</select></label></div><div class="table-scroll"><table><thead><tr><th>SKU / 颜色尺码</th><th>预测日销</th><th>可用 / 已确认在途</th><th>海运 / 空运</th><th>首次缺货</th><th>最晚海运启动</th><th>计划缺货量</th></tr></thead><tbody>${group.map(i=>`<tr><td><b>${esc(i.sku)}</b><small>${esc(i.color)} ${esc(i.size)}</small><button class="text" data-classify-sku="${esc(i.sku)}">${i.productSource==='manual'?'修改手动归类':'归入SPU'}</button></td><td>${num(i.demand)}</td><td>${num(i.available)} / ${num(i.pipeline)}</td><td><b>${num(i.sea)} / ${num(i.air)}</b></td><td>${i.firstStockout||'—'}</td><td class="${i.latestSeaStart&&i.latestSeaStart<data.asOf?'overdue':''}">${i.latestSeaStart||'—'}${i.latestSeaStart&&i.latestSeaStart<data.asOf?' · 已过期':''}</td><td>${num(i.lost)}</td></tr><tr class="detail"><td colspan="7"><details><summary>数据提醒与需求压力测试 · ${i.warnings.length} 项</summary><p>${i.warnings.map(esc).join('；')}</p>${i.scenario?`<p>需求 70%：额外期末库存 ${num(i.scenario.extraStock)} 件；额外资金占用 ${num(i.scenario.capital)}；潜在折价损失 ${num(i.scenario.markdown)}。需求 130%：额外缺货 ${num(i.scenario.extraLost)} 件；可能少赚贡献利润 ${num(i.scenario.missedContribution)}。金额币种 ${market==='US'?'USD':'EUR'}，待核实表示成本未知。</p><p>最晚空运启动 ${i.latestAirStart||'—'}；C策略空运参考量 ${num(i.airReference)} 件。情景不代表发生概率或历史损失。</p>`:''}</details></td></tr>`).join('')}</tbody></table></div></div></details>`;}).join(''):`<div class="empty"><div>↗</div><h3>第一份补货计划，从数据开始</h3><p>导入销量、库存和在途文件，或载入演示数据了解工作流程。</p></div>`}</section>
  <details class="panel settings"><summary>运输参数与计算口径</summary><form id="route">${Object.entries({prep:'国内交货代',sea:'海运运输',air:'空运运输',customs:'清关',shelf:'清关后至可售'}).map(([k,label])=>`<label>${label}（天）<input name="${k}" type="number" min="0" max="365" required value="${result.route[k]}"></label>`).join('')}<button class="primary">保存参数</button></form><p>A：安全21天 / 批量覆盖21天；B：10 / 14；C：5 / 7，默认不空运。预测采用7/14/30天加权均值。缺日期计零，明确不可售日剔除。按收货先于当日销售逐日模拟，缺货计损失销量。</p></details>
  <footer>${shared?'软件版本 '+esc(serverMode.version||'开发版')+' · ':''}首版规划工具 · 启发式规则需回测 · 不自动下采购单 · 未接通 TikTok 或领星 API</footer></main>`;
  if(shared) {
    reminders.badge();
    document.querySelector('#reminder-center').onclick=run(()=>reminders.open());
    document.querySelector('#check-update').onclick=run(()=>openUpdates(api,serverMode));
    document.querySelector('#refresh').onclick=run(async()=>{await loadShared();message='已载入主机最新数据';render();});
    document.querySelector('#logout').onclick=run(async()=>{await api('/api/logout',{method:'POST'});reminders.clear();login();});
  }
  const classify=(selected=[])=>openClassification({data,market,items:result.items,selected,save:async skuMappings=>{await commit({...data,skuMappings});}});
  document.querySelector('#classify-skus')?.addEventListener('click',run(()=>classify()));
  document.querySelectorAll('[data-classify-sku]').forEach(button=>button.onclick=run(()=>classify([button.dataset.classifySku])));
  document.querySelectorAll('[data-classify-group]').forEach(button=>button.onclick=run(()=>classify(result.items.filter(i=>i.product===button.dataset.classifyGroup).map(i=>i.sku))));
  document.querySelector('#asOf').onchange=run(e=>commit({...data,asOf:e.target.value}));
  document.querySelector('#demo').onclick=run(()=>{ if (data.sales.length||data.inventory.length||data.pipeline.length) { if (!confirm('载入演示将替换当前市场数据，团队模式下会影响所有同事；建议先导出工作区。继续？')) return; } return commit(demoData(market,data.asOf),true); });
  document.querySelector('#clear').onclick=run(()=>{if(confirm('清空当前市场的所有数据？团队模式下影响所有同事。请先导出备份。')) return commit(emptyData(data.asOf),false);});
  document.querySelector('#backup').onclick=()=>download(`stockpilot-${market}-${data.asOf}${isDemo?'-demo':''}.json`,JSON.stringify({ ...data, _demo:isDemo },null,2));
  document.querySelector('#export').onclick=()=>download(`plan-${market}-${data.asOf}${isDemo?'-demo':''}.csv`,csv(items.map(({daily,warnings,scenario,...i})=>({...i,demo:isDemo,warnings:warnings.join('；'),...scenario}))), 'text/csv;charset=utf-8');
  document.querySelector('#json').onchange=run(async e=>{const file=e.target.files[0];if(!file)return;const next=JSON.parse(await file.text());await commit(next,next._demo===true);});
  document.querySelectorAll('[data-kind]').forEach(el=>el.onchange=run(async e=>{const file=e.target.files[0];if(!file)return;const kind=e.target.dataset.kind;if(isDemo && !confirm('当前为演示数据。导入真实文件会先清空其他演示表，避免混用。继续？'))return;const base=isDemo?emptyData(data.asOf):data;
    const candidates=await parseImportFile(file,kind);
    let imported;
    if(candidates.length===1&&candidates[0].source==='standard') {
      imported=normalizeImport(candidates[0],{market,asOf:base.asOf});
      if(imported.report.errors.length)throw Error(imported.report.errors.slice(0,5).map(e=>e.reason).join('；'));
    } else imported=await confirmImport(candidates,{market,asOf:base.asOf,route:result.route});
    if(!imported)return;
    await commit({...base,[kind]:imported.rows,imports:{...base.imports,[kind]:imported.report}},false);}));
  document.querySelectorAll('[data-product]').forEach(el=>el.onchange=run(e=>{const overrides={...data.overrides};const k=market+'|'+e.target.dataset.product;if(e.target.value)overrides[k]=e.target.value;else delete overrides[k];return commit({...data,overrides});}));
  document.querySelector('#route').onsubmit=run(e=>{e.preventDefault();const route=Object.fromEntries([...new FormData(e.target)].map(([k,v])=>[k,Number(v)]));return commit({...data,routes:{...data.routes,[market]:route}});});
  document.querySelectorAll('[data-template]').forEach(el=>el.onclick=()=>{const kind=el.dataset.template;const examples={sales:{market,sku:'001',product:'款号',color:'黑色',size:'M',date:data.asOf,units:0,in_stock:true},inventory:{market,sku:'001',product:'款号',color:'黑色',size:'M',available:0,snapshot_date:data.asOf,warehouse:'TikTok专用仓'},pipeline:{market,sku:'001',qty:0,shipment_id:'填写唯一发货单号',eta:data.asOf,status:'in_transit'}};download(`${kind}-${market}-template.csv`,csv([examples[kind]]),'text/csv;charset=utf-8');});
}

async function api(url, options) {
  const r=await fetch(url,options);const value=await r.json();
  if(!r.ok){if(r.status===401)login();throw Error(value.error||'请求失败');}return value;
}
async function loadShared() {
  const saved=await api('/api/workspace/'+market);validate(saved.data,market);
  data=saved.data;isDemo=saved.isDemo;revision=saved.revision;storageWarning='';
  if(serverMode.canManageUpdates)try{const r=await fetch('/api/update/status');if(r.ok){const status=await r.json();if(['succeeded','rolled-back','needs-attention'].includes(status.phase))message=status.message;}}catch{}
}
function login() {
  expandedSpus.clear();
  reminders.clear();
  document.querySelector('#app').innerHTML=`<div class="login"><span class="eyebrow">STOCKPILOT / TEAM WORKSPACE</span><h1>登录团队工作区</h1><p>输入主机管理员提供的访问口令。团队数据统一保存在主机。</p><form id="login"><label>访问口令<input name="code" type="password" required autocomplete="current-password"></label><button class="primary">进入工作区</button></form><p id="notice" role="status" aria-live="polite"></p><small>仅在可信公司局域网使用；请勿将服务端口映射到公网。</small></div>`;
  document.querySelector('#login').onsubmit=run(async e=>{e.preventDefault();const code=new FormData(e.target).get('code');await api('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code})});await loadShared();render();void reminders.refresh();});
}
try {
  const response=await fetch('/api/mode');
  if(response.headers.get('content-type')?.includes('application/json')) {
    if(!response.ok)throw Error('无法读取团队服务状态');
    const mode=await response.json();serverMode=mode;shared=mode.shared===true;
    if(shared){if(mode.authenticated){await loadShared();render();}else login();}else render();
  } else render(); // Vite development mode has no team API.
} catch(e) {
  document.querySelector('#app').innerHTML='<div class="login"><h1>无法连接团队数据服务</h1><p>'+esc(e.message)+'。请刷新或联系管理员；未覆盖本地或主机数据。</p></div>';
}

if(shared){
  if(document.querySelector('#logout'))void reminders.refresh();
  setInterval(()=>{if(document.querySelector('#logout'))void reminders.refresh();},60000);
}
if(shared) setInterval(async()=>{
  if(busy || !document.querySelector('#logout') || document.activeElement?.matches('input,select'))return;
  const startedRevision=revision;
  try {
    const saved=await api('/api/workspace/'+market);
    if(busy || revision!==startedRevision)return;
    if(saved.revision!==revision){validate(saved.data,market);data=saved.data;isDemo=saved.isDemo;revision=saved.revision;message='已同步同事更新的数据';render();}
  } catch(e){const notice=document.querySelector('#notice');if(notice)notice.textContent=e.message;}
},5000);
