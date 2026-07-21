import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import MenuPage from './MenuPage'
import PaymentPage from './PaymentPage'

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <Routes>
      <Route path="/m/:slug" element={<MenuPage />} />
      <Route path="/pay/:slug" element={<PaymentPage />} />
    </Routes>
  </BrowserRouter>
)