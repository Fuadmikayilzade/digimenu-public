import React, { useEffect, useState, useRef } from 'react'
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
  let t = sessionStorage.getItem('dg_ct')
  if (!t) { t = Math.random().toString(36).slice(2) + Date.now(); sessionStorage.setItem('dg_ct', t) }
  return t
}

export default function MenuPage() {
  const { slug } = useParams()
  const [sp] = useSearchParams()
  const branchId = sp.get('branch')
  const urlTable = sp.get('table')

  const [biz, setBiz] = useState(null)
  const [bSettings, setBSettings] = useState(null)
  const [cats, setCats] = useState([])
  const [activeCat, setActiveCat] = useState(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  // Masa
  const [tableNum, setTableNum] = useState(urlTable || '')
  const [tableReady, setTableReady] = useState(false)
  const [tableLoading, setTableLoading] = useState(false)
  const [tableErr, setTableErr] = useState('')

  // Sifariş
  const [step, setStep] = useState('menu')
  const [cart, setCart] = useState([])
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [noteText, setNoteText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [orderErr, setOrderErr] = useState('')
  const [myOrders, setMyOrders] = useState([])

  const cTok = getCustomerToken()
  const pollRef = useRef(null)

  useEffect(() => { init() }, [slug])

  // Realtime + polling
  useEffect(() => {
    if (!biz?.id) return

    // Hər 4 saniyədə sifarişləri yenilə (Realtime olmadan da işləyir)
    pollRef.current = setInterval(async () => {
      const { data } = await supabase
        .from('pending_orders')
        .select('*')
        .eq('business_id', biz.id)
        .eq('customer_token', cTok)
        .order('created_at', { ascending: false })
      if (data) setMyOrders(data)
    }, 4000)

    // Realtime (əgər aktiv edilibsə bonus kimi)
    const ch = supabase
      .channel(`menu_orders_${cTok}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'pending_orders',
        filter: `customer_token=eq.${cTok}`,
      }, payload => {
        setMyOrders(prev =>
          prev.map(o => o.id === payload.new.id ? { ...o, ...payload.new } : o)
        )
      })
      .subscribe()

    return () => {
      clearInterval(pollRef.current)
      supabase.removeChannel(ch)
    }
  }, [biz])

  const init = async () => {
    const { data: b } = await supabase
      .from('businesses').select('*').eq('slug', slug).maybeSingle()
    if (!b) { setNotFound(true); setLoading(false); return }
    setBiz(b)

    const [{ data: s }, { data: cData }, { data: orders }] = await Promise.all([
      supabase.from('business_settings').select('*').eq('business_id', b.id).maybeSingle(),
      branchId
        ? supabase.from('categories').select('*, products(*)').eq('business_id', b.id).eq('branch_id', branchId).order('sort_order')
        : supabase.from('categories').select('*, products(*)').eq('business_id', b.id).is('branch_id', null).order('sort_order'),
      supabase.from('pending_orders').select('*').eq('business_id', b.id).eq('customer_token', cTok).order('created_at', { ascending: false }),
    ])

    setBSettings(s)
    const visible = (cData || []).map(c => ({ ...c, products: (c.products || []).filter(p => p.is_active) })).filter(c => c.products.length > 0)
    setCats(visible)
    if (visible.length) setActiveCat(visible[0].id)
    setMyOrders(orders || [])

    if (urlTable) await setupTable(urlTable, b)
    setLoading(false)
  }

  const setupTable = async (num, bizObj) => {
    const b = bizObj || biz
    if (!b?.id || !num) return
    setTableLoading(true); setTableErr('')

    const { data: allT } = await supabase
      .from('tables').select('id, number').eq('business_id', b.id)

    const n = String(num).trim()
    let found = null
    for (const v of [n, n.padStart(2, '0'), String(parseInt(n) || 0)]) {
      found = (allT || []).find(t => String(t.number).trim() === v)
      if (found) break
    }

    if (!found) {
      const nums = [...new Set((allT || []).map(t => t.number))].sort((a,b) => Number(a)-Number(b)).join(', ')
      setTableErr(`Masa "${num}" tapılmadı. Mövcud masalar: ${nums}`)
      setTableLoading(false)
      return
    }

    // Sessiya
    let sTok = null
    const { data: existSess } = await supabase
      .from('table_sessions').select('session_token')
      .eq('table_id', found.id).eq('is_active', true)
      .gt('expires_at', new Date().toISOString()).limit(1)

    if (existSess?.[0]) {
      sTok = existSess[0].session_token
    } else {
      const { data: ns } = await supabase.from('table_sessions')
        .insert({ business_id: b.id, table_id: found.id })
        .select('session_token').single()
      sTok = ns?.session_token
    }

    if (sTok) {
      sessionStorage.setItem('dg_table_id', found.id)
      sessionStorage.setItem('dg_session_tok', sTok)
    }
    setTableReady(true)
    setTableLoading(false)
  }

  const handleTableConfirm = async () => {
    if (!tableNum.trim()) return
    await setupTable(tableNum.trim())
  }

  const addToCart = p => setCart(prev => {
    const ex = prev.find(i => i.id === p.id)
    return ex ? prev.map(i => i.id === p.id ? { ...i, qty: i.qty + 1 } : i)
              : [...prev, { ...p, qty: 1 }]
  })

  const removeFromCart = id => setCart(prev => {
    const ex = prev.find(i => i.id === id)
    if (!ex) return prev
    return ex.qty === 1 ? prev.filter(i => i.id !== id) : prev.map(i => i.id === id ? { ...i, qty: i.qty - 1 } : i)
  })

  const cartTotal = cart.reduce((s, i) => s + i.price * i.qty, 0)
  const cartCount = cart.reduce((s, i) => s + i.qty, 0)

  const submitOrder = async () => {
    if (!name.trim()) { setOrderErr('Adınızı yazın'); return }
    if (!phone.trim()) { setOrderErr('Telefon nömrənizi yazın'); return }
    if (!cart.length) { setOrderErr('Səbət boşdur'); return }
    if (!biz?.id || !tableNum) { setOrderErr('Masa seçilməyib.'); return }
    setSubmitting(true); setOrderErr('')

    // Masanı Supabase-dən al
    const { data: allT } = await supabase.from('tables').select('id, number').eq('business_id', biz.id)
    const n = String(tableNum).trim()
    let found = null
    for (const v of [n, n.padStart(2,'0'), String(parseInt(n)||0)]) {
      found = (allT||[]).find(t => String(t.number).trim() === v)
      if (found) break
    }
    if (!found) { setOrderErr(`Masa ${n} tapılmadı.`); setSubmitting(false); return }

    // Sessiya
    let sTok = sessionStorage.getItem('dg_session_tok')
    if (!sTok) {
      const { data: sess } = await supabase.from('table_sessions').select('session_token')
        .eq('table_id', found.id).eq('is_active', true)
        .gt('expires_at', new Date().toISOString()).limit(1)
      if (sess?.[0]) {
        sTok = sess[0].session_token
      } else {
        const { data: ns } = await supabase.from('table_sessions')
          .insert({ business_id: biz.id, table_id: found.id })
          .select('session_token').single()
        sTok = ns?.session_token
      }
    }
    if (!sTok) { setOrderErr('Sessiya yaradıla bilmədi.'); setSubmitting(false); return }

    const { data: newOrder, error: insErr } = await supabase.from('pending_orders').insert({
      business_id: biz.id, branch_id: branchId || null,
      table_id: found.id, session_token: sTok,
      customer_token: cTok,
      customer_name: name.trim(), customer_phone: phone.trim(),
      items: cart.map(i => ({ id: i.id, name: i.name, price: i.price, qty: i.qty })),
      total: cartTotal, note: noteText.trim() || null,
      order_status: 'pending', status: 'pending',
    }).select().single()

    if (insErr) { setOrderErr(insErr.message); setSubmitting(false); return }

    await supabase.from('table_sessions').update({ last_order_at: new Date().toISOString() }).eq('session_token', sTok)
    setMyOrders(p => [newOrder, ...p])
    setCart([])
    setSubmitting(false)
    setStep('tracking')
  }

  const theme = THEMES[biz?.menu_theme] || THEMES.dark_glass
  const orderingEnabled = bSettings?.customer_ordering_enabled !== false
  const activeStages = bSettings?.status_stages || ['accepted','preparing','ready','delivered']

  if (loading) return <Ctr bg="#0B1020">Yüklənir...</Ctr>
  if (notFound) return <Ctr bg="#0B1020">Menyu tapılmadı.</Ctr>

  // ── STATUS İZLƏMƏ ────────────────────────────────────────────────
  if (step === 'tracking') {
    const hasActive = myOrders.some(o => ['accepted','preparing','ready','delivered'].includes(o.order_status))
    return (
      <div style={{ minHeight: '100vh', background: theme.bg, fontFamily: 'system-ui,sans-serif', padding: '40px 20px' }}>
        <div style={{ maxWidth: 480, margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <div style={{ fontSize: 48 }}>🧾</div>
            <div style={{ color: theme.text, fontSize: 20, fontWeight: 800, marginTop: 10 }}>Sifarişlərim</div>
            <div style={{ color: theme.sub, fontSize: 13, marginTop: 4 }}>
              Masa {tableNum} · Avtomatik yenilənir
            </div>
          </div>

          {/* Ödəniş düyməsi — sifariş qəbul edilən kimi */}
          {hasActive && (
            <a href={`/pay/${slug}?table=${tableNum}`}
              style={{ display: 'block', padding: 16, borderRadius: 14, background: 'linear-gradient(135deg,#00E6A8,#2C5BE0)', color: '#001018', fontWeight: 800, fontSize: 16, textAlign: 'center', textDecoration: 'none', marginBottom: 16 }}>
              💳 Online Ödəniş et
            </a>
          )}

          {myOrders.length === 0 ? (
            <div style={{ color: theme.sub, textAlign: 'center', padding: 20 }}>Sifariş tapılmadı.</div>
          ) : myOrders.map(ord => {
            const st = STATUS_INFO[ord.order_status] || STATUS_INFO.pending
            const idx = activeStages.indexOf(ord.order_status)
            return (
              <div key={ord.id} style={{ background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 16, padding: 18, marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div style={{ color: theme.sub, fontSize: 12 }}>#{ord.id.slice(0,6)} · {new Date(ord.created_at).toLocaleTimeString('az')}</div>
                  <div style={{ padding: '5px 12px', borderRadius: 999, background: st.color + '22', color: st.color, fontWeight: 700, fontSize: 13 }}>
                    {st.icon} {st.label}
                  </div>
                </div>

                {/* Progress bar */}
                {idx >= 0 && (
                  <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
                    {activeStages.map((s, i) => {
                      const si = STATUS_INFO[s]
                      const done = idx >= i
                      return (
                        <div key={s} style={{ flex: 1 }}>
                          <div style={{ height: 4, borderRadius: 2, background: done ? si.color : theme.border, transition: 'background 0.3s' }} />
                          <div style={{ textAlign: 'center', fontSize: 10, marginTop: 3, color: done ? si.color : theme.sub }}>{si.icon}</div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {(ord.items || []).map((it, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: theme.sub, fontSize: 13, marginBottom: 3 }}>
                    <span>{it.name} × {it.qty}</span>
                    <span>₼{(it.price * it.qty).toFixed(2)}</span>
                  </div>
                ))}
                <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 8, marginTop: 8, display: 'flex', justifyContent: 'space-between', color: theme.accent, fontWeight: 800 }}>
                  <span>Cəmi</span><span>₼{Number(ord.total).toFixed(2)}</span>
                </div>
              </div>
            )
          })}

          <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
            <button onClick={() => setStep('menu')}
              style={{ flex: 1, padding: 14, borderRadius: 12, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.sub, cursor: 'pointer', fontSize: 14 }}>
              ← Menyuya qayıt
            </button>
            <button onClick={async () => {
              const { data } = await supabase.from('pending_orders').select('*')
                .eq('business_id', biz.id).eq('customer_token', cTok).order('created_at', { ascending: false })
              if (data) setMyOrders(data)
            }}
              style={{ padding: '14px 20px', borderRadius: 12, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.sub, cursor: 'pointer', fontSize: 14 }}>
              🔄
            </button>
          </div>
        </div>
      </div>
    )
  }

  const activeCatData = cats.find(c => c.id === activeCat)

  // ── ƏSAS MENYU ──────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: theme.bg, fontFamily: 'system-ui,sans-serif', paddingBottom: tableReady && cart.length ? 90 : 20 }}>

      {/* Hero */}
      <div style={{ background: theme.heroGrad, padding: '36px 20px 28px' }}>
        {biz.logo_url && <img src={biz.logo_url} alt="" style={{ width: 56, height: 56, borderRadius: 14, objectFit: 'cover', marginBottom: 12, border: '2px solid rgba(255,255,255,0.3)' }} />}
        <div style={{ color: '#fff', fontSize: 24, fontWeight: 800 }}>{biz.name}</div>
        <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, marginTop: 4 }}>Rəqəmsal menyu</div>
        {tableReady && <div style={{ marginTop: 8, display: 'inline-block', background: 'rgba(255,255,255,0.15)', borderRadius: 999, padding: '4px 12px', fontSize: 12, fontWeight: 700, color: '#fff' }}>🪑 Masa {tableNum}</div>}
      </div>

      {/* Masa seçimi */}
      {!tableReady && (
        <div style={{ margin: 20, background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 16, padding: 20 }}>
          <div style={{ color: theme.text, fontWeight: 800, fontSize: 16, marginBottom: 6 }}>🪑 Masanızı seçin</div>
          <div style={{ color: theme.sub, fontSize: 13, marginBottom: 16 }}>Sifariş vermək üçün masa nömrənizi daxil edin.</div>
          {tableErr && <div style={{ color: '#FF5A5F', fontSize: 12, marginBottom: 10, padding: '8px 12px', background: 'rgba(255,90,95,.1)', borderRadius: 8 }}>{tableErr}</div>}
          <div style={{ display: 'flex', gap: 10 }}>
            <input value={tableNum} onChange={e => setTableNum(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleTableConfirm()}
              placeholder="Masa nömrəsi (məs: 3)" type="number" min="1"
              style={{ flex: 1, padding: '14px 16px', borderRadius: 12, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text, fontSize: 18, textAlign: 'center', fontWeight: 700 }} />
            <button onClick={handleTableConfirm} disabled={!tableNum || tableLoading}
              style={{ padding: '14px 22px', borderRadius: 12, border: 'none', background: tableNum ? theme.accent : theme.border, color: '#001018', fontWeight: 800, fontSize: 15, cursor: tableNum ? 'pointer' : 'default' }}>
              {tableLoading ? '...' : '✓'}
            </button>
          </div>
        </div>
      )}

      {/* Sifarişlərim düyməsi */}
      {myOrders.length > 0 && (
        <div style={{ padding: '12px 20px 0' }}>
          <button onClick={() => setStep('tracking')}
            style={{ width: '100%', padding: '12px 16px', borderRadius: 12, border: `1px solid ${theme.border}`, background: theme.card, color: theme.text, fontSize: 13, fontWeight: 600, cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>📋 Sifarişlərim ({myOrders.length})</span>
            <span style={{ color: STATUS_INFO[myOrders[0]?.order_status]?.color || theme.sub }}>
              {STATUS_INFO[myOrders[0]?.order_status]?.icon} {STATUS_INFO[myOrders[0]?.order_status]?.label}
            </span>
          </button>
        </div>
      )}

      {/* Kateqoriyalar */}
      <div style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '16px 20px', scrollbarWidth: 'none' }}>
        {cats.map(c => (
          <button key={c.id} onClick={() => setActiveCat(c.id)}
            style={{ flexShrink: 0, padding: '8px 18px', borderRadius: 999, fontSize: 13, fontWeight: 600, border: `1px solid ${theme.border}`, cursor: 'pointer', background: activeCat === c.id ? theme.accent : theme.card, color: activeCat === c.id ? '#001018' : theme.text }}>
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
        {(activeCatData?.products || []).map(p => {
          const inCart = cart.find(i => i.id === p.id)
          return (
            <div key={p.id} style={{ display: 'flex', gap: 12, background: theme.card, border: `1px solid ${theme.border}`, borderRadius: 16, padding: 12, alignItems: 'center' }}>
              {p.image_url
                ? <img src={p.image_url} alt={p.name} style={{ width: 64, height: 64, borderRadius: 12, objectFit: 'cover', flexShrink: 0 }} />
                : <div style={{ width: 64, height: 64, borderRadius: 12, background: theme.border, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>🍽</div>
              }
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: theme.text, fontWeight: 700, fontSize: 14 }}>{p.name}</div>
                {p.description && <div style={{ color: theme.sub, fontSize: 12, marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description}</div>}
                <div style={{ color: theme.accent, fontWeight: 800, fontSize: 16, marginTop: 4 }}>₼{p.price}</div>
              </div>
              {orderingEnabled && tableReady && (
                inCart ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                    <button onClick={() => removeFromCart(p.id)} style={{ width: 32, height: 32, borderRadius: 999, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text, fontWeight: 800, fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>−</button>
                    <span style={{ color: theme.text, fontWeight: 700, fontSize: 16, minWidth: 20, textAlign: 'center' }}>{inCart.qty}</span>
                    <button onClick={() => addToCart(p)} style={{ width: 32, height: 32, borderRadius: 999, border: 'none', background: theme.accent, color: '#001018', fontWeight: 800, fontSize: 20, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>+</button>
                  </div>
                ) : (
                  <button onClick={() => addToCart(p)} style={{ padding: '8px 16px', borderRadius: 999, border: 'none', background: theme.accent, color: '#001018', fontWeight: 700, fontSize: 13, cursor: 'pointer', flexShrink: 0 }}>
                    + Əlavə et
                  </button>
                )
              )}
            </div>
          )
        })}
      </div>

      {/* Sabit aşağı səbət */}
      {orderingEnabled && tableReady && cart.length > 0 && step === 'menu' && (
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, padding: '14px 20px', background: theme.bg, borderTop: `1px solid ${theme.border}` }}>
          <button onClick={() => setStep('register')}
            style={{ width: '100%', padding: 16, borderRadius: 14, border: 'none', background: theme.accent, color: '#001018', fontWeight: 800, fontSize: 16, cursor: 'pointer' }}>
            🛒 Sifarişi göndər — ₼{cartTotal.toFixed(2)} · {cartCount} məhsul
          </button>
        </div>
      )}

      {/* Müştəri forması */}
      {step === 'register' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'flex-end', zIndex: 300 }}>
          <div style={{ background: theme.bg === '#0B1020' ? '#131B30' : theme.card, padding: 24, borderRadius: '22px 22px 0 0', width: '100%', boxSizing: 'border-box', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: theme.border, margin: '0 auto 20px' }} />
            <div style={{ color: theme.text, fontSize: 18, fontWeight: 800, marginBottom: 4 }}>Sifariş məlumatları</div>
            <div style={{ color: theme.sub, fontSize: 13, marginBottom: 18 }}>Masa {tableNum} · ₼{cartTotal.toFixed(2)}</div>

            {orderErr && <div style={{ color: '#FF5A5F', fontSize: 13, marginBottom: 12, padding: '10px 14px', background: 'rgba(255,90,95,.1)', borderRadius: 10 }}>{orderErr}</div>}

            {/* Səbət */}
            <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 12, padding: 14, marginBottom: 16 }}>
              {cart.map(i => (
                <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', color: theme.sub, fontSize: 13, marginBottom: 5 }}>
                  <span>{i.name} × {i.qty}</span>
                  <span style={{ color: theme.text, fontWeight: 600 }}>₼{(i.price * i.qty).toFixed(2)}</span>
                </div>
              ))}
              <div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 8, marginTop: 8, display: 'flex', justifyContent: 'space-between', fontWeight: 800, color: theme.accent, fontSize: 15 }}>
                <span>Cəmi</span><span>₼{cartTotal.toFixed(2)}</span>
              </div>
            </div>

            <input value={name} onChange={e => setName(e.target.value)} placeholder="Ad Soyad *"
              style={{ width: '100%', padding: 14, borderRadius: 12, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text, marginBottom: 10, boxSizing: 'border-box', fontSize: 15 }} />
            <input value={phone} onChange={e => setPhone(e.target.value)} placeholder="Telefon (+994...) *"
              style={{ width: '100%', padding: 14, borderRadius: 12, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text, marginBottom: 10, boxSizing: 'border-box', fontSize: 15 }} />
            <textarea value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="Qeyd (allergiya, xüsusi istək...)" rows={2}
              style={{ width: '100%', padding: 14, borderRadius: 12, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text, marginBottom: 18, boxSizing: 'border-box', resize: 'none', fontSize: 15 }} />

            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={submitOrder} disabled={submitting}
                style={{ flex: 2, padding: 16, borderRadius: 14, border: 'none', background: theme.accent, color: '#001018', fontWeight: 800, fontSize: 15, cursor: submitting ? 'not-allowed' : 'pointer', opacity: submitting ? 0.7 : 1 }}>
                {submitting ? 'Göndərilir...' : '✅ Sifarişi Göndər'}
              </button>
              <button onClick={() => { setStep('menu'); setOrderErr('') }}
                style={{ flex: 1, padding: 16, borderRadius: 14, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.sub, cursor: 'pointer', fontSize: 15 }}>
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
  return <div style={{ minHeight: '100vh', background: bg, color: '#9AA4BC', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui', fontSize: 16 }}>{children}</div>
}