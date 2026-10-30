const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const PREF='stockpilot.reminderNotifications.v1',LAST='stockpilot.reminderLastNotification.v1';
const fmt=date=>date?new Date(date).toLocaleString('zh-CN',{hour12:false}):'尚未巡检';
export function createReminderClient({api,mode}){
  let snapshot=null,dialog=null,shown=100,error='';
  const preference=()=>{try{return localStorage.getItem(PREF)==='on';}catch{return false;}};
  function badge(){const b=document.querySelector('#reminder-center');if(!b)return;b.textContent=snapshot?`补货提醒${snapshot.unread?' · '+snapshot.unread:''}`:'补货提醒';b.classList.toggle('has-alerts',!!snapshot?.counts.urgent);}
  async function notify(){
    const event=snapshot?.notification;
    if(!snapshot?.enabled||snapshot.maintenance||!event||!preference()||!('Notification'in window)||Notification.permission!=='granted'||Date.now()-Date.parse(event.createdAt)>86400000)return;
    const send=async()=>{
      try{if(localStorage.getItem(LAST)===event.id)return;localStorage.setItem(LAST,event.id);}catch{return;}
      const n=new Notification(event.title,{body:event.body,tag:'stockpilot-replenishment'});
      n.onclick=()=>{window.focus();void open();n.close();};
    };
    try{if(navigator.locks)await navigator.locks.request('stockpilot-reminder-notification',send);else if(document.visibilityState==='visible')await send();}catch{}
  }
  async function refresh(force=false){
    try{snapshot=await api(force?'/api/agent/check':'/api/agent',force?{method:'POST'}:undefined);error='';badge();await notify();if(dialog?.open&&(force||!dialog.contains(document.activeElement)||!dialog.querySelector('#agent-settings')))draw();return snapshot;}
    catch(e){error=e.message;if(dialog?.open)draw();return null;}
  }
  function draw(){
    if(!dialog)return;
    if(!snapshot){dialog.innerHTML=`<div class="section-title"><h2>补货提醒 Agent</h2><button id="agent-close">关闭</button></div><div class="import-body"><p role="alert">${esc(error||'正在读取巡检结果…')}</p></div>`;dialog.querySelector('#agent-close').onclick=()=>dialog.close();return;}
    const s=snapshot,settings=s.settings;
    const notificationCapable=window.isSecureContext&&('Notification'in window);
    dialog.innerHTML=`<div class="section-title"><div><span class="eyebrow">REPLENISHMENT AGENT</span><h2>补货提醒中心</h2></div><button id="agent-close">关闭</button></div><div class="import-body"><p>状态：${s.maintenance?'更新维护中，巡检暂停':s.enabled?'自动巡检已开启':'已暂停'} · 上次巡检 ${esc(fmt(s.lastCheckedAt))}</p><p>按 ${esc(settings.timeZone)} 的当天核对资料；每天 ${esc(settings.dailyTime)} 左右汇总，每 ${settings.intervalMinutes} 分钟检查，导入后重评。</p><p id="agent-error" role="status" aria-live="polite">${esc(error||s.error||'')}</p><div class="agent-metrics"><span>今天需处理 <b>${s.counts.urgent}</b></span><span>即将到期 <b>${s.counts.soon}</b></span><span>资料待核实 <b>${s.counts.data}</b></span></div><div class="agent-controls"><button id="agent-check" class="primary">立即巡检</button><button id="agent-notifications" ${notificationCapable?'':'disabled'}>${preference()?'关闭本浏览器通知':'开启本浏览器通知'}</button></div><p>${notificationCapable?'通知需浏览器授权，并保持页面打开；页面关闭或主机停机时不会发送桌面通知。':'当前地址不支持浏览器通知；主机可用localhost，其他电脑需HTTPS。软件内提醒不受影响。'}通知偏好仅保存在此浏览器；已读状态为团队共享，已读不代表已完成补货。</p>
      <div class="agent-list">${s.alerts.length?s.alerts.slice(0,shown).map(a=>`<article class="agent-alert ${a.level}"><div><span class="agent-market">${a.market}</span> <strong>${esc(a.title)}</strong> <span class="muted">${a.read?'已读':'未读'}</span></div><h3>${esc(a.product||'市场数据')} ${a.sku?'· '+esc(a.sku):''}</h3><p>${esc(a.message)}</p><p>${a.deadline?'处理日期 '+esc(a.deadline)+' · ':''}${a.type==='replenish'?`海运 ${a.sea} / 空运 ${a.air} 件 · `:''}${esc(a.action)}</p><button class="text" data-ack="${a.id}" ${a.read?'disabled':''}>${a.read?'已读':'标记已读'}</button></article>`).join(''):'<p>当前没有待处理提醒。请确保三类业务数据持续更新；Agent不会自动获取TikTok或领星的新数据。</p>'}</div>${s.alerts.length>shown?'<button id="agent-more">查看更多提醒</button>':''}
      <details class="agent-settings"><summary>自动巡检设置${mode().canManageAgent?'':'（主机管理）'}</summary><form id="agent-settings"><fieldset ${mode().canManageAgent&&!s.maintenance?'':'disabled'}><label class="check"><input name="enabled" type="checkbox" ${settings.enabled?'checked':''}>开启自动巡检</label><div class="agent-settings-grid"><label>每日汇总时间<input name="dailyTime" type="time" value="${esc(settings.dailyTime)}" required></label><label>提醒与资料日期时区<select name="timeZone">${[...new Set([settings.timeZone,'Asia/Shanghai','America/Los_Angeles','America/New_York','Europe/Berlin'])].map(z=>`<option ${z===settings.timeZone?'selected':''}>${esc(z)}</option>`).join('')}</select></label><label>巡检间隔（分钟）<input name="intervalMinutes" type="number" min="5" max="1440" value="${settings.intervalMinutes}" required></label><label>提前提醒（天）<input name="lookAheadDays" type="number" min="1" max="30" value="${settings.lookAheadDays}" required></label></div><label class="check"><input name="market" value="US" type="checkbox" ${settings.markets.includes('US')?'checked':''}>美国</label><label class="check"><input name="market" value="DE" type="checkbox" ${settings.markets.includes('DE')?'checked':''}>德国</label><label class="check"><input name="notifyOnUrgent" type="checkbox" ${settings.notifyOnUrgent?'checked':''}>发现新的紧急风险时立即生成通知</label><button class="primary">保存巡检设置</button></fieldset></form><p>仅主机通过localhost登录后可修改设置。旧数据只提示更新，不生成当日可执行数量。停补产品不触发补货指令；不会自动下采购单或判断空运利润最优。</p></details></div>`;
    dialog.querySelector('#agent-close').onclick=()=>dialog.close();
    dialog.querySelector('#agent-check').onclick=()=>void refresh(true);
    dialog.querySelector('#agent-notifications').onclick=async()=>{
      try{
        if(preference()){localStorage.setItem(PREF,'off');draw();return;}
        const permission=await Notification.requestPermission();
        if(permission!=='granted'){error='浏览器尚未允许通知；如已拒绝，请在浏览器网站设置中调整。';draw();return;}
        localStorage.setItem(PREF,'on');draw();await notify();
      }catch{error='当前浏览器不能启用通知，请使用提醒中心。';draw();}
    };
    dialog.querySelectorAll('[data-ack]').forEach(button=>button.onclick=async()=>{const alert=s.alerts.find(a=>a.id===button.dataset.ack);try{snapshot=await api('/api/agent/ack',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:alert.id,fingerprint:alert.fingerprint})});error='';badge();draw();}catch(e){error=e.message;draw();}});
    dialog.querySelector('#agent-more')?.addEventListener('click',()=>{shown+=100;draw();});
    dialog.querySelector('#agent-settings').onsubmit=async event=>{
      event.preventDefault();const f=new FormData(event.target);
      try{snapshot=await api('/api/agent/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:s.settingsRevision,settings:{enabled:f.has('enabled'),dailyTime:f.get('dailyTime'),timeZone:f.get('timeZone'),intervalMinutes:Number(f.get('intervalMinutes')),lookAheadDays:Number(f.get('lookAheadDays')),markets:f.getAll('market'),notifyOnUrgent:f.has('notifyOnUrgent')}})});error='设置已保存并重新巡检';badge();draw();await notify();}
      catch(e){error=e.message;draw();}
    };
  }
  async function open(){if(dialog?.open){await refresh(true);return;}dialog=document.createElement('dialog');dialog.className='import-dialog agent-dialog';document.body.append(dialog);dialog.addEventListener('close',()=>{dialog.remove();dialog=null;});draw();dialog.showModal();await refresh(true);}
  return {refresh,open,badge,clear(){snapshot=null;},isOpen:()=>!!dialog?.open};
}
