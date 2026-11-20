/**
 * O Pix do Mercado Pago para a RECARGA da loja do Troco Prime (19/11) — só o formato, sem rede e sem Deno, para ser
 * testado com o resto do projeto (`src/recarga/mercadopago.test.ts`). Quem chama a rede são as duas funções de borda:
 * `troco-recarga` (cria a cobrança) e `troco-pix-webhook` (recebe o aviso, confere na fonte e dá a baixa).
 *
 * De onde vêm os formatos: do código que JÁ RODA no mesmo Supabase (`pix-webhook` e `criar-cobranca` do Mapps, que
 * leram campo a campo o `criar-pagamento-plano` do Catálogo Online). Não de memória.
 *
 * Publicar as funções com este arquivo como `../_troco/mercadopago.ts`.
 */

export interface PedidoDeRecarga {
  valorCentavos: number
  descricao: string
  /** O id da recarga (`cash.recargas.id`): vai como `external_reference` e como chave de idempotência. */
  referencia: string
  /** O Mercado Pago exige o e-mail de quem paga. */
  email: string
  /** Para onde o Mercado Pago avisa que foi pago (a `troco-pix-webhook`). */
  avisarEm: string
  /** Até quando o Pix vale. */
  expiraEm: Date
}

export interface ChamadaHttp {
  url: string
  cabecalhos: Record<string, string>
  corpo: string
}

/**
 * O token do Mercado Pago: o `TROCO_MP_TOKEN` se um dia o Troco Prime tiver conta própria; senão o
 * `MERCADOPAGO_ACCESS_TOKEN`, a conta da casa que o Catálogo e o Mapps já usam. Sem token, sem Pix.
 */
export function tokenDoMercadoPago(ambiente: Record<string, string | undefined>): string {
  return (ambiente.TROCO_MP_TOKEN ?? '').trim() || (ambiente.MERCADOPAGO_ACCESS_TOKEN ?? '').trim()
}

/** A data no formato que o Mercado Pago pede para `date_of_expiration` (com o fuso de Brasília). */
export function dataDoMercadoPago(d: Date): string {
  const brasilia = new Date(d.getTime() - 3 * 3600 * 1000)
  return brasilia.toISOString().replace('Z', '-03:00')
}

export function montarCobranca(p: PedidoDeRecarga, token: string): ChamadaHttp {
  return {
    url: 'https://api.mercadopago.com/v1/payments',
    cabecalhos: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      // Sem isto, uma tentativa repetida vira duas cobranças.
      'X-Idempotency-Key': `troco-recarga-${p.referencia}`,
    },
    corpo: JSON.stringify({
      transaction_amount: Number((p.valorCentavos / 100).toFixed(2)),
      description: p.descricao,
      payment_method_id: 'pix',
      external_reference: p.referencia,
      payer: { email: p.email },
      notification_url: p.avisarEm,
      date_of_expiration: dataDoMercadoPago(p.expiraEm),
    }),
  }
}

export interface CobrancaCriada {
  /** O "copia e cola" que a loja leva para o banco (e que vira o QR na tela). */
  copiaECola: string
  /** O id do pagamento no Mercado Pago: é por ele que o aviso volta. */
  idExterno: string
}

/** Lê a resposta da criação. `null` quando não veio o código: quem chamou mostra o que o Mercado Pago respondeu. */
export function lerCobrancaCriada(corpo: Record<string, unknown>): CobrancaCriada | null {
  const dados = ((corpo.point_of_interaction as Record<string, unknown> | undefined)?.transaction_data ??
    {}) as Record<string, unknown>
  const copiaECola = typeof dados.qr_code === 'string' ? dados.qr_code : ''
  const idExterno = corpo.id == null ? '' : String(corpo.id)
  if (!copiaECola.startsWith('000201') || !idExterno) return null
  return { copiaECola, idExterno }
}

/** Os parâmetros da URL do aviso, como objeto. */
export function parametrosDaUrl(url: string): Record<string, string> {
  const p: Record<string, string> = {}
  const i = url.indexOf('?')
  if (i < 0) return p
  for (const [k, v] of new URLSearchParams(url.slice(i + 1))) p[k] = v
  return p
}

function finalDaUrl(valor: unknown): string {
  if (typeof valor !== 'string') return ''
  const pedacos = valor.split('?')[0].split('/').filter(Boolean)
  const ultimo = pedacos[pedacos.length - 1] ?? ''
  return /^\d+$/.test(ultimo) ? ultimo : ''
}

/**
 * De qual pagamento o aviso fala. O Mercado Pago avisa de DOIS jeitos (o webhook novo, `?data.id=…&type=payment`, e o
 * IPN antigo, `?id=…&topic=payment`), e manda os dois: o id é procurado nos quatro lugares. Aviso de outro assunto
 * (`merchant_order`) não é conosco. A lição é do `pix-webhook` do Mapps: aviso aceito e jogado fora é pior que recusado.
 */
export function idDoAviso(corpo: Record<string, unknown>, parametros: Record<string, string> = {}): string | null {
  const assunto = String(corpo.type ?? corpo.topic ?? parametros.type ?? parametros.topic ?? '')
  if (assunto && !assunto.includes('payment')) return null
  const dados = (corpo.data ?? {}) as Record<string, unknown>
  const id = String(dados.id ?? corpo.id ?? parametros['data.id'] ?? parametros.id ?? finalDaUrl(corpo.resource))
  return id && id !== 'undefined' && /^\d+$/.test(id) ? id : null
}

export interface PagamentoConferido {
  idExterno: string
  pago: boolean
  valorCentavos: number | null
  /** O que o Mercado Pago cobrou de nós (a soma do `fee_details`): a resposta do "quanto que vai cobrar". */
  taxaCentavos: number | null
  /** O que caiu na conta (`net_received_amount`). */
  liquidoCentavos: number | null
  /** O id da recarga (`external_reference`). */
  referencia: string
}

const centavos = (v: unknown): number | null => {
  const n = Number(v)
  return v == null || !Number.isFinite(n) ? null : Math.round(n * 100)
}

/** Lê a CONSULTA do pagamento (a palavra final, feita com o nosso token), e não o aviso, que qualquer um forja. */
export function lerPagamentoConferido(corpo: Record<string, unknown>): PagamentoConferido | null {
  if (corpo.id == null) return null
  const taxas = Array.isArray(corpo.fee_details) ? (corpo.fee_details as Record<string, unknown>[]) : []
  const daCasa = taxas.filter((t) => (t.fee_payer ?? 'collector') === 'collector')
  const taxa = daCasa.length ? daCasa.reduce((s, t) => s + (centavos(t.amount) ?? 0), 0) : null
  const detalhes = (corpo.transaction_details ?? {}) as Record<string, unknown>
  return {
    idExterno: String(corpo.id),
    pago: String(corpo.status ?? '') === 'approved',
    valorCentavos: centavos(corpo.transaction_amount),
    taxaCentavos: taxa,
    liquidoCentavos: centavos(detalhes.net_received_amount),
    referencia: String(corpo.external_reference ?? ''),
  }
}
