import { normalizeImport, warehouseKey } from './importer.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function confirmImport(candidates,{market,asOf,route}){
  return new Promise(resolve=>{
    const dialog=document.createElement('dialog');dialog.className='import-dialog';
    document.body.append(dialog);
    let info=candidates[0],preview;
    function fill(){
      const dedicated=market==='US'&&info.warehouses.length>0&&info.warehouses.every(w=>['鲸仓美东仓','鲸仓美西仓'].includes(warehouseKey(w)));
      dialog.innerHTML=`<form id="import-form"><div class="section-title"><div><span class="eyebrow">SMART IMPORT</span><h2>自动识别与导入预览</h2></div><button type="button" id="cancel-import">取消</button></div><div class="import-body"><p>${esc(info.fileName)} · 当前${market}工作区</p><label>识别到的工作表 <select name="sheet">${candidates.map((c,i)=>`<option value="${i}" ${c===info?'selected':''}>${esc(c.sheetName)} · ${esc(c.source)}</option>`).join('')}</select></label><details><summary>已自动匹配 ${info.mapping.length} 个字段</summary><p>${info.mapping.map(m=>esc(m.column)+' → '+esc(m.field)).join('；')}</p></details>
      ${info.source==='tiktok'?`<label>订单日期格式 <select name="dateOrder"><option value="MDY" ${market==='US'?'selected':''}>月/日/年（美国导出）</option><option value="DMY" ${market==='DE'?'selected':''}>日/月/年（欧洲导出）</option></select></label><p>只统计有付款与实际发货时间的出库件数；不计待发货/待揽收。退货不自动加回库存。</p>`:''}
      ${info.source==='lingxing'?`<fieldset><legend>${info.kind==='pipeline'?'目标收货仓':'库存仓库'}</legend>${info.warehouses.map(w=>`<label class="check"><input type="checkbox" name="warehouse" value="${esc(w)}" checked>${esc(w)}</label>`).join('')}</fieldset><label class="check"><input name="scopeConfirmed" type="checkbox" ${dedicated?'checked':''}>所选仓库的库存/在途为 TikTok 专用${dedicated?'（鲸仓美东/美西已按本次业务确认）':''}</label>`:''}
      ${!info.markets.length?`<label class="check"><input name="marketConfirmed" type="checkbox" ${info.source==='lingxing'&&dedicated?'checked':''}>确认此文件所选数据属于 ${market} 市场（国家缺失时使用）</label>`:''}
      ${info.source==='lingxing'&&info.kind==='inventory'?`<label>库存快照日期 <input name="snapshotDate" type="date" value="${esc(info.suggestedDate||asOf)}" required></label><label class="check"><input name="snapshotConfirmed" type="checkbox">确认该日期为库存快照日期，且是当日销售开始前的可用量；导出日期仅作候选，不自动认定</label>`:''}
      ${info.source==='lingxing'&&info.kind==='pipeline'?`<label>“预计到货时间”的业务含义 <select name="etaMeaning"><option value="unknown">暂不确定：保留在途，不抵扣可用供给</option><option value="port">预计到港/机场（再加清关和上架时间）</option><option value="customs">预计清关完成（再加上架时间）</option><option value="sellable">已是预计上架可售日（不再加时间）</option></select></label><p>原始日期不会被改成今天。逾期记录不会抵扣准时可用供给；如日期已失效，请更新源表或标准在途模板。</p>`:''}
      <div id="import-preview" aria-live="polite"></div></div><div class="panel-foot"><span>只保存规范化业务字段，不采集买家姓名、电话、地址或支付信息。</span><button type="submit" id="apply-import" class="primary">导入当前市场</button></div></form>`;
      dialog.querySelector('[name="sheet"]').onchange=e=>{info=candidates[Number(e.target.value)];fill();};
      const form=dialog.querySelector('form');
      function update(){
        const f=new FormData(form);
        try {
          preview=normalizeImport(info,{market,asOf,route,warehouses:f.getAll('warehouse'),scopeConfirmed:f.has('scopeConfirmed'),marketConfirmed:f.has('marketConfirmed'),snapshotConfirmed:f.has('snapshotConfirmed'),snapshotDate:f.get('snapshotDate'),dateOrder:f.get('dateOrder')||'MDY',etaMeaning:f.get('etaMeaning')||'unknown'});
          const r=preview.report;
          const counts=Object.entries(r.excluded.reduce((acc,e)=>(acc[e.reason]=(acc[e.reason]||0)+1,acc),{}));
          dialog.querySelector('#import-preview').innerHTML=`<h3>源记录 ${r.total} · 接受 ${r.accepted} · 排除 ${r.excluded.length} · 输出 ${r.output}</h3><p>合计 ${r.units} 件${info.kind==='pipeline'?'；可计入准时供给 '+r.eligibleUnits+' 件（未知/逾期ETA不抵扣）':''}</p><p>${counts.map(([why,n])=>esc(why)+'：'+n).join('；')}</p>${r.warnings.map(w=>`<p class="import-warning">${esc(w)}</p>`).join('')}${r.errors.length?`<p role="alert">${r.errors.slice(0,8).map(e=>`${e.row?'第'+e.row+'行：':''}${esc(e.reason)}`).join('<br>')}${r.errors.length>8?'<br>另有 '+(r.errors.length-8)+' 项问题':''}</p>`:''}<p>预览SKU：${preview.rows.slice(0,5).map(r=>esc(r.sku)).join('、')||'—'}</p>`;
          dialog.querySelector('#apply-import').disabled=r.errors.length>0;
        }catch(e){preview=null;dialog.querySelector('#import-preview').textContent=e.message;dialog.querySelector('#apply-import').disabled=true;}
      }
      form.onchange=e=>{if(e.target.name!=='sheet')update();};
      form.onsubmit=e=>{e.preventDefault();update();if(preview&&!preview.report.errors.length){dialog.close();dialog.remove();resolve(preview);}};
      dialog.querySelector('#cancel-import').onclick=()=>{dialog.close();dialog.remove();resolve(null);};
      update();
    }
    dialog.addEventListener('cancel',()=>{dialog.remove();resolve(null);});
    fill();dialog.showModal();
  });
}
