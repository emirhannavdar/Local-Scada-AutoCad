import {buildImportPlan,executeImportPlan} from './map-import.js';
import {escapeHtml as esc,nameOf} from './model.js';
import {friendlyError} from './user-help.js';
export const JSON_EXAMPLE={
  defaults:{cihaz_tipi:'INVERTER',function_code:3,word_order:'ABCD',byte_order:'BIG',olcek:1,offset_degeri:0,bit_index:0,periyot_saniye:1,aktif:true},
  registers:[
    {sinyal_adi:'grid_active_power',aciklama:'Şebeke Aktif Güç',register_adresi:36047,veri_tipi:'FLOAT32',birim:'kW',min_deger:0,max_deger:200},
    {sinyal_adi:'grid_current_avg',aciklama:'Şebeke Ortalama Akım',register_adresi:36019,veri_tipi:'FLOAT32',birim:'A',min_deger:0,max_deger:500}
  ]
};
export class MapImport{
  constructor(ctx,reload){
    this.ctx=ctx;this.reload=reload;this.saving=false;this.loading=false;this.plan=null;this.$=id=>document.getElementById(id);
    this.$('map-import-open').onclick=()=>this.open();
    this.$('map-import-preview').onclick=()=>this.preview();
    this.$('map-import-save').onclick=()=>this.save();
    this.$('map-import-example').onclick=()=>{const blob=new Blob([JSON.stringify(JSON_EXAMPLE,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='register_haritasi_ornek.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    for(const id of ['map-import-json','map-import-profile','map-import-policy'])this.$(id).addEventListener('input',()=>this.invalidate());
    this.$('map-import-file').onchange=async e=>{
      const file=e.target.files[0];if(!file)return;
      try{if(file.size>2*1024*1024)throw new Error('Dosya en fazla 2 MB olabilir.');this.$('map-import-json').value=await file.text();this.invalidate();}
      catch(error){this.$('map-import-error').textContent=error.message;}
    };
    this.$('map-import-dialog').addEventListener('cancel',e=>{if(this.saving||this.loading)e.preventDefault();});
  }
  invalidate(){this.plan=null;this.$('map-import-save').disabled=true;this.$('map-import-rows').innerHTML='';this.$('map-import-status').textContent='JSON veya seçenekler değişti. Önizlemeyi yeniden oluştur.';this.$('map-import-error').textContent='';}
  open(){
    this.expectedProfile=null;this.$('map-import-dialog').querySelector('[data-site-wizard-note]')?.remove();
    const ctx=this.ctx();this.$('map-dialog').close();
    this.$('map-import-profile').innerHTML=ctx.config.profiles.map(p=>'<option value="'+esc(p.id)+'">'+esc(nameOf(p))+'</option>').join('');
    this.$('map-import-profile').value=this.$('map-profile').value;
    this.$('map-import-policy').innerHTML='<option value="">JSON’da bütün politika alanlarını belirteceğim</option>'+ctx.config.signals.map(s=>'<option value="'+esc(s.id)+'">'+esc(s.sinyal_adi)+' — '+esc(s.alarm_sinifi)+' / '+esc(s.okuma_sinifi)+'</option>').join('');
    if(!this.$('map-import-json').value)this.$('map-import-json').value=JSON.stringify(JSON_EXAMPLE,null,2);
    this.invalidate();this.$('map-import-dialog').showModal();
  }
  lock(value){for(const control of this.$('map-import-dialog').querySelectorAll('button,input,select,textarea'))control.disabled=value;if(!value)this.$('map-import-save').disabled=!this.plan||this.ctx().demo||!this.plan.entries.some(e=>!e.skip);}
  render(){
    const entries=this.plan?.entries??[];
    this.$('map-import-rows').innerHTML=entries.map(e=>'<tr><td>'+e.index+'</td><td>'+esc(e.name)+'</td><td>'+e.mapBody.register_adresi+'</td><td>'+e.mapBody.function_code+'</td><td>'+esc(e.mapBody.veri_tipi)+' / '+e.mapBody.register_sayisi+'</td><td>'+esc(e.mapBody.olcek)+'</td><td>'+(e.signalBody?'Yeni sinyal':'Mevcut sinyal')+'</td><td>'+esc(e.status)+'</td></tr>').join('');
  }
  async preview(){
    if(this.saving||this.loading)return;
    this.plan=null;this.loading=true;this.lock(true);this.$('map-import-error').textContent='';
    try{
      const initial=this.ctx();if(initial.demo||!initial.apiOnline)throw new Error('Canlı API bağlantısı gerekli; örnek modunda kayıt yapılamaz.');
      if(this.expectedProfile&&String(this.expectedProfile)!==this.$('map-import-profile').value)throw new Error('Saha kurulumunda seçilen profili kullan. Başka profil için kuruluma ara ver.');
      await initial.schemaReady;await this.reload();
      const ctx=this.ctx();if(!ctx.loaded.signals||!ctx.loaded.profileRegisters||!ctx.loaded.profiles)throw new Error('Sözlük/profil listeleri okunamadı. API bağlantısını düzeltip tekrar önizle.');
      const policy=ctx.config.signals.find(s=>String(s.id)===this.$('map-import-policy').value)??{};
      this.plan=buildImportPlan(ctx,this.$('map-import-profile').value,this.$('map-import-json').value,policy);
      this.render();const e=this.plan.entries;
      this.$('map-import-status').textContent=e.length+' satır: '+e.filter(r=>r.signalBody).length+' yeni sinyal, '+e.filter(r=>!r.skip).length+' yeni profil registerı, '+e.filter(r=>r.skip).length+' aynı kayıt atlanacak.';
    }catch(error){this.$('map-import-error').textContent=error.message;this.$('map-import-status').textContent='Kaydetmeden önce hataları düzelt.';this.$('map-import-rows').innerHTML='';}
    finally{this.loading=false;this.lock(false);}
  }
  async save(){
    if(this.saving||this.loading||!this.plan)return;
    this.saving=true;this.lock(true);this.$('map-import-error').textContent='';
    let completed=false;
    try{
      const ctx=this.ctx();if(ctx.demo||!ctx.apiOnline)throw new Error('Canlı API bağlantısı gerekli.');
      const stats=await executeImportPlan(this.plan,ctx.api,(entry,s)=>{this.render();this.$('map-import-status').textContent=s.signals+' sinyal ve '+s.maps+' profil registerı kaydedildi.';});
      completed=true;this.$('map-import-status').textContent='Tamamlandı: '+stats.signals+' sinyal, '+stats.maps+' profil registerı eklendi; '+stats.skipped+' kayıt atlandı. Şimdi cihaz için Profilden okuma kurulumunu çalıştır.';
    }catch(error){this.$('map-import-error').textContent=error.message+'\n'+friendlyError(error).text;}
    finally{
      // API mevcut tek-kayıt endpointlerini kullanır; toplu işlem atomik değildir.
      this.plan=null;
      try{await this.reload();}catch{this.$('map-import-error').textContent+='\nListeler yenilenemedi. Yeniden önizleme yapmadan tekrar kaydetme.';}
      this.saving=false;this.lock(false);
      if(completed)this.$('map-import-save').disabled=true;
      if(completed)document.dispatchEvent(new CustomEvent('scada-map-imported',{detail:{profileId:Number(this.$('map-import-profile').value)}}));
    }
  }
}
