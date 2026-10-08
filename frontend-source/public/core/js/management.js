import {nameOf,escapeHtml as esc,TYPES} from './model.js';
import {ENTITIES,FIELD_LABELS,FIELD_HINTS,FOREIGN_FIELDS,operationFor,fieldSchema,rowValue,formPayload,validateConfiguration,choicesFor,devicePipeline} from './configuration.js';
import {createSetupPlan,validateSetupPlan,executeSetup,setupFingerprint} from './profile-setup.js';
import {friendlyError,formSection,fieldExplanation} from './user-help.js';
const $=id=>document.getElementById(id),eq=(a,b)=>String(a)===String(b);
const SELECTS={function_code:[[3,'FC03 · Holding registers'],[4,'FC04 · Input registers']],veri_tipi:['FLOAT32','FLOAT64','FLOAT16','INT16','UINT16','INT32','UINT32','BOOL','ENUM','STRING'],word_order:['ABCD','CDAB','BADC','DCBA'],byte_order:['BIG','LITTLE'],protokol:['MODBUS_TCP','MODBUS_RTU'],protocol:['MODBUS_TCP','MODBUS_RTU']};
const recordName=r=>r.tag_adi??r.sinyal_adi??r.sinyal_kodu??r.kod??r.name??r.ad??(r.register_adresi!=null?`PDU ${r.register_adresi}`:`#${r.id}`);

export class Management {
  constructor(getContext,onSaved,toast) {
    this.getContext=getContext;this.onSaved=onSaved;this.toast=toast;this.entity='devices';this.saving=false;this.scope='';
    $('manage-entity').innerHTML=Object.entries(ENTITIES).map(([key,e])=>`<option value="${key}">${e.title}</option>`).join('');$('manage-entity').value=this.entity;
    $('manage-entity').onchange=e=>{this.entity=e.target.value;this.render();};
    $('manage-scope').onchange=e=>{this.scope=e.target.value;this.render();};
    $('manage-add').onclick=()=>this.open(this.entity);
    $('manage-rows').addEventListener('click',e=>{const b=e.target.closest('[data-config-delete]');if(b)this.remove(b.dataset.configDelete,b.dataset.recordId);});
    $('config-form').onsubmit=e=>{e.preventDefault();this.save();};
    $('config-fields').addEventListener('change',e=>this.changed(e.target.name));
    $('config-fields').addEventListener('input',()=>this.previewScaling());
    $('config-example').addEventListener('input',()=>this.previewScaling());
    $('config-dialog').addEventListener('cancel',e=>{if(this.saving)e.preventDefault();});
    $('profile-setup').onclick=()=>this.openSetup();
    $('setup-form').onsubmit=e=>{e.preventDefault();this.saveSetup();};
    $('setup-fields').addEventListener('input',e=>{if(e.target.dataset)e.target.dataset.commonFilled='';this.previewSetup();});
    $('setup-fields').addEventListener('change',()=>this.previewSetup());
    $('setup-dialog').addEventListener('cancel',e=>{if(this.saving)e.preventDefault();});
    $('setup-common').addEventListener('input',()=>this.fillSetupCommon());
    $('setup-common').addEventListener('change',()=>this.fillSetupCommon());
  }
  render() {
    const ctx=this.getContext(),{config,topology,measurements,selectedDevice,demo,loaded}=ctx;
    const scopeOptions='<option value="">Tüm cihazlar</option>'+(config.devices||[]).map(d=>`<option value="${esc(d.id)}">${esc(nameOf(d))} · #${esc(d.id)}</option>`).join('');
    if($('manage-scope').innerHTML!==scopeOptions){$('manage-scope').innerHTML=scopeOptions;if(!config.devices.some(d=>eq(d.id,this.scope)))this.scope='';$('manage-scope').value=this.scope;}
    $('manage-scope').closest('label').classList.toggle('hidden',!['groups','registers','tags'].includes(this.entity));
    $('manage-add').textContent=`+ ${ENTITIES[this.entity].singular} ekle`;$('manage-add').disabled=demo||!ctx.api;
    $('management-note').textContent=demo?'Örnek görünüm: düzenlemeler için Canlı API’ye dön.':'Kaydet düğmesi değişiklikleri REST API üzerinden veritabanına yazar. IP ve port cihaza aittir; saha bağlantısı üst düğümle kurulur.';
    $('manage-count').textContent=(config[this.entity]||[]).length+' kayıt';
    const rows=(config[this.entity]||[]).filter(r=>!this.scope||!['groups','registers','tags'].includes(this.entity)||eq(r.cihaz_id??r.device_id,this.scope));
    const summary=r=>{
      if(this.entity==='devices'){
        const site=config.sites.find(s=>eq(s.id,topology.siteOf.get(`DEVICE:${r.id}`))),parent=topology.nodes.get(`${String(r.ust_dugum_tipi).toUpperCase()}:${r.ust_dugum_id}`),p=devicePipeline(r,config,measurements,loaded);
        return `<span>${esc(site?nameOf(site):'Sahayla eşleşmiyor')} → ${esc(parent?.name??r.ust_dugum_tipi+' #'+r.ust_dugum_id)}</span><small class="mono">${esc(r.protokol)} · ${esc(r.ip??'Seri #'+r.seri_hat_id)}${r.port?':'+esc(r.port):''} · Unit ${esc(r.slave_id??'—')}</small><small>${p.usableGroups.length} grup · ${p.usableRegs.length} register · ${p.usableTags.length} tag · ${p.samples.length} ölçüm${p.issues.length?' · '+p.issues.length+' uyarı':''}</small>`;
      }
      if(this.entity==='sites')return `${esc(r.code??r.kod)} · ${esc(r.konum??r.loc??'')} · ${esc(r.kurulu_guc_kwp)} kWp`;
      if(this.entity==='registers'||this.entity==='profileRegisters')return `FC${String(r.function_code).padStart(2,'0')} · PDU ${esc(r.baslangic_adresi??r.register_adresi)} · ${esc(r.register_sayisi)} × 16 bit · ${esc(r.veri_tipi)}<small>${esc(r.word_order)} / ${esc(r.byte_order)}${r.okuma_grubu_id!=null?' · Grup #'+esc(r.okuma_grubu_id):''}</small>`;
      if(this.entity==='tags')return `Cihaz #${esc(r.cihaz_id??r.device_id)} · Register #${esc(r.register_id??'Eksik')} · ${esc(r.birim??'')}`;
      if(this.entity==='groups')return `Cihaz #${esc(r.cihaz_id)} · FC${String(r.function_code).padStart(2,'0')} · ${esc(r.okuma_periyodu_ms)} ms · Blok ${esc(r.maksimum_register??'—')}`;
      return Object.entries(r).filter(([k,v])=>!['id','ad','name','aktif','aciklama'].includes(k)&&v!=null).slice(0,4).map(([k,v])=>`${esc(FIELD_LABELS[k]||k)}: ${esc(v)}`).join(' · ');
    };
    $('manage-rows').innerHTML=rows.map(r=>`<tr><td class="mono">#${esc(r.id)}</td><td><strong>${esc(recordName(r))}</strong></td><td class="record-summary">${summary(r)}</td><td>${r.aktif===false?'<span class="state-chip disabled">Pasif</span>':r.bakim_modu?'<span class="state-chip maintenance">Bakım</span>':'<span class="state-chip online">Aktif</span>'}</td><td><button class="button compact" data-config-edit="${this.entity}" data-record-id="${esc(r.id)}" ${demo?'disabled':''}>Düzenle</button> <button class="text-button" data-config-delete="${this.entity}" data-record-id="${esc(r.id)}" ${demo?'disabled':''}>API’den sil</button>${this.entity==='devices'?` <button class="text-button" data-config-inspect="${esc(r.id)}">Veri zinciri</button>`:''}</td></tr>`).join('')||`<tr><td colspan="5" class="empty-table">${loaded[this.entity]===false?'Bu liste API’den okunamadı. Tanılamadaki hatayı kontrol et.':'Kayıt yok. Üstteki ekleme düğmesiyle yeni kayıt oluştur.'}</td></tr>`;
    this.renderPipeline(selectedDevice);
  }
  async remove(entity,id){
    const ctx=this.getContext();if(this.saving||ctx.demo||!ctx.api)return;
    const row=ctx.config[entity]?.find(r=>eq(r.id,id));if(!row)return;
    await ctx.schemaReady;const doc=this.getContext().schema,path=`${ENTITIES[entity].path}/${encodeURIComponent(id)}`;
    const route=Object.entries(doc?.paths||{}).find(([p,methods])=>methods.delete&&p.replace(/\{[^}]+\}/g,String(id)).endsWith('/'+path));
    if(!route){this.toast('Bu kayıt için DELETE endpoint’i API şemasında bulunamadı.');return;}
    if(!window.confirm(`${ENTITIES[entity].singular} #${id} · ${recordName(row)} API’den kalıcı olarak silinecek. Bağlı kayıt varsa silme reddedilebilir. Devam et?`))return;
    this.saving=true;
    try{await ctx.api.request(path,{method:'DELETE'});await this.onSaved(entity,null);this.toast('API kaydı silindi. Şemadaki görsel öğe ayrıca kaldırılabilir.');}
    catch(e){this.toast(`Silinemedi: ${e.message}. Bağlı tag, register, ölçüm veya alt düğümleri kontrol et; gerekirse kaydı pasif yap.`);}
    finally{this.saving=false;this.render();}
  }
  renderPipeline(deviceId) {
    const ctx=this.getContext(),d=ctx.config.devices.find(d=>eq(d.id,deviceId));
    $('profile-setup').disabled=!d||ctx.demo||!ctx.api||this.saving;
    $('pipeline-empty').classList.toggle('hidden',!!d);$('pipeline-body').classList.toggle('hidden',!d);
    if(!d)return;
    const p=devicePipeline(d,ctx.config,ctx.measurements,ctx.loaded);
    $('pipeline-title').textContent=`${nameOf(d)} · Veri zinciri`;
    $('pipeline-counts').innerHTML=[['Okuma grubu',p.usableGroups.length,p.groups.length,'groups'],['Register',p.usableRegs.length,p.regs.length,'registers'],['Tag',p.usableTags.length,p.tags.length,'tags'],['API ölçümü',p.samples.length,p.samples.length,null]].map(([label,n,total,entity])=>`<div class="pipeline-step"><span>${label}</span><strong>${ctx.loaded[entity]===false?'?':n}${entity?` <small>/ ${total}</small>`:''}</strong><small>${entity?'okunabilir / toplam':'/measurement satırı'}</small>${entity?`<button class="text-button" data-config-list="${entity}" data-scope-device="${esc(d.id)}">Yapılandır</button>`:''}</div>`).join('');
    $('pipeline-issues').innerHTML=p.issues.map(i=>`<li>${esc(i)}</li>`).join('')||'<li class="pipeline-ok">Grup, register ve tag bağlantısı geçerli. Ölçüm kalitesini ve zamanını canlı sinyallerde izle.</li>';
    $('pipeline-edit-device').dataset.recordId=String(d.id);$('pipeline-edit-device').disabled=ctx.demo;
    const expected=new Set(p.usableTags.map(t=>String(t.id))),missing=p.usableTags.filter(t=>!p.samples.some(s=>eq(s.tag_id,t.id)));
    $('pipeline-json').textContent=JSON.stringify({device_id:d.id,connection:{protocol:d.protokol,ip:d.ip,port:d.port,unit_id:d.slave_id},expected_tag_ids:[...expected],missing_measurement_tag_ids:missing.map(t=>t.id),measurement:p.samples},null,2);
  }
  async openSetup() {
    const ctx=this.getContext();if(this.saving||ctx.demo||!ctx.api)return;
    try{
      await ctx.schemaReady;const current=this.getContext();if(current.demo||current.api!==ctx.api)return;
      if(['devices','profileRegisters','signals','groups','registers','tags'].some(k=>current.loaded[k]!==true))throw new Error('Kurulum için bütün yapılandırma listeleri başarıyla yüklenmeli. API tanılamasındaki hataları kontrol et.');
      const plan=createSetupPlan(current,current.selectedDevice);
      if(!plan.entries.length){this.toast('Bu cihazın profilindeki register / tag bağlantıları zaten var. Veri zincirindeki iletişim ve kalite uyarılarını kontrol et.');document.dispatchEvent(new CustomEvent('scada-setup-complete',{detail:{deviceId:current.selectedDevice}}));return;}
      this.setup={plan,api:current.api,config:structuredClone(current.config),common:new Map()};
      $('setup-dialog').querySelector('[data-site-wizard-note]')?.remove();
      $('setup-title').textContent=`${nameOf(plan.device)} · Profilden okuma kurulumu`;
      $('setup-help').textContent=`${plan.device.ip??'Seri hat'}:${plan.device.port??'—'} · Unit ${plan.device.slave_id} · ${plan.entries.filter(e=>e.entity==='groups').length} yeni grup, ${plan.entries.filter(e=>e.entity==='registers').length} register, ${plan.entries.filter(e=>e.entity==='tags').length} tag. Mevcut kayıtlar değiştirilmez. Boş zorunlu alanları gerçek sinyal sınırlarına / API seçeneklerine göre doldur.`;
      let html='';
      const fixed=new Set(['cihaz_id','device_id','profil_register_id','sinyal_sozlugu_id','okuma_grubu_id','register_id','baslangic_adresi','bitis_adresi','register_sayisi','function_code','veri_tipi','word_order','byte_order','carpan','aktif']);
      for(const entry of plan.entries){
        html+=`<fieldset class="setup-entry" data-setup-entry="${esc(entry.key)}"><legend>${esc(ENTITIES[entry.entity].singular)} · ${esc(entry.label)}</legend><div class="config-fields">`;
        for(const [key,input] of Object.entries(entry.model.properties||{})){
          if(input.readOnly)continue;const f=fieldSchema(plan.doc,input),value=entry.values[key],required=entry.model.required?.includes(key),locked=fixed.has(key)&&value!==undefined;
          if(locked){const display=Number(value)<0&&['register_id','okuma_grubu_id'].includes(key)?'Bu kurulumda oluşturulacak':String(value);html+=`<div class="setup-fixed"><small>${esc(FIELD_LABELS[key]||key)}</small><span>${esc(display)}</span></div>`;continue;}
          const choices=choicesFor(key,current.config,entry.values);let control;
          const table={tags:'tag',groups:'okuma_grubu',registers:'register'}[entry.entity],enums=f.enum??current.dbOptions?.tables?.[table]?.[key];
          const enumOptions=enums?.map(v=>[v,v]);
          if(required&&value===undefined){
            const reg=plan.entries.find(r=>r.entity==='registers'&&eq(r.id,entry.values.register_id));
            const datatype=entry.values.veri_tipi??reg?.values.veri_tipi??'Genel',commonKey=`${entry.entity}:${datatype}:${key}`;
            if(!this.setup.common.has(commonKey))this.setup.common.set(commonKey,{key,datatype,entity:entry.entity,f,enums,entries:[]});
            this.setup.common.get(commonKey).entries.push(entry.key);
          }
          const options=enumOptions??(choices?.map(r=>[r.id,recordName(r)]));
          if(options){control=`<select data-setup-field="${esc(key)}" ${required?'required':''}><option value="">Seç</option>${options.map(([id,label])=>`<option value="${esc(id)}" ${value!==undefined&&eq(value,id)?'selected':''}>${esc(label)}</option>`).join('')}</select>`;}
          else if(f.type==='boolean'){control=`<input data-setup-field="${esc(key)}" type="checkbox" ${value===true?'checked':''}>`;}
          else control=`<input data-setup-field="${esc(key)}" type="${f.type==='string'?'text':'number'}" ${f.type==='string'?'':`step="${f.type==='integer'?'1':'any'}"`} value="${esc(value??'')}" ${required&&key!=='birim'?'required':''} ${f.minimum!==undefined?`min="${f.minimum}"`:''} ${f.maximum!==undefined?`max="${f.maximum}"`:''}>`;
          html+=`<label class="config-field ${f.type==='boolean'?'check-field':''}"><span>${esc(FIELD_LABELS[key]||key)}${required?' <b class="required-mark">*</b>':''}</span>${control}</label>`;
        }
        html+='</div></fieldset>';
      }
      $('setup-common').innerHTML=this.setup.common.size?'<h3>Eksik alanları topluca tamamla</h3><p>Aynı veri tipindeki boş alanları tek seçimle doldur. Her kaydı aşağıda ayrı düzenleyebilirsin.</p><div class="config-fields">'+[...this.setup.common].map(([id,c])=>`<label><span>${esc(ENTITIES[c.entity].singular)} · ${esc(c.datatype)} · ${esc(FIELD_LABELS[c.key]||c.key)} (${c.entries.length})</span>${c.enums?`<select data-common="${esc(id)}"><option value="">Seç</option>${c.enums.map(v=>`<option>${esc(v)}</option>`).join('')}</select>`:`<input data-common="${esc(id)}" type="${c.f.type==='string'?'text':'number'}" step="any">`}</label>`).join('')+'</div>':'';
      $('setup-fields').innerHTML=html;$('setup-submit').disabled=false;$('setup-submit').textContent='Kurulumu API’ye kaydet';$('setup-progress').textContent='';this.previewSetup();$('setup-dialog').showModal();
    }catch(error){this.toast(error.message);$('diagnostics').open=true;}
  }
  fillSetupCommon(){
    if(!this.setup||this.saving)return;
    for(const control of $('setup-common').querySelectorAll('[data-common]')){
      const common=this.setup.common.get(control.dataset.common);if(!common)continue;
      for(const entry of common.entries){const field=$('setup-fields').querySelector(`[data-setup-entry="${CSS.escape(entry)}"] [data-setup-field="${CSS.escape(common.key)}"]`);if(field&&(field.value===''||field.dataset.commonFilled==='1')){field.value=control.value;field.dataset.commonFilled='1';}}
    }
    this.previewSetup();
  }
  setupValues() {
    const overrides={};
    for(const entry of this.setup.plan.entries){
      const group=$('setup-fields').querySelector(`[data-setup-entry="${CSS.escape(entry.key)}"]`),values={};
      for(const control of group.querySelectorAll('[data-setup-field]')){
        const key=control.dataset.setupField,f=fieldSchema(this.setup.plan.doc,entry.model.properties[key]);
        let value=control.type==='checkbox'?control.checked:control.value;
        if(value==='')value=f.nullable?null:entry.model.required?.includes(key)?value:undefined;
        values[key]=value;
      }
      overrides[entry.key]=values;
    }
    return overrides;
  }
  previewSetup() {
    if(!this.setup||this.saving)return;
    try{const bodies=validateSetupPlan(this.setup.plan,this.setup.config,this.setupValues());$('setup-preview').textContent=JSON.stringify(bodies.map(e=>({method:'POST',path:`/${ENTITIES[e.entity].path}`,body:e.body})),null,2);$('setup-error').textContent='';}
    catch(error){$('setup-error').textContent=error.message;$('setup-preview').textContent='Tüm alanlar doğrulandıktan sonra gönderilecek JSON burada görünür.';}
  }
  async saveSetup() {
    if(this.saving||!this.setup)return;const setup=this.setup,ctx=this.getContext();let started=false,completed=false;
    try{
      if(ctx.demo||ctx.api!==setup.api)throw new Error('API bağlantısı değişti. Formu kapatıp yeniden aç.');
      if(setupFingerprint(ctx.config)!==setup.plan.fingerprint)throw new Error('Yapılandırma değişti. Formu kapatıp güncel listeden yeniden hazırlat.');
      const bodies=validateSetupPlan(setup.plan,setup.config,this.setupValues());
      this.saving=true;started=true;$('setup-submit').disabled=true;$('setup-submit').textContent='Kuruluyor…';$('setup-error').textContent='';
      for(const b of $('setup-dialog').querySelectorAll('.close-dialog'))b.disabled=true;
      for(const control of $('setup-fields').querySelectorAll('input,select'))control.disabled=true;
      await executeSetup(setup.api,bodies,created=>{$('setup-progress').textContent=`Kaydedildi: ${created.length} / ${bodies.length} · ${created.at(-1).label} #${created.at(-1).id}`;});
      completed=true;$('setup-dialog').close();this.toast('Okuma grubu, register ve tag bağlantıları kaydedildi. Collector güncel yapılandırmayı tekrar okuyacak.');
    }catch(error){
      $('setup-error').textContent=error.message+(started?` ${error.created?.length??0} kayıt doğrulandı. Formu kapat, yenilenen kayıt listesini kontrol et ve yeniden hazırlat; bu form tekrar gönderilmez.`:'');
      if(started)$('setup-submit').textContent='Listeyi kontrol edip yeniden hazırla';
    }finally{
      if(started&&this.getContext().api===setup.api&&!this.getContext().demo)await this.onSaved('devices',setup.plan.device.id);
      this.saving=false;for(const b of $('setup-dialog').querySelectorAll('.close-dialog'))b.disabled=false;
    }
    if(completed)document.dispatchEvent(new CustomEvent('scada-setup-complete',{detail:{deviceId:setup.plan.device.id}}));
  }
  list(entity,deviceId='') {this.entity=entity;this.scope=String(deviceId);$('manage-entity').value=entity;this.render();$('manage-scope').value=this.scope;}
  async open(entity,id=null,presets={}) {
    if(this.saving)return;const ctx=this.getContext();
    if(ctx.demo){this.toast('Düzenleme için önce Canlı API’ye dön.');return;}
    if(!ctx.api){this.toast('Önce API bağlantı adresini düzelt.');return;}
    const row=id==null?{...presets}:ctx.config[entity]?.find(r=>eq(r.id,id));if(!row){this.toast('Kayıt bulunamadı. Listeyi yenile.');return;}
    try {
      // Wait for schema discovery before deciding whether an unknown endpoint can be edited.
      await ctx.schemaReady;if(ctx.api!==this.getContext().api||this.getContext().demo)return;
      const current=this.getContext(),operation=operationFor(current.schema,current.api.base,entity,id!=null);
      this.edit={entity,id,row:{...row},...operation,api:current.api,doc:current.schema};
      $('config-dialog').querySelector('[data-site-wizard-note]')?.remove();
      $('config-title').textContent=`${ENTITIES[entity].singular} ${id==null?'ekle':'düzenle · #'+id}`;
      $('config-help').textContent=entity==='devices'?'Sahayı ve üst bağlantıyı seç, sonra gerçek Modbus IP/port/Unit ID bilgilerini gir. Cihaz oluşturulduktan sonra okuma grubu, register ve tag bağlantılarını tamamla.':entity==='sites'?'Saha adı, konum ve kurulu güç bilgileri API’ye kaydedilir. Cihaz bağlantısını cihaz formundan seçebilirsin.':'Alanlar backend’in JSON modelinden alınır. Gerekli referans kayıtları açılır listeden seç; ham DB ID’si yazman gerekmez.';
      $('config-error').textContent='';$('config-submit').disabled=false;$('config-submit').textContent='API’ye kaydet';
      this.buildFields(current);$('config-dialog').showModal();
    } catch(error){this.toast(friendlyError(error).text);$('diagnostics').open=true;}
  }
  values() {
    const values={};if(!this.edit)return values;
    for(const [key,input] of Object.entries(this.edit.schema.properties||{})){
      const control=$('config-fields').querySelector(`[name="${CSS.escape(key)}"]`);if(!control)continue;
      const s=fieldSchema(this.edit.doc,input);
      if(!this.edit.schema.required?.includes(key)&&rowValue(this.edit.row,key)===undefined&&s.default===undefined&&!control.dataset.changed&&(control.type==='checkbox'||control.value===''))continue;
      let value=control.type==='checkbox'?control.checked:control.value;
      if(value===''&&s.nullable)value=null;
      if(value===''&&!this.edit.schema.required?.includes(key)&&rowValue(this.edit.row,key)===undefined&&s.default===undefined)value=undefined;
      values[key]=value;
    }
    if(this.edit.entity==='devices'){
      const [type,id]=$('config-parent').value.split(':');values.ust_dugum_tipi=type;values.ust_dugum_id=id;
      if(values.protokol==='MODBUS_TCP')values.seri_hat_id=null;
      if(values.protokol==='MODBUS_RTU'){values.ip=null;values.port=null;}
    }
    return values;
  }
  buildFields(ctx) {
    const {entity,row,schema,doc}=this.edit,required=new Set(schema.required||[]);
    const scopedDevice=this.scope||ctx.selectedDevice;
    let html='';
    if(entity==='devices'){
      const existingSite=ctx.topology.siteOf.get(`DEVICE:${row.id}`),siteId=row.id!=null?existingSite:ctx.selectedSite;
      html=`<div class="form-pair form-wide"><label>Saha<select id="config-site" name="_site" required><option value="">Saha seç</option>${ctx.config.sites.map(s=>`<option value="${esc(s.id)}" ${eq(s.id,siteId)?'selected':''}>${esc(nameOf(s))}</option>`).join('')}</select></label><label>Üst bağlantı<select id="config-parent" name="_parent" required></select></label></div>`;
    }
    const initial={...row,cihaz_id:row.cihaz_id??scopedDevice,device_id:row.device_id??scopedDevice};
    for(const [key,input] of Object.entries(schema.properties||{})){
      if(input.readOnly||entity==='devices'&&['ust_dugum_tipi','ust_dugum_id'].includes(key))continue;
      const site=ctx.config.sites.find(s=>eq(s.id,ctx.selectedSite));
      const defaults={cihaz_id:scopedDevice,device_id:scopedDevice,profile_id:ctx.config.devices.find(d=>eq(d.id,scopedDevice))?.profil_id,carpan:site?.varsayilan_carpan??1,olcek:1,offset_degeri:0,bit_index:0,okuma_periyodu_ms:1000,maksimum_register:125,deadband:0,timeZone:'Europe/Istanbul'};
      const s=fieldSchema(doc,input),label=FIELD_LABELS[key]||key,must=required.has(key),value=rowValue(row,key)??defaults[key]??s.default??'';
      const table={sites:'saha',devices:'cihaz',profiles:'cihaz_profili',profileRegisters:'profil_register',groups:'okuma_grubu',registers:'register',tags:'tag',signals:'sinyal_sozlugu',serialLines:'seri_hat'}[entity];
      const column={device_type:'cihaz_tipi',protocol:'protokol'}[key]??key;
      const options=choicesFor(key,ctx.config,initial),fixed=s.enum||ctx.dbOptions?.tables?.[table]?.[column]||SELECTS[key];let control;
      if(options!==null){control=`<select name="${esc(key)}" ${must?'required':''}>${this.foreignOptions(key,options,value,row)}</select>`;}
      else if(fixed){const all=fixed.map(v=>Array.isArray(v)?v:[v,v]);if(value!==''&&!all.some(([v])=>eq(v,value)))all.push([value,value+' · Mevcut']);control=`<select name="${esc(key)}" ${must?'required':''}>${all.map(([v,text])=>`<option value="${esc(v)}" ${eq(v,value)?'selected':''}>${esc(text)}</option>`).join('')}</select>`;}
      else if(s.type==='boolean'){control=`<input name="${esc(key)}" type="checkbox" ${value===true||value==='true'?'checked':''}>`;}
      else if(s.type==='string'||s.type==='integer'||s.type==='number'){
        const numeric=s.type!=='string';control=`<input name="${esc(key)}" type="${numeric?'number':'text'}" value="${esc(value)}" ${numeric?`step="${s.type==='integer'?'1':'any'}"`:''} ${s.minimum!==undefined?`min="${s.minimum}"`:''} ${s.maximum!==undefined?`max="${s.maximum}"`:''} ${s.maxLength!==undefined?`maxlength="${s.maxLength}"`:''} ${must&&key!=='birim'?'required':''}>`;
      }else throw new Error(`${label} alanının ${s.type||'karmaşık'} tipi bu formda desteklenmiyor.`);
      html+=`<label class="config-field ${s.type==='boolean'?'check-field':''}" data-field="${esc(key)}" data-section="${esc(formSection(entity,key))}"><span>${esc(label)}${must?' <b class="required-mark">*</b>':''}</span>${control}<small>${esc(fieldExplanation(entity,key)||FIELD_HINTS[key]||'')}</small></label>`;
    }
    $('config-fields').innerHTML=html;
    this.organizeFields();
    if(entity==='devices'){this.parentChoices(ctx,`${row.ust_dugum_tipi}:${row.ust_dugum_id}`);this.protocolFields();}
    if(!row.id&&entity==='devices')this.profileVersion();
    $('config-method').textContent=`${this.edit.method} /${this.edit.collection??ENTITIES[entity].path}${row.id!=null?'/'+row.id:''}`;
    $('config-context').textContent=entity==='registers'?'Sinyal → profil adresi → okuma grubu → ölçüm tag’i. Register, cihazdan okunacak değerin tarifidir; buradaki ayar fiziksel cihaza değer yazmaz.':entity==='profileRegisters'?'Önce cihaz profilini ve sinyali seç. Üretici register haritasındaki adres, veri tipi ve sıralamayı gir. Bu harita daha sonra cihazlara kopyalanarak okuma kurulumu yapılır.':entity==='tags'?'Tag, registerdan gelen ölçüme verilen benzersiz kimliktir. Cihazı seçtikten sonra yalnızca o cihazın registerları listelenir.':'Yıldızlı alanlar gerekli. Açılır listelerde adları seçebilirsin; veritabanı ID’si bilmen gerekmez.';
    this.previewScaling();
  }
  organizeFields(){
    const root=$('config-fields'),nodes=[...root.children],groups=new Map();
    for(const node of nodes){const title=node.dataset.section||'Bağlantı seçimi';if(!groups.has(title)){const section=document.createElement('fieldset');section.className='config-section';const legend=document.createElement('legend');legend.textContent=title;section.append(legend);groups.set(title,section);root.append(section);}groups.get(title).append(node);}
  }
  previewScaling(){
    if(!this.edit)return;const value=$('config-fields').querySelector('[name="carpan"]')?.value;
    const sample=Number($('config-example').value),factor=Number(value);
    $('config-scale-box').classList.toggle('hidden',this.edit.entity!=='registers');
    $('config-scale-preview').textContent=Number.isFinite(factor)&&Number.isFinite(sample)&&value!==''?`Örnek ham değer ${sample} × ${factor} = ${sample*factor}. Collector uygular; arayüz tekrar çarpmaz.`:'Önizleme için örnek ham değeri ve çarpanı gir.';
  }
  foreignOptions(key,rows,value,row={}) {
    let html=`<option value="">${FIELD_LABELS[key]||key} seç</option>`;
    if(value!==''&&value!=null&&!rows.some(r=>eq(r.id,value)))html+=`<option value="${esc(value)}" selected disabled>#${esc(value)} · Kayıt okunamadı / kapsam dışında</option>`;
    return html+rows.map(r=>`<option value="${esc(r.id)}" ${eq(r.id,value)?'selected':''}>${esc(recordName(r))} · #${esc(r.id)}${r.aktif===false?' · Pasif':''}</option>`).join('');
  }
  parentChoices(ctx,preferred='') {
    const site=$('config-site').value,select=$('config-parent');
    const rows=[...ctx.topology.nodes.values()].filter(n=>n.type!=='DEVICE'&&eq(ctx.topology.siteOf.get(n.key),site));
    select.innerHTML='<option value="">Üst düğüm seç</option>'+rows.map(n=>`<option value="${esc(n.key)}">${esc(TYPES[n.type])} · ${esc(n.name)} · #${esc(n.id)}</option>`).join('');
    if(rows.some(n=>n.key===preferred))select.value=preferred;
    else if(this.edit.id==null||preferred==='site-changed')select.value=rows.find(n=>n.type==='SAHA')?.key||'';
  }
  protocolFields() {
    const protocol=$('config-fields').querySelector('[name="protokol"]')?.value;
    for(const key of ['ip','port','seri_hat_id']){
      const label=$('config-fields').querySelector(`[data-field="${key}"]`);if(!label)continue;
      const enabled=key==='seri_hat_id'?protocol==='MODBUS_RTU':protocol==='MODBUS_TCP';label.classList.toggle('hidden',!enabled);
      const control=label.querySelector('input,select');control.disabled=!enabled;control.required=enabled;
    }
    const unit=$('config-fields').querySelector('[name="slave_id"]');if(unit){unit.required=true;unit.min=1;unit.max=247;}
    const port=$('config-fields').querySelector('[name="port"]');if(port){port.min=1;port.max=65535;}
  }
  profileVersion() {
    const ctx=this.getContext(),control=$('config-fields').querySelector('[name="profil_id"]'),version=$('config-fields').querySelector('[name="profil_surum"]');
    const p=ctx.config.profiles?.find(r=>eq(r.id,control?.value));if(p&&version)version.value=p.surum??'';
  }
  changed(key) {
    if(!this.edit)return;const ctx=this.getContext();
    const changedControl=$('config-fields').querySelector(`[name="${CSS.escape(key)}"]`);if(changedControl)changedControl.dataset.changed='true';
    if(key==='_site'){this.parentChoices(ctx,'site-changed');return;}
    if(key==='protokol')this.protocolFields();if(key==='profil_id')this.profileVersion();
    if(key==='veri_tipi'){
      const type=$('config-fields').querySelector('[name="veri_tipi"]')?.value,count={FLOAT32:2,FLOAT64:4,FLOAT16:1,INT16:1,UINT16:1,INT32:2,UINT32:2,BOOL:1,ENUM:1}[type];
      const control=$('config-fields').querySelector('[name="register_sayisi"]');if(control&&count){control.value=count;control.dataset.changed='true';}
    }
    if(['cihaz_id','device_id'].includes(key)){
      const values=this.values();for(const k of ['okuma_grubu_id','register_id','profil_register_id']){
        const control=$('config-fields').querySelector(`[name="${k}"]`);if(control)control.innerHTML=this.foreignOptions(k,choicesFor(k,ctx.config,values)||[],'');
      }
    }
    if(key==='profil_register_id'&&this.edit.entity==='registers'&&this.edit.id==null){
      const p=ctx.config.profileRegisters.find(p=>eq(p.id,this.values().profil_register_id));
      if(p)for(const [key,value] of Object.entries({baslangic_adresi:p.register_adresi,register_sayisi:p.register_sayisi,function_code:p.function_code,veri_tipi:p.veri_tipi,word_order:p.word_order,byte_order:p.byte_order,sinyal_sozlugu_id:p.sinyal_sozlugu_id,carpan:p.olcek})){const el=$('config-fields').querySelector(`[name="${key}"]`);if(el&&value!=null){el.value=value;el.dataset.changed='true';}}
    }
    if(key==='register_id'&&this.edit.entity==='tags'&&this.edit.id==null){
      const r=ctx.config.registers.find(r=>eq(r.id,this.values().register_id));if(r)for(const key of ['sinyal_sozlugu_id','profil_register_id','birim']){const el=$('config-fields').querySelector(`[name="${key}"]`);if(el&&r[key]!=null){el.value=r[key];el.dataset.changed='true';}}
    }
  }
  async save() {
    if(this.saving||!this.edit)return;const edit=this.edit,ctx=this.getContext();let completed=null;
    if(ctx.demo||ctx.api!==edit.api){$('config-error').textContent='API bağlantısı değişti. Formu kapatıp güncel bağlantıda tekrar aç.';return;}
    try {
      const body=validateConfiguration(edit.entity,formPayload(edit.doc,edit.schema,this.values()),ctx.config);
      this.beforeSave?.(edit,body);
      this.saving=true;$('config-submit').disabled=true;$('config-submit').textContent='Kaydediliyor…';$('config-error').textContent='';
      for(const b of $('config-dialog').querySelectorAll('.close-dialog'))b.disabled=true;
      const result=edit.id==null?await edit.api.create(edit.collection??ENTITIES[edit.entity].path,body):await edit.api.update(edit.collection??ENTITIES[edit.entity].path,edit.id,body,edit.method);
      if(result===null)throw new Error('API boş kayıt sonucu döndürdü; listeyi yenileyip kaydı kontrol et.');
      $('config-dialog').close();this.toast(`${ENTITIES[edit.entity].singular} API’ye kaydedildi.`);
      if(this.getContext().api===edit.api&&!this.getContext().demo)await this.onSaved(edit.entity,result,body);
      if(this.getContext().api===edit.api&&!this.getContext().demo)completed={entity:edit.entity,result,body,isNew:edit.id==null,token:edit.row._wizard_token};
    }catch(error){const help=friendlyError(error);$('config-error').textContent=help.text;}
    finally{this.saving=false;$('config-submit').disabled=false;$('config-submit').textContent='API’ye kaydet';for(const b of $('config-dialog').querySelectorAll('.close-dialog'))b.disabled=false;}
    if(completed)document.dispatchEvent(new CustomEvent('scada-record-saved',{detail:completed}));
  }
}
