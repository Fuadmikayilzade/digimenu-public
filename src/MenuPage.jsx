import React, { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from './supabaseClient'

const THEMES = {
  dark_glass:   { bg:'#0B1020', card:'rgba(255,255,255,0.06)', border:'rgba(255,255,255,0.12)', text:'#FFFFFF', sub:'#9AA4BC', accent:'#00E6A8', heroGrad:'linear-gradient(135deg,#1E2A8A,#2C5BE0)' },
  light_modern: { bg:'#F7F9FC', card:'#FFFFFF', border:'#E6EAF2', text:'#0B1020', sub:'#6b7488', accent:'#2C5BE0', heroGrad:'linear-gradient(135deg,#1E2A8A,#2C5BE0)' },
  warm_classic: { bg:'#FFF8EF', card:'#FFFFFF', border:'#F0E2CC', text:'#3A2A1A', sub:'#8A6F52', accent:'#C9722A', heroGrad:'linear-gradient(135deg,#C9722A,#E0A45C)' },
}

export default function MenuPage() {
  const { slug } = useParams()
  const [searchParams] = useSearchParams()
  const branchId = searchParams.get('branch')
  const tableParam = searchParams.get('table')

  const [business, setBusiness] = useState(null)
  const [categories, setCategories] = useState([])
  const [activeCat, setActiveCat] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [tableId, setTableId] = useState(null)
  const [sessionToken, setSessionToken] = useState(null)

  // Sifariş axını
  const [step, setStep] = useState('menu') // menu | register | success
  const [cart, setCart] = useState([])
  const [customer, setCustomer] = useState({ name: '', phone: '' })
  const [note, setNote] = useState('')
  const [loyaltyInfo, setLoyaltyInfo] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      // Biznes yükləmə
      const { data: biz } = await supabase
        .from('businesses').select('*').eq('slug', slug).eq('is_published', true).maybeSingle()
      if (!biz) { setNotFound(true); setLoading(false); return }
      setBusiness(biz)

      // Kateqoriya + məhsullar
      let q = supabase.from('categories').select('*, products(*)')
        .eq('business_id', biz.id).order('sort_order')
      q = branchId ? q.eq('branch_id', branchId) : q.is('branch_id', null)
      const { data: cats } = await q
      const visible = (cats || []).map(c => ({
        ...c, products: (c.products || []).filter(p => p.is_active)
      }))
      setCategories(visible)
      if (visible.length) setActiveCat(visible[0].id)

      // Masa + sessiya (QR sifariş üçün)
      if (tableParam) {
        let tq = supabase.from('tables').select('id')
          .eq('business_id', biz.id).eq('number', tableParam)
        tq = branchId ? tq.eq('branch_id', branchId) : tq.is('branch_id', null)
        const { data: tData } = await tq.limit(1)

        if (tData?.[0]) {
          setTableId(tData[0].id)
          // Aktiv sessiya var mı?
          const { data: sess } = await supabase
            .from('table_sessions').select('session_token, order_count')
            .eq('table_id', tData[0].id).eq('is_active', true)
            .gt('expires_at', new Date().toISOString()).limit(1)

          if (sess?.[0]) {
            setSessionToken(sess[0].session_token)
          } else {
            // Yeni sessiya yarat
            const { data: ns } = await supabase
              .from('table_sessions')
              .insert({ business_id: biz.id, table_id: tData[0].id })
              .select('session_token').single()
            if (ns) setSessionToken(ns.session_token)
          }
        }
      }
      setLoading(false)
    }
    load()
  }, [slug, branchId, tableParam])

  const addToCart = (product) => {
    setCart(prev => {
      const ex = prev.find(i => i.id === product.id)
      return ex
        ? prev.map(i => i.id === product.id ? { ...i, qty: i.qty + 1 } : i)
        : [...prev, { ...product, qty: 1 }]
    })
  }

  const removeFromCart = (id) => {
    setCart(prev => {
      const ex = prev.find(i => i.id === id)
      if (!ex) return prev
      if (ex.qty === 1) return prev.filter(i => i.id !== id)
      return prev.map(i => i.id === id ? { ...i, qty: i.qty - 1 } : i)
    })
  }

  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0)
  const cartCount = cart.reduce((s, i) => s + i.qty, 0)

  const checkLoyalty = async (phone) => {
    if (!business?.id || phone.length < 6) return
    const { data } = await supabase.from('loyalty_members')
      .select('*').eq('business_id', business.id).eq('phone', phone).maybeSingle()
    setLoyaltyInfo(data || null)
  }

  const submitOrder = async () => {
    if (!customer.name.trim()) { setError('Adınızı yazın'); return }
    if (!customer.phone.trim()) { setError('Telefon nömrənizi yazın'); return }
    if (!cart.length) { setError('Səbət boşdur'); return }
    if (!sessionToken) { setError('Sessiya tapılmadı. QR-u yenidən skan edin.'); return }
    setSubmitting(true); setError('')

    // Rate limit yoxla
    const { data: allowed } = await supabase.rpc('check_order_rate_limit', { p_session_token: sessionToken })
    if (!allowed) {
      setError('Çox tez-tez sifariş verdiniz. Bir az gözləyin.')
      setSubmitting(false); return
    }

    const items = cart.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty }))
    const { error: insErr } = await supabase.from('pending_orders').insert({
      business_id: business.id,
      branch_id: branchId || null,
      table_id: tableId,
      session_token: sessionToken,
      customer_name: customer.name.trim(),
      customer_phone: customer.phone.trim(),
      items, total: cartTotal,
      note: note.trim() || null,
    })

    if (insErr) { setError(insErr.message); setSubmitting(false); return }

    // Sessiya sayğacını yenilə
    await supabase.from('table_sessions')
      .update({ order_count: supabase.rpc, last_order_at: new Date().toISOString() })
      .eq('session_token', sessionToken)

    // Loyalty tarixçəsi
    if (loyaltyInfo?.id) {
      await supabase.from('loyalty_history').insert({
        member_id: loyaltyInfo.id, business_id: business.id,
        visit_date: new Date().toISOString().slice(0, 10), order_total: cartTotal,
      })
    }

    setSubmitting(false)
    setStep('success')
  }

  const theme = THEMES[business?.menu_theme] || THEMES.dark_glass
  const S = (base) => ({ ...base })

  if (loading) return <Center bg={THEMES.dark_glass.bg} color="#FFF">Yüklənir...</Center>
  if (notFound) return <Center bg={THEMES.dark_glass.bg} color="#FFF">Menyu tapılmadı.</Center>

  if (step === 'success') return (
    <div style={{ minHeight: '100vh', background: theme.bg, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 32, fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ fontSize: 64 }}>✅</div>
      <div style={{ color: theme.text, fontSize: 22, fontWeight: 800 }}>Sifariş göndərildi!</div>
      <div style={{ color: theme.sub, fontSize: 14, textAlign: 'center', maxWidth: 280 }}>
        Sifarişiniz restorana çatdırıldı. Ofisiant tezliklə gələcək.
      </div>
      <button onClick={() => { setStep('menu'); setCart([]) }}
        style={{ marginTop: 8, padding: '12px 28px', borderRadius: 999, border: 'none', background: theme.accent, color: '#001018', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
        Menyuya qayıt
      </button>
    </div>
  )

  const activeCategory = categories.find(c => c.id === activeCat)

  return (
    <div style={{ minHeight: '100vh', background: theme.bg, fontFamily: 'system-ui, sans-serif', paddingBottom: sessionToken && cart.length ? 90 : 20 }}>
      {/* Hero */}
      <div style={{ background: theme.heroGrad, padding: '36px 20px 28px', color: '#fff' }}>
        {business.logo_url && (
          <img src={business.logo_url} alt="logo" style={{ width: 56, height: 56, borderRadius: 14, objectFit: 'cover', marginBottom: 12, border: '2px solid rgba(255,255,255,0.3)' }} />
        )}
        <div style={{ fontSize: 24, fontWeight: 800 }}>{business.name}</div>
        <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>Rəqəmsal menyu</div>
        {tableParam && <div style={{ marginTop: 8, display: 'inline-block', background: 'rgba(255,255,255,0.15)', borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 700 }}>🪑 Masa {tableParam}</div>}
      </div>

      {/* Kateqoriyalar */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '16px 20px', WebkitOverflowScrolling: 'touch' }}>
        {categories.map(c => (
          <button key={c.id} onClick={() => setActiveCat(c.id)}
            style={{ flexShrink: 0, padding: '8px 16px', borderRadius: 999, fontSize: 13, fontWeight: 600, border: `1px solid ${theme.border}`, cursor: 'pointer', transition: '.15s', background: activeCat === c.id ? theme.accent : theme.card, color: activeCat === c.id ? '#001018' : theme.text }}>
            {c.name}
            <span style={{ marginLeft: 5, fontSize: 10, opacity: 0.7 }}>({(c.products || []).length})</span>
          </button>
        ))}
      </div>

      {/* Məhsullar */}
      <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {(activeCategory?.products || []).length === 0 && (
          <div style={{ color: theme.sub, fontSize: 13, padding: '20px 0', textAlign: 'center' }}>Bu kateqoriyada məhsul yoxdur.</div>
        )}
        {(activeCategory?.products || []).map(p => {
          const inCart = cart.find(i => i.id === p.id)
          return (
            <div key={p.id} style={{ display: 'flex', gap: 12, background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 16, padding: 12, alignItems: 'center' }}>
              {p.image_url
                ? <img src={p.image_url} alt={p.name} style={{ width: 60, height: 60, borderRadius: 12, objectFit: 'cover', flexShrink: 0 }} />
                : <div style={{ width: 60, height: 60, borderRadius: 12, background: theme.border, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>🍽</div>
              }
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: theme.text, fontWeight: 700, fontSize: 14 }}>{p.name}</div>
                {p.description && <div style={{ color: theme.sub, fontSize: 12, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description}</div>}
                <div style={{ color: theme.accent, fontWeight: 800, fontSize: 15, marginTop: 4 }}>₼{p.price}</div>
              </div>
              {sessionToken && (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                  {inCart ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <button onClick={() => removeFromCart(p.id)} style={{ width: 28, height: 28, borderRadius: 999, border: `1px solid ${theme.border}`, background: theme.card, color: theme.text, fontWeight: 800, fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                      <span style={{ color: theme.text, fontWeight: 700, minWidth: 16, textAlign: 'center' }}>{inCart.qty}</span>
                      <button onClick={() => addToCart(p)} style={{ width: 28, height: 28, borderRadius: 999, border: 'none', background: theme.accent, color: '#001018', fontWeight: 800, fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                    </div>
                  ) : (
                    <button onClick={() => addToCart(p)} style={{ padding: '6px 14px', borderRadius: 999, border: 'none', background: theme.accent, color: '#001018', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>+ Əlavə et</button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Aşağı sabit səbət düyməsi */}
      {sessionToken && cart.length > 0 && step === 'menu' && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '12px 20px', background: theme.bg, borderTop: `1px solid ${theme.border}` }}>
          <button onClick={() => setStep('register')}
            style={{ width: '100%', padding: 14, borderRadius: 12, border: 'none', background: theme.accent, color: '#001018', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>
            🛒 Sifarişi göndər — ₼{cartTotal.toFixed(2)} · {cartCount} məhsul
          </button>
        </div>
      )}

      {/* Müştəri forması (bottom sheet) */}
      {step === 'register' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', zIndex: 200 }}>
          <div style={{ background: theme.card === 'rgba(255,255,255,0.06)' ? '#131B30' : theme.card, padding: 24, borderRadius: '20px 20px 0 0', width: '100%', boxSizing: 'border-box', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: theme.border, margin: '0 auto 16px' }} />
            <h3 style={{ color: theme.text, margin: '0 0 4px', fontSize: 17, fontWeight: 800 }}>Sifariş məlumatları</h3>
            <p style={{ color: theme.sub, fontSize: 12, margin: '0 0 16px' }}>Masa {tableParam} · ₼{cartTotal.toFixed(2)}</p>

            {loyaltyInfo && (
              <div style={{ background: theme.accent + '22', border: `1px solid ${theme.accent}44`, borderRadius: 10, padding: 10, marginBottom: 14 }}>
                <div style={{ color: theme.accent, fontSize: 12, fontWeight: 700 }}>🎁 Loyallıq üzvü: {loyaltyInfo.full_name}</div>
                <div style={{ color: theme.sub, fontSize: 11, marginTop: 2 }}>Cəmi {loyaltyInfo.total_visits} ziyarət</div>
              </div>
            )}

            {error && <div style={{ color: '#FF5A5F', fontSize: 12, marginBottom: 10, padding: '8px 12px', background: 'rgba(255,90,95,.1)', borderRadius: 8 }}>{error}</div>}

            {/* Səbət xülasəsi */}
            <div style={{ marginBottom: 14, background: theme.border + '44', borderRadius: 10, padding: 10 }}>
              {cart.map(i => (
                <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: theme.sub, marginBottom: 4 }}>
                  <span>{i.name} × {i.qty}</span>
                  <span style={{ color: theme.text }}>₼{(i.price * i.qty).toFixed(2)}</span>
                </div>
              ))}
            </div>

            <input value={customer.name} onChange={e => setCustomer(p => ({ ...p, name: e.target.value }))}
              placeholder="Ad Soyad *"
              style={{ width: '100%', padding: 12, borderRadius: 10, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text, marginBottom: 10, boxSizing: 'border-box', fontSize: 14 }} />

            <input value={customer.phone}
              onChange={e => { setCustomer(p => ({ ...p, phone: e.target.value })); checkLoyalty(e.target.value) }}
              placeholder="Telefon (+994...) *"
              style={{ width: '100%', padding: 12, borderRadius: 10, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text, marginBottom: 10, boxSizing: 'border-box', fontSize: 14 }} />

            <textarea value={note} onChange={e => setNote(e.target.value)}
              placeholder="Qeyd (allergiya, xüsusi istək...)"
              rows={2}
              style={{ width: '100%', padding: 12, borderRadius: 10, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text, marginBottom: 16, boxSizing: 'border-box', resize: 'none', fontSize: 14 }} />

            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={submitOrder} disabled={submitting}
                style={{ flex: 2, padding: 14, borderRadius: 12, border: 'none', background: theme.accent, color: '#001018', fontWeight: 800, fontSize: 14, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
                {submitting ? 'Göndərilir...' : '✅ Sifarişi Təsdiqlə'}
              </button>
              <button onClick={() => { setStep('menu'); setError('') }}
                style={{ flex: 1, padding: 14, borderRadius: 12, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.sub, cursor: 'pointer', fontSize: 14 }}>
                Geri
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Center({ bg, color, children }) {
  return (
    <div style={{ minHeight: '100vh', background: bg, color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif', fontSize: 16 }}>
      {children}
    </div>
  )
}