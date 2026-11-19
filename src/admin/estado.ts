// ---------------------------------------------------------------------------
// O ADMINISTRADOR: o que a tela mostra, decidido sem DOM e sem rede.
//
// Mesma separação da carteira e do balcão: a trava monta a tela de verdade e LÊ o que aparece.
//
// O que ele pediu em 19/11: *"o lojista (...) vai estar vinculado ou ao QR Único ou ao Catálogo Online (...) a
// gente vai simplesmente pegar ele e vai adicionar ele (...) digita o nome dele lá e vincula."* É a primeira coisa
// da tela. O resto é o que só o administrador faz com dinheiro de verdade: registrar o depósito do lojista (o lastro
// de todo troco que ele dá), pagar o saque que ele pediu e conferir que a conta fecha.
// ---------------------------------------------------------------------------

export { emReais, lerValor } from '../balcao/estado'

/** A conferência da rede, como `public.cash_admin_painel()` devolve. */
export interface Painel {
  /** Todo o troco que existe, em todas as contas. */
  cash_existente: number
  /** O dinheiro de verdade guardado. Tem que ser IGUAL ao de cima. */
  dinheiro_em_custodia: number
  diferenca: number
  fecha: boolean
  fundo_de_promocao: number
  lojas: number
  clientes: number
  saques_a_pagar: number
}

export type Origem = 'catalogo' | 'qrunico' | 'clube' | 'avulsa'

/** Uma loja achada pela busca, no Catálogo ou no QR Único (`cash_admin_buscar_lojistas`). */
export interface Achado {
  origem: 'catalogo' | 'qrunico'
  origem_id: string
  nome: string
  cidade: string | null
  uf: string | null
  /** O endereço da loja no Catálogo (slug) ou o apelido no QR Único: ajuda a saber se é a loja certa. */
  contato: string
  /** O desconto do Clube que a loja do Catálogo já declara. É ele que vira troco (decisão de 19/11). */
  desconto_do_clube: number | null
  loja_id: string | null
  cashback_percentual: number | null
  vinculada: boolean
}

/** Uma loja do Troco Prime, com o dinheiro dela (`cash_admin_lojas`). */
export interface LojaAdmin {
  loja_id: string
  nome: string
  origem: Origem
  cashback_percentual: number
  /** O desconto que a loja dá direto no caixa, além do troco (0 = só troco). 19/11, migration 0023. */
  desconto_no_caixa: number
  ativa: boolean
  cidade: string | null
  uf: string | null
  /** O que ela depositou e ainda pode dar de troco. */
  credito: number
  /** O que clientes gastaram nela. */
  recebido: number
  saque_pedido: number
}

export interface SaquePedido {
  id: string
  loja_id: string
  loja_nome: string
  valor: number
  situacao: 'pedido' | 'pago' | 'recusado'
  pedido_em: string
}

export type TelaDoAdmin =
  | { qual: 'falta-configurar' }
  | { qual: 'entrar' }
  | { qual: 'carregando' }
  | { qual: 'nao-e-admin' }
  | { qual: 'painel'; painel: Painel }

/**
 * Qual tela desenhar. Quem decide se a pessoa é administradora é o BANCO (`public.e_admin()`, a cada chamada): a
 * tela só repete o que ele disse -- o `so_admin` que a primeira leitura devolveu.
 */
export function qualTelaDoAdmin(
  sessao: { logado: boolean; faltaConfigurar?: boolean },
  painel: Painel | null,
  naoEAdmin: boolean,
): TelaDoAdmin {
  if (sessao.faltaConfigurar) return { qual: 'falta-configurar' }
  if (!sessao.logado) return { qual: 'entrar' }
  if (naoEAdmin) return { qual: 'nao-e-admin' }
  if (painel === null) return { qual: 'carregando' }
  return { qual: 'painel', painel }
}

/** O percentual padrão do Clube Prime (o de Ofertas é 15% ou mais). */
export const PERCENTUAL_DO_CLUBE = 10

/**
 * O percentual que a tela já deixa escrito. Já vinculada: o dela. Loja do Catálogo que declara o desconto do Clube:
 * esse (é ele que vira troco). Senão, os 10% do Clube Prime. É só a SUGESTÃO no campo: quem decide é quem clica.
 */
export function percentualSugerido(a: Pick<Achado, 'vinculada' | 'cashback_percentual' | 'desconto_do_clube'>): number {
  if (a.vinculada && a.cashback_percentual && a.cashback_percentual > 0) return a.cashback_percentual
  if (a.desconto_do_clube && a.desconto_do_clube > 0 && a.desconto_do_clube <= 100) return a.desconto_do_clube
  return PERCENTUAL_DO_CLUBE
}

/** Lê o percentual digitado: "10", "12,5", "15%". Fora de (0, 100] não serve -- o banco recusaria igual. */
export function lerPercentual(digitado: string): number | null {
  const limpo = digitado.replace(/\s/g, '').replace(/%$/, '').replace(',', '.')
  if (limpo === '' || !/^\d+(\.\d+)?$/.test(limpo)) return null
  const n = Number(limpo)
  if (!Number.isFinite(n) || n <= 0 || n > 100) return null
  return n
}

/** Lê o desconto no caixa: 0 vale (é a loja de "só troco"); de 0 a menos de 100. Vazio = 0. */
export function lerDesconto(digitado: string): number | null {
  const limpo = digitado.replace(/\s/g, '').replace(/%$/, '').replace(',', '.')
  if (limpo === '') return 0
  if (!/^\d+(\.\d+)?$/.test(limpo)) return null
  const n = Number(limpo)
  if (!Number.isFinite(n) || n < 0 || n >= 100) return null
  return n
}

/**
 * As duas formas de a loja premiar (decisão dele, 19/11), numa frase:
 * - só troco: "20% de troco";
 * - desconto no caixa + troco: "10% de desconto + 10% de troco".
 * `null` quando a soma passa de 100% (o banco recusa igual: `regras_passam_de_100`).
 */
export function regraEmTexto(troco: number, desconto: number): string | null {
  if (troco + desconto > 100) return null
  return desconto > 0
    ? `${emPercentual(desconto)} de desconto + ${emPercentual(troco)} de troco`
    : `${emPercentual(troco)} de troco`
}

export function nomeDaOrigem(o: Origem): string {
  switch (o) {
    case 'catalogo':
      return 'Catálogo Online'
    case 'qrunico':
      return 'QR Único'
    case 'clube':
      return 'Clube Prime'
    default:
      return 'Avulsa'
  }
}

export function ondeFica(cidade: string | null, uf: string | null): string {
  const c = (cidade ?? '').trim()
  const u = (uf ?? '').trim()
  if (c && u) return `${c}/${u}`
  return c || u || 'sem cidade'
}

/** Mostra percentual do jeito que se fala: "10%", "12,5%". */
export function emPercentual(n: number): string {
  return `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0+$/, '').replace('.', ',')}%`
}
