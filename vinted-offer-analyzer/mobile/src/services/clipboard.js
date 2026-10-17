import * as Clipboard from 'expo-clipboard'

export async function copyText(text) {
  try {
    await Clipboard.setStringAsync(text)
    return true
  } catch {
    return false
  }
}
