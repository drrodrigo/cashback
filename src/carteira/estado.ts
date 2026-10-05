// ---------------------------------------------------------------------------
// QUAL TELA APARECE, e por quê.
//
// Este arquivo é uma função pura: recebe o que o banco devolveu e diz qual das
// cinco telas desenhar. Mora separado da tela de propósito, e o motivo é a
// lição de 01/10 -- eu passei dois dias consertando a loja de temas lendo o
// componente, quando o defeito era "a tela abriu sem nenhum botão". Varredura de
// fonte prova que o código diz; só a renderização prova que a tela mostra.
//
// Com a decisão aqui, a trava (`tela.test.ts`) monta os cinco estados e LÊ o que
// sai -- sem rede, sem banco, sem navegador de verdade.
// ---------------------------------------------------------------------------

/** O que `public.cash_minha_carteira()` devolve. Uma linha, sempre. */
export interface Carteira {
  cliente_id: string | null
  nome: string
  /** Decide entre "Ativar" e "entre no Clube primeiro". Ver migration 0012. */
  e_do_clube: boolean
  aderiu: boolean
  acumulado: number
  disponivel: number
  /** AAAA-MM-DD do primeiro pedaço do disponível que morre. */
  vence_em: string | null
  gatilho: number
  falta_para_liberar: number
  pode_descer: boolean
  minimo_para_transferir: number
  pode_transferir_ate: number
}

/** Uma loja da rede, como `public.cash_lojas_da_rede()` devolve. */
export interface LojaDaRede {
  loja_id: string
  nome: string
  cashback_percentual: number
  cidade: string | null
  uf: string | null
  catalogo_slug: string | null
  clube_parceiro_id: string | null
}

export interface Lancamento {
  em: string
  tipo: string
  valor: number
  valor_compra: number | null
  descricao: string
}

export type Tela =
  /** Publicado sem as variáveis do Supabase. A tela DIZ isso, não abre branca. */
  | { qual: 'falta-configurar' }
  | { qual: 'carregando' }
  /** Ninguém logado. A conta é a MESMA do Clube -- ver a seção 17 da spec. */
  | { qual: 'entrar' }
  /** Logada, mas a conta não é do Clube. Não mostra botão que vai falhar. */
  | { qual: 'fora-do-clube' }
  /** Do Clube e ainda sem conta de cashback: o botão que ele pediu. */
  | { qual: 'ativar' }
  | { qual: 'carteira'; carteira: Carteira }

export function qualTela(
  sessao: { logado: boolean; faltaConfigurar?: boolean },
  carteira: Carteira | null,
): Tela {
  // PRIMEIRO DE TODOS, e de propósito: sem as variáveis não há nem o que
  // perguntar ao banco, e toda a lógica abaixo diria "não logado" -- o que
  // mandaria a pessoa digitar senha numa tela que nunca vai conseguir entrar.
  if (sessao.faltaConfigurar) return { qual: 'falta-configurar' }
  if (!sessao.logado) return { qual: 'entrar' }
  if (carteira === null) return { qual: 'carregando' }
  if (!carteira.e_do_clube) return { qual: 'fora-do-clube' }
  if (!carteira.aderiu) return { qual: 'ativar' }
  return { qual: 'carteira', carteira }
}

/**
 * Quanto falta para a próxima transferência, em frase.
 *
 * O número existe para ela QUERER achar a próxima loja da rede -- é a frase dele:
 * *"quando ele estiver com 20, ele fala: falta só 10, vou gastar na loja que tem
 * cashback para ganhar mais 10 e poder gastar 30"*. Meta que a pessoa não vê não
 * apressa ninguém.
 */
export function fraseDoCiclo(c: Carteira, dinheiro: (n: number) => string): string {
  if (c.pode_descer) {
    return `Você já pode transferir ${dinheiro(c.pode_transferir_ate)} para gastar.`
  }
  if (c.acumulado <= 0) {
    return `Junte ${dinheiro(c.gatilho)} para poder gastar. Compre numa loja da rede e o cashback cai aqui.`
  }
  return `Falta ${dinheiro(c.falta_para_liberar)} para você poder gastar.`
}

/**
 * A barra de progresso do ciclo, de 0 a 100.
 *
 * Passa de 100 quando ela juntou mais que o gatilho (juntar não tem teto, e ele
 * foi explícito: *"ele pode juntar 80, 100 reais"*), então grudamos em 100 --
 * barra que transborda não informa nada e estraga o desenho.
 */
export function progressoDoCiclo(c: Carteira): number {
  if (c.gatilho <= 0) return 100
  return Math.max(0, Math.min(100, Math.round((c.acumulado / c.gatilho) * 100)))
}

/** Dia e mês, para o prazo aparecer do jeito que se fala. */
export function dataCurta(iso: string | null): string | null {
  if (!iso) return null
  const [a, m, d] = iso.split('-')
  if (!a || !m || !d) return null
  return `${d}/${m}`
}

/**
 * O que a busca de lojas devolve, filtrado no navegador também.
 *
 * O banco já filtra (`cash_lojas_da_rede(busca)`), e isto é a segunda camada:
 * enquanto ela digita, a lista responde sem ir e voltar na rede. As duas usam a
 * mesma regra -- nome ou cidade, sem diferenciar maiúscula -- de propósito: se
 * divergirem, o resultado muda quando a rede responde, e a lista "pula" na mão
 * dela.
 */
export function filtrarLojas(lojas: LojaDaRede[], busca: string): LojaDaRede[] {
  const b = busca.trim().toLowerCase()
  if (!b) return lojas
  return lojas.filter(
    (l) =>
      l.nome.toLowerCase().includes(b) || (l.cidade ?? '').toLowerCase().includes(b),
  )
}
