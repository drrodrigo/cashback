// ---------------------------------------------------------------------------
// A RECARGA DA LOJA (19/11): o crédito que a loja põe, por Pix, para poder dar troco.
//
// Ele: *"ele tem que pagar por esse troco (...) pelo menos os R$ 100 para começar (...) esse Pix cai na conta dele"*.
// O banco manda (0027): mínimo, quem pode, a baixa só pelo servidor depois de o Mercado Pago confirmar.
// ---------------------------------------------------------------------------

/** 🔴 O MESMO número de `cash.parametros.recarga_minima` (0027). Regra em dois lugares: mudou lá, muda aqui. */
export const RECARGA_MINIMA = 100

/** Os botões prontos da tela. */
export const VALORES_DE_RECARGA = [100, 200, 500] as const

export type SituacaoDaRecarga = 'aguardando' | 'paga' | 'valor_divergente' | 'cancelada'

/** O que `public.cash_minhas_recargas()` devolve. */
export interface Recarga {
  id: string
  valor: number
  situacao: SituacaoDaRecarga
  criada_em: string
  paga_em: string | null
  /** Só enquanto espera o Pix e ele não venceu. */
  copia_e_cola: string | null
  expira_em: string | null
}

/** O que a função `troco-recarga` devolve: o Pix pronto para pagar. */
export interface RecargaCriada {
  recarga_id: string
  valor: number
  copia_e_cola: string
  expira_em: string
}

/** O que `public.cash_admin_recargas()` devolve. */
export interface RecargaAdmin {
  id: string
  loja_id: string
  loja_nome: string
  valor: number
  situacao: SituacaoDaRecarga
  criada_em: string
  paga_em: string | null
  valor_pago: number | null
  taxa_do_provedor: number | null
  valor_liquido: number | null
  confirmada_por: string | null
}

/** A situação em palavras de gente. */
export function situacaoDaRecarga(r: { situacao: SituacaoDaRecarga; expira_em?: string | null }, agora = Date.now()): string {
  if (r.situacao === 'paga') return 'Crédito na conta'
  if (r.situacao === 'valor_divergente') return 'Pago a menos: a administração vai conferir'
  if (r.situacao === 'cancelada') return 'Cancelada'
  if (r.expira_em && new Date(r.expira_em).getTime() < agora) return 'Pix vencido, sem pagamento'
  return 'Esperando o Pix'
}

/** "150", "150,5", "R$ 1.000,00" → número; o resto → null. */
export function lerValorDaRecarga(texto: string): number | null {
  const limpo = texto.replace(/[R$\s]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(limpo)) return null
  const n = Number(limpo)
  return Number.isFinite(n) && n > 0 ? n : null
}
