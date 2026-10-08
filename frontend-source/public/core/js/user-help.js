export function friendlyError(error){
  const message=String(error?.message??error),status=Number(error?.status||0);let solution;
  if(status===401||status===403)solution='API bağlantısı ekranından kullanıcı adı ve şifreyle giriş yap. Hesap yoksa API bilgisayarında İlk hesabı oluştur seçeneğini kullan. Bu işlem için hesabının yetkisini kontrol et.';
  else if(/timeout|zaman aşımı|iptal/i.test(message))solution='Listeyi yenileyip kaydın oluşup oluşmadığını kontrol et. API ve veritabanı yanıt verdiğinde yeniden dene; aynı kaydı hemen tekrar gönderme.';
  else if(/CORS|ulaşılamadı|Failed to fetch/i.test(message))solution='API çalışıyor mu ve adresi doğru mu kontrol et. Backend CORS listesinde bu arayüzün 127.0.0.1:5500 adresi bulunmalı.';
  else if(/endpoint|şema|openapi/i.test(message))solution='API tanılamasında /openapi.json sonucunu kontrol et. Doğru API ana adresini seç ve Yenile’ye bas. Çalışan backend ile düzenlediğin dosyanın aynı proje olduğundan emin ol.';
  else if(/unique|duplicate|zaten|yinelen|23505/i.test(message))solution='Kayıt listesinde aynı kod veya adı ara. Yeni bir kopya eklemek yerine mevcut kaydı düzenle ya da benzersiz ad kullan.';
  else if(/enum|seçenek|invalid input value/i.test(message))solution='Açılır listedeki izinli seçeneği seç. Özel bir değer gerekiyorsa veritabanındaki geçerli seçenekleri doğrula; rastgele değer yazma.';
  else if(/foreign|referans|bulunamadı|bağlantısı|23503/i.test(message))solution='Önce bağlı kayıtları oluştur: saha → profil ve sinyal → cihaz → profil registerı → okuma grubu → register → tag. Cihaz ve registerın aynı kapsama ait olduğunu kontrol et.';
  else if(/zorunlu|boş|required|Field required/i.test(message))solution='Yıldızlı alanları tamamla. Bir referans listesi boşsa Kurulum yardımcısı ile o kaydı önce oluştur.';
  else if(/FLOAT|register|FC03|FC04|125|PDU/i.test(message))solution='Üretici register haritasını karşılaştır: doğru FC03/FC04, PDU adresi ve veri tipi seç. Float32 için 2, Float64 için 4 register gerekir; bir okuma bloğu en çok 125 olabilir.';
  else if(/minimum|maksimum|sayı|negatif|sınır|port|IP|Unit/i.test(message))solution='Sayısal alanların aralığını kontrol et. Port 1–65535, Unit ID 1–247; minimum değer maksimumdan büyük olmamalı.';
  else solution='Alanları ve seçili cihazı kontrol et. Listeyi yenile; sorun sürerse alttaki API tanılamasındaki başarısız isteği incele.';
  return {message,solution,text:`${message}\nÇözüm: ${solution}`};
}
export function formSection(entity,key){
  if(['carpan','olcek','varsayilan_carpan','birim','min_deger','max_deger','offset_degeri','bit_index'].includes(key))return 'Ölçüm, birim ve çarpan';
  if(['register_adresi','baslangic_adresi','bitis_adresi','register_sayisi','function_code','veri_tipi','byte_order','word_order','okuma_periyodu_ms','maksimum_register'].includes(key))return 'Register haritası ve okuma';
  if(['cihaz_id','device_id','profil_id','profile_id','profil_register_id','sinyal_sozlugu_id','register_id','okuma_grubu_id','saha_id','dm_id','tm_id','trafo_id','adp_id','seri_hat_id'].includes(key))return 'Bağlı kayıtlar';
  if(['ip','port','slave_id','protokol','protocol'].includes(key))return 'Cihaz iletişimi';
  if(['tip','okuma_sinifi','arsiv_kurali','alarm_sinifi','deadband','bakim_modu','durum'].includes(key))return 'İşletme ve kayıt seçenekleri';
  return 'Temel bilgiler';
}
export function fieldExplanation(entity,key){
  const hints={
    name:'Listelerde göreceğin anlaşılır ad. Örnek: Ana enerji analizörü.',
    sinyal_adi:'Ölçümün sabit anahtarı. Örnek: i_l1 (akım), p_tot (toplam aktif güç).',
    tag_adi:'Bu cihazdaki ölçümün benzersiz adı. Örnek: ostim_analizor_i_l1.',
    sinyal_sozlugu_id:'Gerilim, akım veya güç gibi ölçüm tanımını adından seç.',
    profil_register_id:'Seçili cihazın modeline ait adres/tip tarifini seç; alanlar otomatik doldurulur.',
    register_id:'Ölçümün okunacağı register. Yalnızca seçili cihazın kayıtları gösterilir.',
    okuma_grubu_id:'Aynı cihaz ve FC ile çalışan okuma grubu. Gruplar okuma hızını belirler.',
    profil_id:'Cihazın marka/model register haritası. Yoksa yardımcının Profil adımında oluştur.',
    profile_id:'Haritayı hangi cihaz modeline kaydedeceğini seç; bir profil birden fazla cihazda kullanılabilir.',
    baslangic_adresi:'Simülatör/üretici haritasındaki PDU adresi. 30000 gibi gösterim adreslerinden otomatik 30001 çıkarılmaz.',
    register_adresi:'Üretici haritasından doğrulanan PDU adresi. Float32 iki ardışık 16 bit adres kullanır.',
    function_code:'FC03 holding, FC04 input register okur. Haritada belirtilen fonksiyonu seç.',
    veri_tipi:'Verinin biçimi. Seçtiğinde register sayısı önerilir: Float32=2, Float64=4, UInt16=1.',
    min_deger:'Beklenen mühendislik alt sınırı; mevcut collector değeri bu sınıra kırpmaz.',
    max_deger:'Beklenen mühendislik üst sınırı; örnekleri değil cihazın gerçek aralığını kullan.',
    carpan:'Uygulanan çarpan: ham çözülen değer × bu sayı. Örnek: W → kW için 0.001.',
    varsayilan_carpan:'Yeni register formuna öneri olarak gelir; mevcut ölçümleri tek başına değiştirmez.',
    olcek:entity==='profileRegisters'?'Yeni register oluşturulurken önerilen çarpan. Kurulu registerları değiştirmek için Çarpanlar ekranını kullan.':'Mevcut collector tag ölçeğini tekrar çarpmaz. Uygulanan ölçek register.carpan alanıdır.',
    offset_degeri:'Mevcut decoder offset uygulamaz. Sıfır dışı dönüşüm için backend desteği gerekir.',
    bit_index:'Mevcut BOOL decoder registerın tamamını değerlendirir; tek bit seçimi uygulamaz.',
    tip:'API şeması seçenek sunmuyorsa gerçek DB tag tipi yazılmalı; başka bir sinyalden rastgele kopyalama.',
    arsiv_kurali:'Ölçümün arşivleme politikası. API/DB tarafından desteklenen değeri seç.',
    okuma_sinifi:'Backend tarafından tanımlı okuma sınıfı; register periyodu okuma grubunda ayarlanır.',
    alarm_sinifi:'Backend’de tanımlı alarm sınıfı. Bilinmeyen enum değeri API tarafından reddedilir.'
  };return hints[key]||'';
}
