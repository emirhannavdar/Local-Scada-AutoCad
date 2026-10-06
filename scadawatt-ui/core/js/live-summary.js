import {sampleState} from './model.js';
const aliases={power:['grid_active_power','p_tot','p_total','power_total','total_active_power','active_power','p_aktif','power'],frequency:['grid_frequency','freq','frequency','frekans'],voltage:['v_l1n','voltage_l1','grid_voltage_avg','voltage_avg','voltage','gerilim'],current:['i_l1','current_l1','grid_current_avg','current_avg','current','akim']};
const units={power:['w','kw','mw'],frequency:['hz'],voltage:['v','kv'],current:['a','ma','ka']};
const normalize=s=>String(s??'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/ı/g,'i').replace(/[^a-z0-9]+/g,'_');
const excluded=/(^|_)(min|max|minimum|maximum|peak|tepe|thd|demand|energy|enerji|dc|pv|neutral|notr|unbalance|dengesizlik|reactive|reaktif|apparent|gorunur)(_|$)/;
export function referenceSummary(samples,config,settings,now=Date.now(),online=true){
  return Object.fromEntries(Object.keys(aliases).map(key=>{
    const candidates=samples.filter(s=>!excluded.test(normalize(s.signal_name))&&(aliases[key].includes(normalize(s.signal_name))||units[key].includes(String(s.unit??'').trim().toLowerCase())));
    const score=s=>{const name=normalize(s.signal_name),rank=aliases[key].indexOf(name);return (sampleState(s,config,settings,now,online)==='online'?1000:0)+(typeof s.value==='number'&&Number.isFinite(s.value)?100:0)+(rank>=0?80-rank:0)+(/(^|_)(total|tot|toplam|avg|average)(_|$)/.test(name)?10:0);};
    const sample=candidates.sort((a,b)=>score(b)-score(a))[0],name=normalize(sample?.signal_name);
    let label={power:'Aktif güç',frequency:'Frekans',voltage:'Gerilim',current:'Akım'}[key];
    if(['voltage','current'].includes(key)&&sample){if(/(^|_)(avg|average|ortalama)(_|$)/.test(name))label+=' ort.';else if(/(^|_)l1n?(_|$)/.test(name))label+=' L1';else if(/(^|_)l2n?(_|$)/.test(name))label+=' L2';else if(/(^|_)l3n?(_|$)/.test(name))label+=' L3';}
    return [key,{sample,label,current:!!sample&&sampleState(sample,config,settings,now,online)==='online'}];
  }));
}
