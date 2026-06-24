import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import MenuPage from './MenuPage.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/m/:slug" element={<MenuPage />} />
        <Route path="*" element={<div style={{ padding: 40, fontFamily: 'sans-serif' }}>DigiMenu.az — restoran menyusu üçün QR kodu skan edin.</div>} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
)
