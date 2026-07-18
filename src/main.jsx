import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import MenuPage from './MenuPage'

ReactDOM.createRoot(document.getElementById('root')).render(
  <BrowserRouter>
    <Routes>
      <Route path="/m/:slug" element={<MenuPage />} />
      <Route path="*" element={<div style={{color:'#fff',background:'#0B1020',minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center'}}>DigiMenu.az</div>} />
    </Routes>
  </BrowserRouter>
)