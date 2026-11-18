/** Keep numerical cells numeric and neutralize formulas in user-authored strings. */
export function serializeCsv(rows: unknown[][]): string {
  const cell = (value: unknown) => {
    let text = value === null || value === undefined ? '' : String(value)
    if (typeof value === 'string' && /^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = "'" + text
    return '"' + text.replaceAll('"', '""') + '"'
  }
  return '\uFEFF' + rows.map((row) => row.map(cell).join(',')).join('\r\n') + '\r\n'
}
