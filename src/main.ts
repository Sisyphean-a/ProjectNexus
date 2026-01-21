import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import 'virtual:uno.css'

// Handle global styles if needed, or rely on UnoCSS reset in App.vue

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)

// If index.html contains #app, mount it.
// CRXJS might insert content script elsewhere, but for newtab/index.html it's standard.
if (document.getElementById('app')) {
  app.mount('#app')
}
