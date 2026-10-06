import {ENTITIES,operationFor,fieldSchema,rowValue,formPayload,validateConfiguration,registerProblems} from './configuration.js';
import {nameOf} from './model.js';
const eq=(a,b)=>String(a)===String(b),active=r=>r.aktif!==false&&r.aktif!==0;
const name=r=>r.sinyal_adi??r.sinyal_kodu??r.kod??r.name??r.ad??`Sinyal_${r.id}`;
const fields=['devices','profiles','profileRegisters','signals','groups','registers','tags'];
export const setupFingerprint=config=>JSON.stringify(fields.map(k=>config[k]||[]));

// Plans come exclusively from the saved profile map and the live request schemas.
// Negative IDs exist only inside the preview; executeSetup replaces them before POST.
export function createSetupPlan(ctx,deviceId) {
  const {config,api,schema:doc,loaded={}}=ctx;
  const device=config.devices.find(d=>eq(d.id,deviceId));if(!device)throw new Error('Cihaz bulunamadı.');
  for(const key of fields)if(loaded[key]===false)throw new Error(`${ENTITIES[key].title} listesi okunamadı. Önce API hatasını düzelt; eksik kayıt varsayılarak kurulum yapılmaz.`);
  if(!active(device)||device.bakim_modu)throw new Error('Önce cihazı aktif yap ve bakım modunu kapat.');
  const maps=config.profileRegisters.filter(p=>eq(p.profil_id??p.profile_id,device.profil_id));
  if(!maps.length)throw new Error('Cihazın profilinde register haritası yok. Saha / cihaz ayarları → Profil registerları bölümüne simülatörün gerçek PDU adreslerini ekle.');
  const models=Object.fromEntries(['groups','registers','tags'].map(entity=>[entity,operationFor(doc,api.base,entity).schema]));
  const entries=[],shadow=structuredClone(config);let temporary=-1;
  function add(entity,label,candidates) {
    const model=models[entity],values={};
    for(const [key,input] of Object.entries(model.properties||{})){
      if(input.readOnly)continue;const f=fieldSchema(doc,input);
      if(!['string','integer','number','boolean'].includes(f.type))throw new Error(`${key}: kurulum formunda bu API alan tipi desteklenmiyor.`);
      const candidate=rowValue(candidates,key);
      if(candidate!==undefined)values[key]=candidate;else if(f.default!==undefined)values[key]=f.default;
    }
    const entry={key:`${entity}:${temporary}`,id:temporary--,entity,label,model,values};entries.push(entry);
    shadow[entity].push({id:entry.id,...values});return entry.id;
  }
  const byFc=new Map();
  for(const p of maps){
    const errors=registerProblems({...p,baslangic_adresi:p.register_adresi});
    if(errors.length)throw new Error(`Profil registerı #${p.id}: ${errors.join(' ')}`);
    if(Number(p.offset_degeri||0)!==0||String(p.veri_tipi).toUpperCase()==='BOOL'&&Number(p.bit_index||0)!==0)throw new Error(`Profil #${p.id}: mevcut decoder offset / bit seçimini uygulamıyor. Bu dönüşümü destekleyen decoder veya uygun profil gerekiyor.`);
    if(!config.signals.some(s=>eq(s.id,p.sinyal_sozlugu_id)))throw new Error(`Profil #${p.id}: sinyal sözlüğü kaydı bulunamadı.`);
    const fc=Number(p.function_code);if(!byFc.has(fc))byFc.set(fc,[]);byFc.get(fc).push(p);
  }
  for(const [fc,profileMaps] of byFc){
    let groupId=null;
    for(const p of profileMaps){
      const signal=config.signals.find(s=>eq(s.id,p.sinyal_sozlugu_id));
      const own=config.registers.filter(r=>eq(r.cihaz_id,device.id)&&eq(r.profil_register_id,p.id));
      let existing=own.find(r=>active(r));
      if(own.length&&!existing)throw new Error(`Profil #${p.id} için pasif register var. Önce mevcut registerı düzenle; ikinci kopya oluşturulmaz.`);
      if(existing){
        const g=config.groups.find(g=>eq(g.id,existing.okuma_grubu_id));
        if(!g||!active(g)||registerProblems(existing,g).length)throw new Error(`${nameOf(existing)}: mevcut register / grup bağlantısını düzelt.`);
      }
      let registerId=existing?.id;
      if(!existing){
        if(groupId===null){
          const start=Math.min(...profileMaps.map(p=>Number(p.register_adresi))),end=Math.max(...profileMaps.map(p=>Number(p.register_adresi)+Number(p.register_sayisi)-1)),maxSize=Math.max(...profileMaps.map(p=>Number(p.register_sayisi)));
          const group=config.groups.find(g=>eq(g.cihaz_id,device.id)&&active(g)&&Number(g.function_code)===fc&&Number(g.maksimum_register??125)>=maxSize&&(g.baslangic_adresi==null||Number(g.baslangic_adresi)<=start)&&(g.bitis_adresi==null||Number(g.bitis_adresi)>=end));
          const template=config.groups.find(g=>active(g)&&Number(g.function_code)===fc)||{};
          groupId=group?.id??add('groups',`FC0${fc} okuma grubu`,{...template,cihaz_id:device.id,device_id:device.id,name:`${nameOf(device)} FC0${fc}`,ad:`${nameOf(device)} FC0${fc}`,function_code:fc,baslangic_adresi:start,bitis_adresi:end,okuma_periyodu_ms:1000,maksimum_register:125,aktif:true,aciklama:'Arayüzden profil haritasına göre hazırlanan okuma grubu'});
        }
        const template=config.registers.find(r=>eq(r.profil_register_id,p.id))||{};
        registerId=add('registers',`${name(signal)} · PDU ${p.register_adresi}`,{...template,cihaz_id:device.id,device_id:device.id,profil_register_id:p.id,sinyal_sozlugu_id:p.sinyal_sozlugu_id,name:name(signal),ad:name(signal),baslangic_adresi:p.register_adresi,register_sayisi:p.register_sayisi,function_code:fc,veri_tipi:p.veri_tipi,word_order:p.word_order,byte_order:p.byte_order,birim:signal.birim??template.birim??'',carpan:p.olcek??1,min_deger:signal.min_deger??template.min_deger,max_deger:signal.max_deger??template.max_deger,okuma_grubu_id:groupId,aktif:true});
      }
      const ownTags=config.tags.filter(t=>eq(t.cihaz_id??t.device_id,device.id)&&eq(t.register_id,registerId));
      if(ownTags.some(active))continue;
      if(ownTags.length)throw new Error(`${name(signal)} için pasif tag var. Mevcut tag’i aktif yap; ikinci kopya oluşturulmaz.`);
      const template=config.tags.find(t=>eq(t.profil_register_id,p.id)&&active(t))||{};
      const tagName=`device_${device.id}_pr${p.id}_${name(signal)}`;
      add('tags',`${name(signal)} tag`,{...template,cihaz_id:device.id,device_id:device.id,register_id:registerId,profil_register_id:p.id,sinyal_sozlugu_id:p.sinyal_sozlugu_id,sinyal_adi:name(signal),tag_adi:tagName,name:tagName,ad:tagName,birim:signal.birim??existing?.birim??template.birim??'',olcek:1,okuma_sinifi:signal.okuma_sinifi??template.okuma_sinifi,arsiv_kurali:signal.arsiv_kurali??template.arsiv_kurali,alarm_sinifi:signal.alarm_sinifi??template.alarm_sinifi,deadband:signal.deadband??template.deadband,aktif:true});
    }
  }
  return {device,entries,doc,models,fingerprint:setupFingerprint(config)};
}

export function validateSetupPlan(plan,config,overrides={}) {
  const shadow=structuredClone(config),bodies=[];
  for(const entry of plan.entries){
    const values={...entry.values,...overrides[entry.key]},body=validateConfiguration(entry.entity,formPayload(plan.doc,entry.model,values),shadow);
    if(entry.entity==='registers'){
      const g=shadow.groups.find(g=>eq(g.id,body.okuma_grubu_id));
      if(Number(g?.maksimum_register??125)<body.register_sayisi)throw new Error('Okuma grubu blok sınırı bu register için küçük.');
    }
    shadow[entry.entity].push({id:entry.id,...body});bodies.push({...entry,body});
  }
  return bodies;
}

export async function executeSetup(api,bodies,onProgress=()=>{}) {
  const ids=new Map(),created=[];
  for(const entry of bodies){
    const body={...entry.body};
    for(const key of ['okuma_grubu_id','register_id'])if(Number(body[key])<0){
      if(!ids.has(body[key]))throw new Error('Kurulum referansı çözülemedi.');body[key]=ids.get(body[key]);
    }
    try{
      const result=await api.create(ENTITIES[entry.entity].path,body),raw=typeof result==='number'?result:result?.id;
      if(!Number.isSafeInteger(Number(raw))||Number(raw)<=0)throw new Error('API oluşturulan kaydın ID’sini döndürmedi. Kayıt listesini kontrol et.');
      ids.set(entry.id,Number(raw));created.push({entity:entry.entity,id:Number(raw),label:entry.label});onProgress([...created]);
    }catch(error){error.created=[...created];throw error;}
  }
  return created;
}
