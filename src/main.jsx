import './Helpers/devAutoLogin.js'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from "react-hot-toast"
import store from './redux/store.js'
import { Provider } from "react-redux"
import { TextSizeProvider } from './Context/TextContext.jsx'
import { ThemeProvider } from './Context/ThemeContext.jsx'


createRoot(document.getElementById('root')).render(
  <Provider store={store}>
    <BrowserRouter>
      <ThemeProvider>
        <TextSizeProvider>
          <App />
          <Toaster position="top-right" reverseOrder={false} />
        </TextSizeProvider>
      </ThemeProvider>
    </BrowserRouter>
  </Provider>
)