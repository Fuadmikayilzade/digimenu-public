import React, { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from './supabaseClient'

const THEMES = {
  dark_glass:   { bg:'#0B1020', card:'rgba(255,255,255,0.06)', border:'rgba(255,255,255,0.12)', text:'#FFFFFF', sub:'#9AA4BC', accent:'#00E6A8', heroGrad:'linear-gradient(135deg,#1E2A8A,#2C5BE0)' },
  light_modern: { bg:'#F7F9FC', card:'#FFFFFF', border:'#E6EAF2', text:'#0B1020', sub:'#6b7488', accent:'#2C5BE0', heroGrad:'linear-gradient(135deg,#1E2A8A,#2C5BE0)' },
  warm_classic: { bg:'#FFF8EF', card:'#FFFFFF', border:'#F0E2CC', text:'#3A2A1A', sub:'#8A6F52', accent:'#C9722A', heroGrad:'linear-gradient(135deg,#C9722A,#E0A45C)' },
}

const STATUS_INFO = {
  pending:   { label: 'Gözləyir',     icon: '⏳', color: '#9AA4BC' },
  accepted:  { label: 'Qəbul edildi', icon: '✅', color: '#2C5BE0' },
  preparing: { label: 'Hazırlanır',   icon: '🟡', color: '#FF9F5A' },
  ready:     { label: 'Hazırdır',     icon: '🔔', color: '#7C4DFF' },
  delivered: { label: 'Çatdırıldı',   icon: '🚀', color: '#00E6A8' },
  rejected:  { label: 'Rədd edildi',  icon: '❌', color: '#FF5A5F' },
}

function getCustomerToken() {
  let token = sessionStorage.getItem('customer_token')
  if (!token) { token = crypto.randomUUID(); sessionStorage.setItem('customer_token', token) }
  return token
}

export default function MenuPage() {
  const { slug } = useParams()
  const [searchParams] = useSearchParams()
  const branchId = searchParams.get('branch')
  const tableParam = searchParams.get('table')

  const [business, setBusiness] = useState(null)
  const [bSettings, setBSettings] = useState(null)
  const [categories, setCategories] = useState([])
  const [activeCat, setActiveCat] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [tableId, setTableId] = useState(null)
  const [sessionToken, setSessionToken] = useState(null)
  const [tableNumber, setTableNumber] = useState(tableParam || '')
  const [tableSetupDone, setTableSetupDone] = useState(!!tableParam)
  const [tableSetupLoading, setTableSetupLoading] = useState(false)

  const [step, setStep] = useState('menu')
  const [cart, setCart] = useState([])
  const [customer, setCustomer] = useState({ name: '', phone: '' })
  const [note, setNote] = useState('')
  const [loyaltyInfo, setLoyaltyInfo] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [myOrders, setMyOrders] = useState([])
  const customerToken = getCustomerToken()

  useEffect(() => { loadMenu() }, [slug])

  // tableParam URL-də varsa avtomatik setup et
  useEffect(() => {
    if (tableParam && business?.id) setupTable(tableParam)
  }, [tableParam, business])

  // Realtime status yenilənməsi
  useEffect(() => {
    if (!business?.id) return
    const channel = supabase
      .channel(`orders:${customerToken}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'pending_orders',
        filter: `customer_token=eq.${customerToken}` },
        (payload) => setMyOrders(prev => prev.map(o => o.id === payload.new.id ? payload.new : o))
      ).subscribe()
    return () => supabase.removeChannel(channel)
  }, [business])

  const loadMenu = async () => {
    const { data: biz } = await supabase
      .from('businesses').select('*').eq('slug', slug).eq('is_published', true).maybeSingle()
    if (!biz) { setNotFound(true); setLoading(false); return }
    setBusiness(biz)

    const [{ data: s }, { data: cats }, { data: orders }] = await Promise.all([
      supabase.from('business_settings').select('*').eq('business_id', biz.id).maybeSingle(),
      (branchId
        ? supabase.from('categories').select('*, products(*)').eq('business_id', biz.id).eq('branch_id', branchId).order('sort_order')
        : supabase.from('categories').select('*, products(*)').eq('business_id', biz.id).is('branch_id', null).order('sort_order')
      ),
      supabase.from('pending_orders').select('*').eq('business_id', biz.id).eq('customer_token', customerToken).order('created_at', { ascending: false }),
    ])

    setBSettings(s)
    const visible = (cats || []).map(c => ({ ...c, products: (c.products || []).filter(p => p.is_active) }))
    setCategories(visible)
    if (visible.length) setActiveCat(visible[0].id)
    setMyOrders(orders || [])
    setLoading(false)
  }

  const setupTable = async (num) => {
    if (!business?.id || !num) return
    setTableSetupLoading(true)
    let tq = supabase.from('tables').select('id').eq('business_id', business.id).eq('number', String(num))
    tq = branchId ? tq.eq('branch_id', branchId) : tq.is('branch_id', null)
    const { data: tData } = await tq.limit(1)

    if (!tData?.[0]) {
      setError(`Masa ${num} tapılmadı. Düzgün masa nömrəsini daxil edin.`)
      setTableSetupLoading(false)
      return
    }

    setTableId(tData[0].id)

    const { data: sess } = await supabase
      .from('table_sessions').select('session_token')
      .eq('table_id', tData[0].id).eq('is_active', true)
      .gt('expires_at', new Date().toISOString()).limit(1)

    if (sess?.[0]) {
      setSessionToken(sess[0].session_token)
    } else {
      const { data: ns } = await supabase
        .from('table_sessions')
        .insert({ business_id: business.id, table_id: tData[0].id })
        .select('session_token').single()
      if (ns) setSessionToken(ns.session_token)
    }

    setTableSetupDone(true)
    setError('')
    setTableSetupLoading(false)
  }

  const addToCart = (product) => setCart(prev => {
    const ex = prev.find(i => i.id === product.id)
    return ex ? prev.map(i => i.id === product.id ? { ...i, qty: i.qty + 1 } : i)
              : [...prev, { ...product, qty: 1 }]
  })

  const removeFromCart = (id) => setCart(prev => {
    const ex = prev.find(i => i.id === id)
    if (!ex) return prev
    return ex.qty === 1 ? prev.filter(i => i.id !== id) : prev.map(i => i.id === id ? { ...i, qty: i.qty - 1 } : i)
  })

  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0)

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
    if (!sessionToken || !tableId) { setError('Masa tapılmadı. Geri qayıdıb masa nömrənizi daxil edin.'); return }
    setSubmitting(true); setError('')

    const { data: allowed } = await supabase.rpc('check_order_rate_limit', { p_session_token: sessionToken })
    if (!allowed) { setError('Çox tez-tez sifariş verdiniz. Bir az gözləyin.'); setSubmitting(false); return }

    const { data: newOrder, error: insErr } = await supabase.from('pending_orders').insert({
      business_id: business.id, branch_id: branchId || null,
      table_id: tableId, session_token: sessionToken,
      customer_token: customerToken,
      customer_name: customer.name.trim(),
      customer_phone: customer.phone.trim(),
      items: cart.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty })),
      total: cartTotal, note: note.trim() || null, order_status: 'pending',
    }).select().single()

    if (insErr) { setError(insErr.message); setSubmitting(false); return }

    await supabase.from('table_sessions').update({ last_order_at: new Date().toISOString() }).eq('session_token', sessionToken)

    if (loyaltyInfo?.id) {
      await supabase.from('loyalty_history').insert({
        member_id: loyaltyInfo.id, business_id: business.id,
        visit_date: new Date().toISOString().slice(0, 10), order_total: cartTotal,
      })
    }

    setMyOrders(prev => [newOrder, ...prev])
    setCart([])
    setSubmitting(false)
    setStep('tracking')
  }

  const theme = THEMES[business?.menu_theme] || THEMES.dark_glass
  const orderingEnabled = bSettings?.customer_ordering_enabled !== false
  const activeStages = bSettings?.status_stages || ['accepted', 'preparing', 'ready', 'delivered']

  if (loading) return <Ctr bg={THEMES.dark_glass.bg}>Yüklənir...</Ctr>
  if (notFound) return <Ctr bg={THEMES.dark_glass.bg}>Menyu tapılmadı.</Ctr>

  // Sifariş izləmə
  if (step === 'tracking') return (
    <div style={{ minHeight: '100vh', background: theme.bg, fontFamily: 'system-ui,sans-serif', padding: '40px 20px' }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 48 }}>🧾</div>
          <div style={{ color: theme.text, fontSize: 20, fontWeight: 800, marginTop: 10 }}>Sifarişlərim</div>
          <div style={{ color: theme.sub, fontSize: 13, marginTop: 4 }}>
            {tableSetupDone ? `Masa ${tableNumber}` : 'Mənim sifarişlərim'} · Real vaxtda yenilənir
          </div>
        </div>

        {myOrders.length === 0 ? (
          <div style={{ color: theme.sub, textAlign: 'center' }}>Sifariş tapılmadı.</div>
        ) : myOrders.map(order => {
          const st = STATUS_INFO[order.order_status] || STATUS_INFO.pending
          const stageIdx = activeStages.indexOf(order.order_status)
          return (
            <div key={order.id} style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 16, padding: 18, marginBottom: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div style={{ color: theme.text, fontWeight: 700 }}>#{order.id.slice(0, 6)}</div>
                <div style={{ padding: '5px 12px', borderRadius: 999, background: st.color + '22', color: st.color, fontWeight: 700, fontSize: 13 }}>
                  {st.icon} {st.label}
                </div>
              </div>

              {order.order_status !== 'rejected' && order.order_status !== 'pending' && (
                <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
                  {activeStages.map((s, i) => {
                    const si = STATUS_INFO[s]
                    const done = stageIdx >= i
                    return (
                      <div key={s} style={{ flex: 1 }}>
                        <div style={{ height: 4, borderRadius: 2, background: done ? si.color : theme.border }} />
                        <div style={{ textAlign: 'center', fontSize: 9, marginTop: 3, color: done ? si.color : theme.sub }}>{si.icon}</div>
                      </div>
                    )
                  })}
                </div>
              )}

              {(order.items || []).map((item, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: theme.sub, fontSize: 13, marginBottom: 3 }}>
                  <span>{item.name} × {item.qty}</span>
                  <span>₼{(item.price * item.qty).toFixed(2)}</span>
                </div>
              ))}
              <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 8, marginTop: 8, display: 'flex', justifyContent: 'space-between', color: theme.accent, fontWeight: 800 }}>
                <span>Cəmi</span><span>₼{Number(order.total).toFixed(2)}</span>
              </div>
            </div>
          )
        })}

        <button onClick={() => setStep('menu')}
          style={{ width: '100%', padding: 14, borderRadius: 12, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.sub, cursor: 'pointer', fontSize: 14, marginTop: 8 }}>
          ← Menyuya qayıt
        </button>
      </div>
    </div>
  )

  const activeCategory = categories.find(c => c.id === activeCat)

  return (
    <div style={{ minHeight: '100vh', background: theme.bg, fontFamily: 'system-ui,sans-serif', paddingBottom: tableSetupDone && cart.length > 0 ? 90 : 20 }}>
      {/* Hero */}
      <div style={{ background: theme.heroGrad, padding: '36px 20px 28px', color: '#fff' }}>
        {business.logo_url && <img src={business.logo_url} alt="logo" style={{ width: 56, height: 56, borderRadius: 14, objectFit: 'cover', marginBottom: 12, border: '2px solid rgba(255,255,255,0.3)' }} />}
        <div style={{ fontSize: 24, fontWeight: 800 }}>{business.name}</div>
        <div style={{ fontSize: 13, opacity: 0.75, marginTop: 4 }}>Rəqəmsal menyu</div>
        {tableSetupDone && tableNumber && (
          <div style={{ marginTop: 8, display: 'inline-block', background: 'rgba(255,255,255,0.15)', borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 700 }}>
            🪑 Masa {tableNumber}
          </div>
        )}
      </div>

      {/* Masa seçimi (URL-də table yoxdursa) */}
      {orderingEnabled && !tableSetupDone && (
        <div style={{ margin: '16px 20px 0', background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 14, padding: 16 }}>
          <div style={{ color: theme.text, fontWeight: 700, fontSize: 14, marginBottom: 8 }}>🪑 Masa nömrənizi daxil edin</div>
          <div style={{ color: theme.sub, fontSize: 12, marginBottom: 12 }}>Sifariş vermək üçün hansı masada oturduğunuzu göstərin.</div>
          {error && <div style={{ color: '#FF5A5F', fontSize: 12, marginBottom: 8 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              value={tableNumber}
              onChange={e => setTableNumber(e.target.value)}
              placeholder="Məs: 5"
              type="number"
              style={{ flex: 1, padding: '10px 14px', borderRadius: 10, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text, fontSize: 16, textAlign: 'center' }}
            />
            <button onClick={() => setupTable(tableNumber)} disabled={!tableNumber || tableSetupLoading}
              style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: tableNumber ? theme.accent : theme.border, color: '#001018', fontWeight: 700, cursor: tableNumber ? 'pointer' : 'not-allowed', fontSize: 14 }}>
              {tableSetupLoading ? '...' : 'Təsdiqlə'}
            </button>
          </div>
        </div>
      )}

      {/* Sifarişlərim düyməsi */}
      {myOrders.length > 0 && (
        <div style={{ padding: '12px 20px 0' }}>
          <button onClick={() => setStep('tracking')}
            style={{ width: '100%', padding: '10px 16px', borderRadius: 10, border: `1px solid ${theme.border}`, background: theme.card, color: theme.text, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>📋 Sifarişlərim ({myOrders.length})</span>
            <span style={{ color: STATUS_INFO[myOrders[0]?.order_status]?.color || theme.sub }}>
              {STATUS_INFO[myOrders[0]?.order_status]?.icon} {STATUS_INFO[myOrders[0]?.order_status]?.label}
            </span>
          </button>
        </div>
      )}

      {/* Kateqoriyalar */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '16px 20px', WebkitOverflowScrolling: 'touch' }}>
        {categories.map(c => (
          <button key={c.id} onClick={() => setActiveCat(c.id)}
            style={{ flexShrink: 0, padding: '8px 16px', borderRadius: 999, fontSize: 13, fontWeight: 600, border: `1px solid ${theme.border}`, cursor: 'pointer', background: activeCat === c.id ? theme.accent : theme.card, color: activeCat === c.id ? '#001018' : theme.text }}>
            {c.name}
          </button>
        ))}
      </div>

      {/* Məhsullar */}
      <div style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!orderingEnabled && (
          <div style={{ padding: '10px 14px', borderRadius: 10, background: theme.card, border: `1px solid ${theme.border}`, color: theme.sub, fontSize: 13, textAlign: 'center' }}>
            ℹ️ Bu restoran hazırda online sifariş qəbul etmir.
          </div>
        )}
        {(activeCategory?.products || []).length === 0 && (
          <div style={{ color: theme.sub, textAlign: 'center', padding: 20 }}>Bu kateqoriyada məhsul yoxdur.</div>
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
              {orderingEnabled && tableSetupDone && (
                inCart ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button onClick={() => removeFromCart(p.id)} style={{ width: 30, height: 30, borderRadius: 999, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text, fontWeight: 800, fontSize: 18, cursor: 'pointer' }}>−</button>
                    <span style={{ color: theme.text, fontWeight: 700, minWidth: 18, textAlign: 'center' }}>{inCart.qty}</span>
                    <button onClick={() => addToCart(p)} style={{ width: 30, height: 30, borderRadius: 999, border: 'none', background: theme.accent, color: '#001018', fontWeight: 800, fontSize: 18, cursor: 'pointer' }}>+</button>
                  </div>
                ) : (
                  <button onClick={() => addToCart(p)}
                    style={{ padding: '7px 14px', borderRadius: 999, border: 'none', background: theme.accent, color: '#001018', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    + Əlavə et
                  </button>
                )
              )}
            </div>
          )
        })}
      </div>

      {/* Sabit aşağı səbət */}
      {orderingEnabled && tableSetupDone && cart.length > 0 && step === 'menu' && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '12px 20px', background: theme.bg, borderTop: `1px solid ${theme.border}` }}>
          <button onClick={() => setStep('register')}
            style={{ width: '100%', padding: 14, borderRadius: 12, border: 'none', background: theme.accent, color: '#001018', fontWeight: 800, fontSize: 15, cursor: 'pointer' }}>
            🛒 Sifarişi göndər — ₼{cartTotal.toFixed(2)} · {cart.reduce((s, i) => s + i.qty, 0)} məhsul
          </button>
        </div>
      )}

      {/* Müştəri forması */}
      {step === 'register' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'flex-end', zIndex: 200 }}>
          <div style={{ background: theme.card === 'rgba(255,255,255,0.06)' ? '#131B30' : theme.card, padding: 24, borderRadius: '20px 20px 0 0', width: '100%', boxSizing: 'border-box', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ width: 36, height: 4, borderRadius: 2, background: theme.border, margin: '0 auto 16px' }} />
            <h3 style={{ color: theme.text, margin: '0 0 4px', fontSize: 17, fontWeight: 800 }}>Sifariş məlumatları</h3>
            <p style={{ color: theme.sub, fontSize: 12, margin: '0 0 16px' }}>Masa {tableNumber} · ₼{cartTotal.toFixed(2)}</p>

            {loyaltyInfo && (
              <div style={{ background: theme.accent + '22', border: `1px solid ${theme.accent}44`, borderRadius: 10, padding: 10, marginBottom: 14 }}>
                <div style={{ color: theme.accent, fontSize: 12, fontWeight: 700 }}>🎁 Loyallıq üzvü: {loyaltyInfo.full_name} · {loyaltyInfo.total_visits} ziyarət</div>
              </div>
            )}

            {error && <div style={{ color: '#FF5A5F', fontSize: 12, marginBottom: 10, padding: '8px 12px', background: 'rgba(255,90,95,.1)', borderRadius: 8 }}>{error}</div>}

            <div style={{ marginBottom: 14, background: theme.border + '44', borderRadius: 10, padding: 10 }}>
              {cart.map(i => (
                <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: theme.sub, marginBottom: 4 }}>
                  <span>{i.name} × {i.qty}</span>
                  <span style={{ color: theme.text }}>₼{(i.price * i.qty).toFixed(2)}</span>
                </div>
              ))}
              <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 6, marginTop: 6, display: 'flex', justifyContent: 'space-between', color: theme.text, fontWeight: 700 }}>
                <span>Cəmi</span><span>₼{cartTotal.toFixed(2)}</span>
              </div>
            </div>

            <input value={customer.name} onChange={e => setCustomer(p => ({ ...p, name: e.target.value }))}
              placeholder="Ad Soyad *"
              style={{ width: '100%', padding: 12, borderRadius: 10, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text, marginBottom: 10, boxSizing: 'border-box', fontSize: 14 }} />

            <input value={customer.phone}
              onChange={e => { setCustomer(p => ({ ...p, phone: e.target.value })); checkLoyalty(e.target.value) }}
              placeholder="Telefon (+994...) *"
              style={{ width: '100%', padding: 12, borderRadius: 10, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text, marginBottom: 10, boxSizing: 'border-box', fontSize: 14 }} />

            <textarea value={note} onChange={e => setNote(e.target.value)}
              placeholder="Qeyd (allergiya, xüsusi istək...)" rows={2}
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

function Ctr({ bg, children }) {
  return <div style={{ minHeight: '100vh', background: bg, color: '#9AA4BC', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui,sans-serif', fontSize: 16 }}>{children}</div>
}