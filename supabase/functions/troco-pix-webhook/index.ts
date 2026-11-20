/**
 * troco-pix-webhook — o Mercado Pago avisa que a recarga da loja foi paga (19/11).
 *
 * 🔴 O AVISO NÃO É PROVA DE NADA: qualquer um manda um POST dizendo "foi pago". Ele serve só para saber QUAL pagamento
 * olhar; quem diz se foi pago, quanto e com que taxa é o Mercado Pago, respondendo a uma consulta feita com o NOSSO
 * token. É o mesmo cuidado do `pix-webhook` do Mapps e do `webhook-pedido-mercadopago` do Catálogo.
 *
 * Depois da consulta, uma porta só: `cash_servidor_baixa_da_recarga`, que decide no banco (já paga, valor a menor,
 * recarga desconhecida) e credita pelo `cash.depositar` com chave `recarga:<id>` (aviso repetido não credita duas vezes).
 *
 * Respostas: 200 quando não é conosco (para o Mercado Pago não reenviar para sempre); 5xx quando a falha é nossa (o
 * reenvio dele é a segunda chance de dar a baixa).
 *
 * GET responde a sonda: `{ ligado }`. Publicar com `verify_jwt: false` e com `../_troco/mercadopago.ts`.
 */
import { idDoAviso, lerPagamentoConferido, parametrosDaUrl, tokenDoMercadoPago } from '../_troco/mercadopago.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const CHAVE_DE_SERVICO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const TOKEN = tokenDoMercadoPago(Deno.env.toObject())

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (pedido: Request) => {
  if (pedido.method === 'GET') return json({ ligado: TOKEN !== '' })
  if (pedido.method !== 'POST') return json({ erro: 'so_post' }, 405)
  if (!TOKEN) {
    console.error('[troco-pix-webhook] sem token do Mercado Pago: não dá para conferir')
    return json({ erro: 'sem_token' }, 500)
  }

  const corpo = ((await pedido.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
  const id = idDoAviso(corpo, parametrosDaUrl(pedido.url))
  if (!id) {
    console.log('[troco-pix-webhook] aviso sem id de pagamento:', pedido.url, JSON.stringify(corpo).slice(0, 300))
    return json({ situacao: 'ignorado' })
  }

  // A palavra final: o Mercado Pago, perguntado com o nosso token.
  const consulta = await fetch(`https://api.mercadopago.com/v1/payments/${id}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  })
  if (!consulta.ok) {
    console.error('[troco-pix-webhook] não consegui conferir com o Mercado Pago:', id, consulta.status)
    return json({ erro: 'falha_ao_conferir' }, 502)
  }
  const pagamento = lerPagamentoConferido((await consulta.json()) as Record<string, unknown>)
  if (!pagamento) return json({ situacao: 'ignorado' })
  if (!pagamento.pago) return json({ situacao: 'nao_e_pagamento' })

  const baixa = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cash_servidor_baixa_da_recarga`, {
    method: 'POST',
    headers: {
      apikey: CHAVE_DE_SERVICO,
      Authorization: `Bearer ${CHAVE_DE_SERVICO}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_cobranca_externa: pagamento.idExterno,
      p_referencia: pagamento.referencia,
      p_valor_centavos: pagamento.valorCentavos,
      p_taxa_centavos: pagamento.taxaCentavos,
      p_liquido_centavos: pagamento.liquidoCentavos,
    }),
  })
  if (!baixa.ok) {
    console.error('[troco-pix-webhook] o banco recusou a baixa:', baixa.status, await baixa.text())
    return json({ erro: 'erro_ao_registrar' }, 500)
  }
  const situacao = await baixa.json()
  console.log('[troco-pix-webhook]', id, '→', situacao)
  return json({ situacao })
})
