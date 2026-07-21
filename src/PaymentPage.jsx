import React, { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase } from './supabaseClient'
import { initiatePayment, GATEWAY, GATEWAY_LABEL } from './paymentGateway'

function getCustomerToken() {
  let t = sessionStorage.getItem('dg_ct')
  if (!t) { t = Math.random().toString(36).slice(2) + Date.now(); sessionStorage.setItem('dg_ct', t) }
  return t
}

export default function PaymentPage() {
  const { slug } = useParams()
  const [sp] = useSearchParams()
  const tableParam = sp.get('table')
  const sessionParam = sp.get('session') // POS-dan gəldiksə

  const [biz, setBiz] = useState(null)
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [step, setStep] = useState('choose') // choose | card | done | error
  const [payType, setPayType] = useState('full') // full | split
  const [splitAmount, setSplitAmount] = useState('')
  const [cardNum, setCardNum] = useState('')
  const [cardExp, setCardExp] = useState('')
  const [cardCvv, setCardCvv] = useState('')
  const [cardName, setCardName] = useState('')
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState(null)
  const cTok = getCustomerToken()

  const T = { bg:'#0B1020', card:'rgba(255,255,255,0.06)', border:'rgba(255,255,255,0.12)', text:'#FFFFFF', sub:'#9AA4BC', accent:'#00E6A8' }

  useEffect(() => { init() }, [slug])

  const init = async () => {
    const { data: b } = await supabase.from('businesses').select('*').eq('slug', slug).maybeSingle()
    if (!b) { setLoading(false); return }
    setBiz(b)

    // Müştərinin ödənilməmiş sifarişlərini yüklə
    let q = supabase.from('pending_orders').select('*')
      .eq('business_id', b.id)
      .eq('payment_status', 'unpaid')
      .neq('order_status', 'rejected')

    if (sessionParam) {
      q = q.eq('session_token', sessionParam)
    } else {
      q = q.eq('customer_token', cTok)
    }

    const { data: ords } = await q.order('created_at')
    setOrders(ords || [])
    setLoading(false)
  }

  const totalAmount = orders.reduce((s, o) => s + Number(o.total), 0)
  const payAmount = payType === 'split' ? parseFloat(splitAmount || 0) : totalAmount

  const handlePay = async () => {
    if (!payAmount || payAmount <= 0) return
    if (!cardNum || !cardExp || !cardCvv || !cardName) return
    setProcessing(true)

    try {
      const res = await initiatePayment({
        amount: payAmount,
        orderId: orders.map(o => o.id).join(','),
        customerName: orders[0]?.customer_name || '',
        description: `DigiMenu - ${biz?.name} - Masa ${tableParam}`,
      })

      if (res.success) {
        // Ödənişi qeydə al
        await supabase.from('payments').insert({
          business_id: biz.id,
          customer_token: cTok,
          customer_name: orders[0]?.customer_name,
          amount: payAmount,
          payment_type: payType,
          status: 'paid',
          gateway: GATEWAY,
          gateway_ref: res.ref,
          order_ids: orders.map(o => o.id),
        })

        // Sifarişləri ödənildi kimi işarələ
        if (payType === 'full') {
          await supabase.from('pending_orders')
            .update({ payment_status: 'paid' })
            .in('id', orders.map(o => o.id))
        } else {
          await supabase.from('pending_orders')
            .update({ payment_status: 'partial' })
            .in('id', orders.map(o => o.id))
        }

        setResult(res)
        setStep('done')
      } else {
        setStep('error')
      }
    } catch (e) {
      setResult({ message: e.message })
      setStep('error')
    }
    setProcessing(false)
  }

  const formatCard = (v) => v.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim()
  const formatExp = (v) => {
    const d = v.replace(/\D/g, '').slice(0, 4)
    return d.length >= 3 ? d.slice(0,2) + '/' + d.slice(2) : d
  }

  if (loading) return <Ctr>Yüklənir...</Ctr>
  if (!biz) return <Ctr>Biznes tapılmadı.</Ctr>

  // ── DONE ──────────────────────────────────────────────────────────
  if (step === 'done') return (
    <Ctr>
      <div style={{ textAlign: 'center', maxWidth: 380, padding: 24 }}>
        <div style={{ fontSize: 72, marginBottom: 20 }}>✅</div>
        <div style={{ color: T.text, fontSize: 22, fontWeight: 800 }}>Ödəniş uğurla tamamlandı!</div>
        <div style={{ color: T.sub, fontSize: 14, marginTop: 10 }}>₼{payAmount.toFixed(2)} · {biz.name}</div>
        {result?.ref && <div style={{ color: T.accent, fontSize: 12, marginTop: 8, fontFamily: 'monospace' }}>Ref: {result.ref}</div>}
        <div style={{ color: T.sub, fontSize: 12, marginTop: 16 }}>{result?.message}</div>
      </div>
    </Ctr>
  )

  // ── ERROR ─────────────────────────────────────────────────────────
  if (step === 'error') return (
    <Ctr>
      <div style={{ textAlign: 'center', maxWidth: 380, padding: 24 }}>
        <div style={{ fontSize: 72, marginBottom: 20 }}>❌</div>
        <div style={{ color: '#FF5A5F', fontSize: 22, fontWeight: 800 }}>Ödəniş uğursuz oldu</div>
        <div style={{ color: T.sub, fontSize: 13, marginTop: 10 }}>{result?.message}</div>
        <button onClick={() => setStep('choose')}
          style={{ marginTop: 20, padding: '12px 24px', borderRadius: 12, border: 'none', background: T.accent, color: '#001018', fontWeight: 700, cursor: 'pointer' }}>
          Yenidən cəhd et
        </button>
      </div>
    </Ctr>
  )

  return (
    <div style={{ minHeight: '100vh', background: T.bg, fontFamily: 'system-ui,sans-serif', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div style={{ width: '100%', maxWidth: 420 }}>

        {/* Başlıq */}
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>💳</div>
          <div style={{ color: T.text, fontSize: 22, fontWeight: 800 }}>{biz.name}</div>
          <div style={{ color: T.sub, fontSize: 13, marginTop: 4 }}>
            {tableParam ? `Masa ${tableParam}` : 'Online ödəniş'} · {GATEWAY_LABEL[GATEWAY]}
          </div>
        </div>

        {/* Sifarişlər xülasəsi */}
        {orders.length > 0 ? (
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, padding: 16, marginBottom: 16 }}>
            <div style={{ color: T.sub, fontSize: 12, marginBottom: 10 }}>Ödənilməmiş sifarişlər:</div>
            {orders.map(o => (
              <div key={o.id} style={{ marginBottom: 10 }}>
                {(o.items || []).map((it, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', color: T.sub, fontSize: 13, marginBottom: 2 }}>
                    <span>{it.name} × {it.qty}</span>
                    <span>₼{(it.price * it.qty).toFixed(2)}</span>
                  </div>
                ))}
              </div>
            ))}
            <div style={{ borderTop: `1px solid ${T.border}`, paddingTop: 8, marginTop: 4, display: 'flex', justifyContent: 'space-between', color: T.accent, fontWeight: 800, fontSize: 16 }}>
              <span>Ümumi</span><span>₼{totalAmount.toFixed(2)}</span>
            </div>
          </div>
        ) : (
          <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, padding: 20, marginBottom: 16, textAlign: 'center', color: T.sub }}>
            Ödənilməmiş sifariş tapılmadı.
          </div>
        )}

        {orders.length > 0 && (
          <>
            {/* Ödəniş növü */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
              {[
                { k: 'full',  label: '💰 Hamısını ödə', desc: `₼${totalAmount.toFixed(2)}` },
                { k: 'split', label: '✂️ Öz payımı ödə', desc: 'Məbləği siz seçin' },
              ].map(opt => (
                <button key={opt.k} onClick={() => setPayType(opt.k)}
                  style={{ flex: 1, padding: 14, borderRadius: 14, border: `2px solid ${payType === opt.k ? T.accent : T.border}`, background: payType === opt.k ? T.accent + '15' : T.card, cursor: 'pointer', textAlign: 'center' }}>
                  <div style={{ color: payType === opt.k ? T.accent : T.text, fontWeight: 700, fontSize: 13 }}>{opt.label}</div>
                  <div style={{ color: T.sub, fontSize: 12, marginTop: 3 }}>{opt.desc}</div>
                </button>
              ))}
            </div>

            {/* Split məbləği */}
            {payType === 'split' && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ color: T.sub, fontSize: 12, marginBottom: 6 }}>Ödəmək istədiyiniz məbləğ (₼)</div>
                <input
                  value={splitAmount}
                  onChange={e => setSplitAmount(e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder={`Maks: ₼${totalAmount.toFixed(2)}`}
                  type="number"
                  style={{ width: '100%', padding: 14, borderRadius: 12, border: `1px solid ${T.border}`, background: 'transparent', color: T.text, fontSize: 18, textAlign: 'center', fontWeight: 700, boxSizing: 'border-box' }}
                />
              </div>
            )}

            {/* Kart forması */}
            <div style={{ background: T.card, border: `1px solid ${T.border}`, borderRadius: 16, padding: 20, marginBottom: 16 }}>
              <div style={{ color: T.text, fontWeight: 700, fontSize: 14, marginBottom: 16 }}>💳 Kart məlumatları</div>

              <div style={{ color: T.sub, fontSize: 12, marginBottom: 6 }}>Kart nömrəsi</div>
              <input value={cardNum} onChange={e => setCardNum(formatCard(e.target.value))}
                placeholder="0000 0000 0000 0000" maxLength={19}
                style={{ ...inp(T), marginBottom: 12, letterSpacing: 2 }} />

              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: T.sub, fontSize: 12, marginBottom: 6 }}>Son istifadə tarixi</div>
                  <input value={cardExp} onChange={e => setCardExp(formatExp(e.target.value))}
                    placeholder="MM/YY" maxLength={5} style={inp(T)} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: T.sub, fontSize: 12, marginBottom: 6 }}>CVV</div>
                  <input value={cardCvv} onChange={e => setCardCvv(e.target.value.replace(/\D/g,'').slice(0,3))}
                    placeholder="•••" maxLength={3} type="password" style={inp(T)} />
                </div>
              </div>

              <div style={{ color: T.sub, fontSize: 12, marginBottom: 6 }}>Kart sahibinin adı</div>
              <input value={cardName} onChange={e => setCardName(e.target.value.toUpperCase())}
                placeholder="AD SOYAD" style={{ ...inp(T), letterSpacing: 1 }} />
            </div>

            {/* Ödə düyməsi */}
            <button onClick={handlePay}
              disabled={processing || !cardNum || !cardExp || !cardCvv || !cardName || (payType === 'split' && !splitAmount)}
              style={{ width: '100%', padding: 16, borderRadius: 14, border: 'none', background: T.accent, color: '#001018', fontWeight: 800, fontSize: 16, cursor: 'pointer', opacity: processing ? 0.7 : 1 }}>
              {processing ? '⏳ Emal edilir...' : `✅ ₼${payAmount.toFixed(2)} Ödə`}
            </button>

            <div style={{ color: T.sub, fontSize: 11, textAlign: 'center', marginTop: 12 }}>
              🔒 Ödəniş məlumatlarınız şifrələnərək ötürülür · {GATEWAY_LABEL[GATEWAY]}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Ctr({ children }) {
  return <div style={{ minHeight: '100vh', background: '#0B1020', color: '#9AA4BC', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui', fontSize: 16 }}>{children}</div>
}

function inp(T) {
  return { width: '100%', padding: '12px 14px', borderRadius: 10, border: `1px solid ${T.border}`, background: 'rgba(255,255,255,0.03)', color: T.text, fontSize: 15, boxSizing: 'border-box' }
}