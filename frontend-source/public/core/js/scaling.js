import {nameOf,escapeHtml as esc} from './model.js';
import {operationFor,rowValue,formPayload,validateConfiguration} from './configuration.js';
import {friendlyError} from './user-help.js';
const eq=(a,b)=>String(a)===String(b);
export function scalePreview(value,oldFactor,newFactor){return typeof value==='number'&&Number.isFinite(value)&&Number.isFinite(Number(oldFactor))&&Number(oldFactor)!==0&&Number.isFinite(Number(newFactor))?value/Number(oldFactor)*Number(newFactor):null;}
export function scalingOperations(ctx,changes){
  const result=[];
  for(const change of changes){
    const reg=ctx.config.registers.find(r=>eq(r.id,change.id));if(!reg)throw new Error('Register bulunamadı. Listeyi yenile.');
    if(!Number.isFinite(Number(change.factor))||change.factor==='')throw new Error(`${nameOf(reg)}: çarpan sonlu bir sayı olmalı.`);
    const candidates=[{entity:'registers',row:reg,changes:{carpan:Number(change.factor),birim:change.unit??reg.birim}}];
    if(change.unit!==undefined&&change.unit!==reg.birim)for(const tag of ctx.config.tags.filter(t=>eq(t.register_id,reg.id)&&eq(t.cihaz_id??t.device_id,reg.cihaz_id)))candidates.push({entity:'tags',row:tag,changes:{birim:change.unit}});
    for(const c of candidates){
      const op=operationFor(ctx.schema,ctx.api.base,c.entity,true),full=operationFor(ctx.schema,ctx.api.base,c.entity).schema,values={};
      for(const key of Object.keys(full.properties))values[key]=rowValue(c.row,key);Object.assign(values,c.changes);
      validateConfiguration(c.entity,formPayload(ctx.schema,full,values),ctx.config);
      result.push({...op,entity:c.entity,id:c.row.id,body:op.method==='PATCH'?formPayload(ctx.schema,op.schema,c.changes):formPayload(ctx.schema,op.schema,values)});
    }
  }
  return result;
}
export class ScalingPanel{
  constructor(ctx,onSaved){this.ctx=ctx;this.saved=onSaved;this.saving=false;this.$=id=>document.getElementById(id);const $=this.$;
    $('open-scaling').onclick=()=>this.open();$('scaling-device').onchange=()=>this.rows();$('scaling-rows').addEventListener('input',()=>this.preview());
    $('scaling-form').onsubmit=e=>{e.preventDefault();this.save();};$('scaling-default-save').onclick=()=>this.saveDefault();
    $('scaling-dialog').addEventListener('cancel',e=>{if(this.saving)e.preventDefault();});
  }
  open(){const ctx=this.ctx(),$=this.$,site=ctx.config.sites.find(s=>eq(s.id,ctx.selectedSite)),devices=ctx.config.devices.filter(d=>eq(ctx.topology.siteOf.get(`DEVICE:${d.id}`),ctx.selectedSite));
    this.siteId=ctx.selectedSite;$('scaling-site').textContent=site?nameOf(site):'Önce saha seç';$('scaling-default').value=site?.varsayilan_carpan??1;
    $('scaling-device').innerHTML=devices.map(d=>`<option value="${esc(d.id)}">${esc(nameOf(d))}</option>`).join('');if(devices.some(d=>eq(d.id,ctx.selectedDevice)))$('scaling-device').value=ctx.selectedDevice;
    $('scaling-error').textContent='';this.rows();$('scaling-submit').disabled=ctx.demo||!ctx.api;$('scaling-default-save').disabled=ctx.demo||!ctx.api||!site;$('scaling-dialog').showModal();
  }
  rows(){const ctx=this.ctx(),$=this.$,regs=ctx.config.registers.filter(r=>eq(r.cihaz_id,$('scaling-device').value));this.snapshot=JSON.stringify([ctx.config.registers,ctx.config.tags]);
    $('scaling-rows').innerHTML=regs.map(r=>`<tr data-scale-id="${r.id}"><td><input type="checkbox" data-scale-use aria-label="${esc(nameOf(r))} seç"></td><td><strong>${esc(nameOf(r))}</strong><small>PDU ${r.baslangic_adresi} · ${r.veri_tipi}</small></td><td>${esc(r.carpan??1)}</td><td><input type="number" step="any" data-scale-factor value="${esc(r.carpan??1)}" aria-label="Yeni çarpan"></td><td><input data-scale-unit value="${esc(r.birim??'')}" aria-label="Hedef birim"></td><td data-scale-preview>—</td></tr>`).join('')||'<tr><td colspan="6">Bu cihaz için register yok. Kurulum yardımcısındaki register adımını tamamla.</td></tr>';this.preview();
  }
  preview(){const ctx=this.ctx();for(const row of this.$('scaling-rows').querySelectorAll('[data-scale-id]')){const reg=ctx.config.registers.find(r=>eq(r.id,row.dataset.scaleId)),tag=ctx.config.tags.find(t=>eq(t.register_id,reg.id)&&eq(t.cihaz_id,reg.cihaz_id)),sample=ctx.measurements.find(s=>eq(s.tag_id,tag?.id)),value=scalePreview(sample?.value,reg.carpan??1,row.querySelector('[data-scale-factor]').value);row.querySelector('[data-scale-preview]').textContent=value==null?'Örnek yok / eski çarpan 0':`${sample.value} → ${Number(value.toPrecision(7))} ${row.querySelector('[data-scale-unit]').value} (${sample.quality}; son örnek)`;}}
  lock(value){this.saving=value;for(const c of this.$('scaling-dialog').querySelectorAll('button,input,select'))c.disabled=value;}
  async saveDefault(){if(this.saving)return;const ctx=this.ctx(),$=this.$;
    try{if(ctx.demo||!ctx.api)throw new Error('Canlı API gerekli.');await ctx.schemaReady;const row=ctx.config.sites.find(s=>eq(s.id,this.siteId));if(!row)throw new Error('Saha bulunamadı.');
      const op=operationFor(this.ctx().schema,ctx.api.base,'sites',true),factor=Number($('scaling-default').value);if(!Number.isFinite(factor)||$('scaling-default').value==='')throw new Error('Çarpan geçerli bir sayı olmalı.');
      const values={};for(const key of Object.keys(op.schema.properties))values[key]=rowValue(row,key);values.varsayilan_carpan=factor;
      const body=validateConfiguration('sites',formPayload(this.ctx().schema,op.schema,values),ctx.config);this.lock(true);await ctx.api.update(op.collection,row.id,body,op.method);await this.saved();$('scaling-error').textContent='Yeni registerlar için saha önerisi kaydedildi. Kurulu registerların çarpanı değişmedi.';
    }catch(error){$('scaling-error').textContent=friendlyError(error).text;}finally{this.lock(false);}
  }
  async save(){if(this.saving)return;const ctx=this.ctx(),$=this.$;let started=false,saved=0;
    try{if(ctx.demo||!ctx.api)throw new Error('Canlı API gerekli.');await ctx.schemaReady;
      if(this.snapshot!==JSON.stringify([ctx.config.registers,ctx.config.tags]))throw new Error('Yapılandırma değişti. Ekranı kapatıp güncel listeden tekrar aç.');
      const changes=[...$('scaling-rows').querySelectorAll('[data-scale-id]')].filter(r=>r.querySelector('[data-scale-use]').checked).map(r=>({id:r.dataset.scaleId,factor:r.querySelector('[data-scale-factor]').value,unit:r.querySelector('[data-scale-unit]').value.trim()}));
      if(!changes.length)throw new Error('Değiştirmek istediğin registerların solundaki kutuları seç.');
      const operations=scalingOperations(this.ctx(),changes);this.lock(true);started=true;
      for(const op of operations){await ctx.api.update(op.collection,op.id,op.body,op.method);saved++;$('scaling-error').textContent=`Kaydedildi: ${saved}/${operations.length}`;}
      await this.saved();this.rows();$('scaling-error').textContent='Çarpan ve birimler kaydedildi. Collector’ın yeni örneğini bekle; eski API değerleri geriye dönük değiştirilmez.';
    }catch(error){$('scaling-error').textContent=friendlyError(error).text+(started?` ${saved} işlem doğrulandı. Kısmi kayıt olabilir; yeniden göndermeden önce ekranı kapatıp listeyi yenile.`:'');if(started)await this.saved();}
    finally{this.lock(false);if(started)$('scaling-submit').disabled=true;}
  }
}
