// ---------------------------------------------------------------------------
// A CARTEIRINHA DO CLUBE, como o Troco Prime mostra (19/11).
//
// Ele: *"clicar na carteirinha ali também, é como se você arrastasse a carteirinha. Carteirinha, número tal, ela clica,
// aí a carteirinha aparece (...) mostrar a carteirinha com o QR Code para fazer a transferência do troco"*.
//
// Quem manda na carteirinha é o Clube (`clube.carteirinha_de`, `clube.emitir_token_de`); o Troco Prime só mostra, pela
// porta `public.cash_minha_carteirinha` e `public.cash_qr_da_carteirinha` (0025). O QR leva o mesmo endereço do Clube.
// ---------------------------------------------------------------------------

/** O que `public.cash_minha_carteirinha()` devolve. */
export interface CarteirinhaDoClube {
  nome: string
  codigo_publico: string
  nivel: string
  prime_ate: string | null
  prime_em_dia: boolean
  membro_desde: string | null
  ativa: boolean
}

/** O que `public.cash_qr_da_carteirinha()` devolve: o token de 90 segundos, de uso único. */
export interface QrDaCarteirinha {
  token: string
  expira_em: string
}

/** O número em grupos de 4, como num cartão: "ABC1234567" vira "ABC1 2345 67". */
export function codigoEmGrupos(codigo: string): string {
  return (codigo ?? '').replace(/\s+/g, '').toUpperCase().replace(/(.{4})(?=.)/g, '$1 ')
}

function mesAno(iso: string | null): string | null {
  if (!iso) return null
  const [ano, mes] = iso.slice(0, 7).split('-')
  return ano && mes ? `${mes}/${ano.slice(2)}` : null
}

/** A linha de baixo do cartão: "Prime até 12/26" para quem está em dia, senão "Desde 09/26". */
export function validadeDaCarteirinha(c: Pick<CarteirinhaDoClube, 'prime_em_dia' | 'prime_ate' | 'membro_desde'>): string {
  if (c.prime_em_dia && c.prime_ate) return `Prime até ${mesAno(c.prime_ate)}`
  const desde = mesAno(c.membro_desde)
  return desde ? `Desde ${desde}` : ''
}

/** Quantos segundos o QR ainda vale (nunca negativo). */
export function segundosRestantes(expiraEm: string, agora: number = Date.now()): number {
  return Math.max(0, Math.round((new Date(expiraEm).getTime() - agora) / 1000))
}

/**
 * Quando pedir o QR seguinte. O token vale 90 s e se gasta na leitura: renovar com 30 s de folga deixa o cliente sempre
 * com um QR bom na mão, sem gastar um a cada segundo.
 */
export function quandoRenovar(expiraEm: string, agora: number = Date.now()): number {
  return Math.max(5_000, new Date(expiraEm).getTime() - agora - 30_000)
}
