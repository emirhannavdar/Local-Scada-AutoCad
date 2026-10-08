export type CollectorDraft={url:string;worker:string;ids:string[];commands:boolean;gpio:boolean;inputs:boolean;inputPins:string;pins:string;timeout:number;refresh:number;gap:number;autoTag:boolean;summary:number};
export const DRAFT_KEY='scadawatt.collector-draft.v1';
export function defaults(base:string):CollectorDraft{return {url:base,worker:'master-01',ids:[],commands:false,gpio:false,inputs:false,inputPins:'0,5,6,7,1,12,13,16,26,24',pins:'4',timeout:10,refresh:5,gap:0,autoTag:false,summary:30};}
export function parsePins(text:string,min=0):number[]{
 const parts=text.split(',').map(x=>x.trim());
 if(parts.some(x=>!/^\d+$/.test(x)||Number(x)<min||Number(x)>27))throw Error(`BCM pinleri ${min}–27 arasında tam sayı olmalı; boş öğe kullanma.`);
 const pins=parts.map(Number);if(new Set(pins).size!==pins.length)throw Error('Aynı BCM pini birden fazla yazılmış.');
 return pins.sort((a,b)=>a-b);
}
export function validateDraft(d:CollectorDraft){
 let u:URL;try{u=new URL(d.url);}catch{throw Error('Geçerli bir API adresi gir.');}
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash||!u.pathname.replace(/\/+$/,'').endsWith('/api/v1'))throw Error('API adresi http(s) olmalı ve /api/v1 ile bitmeli.');
 if(!/^\S{1,100}$/.test(d.worker.trim()))throw Error('Master adı 1–100 karakter olmalı ve boşluk içermemeli.');
 if(!Number.isFinite(d.timeout)||d.timeout<1||d.timeout>3600||!Number.isFinite(d.refresh)||d.refresh<1||d.refresh>3600||!Number.isInteger(d.gap)||d.gap<0||d.gap>124)throw Error('Süreler 1–3600 sn; adres boşluğu 0–124 tam sayı olmalı.');
 if(!Number.isFinite(d.summary)||d.summary<=0||d.summary>3600)throw Error('Log özeti süresi 0–3600 sn arasında olmalı.');
 if(d.ids.some(x=>!/^\d+$/.test(x)||Number(x)<1)||new Set(d.ids).size!==d.ids.length)throw Error('Cihaz ID listesi benzersiz pozitif sayılar olmalı.');
 if(d.gpio&&!d.commands)throw Error('Röle çıkışı için komut yürütücüsünü etkinleştir.');
 const outputs=d.gpio?parsePins(d.pins,2):[],inputs=d.inputs?parsePins(d.inputPins):[];
 const overlap=inputs.filter(p=>outputs.includes(p));if(overlap.length)throw Error(`Giriş / çıkış çakışması: BCM ${overlap.join(', ')}. Aynı pin iki görevde kullanılamaz.`);
 return {outputs,inputs};
}
export function configFromDraft(d:CollectorDraft,token:string){const {outputs,inputs}=validateDraft(d);return {SCADA_API_URL:d.url.trim().replace(/\/+$/,''),SCADA_API_TOKEN:token,SCADA_WORKER_ID:d.worker.trim(),SCADA_DEVICE_IDS:d.ids.join(','),SCADA_COMMAND_WORKER:d.commands?'1':'0',SCADA_API_TIMEOUT:String(d.timeout),SCADA_CONFIG_REFRESH:String(d.refresh),SCADA_MAX_GAP:String(d.gap),SCADA_AUTO_TAG:d.autoTag?'1':'0',SCADA_SUMMARY_SECONDS:String(d.summary),SCADA_ENABLE_GPIO_INPUTS:d.inputs?'1':'0',SCADA_GPIO_INPUT_PINS:inputs.join(','),SCADA_ENABLE_GPIO:d.gpio?'1':'0',SCADA_GPIO_PINS:outputs.join(',')};}
export function importDraft(value:unknown,base:string):CollectorDraft{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('collector.json bir JSON nesnesi olmalı.');
 const v=value as Record<string,unknown>;const allowed=Object.keys(configFromDraft(defaults(base),''));if(Object.keys(v).some(k=>!allowed.includes(k)))throw Error('Dosyada bu sürümün desteklemediği ayar var; dosya değiştirilmedi.');const d=defaults(base);
 const string=(key:string,fallback:string)=>key in v?String(v[key]):fallback;
 const flag=(key:string,fallback:boolean)=>{if(!(key in v))return fallback;if(!['0','1'].includes(String(v[key])))throw Error(`${key} 0 veya 1 olmalı.`);return String(v[key])==='1';};
 const result={url:string('SCADA_API_URL',d.url),worker:string('SCADA_WORKER_ID',d.worker),ids:string('SCADA_DEVICE_IDS','').split(',').map(x=>x.trim()).filter(Boolean),commands:flag('SCADA_COMMAND_WORKER',false),gpio:flag('SCADA_ENABLE_GPIO',false),inputs:flag('SCADA_ENABLE_GPIO_INPUTS',false),inputPins:string('SCADA_GPIO_INPUT_PINS',d.inputPins),pins:string('SCADA_GPIO_PINS',d.pins),timeout:Number(string('SCADA_API_TIMEOUT','10')),refresh:Number(string('SCADA_CONFIG_REFRESH','5')),gap:Number(string('SCADA_MAX_GAP','0')),autoTag:flag('SCADA_AUTO_TAG',false),summary:Number(string('SCADA_SUMMARY_SECONDS','30'))};
 validateDraft(result);return result;
}
export function loadDraft(base:string):CollectorDraft{try{const raw=JSON.parse(localStorage.getItem(DRAFT_KEY)||'null');if(!raw||raw.version!==1||raw.base!==base)return defaults(base);const d=importDraft(raw.config,base);return d;}catch{return defaults(base);}}
export function saveDraft(base:string,d:CollectorDraft){const {SCADA_API_TOKEN,...config}=configFromDraft(d,'');localStorage.setItem(DRAFT_KEY,JSON.stringify({version:1,base,config}));}
