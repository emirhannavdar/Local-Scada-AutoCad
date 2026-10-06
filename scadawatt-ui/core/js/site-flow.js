export const FLOW_LABELS={topology:'Bağlantı yapısı',dm:'Köşk / DM',tm:'TM / Hücre',trafo:'Trafo',adp:'Dağıtım panosu',profile:'Cihaz profili',device:'Cihaz bağlantısı',map:'Register haritası',setup:'Okuma zinciri',verify:'Canlı ölçüm kontrolü'};
const next={dm:'tm',tm:'trafo',trafo:'adp',adp:'profile',profiles:'device',devices:'map'};
export function startSiteFlow(siteId,base){
  if(!Number.isInteger(Number(siteId))||Number(siteId)<=0)throw new Error('Saha ID’si doğrulanamadı. Listeyi yenileyip kaydı kontrol et.');
  return {version:1,base,siteId:Number(siteId),step:'topology',ids:{},parentType:'SAHA',parentId:Number(siteId)};
}
export function advanceSiteFlow(state,entity,id){
  if(!state)return null;
  if(!Number.isInteger(Number(id))||Number(id)<=0)throw new Error('Yeni kaydın ID’si doğrulanamadı; sonraki adım açılmadı.');
  const expected={profile:'profiles',device:'devices'}[state.step]??state.step;
  if(entity!==expected||!next[entity])throw new Error('Kaydedilen kayıt mevcut kurulum adımıyla eşleşmiyor.');
  const result={...state,ids:{...state.ids,[entity]:Number(id)},step:next[entity]};
  if(['dm','tm','trafo','adp'].includes(entity)){result.parentType=entity.toUpperCase();result.parentId=Number(id);}
  return result;
}
export function flowPresets(state){
  const token=state.siteId+':'+state.step;
  const presets={_wizard_token:token};
  if(state.step==='dm')presets.saha_id=state.siteId;
  if(state.step==='tm')presets.dm_id=state.ids.dm;
  if(state.step==='trafo')presets.tm_id=state.ids.tm;
  if(state.step==='adp')presets.trafo_id=state.ids.trafo;
  if(state.step==='device'){presets.ust_dugum_tipi=state.parentType;presets.ust_dugum_id=state.parentId;presets.profil_id=state.ids.profiles;presets.aktif=true;presets.bakim_modu=false;presets.protokol='MODBUS_TCP';presets.slave_id=1;}
  return presets;
}

