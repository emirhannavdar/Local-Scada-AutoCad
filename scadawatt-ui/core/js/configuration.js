import {buildTopology,nameOf,parseTimestamp} from './model.js';

export const ENTITIES={
  sites:{path:'saha',title:'Sahalar',singular:'Saha'},devices:{path:'device',title:'Cihazlar',singular:'Cihaz'},
  dm:{path:'dm',title:'Köşk / DM',singular:'Köşk / DM'},tm:{path:'tm',title:'TM / Hücre',singular:'TM / Hücre'},
  trafo:{path:'trafo',title:'Trafolar',singular:'Trafo'},adp:{path:'adp',title:'Dağıtım panoları',singular:'Dağıtım panosu'},
  groups:{path:'readGroup',title:'Okuma grupları',singular:'Okuma grubu'},registers:{path:'register',title:'Registerlar',singular:'Register'},
  tags:{path:'tag',title:'Tag / Sinyaller',singular:'Tag'},profiles:{path:'device_profile',title:'Cihaz profilleri',singular:'Cihaz profili'},
  signals:{path:'signalDict',title:'Sinyal sözlüğü',singular:'Sinyal tanımı'},profileRegisters:{path:'profile_register',title:'Profil registerları',singular:'Profil registerı'},
  serialLines:{path:'serialLine',title:'Seri hatlar',singular:'Seri hat'}
};
export const emptyConfig=()=>Object.fromEntries(Object.keys(ENTITIES).map(k=>[k,[]]));
const string=(def)=>({type:'string',...(def===undefined?{}:{default:def})}),integer=(def)=>({type:'integer',...(def===undefined?{}:{default:def})}),number=(def)=>({type:'number',...(def===undefined?{}:{default:def})}),bool=def=>({type:'boolean',default:def}),nullable=s=>({anyOf:[s,{type:'null'}]}),enumString=values=>({type:'string',enum:values});
function schema(properties,required){return {type:'object',properties,required};}
// Fallbacks are transcribed from the supplied Python request models, not inferred from DB rows.
export const KNOWN_SCHEMAS={
  sites:schema({name:string(),code:string(),kurulu_guc_kwp:number(),loc:string(),timeZone:string('Europe/Istanbul'),aktif:bool(true),varsayilan_carpan:number(1)},['name','code','kurulu_guc_kwp','loc','timeZone']),
  devices:schema({ust_dugum_tipi:string(),ust_dugum_id:integer(),name:string(),profil_id:integer(),profil_surum:string(),protokol:string('MODBUS_TCP'),ip:nullable(string()),port:nullable(integer(502)),slave_id:nullable(integer(1)),seri_hat_id:nullable(integer()),aktif:bool(true),bakim_modu:bool(false),durum:string('UNKNOWN')},['ust_dugum_tipi','ust_dugum_id','name','profil_id','profil_surum','protokol']),
  profiles:schema({name:string(),marka:string(),model:string(),device_type:string(),protocol:string('MODBUS_TCP'),surum:nullable(string()),aciklama:nullable(string()),aktif:bool(true)},['name','marka','model','device_type','protocol']),
  registers:schema({cihaz_id:integer(),profil_register_id:integer(),sinyal_sozlugu_id:integer(),name:string(),baslangic_adresi:integer(),register_sayisi:integer(2),function_code:integer(3),veri_tipi:string('FLOAT32'),word_order:string('ABCD'),byte_order:string('BIG'),birim:string(),carpan:number(1),min_deger:number(),max_deger:number(),aktif:bool(true),aciklama:nullable(string()),okuma_grubu_id:integer()},['cihaz_id','profil_register_id','sinyal_sozlugu_id','name','baslangic_adresi','register_sayisi','function_code','veri_tipi','word_order','byte_order','birim','carpan','min_deger','max_deger','okuma_grubu_id']),
  profileRegisters:schema({profile_id:integer(),register_adresi:integer(),function_code:integer(3),register_sayisi:integer(2),veri_tipi:string('FLOAT32'),byte_order:string('BIG'),word_order:string('ABCD'),olcek:number(1),offset_degeri:number(0),bit_index:integer(0),sinyal_sozlugu_id:integer(),aciklama:nullable(string())},['profile_id','register_adresi','function_code','register_sayisi','veri_tipi','byte_order','word_order','olcek','offset_degeri','bit_index','sinyal_sozlugu_id'])
};
export const FIELD_LABELS={name:'Ad',ad:'Ad',code:'Saha kodu',kod:'Kod',loc:'Konum',konum:'Konum',timeZone:'Zaman dilimi',zaman_dilimi:'Zaman dilimi',kurulu_guc_kwp:'Kurulu güç (kWp)',varsayilan_carpan:'Varsayılan çarpan',aktif:'Aktif',bakim_modu:'Bakım modu',ip:'Cihaz IP adresi',port:'Modbus TCP portu',slave_id:'Unit / Slave ID',protokol:'Protokol',protocol:'Protokol',profil_id:'Cihaz profili',profile_id:'Cihaz profili',profil_surum:'Profil sürümü',seri_hat_id:'Seri hat',durum:'Kayıtlı durum',saha_id:'Saha',dm_id:'Köşk / DM',tm_id:'TM / Hücre',trafo_id:'Trafo',adp_id:'Dağıtım panosu',cihaz_id:'Cihaz',device_id:'Cihaz',register_id:'Register',okuma_grubu_id:'Okuma grubu',profil_register_id:'Profil registerı',sinyal_sozlugu_id:'Sinyal sözlüğü',sinyal_adi:'Sinyal adı',tag_adi:'Tag adı',function_code:'Modbus fonksiyonu',baslangic_adresi:'Başlangıç PDU adresi',bitis_adresi:'Bitiş PDU adresi',register_adresi:'PDU adresi',register_sayisi:'16 bit register sayısı',veri_tipi:'Veri tipi',word_order:'Word order',byte_order:'Byte order',birim:'Birim',carpan:'Register çarpanı',min_deger:'Minimum değer',max_deger:'Maksimum değer',okuma_periyodu_ms:'Okuma periyodu (ms)',maksimum_register:'Blok register sınırı',aciklama:'Açıklama',marka:'Marka',model:'Model',device_type:'Cihaz tipi',cihaz_tipi:'Cihaz tipi',surum:'Sürüm',olcek:'Ölçek',offset_degeri:'Offset',bit_index:'Bit indeksi',tip:'Tag tipi',okuma_sinifi:'Okuma sınıfı',arsiv_kurali:'Arşiv kuralı',alarm_sinifi:'Alarm sınıfı',deadband:'Deadband'};
export const FIELD_HINTS={ip:'Modbus simülatörünün / cihazın IP’si. Aynı bilgisayardaysa 127.0.0.1.',port:'API portu 8000 ile karıştırma. Simülatör hangi portu dinliyorsa onu gir.',profil_surum:'Cihazın kullandığı profil sürümü; profil kaydından doldurulur.',durum:'Collector’ın erişim sonucu ayrıca kalite/zaman üzerinden gösterilir.',baslangic_adresi:'Sıfır tabanlı Modbus PDU adresi; simülatördeki gerçek haritayla eşleştir.',register_adresi:'Sıfır tabanlı PDU adresi.',register_sayisi:'Float32 = 2, Float64 = 4 adet 16 bit register.',word_order:'Simülatörün sırasıyla aynı olmalı; varsayılan harita ABCD olabilir.',carpan:'Decoder bu çarpanı bir kez uygular; arayüz tekrar çarpmaz.',maksimum_register:'FC03/FC04 blokları en çok 125 register okuyabilir.',varsayilan_carpan:'Mevcut decoder saha çarpanını ayrıca uygulamaz.',olcek:'Mevcut collector tag/profil ölçeğini ayrıca uygulamaz.',offset_degeri:'Mevcut decoder profil offset dönüşümünü uygulamaz.',bit_index:'Mevcut BOOL decoder registerın tamamını değerlendirir; bit seçimi uygulamaz.'};
export const FOREIGN_FIELDS={saha_id:'sites',dm_id:'dm',tm_id:'tm',trafo_id:'trafo',adp_id:'adp',cihaz_id:'devices',device_id:'devices',profil_id:'profiles',profile_id:'profiles',seri_hat_id:'serialLines',register_id:'registers',okuma_grubu_id:'groups',profil_register_id:'profileRegisters',sinyal_sozlugu_id:'signals'};
const aliases={name:['ad'],ad:['name'],code:['kod'],kod:['code'],loc:['konum'],timeZone:['zaman_dilimi'],device_type:['cihaz_tipi'],protocol:['protokol'],profile_id:['profil_id'],device_id:['cihaz_id']};
export function rowValue(row,key){if(Object.hasOwn(row,key))return row[key];for(const alias of aliases[key]||[])if(Object.hasOwn(row,alias))return row[alias];return undefined;}
export function resolveSchema(doc,input,seen=new Set()) {
  if(!input)return {};
  if(input.$ref){if(seen.has(input.$ref))throw new Error('Döngüsel API şeması bu formda desteklenmiyor.');const next=new Set(seen);next.add(input.$ref);const ref=input.$ref.split('/').slice(1).reduce((x,k)=>x?.[k.replace(/~1/g,'/').replace(/~0/g,'~')],doc);if(!ref)throw new Error('API şema referansı bulunamadı.');return resolveSchema(doc,ref,next);}
  if(input.allOf){const parts=input.allOf.map(x=>resolveSchema(doc,x,seen));return {...input,properties:Object.assign({},...parts.map(x=>x.properties||{})),required:[...new Set(parts.flatMap(x=>x.required||[]))]};}
  return input;
}
export function fieldSchema(doc,input){const full=resolveSchema(doc,input);const variants=full.anyOf||full.oneOf||[];const nullable=full.type==='null'||variants.some(s=>resolveSchema(doc,s).type==='null');const primary=variants.length?resolveSchema(doc,variants.find(s=>resolveSchema(doc,s).type!=='null')||{}):full;return {...primary,...(Object.hasOwn(full,'default')?{default:full.default}:{}),nullable};}
export function operationFor(doc,base,entity,editing=false) {
  if(doc){const prefix=new URL(base).pathname.replace(/\/+$/,''),collection=`${prefix}/${ENTITIES[entity].path}`;
    let path=collection;
    if(editing){
      // GET /{saha_id} can precede PUT /{id}; select by supported method, not insertion order.
      const candidates=Object.keys(doc.paths||{}).filter(p=>p.startsWith(collection+'/')&&/^\{[^/]+\}$/.test(p.slice(collection.length+1)));
      path=candidates.find(p=>doc.paths[p].put)||candidates.find(p=>doc.paths[p].patch);
      // A root-level site route is accepted only when OpenAPI explicitly identifies a site body.
      if(!path&&entity==='sites')path=Object.keys(doc.paths||{}).find(p=>{
        if(!p.startsWith(prefix+'/')||!/^\{[^/]+\}$/.test(p.slice(prefix.length+1)))return false;
        const op=doc.paths[p].put||doc.paths[p].patch;if(!op)return false;
        const body=resolveSchema(doc,resolveSchema(doc,op.requestBody)?.content?.['application/json']?.schema);
        return ['name','code','kurulu_guc_kwp','loc','timeZone'].every(k=>body.properties?.[k]);
      });
    }
    const endpoint=doc.paths?.[path],method=editing?(endpoint?.put?'PUT':endpoint?.patch?'PATCH':null):(endpoint?.post?'POST':null);
    if(!method)throw new Error(`${ENTITIES[entity].singular} için ${editing?'güncelleme':'ekleme'} endpoint’i API şemasında yok.`);
    const op=endpoint[method.toLowerCase()],body=resolveSchema(doc,op.requestBody),input=body?.content?.['application/json']?.schema;
    const model=resolveSchema(doc,input);if(!model.properties)throw new Error('Bu endpoint JSON nesne formu sunmuyor.');
    return {method,schema:model,collection:editing?path.slice(prefix.length+1).replace(/\/?\{[^/]+\}$/,''):ENTITIES[entity].path,path};
  }
  if(KNOWN_SCHEMAS[entity])return {method:editing?'PUT':'POST',schema:KNOWN_SCHEMAS[entity],collection:ENTITIES[entity].path};
  throw new Error('Bu form için backend’in /openapi.json şeması gerekli. API bağlantısını ve tanılamadaki şema hatasını kontrol et.');
}
export function choicesFor(key,config,values={}) {
  const field=FOREIGN_FIELDS[key];if(!field)return null;let rows=config[field]||[];
  const deviceId=values.cihaz_id??values.device_id;
  if(['okuma_grubu_id','register_id'].includes(key)&&deviceId)rows=rows.filter(r=>String(r.cihaz_id??r.device_id)===String(deviceId));
  if(key==='profil_register_id'){
    const device=(config.devices||[]).find(d=>String(d.id)===String(deviceId));
    if(device)rows=rows.filter(r=>String(r.profile_id??r.profil_id)===String(device.profil_id));
  }
  return rows;
}
export function formPayload(doc,model,values) {
  const body={},required=new Set(model.required||[]);
  for(const [key,input] of Object.entries(model.properties||{})){
    if(input.readOnly)continue;const s=fieldSchema(doc,input),raw=values[key];
    if(raw===undefined){if(required.has(key))throw new Error(`${FIELD_LABELS[key]||key} zorunlu.`);continue;}
    if(raw===null || raw===''&&s.type!=='string'){
      if(s.nullable){body[key]=null;continue;}if(required.has(key))throw new Error(`${FIELD_LABELS[key]||key} zorunlu.`);continue;
    }
    let value=raw;
    if(s.type==='integer'||s.type==='number'){value=Number(raw);if(!Number.isFinite(value)||(s.type==='integer'&&!Number.isInteger(value)))throw new Error(`${FIELD_LABELS[key]||key} geçerli bir sayı olmalı.`);}
    else if(s.type==='boolean'){if(![true,false,'true','false'].includes(raw))throw new Error(`${key}: geçerli mantıksal değer bekleniyor.`);value=raw===true||raw==='true';}
    else if(s.type==='string')value=String(raw).trim();
    else throw new Error(`${key}: bu alan tipi formda desteklenmiyor.`);
    if(required.has(key)&&s.type==='string'&&value===''&&!['birim'].includes(key))throw new Error(`${FIELD_LABELS[key]||key} boş olamaz.`);
    if(s.enum&&!s.enum.includes(value))throw new Error(`${FIELD_LABELS[key]||key} izin verilen seçeneklerden olmalı.`);
    if(s.minimum!==undefined&&value<s.minimum||s.maximum!==undefined&&value>s.maximum)throw new Error(`${FIELD_LABELS[key]||key} API sınırları dışında.`);
    body[key]=value;
  }
  return body;
}
const countFor={BOOL:1,ENUM:1,INT16:1,UINT16:1,FLOAT16:1,INT32:2,UINT32:2,FLOAT32:2,FLOAT64:4};
export function registerProblems(reg,group){
  const issues=[],fc=Number(reg.function_code),start=Number(reg.baslangic_adresi??reg.register_adresi),size=Number(reg.register_sayisi),type=String(reg.veri_tipi||'').toUpperCase();
  if(![3,4].includes(fc))issues.push('Collector yalnızca FC03 ve FC04 okur.');
  if(!Number.isInteger(start)||start<0||!Number.isInteger(size)||size<1||size>125||start+size>65536)issues.push('PDU adresi/sayısı 0–65535 aralığına ve 125 register sınırına uymuyor.');
  if(countFor[type]&&size!==countFor[type])issues.push(`${type} için ${countFor[type]} register gerekli.`);
  if(!countFor[type]&&type!=='STRING')issues.push(`Decoder ${type||'boş'} veri tipini desteklemiyor.`);
  if(group){if(String(group.cihaz_id)!==String(reg.cihaz_id))issues.push('Register ve okuma grubu farklı cihazlara ait.');if(Number(group.function_code)!==fc)issues.push('Register ve okuma grubu FC03/FC04 seçimi farklı.');}
  return issues;
}
function validIp(value){try{const url=new URL(`http://${value.includes(':')?'['+value+']':value}/`);return value.includes(':')?url.hostname.startsWith('['):/^(\d{1,3}\.){3}\d{1,3}$/.test(value)&&value.split('.').every(n=>Number(n)<=255);}catch{return false;}}
export function validateConfiguration(entity,body,config) {
  const problems=[];
  for(const [key,field] of Object.entries(FOREIGN_FIELDS))if(body[key]!=null && !(config[field]||[]).some(r=>String(r.id)===String(body[key])))problems.push(`${FIELD_LABELS[key]} kaydı bulunamadı; önce ilgili kaydı ekle veya listeyi yenile.`);
  if(entity==='sites'){if(body.kurulu_guc_kwp<0)problems.push('Kurulu güç negatif olamaz.');if(body.timeZone){try{new Intl.DateTimeFormat('tr-TR',{timeZone:body.timeZone});}catch{problems.push('Geçerli bir IANA zaman dilimi gir (Europe/Istanbul).');}}}
  if(entity==='devices'){
    const topology=buildTopology(config),parent=topology.nodes.get(`${body.ust_dugum_tipi}:${body.ust_dugum_id}`);
    if(!parent||parent.type==='DEVICE'||!topology.siteOf.has(parent.key))problems.push('Sahaya bağlı geçerli bir üst düğüm seç.');
    if(!['MODBUS_TCP','MODBUS_RTU'].includes(body.protokol))problems.push('Mevcut collector MODBUS_TCP veya MODBUS_RTU destekliyor.');
    if(!Number.isInteger(body.slave_id)||body.slave_id<1||body.slave_id>247)problems.push('Unit / Slave ID 1–247 arasında olmalı.');
    if(body.protokol==='MODBUS_TCP'){if(!validIp(body.ip||''))problems.push('Geçerli bir IPv4 / IPv6 cihaz adresi gir.');if(!Number.isInteger(body.port)||body.port<1||body.port>65535)problems.push('TCP portu 1–65535 arasında olmalı.');}
    if(body.protokol==='MODBUS_RTU'&&!body.seri_hat_id)problems.push('RTU için bir seri hat seç.');
  }
  if(entity==='groups'){
    if(body.function_code!=null&&![3,4].includes(body.function_code))problems.push('Okuma grubu FC03 veya FC04 olmalı.');
    if(body.okuma_periyodu_ms!=null&&body.okuma_periyodu_ms<100)problems.push('Okuma periyodu en az 100 ms olmalı.');
    if(body.maksimum_register!=null&&(body.maksimum_register<1||body.maksimum_register>125))problems.push('Blok sınırı 1–125 olmalı.');
  }
  if(entity==='registers'||entity==='profileRegisters'){
    const group=(config.groups||[]).find(g=>String(g.id)===String(body.okuma_grubu_id));problems.push(...registerProblems(body,group));
    if(body.min_deger>body.max_deger)problems.push('Minimum değer maksimumdan büyük olamaz.');
    if(!['BIG','LITTLE'].includes(body.byte_order)||!['ABCD','CDAB','BADC','DCBA'].includes(body.word_order))problems.push('Byte/word order decoder seçenekleriyle eşleşmeli.');
    if(entity==='registers'){
      const device=(config.devices||[]).find(d=>String(d.id)===String(body.cihaz_id)),profileReg=(config.profileRegisters||[]).find(r=>String(r.id)===String(body.profil_register_id));
      if(device&&profileReg&&String(profileReg.profile_id??profileReg.profil_id)!==String(device.profil_id))problems.push('Profil registerı seçili cihazın profiline ait değil.');
    }
  }
  if(entity==='tags'){
    const reg=(config.registers||[]).find(r=>String(r.id)===String(body.register_id));
    if(!reg)problems.push('Tag için ölçülecek registerı seç.');else if(String(reg.cihaz_id)!==String(body.cihaz_id??body.device_id))problems.push('Tag ve register aynı cihaza ait olmalı.');
  }
  if(problems.length)throw new Error([...new Set(problems)].join(' '));return body;
}
export function devicePipeline(device,config,measurements,loaded={}) {
  const own=row=>String(row.cihaz_id??row.device_id)===String(device.id),active=row=>row.aktif!==false&&row.aktif!==0;
  const groups=(config.groups||[]).filter(own),regs=(config.registers||[]).filter(own),tags=(config.tags||[]).filter(own),samples=measurements.filter(row=>String(row.device_id)===String(device.id)),issues=[];
  if(!active(device))issues.push('Cihaz pasif: collector ve ölçüm listesi dışında.');
  if(device.bakim_modu)issues.push('Bakım modu açık: collector bu cihazı okumuyor.');
  if(device.protokol==='MODBUS_TCP'&&(!device.ip||!device.port||device.slave_id==null))issues.push('IP / port / Unit ID eksik.');
  for(const field of ['groups','registers','tags'])if(loaded[field]===false)issues.push(`${ENTITIES[field].title} API’den okunamadı; eksik olup olmadığı doğrulanamadı.`);
  const usableGroups=groups.filter(g=>active(g)&&[3,4].includes(Number(g.function_code))),usableRegs=regs.filter(r=>active(r)&&usableGroups.some(g=>String(g.id)===String(r.okuma_grubu_id)&&registerProblems(r,g).length===0)),usableTags=tags.filter(t=>active(t)&&usableRegs.some(r=>String(r.id)===String(t.register_id)));
  if(loaded.groups!==false&&!usableGroups.length)issues.push('Aktif FC03/FC04 okuma grubu yok.');
  if(loaded.registers!==false&&!usableRegs.length)issues.push('Aktif gruba bağlı, geçerli bir register yok.');
  if(loaded.tags!==false&&!usableTags.length)issues.push('Okunabilir registera bağlı aktif tag yok.');
  for(const r of regs.filter(active)){
    const g=groups.find(g=>String(g.id)===String(r.okuma_grubu_id));
    if(!g)issues.push(`${nameOf(r)}: okuma grubu bağlantısı yok.`);else registerProblems(r,g).forEach(p=>issues.push(`${nameOf(r)}: ${p}`));
  }
  for(const t of tags.filter(active))if(!regs.some(r=>String(r.id)===String(t.register_id)))issues.push(`${t.tag_adi??nameOf(t)}: register başka cihazda veya bulunamıyor.`);
  if(usableTags.length&&!samples.length)issues.push('Yapılandırma okunabilir görünüyor ancak /measurement bu cihaz için boş. Collector terminalinde POST /measurement ve Modbus yanıtını kontrol et.');
  if(samples.some(s=>['COMM_FAIL','BAD'].includes(s.quality)))issues.push('API iletişim / decode hatası bildiriyor; IP, port, Unit ID, adres ve sıra ayarlarını karşılaştır.');
  if(samples.some(s=>!Number.isFinite(parseTimestamp(s.timestamp))))issues.push('Ölçüm zaman damgasında UTC/ofset eksik veya tarih geçersiz.');
  return {groups,regs,tags,samples,usableGroups,usableRegs,usableTags,issues:[...new Set(issues)]};
}
