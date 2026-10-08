export type NodeType='inverter'|'transformer'|'kiosk'|'meter'|'panel'|'group';
export type Shape={id:string,type:NodeType,name:string,code:string,x:number,y:number,width:number,height:number,color:string,binding:string|null,group:string|null,collapsed:boolean,isolated:boolean; phases?:boolean[]; displayTag?:string; displayLabel?:string; measurementDeviceId?:string|null; metricTags?:Record<string,string>};
export type Wire={id:string,from:string,to:string};
export type Layout={version:2,nodes:Shape[],connections:Wire[],background:string};
export const emptyLayout=():Layout=>({version:2,nodes:[],connections:[],background:'#081310'});
export const roles:Record<string,readonly string[]>={root:['layout','configure','scenario','users'],admin:['layout','configure','scenario','users'],operator:['layout','scenario'],viewer:[],reader:[]};
export const allowed=(role:string,action:string)=>(roles[role]||[]).includes(action);
export function addWire(g:Layout,from:string,to:string):Layout{
 if(from===to||!g.nodes.some(n=>n.id===from)||!g.nodes.some(n=>n.id===to))throw Error('İki farklı öğe seç.');
 if(g.connections.some(e=>e.from===from&&e.to===to))throw Error('Bağlantı zaten var.');
 const visit=(id:string,seen=new Set<string>()):boolean=>{if(id===from)return true;if(seen.has(id))return false;seen.add(id);return g.connections.filter(e=>e.from===id).some(e=>visit(e.to,seen));};
 if(visit(to))throw Error('Döngü oluşturulamaz.');
 return {...g,connections:[...g.connections,{id:crypto.randomUUID(),from,to}]};
}
export function isolated(g:Layout,id:string,seen=new Set<string>()):boolean{if(seen.has(id))return false;seen.add(id);return !!g.nodes.find(n=>n.id===id)?.isolated||g.connections.filter(e=>e.to===id).some(e=>isolated(g,e.from,seen));}
export function validateLayout(g:Layout):Layout{
 if(g?.version!==2||!Array.isArray(g.nodes)||!Array.isArray(g.connections)||g.nodes.length>2000||g.connections.length>10000)throw Error('Geçersiz şema; en fazla 2000 öğe.');
 const ids=new Set<string>();for(const n of g.nodes){if(n.phases!==undefined&&(!Array.isArray(n.phases)||n.phases.length!==3||n.phases.some(v=>typeof v!=='boolean')))throw Error('Geçersiz faz durumu.');if(typeof n.id!=='string'||ids.has(n.id)||typeof n.name!=='string'||typeof n.code!=='string'||!['inverter','transformer','kiosk','meter','panel','group'].includes(n.type)||![n.x,n.y,n.width,n.height].every(Number.isFinite)||n.width<100||n.width>2000||n.height<70||n.height>2000||Math.abs(n.x)>100000||Math.abs(n.y)>100000||!(n.binding===null||typeof n.binding==='string')||!(n.group===null||typeof n.group==='string')||!/^#[0-9a-f]{6}$/i.test(n.color))throw Error('Geçersiz öğe.');ids.add(n.id);}
 for(const n of g.nodes){
  if(n.measurementDeviceId!==undefined&&n.measurementDeviceId!==null&&(typeof n.measurementDeviceId!=='string'||!/^[1-9][0-9]*$/.test(n.measurementDeviceId)))throw Error('Geçersiz ölçüm cihazı ID’si.');
  if(n.metricTags!==undefined&&(n.metricTags===null||typeof n.metricTags!=='object'||Array.isArray(n.metricTags)||Object.entries(n.metricTags).some(([k,v])=>!['power','voltage','current','temp','efficiency','frequency','energy'].includes(k)||typeof v!=='string'||!(/^(?:[1-9][0-9]*|none)?$/.test(v)))))throw Error('Geçersiz kart register eşleştirmesi.');
 }
 let check={...g,connections:[] as Wire[]};const edgeIds=new Set<string>();for(const e of g.connections){if(typeof e.id!=='string'||edgeIds.has(e.id))throw Error('Geçersiz bağlantı.');edgeIds.add(e.id);check=addWire(check,e.from,e.to);}
 for(const n of g.nodes)if(n.group&&!g.nodes.some(p=>p.id===n.group&&p.type==='group'&&p.id!==n.id)||n.type==='group'&&n.group)throw Error('Geçersiz grup.');
 return {...g,background:/^#[0-9a-f]{6}$/i.test(g.background)?g.background:'#081310'};
}
export type Row=Record<string,any>;
export type Snapshot={config:Record<string,Row[]>,measurements:Row[],nodes:Row[],siteOf:[string,string|number][],states:[string,Row][],selectedSite:string|number|null,baseUrl:string,apiOnline:boolean,demo:boolean,lastError:string,schema:Row|null,busy?:boolean;user?:Row|null};
export function measurementSource(n:Shape):string|null{
 if(n.measurementDeviceId!==undefined)return n.measurementDeviceId||null;
 return n.binding?.startsWith('DEVICE:')?n.binding.slice(7):null;
}
export function nodeSamples(n:Shape,data:Snapshot|null):Row[]{
 const id=measurementSource(n);
 if(!data||!id||!data.nodes.some(d=>d.type==='DEVICE'&&String(d.id)===id))return [];
 return data.measurements.filter(m=>String(m.device_id)===id);
}
export function nodeTagOptions(n:Shape,data:Snapshot|null):Row[]{
 if(!data)return [];
 const id=measurementSource(n);if(!id)return [];
 const tags=(data.config.tags||[]).filter(t=>String(t.cihaz_id??t.device_id)===id).map(t=>({tag_id:t.id,signal_name:t.sinyal_adi??t.signal_name??t.tag_adi,unit:t.birim??t.unit??''}));
 const options=new Map<string,Row>(tags.map(t=>[String(t.tag_id),t]));
 for(const m of nodeSamples(n,data))options.set(String(m.tag_id),m);
 return [...options.values()];
}
export const metricsFor:Record<NodeType,[string,string][]>= {
 inverter:[['power','Aktif güç'],['voltage','Gerilim'],['current','Akım'],['temp','Sıcaklık'],['efficiency','Verim'],['frequency','Frekans']],
 transformer:[['power','Aktif güç'],['voltage','Gerilim'],['current','Akım'],['temp','Trafo sıcaklığı']],
 kiosk:[['power','Aktif güç'],['voltage','Gerilim'],['current','Akım']],
 panel:[['power','Aktif güç'],['voltage','Gerilim'],['current','Akım']],
 meter:[['energy','Aktif enerji'],['power','Aktif güç'],['voltage','Gerilim'],['current','Akım'],['frequency','Frekans']],
 group:[]
};
export function nodeMetric(n:Shape,rows:Row[],kind:string):Row|null{
 const tag=n.metricTags?.[kind];
 if(tag==='none')return null;
 if(tag){const row=rows.find(m=>String(m.tag_id)===tag);return row&&metricChoices([row],kind).length?row:null;}
 if(kind==='temp'&&n.type==='transformer')return pick(rows.filter(m=>/transformer|trafo/.test(normalize(m.signal_name||''))),kind);
 return pick(rows,kind);
}
export function metricChoices(options:Row[],kind:string):Row[]{
 return options.filter(o=>!!pick([{...o,value:0}],kind));
}
export function seed(data:Snapshot):Layout{const g=emptyLayout(),sites=new Map(data.siteOf),levels=new Map<number,number>();for(const n of data.nodes){if(n.type==='SAHA'||String(sites.get(n.key))!==String(data.selectedSite))continue;let depth=0,p=n.parent;while(p&&depth<10){depth++;p=data.nodes.find(x=>x.key===p)?.parent;}const type:NodeType=n.type==='DEVICE'?'inverter':n.type==='TRAFO'?'transformer':n.type==='ADP'?'panel':'kiosk';const i=levels.get(depth)||0;levels.set(depth,i+1);g.nodes.push({id:n.key,type,name:n.name,code:n.key,binding:n.key,x:Math.max(0,depth-1)*340+60,y:55+i*270,...deviceSize[type],color:'#13221f',group:null,collapsed:false,isolated:false});}for(const n of g.nodes){const p=data.nodes.find(x=>x.key===n.binding)?.parent;if(g.nodes.some(x=>x.id===p))g.connections.push({id:crypto.randomUUID(),from:p,to:n.id});}return g;}
export const normalize=(s:string)=>s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i');
export function pick(rows:Row[],kind:string){const units:Record<string,string[]>={power:['kw','w','mw'],voltage:['v','kv'],temp:['°c','c','degc'],efficiency:[],frequency:['hz'],current:['a','ka','ma'],energy:['kwh','wh','mwh']},aliases:Record<string,string[]>={power:['grid_active_power','p_tot','p_total','power_total','p_aktif'],voltage:['grid_voltage_avg','v_l1n','voltage_l1'],temp:['inverter_temperature','temperature','panel_temperature','temp','transformer_temp'],efficiency:['inverter_efficiency','efficiency','verim'],frequency:['grid_frequency','frequency','freq','frekans'],current:['grid_current_avg','i_l1','current_l1','current'],energy:['e_imp','generation_energy','active_energy','e_active']};const eligible=rows.filter(m=>{const name=normalize(m.signal_name||'');return !(kind==='energy'?/(reactive|reaktif|eq_|export|e_exp)/:/(reactive|reaktif|apparent|neutral|notr|unbalance|demand|thd|minimum|maximum|_min|_max|energy|enerji|dc_|pv_)/).test(name)&&((aliases[kind]||[]).includes(name)||(units[kind]||[]).includes(normalize(m.unit||'')))&&typeof m.value==='number'&&Number.isFinite(m.value);});eligible.sort((a,b)=>Number(b.quality==='GOOD')-Number(a.quality==='GOOD')+((aliases[kind]||[]).includes(normalize(b.signal_name||''))?.1:0)-((aliases[kind]||[]).includes(normalize(a.signal_name||''))?.1:0));return eligible[0]||null;}

export const deviceSize:Record<NodeType,{width:number,height:number}>={kiosk:{width:330,height:265},transformer:{width:265,height:225},inverter:{width:210,height:185},panel:{width:285,height:245},meter:{width:175,height:190},group:{width:430,height:300}};
