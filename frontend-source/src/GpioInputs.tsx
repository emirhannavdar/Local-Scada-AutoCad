import { useEffect, useState, useRef } from "react"
import { parsePins } from "./collector-config"
import type { Row } from "./workspace"
const pins = [0, 5, 6, 7, 1, 12, 13, 16, 26, 24]
export default function GpioInputs({
  deviceId,
  rpc,
  readOnly,
}: {
  deviceId: number
  rpc: (p: string, m?: string, b?: Row) => Promise<any>
  readOnly: boolean
}) {
  const [watching, setWatching] = useState(false),
    [events, setEvents] = useState<string[]>([])
  const previous = useRef(new Map<string, { value: number; time: string }>())

  const [rows, setRows] = useState<Row[]>([]),
    [worker, setWorker] = useState("master-01"),
    [pinList, setPins] = useState(pins.join(",")),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!watching) return
    const fresh = new Map<string, { value: number; time: string }>()
    const changes: string[] = []
    for (const r of rows) {
      const t = Date.parse(r.sampled_at || "")
      if (
        !r.enabled ||
        r.quality !== "GOOD" ||
        ![0, 1].includes(r.value) ||
        !Number.isFinite(t) ||
        Date.now() - t > 30000 ||
        t > Date.now() + 5000
      )
        continue
      const key = `${r.worker}:${r.pin}`,
        old = previous.current.get(key)
      fresh.set(key, { value: r.value, time: r.sampled_at })
      if (old && old.value !== r.value && t > Date.parse(old.time))
        changes.push(
          `${new Date(r.sampled_at).toLocaleTimeString("tr-TR")} · ${r.worker} · BCM ${r.pin}: ${old.value} → ${r.value}`,
        )
    }
    previous.current = fresh
    if (changes.length) setEvents((e) => [...changes, ...e].slice(0, 100))
  }, [rows, watching])
  useEffect(() => {
    let alive = true
    const refresh = async () => {
      try {
        const r = await rpc("gpio-inputs/channels")
        if (alive) setRows(r.filter((x: Row) => x.device_id === deviceId))
      } catch (e) {
        if (alive) setMessage((e as Error).message)
      }
    }
    void refresh()
    const t = setInterval(refresh, 2000)
    return () => {
      alive = false
      clearInterval(t)
    }
  }, [deviceId])
  async function save() {
    setBusy(true)
    try {
      const list = parsePins(pinList)
      if (!/^\S{1,100}$/.test(worker.trim()))
        throw Error("Master adı 1–100 karakter olmalı, boşluk içermemeli.")
      await rpc("gpio-inputs/channels", "POST", {
        rows: list.map((p) => ({
          device_id: deviceId,
          worker: worker.trim(),
          pin: Number(p),
          signal: `gpio_${p}`,
          enabled: true,
        })),
      })
      setMessage(
        "Girişler kaydedildi. Collector izin listesini ve giriş okumayı etkinleştir.",
      )
      setRows(
        (await rpc("gpio-inputs/channels")).filter(
          (x: Row) => x.device_id === deviceId,
        ),
      )
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function toggle(r: Row) {
    setBusy(true)
    try {
      await rpc("gpio-inputs/channels", "POST", {
        rows: [
          {
            device_id: r.device_id,
            worker: r.worker,
            pin: r.pin,
            signal: r.signal,
            enabled: !r.enabled,
          },
        ],
      })
      setRows(
        (await rpc("gpio-inputs/channels")).filter(
          (x: Row) => x.device_id === deviceId,
        ),
      )
    } catch (e) {
      setMessage((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <details className="control-config">
      <summary>Dijital girişler · GPIO</summary>
      <p>
        Salt okuma · BOOL · HIGH/LOW. Pin yönü ve direnç ayarı değişmez. HIGH,
        kesicinin kapalı olduğunu tek başına doğrulamaz.
      </p>
      {!readOnly && (
        <fieldset disabled={busy}>
          <label className="field">
            <span>Master adı</span>
            <input value={worker} onChange={(e) => setWorker(e.target.value)} />
          </label>
          <label className="field">
            <span>Eklenecek giriş BCM pinleri · virgülle ayır</span>
            <input value={pinList} onChange={(e) => setPins(e.target.value)} />
          </label>
          <button className="outline-button" onClick={() => void save()}>
            Giriş kanallarını ekle / etkinleştir
          </button>
          <p>
            Bu işlem mevcut kanalları silmez. Collector giriş izin listesinde de
            aynı pinler bulunmalı. BCM 0/1 yalnızca okunur. Çıkış listesine
            ekleme. Giriş olmayan pinlerde değer gösterilmez.
          </p>
        </fieldset>
      )}
      <div className="gpio-observation">
        <b>Giriş değişimlerini izle</b>
        <p>
          Yalnızca API’de okunan değişimler kaydedilir; kısa darbeler iki okuma
          arasında kaçabilir. Bu kayıt fiziksel klemens eşlemesini tek başına
          doğrulamaz.
        </p>
        <button
          className="outline-button"
          onClick={() => {
            previous.current.clear()
            if (!watching) setEvents([])
            setWatching(!watching)
          }}
        >
          {watching ? "İzlemeyi durdur" : "Yeni izleme başlat"}
        </button>
        <p>
          {watching
            ? "İzleniyor · başlangıç seviyeleri referans alınır"
            : "İzleme durdu"}
        </p>
        <ol>
          {events.map((e, n) => (
            <li key={n}>{e}</li>
          ))}
        </ol>
        {!events.length && <small>Henüz seviye değişimi kaydedilmedi.</small>}
      </div>
      <div className="gpio-input-list">
        {rows.map((r) => (
          <article key={r.id}>
            <strong>
              {r.signal} {!readOnly && `· BCM ${r.pin}`}
            </strong>
            <span>
              {!r.enabled
                ? "DEVRE DIŞI"
                : r.quality === "GOOD"
                  ? r.value === 1
                    ? "HIGH · 1"
                    : "LOW · 0"
                  : r.quality === "NOT_INPUT"
                    ? "GİRİŞ DEĞİL"
                    : r.quality === "STALE"
                      ? "VERİ ESKİ"
                      : r.quality === "BAD"
                        ? "OKUNAMADI"
                        : "ÖLÇÜM BEKLENİYOR"}
            </span>
            <small>
              {!readOnly && `${r.worker} · BCM ${r.pin} · `}BOOL · {r.quality} ·{" "}
              {r.sampled_at
                ? new Date(r.sampled_at).toLocaleString()
                : "Henüz veri yok"}
            </small>
            {!readOnly && (
              <button disabled={busy} onClick={() => void toggle(r)}>
                {r.enabled ? "Okumayı devre dışı bırak" : "Okumayı etkinleştir"}
              </button>
            )}
          </article>
        ))}
      </div>
      <p role="status">{message}</p>
    </details>
  )
}
