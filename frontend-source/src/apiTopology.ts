import type {Shape} from './workspace';
export function connectionPatch(source:Shape,target:Shape){
 if(!source.binding||!target.binding)throw Error('Önce her iki öğenin API kaydını oluştur veya eşleştir.');
 const [a,aId]=source.binding.split(':'),[b,bId]=target.binding.split(':');
 const mapping:Record<string,[string,string]>={'DM:TM':['tm','dm_id'],'TM:TRAFO':['trafo','tm_id'],'TRAFO:ADP':['adp','trafo_id']};
 if(b==='DEVICE'&&['DM','TM','TRAFO','ADP'].includes(a))return {path:`device/${bId}`,body:{ust_dugum_tipi:a,ust_dugum_id:Number(aId)}};
 const m=mapping[`${a}:${b}`];if(!m)throw Error('Bu API hiyerarşisi bağlantıyı desteklemiyor. Sıra: köşk (DM) → TM → trafo → AG pano (ADP) → cihaz. Trafo çıkışına DM yerine AG pano ekle.');
 return {path:`${m[0]}/${bId}`,body:{[m[1]]:Number(aId)}};
}
