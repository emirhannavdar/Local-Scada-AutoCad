export type Sample = {
  tag_id?: number | string
  signal_name?: string
  unit?: string
  value?: unknown
  quality?: string
  ui_state?: string
  timestamp?: string
}
export const channels = [
  ["u1", "L1-N gerilim", "V", ["v_l1n", "voltage_l1"]],
  ["u2", "L2-N gerilim", "V", ["v_l2n", "voltage_l2"]],
  ["u3", "L3-N gerilim", "V", ["v_l3n", "voltage_l3"]],
  ["i1", "L1 akım", "A", ["i_l1", "current_l1"]],
  ["i2", "L2 akım", "A", ["i_l2", "current_l2"]],
  ["i3", "L3 akım", "A", ["i_l3", "current_l3"]],
  [
    "p",
    "Toplam aktif güç",
    "kW",
    ["p_total", "p_tot", "power_total", "grid_active_power"],
  ],
  ["q", "Toplam reaktif güç", "kvar", ["q_total", "reactive_power_total"]],
  ["s", "Toplam görünür güç", "kVA", ["s_total", "apparent_power_total"]],
  ["pf", "Güç faktörü", "", ["pf_total", "power_factor"]],
  ["f", "Frekans", "Hz", ["freq", "frequency", "grid_frequency"]],
] as const
const units: Record<string, Record<string, number>> = {
  V: { V: 1, kV: 1000 },
  A: { A: 1, mA: 0.001, kA: 1000 },
  kW: { W: 0.001, kW: 1, MW: 1000 },
  kvar: { var: 0.001, kvar: 1, kVar: 1, kVAR: 1, Mvar: 1000 },
  kVA: { VA: 0.001, kVA: 1, MVA: 1000 },
  Hz: { Hz: 1 },
  "": { "": 1, "1": 1, "%": 0.01 },
}
export function factor(unit: string, target: string) {
  return units[target]?.[unit.trim()]
}
export function reading(
  row: Sample | undefined,
  target: string,
  now: number,
  maxAge: number,
) {
  if (!row) return { value: null, reason: "Sinyal eşlenmedi / bağlantı yok" }
  const t = Date.parse(row.timestamp || "")
  if (row.quality !== "GOOD" || row.ui_state === "stale")
    return {
      value: null,
      reason: `Kalite: ${
        row.ui_state === "stale" ? "STALE" : row.quality || "bilinmiyor"
      }`,
    }
  if (!Number.isFinite(t) || now - t > maxAge * 1000 || t > now + 5000)
    return { value: null, reason: "Zaman eksik / eski / ileri" }
  const k = factor(row.unit || "", target)
  if (k === undefined) return { value: null, reason: "Birim uyumsuz" }
  if (typeof row.value !== "number" || !Number.isFinite(row.value))
    return { value: null, reason: "Sayısal ölçüm yok" }
  const value = row.value * k
  if (
    (["V", "A", "kVA", "Hz"].includes(target) && value < 0) ||
    (target === "" && Math.abs(value) > 1)
  )
    return { value: null, reason: "Ölçüm aralık dışında" }
  return { value, reason: "GOOD" }
}
export function deviation(values: (number | null)[]) {
  if (
    values.length !== 3 ||
    values.some((v) => v === null || !Number.isFinite(v) || v < 0)
  )
    return null
  const v = values as number[],
    avg = v.reduce((a, b) => a + b, 0) / 3
  return avg > 0
    ? (100 * Math.max(...v.map((x) => Math.abs(x - avg)))) / avg
    : null
}
export function coherent(rows: (Sample | undefined)[], seconds: number) {
  const times = rows.map((r) => Date.parse(r?.timestamp || ""))
  return (
    times.every(Number.isFinite) &&
    Math.max(...times) - Math.min(...times) <= seconds * 1000
  )
}
export function automatic(rows: Sample[], aliases: readonly string[]) {
  const found = rows.filter((r) =>
    aliases.includes((r.signal_name || "").toLowerCase()),
  )
  return found.length === 1 ? String(found[0].tag_id) : ""
}
