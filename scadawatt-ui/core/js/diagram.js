import {layoutSingleLine,measurementRows,escapeHtml as esc,TYPES,STATUS,sampleState,parseTimestamp} from './model.js';
const number=value=>typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('tr-TR',{maximumFractionDigits:3}):'—';
const shorten=(s,n)=>String(s||'').length>n?String(s).slice(0,n-1)+'…':String(s||'');
function electricalSymbol(type){
  if(type==='TRAFO')return '<circle cx="12" cy="17" r="9"/><circle cx="23" cy="17" r="9"/>';
  if(type==='DM')return '<g data-symbol="kiosk"><path d="M1 6 17 1 33 6v27H1Z M2 9h30 M11 9v24 M23 9v24 M5 13h24 M6 13v5m11-5v5m11-5v5 M4 20h4v5H4Z M15 20h4v5h-4Z M26 20h4v5h-4Z M6 25v5m11-5v5m11-5v5"/></g>';
  if(type==='TM')return '<path d="M17 1v8m0 3 10 12M17 27v7"/><circle cx="17" cy="10" r="2"/><circle cx="17" cy="26" r="2"/>';
  if(type==='ADP')return '<path d="M2 8h30M7 8v20m10-20v20m10-20v20"/>';
  if(type==='SAHA')return '<path d="M3 13h28M8 7h18M13 1h8M17 13v20"/>';
  return '<rect x="2" y="4" width="30" height="27" rx="3"/><path d="M7 11h20M7 18h8m-8 6h20"/>';
}
export function prepareSingleLine(ctx) {
  const rows=new Map();for(const d of ctx.topology.devicesAt(ctx.siteId)){
    const all=measurementRows(d.id,ctx.measurements,ctx.config);
    const ordered=[...all].sort((a,b)=>String(a.tag_id).localeCompare(String(b.tag_id),undefined,{numeric:true}));
    rows.set(String(d.id),ctx.density==='all'?ordered:ordered.slice(0,8));
  }
  const layout=layoutSingleLine(ctx.topology,ctx.siteId,rows);
  const key=JSON.stringify([ctx.siteId,ctx.density,layout.nodes.map(n=>[n.key,n.parent,n.name,n.row.ip,n.row.port,n.row.slave_id]),[...rows].map(([id,items])=>[id,items.map(r=>[r.tag_id,r.signal_name,r.unit])])]);
  return {layout,rows,key};
}
export function singleLineMarkup(ctx,prepared=prepareSingleLine(ctx)) {
  const {layout,rows}=prepared,positions=new Map(layout.nodes.map(n=>[n.key,n]));
  const wires=layout.edges.map(e=>{const a=positions.get(e.from),b=positions.get(e.to),start=a.y+35,end=b.y-35,bus=start+25,path=`M ${a.x} ${start} V ${bus} H ${b.x} V ${end}`;
    return `<g data-edge="${esc(e.to)}"><path class="wire" d="${path}"/><path class="flow-wire hidden" d="${path}"/></g>`;
  }).join('');
  const nodes=layout.nodes.map(n=>{
    let markup=`<g class="diagram-node unknown" transform="translate(${n.x-104} ${n.y-35})" data-node-key="${esc(n.key)}" role="button" tabindex="0" aria-label="${esc(n.name)}"><title>${esc(n.name)}</title><rect class="node-box" width="208" height="70" rx="7"/><g class="node-icon" transform="translate(12 18)">${electricalSymbol(n.type)}</g><text class="node-type" x="58" y="18">${esc(TYPES[n.type])} · #${esc(n.id)}</text><text class="node-title" x="58" y="37">${esc(shorten(n.name,19))}</text><text class="node-state" data-state-label="" x="58" y="55">Ölçüm bekleniyor</text></g>`;
    if(n.type==='DEVICE'){
      const items=rows.get(String(n.id))||[],cardHeight=82+22*Math.max(1,items.length),y=n.y+52;
      markup+=`<g class="meter-card" data-meter="${esc(n.id)}" transform="translate(${n.x-117} ${y})"><rect width="234" height="${cardHeight}" rx="7"/><text class="meter-card-heading" x="12" y="21">CANLI ÖLÇÜMLER</text><text class="meter-address" x="12" y="39">${esc(n.row.ip??'Seri #'+n.row.seri_hat_id)}:${esc(n.row.port??'—')} · Unit ${esc(n.row.slave_id??'—')}</text><path d="M12 48h210" class="meter-divider"/>`;
      markup+=items.length?items.map((r,i)=>`<g class="meter-signal" data-meter-tag="${esc(r.tag_id)}" data-tag="${esc(r.tag_id)}" role="button" tabindex="0" transform="translate(0 ${62+i*22})"><title>${esc(r.signal_name)}</title><text class="meter-signal-name" x="12" y="0">${esc(shorten(r.signal_name,17))}</text><text class="meter-signal-value" x="221" y="0" text-anchor="end">— ${esc(r.unit)}</text></g>`).join(''):'<text class="meter-signal-name" x="12" y="67">Grup / register / tag kurulumu gerekli</text>';
      markup+=`<text class="meter-time" x="12" y="${cardHeight-13}">Ölçüm bekleniyor</text></g>`;
    }
    return markup;
  }).join('');
  return `<svg class="single-line-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${layout.width} ${layout.height}" role="group" aria-label="Sahanın tüm köşk, trafo, pano ve cihaz bağlantıları">${wires}${nodes}</svg>`;
}
export class SingleLineDiagram {
  constructor(root){this.root=root;this.key=null;}
  update(ctx) {
    const prepared=prepareSingleLine(ctx);
    if(prepared.key!==this.key){this.root.innerHTML=singleLineMarkup(ctx,prepared);this.key=prepared.key;}
    const {layout}=prepared;
    for(const node of this.root.querySelectorAll('[data-node-key]')){
      const state=ctx.states.get(node.dataset.nodeKey)||{status:'unknown'},n=ctx.topology.nodes.get(node.dataset.nodeKey);
      node.setAttribute('class',`diagram-node ${state.status} ${ctx.selectedNode===node.dataset.nodeKey?'selected':''}`);
      node.querySelector('[data-state-label]').textContent=STATUS[state.status]||state.status;
      const opensDetails=['DM','TM'].includes(n.type);
      if(opensDetails)node.setAttribute('aria-haspopup','dialog');
      node.setAttribute('aria-label',`${n.name}, ${STATUS[state.status]}${opensDetails?', ayrıntıları aç':''}`);
    }
    for(const edge of this.root.querySelectorAll('[data-edge]')){
      const state=ctx.states.get(edge.dataset.edge)||{status:'unknown'},parent=ctx.topology.nodes.get(edge.dataset.edge)?.parent,parentState=ctx.states.get(parent);
      const allowed=state.flow&&!['disabled','maintenance','bad','stale'].includes(parentState?.status);
      edge.querySelector('.wire').setAttribute('class',`wire ${allowed?'flowing':state.status}`);
      const flow=edge.querySelector('.flow-wire');flow.classList.toggle('hidden',!allowed);flow.classList.toggle('reverse',!!state.reverse);
    }
    const byTag=new Map(ctx.measurements.map(r=>[String(r.tag_id),r]));
    for(const row of this.root.querySelectorAll('[data-meter-tag]')){
      const sample=byTag.get(row.dataset.meterTag),state=sample?sampleState(sample,ctx.config,ctx.settings,Date.now(),ctx.apiOnline):'unknown';
      const value=sample?.value!=null?number(sample.value):sample?.value_text??'—';
      const unit=sample?.unit??ctx.config.tags.find(t=>String(t.id)===row.dataset.meterTag)?.birim??'';
      row.querySelector('.meter-signal-value').textContent=`${value}${unit?' '+unit:''}`;
      row.setAttribute('data-quality',sample?.quality??'NOT_CONFIGURED');
      row.classList.toggle('not-current',state!=='online');row.querySelector('title').textContent=sample?`${sample.signal_name} · ${sample.quality} · ${sample.timestamp??'Zaman yok'}`:'Henüz API ölçümü yok; register/tag bağlantısını kontrol et.';
    }
    for(const card of this.root.querySelectorAll('[data-meter]')){
      const samples=ctx.measurements.filter(s=>String(s.device_id)===card.dataset.meter),valid=samples.filter(s=>Number.isFinite(parseTimestamp(s.timestamp))).sort((a,b)=>parseTimestamp(b.timestamp)-parseTimestamp(a.timestamp));
      card.querySelector('.meter-time').textContent=valid.length?`${new Date(parseTimestamp(valid[0].timestamp)).toLocaleTimeString('tr-TR')} · ${valid[0].quality} · ${samples.length} sinyal`:`${samples.length} ölçüm · API verisi bekleniyor`;
    }
    return layout;
  }
  zoom(value,layout){const svg=this.root.querySelector('svg');if(svg){svg.style.width=Math.round(layout.width*value)+'px';svg.style.minHeight='0';svg.style.height=Math.round(layout.height*value)+'px';}}
}
