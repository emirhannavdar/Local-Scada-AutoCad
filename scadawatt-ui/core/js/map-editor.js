import {nameOf,escapeHtml as esc} from './model.js';
import {operationFor,rowValue,formPayload,validateConfiguration} from './configuration.js';
import {friendlyError} from './user-help.js';
import {MapImport} from './map-import-ui.js';
const eq=(a,b)=>String(a)===String(b);
export class MapEditor{
  constructor(ctx,management,onSaved){this.ctx=ctx;this.manager=management;this.saved=onSaved;this.saving=false;const $=id=>document.getElementById(id);this.$=$;
    this.importer=new MapImport(ctx,onSaved);
    $('open-map').onclick=()=>this.open();$('map-profile').onchange=()=>this.renderRows();
    $('map-add').onclick=()=>{const profile=$('map-profile').value;$('map-dialog').close();management.open('profileRegisters',null,{profile_id:profile});};
    $('map-signal-add').onclick=()=>{$('map-dialog').close();management.open('signals');};
    $('map-dialog').addEventListener('cancel',e=>{if(this.saving)e.preventDefault();});
    $('map-rows').addEventListener('click',e=>{const b=e.target.closest('[data-map-save]');if(b)this.save(b.dataset.mapSave);});
    $('map-rows').addEventListener('change',e=>{if(e.target.dataset.mapField!=='veri_tipi')return;const n={FLOAT32:2,FLOAT64:4,INT16:1,UINT16:1,INT32:2,UINT32:2,BOOL:1,ENUM:1}[e.target.value];if(n)e.target.closest('tr').querySelector('[data-map-field="register_sayisi"]').value=n;});
  }
  open(){const ctx=this.ctx(),$=this.$,device=ctx.config.devices.find(d=>eq(d.id,ctx.selectedDevice));
    $('map-profile').innerHTML=ctx.config.profiles.map(p=>`<option value="${esc(p.id)}">${esc(nameOf(p))} · ${esc(p.surum??'Sürüm yok')}</option>`).join('');
    if(device)$('map-profile').value=device.profil_id;$('map-error').textContent='';this.renderRows();$('map-dialog').showModal();
  }
  renderRows(){const {config,demo}=this.ctx(),$=this.$,profile=$('map-profile').value,maps=config.profileRegisters.filter(r=>eq(r.profil_id??r.profile_id,profile));
    $('map-add').disabled=demo||!profile;$('map-signal-add').disabled=demo;
    $('map-rows').innerHTML=maps.map(r=>{const signal=config.signals.find(s=>eq(s.id,r.sinyal_sozlugu_id));
      const numeric=(key,value,step='1')=>`<input data-map-field="${key}" type="number" step="${step}" value="${esc(value)}" aria-label="${key}">`;
      const select=(key,values)=>`<select data-map-field="${key}" aria-label="${key}">${values.map(v=>`<option value="${v}" ${eq(r[key],v)?'selected':''}>${v}</option>`).join('')}</select>`;
      return `<tr data-map-id="${r.id}"><td><strong>${esc(signal?.sinyal_adi??nameOf(signal||{}))}</strong><small>${esc(signal?.birim??'')} · #${r.id}</small></td><td>${numeric('register_adresi',r.register_adresi)}</td><td>${select('function_code',[3,4])}</td><td>${select('veri_tipi',['FLOAT32','FLOAT64','FLOAT16','INT16','UINT16','INT32','UINT32','BOOL','ENUM','STRING'])}</td><td>${numeric('register_sayisi',r.register_sayisi)}</td><td>${select('word_order',['ABCD','CDAB','BADC','DCBA'])}${select('byte_order',['BIG','LITTLE'])}</td><td>${numeric('olcek',r.olcek,'any')}</td><td><button class="button compact" data-map-save="${r.id}" ${demo?'disabled':''}>Satırı kaydet</button></td></tr>`;
    }).join('')||'<tr><td colspan="8">Harita boş. Önce profil ve sinyal tanımını oluştur, ardından “Haritaya sinyal ekle” düğmesini kullan.</td></tr>';
    $('map-scope-note').textContent=`${maps.length} profil satırı. Bu profil birden fazla cihazda kullanılabilir. Değişiklik yeni okuma kurulumuna kaynak olur; kurulu registerları değiştirmek için Registerlar / Çarpanlar ekranını kullan.`;
  }
  async save(id){if(this.saving)return;const ctx=this.ctx(),$=this.$;
    try{if(ctx.demo||!ctx.api)throw new Error('Canlı API bağlantısı gerekli.');await ctx.schemaReady;
      const row=ctx.config.profileRegisters.find(r=>eq(r.id,id)),op=operationFor(this.ctx().schema,ctx.api.base,'profileRegisters',true),values={};
      for(const key of Object.keys(op.schema.properties))values[key]=rowValue(row,key);
      for(const control of $('map-rows').querySelector(`[data-map-id="${CSS.escape(String(id))}"]`).querySelectorAll('[data-map-field]'))values[control.dataset.mapField]=control.value;
      const body=validateConfiguration('profileRegisters',formPayload(this.ctx().schema,op.schema,values),ctx.config);
      this.saving=true;for(const c of $('map-dialog').querySelectorAll('button,input,select'))c.disabled=true;
      await ctx.api.update(op.collection,id,body,op.method);await this.saved();$('map-error').textContent='Satır kaydedildi. Kurulu registerlar otomatik değiştirilmedi.';this.renderRows();
    }catch(error){$('map-error').textContent=friendlyError(error).text;}
    finally{this.saving=false;for(const c of $('map-dialog').querySelectorAll('button,input,select'))c.disabled=false;}
  }
}
