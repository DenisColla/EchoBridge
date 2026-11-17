import { registerRootComponent } from 'expo'
import { AppRegistry, Platform } from 'react-native'
import App from './App'
import { WATCH_TICK_TASK, watchEngine } from './src/services/watchEngine.js'

// One reading of a hunt, started by Android's alarm clock with the app in any state (see watchEngine.js). The task
// ends when the reading is saved and the next alarm is set.
if (Platform.OS === 'android' && typeof AppRegistry.registerHeadlessTask === 'function') {
  AppRegistry.registerHeadlessTask(WATCH_TICK_TASK, () => async () => {
    try {
      await watchEngine.tick('sveglia')
    } catch {
      // tick does not throw; whatever happens, the app coming back in front takes the job up again
    }
  })
}

registerRootComponent(App)
