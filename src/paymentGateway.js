// ================================================================
// DigiMenu Ödəniş Gateway
// Gateway hazır olduqda yalnız bu faylı dəyişin.
// ================================================================

export const GATEWAY = 'mock' // 'mock' | 'payriff' | 'abb' | 'kapital'

/**
 * Ödəniş başlat
 * @param {object} params - { amount, orderId, customerName, customerPhone, description }
 * @returns {object} - { success, ref, message }
 */
export async function initiatePayment({ amount, orderId, customerName, description }) {
  if (GATEWAY === 'mock') {
    // Mock ödəniş — 1.5 saniyə sonra uğurlu cavab qaytarır
    await new Promise(r => setTimeout(r, 1500))
    return {
      success: true,
      ref: `MOCK-${Date.now()}`,
      message: 'Ödəniş uğurla tamamlandı (test rejimi)',
    }
  }

  if (GATEWAY === 'payriff') {
    // TODO: PAYRIFF inteqrasiyası
    // const res = await fetch('https://api.payriff.com/api/v2/createOrder', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json', 'Authorization': PAYRIFF_SECRET },
    //   body: JSON.stringify({ amount: amount * 100, currency: 'AZN', description, ... })
    // })
    throw new Error('PAYRIFF hələ inteqrasiya olunmayıb')
  }

  if (GATEWAY === 'abb') {
    // TODO: ABB Express Pay inteqrasiyası
    throw new Error('ABB Express Pay hələ inteqrasiya olunmayıb')
  }

  throw new Error('Gateway seçilməyib')
}

export const GATEWAY_LABEL = {
  mock: '🧪 Test rejimi',
  payriff: 'PAYRIFF',
  abb: 'ABB Express Pay',
  kapital: 'Kapital Bank',
}