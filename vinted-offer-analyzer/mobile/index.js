import { registerRootComponent } from 'expo'
import { AppRegistry, Platform } from 'react-native'
import App from './App'
import { KEEP_ALIVE_TASK, keepAliveTask } from './src/services/watchKeepAlive.js'

// The task the watch service starts to keep a hunt reading with the app behind (see watchKeepAlive.js).
if (Platform.OS === 'android' && typeof AppRegistry.registerHeadlessTask === 'function') {
  AppRegistry.registerHeadlessTask(KEEP_ALIVE_TASK, () => keepAliveTask)
}

registerRootComponent(App)
