import React, { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from './supabaseClient'
import { initiatePayment, GATEWAY, GATEWAY_LABEL } from './paymentGateway'

function getCustomerToken() {
  let t = sessionStorage.getItem('dg_ct')
  if (!t) { t = Math.random().toString(36).slice(2) + Date.now(); sessionStorage.setItem('dg_ct', t) }
  return t
}

const T = { bg:'#0B1020', card:'rgba(255,255,255,0.06)', border:'rgba(255,255,255,0.12)', text:'#FFFFFF', sub:'#9AA4BC', accent:'#00E6A8', blue:'#2C5BE0' }

async function clearTableStatus(tableId, bizId) {
  if (!tableId || !bizId) return
  const todayStr = new Date().toISOString().slice(0, 10)
  const nowTime = new Date().toTimeString().slice(0, 5)
  const { data: futureRes } = await supabase
    .from('reservations').select('id, reserved_date, reserved_time')
    .eq('business_id', bizId).gte('reserved_date', todayStr)
  const hasRes = (futureRes || []).some(r => {
    if (r.reserved_date > todayStr) return true
    if (!r.reserved_time) return true
    return r.reserved_time >= nowTime
  })
  await supabase.from('tables')
    .update({ status: hasRes ? 'rezerv' : 'boş' })
    .eq('id', tableId)
}

export default function PaymentPage() {
  const { slug } = useParams()
  const [sp] = useSearchParams()
  const tableParam = sp.get('table')
  const sessionParam = sp.get('session')

  const [biz, setBiz] = useState(null)
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [payMode, setPayMode] = useState('full')
  const [payMethod, setPayMethod] = useState(null)
  const [selectedItems, setSelectedItems] = useState({})
  const [cardNum, setCardNum] = useState('')
  const [cardExp, setCardExp] = useState('')
  const [cardCvv, setCardCvv] = useState('')
  const [cardName, setCardName] = useState('')
  const [processing, setProcessing] = useState(false)
  const [step, setStep] = useState('choose')
  const [result, setResult] = useState(null)

  const cTok = getCustomerToken()

  useEffect(() => { init() }, [slug])

  const init = async () => {
    const { data: b } = await supabase.from('businesses').select('*').eq('slug', slug).maybeSingle()
    if (!b) { setLoading(false); return }
    setBiz(b)

    let q = supabase.from('pending_orders').select('*')
      .eq('business_id', b.id)
      .not('order_status', 'in', '("rejected","pending")')
    if (sessionParam) q = q.eq('session_token', sessionParam)
    else q = q.eq('customer_token', cTok)

    const { data: ords } = await q.order('created_at')
    setOrders(ords || [])
    setLoading(false)
  }

  const allItems = orders.flatMap((o) =>
    (o.items || []).map((item, ii) => ({
      ...item,
      orderId: o.id,
      tableId: o.table_id,
      itemIdx: ii,
      key: `${o.id}_${ii}`,
      alreadyPaid: o.paid_item_keys?.includes(`${o.id}_${ii}`) || false,
    }))
  )

  const unpaidItems = allItems.filter(i => !i.alreadyPaid)
  const selectedTotal = unpaidItems.filter(i => selectedItems[i.key]).reduce((s, i) => s + i.price * i.qty, 0)
  const fullTotal = orders.reduce((s, o) => s + Number(o.total), 0)
  const alreadyPaidTotal = allItems.filter(i => i.alreadyPaid).reduce((s, i) => s + i.price * i.qty, 0)
  const remainingTotal = fullTotal - alreadyPaidTotal
  const payAmount = payMode === 'full' ? remainingTotal : selectedTotal

  const tableId = orders.find(o => o.table_id)?.table_id || null

  const toggleItem = (key) => setSelectedItems(prev => ({ ...prev, [key]: !prev[key] }))
  const selectAll = () => { const a = {}; unpaidItems.forEach(i => { a[i.key] = true }); setSelectedItems(a) }

  const handlePay = async (method = payMethod) => {
    setProcessing(true)
    try {
      const res = await initiatePayment({
        amount: payAmount,
        orderId: orders.map(o => o.id).join(','),
        customerName: orders[0]?.customer_name || '',
        description: `DigiMenu - ${biz?.name} - Masa ${tableParam}`,
        method,
      })

      if (res.success) {
        const paidKeys = payMode === 'full'
          ? allItems.map(i => i.key)
          : unpaidItems.filter(i => selectedItems[i.key]).map(i => i.key)

        // Ödənişi qeydə al
        await supabase.from('payments').insert({
          business_id: biz.id,
          customer_token: cTok,
          customer_name: orders[0]?.customer_name,
          amount: payAmount,
          payment_type: payMode,
          status: 'paid',
          gateway: GATEWAY,
          gateway_ref: res.ref,
          order_ids: orders.map(o => o.id),
          paid_item_keys: paidKeys,
        })

        if (payMode === 'full') {
          // Bütün sifarişlər ödənildi
          await supabase.from('pending_orders')
            .update({ payment_status: 'paid' })
            .in('id', orders.map(o => o.id))

          // Masanı boşalt
          if (tableId) await clearTableStatus(tableId, biz.id)

        } else {
          // Split — hər sifariş üçün ödənilmiş məhsulları yenilə
          for (const order of orders) {
            const newPaidKeys = [
              ...(order.paid_item_keys || []),
              ...paidKeys.filter(k => k.startsWith(order.id)),
            ]
            const orderItems = (order.items || []).map((_, ii) => `${order.id}_${ii}`)
            const allPaid = orderItems.every(k => newPaidKeys.includes(k))

            await supabase.from('pending_orders')
              .update({
                paid_item_keys: newPaidKeys,
                payment_status: allPaid ? 'paid' : 'partial',
              })
              .eq('id', order.id)
          }

          // Bütün məhsullar ödənilibmi?
          const allOrdersPaid = orders.every(o => {
            const orderKeys = (o.items || []).map((_, ii) => `${o.id}_${ii}`)
            const paidForOrder = [
              ...(o.paid_item_keys || []),
              ...paidKeys.filter(k => k.startsWith(o.id)),
            ]
            return orderKeys.every(k => paidForOrder.includes(k))
          })

          if (allOrdersPaid && tableId) await clearTableStatus(tableId, biz.id)
        }

        setResult(res)
        setStep('done')
      } else {
        setResult({ message: res.message || 'Xəta baş verdi' })
        setStep('error')
      }
    } catch (e) {
      setResult({ message: e.message })
      setStep('error')
    }
    setProcessing(false)
  }

  const formatCard = v => v.replace(/\D/g,'').slice(0,16).replace(/(.{4})/g,'$1 ').trim()
  const formatExp = v => { const d = v.replace(/\D/g,'').slice(0,4); return d.length >= 3 ? d.slice(0,2)+'/'+d.slice(2) : d }

  if (loading) return <Ctr>Yüklənir...</Ctr>
  if (!biz) return <Ctr>Biznes tapılmadı.</Ctr>

  if (step === 'done') return (
    <Ctr>
      <div style={{ textAlign:'center', maxWidth:380, padding:24 }}>
        <div style={{ fontSize:80, marginBottom:20 }}>✅</div>
        <div style={{ color:T.text, fontSize:24, fontWeight:800 }}>Ödəniş tamamlandı!</div>
        <div style={{ color:T.sub, fontSize:15, marginTop:10 }}>₼{payAmount.toFixed(2)} · {biz.name}</div>
        {result?.ref && <div style={{ color:T.accent, fontSize:12, marginTop:10, fontFamily:'monospace', padding:'8px 14px', background:T.card, borderRadius:8 }}>Ref: {result.ref}</div>}
        <div style={{ color:T.sub, fontSize:13, marginTop:10 }}>{result?.message}</div>
      </div>
    </Ctr>
  )

  if (step === 'error') return (
    <Ctr>
      <div style={{ textAlign:'center', maxWidth:380, padding:24 }}>
        <div style={{ fontSize:80, marginBottom:20 }}>❌</div>
        <div style={{ color:'#FF5A5F', fontSize:22, fontWeight:800 }}>Ödəniş uğursuz</div>
        <div style={{ color:T.sub, fontSize:13, marginTop:10 }}>{result?.message}</div>
        <button onClick={() => setStep('choose')} style={accentBtn}>Yenidən cəhd et</button>
      </div>
    </Ctr>
  )

  return (
    <div style={{ minHeight:'100vh', background:T.bg, fontFamily:'system-ui,sans-serif', display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
      <div style={{ width:'100%', maxWidth:440 }}>

        <div style={{ textAlign:'center', marginBottom:24 }}>
          <div style={{ fontSize:44, marginBottom:10 }}>💳</div>
          <div style={{ color:T.text, fontSize:20, fontWeight:800 }}>{biz.name}</div>
          <div style={{ color:T.sub, fontSize:13, marginTop:4 }}>
            {tableParam && `Masa ${tableParam} · `}{GATEWAY_LABEL[GATEWAY]}
          </div>
          {alreadyPaidTotal > 0 && (
            <div style={{ color:T.accent, fontSize:12, marginTop:6 }}>✅ Artıq ödənilib: ₼{alreadyPaidTotal.toFixed(2)}</div>
          )}
        </div>

        {orders.length === 0 ? (
          <div style={{ ...cBox, textAlign:'center', color:T.sub, padding:32 }}>Ödənilməmiş sifariş tapılmadı.</div>
        ) : unpaidItems.length === 0 ? (
          <div style={{ ...cBox, textAlign:'center', color:T.accent, padding:32 }}>✅ Bütün sifarişlər ödənilib!</div>
        ) : (
          <>
            {/* STEP: CHOOSE */}
            {step === 'choose' && (
              <>
                <div style={{ display:'flex', gap:10, marginBottom:16 }}>
                  {[
                    { k:'full', icon:'💰', label:'Hamısını ödə', desc:`₼${remainingTotal.toFixed(2)}` },
                    { k:'split', icon:'✂️', label:'Öz payımı seç', desc:'Məhsul seçin' },
                  ].map(opt => (
                    <button key={opt.k} onClick={() => setPayMode(opt.k)}
                      style={{ flex:1, padding:16, borderRadius:14, border:`2px solid ${payMode===opt.k ? T.accent : T.border}`, background:payMode===opt.k ? T.accent+'15' : T.card, cursor:'pointer', textAlign:'center' }}>
                      <div style={{ fontSize:22, marginBottom:4 }}>{opt.icon}</div>
                      <div style={{ color:payMode===opt.k ? T.accent : T.text, fontWeight:700, fontSize:13 }}>{opt.label}</div>
                      <div style={{ color:T.sub, fontSize:12, marginTop:2 }}>{opt.desc}</div>
                    </button>
                  ))}
                </div>

                {payMode === 'full' && (
                  <div style={cBox}>
                    <div style={{ color:T.sub, fontSize:12, marginBottom:10 }}>Ödəniləcək sifarişlər:</div>
                    {unpaidItems.map((it, i) => (
                      <div key={i} style={{ display:'flex', justifyContent:'space-between', color:T.sub, fontSize:13, marginBottom:4 }}>
                        <span>{it.name} × {it.qty}</span>
                        <span style={{ color:T.text }}>₼{(it.price*it.qty).toFixed(2)}</span>
                      </div>
                    ))}
                    <div style={{ borderTop:`1px solid ${T.border}`, paddingTop:10, marginTop:8, display:'flex', justifyContent:'space-between', color:T.accent, fontWeight:800, fontSize:16 }}>
                      <span>Cəmi</span><span>₼{remainingTotal.toFixed(2)}</span>
                    </div>
                  </div>
                )}

                {payMode === 'split' && (
                  <div style={cBox}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
                      <div style={{ color:T.sub, fontSize:12 }}>Ödəmək istədiyiniz məhsulları seçin:</div>
                      <button onClick={selectAll} style={{ background:'none', border:'none', color:T.accent, fontSize:12, cursor:'pointer', fontWeight:700 }}>Hamısını seç</button>
                    </div>
                    {unpaidItems.map(it => {
                      const checked = !!selectedItems[it.key]
                      return (
                        <div key={it.key} onClick={() => toggleItem(it.key)}
                          style={{ display:'flex', alignItems:'center', gap:12, padding:'10px 0', borderBottom:`1px solid ${T.border}`, cursor:'pointer' }}>
                          <div style={{ width:22, height:22, borderRadius:6, border:`2px solid ${checked ? T.accent : T.border}`, background:checked ? T.accent : 'transparent', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, transition:'all 0.15s' }}>
                            {checked && <span style={{ color:'#001018', fontSize:13, fontWeight:800 }}>✓</span>}
                          </div>
                          <div style={{ flex:1 }}>
                            <div style={{ color:T.text, fontSize:13, fontWeight:600 }}>{it.name}</div>
                            <div style={{ color:T.sub, fontSize:12 }}>× {it.qty}</div>
                          </div>
                          <div style={{ color:checked ? T.accent : T.sub, fontWeight:700, fontSize:14 }}>₼{(it.price*it.qty).toFixed(2)}</div>
                        </div>
                      )
                    })}
                    <div style={{ display:'flex', justifyContent:'space-between', paddingTop:12, marginTop:4, color:T.accent, fontWeight:800, fontSize:16 }}>
                      <span>Seçilmiş cəmi</span><span>₼{selectedTotal.toFixed(2)}</span>
                    </div>
                  </div>
                )}

                <button onClick={() => { if(payMode==='split' && selectedTotal===0) return; setStep('method') }}
                  disabled={payMode==='split' && selectedTotal===0}
                  style={{ ...accentBtn, opacity:payMode==='split' && selectedTotal===0 ? 0.4 : 1, marginTop:16 }}>
                  Ödəniş metoduna keç →
                </button>
              </>
            )}

            {/* STEP: METHOD */}
            {step === 'method' && (
              <>
                <div style={{ ...cBox, textAlign:'center', marginBottom:16 }}>
                  <div style={{ color:T.sub, fontSize:13 }}>Ödəniləcək məbləğ</div>
                  <div style={{ color:T.accent, fontSize:32, fontWeight:900, marginTop:4 }}>₼{payAmount.toFixed(2)}</div>
                </div>

                <div style={{ color:T.sub, fontSize:12, marginBottom:12, textAlign:'center' }}>Ödəniş metodunu seçin:</div>

                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                  <button onClick={() => { setPayMethod('apple'); handlePay('apple') }} disabled={processing}
                    style={{ padding:16, borderRadius:14, border:`1px solid ${T.border}`, background:'#000', color:'#fff', fontWeight:700, fontSize:16, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:10 }}>
                    <span style={{ fontSize:24 }}>🍎</span> Apple Pay
                  </button>
                  <button onClick={() => { setPayMethod('google'); handlePay('google') }} disabled={processing}
                    style={{ padding:16, borderRadius:14, border:`1px solid ${T.border}`, background:'#fff', color:'#000', fontWeight:700, fontSize:16, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:10 }}>
                    <span style={{ fontSize:22, fontWeight:900 }}>G</span> Google Pay
                  </button>
                  <button onClick={() => { setPayMethod('card'); setStep('card') }} disabled={processing}
                    style={{ padding:16, borderRadius:14, border:`1px solid ${T.border}`, background:T.card, color:T.text, fontWeight:700, fontSize:16, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:10 }}>
                    <span style={{ fontSize:24 }}>💳</span> Kart ilə ödə
                  </button>
                </div>

                {processing && <div style={{ textAlign:'center', color:T.sub, marginTop:16, fontSize:13 }}>⏳ Emal edilir...</div>}

                <button onClick={() => setStep('choose')} style={{ width:'100%', marginTop:14, padding:12, borderRadius:12, border:`1px solid ${T.border}`, background:'transparent', color:T.sub, cursor:'pointer', fontSize:14 }}>← Geri</button>
              </>
            )}

            {/* STEP: CARD */}
            {step === 'card' && (
              <>
                <div style={{ ...cBox, textAlign:'center', marginBottom:16 }}>
                  <div style={{ color:T.sub, fontSize:13 }}>Ödəniləcək məbləğ</div>
                  <div style={{ color:T.accent, fontSize:32, fontWeight:900, marginTop:4 }}>₼{payAmount.toFixed(2)}</div>
                </div>

                <div style={cBox}>
                  <div style={{ color:T.text, fontWeight:700, fontSize:14, marginBottom:16 }}>💳 Kart məlumatları</div>

                  {/* Kart vizual */}
                  <div style={{ background:'linear-gradient(135deg,#1E2A8A,#2C5BE0)', borderRadius:14, padding:'20px 22px', marginBottom:16 }}>
                    <div style={{ color:'rgba(255,255,255,0.6)', fontSize:11, marginBottom:8 }}>KART NÖMRƏSİ</div>
                    <div style={{ color:'#fff', fontSize:20, fontWeight:700, letterSpacing:3 }}>{cardNum || '0000 0000 0000 0000'}</div>
                    <div style={{ display:'flex', justifyContent:'space-between', marginTop:14 }}>
                      <div>
                        <div style={{ color:'rgba(255,255,255,0.6)', fontSize:10 }}>SAHİBİ</div>
                        <div style={{ color:'#fff', fontSize:13, fontWeight:600 }}>{cardName || 'AD SOYAD'}</div>
                      </div>
                      <div>
                        <div style={{ color:'rgba(255,255,255,0.6)', fontSize:10 }}>SON TARİX</div>
                        <div style={{ color:'#fff', fontSize:13, fontWeight:600 }}>{cardExp || 'MM/YY'}</div>
                      </div>
                    </div>
                  </div>

                  <label style={lbl}>Kart nömrəsi</label>
                  <input value={cardNum} onChange={e => setCardNum(formatCard(e.target.value))} placeholder="0000 0000 0000 0000" maxLength={19} style={{ ...inp, letterSpacing:2, marginBottom:12 }} />

                  <div style={{ display:'flex', gap:10, marginBottom:12 }}>
                    <div style={{ flex:1 }}>
                      <label style={lbl}>Son istifadə</label>
                      <input value={cardExp} onChange={e => setCardExp(formatExp(e.target.value))} placeholder="MM/YY" maxLength={5} style={inp} />
                    </div>
                    <div style={{ flex:1 }}>
                      <label style={lbl}>CVV</label>
                      <input value={cardCvv} onChange={e => setCardCvv(e.target.value.replace(/\D/g,'').slice(0,3))} placeholder="•••" maxLength={3} type="password" style={inp} />
                    </div>
                  </div>

                  <label style={lbl}>Kart sahibinin adı</label>
                  <input value={cardName} onChange={e => setCardName(e.target.value.toUpperCase())} placeholder="AD SOYAD" style={{ ...inp, letterSpacing:1 }} />
                </div>

                <button onClick={() => handlePay('card')}
                  disabled={processing || !cardNum || !cardExp || !cardCvv || !cardName}
                  style={{ ...accentBtn, marginTop:16, opacity: processing || !cardNum || !cardExp || !cardCvv || !cardName ? 0.5 : 1 }}>
                  {processing ? '⏳ Emal edilir...' : `✅ ₼${payAmount.toFixed(2)} Ödə`}
                </button>

                <div style={{ color:T.sub, fontSize:11, textAlign:'center', marginTop:10 }}>🔒 Məlumatlarınız şifrələnərək ötürülür</div>
                <button onClick={() => setStep('method')} style={{ width:'100%', marginTop:10, padding:12, borderRadius:12, border:`1px solid ${T.border}`, background:'transparent', color:T.sub, cursor:'pointer', fontSize:14 }}>← Geri</button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Ctr({ children }) {
  return <div style={{ minHeight:'100vh', background:'#0B1020', color:'#9AA4BC', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'system-ui', fontSize:16 }}>{children}</div>
}

const cBox = { background:T.card, border:`1px solid ${T.border}`, borderRadius:16, padding:18 }
const accentBtn = { width:'100%', padding:16, borderRadius:14, border:'none', background:'linear-gradient(135deg,#00E6A8,#2C5BE0)', color:'#001018', fontWeight:800, fontSize:16, cursor:'pointer', display:'block' }
const lbl = { color:'#9AA4BC', fontSize:12, display:'block', marginBottom:6 }
const inp = { width:'100%', padding:'12px 14px', borderRadius:10, border:`1px solid ${T.border}`, background:'rgba(255,255,255,0.03)', color:'#fff', fontSize:15, boxSizing:'border-box' }