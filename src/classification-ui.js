const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function openClassification({data,market,items,selected=[],save}){
  let finish;const closed=new Promise(resolve=>finish=resolve);
  const dialog=document.createElement('dialog');dialog.className='import-dialog classification-dialog';document.body.append(dialog);
  const mappings={...data.skuMappings},chosen=new Set(selected),all=[...items].sort((a,b)=>(a.productSource==='unknown'?0:1)-(b.productSource==='unknown'?0:1)||a.sku.localeCompare(b.sku));
  const products=[...new Set([...items.filter(i=>i.productSource!=='unknown').map(i=>i.product),...Object.entries(mappings).filter(([k])=>k.startsWith(market+'|')).map(([,v])=>v)])].sort();
  let filter='unknown',search='',locked=false;
  function close(){if(!locked){dialog.close();dialog.remove();finish();}}
  dialog.innerHTML=`<div class="section-title"><div><span class="eyebrow">SKU → SPU / ${market}</span><h2>手动归类SKU</h2></div><button id="classification-close">关闭</button></div><form id="classification-form"><div class="import-body"><p>选择SKU，归入已有SPU或输入新SPU。规则按国家保存，后续导入继续使用；原始表中的SPU不被改写。缺失SPU时按“SPU＋两位颜色编码_尺码”自动识别，手动归类优先。</p><p>归类后使用目标SPU的策略和经营参数，不自动迁移原SPU参数。每个颜色尺码仍独立计算库存和数量。</p><div class="classification-controls"><label>筛选<select id="classification-filter"><option value="unknown">SPU待识别</option><option value="all">全部SKU</option><option value="rule">按编码识别</option><option value="manual">已手动归类</option></select></label><label>搜索SKU<input id="classification-search" type="search" placeholder="输入SKU或SPU"></label><button type="button" id="classification-select">选择当前筛选结果</button><button type="button" id="classification-clear">取消全部选择</button></div><p id="classification-count" role="status"></p><div class="classification-list" id="classification-list"></div><label class="classification-target">目标SPU（可选已有或输入新建）<input name="spu" list="spu-options" maxlength="200" autocomplete="off" placeholder="选择已有SPU或输入新SPU"><datalist id="spu-options">${products.map(p=>`<option value="${esc(p)}"></option>`).join('')}</datalist></label><p id="classification-error" role="status" aria-live="polite"></p></div><div class="panel-foot"><button type="button" id="classification-reset">恢复所选SKU自动识别</button><button class="primary" id="classification-save" type="submit">保存归类</button></div></form>`;
  const list=dialog.querySelector('#classification-list'),count=dialog.querySelector('#classification-count'),error=dialog.querySelector('#classification-error');
  const filtered=()=>all.filter(i=>(filter==='all'||filter==='unknown'&&i.productSource==='unknown'||filter==='manual'&&Object.hasOwn(mappings,market+'|'+i.sku)||filter==='rule'&&i.productSource==='rule')&&(!search||(i.sku+' '+i.product).toLowerCase().includes(search.toLowerCase())));
  function update(){
    const rows=filtered();count.textContent=`已选 ${chosen.size} 个SKU · 当前筛选 ${rows.length} 个`;
    list.innerHTML=rows.length?rows.map(i=>`<label class="classification-row"><input type="checkbox" data-sku="${esc(i.sku)}" ${chosen.has(i.sku)?'checked':''}><span><b>${esc(i.sku)}</b><small>${esc(i.color)}${i.colorCode?' · 编码 '+esc(i.colorCode):''} ${esc(i.size)}</small></span><span>${i.productSource==='unknown'?'SPU待识别':esc(i.product)}${i.productSource==='manual'?' · 手动归类':i.productSource==='rule'?' · 编码识别':''}</span></label>`).join(''):'<p>当前筛选没有SKU，可切换“全部SKU”或“已手动归类”。</p>';
    list.querySelectorAll('[data-sku]').forEach(input=>input.onchange=()=>{if(input.checked)chosen.add(input.dataset.sku);else chosen.delete(input.dataset.sku);count.textContent=`已选 ${chosen.size} 个SKU · 当前筛选 ${filtered().length} 个`;});
  }
  dialog.querySelector('#classification-filter').onchange=e=>{filter=e.target.value;update();};
  dialog.querySelector('#classification-search').oninput=e=>{search=e.target.value.trim();update();};
  dialog.querySelector('#classification-select').onclick=()=>{filtered().forEach(i=>chosen.add(i.sku));update();};
  dialog.querySelector('#classification-clear').onclick=()=>{chosen.clear();update();};
  dialog.querySelector('#classification-close').onclick=close;
  dialog.addEventListener('cancel',e=>{if(locked)e.preventDefault();else {dialog.remove();finish();}});
  async function persist(reset){
    error.textContent='';if(!chosen.size){error.textContent='请至少选择一个SKU';return;}
    const spu=new FormData(dialog.querySelector('form')).get('spu').trim();if(!reset&&!spu){error.textContent='请选择或输入目标SPU';return;}
    const next={...mappings};for(const sku of chosen){const key=market+'|'+sku;if(reset)delete next[key];else next[key]=spu;}
    if(reset&&!confirm('移除所选SKU的手动归类，恢复来源字段或SKU编码自动识别？'))return;
    if(!reset&&!confirm(`确认将 ${chosen.size} 个SKU归入“${spu}”？将采用该SPU的策略及经营参数。`))return;
    locked=true;dialog.querySelectorAll('button,input,select').forEach(e=>e.disabled=true);
    try{await save(next);locked=false;close();}catch(e){locked=false;dialog.querySelectorAll('button,input,select').forEach(e=>e.disabled=false);error.textContent=e.message;}
  }
  dialog.querySelector('form').onsubmit=e=>{e.preventDefault();void persist(false);};
  dialog.querySelector('#classification-reset').onclick=()=>void persist(true);
  if(selected.length)filter='all';dialog.querySelector('#classification-filter').value=filter;
  update();dialog.showModal();return closed;
}
