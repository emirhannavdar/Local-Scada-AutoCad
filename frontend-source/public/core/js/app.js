if(window.parent!==window)document.body.classList.add('embedded-settings-page');
import {buildTopology,normalizeMeasurements,measurementRows,statesForTopology,nameOf,TYPES,STATUS,escapeHtml as esc,sampleState,powerSample,parseTimestamp} from './model.js';
import {ScadaApi} from './api.js';
import {demoData} from './demo.js';
import {ENTITIES,emptyConfig} from './configuration.js';
import {Management} from './management.js';
import {SingleLineDiagram} from './diagram.js';
import {syncReferenceSelect} from './live-dom.js';
import {referenceSummary} from './live-summary.js';
import {SetupGuide} from './guide.js';
import {MapEditor} from './map-editor.js';
import {ScalingPanel} from './scaling.js';
import {SiteWizard} from './site-wizard.js';
import {WorkspaceEditor} from './editor.js';
const $=id=>document.getElementById(id);
const defaults={baseUrl:(['localhost','127.0.0.1','::1'].includes(location.hostname)?'http://127.0.0.1:8000/api/v1':location.origin+'/api/v1'),pollSeconds:1,staleSeconds:15,flowThreshold:.1};
function readStored(key,fallback){try{return JSON.parse(localStorage.getItem(key))||fallback;}catch{return fallback;}}
let currentUser=null;
let settings={...defaults,...readStored('scadawatt.settings.v1',{}),token:''};
let mappings=readStored('scadawatt.mappings.v1',{}),config=emptyConfig(),measurements=[];
let topology=buildTopology(config),states=new Map(),selectedSite=null,selectedNode=null,selectedDevice=null,view='diagram',demo=false,apiOnline=false;
let api,epoch=0,pollTimer,configTimer,clockTimer,toastTimer,polling=false,loadingConfig=false,zoom=1,fitNext=true,lastUpdate=null,lastError='',configErrors=[],requestLog=[],histories=new Map();
const labels=Object.fromEntries(Object.entries(ENTITIES).map(([key,e])=>[key,e.path]));
let schema=null,schemaReady=Promise.resolve(),configLoadTask=null,loaded={},dbOptions={};
const fmt=(value,digits=2)=>typeof value==='number'&&Number.isFinite(value)?(Math.abs(value)>=1e8?value.toExponential(3):value.toLocaleString('tr-TR',{maximumFractionDigits:digits})):'—';
const shortTime=value=>{const t=parseTimestamp(value);return Number.isFinite(t)?new Date(t).toLocaleTimeString('tr-TR',{hour12:false}):'Zaman geçersiz';};
const age=value=>{const t=parseTimestamp(value);return Number.isFinite(t)?`${Math.max(0,Math.floor((Date.now()-t)/1000))} sn önce`:'Zaman bilinmiyor';};
const stateChip=state=>`<span class="state-chip ${esc(state)}"><i class="state-dot ${esc(state)}"></i>${esc(STATUS[state]||state)}</span>`;
const qualityChip=(s,derived)=>`<span class="quality-chip ${esc(derived==='stale'?'STALE':s.quality)}">${esc(derived==='stale'&&s.quality==='GOOD'?'STALE':s.quality)}</span>`;
const siteDevices=()=>selectedSite===null?[]:topology.devicesAt(selectedSite);
const samplesFor=deviceId=>measurements.filter(m=>String(m.device_id)===String(deviceId));
const selectedSamples=()=>selectedDevice===null?[]:samplesFor(selectedDevice);
const singleLine=new SingleLineDiagram($('diagram'));
function toast(text){clearTimeout(toastTimer);$('toast').textContent=text;$('toast').className='show';toastTimer=setTimeout(()=>$('toast').className='',3200);}
function writePreference(key,value){try{localStorage.setItem(key,JSON.stringify(value));}catch{toast('Tarayıcı ayarı kaydedilemedi; bu sekmede çalışmaya devam eder.');}}
const context=()=>({config,topology,measurements,selectedSite,selectedDevice,demo,api,schema,schemaReady,loaded,dbOptions,settings,apiOnline});
const management=new Management(context,async(entity,result)=>{
  const currentEpoch=epoch;if(configLoadTask)await configLoadTask;await loadConfig(currentEpoch);if(currentEpoch!==epoch)return;
  const id=typeof result==='number'?result:result?.id;
  if(entity==='sites'&&id!=null){selectedSite=id;selectedNode=`SAHA:${id}`;fitNext=true;}
  if(entity==='devices'&&id!=null){selectedDevice=id;selectedNode=`DEVICE:${id}`;selectedSite=topology.siteOf.get(selectedNode)??selectedSite;fitNext=true;}
  refreshModel();render();pollMeasurements(currentEpoch);
},toast);
const reloadSettings=async()=>{await loadConfig(epoch);refreshModel();render();};
const mapEditor=new MapEditor(context,management,reloadSettings),scalingPanel=new ScalingPanel(context,reloadSettings);
const guide=new SetupGuide(context,{create:entity=>management.open(entity),map:()=>mapEditor.open(),setup:()=>management.openSetup(),scaling:()=>scalingPanel.open(),diagram:()=>{switchView('diagram');$('diagram-view').scrollIntoView({behavior:'smooth',block:'start'});}});
const siteWizard=new SiteWizard(context,management,mapEditor,{toast,select:(siteId,deviceId)=>{selectedSite=siteId;selectedDevice=deviceId;selectedNode=deviceId?`DEVICE:${deviceId}`:`SAHA:${siteId}`;fitNext=true;refreshModel();render();},diagram:()=>{switchView('diagram');$('diagram-view').scrollIntoView({behavior:'smooth',block:'start'});}});
const busy=()=>management.saving||mapEditor.saving||mapEditor.importer.saving||mapEditor.importer.loading||scalingPanel.saving;
const editor={update(){}};

function logRequest(row){requestLog.unshift(row);requestLog=requestLog.slice(0,18);renderDiagnostics();}
function refreshModel(){
  topology=buildTopology(config);states=statesForTopology(topology,measurements,config,settings,demo?{}:mappings,Date.now(),apiOnline||demo);
  if(!config.sites.some(s=>String(s.id)===String(selectedSite))){selectedSite=config.sites[0]?.id??null;selectedNode=selectedSite===null?null:`SAHA:${selectedSite}`;fitNext=true;}
  if(selectedNode&&!topology.nodes.has(selectedNode))selectedNode=selectedSite===null?null:`SAHA:${selectedSite}`;
  const choices=selectedNode?descendantDevices(selectedNode):siteDevices(),explicitDevice=topology.nodes.get(selectedNode);
  if(explicitDevice?.type==='DEVICE')selectedDevice=explicitDevice.id;
  else if(!choices.some(d=>String(d.id)===String(selectedDevice)))selectedDevice=choices[0]?.id??null;
}
function recordHistory(){
  for(const sample of measurements){if(sampleState(sample,config,settings,Date.now(),apiOnline||demo)!=='online'||typeof sample.value!=='number'||!Number.isFinite(sample.value))continue;
    const key=`${demo?'demo':'live'}:${sample.device_id}:${sample.tag_id}`;const items=histories.get(key)||[];
    if(items.at(-1)?.timestamp!==sample.timestamp){items.push({value:sample.value,timestamp:sample.timestamp,unit:sample.unit});histories.set(key,items.slice(-60));}
  }
}
function renderSites(){
  $('site-count').textContent=config.sites.length;
  $('site-list').innerHTML=config.sites.map(s=>{const state=states.get(`SAHA:${s.id}`)||{status:'unknown'},count=topology.devicesAt(s.id).length;return `<button class="site-button ${String(s.id)===String(selectedSite)?'active':''}" data-site="${esc(s.id)}" aria-current="${String(s.id)===String(selectedSite)}"><strong>${esc(nameOf(s))}</strong><small><span><i class="state-dot ${state.status}"></i>${esc(s.code??s.kod??'Saha #'+s.id)}</span><span>${count} cihaz</span></small></button>`;}).join('')||'<div class="empty-small">Saha bulunamadı. API’yi ve /saha yanıtını kontrol et.</div>';
  const orphanDevices=config.devices.filter(d=>!topology.siteOf.has(`DEVICE:${d.id}`));
  $('orphan-note').classList.toggle('hidden',!orphanDevices.length);$('orphan-note').textContent=`${orphanDevices.length} cihaz sahayla eşleşmiyor. Üst düğüm bağlantısını tanılama bölümünden kontrol et.`;
  const site=config.sites.find(s=>String(s.id)===String(selectedSite));
  $('site-name').textContent=site?nameOf(site):'Yerel SCADA';$('site-code').textContent=site?`${site.code??site.kod??'SAHA'} / TEK HAT GÖRÜNÜMÜ`:'SAHA GÖRÜNÜMÜ';
  $('site-description').textContent=site?`${site.konum??site.loc??'Saha'} · ${fmt(Number(site.kurulu_guc_kwp))} kWp kurulu güç`:'Köşkten saha cihazlarına elektrik akışı ve canlı ölçümler.';
}
function renderMetrics(){
  const devices=siteDevices(),online=devices.filter(d=>['flowing','idle','online'].includes(states.get(d.key)?.status)).length;
  const ids=new Set(devices.map(d=>String(d.id))),samples=measurements.filter(s=>ids.has(String(s.device_id))),good=samples.filter(s=>sampleState(s,config,settings,Date.now(),apiOnline||demo)==='online').length;
  const p=powerSample(selectedSamples()),pCurrent=p&&sampleState(p,config,settings,Date.now(),apiOnline||demo)==='online';
  const rows=[['Cihazlar',`${online}<small>/ ${devices.length}</small>`,'Güncel ve sorunsuz veri alan cihaz','▣'],['Akış göstergesi',devices.filter(d=>states.get(d.key)?.flow).length,'Akım / güç ölçülen cihaz','ϟ'],['Güncel sinyal',`${good}<small>/ ${samples.length}</small>`,'GOOD kalite ve geçerli zaman','◷'],['Referans aktif güç',p?`${fmt(p.value)}<small>${esc(p.unit)}</small>`:'—',p?`${pCurrent?'Güncel':'Son alınan'} · ${esc(config.devices.find(d=>String(d.id)===String(selectedDevice))?.ad??config.devices.find(d=>String(d.id)===String(selectedDevice))?.name??'')}`:'Seçili cihazda güç sinyali yok','∿']];
  $('metrics').innerHTML=rows.map(([label,value,note,icon])=>`<div class="metric"><div class="metric-label"><span>${label}</span><span class="metric-icon" aria-hidden="true">${icon}</span></div><div class="metric-value">${value}</div><div class="metric-note">${note}</div></div>`).join('');
  const summary=referenceSummary(selectedSamples(),config,settings,Date.now(),apiOnline||demo),device=config.devices.find(d=>String(d.id)===String(selectedDevice));
  $('header-reference').textContent=demo?'ÖRNEK · '+(device?nameOf(device):'Cihaz yok'):device?nameOf(device):'Referans cihaz seçilmedi';
  for(const [key,item] of Object.entries(summary)){
    const el=$('header-'+key);el.textContent=item.sample?`${fmt(item.sample.value,key==='frequency'?3:2)} ${item.sample.unit}`:'—';
    el.closest('.header-reading').querySelector('span').textContent=item.label;
    el.classList.toggle('not-current',!item.current);el.title=item.sample?`${item.sample.signal_name} · ${item.sample.quality} · ${item.sample.timestamp??'Zaman yok'} · ${item.current?'Güncel':'Son alınan / güncel değil'}`:'Bu referans cihazda ölçüm yok';
    $('header-'+key+'-state').textContent=item.current?'Güncel':item.sample?'Son alınan':'Ölçüm yok';
  }
}
function renderDiagram(){
  if(selectedSite===null){singleLine.key=null;if(!$('diagram').querySelector('.diagram-empty'))$('diagram').innerHTML='<div class="diagram-empty"><span class="empty-mark">ϟ</span><h2>Canlı bağlantı bekleniyor</h2><p>Backend’i başlatıp Yenile düğmesine bas. Backend hazır değilse Örnek görünümü açabilirsin.</p></div>';return;}
  const layout=singleLine.update({topology,siteId:selectedSite,measurements,config,states,selectedNode,settings,apiOnline:apiOnline||demo,density:$('diagram-density').value});
  if(fitNext){zoom=Math.max(.3,Math.min(1,($('diagram-scroll').clientWidth-20)/layout.width));fitNext=false;}
  $('zoom-value').textContent=Math.round(zoom*100)+'%';
  singleLine.zoom(zoom,layout);
}
function renderDeviceRows(){
  const devices=siteDevices();$('device-summary').textContent=devices.length+' cihaz';
  $('device-rows').innerHTML=devices.map(n=>{const d=n.row,s=states.get(n.key)||{status:'unknown'},samples=samplesFor(d.id),latest=samples.map(x=>x.timestamp).filter(x=>Number.isFinite(parseTimestamp(x))).sort((a,b)=>parseTimestamp(b)-parseTimestamp(a))[0];return `<tr class="${String(d.id)===String(selectedDevice)?'selected':''}"><td><button class="device-link" data-device="${esc(d.id)}">${esc(nameOf(d))}<small>${esc(TYPES[topology.nodes.get(n.parent)?.type]||parentTypeLabel(d))} · ${esc(topology.nodes.get(n.parent)?.name||'Üst düğüm yok')}</small></button></td><td class="mono">${esc(d.protokol)}<br><span class="muted">${esc(d.ip??'Seri hat #'+d.seri_hat_id)}${d.port?':'+d.port:''} · Unit ${esc(d.slave_id??'—')}</span></td><td>${stateChip(s.status)}</td><td class="mono" title="${esc(latest||'')}">${latest?shortTime(latest):'—'}<br><span class="muted">${latest?age(latest):'Henüz ölçüm yok'}</span></td></tr>`;}).join('')||'<tr><td colspan="4" class="empty-table">Bu sahada cihaz yok veya cihazların üst düğüm kayıtları okunamadı.</td></tr>';
}
const parentTypeLabel=d=>String(d.ust_dugum_tipi||'Bağlantısız');
function renderDetails(){
  const node=topology.nodes.get(selectedNode),d=config.devices.find(d=>String(d.id)===String(selectedDevice));
  $('detail-name').textContent=node?.name||'Düğüm seç';$('detail-type').textContent=node?TYPES[node.type]:'—';
  const desc=node?descendantDevices(node.key):[];
  $('reference-device-box').classList.toggle('hidden',!node||node.type==='DEVICE');
  syncReferenceSelect($('reference-device'),desc,selectedDevice);
  if(!node){$('detail-body').innerHTML='<p class="empty-small">Şemadan bir köşk, trafo, pano veya cihaz seç.</p>';$('signal-list').innerHTML='<div class="empty-small">Henüz cihaz seçilmedi.</div>';$('open-mapping').disabled=true;return;}
  const state=states.get(node.key)||{status:'unknown'};
  const kv=(label,value)=>`<div class="detail-kv"><label>${esc(label)}</label><span>${esc(value??'—')}</span></div>`;
  let body=`<div class="detail-state">${stateChip(state.status)}<small>${state.derived?'Türetilmiş durum':'Cihaz ölçümü'}</small></div>${kv('Düğüm',`${node.type} #${node.id}`)}${kv('Üst bağlantı',topology.nodes.get(node.parent)?.name??'Saha kökü')}`;
  if(node.type==='DEVICE')body+=kv('Protokol',node.row.protokol)+kv('Adres',`${node.row.ip??'Seri #'+node.row.seri_hat_id}${node.row.port?':'+node.row.port:''}`)+kv('Unit ID',node.row.slave_id)+kv('Profil',node.row.profil_id)+kv('Bakım modu',node.row.bakim_modu?'Açık':'Kapalı');
  else body+=kv('Bağlı cihaz',desc.length)+`<div class="detail-help">Bu düğümün durumu altındaki cihazların ölçümlerinden türetilir. Köşk/hücre için ayrı kesici ölçümü eşleştirilmediyse fiziksel kesici konumu bilinmez.</div>`;
  $('detail-body').innerHTML=body;
  const sampleList=d?measurementRows(d.id,measurements,config):[];$('open-mapping').disabled=!d||demo;
  $('signal-list').innerHTML=sampleList.map(sample=>{const derived=sampleState(sample,config,settings,Date.now(),apiOnline||demo);return `<button class="signal-item" data-tag="${esc(sample.tag_id)}"><span><span class="signal-name">${esc(sample.signal_name)}</span><span class="signal-meta">${esc(nameOf(d))} · ${esc(age(sample.timestamp))}</span></span><span class="signal-value"><strong class="${derived!=='online'?'stale':''}">${sample.value!==null?fmt(sample.value,3):esc(sample.value_text??'—')} <span class="unit">${esc(sample.unit)}</span></strong>${qualityChip(sample,derived)}</span></button>`;}).join('')||'<div class="empty-small">Bu cihaz için henüz ölçüm yok. Register/tag bağlantısını ve collector’ı kontrol et.</div>';
}
function descendantDevices(key,seen=new Set()){
  if(seen.has(key))return [];seen.add(key);const n=topology.nodes.get(key);if(!n)return [];if(n.type==='DEVICE')return[n];return n.children.flatMap(k=>descendantDevices(k,seen));
}
function renderTrend(){
  const samples=selectedSamples(),sample=powerSample(samples)||states.get(`DEVICE:${selectedDevice}`)?.sample;
  $('trend-title').textContent=sample?.signal_name||'Aktif güç';$('trend-value').textContent=sample?`${fmt(sample.value)} ${sample.unit}`:'—';
  const points=sample?histories.get(`${demo?'demo':'live'}:${sample.device_id}:${sample.tag_id}`)||[]:[];
  $('trend-range').textContent=points.length?`${shortTime(points[0].timestamp)} – ${shortTime(points.at(-1).timestamp)}`:'';
  if(points.length<2){$('trend').innerHTML='<div class="trend-empty">En az iki farklı, geçerli ölçüm bekleniyor.</div>';return;}
  const vals=points.map(x=>x.value),min=Math.min(...vals),max=Math.max(...vals),span=max-min||Math.max(Math.abs(max)*.02,1),lo=min-span*.15,hi=max+span*.15;
  const coords=points.map((p,i)=>`${15+i/(points.length-1)*240},${98-(p.value-lo)/(hi-lo)*84}`),poly=coords.join(' ');
  $('trend').innerHTML=`<svg viewBox="0 0 270 112" role="img" aria-label="${esc(sample.signal_name)} ölçüm geçmişi; minimum ${fmt(min)}, maksimum ${fmt(max)} ${esc(sample.unit)}"><defs><linearGradient id="trend-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#76e3ae" stop-opacity=".22"/><stop offset="100%" stop-color="#76e3ae" stop-opacity="0"/></linearGradient></defs>${[15,57,99].map(y=>`<line x1="15" y1="${y}" x2="255" y2="${y}" stroke="#2d4557" stroke-dasharray="4 5"/>`).join('')}<polygon points="15,105 ${poly} 255,105" fill="url(#trend-gradient)"/><polyline points="${poly}" stroke="#76e3ae" stroke-width="2" fill="none"/><circle cx="255" cy="${coords.at(-1).split(',')[1]}" r="3" fill="#76e3ae"/></svg>`;
}
function renderAllMeasurements(){
  const rows=siteDevices().flatMap(n=>measurementRows(n.id,measurements,config).map(s=>({...s,device_name:s.device_name??n.name})));
  $('all-measurements').innerHTML=rows.map(s=>{const derived=sampleState(s,config,settings,Date.now(),apiOnline||demo);return `<tr><td><button class="device-link" data-tag="${esc(s.tag_id)}">${esc(s.device_name??s.device_id)}<small>${esc(s.signal_name)}</small></button></td><td class="mono">${s.value!==null?fmt(s.value,4):esc(s.value_text??'—')} ${esc(s.unit)}</td><td>${qualityChip(s,derived)}</td><td class="mono">${esc(s.timestamp??'—')}</td></tr>`;}).join('')||'<tr><td colspan="4" class="empty-table">Bu saha için canlı ölçüm bulunamadı.</td></tr>';
}
function renderDiagnostics(){
  const unmapped=measurements.filter(m=>!topology.nodes.has(`DEVICE:${m.device_id}`));
  const issues=[...configErrors,...topology.issues,...(unmapped.length?[`${unmapped.length} API ölçümü cihazla eşleşmiyor. /tag içindeki cihaz ID’sini ve /device listesini kontrol et.`]:[])];$('diagnostic-count').textContent=issues.length+' sorun';
  $('topology-issues').innerHTML=issues.map(i=>`<div>${esc(i)}</div>`).join('');
  $('request-log').innerHTML=requestLog.map(r=>`<tr><td class="mono">${esc(r.method||'GET')} /${esc(r.path)}</td><td>${r.ok?'<span class="state-chip online">'+esc(r.status)+'</span>':'<span class="state-chip bad">'+esc(r.status||'Erişilemiyor')+'</span>'}</td><td class="mono">${r.ms} ms</td><td>${esc(r.ok?(r.count===undefined?r.message:r.count+' kayıt'):r.message)}</td></tr>`).join('')||'<tr><td colspan="4" class="empty-table">API istekleri burada görünür.</td></tr>';
}
function render(){
  if(window.parent!==window)window.parent.postMessage({type:"scadawatt.snapshot",config,measurements:measurements.map(m=>({...m,ui_state:sampleState(m,config,settings,Date.now(),apiOnline||demo)})),nodes:[...topology.nodes.values()],siteOf:[...topology.siteOf],states:[...states],selectedSite,selectedDevice,baseUrl:settings.baseUrl,apiOnline,demo,lastError,schema,loaded,user:currentUser,busy:busy()},location.origin);
  editor.update(states);
  const focus=document.activeElement?.dataset;const focusedNode=focus?.nodeKey,focusedDevice=focus?.device,focusedSite=focus?.site,focusedEdit=focus?.configEdit,focusedRecord=focus?.recordId,focusedList=focus?.configList,focusedInspect=focus?.configInspect;
  renderSites();renderMetrics();renderDiagram();renderDeviceRows();renderDetails();renderTrend();renderAllMeasurements();renderDiagnostics();management.render();renderNodeDialog();siteWizard.update();
  if(focusedNode)document.querySelector(`[data-node-key="${CSS.escape(focusedNode)}"]`)?.focus({preventScroll:true});
  if(focusedDevice)document.querySelector(`[data-device="${CSS.escape(focusedDevice)}"]`)?.focus({preventScroll:true});
  if(focusedSite)document.querySelector(`[data-site="${CSS.escape(focusedSite)}"]`)?.focus({preventScroll:true});
  if(focusedEdit)document.querySelector(`[data-config-edit="${CSS.escape(focusedEdit)}"][data-record-id="${CSS.escape(focusedRecord||'')}"]`)?.focus({preventScroll:true});
  if(focusedList)document.querySelector(`[data-config-list="${CSS.escape(focusedList)}"]`)?.focus({preventScroll:true});
  if(focusedInspect)document.querySelector(`[data-config-inspect="${CSS.escape(focusedInspect)}"]`)?.focus({preventScroll:true});
  $('api-status').className='connection '+(demo?'unknown':apiOnline?'online':'bad');$('api-status').innerHTML=`<i></i>${demo?'Örnek görünüm':apiOnline?'API bağlı':'API bağlantısı yok'}`;
  $('last-update').textContent=lastUpdate?`Son istek ${new Date(lastUpdate).toLocaleTimeString('tr-TR')}`:'Henüz veri alınmadı';
  $('error-banner').classList.toggle('hidden',!lastError||demo);$('error-text').textContent=lastError;
  $('demo-banner').classList.toggle('hidden',!demo);$('source-label').textContent=demo?'Örnek veri':'Yerel REST API';
  try{$('source-address').textContent=demo?'Tarayıcı içi gösterim':new URL(settings.baseUrl).host;}catch{$('source-address').textContent='API adresi geçersiz';}
  $('toggle-demo').textContent=demo?'Canlı API’ye dön':'Örnek görünümü aç';$('session-note').textContent=`Yenileme: ${settings.pollSeconds} sn · API üzerinden yapılandırma`;
  $('add-site').disabled=demo||!api;$('add-device').disabled=demo||!api;$('edit-site').disabled=demo||selectedSite===null||!api;
  $('edit-node').disabled=demo||!topology.nodes.has(selectedNode)||!api;
  $('measurement-empty-banner').classList.toggle('hidden',demo||!apiOnline||measurements.length>0);
  $('measurement-empty-text').textContent='API’ye erişiliyor ancak /measurement boş: 0 ölçüm. Cihazın veri zincirini ve collector’ı kontrol et.';
}
function loadConfig(currentEpoch){
  if(demo)return Promise.resolve();if(configLoadTask)return configLoadTask;loadingConfig=true;
  const currentApi=api;
  const task=(async()=>{
    try{currentUser=await currentApi.request('auth/me');}catch{currentUser=null;config=emptyConfig();measurements=[];refreshModel();render();return;}
    document.body.classList.toggle('restricted-session',currentUser?.role!=='root');
    const entries=Object.entries(labels).filter(([field])=>currentUser?.role==='root'||['sites','dm','tm','trafo','adp','devices','tags'].includes(field)),results=await Promise.allSettled(entries.map(async([field,path])=>({field,data:await currentApi.list(path)})));
    if(currentEpoch!==epoch)return;
    const errors=[];results.forEach((r,i)=>{const [field,path]=entries[i];loaded[field]=r.status==='fulfilled';if(r.status==='fulfilled')config[field]=r.value.data;else errors.push(`/${path}: ${r.reason.message}${['dm','tm','trafo','adp'].includes(field)?' Bu dalın gerçek ilişkisi çizilemeyebilir.':''}`);});
    if(currentUser?.role!=='root')for(const key of ['profiles','profileRegisters','signals','groups','registers','serialLines'])config[key]=[];
    configErrors=errors;measurements=normalizeMeasurements(measurements,config);refreshModel();render();
  })().finally(()=>{if(currentEpoch===epoch){loadingConfig=false;if(configLoadTask===task)configLoadTask=null;}});
  configLoadTask=task;return task;
}
async function pollMeasurements(currentEpoch){
  if(polling||demo)return;polling=true;
  try{const rows=await api.list('measurement');if(currentEpoch!==epoch)return;measurements=normalizeMeasurements(rows,config);apiOnline=true;lastError='';lastUpdate=new Date().toISOString();refreshModel();recordHistory();render();}
  catch(error){if(currentEpoch!==epoch)return;apiOnline=false;lastError=error.message;refreshModel();render();}
  finally{if(currentEpoch===epoch)polling=false;}
}
function clearTimers(){clearInterval(pollTimer);clearInterval(configTimer);api?.close();polling=false;loadingConfig=false;configLoadTask=null;}
function connect(){
  epoch++;const currentEpoch=epoch;clearTimers();demo=false;apiOnline=false;lastError='';configErrors=[];histories.clear();measurements=[];config=emptyConfig();loaded={};schema=null;api=null;dbOptions={};refreshModel();
  try{api=new ScadaApi(settings,row=>{if(currentEpoch===epoch)logRequest(row);});}catch(error){lastError=error.message;render();return;}
  schemaReady=currentUser?.role==='root'?api.schema().then(doc=>{if(currentEpoch===epoch)schema=doc;}).catch(error=>{if(currentEpoch===epoch){schema=null;toast('API şeması okunamadı: '+error.message);}}):Promise.resolve();
  if(currentUser?.role==='root')api.request('ui/options').then(options=>{if(currentEpoch===epoch)dbOptions=options??{};}).catch(()=>{if(currentEpoch===epoch)dbOptions={};});
  render();loadConfig(currentEpoch);pollMeasurements(currentEpoch);
  pollTimer=setInterval(()=>pollMeasurements(currentEpoch),Math.max(1,Number(settings.pollSeconds))*1000);configTimer=setInterval(()=>loadConfig(currentEpoch),5000);
}
function toggleDemo(){
  if(demo){connect();return;}epoch++;clearTimers();demo=true;loaded={};lastError='';requestLog=[];configErrors=[];histories.clear();const d=demoData();config=d.config;measurements=normalizeMeasurements(d.measurements);apiOnline=false;lastUpdate=new Date().toISOString();refreshModel();recordHistory();render();
  pollTimer=setInterval(()=>{const d=demoData();config=d.config;measurements=normalizeMeasurements(d.measurements);lastUpdate=new Date().toISOString();refreshModel();recordHistory();render();},1000);
}
let detailNodeKey=null,detailStructure='';
function renderNodeDialog(){
  const dialog=$('node-dialog');if(!dialog.open)return;
  const root=topology.nodes.get(detailNodeKey);if(!root){dialog.close();return;}
  $('node-dialog-title').textContent=`${TYPES[root.type]} · ${root.name}`;
  const rows=[],seen=new Set();
  const visit=(key,depth)=>{if(seen.has(key))return;seen.add(key);const n=topology.nodes.get(key);if(!n)return;rows.push({n,depth});for(const child of n.children)visit(child,depth+1);};visit(root.key,0);
  const structure=JSON.stringify(rows.map(({n,depth})=>[n.key,n.name,n.row.ip,n.row.port,n.row.slave_id,depth]));
  if(structure!==detailStructure){
    $('node-dialog-body').innerHTML=rows.map(({n,depth})=>`<div class="node-detail-row" data-detail-key="${esc(n.key)}"><div><small>${esc(TYPES[n.type])}${depth?' · '+esc(topology.nodes.get(n.parent)?.name??''):''}</small><strong>${esc(n.name)}</strong>${n.type==='DEVICE'?`<small class="mono">${esc(n.row.ip??'Seri hat')} : ${esc(n.row.port??'—')} · Unit ${esc(n.row.slave_id??'—')}</small><button class="button small" data-node-device="${esc(n.id)}">Ölçümleri aç →</button>`:''}</div><span data-detail-state></span></div>`).join('');detailStructure=structure;
  }
  for(const row of $('node-dialog-body').querySelectorAll('[data-detail-key]'))row.querySelector('[data-detail-state]').innerHTML=stateChip(states.get(row.dataset.detailKey)?.status??'unknown');
}
function activateNode(key){selectNode(key);if(['DM','TM'].includes(topology.nodes.get(key)?.type)){detailNodeKey=key;detailStructure='';$('node-dialog').showModal();renderNodeDialog();}}
function selectNode(key){const n=topology.nodes.get(key);if(!n)return;selectedNode=key;const choices=descendantDevices(key);selectedDevice=choices.some(d=>String(d.id)===String(selectedDevice))?selectedDevice:choices[0]?.id??null;render();renderNodeDialog();}
function showSettings(){
  $('settings-url').value=settings.baseUrl;$('settings-token').value=settings.token;$('settings-poll').value=settings.pollSeconds;$('settings-stale').value=settings.staleSeconds;$('settings-threshold').value=settings.flowThreshold;$('settings-error').textContent='';$('settings-dialog').showModal();checkAuthSetup();
}
function showMapping(){
  if(selectedDevice===null||demo)return;const d=config.devices.find(d=>String(d.id)===String(selectedDevice)),samples=selectedSamples(),m=mappings[String(selectedDevice)]||{};
  $('mapping-device').textContent=nameOf(d);$('mapping-flow').innerHTML='<option value="auto">Otomatik · akım / toplam aktif güç</option>'+samples.map(s=>`<option value="${esc(s.signal_name)}">${esc(s.signal_name)} (${esc(s.unit)})</option>`).join('');
  $('mapping-breaker').innerHTML='<option value="">Eşleştirilmedi</option>'+samples.map(s=>`<option value="${esc(s.signal_name)}">${esc(s.signal_name)}</option>`).join('');
  if(m.flowSignal&&!samples.some(s=>s.signal_name===m.flowSignal)&&m.flowSignal!=='auto')$('mapping-flow').add(new Option(m.flowSignal+' · ölçüm yok',m.flowSignal));
  if(m.breakerSignal&&!samples.some(s=>s.signal_name===m.breakerSignal))$('mapping-breaker').add(new Option(m.breakerSignal+' · ölçüm yok',m.breakerSignal));
  $('mapping-flow').value=m.flowSignal||'auto';$('mapping-breaker').value=m.breakerSignal||'';$('mapping-closed').value=m.closedValue??1;$('mapping-threshold').value=m.threshold??settings.flowThreshold;$('mapping-direction').value=m.direction||'auto';$('mapping-error').textContent='';$('mapping-dialog').showModal();
}
function showRegister(tagId){
  const tag=config.tags.find(t=>String(t.id)===String(tagId)),reg=tag&&config.registers.find(r=>String(r.id)===String(tag.register_id));
  const sample=measurements.find(m=>String(m.tag_id)===String(tagId))||(tag?measurementRows(tag.cihaz_id,[],config).find(m=>String(m.tag_id)===String(tagId)):null);if(!sample)return;
  const values=[['Sinyal',sample.signal_name],['Değer',sample.value!==null?`${fmt(sample.value,6)} ${sample.unit}`:sample.value_text??'—'],['API kalitesi',sample.quality],['Tag ID',sample.tag_id],['PDU adresi',reg?`${reg.baslangic_adresi}–${Number(reg.baslangic_adresi)+Number(reg.register_sayisi)-1}`:'Tag/register eşleşmesi yok'],['Fonksiyon',reg?'FC'+String(reg.function_code).padStart(2,'0'):'—'],['Veri tipi',reg?.veri_tipi??'—'],['Sıra',reg?`${reg.word_order} / ${reg.byte_order}`:'—'],['Register çarpanı',reg?.carpan??'—'],['Okuma grubu',reg?.okuma_grubu_id??'—']];
  values.push(['Ölçüm zamanı',sample.timestamp??'Henüz ölçüm yok']);
  $('register-detail').innerHTML=`<div class="register-detail-grid">${values.map(([label,value])=>`<div><label>${esc(label)}</label><strong>${esc(value)}</strong></div>`).join('')}</div><p>${sample.pending?'Bu tag yapılandırılmış ancak API ölçümü henüz yok. Veri zincirindeki uyarıları kontrol et.':'Gösterilen değer collector tarafından çözülmüş ve API’den alınmıştır. Register çarpanı tekrar uygulanmaz.'}</p><pre class="register-detail-json">${esc(JSON.stringify(sample,null,2))}</pre>`;$('register-dialog').showModal();
}
document.addEventListener('click',e=>{
  const site=e.target.closest('[data-site]');if(site){selectedSite=site.dataset.site;selectedNode=`SAHA:${selectedSite}`;selectedDevice=null;fitNext=true;refreshModel();render();return;}
  const detailDevice=e.target.closest('[data-node-device]');if(detailDevice){$('node-dialog').close();selectNode(`DEVICE:${detailDevice.dataset.nodeDevice}`);$('detail-name').scrollIntoView({behavior:'smooth',block:'nearest'});return;}
  const node=e.target.closest('[data-node-key]');if(node){activateNode(node.dataset.nodeKey);return;}
  const device=e.target.closest('[data-device]');if(device){selectNode(`DEVICE:${device.dataset.device}`);return;}
  const tag=e.target.closest('[data-tag]');if(tag){showRegister(tag.dataset.tag);return;}
  const edit=e.target.closest('[data-config-edit]');if(edit){management.open(edit.dataset.configEdit,edit.dataset.recordId??null);return;}
  const list=e.target.closest('[data-config-list]');if(list){management.list(list.dataset.configList,list.dataset.scopeDevice);switchView('manage');return;}
  const inspect=e.target.closest('[data-config-inspect]');if(inspect){const key=`DEVICE:${inspect.dataset.configInspect}`;selectedDevice=inspect.dataset.configInspect;selectedNode=key;selectedSite=topology.siteOf.get(key)??selectedSite;render();management.renderPipeline(selectedDevice);$('pipeline-title').scrollIntoView({behavior:'smooth',block:'center'});return;}
  if(e.target.closest('.close-dialog')&&!e.target.closest('.close-dialog').disabled&&!busy())e.target.closest('dialog').close();
});
$('diagram').addEventListener('keydown',e=>{if(!['Enter',' '].includes(e.key))return;const tag=e.target.closest('[data-tag]'),n=e.target.closest('[data-node-key]');if(tag||n){e.preventDefault();if(tag)showRegister(tag.dataset.tag);else activateNode(n.dataset.nodeKey);}});
$('reference-device').onchange=e=>{selectedDevice=e.target.value;render();};
$('diagram-density').onchange=()=>renderDiagram();
$('open-settings').onclick=showSettings;$('empty-settings').onclick=showSettings;$('toggle-demo').onclick=toggleDemo;$('exit-demo').onclick=()=>connect();
$('retry').onclick=connect;$('refresh').onclick=()=>{if(demo){const d=demoData();config=d.config;measurements=normalizeMeasurements(d.measurements);refreshModel();recordHistory();render();}else{loadConfig(epoch);pollMeasurements(epoch);}};
$('zoom-in').onclick=()=>{zoom=Math.min(1.75,zoom+.1);renderDiagram();};$('zoom-out').onclick=()=>{zoom=Math.max(.3,zoom-.1);renderDiagram();};$('zoom-fit').onclick=()=>{fitNext=true;renderDiagram();};
function switchView(next){view=next;for(const [name,panel] of [['diagram','diagram-view'],['measure','measure-view'],['manage','manage-view']]){const tab=name==='measure'?'measure-tab':name+'-tab',isActive=name===next;$(tab).classList.toggle('active',isActive);$(tab).setAttribute('aria-selected',String(isActive));$(tab).tabIndex=isActive?0:-1;$(panel).classList.toggle('hidden',!isActive);}document.querySelector('.diagram-actions').classList.toggle('hidden',next!=='diagram');}
for(const name of ['diagram','measure','manage'])$(name+'-tab').onclick=()=>switchView(name);
document.querySelector('.view-tabs').addEventListener('keydown',e=>{if(['ArrowRight','ArrowLeft','Home','End'].includes(e.key)){e.preventDefault();const names=['diagram','measure','manage'];const i=e.key==='Home'?0:e.key==='End'?2:(names.indexOf(view)+(e.key==='ArrowRight'?1:2))%3;switchView(names[i]);$(names[i]+'-tab').focus();}});
$('add-site').onclick=()=>management.open('sites');$('add-device').onclick=()=>management.open('devices');$('edit-site').onclick=()=>management.open('sites',selectedSite);
$('edit-node').onclick=()=>{const n=topology.nodes.get(selectedNode);if(n)management.open({SAHA:'sites',DEVICE:'devices',DM:'dm',TM:'tm',TRAFO:'trafo',ADP:'adp'}[n.type],n.id);};
$('open-management').onclick=()=>{management.list('devices');switchView('manage');};
$('settings-form').onsubmit=e=>{e.preventDefault();const v=Object.fromEntries(new FormData(e.target)),next={baseUrl:v.baseUrl.trim().replace(/\/+$/,''),token:v.token.trim(),pollSeconds:Number(v.pollSeconds),staleSeconds:Number(v.staleSeconds),flowThreshold:Number(v.flowThreshold)};
  try{new ScadaApi(next);if(!Number.isFinite(next.flowThreshold)||next.flowThreshold<0||!Number.isInteger(next.pollSeconds)||next.pollSeconds<1||next.pollSeconds>60||!Number.isFinite(next.staleSeconds)||next.staleSeconds<3||next.staleSeconds>3600)throw new Error('Yenileme, eski veri eşiği ve akış eşiği geçerli olmalı.');settings=next;const {token,...persistent}=next;writePreference('scadawatt.settings.v1',persistent);$('settings-dialog').close();connect();}catch(err){$('settings-error').textContent=err.message;}
};
$('open-mapping').onclick=showMapping;$('mapping-form').onsubmit=e=>{e.preventDefault();const v=Object.fromEntries(new FormData(e.target)),next={flowSignal:v.flowSignal,breakerSignal:v.breakerSignal,closedValue:Number(v.closedValue),threshold:Number(v.threshold),direction:v.direction};if(!Number.isFinite(next.closedValue)||!Number.isFinite(next.threshold)||next.threshold<0){$('mapping-error').textContent='Kesici değeri ve eşik sonlu sayılar olmalı.';return;}mappings[String(selectedDevice)]=next;writePreference('scadawatt.mappings.v1',mappings);$('mapping-dialog').close();refreshModel();render();toast('Akış eşleştirmesi kaydedildi.');};
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',e=>{if(e.target===dialog&&!busy()){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
clockTimer=setInterval(()=>{$('clock').textContent=new Date().toLocaleString('tr-TR',{dateStyle:'short',timeStyle:'medium'});if(!demo){refreshModel();render();}},1000);
window.addEventListener('pagehide',()=>{epoch++;clearTimers();clearInterval(clockTimer);clearTimeout(toastTimer);},{once:true});
connect();

window.addEventListener('message',e=>{
 if(e.origin!==location.origin||e.source!==window.parent||e.data?.type!=='scadawatt.action')return;
 const {action,entity,id,siteId}=e.data;
 if(!['select','refresh','dismiss','snapshot'].includes(action)&&!busy())for(const d of document.querySelectorAll('dialog[open]'))d.close();
 if(action==='select'){selectedSite=siteId??selectedSite;selectedDevice=id??null;selectedNode=id?`DEVICE:${id}`:`SAHA:${selectedSite}`;refreshModel();render();}
 else if(action==='create'&&ENTITIES[entity])management.open(entity);
 else if(action==='edit'&&ENTITIES[entity])management.open(entity,id);
 else if(action==='list'&&ENTITIES[entity]){management.list(entity);switchView('manage');}
 else if(action==='map')mapEditor.open();
 else if(action==='scaling')scalingPanel.open();
 else if(action==='setup')management.openSetup();
 else if(action==='settings')$('open-settings').click();
 else if(action==='guide')$('open-guide').click();
 else if(action==='measure')switchView('measure');
 else if(action==='mapping')showMapping();
 else if(action==='demo')$('toggle-demo').click();
 else if(action==='refresh'){loadConfig(epoch);pollMeasurements(epoch);}
 else if(action==='dismiss'){if(!busy())for(const d of document.querySelectorAll('dialog[open]'))d.close();}
 else if(action==='snapshot')render();
});

// Embedded help uses the page tour instead of a full guide dialog.
document.addEventListener('click',event=>{if(window.parent!==window&&event.target.closest('#open-guide,#guide-resume')){event.preventDefault();event.stopImmediatePropagation();window.parent.postMessage({type:'scadawatt.guide'},location.origin);}},true);
window.addEventListener('message',async e=>{
 if(e.origin!==location.origin||e.source!==window.parent||e.data?.type!=='scadawatt.control')return;
 const {id,path,method='GET',body}=e.data;
 if(!/^(auth\/(?:me|collector-connection)|users(?:\/[0-9]+)?|workspace\/[0-9]+(?:\/(?:export|import))?|gpio-inputs\/channels|control\/controls|control\/commands(?:\/[0-9a-f-]{36})?|(?:dm|tm|trafo|adp|device)(?:\/[0-9]+)?)$/.test(path)||!['GET','POST','PATCH','PUT','DELETE'].includes(method))return;
 try{if(demo)throw Error('Gerçek komutlar örnek veri modunda kullanılamaz.');const result=await api.request(path,{method,body});if(method!=='GET'&&!/^(gpio-inputs|control|workspace|users)\//.test(path))await reloadSettings();window.parent.postMessage({type:'scadawatt.control-result',id,result},location.origin);}
 catch(error){window.parent.postMessage({type:'scadawatt.control-result',id,error:error.message},location.origin);}
});

async function checkAuthSetup(){
 $('auth-collector-info').hidden=true;$('auth-collector-token').value='';
 try{const connection=new ScadaApi({baseUrl:$('settings-url').value.trim(),token:''}),status=await connection.request('auth/status');
  $('auth-bootstrap').disabled=!!status.account_exists||!status.setup_allowed;
  $('auth-status').textContent=status.account_exists?'Hesap mevcut. Kullanıcı adı ve şifreyle giriş yap.':status.setup_allowed?'İlk kullanım: kullanıcı adı ve şifre belirleyip İlk hesabı oluştur seçeneğine bas. Token gerekmez.':'İlk hesabı API bilgisayarında http://127.0.0.1:5500 arayüzünü açarak oluştur. Sonrasında bu bilgisayardan giriş yapabilirsin.';
 }catch(error){$('auth-status').textContent=error.message+' API dosyalarını güncelle ve daha önce uygulamadıysan 002_auth.sql dosyasını çalıştır.';}
}
async function authenticate(bootstrap=false){
 const buttons=[$('auth-login'),$('auth-bootstrap')];buttons.forEach(b=>b.disabled=true);$('auth-status').textContent='API ile görüşülüyor…';
 try{
  const credentials={username:$('auth-user').value.trim(),password:$('auth-password').value};
  if(credentials.username.length<3||credentials.password.length<12)throw Error('En az 3 karakterlik kullanıcı adı ve 12 karakterlik şifre gir.');
  const connection=new ScadaApi({baseUrl:$('settings-url').value.trim(),token:''});
  const session=await connection.request(bootstrap?'auth/bootstrap':'auth/token',{method:'POST',body:credentials});
  $('settings-token').value=session.access_token;$('auth-password').value='';$('auth-status').textContent='Giriş başarılı · API bağlantısı kuruluyor.';
  $('settings-form').requestSubmit();toast('Giriş başarılı. Token otomatik alındı.');
 }catch(error){$('auth-status').textContent=error.message;}
 finally{buttons.forEach(b=>b.disabled=false);}
}
$('auth-login').onclick=()=>authenticate();$('auth-bootstrap').onclick=()=>authenticate(true);
$('settings-url').addEventListener('change',checkAuthSetup);
$('auth-collector').onclick=async()=>{try{const connection=new ScadaApi({baseUrl:$('settings-url').value.trim(),token:$('settings-token').value.trim()||settings.token}),v=await connection.request('auth/collector-connection');$('auth-collector-token').value=v.collector_token;$('auth-collector-info').hidden=false;$('auth-status').textContent='Bu anahtar yalnızca collector içindir. SCADA_API_TOKEN olarak kullan; arayüz kullanıcı hesabından ayrıdır.';}catch(e){$('auth-status').textContent=e.message+' Önce yönetici hesabıyla giriş yap.';}};

window.addEventListener('message',e=>{if(e.origin!==location.origin||e.source!==window.parent)return;
 if(e.data?.type==='scadawatt.login'){settings={...settings,baseUrl:e.data.baseUrl,token:e.data.token};currentUser=e.data.user;const {token,...persistent}=settings;writePreference('scadawatt.settings.v1',persistent);connect();}
 if(e.data?.type==='scadawatt.logout'){currentUser=null;settings.token='';connect();}
});
