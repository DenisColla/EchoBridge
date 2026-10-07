/**
 * Monthly report files. The workbook bytes come from the shared engine (core/learning.js + core/xlsx.js); this module
 * only writes them:
 *  1. always a private copy in the app's documents (reports/): the one «Apri» and «Condividi» use;
 *  2. when the user picked a folder once (Android Storage Access Framework, permission kept by the system across
 *     restarts), the same file in that folder, replacing an older copy of the same month, with no prompt at all.
 * On the web preview the file is downloaded instead.
 *
 * SAF notes: writes open in "w" mode, which Android does not guarantee to truncate, so an old file is always deleted
 * and created again (never overwritten in place); a revoked grant only shows up as an exception, so every SAF call
 * is wrapped. The new expo-file-system API works with any provider (also Drive folders); the legacy one is a fallback.
 */
import { Platform } from 'react-native'
import { Directory, File } from 'expo-file-system'
import * as Legacy from 'expo-file-system/legacy'
import * as IntentLauncher from 'expo-intent-launcher'
import * as Sharing from 'expo-sharing'
import { XLSX_MIME, xlsxBase64 } from '../../core/index.js'

const SAF = Legacy.StorageAccessFramework
const errorText = (e) => String(e && e.message ? e.message : e)

/** Human name of a SAF tree URI: "content://…/tree/primary%3ADocuments%2FVinted" → "Documents/Vinted". */
export function folderLabel(uri) {
  if (!uri) return ''
  try {
    const tail = decodeURIComponent(String(uri).split('/tree/')[1] || '').split('/document/')[0]
    const path = tail.includes(':') ? tail.slice(tail.indexOf(':') + 1) : tail
    return path || 'Memoria del telefono'
  } catch {
    return 'Cartella scelta'
  }
}

/**
 * Asks Android for a folder once (the picker opens in Documents); the permission persists across restarts.
 * Android 11+ refuses the storage root and the Download root: the user picks or creates a subfolder.
 * Returns { ok, uri, label } or { ok: false, reason }.
 */
export async function chooseReportFolder() {
  if (Platform.OS !== 'android') return { ok: false, reason: 'unsupported' }
  let initial
  try {
    initial = SAF && SAF.getUriForDirectoryInRoot ? SAF.getUriForDirectoryInRoot('Documents') : undefined
  } catch {
    initial = undefined
  }
  try {
    const dir = await Directory.pickDirectoryAsync(initial)
    if (dir && dir.uri) return { ok: true, uri: dir.uri, label: folderLabel(dir.uri) }
    return { ok: false, reason: 'cancelled' }
  } catch (error) {
    // Older providers or a cancelled picker: try the legacy SAF picker once.
    try {
      const res = await SAF.requestDirectoryPermissionsAsync(initial)
      if (!res.granted) return { ok: false, reason: 'cancelled' }
      return { ok: true, uri: res.directoryUri, label: folderLabel(res.directoryUri) }
    } catch {
      return { ok: false, reason: 'error', error: errorText(error) }
    }
  }
}

/** Writes into the chosen folder, replacing a file with the same name. Throws when the folder is gone or revoked. */
async function writeToFolder(dirUri, fileName, bytes) {
  try {
    const dir = new Directory(dirUri)
    for (const entry of dir.list()) {
      if (entry instanceof File && entry.name === fileName) entry.delete()
    }
    const file = dir.createFile(fileName, XLSX_MIME)
    file.write(bytes)
    return file.uri
  } catch (modern) {
    // Legacy SAF (external-storage folders only), base64 in, delete-then-create as above.
    if (!SAF) throw modern
    const existing = await SAF.readDirectoryAsync(dirUri)
    for (const uri of existing) {
      if (decodeURIComponent(uri).split('/').pop() === fileName) await Legacy.deleteAsync(uri, { idempotent: true })
    }
    const uri = await SAF.createFileAsync(dirUri, fileName, XLSX_MIME)
    await Legacy.writeAsStringAsync(uri, xlsxBase64(bytes), { encoding: Legacy.EncodingType.Base64 })
    return uri
  }
}

function downloadOnWeb(bytes, fileName) {
  const blob = new Blob([bytes], { type: XLSX_MIME })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

/** The private copy (file://), replaced if it exists. */
async function writePrivate(fileName, bytes) {
  const dir = `${Legacy.documentDirectory}reports/`
  await Legacy.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {})
  const uri = `${dir}${fileName}`
  await Legacy.deleteAsync(uri, { idempotent: true }).catch(() => {})
  await Legacy.writeAsStringAsync(uri, xlsxBase64(bytes), { encoding: Legacy.EncodingType.Base64 })
  return uri
}

/**
 * Saves the workbook. Returns { savedTo: 'folder' | 'app' | 'download' | 'none', localUri, folderUri, error }.
 * Never throws: a revoked folder falls back to the private copy and reports the error.
 */
export async function writeReport({ bytes, fileName, folderUri = null }) {
  if (Platform.OS === 'web') {
    try {
      downloadOnWeb(bytes, fileName)
      return { savedTo: 'download', localUri: null, folderUri: null, error: null }
    } catch (error) {
      return { savedTo: 'none', localUri: null, folderUri: null, error: errorText(error) }
    }
  }
  let localUri = null
  let error = null
  try {
    localUri = await writePrivate(fileName, bytes)
  } catch (e) {
    error = errorText(e)
  }
  if (folderUri) {
    try {
      const uri = await writeToFolder(folderUri, fileName, bytes)
      return { savedTo: 'folder', localUri, folderUri: uri, error: null }
    } catch (e) {
      error = `La cartella scelta non è più accessibile (${errorText(e)}): scegline un'altra nella scheda Info.`
    }
  }
  return { savedTo: localUri ? 'app' : 'none', localUri, folderUri: null, error }
}

/** Copies an already saved private report into the chosen folder (right after the user picks the folder). */
export async function copyReportToFolder({ localUri, fileName, folderUri }) {
  if (!localUri || !folderUri || Platform.OS === 'web') return { ok: false }
  try {
    const base64 = await Legacy.readAsStringAsync(localUri, { encoding: Legacy.EncodingType.Base64 })
    const bytes = Uint8Array.from(globalThis.atob(base64), (c) => c.charCodeAt(0))
    const uri = await writeToFolder(folderUri, fileName, bytes)
    return { ok: true, uri }
  } catch (e) {
    return { ok: false, error: errorText(e) }
  }
}

/** Opens the share sheet on a saved report (email, Drive, WhatsApp…). expo-sharing only takes file:// URIs. */
export async function shareReport(localUri, title) {
  if (!localUri) return false
  try {
    if (!(await Sharing.isAvailableAsync())) return false
    await Sharing.shareAsync(localUri, { mimeType: XLSX_MIME, dialogTitle: title || 'Report mensile offerte', UTI: 'org.openxmlformats.spreadsheetml.sheet' })
    return true
  } catch {
    return false
  }
}

/** Opens the report in Excel, Sheets or WPS (VIEW intent on a content URI); falls back to the share sheet. */
export async function openReport(localUri, title) {
  if (!localUri) return false
  if (Platform.OS === 'android') {
    try {
      const contentUri = await Legacy.getContentUriAsync(localUri)
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', { data: contentUri, type: XLSX_MIME, flags: 1 /* FLAG_GRANT_READ_URI_PERMISSION */ })
      return true
    } catch {
      // no spreadsheet app answered: let the user pick one from the share sheet
    }
  }
  return shareReport(localUri, title)
}
