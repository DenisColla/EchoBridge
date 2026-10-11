import { Platform } from 'react-native'
import * as Legacy from 'expo-file-system/legacy'
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator'

/**
 * Listing photos for the AI calls: downloaded once, scaled to 768 px on the long side and re-encoded as JPEG, so every
 * provider sees the same pixels and the image tokens stay bounded (about 600–1,300 tokens per photo by provider).
 * Results are cached per URL for the session.
 */
const MAX_SIDE = 768
const cache = new Map()

const cacheName = (url) => {
  let h = 2166136261
  for (let i = 0; i < url.length; i++) h = Math.imul(h ^ url.charCodeAt(i), 16777619)
  return `lab-${(h >>> 0).toString(36)}`
}

/** Web preview only (tests): the photo as it is, base64 from a blob; no resizing. */
async function prepareOnWeb(url) {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Foto non scaricata (HTTP ${response.status})`)
  const blob = await response.blob()
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Foto non leggibile'))
    reader.readAsDataURL(blob)
  })
  const comma = dataUrl.indexOf(',')
  return { base64: dataUrl.slice(comma + 1), mediaType: blob.type || 'image/jpeg', width: null, height: null }
}

async function prepare(url) {
  if (Platform.OS === 'web') return prepareOnWeb(url)
  const dir = `${Legacy.cacheDirectory}lab/`
  await Legacy.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {})
  const local = `${dir}${cacheName(url)}`
  const download = await Legacy.downloadAsync(url, local)
  if (!download || download.status < 200 || download.status >= 300) throw new Error(`Foto non scaricata (HTTP ${download ? download.status : '?'})`)
  const context = ImageManipulator.manipulate(download.uri)
  const probe = await context.renderAsync()
  const landscape = probe.width >= probe.height
  const scale = Math.min(1, MAX_SIDE / Math.max(probe.width, probe.height))
  const target = scale < 1
    ? await ImageManipulator.manipulate(probe).resize(landscape ? { width: Math.round(probe.width * scale) } : { height: Math.round(probe.height * scale) }).renderAsync()
    : probe
  const saved = await target.saveAsync({ format: SaveFormat.JPEG, compress: 0.82, base64: true })
  Legacy.deleteAsync(local, { idempotent: true }).catch(() => {})
  if (!saved || !saved.base64) throw new Error('Foto non convertita')
  return { base64: saved.base64, mediaType: 'image/jpeg', width: saved.width, height: saved.height }
}

/** { base64, mediaType, width, height } for a photo URL; throws with an Italian message when it cannot be prepared. */
export function prepareImage(url) {
  if (!url) return Promise.reject(new Error('Annuncio senza foto'))
  if (!cache.has(url)) {
    const job = prepare(url).catch((e) => {
      cache.delete(url)
      throw e
    })
    cache.set(url, job)
  }
  return cache.get(url)
}
