# ScadaWatt: sunucu, master ve kullanıcı dağıtımı

Bu rehber gönderdiğin localScada(4).zip kaynaklarına göre hazırlanmıştır. Linux sunucu ve Python çalıştırabilen Linux/Windows master varsayılmıştır. Bir PLC veya analizör kendi içinde Python çalıştıramıyorsa collector doğrudan ona yüklenemez; bir endüstriyel PC/gateway gerekir.

## Nereye ne konacak?

| Yer | Dosyalar | Bağlantı |
|---|---|---|
| Sunucu | api, database, config.py, gerekli diğer backend modülleri, PostgreSQL ve mevcut DB | API → PostgreSQL |
| Sunucu web kökü | yalnızca scadawatt-ui içindeki statik dosyalar | HTTPS kullanıcı → API |
| Master | collector klasörü, bağımlılıklar ve collector.json | Modbus cihazları → collector → HTTPS API |
| Kullanıcı | yalnızca tarayıcı | https://scada.example.com |

Collector’ın imports yapısı yalnızca collector modülleri, requests ve pymodbus kullanıyor; master’a api/database veya PostgreSQL parolası koymak gerekmez. Seri bağlantıda pyserial ve işletim sistemi port izinleri gerekir. collector klasörü /opt/scada-master/collector gibi bir üst dizinin altında durmalı; komut üst dizinde python -m collector.collector olmalıdır.

## Değiştirilecek bilgiler

| Bilgi | Değiştirilecek yer | Not |
|---|---|---|
| Master’ın API URL/token/timeout/worker/cihaz kapsamı | Root → Sistem Ayarları → Collector bilgileri → collector.json indir | Master’daki collector/collector.json içine koy; yeniden başlat |
| Cihaz IP/port/Unit/protokol/profil | Üst bar → Cihazlar / Modbus → cihazı düzenle | IP master’ın erişebildiği gerçek cihaz IP’sidir |
| FC03/04, PDU, veri tipi, register adedi, byte/word sırası | Register haritası ve ilgili register/okuma kurulumu sayfaları | Üreticinin register haritasından doğrula; 3xxxx başlığı otomatik PDU dönüşümü varsayma |
| Ölçek ve birim | Sistem Ayarları → Çarpanlar / birimler | DB’de tek kez uygulanır; aynı çarpanı arayüzde tekrar uygulama |
| Kesici komutu/geri bildirim | Node seç → gerçek Modbus kesici kontrolü | Gerçek cihaz için ayrı FC/adres/değer/sinyal eşleştirmesi gerekir |
| DB_HOST/PORT/NAME/USER/PASSWORD | Sunucuda deployment/api.env.example → /etc/scadawatt/api.env | Güncellenen database/database.py env değerini öncelikli okur; yoksa mevcut config.py kullanılır |
| API anahtar dosyası | SCADA_SECRET_FILE | Servis kullanıcısının okuyup yazabildiği kalıcı yol; mevcut anahtar dosyasını koru/taşı |
| Web alan adı, TLS dosyaları, web kökü | deployment/nginx.conf.example | İlgili gerçek yolları değiştir |
| UI/API adresi | Aynı origin için otomatik /api/v1 | Eski tarayıcıda kayıtlı 127.0.0.1 varsa root API bağlantısı ayarından düzelt; yeni origin temizdir |
| CORS | SCADA_CORS_ORIGINS | UI ayrı sunucuda/local çalışacaksa tam origin ekle; aynı sunucuda aynı origin tavsiye edilir |

Collector bilgileri ekranı uzak master’a doğrudan ayar yazmaz; ilk kurulum dosya aktarımı gerekir. Cihaz kapsamı boşsa tek master yeni aktif cihazları 5 saniyelik konfigürasyon döngüsünde algılar. Süre ekrandan değiştirilebilir. Birden fazla master’da çakışmayan ID listeleri gerekir; yeni cihazı ilgili master listesine ekleyip dosyayı yeniden aktarmalısın. Bu istemci filtresi güvenlik sınırı değildir. Mevcut API bütün masterlar için ortak collector anahtarı kullanır; master başına DB’de yetki/atama kaydı yoktur.

## Master kurulumu

1. collector klasörünü master’da bir üst dizine kopyala. Örn. /opt/scada-master/collector.
2. Üst dizinde python -m venv .venv oluştur, sanal ortamı etkinleştir ve python -m pip install -r collector/requirements.txt çalıştır. Master’ın Python/pymodbus sürümünü aynı sürümle test et; requirements şu anda pymodbus 3.11–4 aralığını kabul ediyor.
3. Root olarak Collector bilgileri bölümünde API adresini https://scada.example.com/api/v1 yap; master adını benzersiz seç. İlk ölçüm testinde komut yürütme kapalı bırak.
4. İndirilen collector.json dosyasını master’daki collector klasörüne koy. Dosya hassas makine anahtarı içerir; sadece collector servis kullanıcısı okuyabilsin. Linux örneği: chmod 600 collector/collector.json ve dosya sahibi servis kullanıcısı olsun.
5. Önce manuel python -m collector.collector ile dene. Ardından örnek systemd servisini yolları/kullanıcısı doğru olacak şekilde kur. Windows’ta aynı komutla doğruladıktan sonra görev zamanlayıcı/hizmet hesabında üst dizini ve Python yolunu belirt.
6. CYCLE good_register ve API DB ölçümlerini karşılaştır. Komut haritaları doğruysa komut yürütmeyi açıp dosyayı yeniden aktar ve master servisini yeniden başlat.

SCADA_* ortam değişkenleri JSON’dan önceliklidir. Eski SCADA_DEVICE_IDS/SCADA_API_URL tanımları varsa kaldır veya güncelle; aksi halde indirdiğin ayarı ezer. SCADA_COLLECTOR_CONFIG farklı ayar dosyası yolu seçer. Varsayılan dosya collector/settings.py ile aynı dizindeki collector.json'dur. Dosya yoksa önceki ortam değişkeni yöntemi korunur. Dosya bir başlangıç ayarıdır, canlı yeniden yüklenmez.

SCADA_MAX_GAP varsayılan yeni pakette 0 seçilir: tanımsız adres boşlukları üzerinden blok okuma yapılmaz. Bitişik registerlar yine bloklara gruplanır. SCADA_AUTO_TAG=0; tag’ler arayüzde kurulur, master kendiliğinden eksik tag oluşturmaz.

## Sunucu kurulumu

1. Mevcut DB’yi pg_dump/restore ile sunucuya taşı; yeni boş DB sadece tablolar oluşturularak eski saha/ölçüm kaydı korunmuş sayılmaz. scada_user, scada_user_site, scada_workspace, komut_log ve kontrol haritaları dahil mevcut şemayı/kayıtları koru.
2. Projeyi /opt/scadawatt içine koy. Python sanal ortamı oluştur; requirements.txt kur. Linux master ayrı sanal ortama sahiptir.
3. scadawatt adlı ayrı servis kullanıcısı oluştur. /etc/scadawatt/api.env dosyasına DB bilgilerini ve kalıcı secret yolunu yaz; dosya izinleri servis kullanıcısı ile sınırlandırılsın. Bu env dosyasını web köküne koyma. config.py dosyası hâlâ import edildiğinden sunucuda bulunmalı.
4. Mevcut sunucunun api-secrets.json dosyası anahtarları korur. API kullanıcısı değişince Path.home farklı olabilir; SCADA_SECRET_FILE ile yol sabitlenmezse yeni anahtarlar oluşur ve collector/eski oturumlar çalışmaz.
5. API’yi test için python -m uvicorn api.api:app --host 127.0.0.1 --port 8000 çalıştır. Nginx aynı sunucudaysa loopback DOĞRUDUR: dış istemciler Nginx HTTPS üzerinden ulaşır. Nginx yokken uzak erişim için --host 0.0.0.0 ve kısıtlı firewall gerekir; bunu internet yayın yöntemi olarak kullanma.
6. scadawatt-api.service örneğini servis hesabı/yollarına göre kur. Nginx örneğinde domain ve geçerli TLS sertifikası dosyalarını değiştir, nginx -t ile doğrula, sonra etkinleştir. Uvicorn yalnızca yerel Nginx’ten proxy başlıklarına güvenir; forwarded-allow-ips '*' kullanma.
7. Nginx web kökü sadece scadawatt-ui olmalıdır. collector, api, config.py, DB yedekleri ve secrets üst proje dizininde kalır; statik web köküne kopyalanmaz.
8. Dışarıya yalnızca HTTPS erişimi aç. PostgreSQL portu genel internete açılmamalı. Master–cihaz Modbus trafiği saha ağı/VPN’de kalmalı. Modbus cihazın portunu internete yönlendirme. Master HTTPS sunucuya çıkış yapar; sunucunun cihaza doğrudan Modbus erişimi gerekmez.

Nginx örneği /api/... yolunu değiştirmeden proxy eder; API yolu /api/v1 kalır. Web arayüzü sunucu domaininin kökünde yayınlanır. Browser ile API aynı origin olduğunda ayrı CORS izni gerekmese de local test ve farklı origin için env listesini doğru ayarla. HTTPS UI → HTTP API tarayıcı mixed-content engeline takılır; API’yi de HTTPS proxy ile kullan.

Yeni sunucuda hiç root yoksa public domain üzerinden bootstrap bekleme: mevcut koruma sadece doğrudan loopback’e izin verir. Mevcut kullanıcı DB’sini taşımak en kolay yoldur. Yeni kurulumda sunucu üzerinde yerel 127.0.0.1:8000 API’ye doğrudan auth/bootstrap isteği veya yerel arayüz kullan; proxy üzerinden bootstrap açılmaz. Şifreyi komut geçmişine yazma.

## Cihazı doğrulama sırası

Master’dan cihaz IP/port erişimi → Unit → FC → gerçek PDU adresi → Float32/64 word/byte sırası → cihaz ekranındaki değer/ölçek → tag kalite ve zaman → UI ölçümü. Gerçek kesici haritası doğrulanmadan komut gönderme. Mevcut yazma adaptörü FC05/FC06; durum FC01/02/03/04 destekler. Darbeli komut/bit maskesi/çok register/RTU komutu/IEC61850 için ek adaptör gerekir; yalnız IP değiştirerek her cihaz desteklenmez.

## Mevcut sınırlar

Collector çevrimdışı ölçümleri kalıcı diskte kuyruklamıyor; API kapalıyken alınan ölçümlerde kayıp olabilir. Komut sonucu bellekte tekrar raporlanır, master kapanınca bellek kaybolur; belirsiz komutlar kendiliğinden tekrar yazılmaz. NTP ile sunucu ve master saatleri eşit tutulmalı. Yapılandırma GUI’si master’ın çalıştığını kanıtlayan heartbeat ekranı değildir; bu sürüm master durum kaydı/uzaktan servis yeniden başlatma eklemez. Tek ortak machine token ve istemci ID filtresi çok master için sunucu tarafında güçlü izolasyon sağlamaz. Fiziksel PLC, işletim sistemi servisi ve gerçek TLS/domain ortamı burada test edilmedi.

## Doğrulama ve araştırma kaynakları

Kaynak kodda collector’ın API istemcisi, import bağımlılıkları, otomatik konfigürasyon yenilemesi, komut workerı, server secret dosyası, bootstrap koruması, CORS ve DB bağlantısı incelendi. Uvicorn deployment/settings ve Nginx proxy_pass/proxy_set_header resmi dokümanları referans alındı:
https://www.uvicorn.org/deployment/
https://www.uvicorn.org/settings/
https://nginx.org/en/docs/http/ngx_http_proxy_module.html

Bu şablonlar sunucunda otomatik uygulanmadı; domain, sertifika, servis hesabı ve gerçek master donanımı bilinmediği için örnek yapılandırmadır.
