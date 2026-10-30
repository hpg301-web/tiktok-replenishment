const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function confirmHistoryClear({title='清除历史记录',description,details=[],clear}){
  let finish;const completed=new Promise(resolve=>finish=resolve);
  const dialog=document.createElement('dialog');dialog.className='import-dialog clear-history-dialog';let running=false;
  dialog.innerHTML=`<div class="section-title"><h2>${esc(title)}</h2></div><div class="import-body"><p>${esc(description)}</p>${details.length?`<ul>${details.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`:''}<p id="clear-history-error" role="status" aria-live="polite"></p></div><div class="panel-foot"><button id="cancel-history-clear" autofocus>取消</button><button id="confirm-history-clear" class="danger">确认清除</button></div>`;
  const cancel=()=>{if(!running){dialog.close();dialog.remove();finish(false);}};
  dialog.querySelector('#cancel-history-clear').onclick=cancel;
  dialog.addEventListener('cancel',event=>{event.preventDefault();cancel();});
  dialog.querySelector('#confirm-history-clear').onclick=async()=>{
    if(running)return;running=true;dialog.querySelectorAll('button').forEach(button=>button.disabled=true);
    try{await clear();dialog.close();dialog.remove();finish(true);}
    catch(error){running=false;dialog.querySelectorAll('button').forEach(button=>button.disabled=false);dialog.querySelector('#clear-history-error').textContent=error.message;}
  };
  document.body.append(dialog);dialog.showModal();return completed;
}
