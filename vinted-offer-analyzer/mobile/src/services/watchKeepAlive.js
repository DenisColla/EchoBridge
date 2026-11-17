import { vintedBridge } from './vintedBridge.js'

/**
 * Keeping a hunt alive with the app behind (1.15). Android stops the timers of an app that is not in front; it does
 * not while a «background task» of the app is active. The service of modules/vinted-bridge starts that task
 * (registered in index.js under KEEP_ALIVE_TASK) and shows its fixed notification; the task does nothing but last,
 * until stopKeepAlive() ends it. The readings themselves stay where they are, in App.js.
 */
export const KEEP_ALIVE_TASK = 'OvtWatchKeepAlive'

let release = null

export const keepAliveTask = () => new Promise((resolve) => {
  // A second start (the service restarted) replaces the first: the old task ends.
  if (release) release()
  release = resolve
})

/** Starts the service (the app must be in front). true when Android accepted it. */
export const startKeepAlive = (title, text) => vintedBridge.startWatchService(title, text)

export const updateKeepAlive = (title, text) => vintedBridge.updateWatchService(title, text)

export function stopKeepAlive() {
  if (release) {
    const done = release
    release = null
    done()
  }
  vintedBridge.stopWatchService()
}

export const keepAliveState = () => vintedBridge.watchServiceState()
