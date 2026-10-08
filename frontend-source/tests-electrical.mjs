import { test } from "node:test"
import assert from "node:assert/strict"
import ts from "typescript"
import { readFile } from "node:fs/promises"
const source = await readFile(
  new URL("./src/electrical.ts", import.meta.url),
  "utf8",
)
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
})
const { reading, deviation, coherent, automatic } = await import(
  "data:text/javascript;base64," + Buffer.from(outputText).toString("base64")
)
const now = Date.now(),
  row = {
    tag_id: 1,
    value: 230,
    unit: "V",
    quality: "GOOD",
    timestamp: new Date(now).toISOString(),
  }
test("units and quality: missing, invalid and stale data never become zero", () => {
  assert.equal(reading(row, "V", now, 30).value, 230)
  assert.equal(
    reading({ ...row, value: 230000, unit: "W" }, "kW", now, 30).value,
    230,
  )
  for (const change of [
    { value: null },
    { value: NaN },
    { quality: "BAD" },
    { ui_state: "stale" },
    { timestamp: "" },
    { timestamp: new Date(now - 31000).toISOString() },
    { timestamp: new Date(now + 6000).toISOString() },
    { unit: "kWh" },
    { value: -1 },
  ])
    assert.equal(reading({ ...row, ...change }, "V", now, 30).value, null)
  assert.equal(
    reading({ ...row, value: -2500, unit: "W" }, "kW", now, 30).value,
    -2.5,
  )
  assert.ok(
    Math.abs(
      reading({ ...row, value: 95, unit: "%" }, "", now, 30).value - 0.95,
    ) < 1e-12,
  )
  assert.equal(
    reading({ ...row, value: 1.2, unit: "" }, "", now, 30).value,
    null,
  )
})
test("three phase deviation requires all phases and nonzero average", () => {
  assert.equal(deviation([100, 100, 130]), (100 * 20) / 110)
  assert.equal(deviation([230, 230, 230]), 0)
  for (const values of [
    [0, 0, 0],
    [230, null, 230],
    [-1, 10, 20],
    [1, 2],
  ])
    assert.equal(deviation(values), null)
  assert.equal(
    coherent(
      [row, { ...row, timestamp: new Date(now - 6000).toISOString() }],
      5,
    ),
    false,
  )
  assert.equal(coherent([row, undefined], 5), false)
})
test("ambiguous automatic mapping never silently selects a channel", () => {
  assert.equal(
    automatic([{ ...row, signal_name: "p_total" }], ["p_total"]),
    "1",
  )
  assert.equal(
    automatic(
      [
        { ...row, signal_name: "p_total" },
        { ...row, tag_id: 2, signal_name: "p_total" },
      ],
      ["p_total"],
    ),
    "",
  )
  assert.equal(
    automatic([{ ...row, signal_name: "reactive_power_total" }], [
      "power_total",
    ]),
    "",
  )
})
