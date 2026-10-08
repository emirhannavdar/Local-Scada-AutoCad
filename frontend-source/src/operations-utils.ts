export type Point={timestamp:string;value:number|null;quality:string};
export function segments(rows:Point[],bucketSeconds:number){
 const result:Point[][]=[];let current:Point[]=[];
 for(const row of rows){const t=Date.parse(row.timestamp),prev=current.at(-1);if(row.value===null||!Number.isFinite(row.value)||!Number.isFinite(t)||row.quality!=='GOOD'){if(current.length)result.push(current);current=[];continue;}
 if(prev&&t-Date.parse(prev.timestamp)>bucketSeconds*2500){result.push(current);current=[];}
 current.push(row);
 }
 if(current.length)result.push(current);return result;
}
export function changedFields(before:Record<string,unknown>|null,after:Record<string,unknown>|null){return [...new Set([...Object.keys(before||{}),...Object.keys(after||{})])].filter(k=>JSON.stringify(before?.[k])!==JSON.stringify(after?.[k])).sort();}
export function localInput(value:Date){return new Date(value.getTime()-value.getTimezoneOffset()*60000).toISOString().slice(0,16);}
export function toISO(value:string){const t=new Date(value);if(!Number.isFinite(t.getTime()))throw Error('Geçerli tarih ve saat seçin.');return t.toISOString();}
