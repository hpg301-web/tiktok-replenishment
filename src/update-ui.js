const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function openUpdates(api,mode){
  const dialog=document.createElement('dialog');dialog.className='import-dialog update-dialog';
  dialog.innerHTML='<div class="section-title"><h2>软件在线更新</h2><button id="close-update">关闭</button></div><div class="import-body"><p id="update-status" role="status" aria-live="polite">正在检查官方更新…</p><div id="update-details"></div></div>';
  document.body.append(dialog);let installing=false,closed=false;
  const status=dialog.querySelector('#update-status'),details=dialog.querySelector('#update-details'),close=dialog.querySelector('#close-update');
  const remove=()=>{if(installing)return;closed=true;dialog.close();dialog.remove();};close.onclick=remove;dialog.addEventListener('cancel',e=>{if(installing)e.preventDefault();else {closed=true;dialog.remove();}});dialog.showModal();
  if(!mode.canManageUpdates){status.textContent='请在运行软件的主机上，用 http://localhost:5173 登录后检查更新。同事端刷新网页即可使用更新后的软件。';return;}
  try{
    const next=await api('/api/update/check',{method:'POST'});if(closed)return;
    if(next.updating){status.textContent='主机已有更新正在进行，请稍后刷新。';return;}
    status.textContent=next.available?'发现新版本':'当前已是最新版本';
    details.innerHTML=`<p>当前版本 ${esc(next.currentVersion)} → 官方版本 ${esc(next.version)}</p><p>${esc(next.notes)}</p><p>更新前自动备份程序及团队数据；重启期间同事暂时不能操作，完成后需重新登录。</p>`;
    if(!next.supported){details.insertAdjacentHTML('beforeend','<p>此运行方式不支持自动安装。请在 Windows 部署版主机使用；旧版需要先手动升级一次。</p>');return;}
    if(!next.available)return;
    const button=document.createElement('button');button.className='primary';button.textContent='备份并更新';details.append(button);
    button.onclick=async()=>{
      if(!confirm('现在备份并更新主机？更新期间所有同事将暂时无法修改数据，完成后需要重新登录。'))return;
      installing=true;button.disabled=true;close.disabled=true;status.textContent='正在下载并校验更新包，请保持主机开机…';
      try{
        await api('/api/update/install',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({buildId:next.buildId,confirmed:true})});
        status.textContent='已备份，正在重启并验证新版。完成后页面将自动刷新。';
        let offline=false;
        for(let i=0;i<120;i++){
          await new Promise(r=>setTimeout(r,1500));
          try{
            const response=await fetch('/api/mode',{signal:AbortSignal.timeout(1500)});if(!response.ok){offline=true;continue;}const latest=await response.json();
            if(latest.buildId===next.buildId && !latest.maintenance){location.reload();return;}
            const result=await fetch('/api/update/status',{signal:AbortSignal.timeout(1500)});
            if(result.ok){const s=await result.json();if(['failed','rolled-back','needs-attention'].includes(s.phase))throw Object.assign(Error(s.message),{finished:true});}
            if(offline && !latest.authenticated && !latest.maintenance){status.textContent='主机服务已恢复，请重新登录查看更新结果。';installing=false;close.disabled=false;close.textContent='刷新并登录';close.onclick=()=>location.reload();return;}
          }catch(e){if(e.finished)throw e;offline=true;}
        }
        throw Error('更新仍未就绪，请稍后刷新；如仍不可用，请查看主机 .stockpilot/update-worker.log。备份位于 .stockpilot/updates。');
      }catch(e){status.textContent=e.message;installing=false;close.disabled=false;button.disabled=true;}
    };
  }catch(e){if(!closed)status.textContent=e.message;}
}
