import React, { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from './supabaseClient'

const THEMES = {
  dark_glass: {
    bg: '#0B1020', card: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.12)',
    text: '#FFFFFF', sub: '#9AA4BC', accent: '#00E6A8', heroGrad: 'linear-gradient(135deg,#1E2A8A,#2C5BE0)',
  },
  light_modern: {
    bg: '#F7F9FC', card: '#FFFFFF', border: '#E6EAF2',
    text: '#0B1020', sub: '#6b7488', accent: '#2C5BE0', heroGrad: 'linear-gradient(135deg,#1E2A8A,#2C5BE0)',
  },
  warm_classic: {
    bg: '#FFF8EF', card: '#FFFFFF', border: '#F0E2CC',
    text: '#3A2A1A', sub: '#8A6F52', accent: '#C9722A', heroGrad: 'linear-gradient(135deg,#C9722A,#E0A45C)',
  },
}

export default function MenuPage() {
  const { slug } = useParams()
  const [business, setBusiness] = useState(null)
  const [categories, setCategories] = useState([])
  const [activeCat, setActiveCat] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    async function load() {
      const { data: biz } = await supabase
        .from('businesses').select('*').eq('slug', slug).eq('is_published', true).maybeSingle()

      if (!biz) { setNotFound(true); setLoading(false); return }
      setBusiness(biz)

      const { data: cats } = await supabase
        .from('categories').select('*, products(*)')
        .eq('business_id', biz.id).is('branch_id', null).order('sort_order')

      const visible = (cats || []).map(c => ({ ...c, products: (c.products || []).filter(p => p.is_active) }))
      setCategories(visible)
      if (visible.length) setActiveCat(visible[0].id)
      setLoading(false)
    }
    load()
  }, [slug])

  const theme = THEMES[business?.menu_theme] || THEMES.dark_glass

  if (loading) return <Centered theme={THEMES.dark_glass}>Yüklənir...</Centered>
  if (notFound) return <Centered theme={THEMES.dark_glass}>Menyu tapılmadı.</Centered>

  const activeCategory = categories.find(c => c.id === activeCat)

  return (
    <div style={{ minHeight: '100vh', background: theme.bg, fontFamily: "'Plus Jakarta Sans', sans-serif", paddingBottom: 40 }}>
      <div style={{ background: theme.heroGrad, padding: '32px 20px 24px', color: '#fff' }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>{business.name}</div>
        <div style={{ fontSize: 13, opacity: 0.8, marginTop: 4 }}>Rəqəmsal menyu · DigiMenu.az</div>
      </div>

      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '16px 20px', WebkitOverflowScrolling: 'touch' }}>
        {categories.map(c => (
          <button
            key={c.id}
            onClick={() => setActiveCat(c.id)}
            style={{
              flexShrink: 0, padding: '8px 16px', borderRadius: 999, fontSize: 13, fontWeight: 600,
              border: `1px solid ${theme.border}`, cursor: 'pointer',
              background: activeCat === c.id ? theme.accent : theme.card,
              color: activeCat === c.id ? '#fff' : theme.text,
            }}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div style={{ padding: '0 20px', display: 'grid', gap: 12 }}>
        {(activeCategory?.products || []).map(p => (
          <div key={p.id} style={{
            display: 'flex', gap: 12, background: theme.card, border: `1px solid ${theme.border}`,
            borderRadius: 16, padding: 12, alignItems: 'center',
          }}>
            {p.image_url ? (
              <img src={p.image_url} alt={p.name} style={{ width: 56, height: 56, borderRadius: 12, objectFit: 'cover' }} />
            ) : (
              <div style={{ width: 56, height: 56, borderRadius: 12, background: theme.border, flexShrink: 0 }} />
            )}
            <div style={{ flex: 1 }}>
              <div style={{ color: theme.text, fontWeight: 700, fontSize: 14 }}>{p.name}</div>
              {p.description && <div style={{ color: theme.sub, fontSize: 12, marginTop: 2 }}>{p.description}</div>}
            </div>
            <div style={{ color: theme.accent, fontWeight: 800, fontSize: 14 }}>₼{p.price}</div>
          </div>
        ))}
        {activeCategory && !activeCategory.products?.length && (
          <div style={{ color: theme.sub, fontSize: 13, textAlign: 'center', marginTop: 20 }}>Bu kateqoriyada məhsul yoxdur.</div>
        )}
      </div>
    </div>
  )
}

function Centered({ children, theme }) {
  return (
    <div style={{ minHeight: '100vh', background: theme.bg, color: theme.text, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'sans-serif' }}>
      {children}
    </div>
  )
}
