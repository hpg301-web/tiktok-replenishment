import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { plan, dateNumber } from '../src/engine.js';
export const DEFAULT_SETTINGS=Object.freeze({enabled:true,markets:['US'],timeZone:'Asia/Shanghai',dailyTime:'09:00',intervalMinutes:15,lookAheadDays:7,notifyOnUrgent:true});
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function clockParts(now,timeZone){
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
  return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`};
}
export function validateSettings(input,{legacy=false}={}){
  if(!input||typeof input!=='object')throw Error('提醒设置必须为对象');
  if(typeof input.enabled!=='boolean'||typeof input.notifyOnUrgent!=='boolean')throw Error('开关必须为布尔值');
  if(!Array.isArray(input.markets)||!input.markets.length||input.markets.length>2||new Set(input.markets).size!==input.markets.length||input.markets.some(m=>!['US','DE'].includes(m)))throw Error('监控市场无效');
  if(!legacy&&(input.markets.length!==1||input.markets[0]!=='US'))throw Error('当前仅监控美国，德国监控暂未开放');
  if(typeof input.timeZone!=='string'||input.timeZone.length>80)throw Error('提醒时区无效');
  new Intl.DateTimeFormat('en-CA',{timeZone:input.timeZone});
  if(!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input.dailyTime))throw Error('每日汇总时间必须为HH:MM');
  if(!Number.isInteger(input.intervalMinutes)||input.intervalMinutes<5||input.intervalMinutes>1440)throw Error('巡检间隔须为5–1440分钟');
  if(!Number.isInteger(input.lookAheadDays)||input.lookAheadDays<1||input.lookAheadDays>30)throw Error('提前提醒天数须为1–30天');
  return Object.fromEntries(Object.keys(DEFAULT_SETTINGS).map(k=>[k,input[k]]));
}
const ignoredPipeline=r=>r.qty===0||['received','completed','cancelled','已入库','已完成','已取消'].includes(r.status);
export function assessWorkspace(saved,market,{today,lookAheadDays}){
  const alerts=[];
  const productsBySku=new Map([...(saved?.data?.sales||[]),...(saved?.data?.pipeline||[]),...(saved?.data?.inventory||[])].filter(r=>r.product).map(r=>[r.sku,r.product]));
  const add=value=>{
    const alert={market,sku:null,product:null,sea:null,air:null,deadline:null,...value};
    alert.spu=alert.sku&&productsBySku.get(alert.sku)===alert.product?alert.product:null;
    alert.id=hash([market,alert.sku,alert.type,alert.mode||'']);alert.fingerprint=hash(alert);alerts.push(alert);
  };
  if(!saved?.revision){add({type:'data-missing',level:'data',title:'请先导入市场数据',message:'缺少已保存的销量、库存与在途；不能判断何时补货。',action:'导入最新三类数据后重新巡检'});return alerts;}
  if(saved.isDemo){add({type:'demo',level:'data',title:'当前为演示数据',message:'演示数据不生成真实补货指令。',action:'导入真实数据'});return alerts;}
  const data=saved.data;
  if(data.asOf!==today){add({type:'data-stale',level:'data',title:data.asOf<today?'分析数据已过期':'分析日期晚于今天',message:`当前分析日期 ${data.asOf}，提醒时区今天为 ${today}。不会把旧库存推算成实时库存或给出可执行数量。`,action:'更新销量与当日库存快照，并核实在途ETA',dataDate:data.asOf});return alerts;}
  if(!data.sales.length){add({type:'data-missing-sales',level:'data',title:'缺少有效销量历史',message:'没有销量记录不等于明确零需求，不能据此判断无需补货。',action:'导入有效出库销量；如确实无销量，请提供明确的零销量历史记录'});return alerts;}
  const result=plan(data,market),actions=new Map(result.products.map(p=>[p.product,p.adoptedAction]));
  for(const item of result.items){
    if(item.available===null){
      add({type:'stock-unverified',level:'data',sku:item.sku,product:item.product,title:'库存快照待核实',message:'缺少当日库存快照；缺失不等于零库存，暂不提供补货数量。',action:'导入同日可用库存并核对SKU'});continue;
    }
    if(actions.get(item.product)==='stop')continue;
    for(const mode of ['sea','air']){
      const quantity=item[mode],deadline=item[mode==='sea'?'latestSeaStart':'latestAirStart'];
      if(!(quantity>0)||!deadline)continue;
      const days=dateNumber(deadline)-dateNumber(today);
      if(days>lookAheadDays)continue;
      const name=mode==='sea'?'海运':'空运';
      add({type:'replenish',mode,level:days<=0?'urgent':'soon',sku:item.sku,product:item.product,title:days<0?`${name}最晚启动日已过`:days===0?`今天应启动${name}`:`${days}天内准备${name}`,deadline,sea:mode==='sea'?quantity:0,air:mode==='air'?quantity:0,message:`最晚启动 ${deadline}，计划 ${quantity} 件；预计可售 ${item[mode==='sea'?'seaDate':'airDate']}。${item.beforeAir>0?`空运可售前仍有约 ${Math.ceil(item.beforeAir)} 件缺口。`:''}`,action:'核实MOQ、箱规、国内供给、预算和运费后人工安排'});
    }
    if(item.firstStockout && dateNumber(item.firstStockout)-dateNumber(today)<=lookAheadDays){
      add({type:'stockout',level:'urgent',sku:item.sku,product:item.product,deadline:item.firstStockout,title:'预计即将缺货',message:`按现货及已确认在途，首次预计缺货 ${item.firstStockout}。新发空运前仍无法弥补的缺口约 ${Math.ceil(item.beforeAir)} 件。`,action:'优先核实供给与活动计划；晚到货不能抵扣早期缺口'});
    }
  }
  const issues=new Map();
  for(const shipment of data.pipeline){
    if(ignoredPipeline(shipment))continue;
    const reason=!shipment.shipment_id?'missing-id':!shipment.eta?'unknown':shipment.eta<today?'overdue':null;
    if(!reason)continue;
    const key=shipment.sku+'|'+reason;if(!issues.has(key))issues.set(key,{sku:shipment.sku,reason,count:0,qty:0});
    const issue=issues.get(key);issue.count++;issue.qty+=shipment.qty;
  }
  for(const issue of issues.values())add({product:productsBySku.get(issue.sku)||null,type:'pipeline-'+issue.reason,level:'data',sku:issue.sku,title:issue.reason==='overdue'?'在途ETA已逾期':issue.reason==='unknown'?'在途可售ETA未知':'在途缺少单号',message:`${issue.count}条记录、${issue.qty}件尚未验证为准时可用供给，未抵扣补货需求。`,action:'更新逐票上架可售ETA，并排除已入库数量'});
  return alerts;
}
export async function createReminderAgent({store,dataDir,now=()=>new Date(),heartbeatMs=60000}){
  await mkdir(dataDir,{recursive:true});
  async function readJSON(name,fallback){try{return JSON.parse(await readFile(join(dataDir,name),'utf8'));}catch(e){if(e.code==='ENOENT')return fallback;throw Error('提醒配置或状态文件无法读取；未覆盖原文件，请从备份核实');}}
  let config=await readJSON('agent-settings.json',{revision:0,settings:{...DEFAULT_SETTINGS,markets:[...DEFAULT_SETTINGS.markets]}});
  const storedSettings=validateSettings(config.settings,{legacy:true});
  let scopeChanged=storedSettings.markets.length!==1||storedSettings.markets[0]!=='US';
  config={revision:config.revision,settings:validateSettings({...storedSettings,markets:['US']})};
  if(!Number.isSafeInteger(config.revision)||config.revision<0)throw Error('提醒配置版本无效');
  let state=await readJSON('agent-state.json',{schema:1,alerts:[],acks:{},history:[],notification:null,lastDailyDay:null,lastUrgentSignature:'',lastCheckedAt:null});
  if(state.schema!==1||!Array.isArray(state.alerts)||!state.acks||!Array.isArray(state.history))throw Error('提醒状态无效，未覆盖原文件');
  let queue=Promise.resolve(),timer=null,debounce=null,lastError=null,paused=false;
  const enqueue=fn=>{const operation=queue.then(fn);queue=operation.catch(()=>{});return operation;};
  async function persist(name,value){const file=join(dataDir,name),tmp=file+'.tmp';await writeFile(tmp,JSON.stringify(value),{mode:0o600});await rename(tmp,file);}
  function summary(){const scopedAlerts=state.alerts.filter(a=>a.market==='US');const counts={urgent:0,soon:0,data:0};for(const a of scopedAlerts)counts[a.level]++;
    return {enabled:config.settings.enabled,settingsRevision:config.revision,settings:config.settings,lastCheckedAt:state.lastCheckedAt,checkedDate:state.checkedDate,trigger:state.trigger,alerts:scopedAlerts.map(a=>({...a,read:state.acks[a.id]?.fingerprint===a.fingerprint})),counts,unread:scopedAlerts.filter(a=>state.acks[a.id]?.fingerprint!==a.fingerprint).length,notification:scopedAlerts.length===state.alerts.length?state.notification:null,history:state.history.slice(-10),error:lastError,maintenance:paused||existsSync(join(dataDir,'update-lock'))};}
  async function evaluate(trigger,force){
    if(paused||existsSync(join(dataDir,'update-lock')))return summary();
    const clock=clockParts(now(),config.settings.timeZone),timestamp=now().toISOString(),settings=config.settings;
    const digestDue=settings.enabled&&clock.time>=settings.dailyTime&&state.lastDailyDay!==clock.date;
    if(!force&&!scopeChanged&&!state.alerts.some(a=>a.market!=='US'||!Object.hasOwn(a,'spu'))&&!digestDue&&state.checkedDate===clock.date&&state.lastCheckedAt&&now()-new Date(state.lastCheckedAt)<settings.intervalMinutes*60000)return summary();
    const previous=new Map(state.alerts.map(a=>[a.id,a]));const alerts=[];
    if(settings.enabled)for(const market of settings.markets){
      try{alerts.push(...assessWorkspace(await store.read(market),market,{today:clock.date,lookAheadDays:settings.lookAheadDays}));}
      catch{const alert={market,type:'data-error',sku:null,product:null,spu:null,level:'data',title:'市场数据无法读取',message:'已保存数据未通过校验或读取失败；没有生成采购数量。',action:'检查主机数据及备份',sea:null,air:null,deadline:null};alert.id=hash([market,alert.type]);alert.fingerprint=hash(alert);alerts.push(alert);}
    }
    const rank={urgent:0,soon:1,data:2};alerts.sort((a,b)=>rank[a.level]-rank[b.level]||(a.deadline||'9999').localeCompare(b.deadline||'9999')||a.market.localeCompare(b.market)||(a.sku||'').localeCompare(b.sku||''));
    for(const a of alerts)a.firstSeenAt=previous.get(a.id)?.firstSeenAt||timestamp;
    const urgent=alerts.filter(a=>a.level==='urgent'),urgentSignature=urgent.length?hash(urgent.map(a=>a.fingerprint).sort()):'';
    const changedUrgent=settings.notifyOnUrgent&&urgentSignature&&urgentSignature!==state.lastUrgentSignature;
    const counts={urgent:urgent.length,soon:alerts.filter(a=>a.level==='soon').length,data:alerts.filter(a=>a.level==='data').length};
    const next={...state,alerts,checkedDate:clock.date,lastCheckedAt:timestamp,trigger,lastUrgentSignature:urgentSignature,history:[...state.history,{at:timestamp,trigger,counts}].slice(-100)};
    if(digestDue)next.lastDailyDay=clock.date;
    const signature=hash(alerts.map(a=>a.fingerprint));
    if(next.notification?.signature!==signature)next.notification=null;
    if(settings.enabled&&alerts.length&&(digestDue||changedUrgent))next.notification={id:hash([timestamp,counts,urgentSignature,clock.date]),createdAt:timestamp,title:'StockPilot 补货提醒',body:`今天需处理 ${counts.urgent} 项，即将到期 ${counts.soon} 项，资料待核实 ${counts.data} 项。请打开提醒中心查看；不会自动下单。`,reason:digestDue?'daily':'urgent',signature};
    if(!settings.enabled||!alerts.length)next.notification=null;
    const active=new Set(alerts.map(a=>a.id));next.acks=Object.fromEntries(Object.entries(state.acks).filter(([id])=>active.has(id)));
    await persist('agent-state.json',next);state=next;scopeChanged=false;lastError=null;return summary();
  }
  function check(trigger='manual',force=true){return enqueue(async()=>{try{return await evaluate(trigger,force);}catch(e){lastError='巡检未能保存，请检查主机磁盘和提醒文件；旧结果未覆盖。';throw Object.assign(Error(lastError),{status:503});}});}
  const agent={
    snapshot:()=>check('view',false),check,
    trigger(){if(paused)return;clearTimeout(debounce);debounce=setTimeout(()=>{void check('import',true).catch(()=>{});},500);debounce.unref?.();},
    start(){if(timer)return;paused=false;timer=setInterval(()=>{void check('scheduled',false).catch(()=>{});},heartbeatMs);timer.unref?.();void check('startup',true).catch(()=>{});},
    async stop(){paused=true;clearInterval(timer);clearTimeout(debounce);timer=null;await queue;},
    async pause(){paused=true;clearTimeout(debounce);await queue;},resume(){paused=false;},
    saveSettings(input,revision){return enqueue(async()=>{
      if(paused||existsSync(join(dataDir,'update-lock')))throw Object.assign(Error('更新期间不能更改提醒设置'),{status:503});
      if(revision!==config.revision)throw Object.assign(Error('设置已被更改，请重新打开提醒中心'),{status:409});
      const settings=validateSettings(input),next={revision:config.revision+1,settings};await persist('agent-settings.json',next);config=next;return evaluate('settings',true);
    });},
    acknowledge(id,fingerprint){return enqueue(async()=>{
      if(paused||existsSync(join(dataDir,'update-lock')))throw Object.assign(Error('更新期间不能更改已读状态'),{status:503});
      const alert=state.alerts.find(a=>a.id===id);if(!alert||alert.fingerprint!==fingerprint)throw Object.assign(Error('提醒已变化，请刷新后再标记'),{status:409});
      const next={...state,acks:{...state.acks,[id]:{fingerprint,at:now().toISOString()}}};await persist('agent-state.json',next);state=next;return summary();
    });}
  };return agent;
}
