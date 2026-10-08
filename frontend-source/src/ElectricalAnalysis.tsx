import { useEffect, useState, useRef } from "react"
import type { Snapshot } from "./workspace"
import {
  channels,
  reading,
  deviation,
  coherent,
  automatic,
  factor,
} from "./electrical"
const fmt = (n: number | null) =>
  n === null ? "—" : n.toLocaleString("tr-TR", { maximumFractionDigits: 2 })
export default function ElectricalAnalysis({
  data,
  onClose,
}: {
  data: Snapshot | null
  onClose: () => void
}) {
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    return () => previous?.focus()
  }, [])
  const sites = new Map(data?.siteOf || []),
    devices = (data?.nodes || []).filter(
      (n) =>
        n.type === "DEVICE" &&
        String(sites.get(n.key)) === String(data?.selectedSite),
    )
  const [device, setDevice] = useState(""),
    [mapping, setMapping] = useState<Record<string, string | undefined>>({}),
    [age, setAge] = useState(30),
    [rated, setRated] = useState(""),
    [now, setNow] = useState(Date.now()),
    [points, setPoints] = useState<{ time: number; p: number | null }[]>([])
  const id = devices.some((d) => String(d.id) === device)
    ? device
    : String(devices[0]?.id || "")
  const rows = (data?.measurements || []).filter(
    (r) => String(r.device_id) === id,
  )
  useEffect(() => {
    setMapping({})
    setRated("")
    setPoints([])
  }, [id])
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const result = channels.map(([key, label, unit, aliases]) => {
    const tag = mapping[key] ?? automatic(rows, aliases),
      row = rows.find((r) => String(r.tag_id) === tag)
    return {
      key,
      label,
      unit,
      tag,
      row,
      ...reading(
        data?.apiOnline || data?.demo ? row : undefined,
        unit,
        now,
        age,
      ),
    }
  })
  const get = (k: string) => result.find((r) => r.key === k)!
  const phase = (prefix: string) => {
    const a = [1, 2, 3].map((n) => get(prefix + n))
    return coherent(
      a.map((x) => x.row),
      Math.min(age, 5),
    )
      ? deviation(a.map((x) => x.value))
      : null
  }
  const u = phase("u"),
    i = phase("i"),
    power = get("p"),
    s = get("s"),
    capacity = Number(rated),
    load =
      capacity > 0 && Number.isFinite(capacity) && s.value !== null
        ? (100 * s.value) / capacity
        : null
  useEffect(() => {
    const time = Date.parse(power.row?.timestamp || "")
    if (!Number.isFinite(time)) return
    setPoints((old) => {
      if (old.length && old[old.length - 1].time >= time) return old
      return [...old, { time, p: power.value }].slice(-180)
    })
  }, [power.row?.timestamp, power.value, id])
  const notes: string[] = []
  if (u !== null)
    notes.push(
      `Gerilim faz sapması %${fmt(u)}. Maksimum ortalamadan sapma yöntemi; negatif bileşen VUF değildir.`,
    )
  if (i !== null)
    notes.push(
      `Akım faz sapması %${fmt(i)}. Yük dağılımını üç faz grafiğiyle inceleyin.`,
    )
  if (load !== null)
    notes.push(
      `Girilen ${fmt(capacity)} kVA anma gücüne göre yüklenme %${fmt(load)}.${
        load > 100
          ? " Anma gücü aşılıyor; ölçüm eşlemesini ve yükü inceleyin."
          : ""
      }`,
    )
  if (result.some((r) => r.tag && r.value === null))
    notes.push(
      "Bazı eşlenmiş ölçümler hesaplamaya uygun değil. Kalite, zaman ve birim bilgisini kontrol edin.",
    )
  const max = Math.max(1, ...points.map((x) => Math.abs(x.p ?? 0))),
    start = points[0]?.time || 0,
    end = points.at(-1)?.time || 0
  function download() {
    const report = {
      generated_at: new Date().toISOString(),
      device_id: id,
      device_name: devices.find((d) => String(d.id) === id)?.name,
      demo: !!data?.demo,
      max_age_seconds: age,
      phase_max_skew_seconds: Math.min(age, 5),
      rated_kva: capacity > 0 ? capacity : null,
      voltage_deviation_percent: u,
      current_deviation_percent: i,
      loading_percent: load,
      measurements: result.map(({ row, ...r }) => ({
        ...r,
        timestamp: row?.timestamp,
        signal_name: row?.signal_name,
        quality: row?.quality,
      })),
      findings: notes,
      session_power: points,
    }
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    )
    const a = document.createElement("a")
    a.href = url
    a.download = `elektriksel-analiz-${id}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <div
      ref={panel}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation()
          onClose()
        }
        if (e.key === "Tab") {
          const items = Array.from(
            panel.current?.querySelectorAll<HTMLElement>(
              "button,select,input,summary",
            ) || [],
          ).filter((el) => el.getClientRects().length > 0)
          const first = items[0],
            last = items.at(-1)
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault()
            last?.focus()
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault()
            first?.focus()
          }
        }
      }}
      className="analysis-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Elektriksel analiz"
    >
      <header>
        <div>
          <small>
            SCADAWATT · {data?.demo ? "ÖRNEK VERİ" : "ÖLÇÜM ANALİZİ"}
          </small>
          <h2>Elektriksel analiz</h2>
        </div>
        <button autoFocus className="outline-button" onClick={onClose}>
          Şemaya dön ×
        </button>
      </header>
      <div className="analysis-body">
        <div className="analysis-toolbar">
          <label className="field">
            <span>Ölçüm cihazı</span>
            <select
              value={id}
              onChange={(e) => {
                setDevice(e.target.value)
                setMapping({})
                setRated("")
                setPoints([])
              }}
            >
              {!devices.length && <option value="">Bu sahada cihaz yok</option>}
              {devices.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · #{d.id}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Verinin azami yaşı</span>
            <select
              value={age}
              onChange={(e) => setAge(Number(e.target.value))}
            >
              {[5, 15, 30, 60, 300].map((n) => (
                <option key={n} value={n}>
                  {n} saniye
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Trafo anma gücü · kVA (isteğe bağlı)</span>
            <input
              type="number"
              min="0"
              placeholder="Etiket değeri"
              value={rated}
              onChange={(e) => setRated(e.target.value)}
            />
          </label>
          <button className="outline-button" onClick={download}>
            Analiz JSON indir
          </button>
        </div>
        <p>
          Yalnızca GOOD ve güncel ölçümler kullanılır. Faz hesaplarında zaman
          farkı en fazla {Math.min(age, 5)} saniyedir. Eşlemeler ve anma gücü bu
          ekran oturumu içindir.
        </p>
        <div className="analysis-cards">
          {["p", "q", "s", "pf", "f"].map((k) => {
            const r = get(k)
            return (
              <article key={k}>
                <small>{r.label}</small>
                <strong>
                  {fmt(r.value)} <small>{r.unit}</small>
                </strong>
                <span>{r.reason}</span>
              </article>
            )
          })}
          <article>
            <small>Trafo yüklenmesi</small>
            <strong>{fmt(load)} %</strong>
            <span>Ölçülen kVA / girilen anma gücü</span>
          </article>
        </div>
        <div className="analysis-columns">
          {(["u", "i"] as const).map((prefix) => {
            const phaseRows = [1, 2, 3].map((n) => get(prefix + n)),
              peak = Math.max(1, ...phaseRows.map((r) => r.value || 0))
            return (
              <section key={prefix}>
                <h3>{prefix === "u" ? "Faz gerilimleri" : "Faz akımları"}</h3>
                {phaseRows.map((r, n) => (
                  <div className="phase-row" key={r.key}>
                    <b>L{n + 1}</b>
                    <meter
                      aria-label={r.label}
                      min={0}
                      max={peak}
                      value={r.value ?? 0}
                    />
                    <span>
                      {fmt(r.value)} {r.unit}
                    </span>
                  </div>
                ))}
                <p>
                  Maksimum ortalamadan sapma:{" "}
                  <b>{fmt(prefix === "u" ? u : i)} %</b>
                </p>
              </section>
            )
          })}
        </div>
        <section className="analysis-section">
          <h3>Aktif güç · bu oturumun son 180 örneği</h3>
          <p>
            Geçmiş arşivi değildir. Ekran kapatılınca kayıt temizlenir. Grafik
            aralığı ±{fmt(max)} kW.
          </p>
          {points.length < 2 ? (
            <p>En az iki farklı zaman damgalı örnek bekleniyor.</p>
          ) : (
            <svg
              viewBox="0 0 800 180"
              role="img"
              aria-label="Oturum aktif güç trendi"
            >
              <line x1="0" y1="90" x2="800" y2="90" stroke="#526b65" />
              {points.slice(1).map((p, index) => {
                const prev = points[index]
                if (
                  p.p === null ||
                  prev.p === null ||
                  p.time - prev.time > age * 1000 ||
                  p.time <= prev.time
                )
                  return null
                const x = (t: number) =>
                  (800 * (t - start)) / Math.max(1, end - start)
                return (
                  <line
                    key={p.time}
                    x1={x(prev.time)}
                    y1={90 - (prev.p / max) * 80}
                    x2={x(p.time)}
                    y2={90 - (p.p / max) * 80}
                    stroke="#45d6b0"
                    strokeWidth="2"
                  />
                )
              })}
            </svg>
          )}
          <small>
            {start ? new Date(start).toLocaleTimeString("tr-TR") : ""} —{" "}
            {end ? new Date(end).toLocaleTimeString("tr-TR") : ""}
          </small>
        </section>
        <section className="analysis-section">
          <h3>İnceleme notları</h3>
          {notes.length ? (
            notes.map((n) => <p key={n}>{n}</p>)
          ) : (
            <p>
              Analiz için güncel sinyalleri eşleştirin. Eksik veriden arıza
              sonucu üretilmez.
            </p>
          )}
        </section>
        <details className="analysis-section">
          <summary>Sinyal eşleştirme ve ölçüm kanıtları</summary>
          <p>
            Otomatik eşleştirme yalnızca tek bir bilinen sinyal adı varsa
            yapılır. Doğru toplam ve faz kanallarını cihaz dokümanına göre
            seçin.
          </p>
          {result.map((r) => (
            <div className="analysis-mapping" key={r.key}>
              <label className="field">
                <span>
                  {r.label} · {r.unit || "birimsiz"}
                </span>
                <select
                  value={mapping[r.key] ?? "auto"}
                  onChange={(e) => {
                    setPoints([])
                    setMapping((m) => ({
                      ...m,
                      [r.key]:
                        e.target.value === "auto" ? undefined : e.target.value,
                    }))
                  }}
                >
                  <option value="auto">Otomatik</option>
                  <option value="">Kullanma</option>
                  {rows
                    .filter((m) => factor(m.unit || "", r.unit) !== undefined)
                    .map((m) => (
                      <option key={m.tag_id} value={String(m.tag_id)}>
                        {m.signal_name} · Tag {m.tag_id} ·{" "}
                        {m.unit || "birimsiz"}
                      </option>
                    ))}
                </select>
              </label>
              <span>
                {fmt(r.value)} {r.unit} · {r.reason}
                <small>
                  {r.row
                    ? `${r.row.signal_name} · Tag ${r.row.tag_id} · ${r.row.timestamp || "Zaman yok"}`
                    : "Eşleme yok"}
                </small>
              </span>
            </div>
          ))}
        </details>
      </div>
    </div>
  )
}
