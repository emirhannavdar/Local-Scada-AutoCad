import {useEffect,useState} from 'react';
import type {Row} from './workspace';
export default function ControlPanel({nodeKey,name,devices,rpc,onSaved,readOnly=false}:{readOnly?:boolean,nodeKey:string,name:string,devices:Row[],rpc:(path:string,method?:string,body?:Row)=>Promise<any>,onSaved:()=>void}){
 const defaults=(component='main'):Row=>({node_key:nodeKey,component,name,device_id:(nodeKey.startsWith('DEVICE:')?Number(nodeKey.split(':')[1]):devices[0]?.id)||0,kind:'MODBUS',iec_ca:1,iec_command_ioa:3001,iec_command_type:46,iec_feedback_ioa:2001,iec_feedback_type:3,iec_command_mode:'DIRECT',iec_cot:6,gpio_pin:4,gpio_worker:'master-01',gpio_active_high:true,write_fc:6,write_address:0,open_value:0,close_value:1,feedback_signal:'grid_breaker',feedback_fc:3,feedback_address:0,feedback_open:0,feedback_closed:1,verify_seconds:5,enabled:false});
 const [v,setV]=useState<Row>(defaults()),[msg,setMsg]=useState(''),[busy,setBusy]=useState(false);
 const load=async(component:string)=>{try{const rows=await rpc('control/controls'),row=rows.find((r:Row)=>r.node_key===nodeKey&&r.component===component);setV(row?{...defaults(component),...row}:defaults(component));}catch(e){setMsg((e as Error).message);}};
 useEffect(()=>{void load('main');},[nodeKey]);
 const gpio=v.kind==='GPIO',iec=v.kind==='IEC104';
 async function save(){setBusy(true);try{
  const keys=['node_key','component','name','device_id','kind','gpio_pin','gpio_worker','gpio_active_high','write_fc','write_address','open_value','close_value','feedback_signal','feedback_fc','feedback_address','feedback_open','feedback_closed','verify_seconds','enabled','iec_ca','iec_command_ioa','iec_command_type','iec_feedback_ioa','iec_feedback_type','iec_command_mode','iec_cot'];
  const body=Object.fromEntries(keys.map(k=>[k,v[k]]));
  if(gpio){if(!v.gpio_worker?.trim())throw Error('Collector bilgileri ekranındaki master adını gir.');if(!Number.isInteger(v.gpio_pin)||v.gpio_pin<2||v.gpio_pin>27)throw Error('BCM GPIO numarası 2–27 olmalı.');}
  await rpc('control/controls','POST',body);setMsg('Kontrol eşleştirmesi kaydedildi. ' + (gpio ? `Master ${v.gpio_worker} · BCM ${v.gpio_pin}` : iec?'IEC104':'Modbus'));onSaved();
 }catch(e){setMsg((e as Error).message);}finally{setBusy(false);}}
 return <details className="control-config"><summary>Röle / kesici kontrolü</summary><fieldset className="permission-fields" disabled={readOnly}>
 <label className="field"><span>Kontrol türü</span><select aria-label="Kontrol türü" value={v.kind||'MODBUS'} onChange={e=>setV({...v,kind:e.target.value,...(e.target.value==='IEC104'?{open_value:1,close_value:2,feedback_open:1,feedback_closed:2,iec_ca:v.iec_ca??1,iec_command_ioa:v.iec_command_ioa??3001,iec_command_type:v.iec_command_type??46,iec_feedback_ioa:v.iec_feedback_ioa??2001,iec_feedback_type:v.iec_feedback_type??3,iec_command_mode:v.iec_command_mode??'DIRECT',iec_cot:v.iec_cot??6}:{}),enabled:false,gpio_pin:v.gpio_pin??4,gpio_worker:v.gpio_worker||'master-01'})}><option value="MODBUS">Modbus coil / register</option><option value="GPIO">Master GPIO röle çıkışı</option><option value="IEC104">IEC104 · fiziksel geri bildirim</option></select></label>
 <label className="field"><span>Kontrol bileşeni</span><select value={v.component} onChange={e=>void load(e.target.value)}>{['main','L1','L2','L3'].map(x=><option key={x}>{x}</option>)}</select></label>
 <label className="field"><span>{gpio?'Saha yetkisi ve collector kapsamı için cihaz':'Kontrol cihazı / PLC'}</span><select value={v.device_id} onChange={e=>setV({...v,device_id:Number(e.target.value)})}>{devices.map(d=><option key={d.id} value={d.id}>{d.name} · {d.id}</option>)}</select></label>
 {gpio?<>
 <p className="form-help">GPIO master üzerinde çalışır; ENTES’e Modbus yazma komutu gönderilmez. Çıkış sürekli tutulur. Fiziksel kesici geri bildirimi yoktur.</p>
 <label className="field"><span>Master adı · collector ile birebir aynı</span><input aria-label="GPIO master adı" value={v.gpio_worker||''} onChange={e=>setV({...v,gpio_worker:e.target.value})}/></label>
 <label className="field"><span>BCM GPIO numarası</span><input aria-label="BCM GPIO numarası" type="number" min="2" max="27" value={v.gpio_pin??4} onChange={e=>setV({...v,gpio_pin:Number(e.target.value)})}/></label>
 <label className="field"><span>Rölenin aktif seviyesi</span><select value={String(v.gpio_active_high)} onChange={e=>setV({...v,gpio_active_high:e.target.value==='true'})}><option value="true">HIGH / 1</option><option value="false">LOW / 0</option></select></label>
 <p className="form-help">Collector bilgileri → GPIO desteğini aç ve bu pini izin listesine ekle. HIGH/LOW röle çıkışıdır; enerji veya kesici kontağının durumu doğrulanmaz. Collector durdurulurken çıkış pasif yapılır; API bağlantısı kesilirse son çıkış seviyesi tutulur.</p>
 </>:iec?<>
 <p className="form-help">Önce IEC104 bağlantıları ekranında cihaz ve geri bildirim tagini eşleştirin. Komut onayı durum değişikliği değildir; komut sonrası doğru IOA/Type ID ve GOOD kaliteyi bekleriz. COT komut için ACTIVATION=6 olmalı.</p>
 <label className="field"><span>Geri bildirim taginin sinyal_adi</span><input value={v.feedback_signal} onChange={e=>setV({...v,feedback_signal:e.target.value})}/></label>
 {([['iec_ca','CA'],['iec_command_ioa','Komut IOA'],['iec_command_type','Komut Type ID · 45/46'],['iec_feedback_ioa','Geri bildirim IOA'],['iec_feedback_type','Geri bildirim Type ID · 1/3/30/31'],['iec_cot','Komut COT · 6'],['open_value','Aç komut değeri · tekli 0 / çiftli 1'],['close_value','Kapat komut değeri · tekli 1 / çiftli 2'],['feedback_open','Açık geri bildirim değeri'],['feedback_closed','Kapalı geri bildirim değeri'],['verify_seconds','Doğrulama süresi · 1–30 sn']]).map(([k,label])=><label className="field" key={k}><span>{label}</span><input type="number" value={v[k]} onChange={e=>setV({...v,[k]:Number(e.target.value)})}/></label>)}
 <label className="field"><span>Komut yöntemi</span><select value={v.iec_command_mode} onChange={e=>setV({...v,iec_command_mode:e.target.value})}><option value="DIRECT">Doğrudan</option><option value="SELECT_AND_EXECUTE">Önce seç / sonra çalıştır</option></select></label>
 </>:<>
 <p className="form-help">Komut bir kontrol cihazına yazılır. Adresler Modbus PDU adresidir. Canlı modda eşleştirme yoksa komut gönderilmez.</p>
 <button className="outline-button" onClick={()=>setV({...v,component:'main',write_fc:6,write_address:48000,open_value:0,close_value:1,feedback_signal:'grid_breaker',feedback_fc:3,feedback_address:48000,feedback_open:0,feedback_closed:1})}>İkinci simülatör haritasını doldur</button>
 <label className="field"><span>Kesici durum sinyali · ham 0/1 değeri</span><input value={v.feedback_signal||'grid_breaker'} onChange={e=>setV({...v,feedback_signal:e.target.value})}/></label>
 {([['write_fc','Yazma FC · 5 veya 6'],['write_address','Komut PDU adresi'],['open_value','Aç komut değeri'],['close_value','Kapat komut değeri'],['feedback_fc','Durum FC · 1/2/3/4'],['feedback_address','Durum PDU adresi'],['feedback_open','Açık durum değeri'],['feedback_closed','Kapalı durum değeri'],['verify_seconds','Doğrulama süresi · 1–30 sn']]).map(([k,l])=><label className="field" key={k}><span>{l}</span><input type="number" value={v[k]} onChange={e=>setV({...v,[k]:Number(e.target.value)})}/></label>)}
 </>}
 <label className="field"><span><input type="checkbox" checked={v.enabled} onChange={e=>setV({...v,enabled:e.target.checked})}/> Gerçek komutu etkinleştir</span></label>
 <button disabled={busy} className="outline-button" onClick={()=>void save()}>Kontrol eşleştirmesini kaydet</button><p role="status">{msg}</p>
 </fieldset></details>;
}
