/**
 * Minimal .xlsx writer: pure JS, no dependencies, runs in Node, browsers and Hermes (React Native).
 * A workbook is a ZIP of SpreadsheetML parts; entries are STORED (no compression), which every spreadsheet app reads.
 * Cells: numbers, strings (inline), booleans, dates (Excel serials in the device's local time) with a few formats;
 * a cell may be { value, format } to override its column's format.
 */

/* ───────── bytes ───────── */

/** UTF-8 encoder that does not rely on TextEncoder (absent on some Hermes builds). */
export function xlsxUtf8(str) {
  const s = String(str)
  const out = []
  for (let i = 0; i < s.length; i++) {
    let code = s.charCodeAt(i)
    if (code >= 0xd800 && code <= 0xdbff) {
      const low = i + 1 < s.length ? s.charCodeAt(i + 1) : 0
      if (low >= 0xdc00 && low <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00)
        i++
      } else {
        code = 0xfffd // lone high surrogate: invalid UTF-8 would corrupt the whole file
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      code = 0xfffd // lone low surrogate
    }
    if (code < 0x80) out.push(code)
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63))
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
  }
  return Uint8Array.from(out)
}

let crcTable = null
export function xlsxCrc32(bytes) {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Base64 without btoa/Buffer: what expo-file-system needs to write binary data. */
export function xlsxBase64(bytes) {
  let out = ''
  let i = 0
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + B64[n & 63]
  }
  const rest = bytes.length - i
  if (rest === 1) {
    const n = bytes[i] << 16
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + '=='
  } else if (rest === 2) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8)
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + B64[(n >> 6) & 63] + '='
  }
  return out
}

/** DOS date/time of a Date (local fields), as stored in ZIP headers. */
const dosStamp = (date) => {
  const d = date instanceof Date && Number.isFinite(date.getTime()) ? date : new Date(1980, 0, 1)
  const year = Math.max(1980, d.getFullYear())
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

/** ZIP archive with STORED entries. `files` = [{ name, data: Uint8Array | string }]. */
export function xlsxZip(files, date) {
  const stamp = dosStamp(date)
  const entries = files.map((f) => {
    const name = xlsxUtf8(f.name)
    const data = typeof f.data === 'string' ? xlsxUtf8(f.data) : f.data
    return { name, data, crc: xlsxCrc32(data) }
  })
  let size = 22
  for (const e of entries) size += 30 + e.name.length + e.data.length + 46 + e.name.length
  const out = new Uint8Array(size)
  const view = new DataView(out.buffer)
  let p = 0
  const u16 = (v) => { view.setUint16(p, v, true); p += 2 }
  const u32 = (v) => { view.setUint32(p, v >>> 0, true); p += 4 }
  const bytes = (b) => { out.set(b, p); p += b.length }
  const offsets = []
  for (const e of entries) {
    offsets.push(p)
    u32(0x04034b50); u16(20); u16(0x0800); u16(0); u16(stamp.time); u16(stamp.date)
    u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.name.length); u16(0)
    bytes(e.name); bytes(e.data)
  }
  const cdStart = p
  entries.forEach((e, i) => {
    u32(0x02014b50); u16(20); u16(20); u16(0x0800); u16(0); u16(stamp.time); u16(stamp.date)
    u32(e.crc); u32(e.data.length); u32(e.data.length); u16(e.name.length); u16(0); u16(0); u16(0); u16(0); u32(0); u32(offsets[i])
    bytes(e.name)
  })
  const cdSize = p - cdStart
  u32(0x06054b50); u16(0); u16(0); u16(entries.length); u16(entries.length); u32(cdSize); u32(cdStart); u16(0)
  return out
}

/* ───────── SpreadsheetML ───────── */

/** Excel's limit for one cell. */
const XLSX_MAX_CELL_CHARS = 32767

/** Characters XML 1.0 forbids (control codes, U+FFFE/U+FFFF, lone surrogates) are dropped, the specials escaped. */
export const xlsxEscape = (value) => String(value)
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '') // eslint-disable-line no-control-regex
  .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 0 → A, 25 → Z, 26 → AA. */
export const xlsxColumn = (index) => {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const r = (n - 1) % 26
    s = String.fromCharCode(65 + r) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

/** Excel limits sheet names to 31 characters without []:*?/\ and needs them unique. */
export const xlsxSheetName = (name, used = new Set()) => {
  let base = String(name || 'Foglio').replace(/[[\]:*?/\\]/g, ' ').replace(/^'+|'+$/g, '').trim().slice(0, 31) || 'Foglio'
  let candidate = base
  let k = 2
  while (used.has(candidate.toLowerCase())) {
    const suffix = ` (${k++})`
    candidate = base.slice(0, 31 - suffix.length) + suffix
  }
  used.add(candidate.toLowerCase())
  return candidate
}

/**
 * Days since 1899-12-30 in the device's local time (what the user saw when the event happened). Accepts a Date, an
 * ISO string, a date-only "YYYY-MM-DD" (read as a LOCAL day, not UTC midnight) or epoch milliseconds.
 */
export const xlsxDateSerial = (date) => {
  let d
  if (date instanceof Date) d = date
  else if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m, day] = date.split('-').map(Number)
    d = new Date(y, m - 1, day)
  } else d = new Date(date)
  if (!Number.isFinite(d.getTime())) return null
  const localMs = d.getTime() - d.getTimezoneOffset() * 60000
  return localMs / 86400000 + 25569
}

/** Column formats → style index in styles.xml (cellXfs order). */
export const XLSX_FORMATS = { text: 0, header: 1, eur: 2, pct: 3, datetime: 4, date: 5, int: 6, num: 7, title: 8 }

const STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
  + '<numFmts count="5">'
  + '<numFmt numFmtId="164" formatCode="#,##0.00\\ &quot;€&quot;"/>'
  + '<numFmt numFmtId="165" formatCode="0.0%"/>'
  + '<numFmt numFmtId="166" formatCode="dd/mm/yyyy\\ hh:mm"/>'
  + '<numFmt numFmtId="167" formatCode="dd/mm/yyyy"/>'
  + '<numFmt numFmtId="168" formatCode="0.00"/>'
  + '</numFmts>'
  + '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font></fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFE6F2F1"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="9">'
  + '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>'
  + '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="167" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="168" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
  + '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
  + '</cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>'

/** One cell's XML, or '' for an empty value. `format` is a key of XLSX_FORMATS. */
function xlsxCell(ref, value, format) {
  // { value, format } overrides the column format for one cell (sheets that mix kinds of values in a column).
  if (value && typeof value === 'object' && !(value instanceof Date) && 'value' in value) return xlsxCell(ref, value.value, value.format || format)
  if (value === null || value === undefined || value === '') return ''
  if (value instanceof Date || format === 'datetime' || format === 'date') {
    // Numbers under a date format: small ones are already serials, large ones are epoch milliseconds.
    const serial = typeof value === 'number' && Math.abs(value) < 1e7 ? value : xlsxDateSerial(value)
    if (serial == null || !Number.isFinite(serial)) return ''
    return `<c r="${ref}" s="${XLSX_FORMATS[format === 'date' ? 'date' : 'datetime']}"><v>${serial}</v></c>`
  }
  if (typeof value === 'boolean') return `<c r="${ref}" t="b"><v>${value ? 1 : 0}</v></c>`
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return ''
    const style = format && format !== 'text' ? XLSX_FORMATS[format] || 0 : 0
    return `<c r="${ref}"${style ? ` s="${style}"` : ''}><v>${value}</v></c>`
  }
  const style = format === 'header' || format === 'title' ? ` s="${XLSX_FORMATS[format]}"` : ''
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xlsxEscape(String(value).slice(0, XLSX_MAX_CELL_CHARS))}</t></is></c>`
}

/**
 * Sheet XML. `sheet` = { columns: [{ header, format, width }], rows: [[...values]], title?, note?, filter?, filterRows? }.
 * With `title` the sheet starts with a title row (and an optional note row) above the header.
 * The header row is frozen and gets an autofilter.
 */
function xlsxSheetXml(sheet) {
  const columns = sheet.columns || []
  const lines = []
  let r = 1
  if (sheet.title) {
    lines.push(`<row r="${r}">${xlsxCell(`A${r}`, sheet.title, 'title')}</row>`)
    r++
    if (sheet.note) {
      lines.push(`<row r="${r}">${xlsxCell(`A${r}`, sheet.note, 'text')}</row>`)
      r++
    }
    r++ // blank spacer row
  }
  const headerRow = columns.length ? r : null
  if (columns.length) {
    lines.push(`<row r="${r}">${columns.map((c, i) => xlsxCell(`${xlsxColumn(i)}${r}`, c.header, 'header')).join('')}</row>`)
    r++
  }
  for (const row of sheet.rows || []) {
    const cells = (row || []).map((v, i) => xlsxCell(`${xlsxColumn(i)}${r}`, v, columns[i] ? columns[i].format : null)).join('')
    lines.push(`<row r="${r}">${cells}</row>`)
    r++
  }
  const width = Math.max(1, columns.length, ...(sheet.rows || []).map((row) => (row ? row.length : 0)))
  const lastRow = Math.max(1, r - 1)
  const cols = columns.length
    ? `<cols>${columns.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.width || Math.min(48, Math.max(10, String(c.header || '').length + 4))}" customWidth="1"/>`).join('')}</cols>`
    : ''
  const pane = headerRow
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/></sheetView></sheetViews>`
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>'
  // `filter: false` → no autofilter; `filterRows: n` → the filter covers only the first n data rows (sheets that stack
  // a second table below the first must not sort the two together).
  const filterLast = sheet.filterRows != null ? Math.min(lastRow, (headerRow || 0) + sheet.filterRows) : lastRow
  const filterRef = headerRow && sheet.filter !== false && (sheet.rows || []).length && filterLast > headerRow
    ? { from: `$A$${headerRow}`, to: `$${xlsxColumn(columns.length - 1)}$${filterLast}`, ref: `A${headerRow}:${xlsxColumn(columns.length - 1)}${filterLast}` }
    : null
  const filter = filterRef ? `<autoFilter ref="${filterRef.ref}"/>` : ''
  const xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
    + `<dimension ref="A1:${xlsxColumn(width - 1)}${lastRow}"/>`
    + pane + '<sheetFormatPr defaultRowHeight="15"/>' + cols
    + `<sheetData>${lines.join('')}</sheetData>` + filter
    + '</worksheet>'
  return { xml, filterRef }
}

/**
 * Builds the workbook bytes. `sheets` = [{ name, columns, rows, title?, note? }].
 * `meta` = { title, creator, date } for docProps; `date` also stamps the ZIP entries (deterministic output for a given date).
 */
export function buildXlsx(sheets, meta = {}) {
  const used = new Set()
  const list = (sheets.length ? sheets : [{ name: 'Foglio1', rows: [] }]).map((s) => ({ ...s, name: xlsxSheetName(s.name, used) }))
  const built = list.map((s) => xlsxSheetXml(s))
  // Excel writes a hidden _FilterDatabase name for every autofilter: add it so strict readers accept the filters.
  const definedNames = built.map((b, i) => (b.filterRef
    ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xlsxEscape(list[i].name.replace(/'/g, "''"))}'!${b.filterRef.from}:${b.filterRef.to}</definedName>`
    : '')).join('')
  const date = meta.date instanceof Date ? meta.date : new Date(0)
  const isoDate = Number.isFinite(date.getTime()) ? date.toISOString().replace(/\.\d{3}Z$/, 'Z') : '1970-01-01T00:00:00Z'
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
  const files = [
    {
      name: '[Content_Types].xml',
      data: head + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        + '<Default Extension="xml" ContentType="application/xml"/>'
        + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        + list.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')
        + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
        + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
        + '</Types>',
    },
    {
      name: '_rels/.rels',
      data: head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
        + '</Relationships>',
    },
    {
      name: 'docProps/core.xml',
      data: head + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        + `<dc:title>${xlsxEscape(meta.title || '')}</dc:title><dc:creator>${xlsxEscape(meta.creator || '')}</dc:creator>`
        + `<dcterms:created xsi:type="dcterms:W3CDTF">${isoDate}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${isoDate}</dcterms:modified>`
        + '</cp:coreProperties>',
    },
    {
      name: 'docProps/app.xml',
      data: head + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Offerta Vinted Timing</Application></Properties>',
    },
    {
      name: 'xl/workbook.xml',
      data: head + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        + '<bookViews><workbookView/></bookViews><sheets>'
        + list.map((s, i) => `<sheet name="${xlsxEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')
        + '</sheets>' + (definedNames ? `<definedNames>${definedNames}</definedNames>` : '') + '</workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: head + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        + list.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')
        + `<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`
        + '</Relationships>',
    },
    { name: 'xl/styles.xml', data: STYLES_XML },
    ...built.map((b, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: b.xml })),
  ]
  return xlsxZip(files, date)
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
