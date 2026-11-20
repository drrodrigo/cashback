/**
 * troco-recarga — a loja pede crédito, e sai o Pix do Mercado Pago (19/11).
 *
 * Ele: *"ele tem que fazer um Pix para a gente, esse Pix cai na conta dele (...) Vamos montar no automático"*.
 *
 * A ordem importa:
 *   1. pede a recarga COMO O LOJISTA (`cash_pedir_recarga`, com o token dele): o banco confere quem é e o mínimo;
 *   2. cria a cobrança no Mercado Pago, com o aviso apontando para a `troco-pix-webhook`;
 *   3. guarda o id e o copia-e-cola COMO SERVIDOR (`cash_servidor_cobranca_da_recarga`).
 * Nenhuma regra de dinheiro mora aqui: o crédito só entra quando o webhook confere o pagamento na fonte.
 *
 * GET responde a sonda: `{ ligado, provedor }` (sem mostrar token nenhum).
 * Publicar com `verify_jwt: false` (o token do lojista é conferido pelo próprio banco) e com
 * `../_troco/mercadopago.ts`.
 */
import { lerCobrancaCriada, montarCobranca, tokenDoMercadoPago } from '../_troco/mercadopago.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const CHAVE_PUBLICA = Deno.env.get('SUPABASE_ANON_KEY') ?? ''
const CHAVE_DE_SERVICO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const TOKEN = tokenDoMercadoPago(Deno.env.toObject())
const AVISAR_EM = `${SUPABASE_URL}/functions/v1/troco-pix-webhook`
const VALIDADE_MS = 24 * 3600 * 1000

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
}

const responder = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (pedido: Request) => {
  if (pedido.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (pedido.method === 'GET') return responder({ ligado: TOKEN !== '', provedor: 'mercadopago' })
  if (pedido.method !== 'POST') return responder({ erro: 'so_post' }, 405)

  const autorizacao = pedido.headers.get('authorization') ?? ''
  if (!/^Bearer\s+\S+/i.test(autorizacao)) return responder({ erro: 'precisa_entrar' }, 401)
  // Sem token, nem abre a recarga: não fica pedido órfão "aguardando" um Pix que não existe.
  if (!TOKEN) return responder({ erro: 'pix_desligado' }, 503)

  let valor: number
  try {
    valor = Number(((await pedido.json()) as { valor?: unknown }).valor)
  } catch {
    return responder({ erro: 'valor_invalido' }, 400)
  }

  // 1. Como o lojista: o banco diz quem é, se é loja, e se o valor passa do mínimo.
  const r1 = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cash_pedir_recarga`, {
    method: 'POST',
    headers: { apikey: CHAVE_PUBLICA, Authorization: autorizacao, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_valor: valor }),
  })
  const c1 = await r1.json().catch(() => null)
  if (!r1.ok) {
    // O código do banco vai inteiro: a tela traduz (recarga_abaixo_do_minimo, nao_e_lojista...).
    return responder({ erro: String((c1 as { message?: string } | null)?.message ?? 'erro') }, 400)
  }
  const linha = (Array.isArray(c1) ? c1[0] : null) as
    | { recarga_id: string; valor: number; loja_nome: string; email: string | null }
    | null
  if (!linha?.recarga_id) return responder({ erro: 'erro' }, 500)

  // 2. O Pix no Mercado Pago.
  const expiraEm = new Date(Date.now() + VALIDADE_MS)
  const chamada = montarCobranca(
    {
      valorCentavos: Math.round(Number(linha.valor) * 100),
      descricao: `Recarga Troco Prime - ${linha.loja_nome}`.slice(0, 120),
      referencia: linha.recarga_id,
      email: linha.email || 'lojista@trocoprime.com.br',
      avisarEm: AVISAR_EM,
      expiraEm,
    },
    TOKEN,
  )
  const r2 = await fetch(chamada.url, { method: 'POST', headers: chamada.cabecalhos, body: chamada.corpo })
  const c2 = (await r2.json().catch(() => ({}))) as Record<string, unknown>
  const cobranca = r2.ok ? lerCobrancaCriada(c2) : null
  if (!cobranca) {
    console.error('[troco-recarga] o Mercado Pago não devolveu o Pix:', r2.status, JSON.stringify(c2).slice(0, 500))
    return responder({ erro: 'pix_falhou' }, 502)
  }

  // 3. Como servidor: guarda a cobrança na recarga.
  const r3 = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cash_servidor_cobranca_da_recarga`, {
    method: 'POST',
    headers: {
      apikey: CHAVE_DE_SERVICO,
      Authorization: `Bearer ${CHAVE_DE_SERVICO}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      p_recarga: linha.recarga_id,
      p_cobranca_externa: cobranca.idExterno,
      p_copia_e_cola: cobranca.copiaECola,
      p_expira_em: expiraEm.toISOString(),
    }),
  })
  if (!r3.ok) {
    // O Pix existe e o aviso acha a recarga pela referência: a loja pode pagar mesmo assim.
    console.error('[troco-recarga] não guardei a cobrança:', r3.status, await r3.text())
  }

  return responder({
    recarga_id: linha.recarga_id,
    valor: Number(linha.valor),
    copia_e_cola: cobranca.copiaECola,
    expira_em: expiraEm.toISOString(),
  })
})
