export const TYPES = { SAHA: 'Saha', DM: 'Köşk / DM', TM: 'TM', TRAFO: 'Trafo', ADP: 'Dağıtım panosu', DEVICE: 'Cihaz' };
export const STATUS = { flowing: 'Akış ölçülüyor', idle: 'Akış ölçülmüyor', online: 'Veri güncel', partial: 'Kısmi veri', stale: 'Veri eski', bad: 'İletişim / kalite hatası', unknown: 'Ölçüm yok', disabled: 'Pasif', maintenance: 'Bakım' };
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const nameOf = row => String(row.name ?? row.ad ?? row.device_name ?? `#${row.id}`);
const id = value => String(value ?? '');
const active = row => row.aktif !== false && row.aktif !== 0;
const parentType = row => String(row.ust_dugum_tipi ?? '').toUpperCase();
const keyOf = (type, value) => `${type}:${id(value)}`;
export function buildTopology(config) {
  const nodes = new Map(), issues = [], orphans = [];
  const insert = (type, row, parent) => {
    if (row.id === null || row.id === undefined) { issues.push(`${TYPES[type]} kaydında id yok.`); return; }
    const key = keyOf(type, row.id);
    if (nodes.has(key)) { issues.push(`Tekrarlanan düğüm: ${key}`); return; }
    nodes.set(key, { key, id: row.id, type, name: nameOf(row), row, parent, active: active(row), children: [] });
  };
  (config.sites || []).forEach(row => insert('SAHA', row, null));
  for (const [type, field, parent, parentField] of [['DM','dm','SAHA','saha_id'],['TM','tm','DM','dm_id'],['TRAFO','trafo','TM','tm_id'],['ADP','adp','TRAFO','trafo_id']]) {
    (config[field] || []).forEach(row => insert(type, row, keyOf(parent,row[parentField])));
  }
  (config.devices || []).forEach(row => insert('DEVICE', row, keyOf(parentType(row),row.ust_dugum_id)));
  for (const node of nodes.values()) {
    if (node.parent && nodes.has(node.parent)) nodes.get(node.parent).children.push(node.key);
    else if (node.parent) { orphans.push(node.key); issues.push(`${node.name}: üst düğüm ${node.parent} okunamadı.`); }
  }
  const siteOf = new Map();
  for (const node of nodes.values()) {
    let current = node, seen = new Set();
    while (current && current.type !== 'SAHA') {
      if (seen.has(current.key)) { issues.push(`${node.name}: topolojide döngü var.`); current = null; break; }
      seen.add(current.key); current = nodes.get(current.parent);
    }
    if (current) siteOf.set(node.key, current.id);
  }
  const devicesAt = siteId => [...nodes.values()].filter(n => n.type === 'DEVICE' && id(siteOf.get(n.key)) === id(siteId));
  return {nodes,siteOf,orphans,issues,devicesAt};
}
export function normalizeMeasurements(rows,config={}) {
  return (rows || []).map(row => {
    const tag=(config.tags||[]).find(t=>id(t.id)===id(row.tag_id)),deviceId=row.device_id??row.cihaz_id??tag?.cihaz_id??tag?.device_id;
    const device=(config.devices||[]).find(d=>id(d.id)===id(deviceId));
    const raw=row.value??row.deger??null,value=typeof raw==='string'&&raw.trim()!==''&&Number.isFinite(Number(raw))?Number(raw):raw;
    return {...row,device_id:deviceId,device_name:row.device_name??row.cihaz_adi??(device?nameOf(device):null),signal_name:String(row.signal_name||row.sinyal_adi||tag?.sinyal_adi||row.tag_name||row.tag_adi||tag?.tag_adi||''),unit:String(row.unit||row.birim||tag?.birim||''),value,value_text:row.value_text??row.deger_text??null,quality:String(row.quality??row.kalite??'NOT_CONFIGURED').trim().toUpperCase(),timestamp:row.timestamp??row.zaman??null};
  });
}
export function measurementRows(deviceId,measurements,config={}) {
  const samples=measurements.filter(s=>id(s.device_id)===id(deviceId)),seen=new Set(samples.map(s=>id(s.tag_id)));
  const pending=(config.tags||[]).filter(t=>id(t.cihaz_id??t.device_id)===id(deviceId)&&active(t)&&!seen.has(id(t.id))).map(t=>({tag_id:t.id,device_id:deviceId,signal_name:t.sinyal_adi??t.tag_adi??nameOf(t),unit:t.birim??'',value:null,value_text:null,quality:'NOT_CONFIGURED',timestamp:null,pending:true}));
  return [...samples,...pending];
}
export function layoutSingleLine(topology,siteId,cardRows=new Map()) {
  const root=keyOf('SAHA',siteId),nodes=[],edges=[],visited=new Set();let leaf=0,maxDepth=0;
  function walk(key,depth){if(visited.has(key))return null;visited.add(key);const node=topology.nodes.get(key);if(!node)return null;
    const children=node.children.map(k=>walk(k,depth+1)).filter(Boolean);
    const x=children.length?(children[0].x+children.at(-1).x)/2:155+(leaf++)*270;
    const n={...node,x,y:65+depth*125,depth};nodes.push(n);maxDepth=Math.max(maxDepth,depth);
    children.forEach(c=>edges.push({from:key,to:c.key}));return n;
  }
  walk(root,0);const deviceY=65+maxDepth*125;
  for(const n of nodes)if(n.type==='DEVICE')n.y=deviceY;
  const bottom=Math.max(260,...nodes.map(n=>n.y+65+(n.type==='DEVICE'?85+22*Math.max(1,cardRows.get(String(n.id))?.length||0):0)));
  return {nodes,edges,width:Math.max(720,leaf*270+40),height:bottom+35};
}
export function parseTimestamp(value) {
  if (!value || typeof value !== 'string') return NaN;
  // Database timestamptz is timezone-aware. Never silently reinterpret a naive date as local time.
  if (!/(Z|[+-]\d\d:\d\d)$/i.test(value)) return NaN;
  return Date.parse(value);
}
export function staleLimit(sample, config, settings) {
  const tag=(config.tags||[]).find(t => id(t.id) === id(sample.tag_id));
  const reg=tag&&(config.registers||[]).find(r => id(r.id) === id(tag.register_id));
  const group=reg&&(config.groups||[]).find(g => id(g.id) === id(reg.okuma_grubu_id));
  const period=Number(group?.okuma_periyodu_ms);
  return Math.max(Number(settings.staleSeconds)||15, Number.isFinite(period) ? period/1000*3+2 : 0)*1000;
}
export function sampleState(sample, config, settings, now=Date.now(), apiOnline=true) {
  if (!apiOnline) return 'stale';
  if (!sample) return 'unknown';
  if (['COMM_FAIL','BAD'].includes(sample.quality)) return 'bad';
  if (sample.quality === 'NOT_CONFIGURED') return 'unknown';
  if (sample.quality !== 'GOOD') return 'stale';
  const timestamp=parseTimestamp(sample.timestamp);
  if (!Number.isFinite(timestamp) || now-timestamp>staleLimit(sample,config,settings) || timestamp-now>5000) return 'stale';
  if (sample.value === null && sample.value_text === null) return 'unknown';
  return 'online';
}
const alias = signal => String(signal).toLowerCase().replace(/[\s.-]/g,'_');
const powerAliases=['power_total','p_total','p_tot','active_power_total','total_active_power','total_power','power'];
const currentAliases=['i_total','current_total','current_l1','i_l1','current_l2','i_l2','current_l3','i_l3','current'];
// Sinyal adı sabit listede yoksa (ör. otomatik keşfedilen "hr_30050" gibi adlar)
// birimden türetilir. Yardımcı büyüklükler (THD, dengesizlik, nötr, min/max...) akış kanıtı sayılmaz.
const currentUnits=['a','ka','ma'], powerUnits=['w','kw','mw'];
const notFlowName=/(thd|unbal|dengesiz|neutral|n[oö]tr|min|max|peak|tepe|demand|nominal|rated|limit|setpoint|angle|a[cç][ıi]|harmonic)/i;
const totalName=/(tot|total|toplam|sum|3p)/i;
function byUnit(samples,units) {
  const pool=samples.filter(s=>units.includes(String(s.unit||'').trim().toLowerCase())&&!notFlowName.test(String(s.signal_name||''))&&typeof s.value==='number');
  return pool.find(s=>totalName.test(String(s.signal_name||'')))||pool[0]||null;
}
export function findFlowSample(samples, mapping={}) {
  if (mapping.flowSignal && mapping.flowSignal !== 'auto') return samples.find(s => s.signal_name === mapping.flowSignal) || null;
  // Prefer current, then total active power. Never use voltage, energy or frequency as evidence of current flow.
  for (const wanted of [...currentAliases,...powerAliases]) { const found=samples.find(s => alias(s.signal_name) === wanted); if(found)return found; }
  // Bilinen ad yoksa: önce akım birimi (A), sonra güç birimi (kW).
  return byUnit(samples,currentUnits)||byUnit(samples,powerUnits);
}
export function powerSample(samples) { for(const wanted of powerAliases){const found=samples.find(s=>alias(s.signal_name)===wanted);if(found)return found;} return byUnit(samples,powerUnits); }
export function deviceState(device, samples, config, settings, mapping={}, now=Date.now(), apiOnline=true) {
  if (!active(device)) return {status:'disabled',flow:false,reverse:false,sample:null};
  if (device.bakim_modu) return {status:'maintenance',flow:false,reverse:false,sample:null};
  const flowSample=findFlowSample(samples,mapping);
  const states=samples.map(s => sampleState(s,config,settings,now,apiOnline));
  let status = !samples.length ? 'unknown' : states.includes('bad') ? 'bad' : states.some(s=>s!=='online') ? (states.includes('online')?'partial':'stale') : 'online';
  let flow=false, reverse=false, breaker=null;
  if (flowSample && sampleState(flowSample,config,settings,now,apiOnline)==='online' && typeof flowSample.value === 'number' && Number.isFinite(flowSample.value)) {
    flow=Math.abs(flowSample.value)>Math.max(0,Number(mapping.threshold ?? settings.flowThreshold ?? .1));
    const isPower=powerAliases.includes(alias(flowSample.signal_name)) || ['W','kW','MW'].includes(flowSample.unit);
    const directionPower=powerSample(samples);
    const usablePower=directionPower && sampleState(directionPower,config,settings,now,apiOnline)==='online' && typeof directionPower.value==='number';
    reverse=mapping.direction==='reverse' || (mapping.direction!=='forward' && (usablePower?directionPower.value<0:isPower&&flowSample.value<0));
    if (mapping.breakerSignal) {
      breaker=samples.find(s=>s.signal_name===mapping.breakerSignal);
      if (!breaker || sampleState(breaker,config,settings,now,apiOnline)!=='online') {flow=false;status='unknown';}
      else if (Number(breaker.value)!==Number(mapping.closedValue ?? 1)) {flow=false;status='idle';}
    }
    if (status==='online') status=flow?'flowing':'idle';
  }
  // A device with any failed or stale required measurement is never shown as wholly healthy.
  if (['bad','stale','unknown'].includes(status)) flow=false;
  return {status,flow,reverse,sample:flowSample,breaker,samples,derived:false};
}
export function statesForTopology(topology, measurements, config, settings, mappings={}, now=Date.now(), apiOnline=true) {
  const result=new Map(), byDevice=new Map();
  measurements.forEach(s=>{const key=id(s.device_id);if(!byDevice.has(key))byDevice.set(key,[]);byDevice.get(key).push(s);});
  const visit=(key,seen=new Set())=>{
    if(result.has(key))return result.get(key);
    if(seen.has(key))return {status:'unknown',flow:false,reverse:false};
    const n=topology.nodes.get(key); if(!n)return {status:'unknown',flow:false};
    const next=new Set(seen);next.add(key);
    let state;
    if(n.type==='DEVICE')state=deviceState(n.row,byDevice.get(id(n.id))||[],config,settings,mappings[id(n.id)]||{},now,apiOnline);
    else {
      const children=n.children.map(c=>visit(c,next));
      const usable=children.filter(s=>!['disabled','maintenance'].includes(s.status));
      const flow=usable.some(s=>s.flow), reverse=flow&&usable.filter(s=>s.flow).every(s=>s.reverse);
      const problematic=usable.some(s=>['bad','stale','unknown','partial'].includes(s.status));
      const online=usable.some(s=>['flowing','idle','online','partial'].includes(s.status));
      const status=!n.active?'disabled':!usable.length?'unknown':problematic&&online?'partial':usable.some(s=>s.status==='bad')&&!online?'bad':problematic&&!online?'stale':flow?'flowing':'online';
      state={status,flow:n.active&&flow,reverse,derived:true};
    }
    result.set(key,state);return state;
  };
  for(const key of topology.nodes.keys())visit(key);
  // Configured inactive ancestors override flow on every device underneath them.
  for(const [key,state] of result){let n=topology.nodes.get(key),seen=new Set();while(n?.parent&&!seen.has(n.parent)){seen.add(n.parent);n=topology.nodes.get(n.parent);if(n&&!n.active){state.flow=false;state.status='disabled';break;}}}
  return result;
}
export function layoutTree(topology, siteId) {
  const root=keyOf('SAHA',siteId), placed=[], edges=[], visited=new Set();let leaf=0;
  function walk(key,depth) {
    if(visited.has(key))return null;visited.add(key);const node=topology.nodes.get(key);if(!node)return null;
    const children=node.children.map(child=>walk(child,depth+1)).filter(Boolean);
    const y=children.length?children.reduce((sum,c)=>sum+c.y,0)/children.length:72+(leaf++)*115;
    const position={...node,x:40+depth*235,y,depth};placed.push(position);
    children.forEach(child=>edges.push({from:key,to:child.key}));return position;
  }
  walk(root,0);
  return {nodes:placed,edges,width:Math.max(700,...placed.map(n=>n.x+220)),height:Math.max(330,leaf*115+55)};
}
