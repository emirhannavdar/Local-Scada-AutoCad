import {startSiteFlow,advanceSiteFlow,flowPresets,FLOW_LABELS} from './site-flow.js';
import {nameOf,escapeHtml as esc,sampleState} from './model.js';
import {devicePipeline} from './configuration.js';
const eq=(a,b)=>String(a)===String(b);
const titles={topology:'Saha kaydedildi. Elektrik bağlantısını seç',profile:'Cihaz profilini seç',map:'Register haritasını hazırla',verify:'Yapılandırma tamamlandı. Canlı veriyi kontrol et'};
export class SiteWizard{
  constructor(ctx,management,mapEditor,actions){
    this.ctx=ctx;this.manager=management;this.map=mapEditor;this.actions=actions;this.state=null;this.opening=false;this.base=null;this.$=id=>document.getElementById(id);
    this.$('wizard-resume').onclick=()=>this.resume();
    this.$('wizard-pause').onclick=()=>this.pause();
    this.$('wizard-primary').onclick=()=>this.act(false);
    this.$('wizard-secondary').onclick=()=>this.act(true);
    document.addEventListener('click',e=>{if(e.target.closest('[data-wizard-pause]'))this.pause();});
    document.addEventListener('scada-record-saved',e=>this.saved(e.detail));
    document.addEventListener('scada-map-imported',e=>{if(this.matches('map')&&eq(e.detail.profileId,this.state.ids.profiles)){this.$('map-import-dialog').close();this.setStep('setup');this.show();}});
    document.addEventListener('scada-setup-complete',e=>{if(this.matches('setup')&&eq(e.detail.deviceId,this.state.ids.devices)){this.setStep('verify');this.show();}});
    management.beforeSave=(edit,body)=>{
      if(!this.state||edit.row._wizard_token!==this.token())return;
      const preset=flowPresets(this.state);
      for(const key of ['saha_id','dm_id','tm_id','trafo_id','ust_dugum_tipi','ust_dugum_id','profil_id'])if(preset[key]!=null&&!eq(body[key],preset[key]))throw new Error('Kurulumun '+key+' bağlantısı değişti. Bu sahaya ait önerilen bağlantıyı kullan; başka kayıt için kuruluma ara ver.');
    };
  }
  token(){return this.state?this.state.siteId+':'+this.state.step:null;}
  matches(step){return this.state?.step===step&&this.state.base===this.ctx().api?.base;}
  storageKey(base){return 'scadawatt.site-wizard.v1:'+base;}
  persist(){if(!this.state)return;try{localStorage.setItem(this.storageKey(this.state.base),JSON.stringify(this.state));}catch{}this.update();}
  setStep(step){this.state={...this.state,step};this.persist();}
  restore(){
    const base=this.ctx().api?.base;if(!base)return;
    if(base!==this.base){this.base=base;this.state=null;try{const s=JSON.parse(localStorage.getItem(this.storageKey(base)));if(s?.version===1&&s.base===base&&FLOW_LABELS[s.step]&&s.ids)this.state=s;}catch{}}
  }
  update(){
    this.restore();this.$('wizard-resume').classList.toggle('hidden',!this.state);
    if(this.state)this.$('wizard-resume').textContent='Kuruluma devam · '+FLOW_LABELS[this.state.step];
    if(this.$('wizard-dialog').open&&this.state?.step==='verify')this.verification();
  }
  ensure(){
    const ctx=this.ctx(),s=this.state;if(!s||ctx.demo||!ctx.apiOnline||ctx.api?.base!==s.base)throw new Error('Bu kurulum için aynı canlı API’ye bağlan.');
    if(!ctx.config.sites.some(r=>eq(r.id,s.siteId)))throw new Error('Kurulum sahası listede yok. API listesini yenile.');
    if(s.ids.profiles&&!ctx.config.profiles.some(r=>eq(r.id,s.ids.profiles)))throw new Error('Seçilen profil artık listede yok. Profil kaydını kontrol et.');
    if(s.ids.devices){
      const d=ctx.config.devices.find(r=>eq(r.id,s.ids.devices));
      if(!d||!eq(ctx.topology.siteOf.get('DEVICE:'+d.id),s.siteId)||!eq(d.profil_id,s.ids.profiles))throw new Error('Kurulum cihazının saha/profil bağlantısı değişti. Cihaz kaydını düzelt.');
    }
    this.actions.select(s.siteId,s.ids.devices??null);
  }
  async saved(detail){
    if(!detail.isNew)return;
    const id=typeof detail.result==='number'?detail.result:detail.result?.id;
    try{
      if(detail.entity==='sites'){
        this.state=startSiteFlow(id,this.ctx().api.base);this.base=this.state.base;this.persist();await this.show();return;
      }
      if(!this.state||detail.token!==this.token())return;
      this.state=advanceSiteFlow(this.state,detail.entity,id);this.persist();await this.show();
    }catch(error){this.actions.toast(error.message);this.update();}
  }
  async resume(){this.restore();await this.show();}
  pause(){
    for(const id of ['wizard-dialog','config-dialog','map-dialog','map-import-dialog','setup-dialog'])if(this.$(id).open)this.$(id).close();
    this.persist();this.actions.toast('Kaydedilen bilgiler korundu. “Kuruluma devam” ile kaldığın adıma dönebilirsin.');
  }
  note(dialogId){
    const dialog=this.$(dialogId);let note=dialog.querySelector('[data-site-wizard-note]');
    if(!note){note=document.createElement('div');note.setAttribute('data-site-wizard-note','');note.className='context-help wizard-form-note';dialog.prepend(note);}
    note.innerHTML='<strong>Saha kurulumu · '+esc(FLOW_LABELS[this.state.step])+'</strong><span>Kaydedince sonraki adım otomatik açılır.</span><button type="button" class="text-button" data-wizard-pause>Kuruluma ara ver</button>';
  }
  async show(){
    if(this.opening||!this.state)return;this.opening=true;const initialStep=this.state.step;
    try{
      this.ensure();const s=this.state;
      this.$('wizard-dialog').close();
      if(['dm','tm','trafo','adp','device'].includes(s.step)){
        await this.manager.open(s.step==='device'?'devices':s.step,null,flowPresets(s));
        this.note('config-dialog');return;
      }
      if(s.step==='profile'&&!this.ctx().config.profiles.some(p=>p.aktif!==false)){
        await this.manager.open('profiles',null,flowPresets(s));this.note('config-dialog');return;
      }
      if(s.step==='map'&&!this.maps().length){this.openImport();return;}
      if(s.step==='setup'){await this.manager.openSetup();if(this.$('setup-dialog').open)this.note('setup-dialog');return;}
      this.render();this.$('wizard-dialog').showModal();
    }catch(error){this.actions.toast(error.message);}
    finally{this.opening=false;this.update();if(this.state&&this.state.step!==initialStep)queueMicrotask(()=>this.show());}
  }
  maps(){return this.ctx().config.profileRegisters.filter(r=>eq(r.profil_id??r.profile_id,this.state.ids.profiles));}
  openImport(){
    this.map.open();this.$('map-profile').value=String(this.state.ids.profiles);this.map.renderRows();this.map.importer.open();this.map.importer.expectedProfile=this.state.ids.profiles;this.note('map-import-dialog');
  }
  render(){
    const s=this.state,$=this.$,ctx=this.ctx(),site=ctx.config.sites.find(r=>eq(r.id,s.siteId));
    $('wizard-title').textContent=titles[s.step]??FLOW_LABELS[s.step];$('wizard-context').textContent=nameOf(site)+' · '+FLOW_LABELS[s.step];
    $('wizard-choice').innerHTML='';$('wizard-choice').classList.toggle('hidden',s.step!=='profile');
    $('wizard-primary').disabled=false;$('wizard-secondary').classList.remove('hidden');
    if(s.step==='topology'){
      $('wizard-text').textContent='Tesisteki gerçek yapıyı seç. Tam yapıda köşk → hücre → trafo → pano formları sırayla açılır; üst bağlantılar otomatik doldurulur. Test cihazını doğrudan sahaya da bağlayabilirsin.';
      $('wizard-primary').textContent='Köşk → hücre → trafo → pano ile ilerle';$('wizard-secondary').textContent='Cihazı doğrudan sahaya bağla';
    }else if(s.step==='profile'){
      $('wizard-text').textContent='Aynı modeldeki cihazların profilini tekrar kullanabilirsin. Farklı adres haritası için yeni profil oluştur.';
      $('wizard-choice').innerHTML=ctx.config.profiles.filter(p=>p.aktif!==false).map(p=>'<option value="'+esc(p.id)+'">'+esc(nameOf(p))+' · '+esc(p.surum??'')+'</option>').join('');
      $('wizard-primary').textContent='Seçili profille cihaz bağlantısına geç';$('wizard-secondary').textContent='Yeni cihaz profili oluştur';
    }else if(s.step==='map'){
      $('wizard-text').textContent=this.maps().length+' register tanımı bu profilde hazır. Mevcut haritayla okuma zincirine geç veya JSON ile ek tanımları yükle.';
      $('wizard-primary').textContent='Mevcut haritayla devam';$('wizard-secondary').textContent='JSON register haritası yükle';
    }else if(s.step==='verify')this.verification();
  }
  verification(){
    const ctx=this.ctx(),d=ctx.config.devices.find(r=>eq(r.id,this.state.ids.devices)),p=d?devicePipeline(d,ctx.config,ctx.measurements,ctx.loaded):null;
    const expected=p?.usableTags??[],ids=new Set(expected.map(t=>String(t.id)));
    const current=ctx.measurements.filter(m=>ids.has(String(m.tag_id))&&sampleState(m,ctx.config,ctx.settings,Date.now(),ctx.apiOnline)==='online');
    const currentIds=new Set(current.map(m=>String(m.tag_id)));
    const ready=expected.length>0&&currentIds.size===expected.length&&!p.issues.length;
    this.$('wizard-text').textContent=(d?nameOf(d):'Cihaz')+': '+(p?.usableGroups.length??0)+' grup, '+(p?.usableRegs.length??0)+' register, '+expected.length+' tag. Güncel GOOD sinyal: '+currentIds.size+' / '+expected.length+'. '+(ready?'Canlı veriler doğrulandı.': 'Collector ve simülatör çalışırken ölçümler burada otomatik güncellenir. '+(p?.issues.join(' ')??''));
    this.$('wizard-primary').textContent=ready?'Kurulumu tamamla ve şemayı aç':'Güncel ölçümler bekleniyor';this.$('wizard-primary').disabled=!ready;this.$('wizard-secondary').textContent='Şemayı aç, kontrolü daha sonra tamamla';
  }
  async act(secondary){
    try{
      this.ensure();const s=this.state;this.$('wizard-dialog').close();
      if(s.step==='topology')this.setStep(secondary?'profile':'dm');
      else if(s.step==='profile'){
        if(secondary){await this.manager.open('profiles',null,flowPresets(s));this.note('config-dialog');return;}
        this.state=advanceSiteFlow(s,'profiles',Number(this.$('wizard-choice').value));this.persist();
      }else if(s.step==='map'){
        if(secondary){this.openImport();return;}if(!this.maps().length)throw new Error('Register haritası gerekli.');this.setStep('setup');
      }else if(s.step==='verify'){
        if(!secondary){
          this.verification();if(this.$('wizard-primary').disabled)throw new Error('Bütün ölçümler henüz güncel GOOD değil.');
          try{localStorage.removeItem(this.storageKey(s.base));}catch{}this.state=null;this.update();
        }
        this.actions.diagram();return;
      }
      await this.show();
    }catch(error){this.actions.toast(error.message);}
  }
}
