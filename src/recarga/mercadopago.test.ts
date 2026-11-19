// O PIX DO MERCADO PAGO DA RECARGA (19/11): o formato que as funções de borda mandam e leem, testado aqui porque lá
// (Deno, rede) não há teste. Os corpos de exemplo seguem o que o Mercado Pago devolve em /v1/payments.
import { describe, expect, it } from 'vitest'
import {
  dataDoMercadoPago,
  idDoAviso,
  lerCobrancaCriada,
  lerPagamentoConferido,
  montarCobranca,
  parametrosDaUrl,
  tokenDoMercadoPago,
} from '../../supabase/functions/_troco/mercadopago'

const REF = '6f1c2a3b-0000-4000-8000-000000000001'

describe('criar o Pix', () => {
  it('manda o valor em reais, Pix, a referência da recarga, o aviso e a chave de idempotência', () => {
    const c = montarCobranca(
      { valorCentavos: 10000, descricao: 'Recarga Troco Prime - Ótica', referencia: REF, email: 'dono@otica.com', avisarEm: 'https://x/functions/v1/troco-pix-webhook', expiraEm: new Date('2026-11-20T15:00:00Z') },
      'TOKEN',
    )
    const corpo = JSON.parse(c.corpo)
    expect(c.url).toBe('https://api.mercadopago.com/v1/payments')
    expect(c.cabecalhos.Authorization).toBe('Bearer TOKEN')
    expect(c.cabecalhos['X-Idempotency-Key']).toBe(`troco-recarga-${REF}`)
    expect(corpo).toMatchObject({ transaction_amount: 100, payment_method_id: 'pix', external_reference: REF, payer: { email: 'dono@otica.com' }, notification_url: 'https://x/functions/v1/troco-pix-webhook' })
    // 15:00 UTC é meio-dia em Brasília.
    expect(corpo.date_of_expiration).toBe('2026-11-20T12:00:00.000-03:00')
    expect(dataDoMercadoPago(new Date('2026-01-01T02:30:00Z'))).toBe('2025-12-31T23:30:00.000-03:00')
  })

  it('lê o copia-e-cola e o id; sem o código, devolve nada (e a tela não mostra Pix quebrado)', () => {
    const certo = { id: 123456789, point_of_interaction: { transaction_data: { qr_code: '00020126580014br.gov.bcb.pix0136abc', qr_code_base64: 'iVBOR' } } }
    expect(lerCobrancaCriada(certo)).toEqual({ copiaECola: '00020126580014br.gov.bcb.pix0136abc', idExterno: '123456789' })
    expect(lerCobrancaCriada({ id: 1, point_of_interaction: { transaction_data: { qr_code: 'qualquer' } } })).toBeNull()
    expect(lerCobrancaCriada({ message: 'invalid token' })).toBeNull()
  })

  it('o token: o próprio do Troco Prime se existir, senão o da casa; sem nenhum, vazio', () => {
    expect(tokenDoMercadoPago({ MERCADOPAGO_ACCESS_TOKEN: ' casa ' })).toBe('casa')
    expect(tokenDoMercadoPago({ TROCO_MP_TOKEN: 'troco', MERCADOPAGO_ACCESS_TOKEN: 'casa' })).toBe('troco')
    expect(tokenDoMercadoPago({})).toBe('')
  })
})

describe('o aviso do Mercado Pago', () => {
  it('acha o id nos dois jeitos de avisar (webhook novo e IPN antigo), e ignora outro assunto', () => {
    expect(idDoAviso({ type: 'payment', data: { id: '987' } })).toBe('987')
    expect(idDoAviso({}, parametrosDaUrl('https://x/f?data.id=555&type=payment'))).toBe('555')
    expect(idDoAviso({ resource: 'https://api.mercadopago.com/v1/payments/444', topic: 'payment' })).toBe('444')
    expect(idDoAviso({}, parametrosDaUrl('https://x/f?id=333&topic=payment'))).toBe('333')
    expect(idDoAviso({ topic: 'merchant_order', resource: 'https://api.mercadolibre.com/merchant_orders/1' })).toBeNull()
    expect(idDoAviso({ data: { id: 'abc' } })).toBeNull()
  })
})

describe('a consulta do pagamento (a palavra final)', () => {
  it('pago, com a taxa que o Mercado Pago cobrou e o que caiu na conta', () => {
    const p = lerPagamentoConferido({
      id: 987, status: 'approved', transaction_amount: 100, external_reference: REF,
      fee_details: [{ type: 'mercadopago_fee', amount: 0.99, fee_payer: 'collector' }],
      transaction_details: { net_received_amount: 99.01, total_paid_amount: 100 },
    })
    expect(p).toEqual({ idExterno: '987', pago: true, valorCentavos: 10000, taxaCentavos: 99, liquidoCentavos: 9901, referencia: REF })
  })

  it('pendente não é pago; taxa paga por quem comprou não é nossa', () => {
    const p = lerPagamentoConferido({
      id: 988, status: 'pending', transaction_amount: 200, external_reference: REF,
      fee_details: [{ amount: 1.5, fee_payer: 'payer' }],
    })
    expect(p?.pago).toBe(false)
    expect(p?.taxaCentavos).toBeNull()
    expect(lerPagamentoConferido({ status: 'approved' })).toBeNull()
  })
})
