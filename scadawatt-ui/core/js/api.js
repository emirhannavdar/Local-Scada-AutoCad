export class ApiError extends Error {
  constructor(message,status=0,path=''){super(message);this.status=status;this.path=path;}
}
export function errorMessage(result,fallback='API işlemi başarısız.') {
  const detail=result?.detail;
  if(Array.isArray(detail))return detail.map(e=>`${(e.loc||[]).filter(x=>x!=='body').join('.')}: ${e.msg||'Geçersiz değer'}`).join(' · ');
  if(typeof detail==='string')return detail;
  return detail?.message||detail?.error||result?.message||result?.error||fallback;
}
export function unwrapResult(result,path) {
  if(result?.success===false)throw new ApiError(errorMessage(result),Number(result.errorCode)||0,path);
  if(result?.success===true&&!Object.hasOwn(result,'data'))throw new ApiError('Başarılı yanıtın data alanı eksik; kaydı liste üzerinden doğrula.',0,path);
  return result&&Object.hasOwn(result,'data')?result.data:result;
}
export function unwrapList(result,path) {
  if(result?.success===false && Number(result.errorCode)===404 && result.data==null)return [];
  const data=unwrapResult(result,path);
  if(!Array.isArray(data))throw new ApiError('API data alanında liste bekleniyor.',0,path);
  return data;
}
export class ScadaApi {
  constructor(settings,onRequest=()=>{}) {
    const base=String(settings.baseUrl).replace(/\/+$/,'');
    const parsed=new URL(base);
    if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.search||parsed.hash)throw new Error('API adresi geçerli bir HTTP adresi olmalı; kullanıcı bilgisi veya sorgu içermemeli.');
    this.base=base;this.token=settings.token||'';this.onRequest=onRequest;this.controllers=new Set();
  }
  close(){for(const c of this.controllers)c.abort();this.controllers.clear();}
  async request(path,{method='GET',body,list=false,url}={}) {
    const controller=new AbortController();this.controllers.add(controller);const timer=setTimeout(()=>controller.abort(),12000),started=performance.now();let status=0;
    try {
      const headers={Accept:'application/json'};if(this.token)headers.Authorization=`Bearer ${this.token}`;
      if(body!==undefined)headers['Content-Type']='application/json';
      const response=await fetch(url||`${this.base}/${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal,cache:'no-store'});status=response.status;
      let result;try{result=response.status===204?null:await response.json();}catch{throw new ApiError(`HTTP ${status} · JSON yerine başka bir yanıt alındı.`,status,path);}
      if(!response.ok)throw new ApiError(errorMessage(result,`HTTP ${status} · ${path}`),status,path);
      const data=list?unwrapList(result,path):unwrapResult(result,path);
      this.onRequest({method,path,status,ok:true,count:Array.isArray(data)?data.length:undefined,message:method==='GET'?'Şema alındı':'Kaydedildi',ms:Math.round(performance.now()-started),time:new Date().toISOString()});return data;
    } catch(error) {
      const message=error.name==='AbortError'?`/${path} isteği zaman aşımına uğradı / iptal edildi. ${method==='GET'?'API endpoint’inin DB yanıtını kontrol et.':'Kayıt oluşmuş olabilir; yeniden göndermeden önce listeyi yenile.'}`:error instanceof TypeError?'API’ye ulaşılamadı. Backend, adres ve CORS ayarını kontrol et.':error.message;
      this.onRequest({method,path,status,ok:false,message,ms:Math.round(performance.now()-started),time:new Date().toISOString()});throw new ApiError(message,status||error.status||0,path);
    } finally{clearTimeout(timer);this.controllers.delete(controller);}
  }
  list(path){return this.request(path,{list:true});}
  create(path,body){return this.request(path,{method:'POST',body});}
  update(path,id,body,method='PUT'){return this.request(`${path?path+'/':''}${encodeURIComponent(id)}`,{method,body});}
  schema(){const url=new URL(this.base);url.pathname=url.pathname.replace(/\/api\/v1$/,'')+'/openapi.json';return this.request('openapi.json',{url:url.href});}
}
