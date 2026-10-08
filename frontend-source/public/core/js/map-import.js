import {operationFor,formPayload,validateConfiguration,rowValue} from './configuration.js';
const sizes={BOOL:1,ENUM:1,FLOAT16:1,INT16:1,UINT16:1,INT32:2,UINT32:2,FLOAT32:2,FLOAT64:4};
const mapFields=['register_adresi','function_code','register_sayisi','veri_tipi','byte_order','word_order','olcek','offset_degeri','bit_index'];
const policyFields=['cihaz_tipi','alarm_sinifi','arsiv_kurali','okuma_sinifi','deadband','periyot_saniye','gosterim_formati','aktif'];
export function parseMapJson(text){
  if(text.length>2*1024*1024)throw new Error('JSON en fazla 2 MB olabilir.');
  let input;try{input=JSON.parse(text);}catch{throw new Error('JSON geçersiz. Çift tırnakları ve son virgülleri kontrol et.');}
  const rows=Array.isArray(input)?input:input?.registers;
  if(!Array.isArray(rows)||!rows.length||rows.length>1000)throw new Error('registers dizisi 1–1000 satır içermeli.');
  const defaults=Array.isArray(input)?{}:input.defaults??{};
  if(!defaults||typeof defaults!=='object'||Array.isArray(defaults))throw new Error('defaults bir JSON nesnesi olmalı.');
  return rows.map((r,i)=>{
    if(!r||typeof r!=='object'||Array.isArray(r))throw new Error('Satır '+(i+1)+': JSON nesnesi bekleniyor.');
    const v={...defaults,...r};
    for(const k of ['profile_id','profil_id','sinyal_sozlugu_id','id'])if(k in v)throw new Error('Satır '+(i+1)+': '+k+' kullanma. Profil ekrandan, sinyal ID’si sözlükten eşleştirilir.');
    if(typeof v.sinyal_adi!=='string'||!v.sinyal_adi.trim())throw new Error('Satır '+(i+1)+': sinyal_adi gerekli.');
    v.sinyal_adi=v.sinyal_adi.trim();
    return v;
  });
}
function same(a,b,keys){return keys.every(k=>String(rowValue(a,k)??'')===String(rowValue(b,k)??''));}
export function buildImportPlan(ctx,profileId,text,policy={}){
  if(!ctx.config.profiles.some(p=>String(p.id)===String(profileId)))throw new Error('Geçerli cihaz profili seç.');
  const rows=parseMapJson(text),config=structuredClone(ctx.config),signalOp=operationFor(ctx.schema,ctx.api.base,'signals'),mapOp=operationFor(ctx.schema,ctx.api.base,'profileRegisters');
  const entries=[],occupied=[],errors=[];
  for(const r of config.profileRegisters.filter(r=>String(r.profil_id??r.profile_id)===String(profileId)))occupied.push({start:Number(r.register_adresi),end:Number(r.register_adresi)+Number(r.register_sayisi)-1,fc:Number(r.function_code),row:r});
  rows.forEach((r,index)=>{try{
    const matches=config.signals.filter(s=>s.sinyal_adi===r.sinyal_adi);if(matches.length>1)throw new Error('Sözlükte aynı adlı birden fazla sinyal var; önce kayıtları düzelt.');
    let signal=matches[0],signalBody=null;
    if(!signal){
      const operational=Object.fromEntries(policyFields.filter(k=>policy[k]!==undefined).map(k=>[k,policy[k]]));
      const values={...operational,...r,aciklama:r.aciklama??r.sinyal_adi,aktif:r.aktif??true,deadband:r.deadband??policy.deadband??0,periyot_saniye:r.periyot_saniye??policy.periyot_saniye??1,gosterim_formati:r.gosterim_formati??policy.gosterim_formati??(r.veri_tipi?.startsWith('FLOAT')?'0.00':'0')};
      signalBody=formPayload(ctx.schema,signalOp.schema,values);
      if(signalBody.min_deger>signalBody.max_deger)throw new Error('Minimum değer maksimumdan büyük olamaz.');
      if(signalBody.periyot_saniye<1||signalBody.deadband<0)throw new Error('Periyot en az 1 saniye ve deadband negatif olmayan sayı olmalı.');
      validateEnums(ctx,'sinyal_sozlugu',signalBody);
      signal={...signalBody,id:-(index+1)};config.signals.push(signal);
    }else{
      for(const k of ['veri_tipi','birim','min_deger','max_deger'])if(r[k]!==undefined&&String(r[k])!==String(signal[k]))throw new Error('Mevcut sözlük sinyalinin '+k+' değeri farklı. Ayrı sinyal adı kullan veya önce sözlüğü düzenle.');
    }
    const values={...r,profile_id:Number(profileId),profil_id:Number(profileId),sinyal_sozlugu_id:signal.id,
      veri_tipi:r.veri_tipi??signal.veri_tipi,register_sayisi:r.register_sayisi??sizes[r.veri_tipi??signal.veri_tipi],
      function_code:r.function_code??3,byte_order:r.byte_order??'BIG',word_order:r.word_order??'ABCD',
      olcek:r.olcek??1,offset_degeri:r.offset_degeri??0,bit_index:r.bit_index??0};
    const body=validateConfiguration('profileRegisters',formPayload(ctx.schema,mapOp.schema,values),config);
    validateEnums(ctx,'profil_register',body);
    if(body.offset_degeri!==0||body.bit_index!==0)throw new Error('Mevcut collector offset/bit seçimini uygulamıyor; 0 kullan.');
    const start=body.register_adresi,end=start+body.register_sayisi-1;
    const conflicts=occupied.filter(o=>o.fc===body.function_code&&start<=o.end&&end>=o.start);
    const exact=conflicts.find(o=>same(o.row,body,[...mapFields,'sinyal_sozlugu_id']));
    if(conflicts.length&&!exact)throw new Error('Adres aralığı bu profil/FC içindeki başka bir register ile çakışıyor.');
    entries.push({index:index+1,name:r.sinyal_adi,signalId:signal.id,signalBody,mapBody:body,skip:!!exact,status:exact?'Zaten kayıtlı':'Hazır'});
    if(!exact){const row={...body};occupied.push({start,end,fc:body.function_code,row});config.profileRegisters.push(row);}
  }catch(error){errors.push('Satır '+(index+1)+' ('+r.sinyal_adi+'): '+error.message);}});
  if(errors.length)throw new Error(errors.join('\n'));
  return {profileId:Number(profileId),entries,signalOp,mapOp};
}
function validateEnums(ctx,table,body){
  for(const [k,v] of Object.entries(body)){const options=ctx.dbOptions?.tables?.[table]?.[k];if(options&&!options.includes(v))throw new Error(k+': izin verilen değerler: '+options.join(', '));}
}
export async function executeImportPlan(plan,api,onProgress=()=>{}){
  const ids=new Map(),stats={signals:0,maps:0,skipped:0};
  for(const entry of plan.entries){
    try{
      if(entry.skip){stats.skipped++;onProgress(entry,stats);continue;}
      let signalId=entry.signalId;
      if(signalId<0){
        if(ids.has(signalId))signalId=ids.get(signalId);
        else{
          const result=await api.create(plan.signalOp.collection,entry.signalBody);
          const id=typeof result==='number'?result:result?.id;
          if(!Number.isInteger(Number(id))||Number(id)<=0)throw new Error('Sinyal kaydı yanıtında ID yok. Listeyi yenileyip tekrar önizle.');
          signalId=Number(id);ids.set(entry.signalId,signalId);stats.signals++;
        }
      }
      await api.create(plan.mapOp.collection,{...entry.mapBody,sinyal_sozlugu_id:signalId});
      entry.status='Kaydedildi';stats.maps++;onProgress(entry,stats);
    }catch(error){entry.status='Durduruldu';onProgress(entry,stats);throw new Error('Satır '+entry.index+' ('+entry.name+'): '+error.message+'\n'+stats.signals+' sinyal ve '+stats.maps+' harita kaydı tamamlandı. Önce listeleri yenile, tekrar önizle; tamamlanan kayıtlar atlanır.');}
  }
  return stats;
}

