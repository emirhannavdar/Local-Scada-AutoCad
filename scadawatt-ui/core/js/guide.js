import {nameOf,escapeHtml as esc,sampleState} from './model.js';
import {devicePipeline} from './configuration.js';
const eq=(a,b)=>String(a)===String(b);
export const GUIDE_STEPS=[
  {title:'Sahanı oluştur',entity:'sites',text:'Saha, elektrik tesisinin köküdür. Ad, benzersiz kod, konum ve kurulu güç gir. Sol listeden çalışacağın sahayı seç.',action:'Saha ekle',tip:'Saha çarpanı yeni registerlar için öneridir; mevcut ölçümleri ikinci kez çarpmaz.'},
  {title:'Tek hat bağlantılarını tanımla',entity:'dm',optional:true,text:'Tesiste varsa köşk/DM → TM/hücre → trafo → dağıtım panosu sırasıyla ekle. Üst bağlantıyı adından seç. Cihazı doğrudan sahaya da bağlayabilirsin.',action:'Köşk / DM ekle',tip:'Olmayan fiziksel düğümleri eklemek zorunda değilsin. Şema yalnızca kaydettiğin ilişkileri çizer.'},
  {title:'Cihaz modelinin profilini seç',entity:'profiles',text:'Profil, aynı marka/modeldeki cihazların ortak register haritasıdır. Marka, model, cihaz tipi ve sürümle tanımla. Hazır profil varsa yeniden oluşturma.',action:'Profil ekle',tip:'Profil haritasında değişiklik yapmak kurulu registerları kendiliğinden güncellemez; aynı profili kullanan diğer cihazları da kontrol et.'},
  {title:'Cihazı sahaya bağla',entity:'devices',text:'Anlaşılır bir cihaz adı yaz, sahayı ve üst düğümü seç. Profili, gerçek IP, Modbus portu ve Unit ID’yi gir. API portu ile Modbus portu farklıdır.',action:'Cihaz ekle',tip:'Aynı bilgisayardaki örnek simülatör: 127.0.0.1:5420, Unit 1. Gerçek cihazda kendi bağlantı bilgilerini kullan.'},
  {title:'Ölçüm tanımlarını hazırla',map:true,text:'Sözlük ölçümün anlamını tanımlar: ad, birim, veri tipi ve kayıt politikası. Çok sayıda ölçüm için Register haritası → JSON ile toplu ekle seçeneği sözlük ve haritayı birlikte oluşturur.',action:'Toplu ekleme ekranına git',tip:'Tek ölçüm için Sözlük tanımı ekle kullanılabilir. JSON yüklerken mevcut sinyaller adlarıyla tekrar kullanılır; aynı kayıtlar çoğaltılmaz.'},
  {title:'Register adreslerini eşleştir',map:true,text:'Harita ölçümün cihazdaki PDU adresi, FC03/FC04, register adedi ve byte/word sırasını tanımlar. JSON dosyasını seç veya yapıştır; profili ve yeni sinyaller için ortak politikayı seçip önizle. Uygunsa topluca kaydet.',action:'Register haritasını aç',tip:'Float32=2 ve Float64=4 register otomatik seçilir. JSON ile sözlük ve haritayı birlikte oluşturduysan bu adımda sonuçları kontrol et; tekrar girmen gerekmez.'},
  {title:'Okuma zincirini kur',setup:true,text:'Seçili cihazın profil haritasından eksik okuma grubu, register ve tag bağlantılarını hazırlat. Gönderilecek istekleri inceleyip Kaydet’e bas.',action:'Profilden okuma kur',tip:'Okuma grubu hızı ve FC’yi, register adres/tipi, tag ise API’deki ölçüm kimliğini belirler. Eksik zorunlu alanlar kaydetmeden önce gösterilir.'},
  {title:'Çarpanları ve birimleri doğrula',scaling:true,optional:true,text:'Ham değerin mühendislik birimine dönüşümünü register bazında ayarla. Önizleme, eski API değeri üzerinden tahmin verir; yeni gerçek ölçümü collector üretir.',action:'Çarpanlar ekranını aç',tip:'W → kW için 0.001; ancak CT/PT oranı varsa toplam çarpanı cihazın gerçek hesabına göre gir. Tag ölçeği ayrıca uygulanmaz.'},
  {title:'Canlı ölçümü doğrula',verify:true,text:'Tek hat şemasında cihazı seç. Veri zincirinde grup/register/tag ve API ölçümlerini karşılaştır. Kalite GOOD ve zaman güncelse akım/güç akışı gösterilir.',action:'Tek hat şemasına dön',tip:'Sıfır veya eksik değeri başka sayıyla doldurma. API ve collector tanılamasını kullan; yeşil animasyon fiziksel kesici konumunu tek başına kanıtlamaz.'}
];
export function guideStatus(ctx,index){
  const {config,selectedSite,selectedDevice}=ctx,d=config.devices.find(d=>eq(d.id,selectedDevice));
  const profile=d?.profil_id??config.profiles[0]?.id;
  const checks=[config.sites.some(s=>eq(s.id,selectedSite)),true,config.profiles.length>0,!!d,config.signals.length>0,config.profileRegisters.some(p=>eq(p.profil_id??p.profile_id,profile)),!!d&&devicePipeline(d,config,ctx.measurements,ctx.loaded).usableTags.length>0,true,!!d&&devicePipeline(d,config,ctx.measurements,ctx.loaded).samples.some(s=>sampleState(s,config,ctx.settings??{},Date.now(),ctx.apiOnline??true)==='online')];
  return !!checks[index];
}
export class SetupGuide{
  constructor(getContext,actions){this.ctx=getContext;this.actions=actions;this.index=0;const $=id=>document.getElementById(id);this.$=$;
    $('open-guide').onclick=()=>this.open();$('guide-resume').onclick=()=>this.open();$('guide-prev').onclick=()=>{this.index=Math.max(0,this.index-1);this.render();};
    $('guide-next').onclick=()=>{if(this.index===GUIDE_STEPS.length-1){$('guide-dialog').close();this.actions.diagram();}else{this.index++;this.render();}};
    $('guide-action').onclick=()=>this.act();
  }
  open(){this.render();this.$('guide-dialog').showModal();}
  render(){const ctx=this.ctx(),step=GUIDE_STEPS[this.index],done=guideStatus(ctx,this.index),$=this.$;
    $('guide-progress').textContent=`ADIM ${this.index+1} / ${GUIDE_STEPS.length}`;$('guide-title').textContent=step.title;$('guide-text').textContent=step.text;$('guide-tip').textContent=step.tip;
    $('guide-target').textContent=`Saha: ${nameOf(ctx.config.sites.find(s=>eq(s.id,ctx.selectedSite))||{})} · Cihaz: ${nameOf(ctx.config.devices.find(d=>eq(d.id,ctx.selectedDevice))||{})}`;
    $('guide-status').textContent=step.optional?'Bu adım isteğe bağlı.':done?'Bu adım için kayıt bulundu. Bilgileri doğrulayıp ilerleyebilirsin.':'Bu adımı tamamla veya mevcut kaydı seçip yardımcının ekranını yeniden aç.';
    $('guide-action').textContent=step.action;$('guide-prev').disabled=this.index===0;$('guide-next').disabled=!done&&!step.optional;$('guide-next').textContent=this.index===GUIDE_STEPS.length-1?'Bitir':'İlerle →';
    $('guide-outline').innerHTML=GUIDE_STEPS.map((s,i)=>`<span class="${i===this.index?'active':''}">${i+1}. ${esc(s.title)}</span>`).join('');
  }
  act(){const step=GUIDE_STEPS[this.index];this.$('guide-dialog').close();this.$('guide-resume').classList.remove('hidden');
    if(step.map)this.actions.map();else if(step.setup)this.actions.setup();else if(step.scaling)this.actions.scaling();else if(step.verify)this.actions.diagram();else this.actions.create(step.entity);
  }
}
