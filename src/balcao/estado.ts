// ---------------------------------------------------------------------------
// O BALCÃO: o que a tela mostra, decidido sem DOM e sem rede.
//
// Mesma separação da carteira (`carteira/estado.ts`), pelo mesmo motivo: a trava
// monta a tela de verdade e LÊ o que aparece, em vez de ler o código.
//
// O balcão é a outra metade do produto, e é a metade que acontece na frente do
// cliente. Ele faz DUAS coisas, nas palavras dele:
//
//   *"ele vai falar assim, olha, eu estou comprando esse produto aqui. Aí a
//   pessoa vai ler o QR Code dele e vai LANÇAR na conta dele."*  -> dar cashback
//
//   *"eu tenho 20 reais de cashback" (...) "vai debitar esses 20 reais"*
//   -> cobrar, que o cliente confirma no celular dele
//
// 🔴 E NÃO EXISTE CAMPO PARA DIGITAR QUEM É O CLIENTE. Isso não é economia de
// tela: é o que impede o vendedor (ou qualquer um com a tela aberta) de creditar
// ou debitar a conta de um terceiro. O token do QR prova que a pessoa está ali
// com o aplicativo na mão -- 32 caracteres, 90 segundos, uso único.
// ---------------------------------------------------------------------------

/** A loja de quem está logado, como `public.cash_minha_loja()` devolve. */
export interface MinhaLoja {
  loja_id: string
  nome: string
  cashback_percentual: number
  /** O que a loja ainda pode DAR de cashback (o que ela depositou). */
  credito: number
  /** O que clientes já pagaram a ela em cash. */
  recebido: number
  /** O que ela já pediu para sacar e ainda não foi pago. */
  saque_pedido: number
}

/** O cliente, depois que a carteirinha foi lida. */
export interface Cliente {
  cliente_id: string
  nome: string
  /** Quanto dele serve NESTA loja (o livre mais o restrito daqui). */
  pode_usar_aqui: number
  /** O que ele tem juntado, que ainda não dá para gastar. */
  acumulado: number
  /** A leitura do Clube que originou este atendimento. */
  validacao_id: string
  nivel: string
}

/** Uma cobrança esperando o cliente confirmar no celular dele. */
export interface Cobranca {
  id: string
  cliente_nome: string
  valor_compra: number
  valor_em_cash: number
  criado_em: string
}

export interface Lancamento {
  em: string
  tipo: string
  valor: number
  valor_compra: number | null
  descricao: string
}

export type TelaDoBalcao =
  | { qual: 'falta-configurar' }
  | { qual: 'carregando' }
  | { qual: 'entrar' }
  | { qual: 'nao-e-lojista' }
  | { qual: 'balcao'; loja: MinhaLoja }

/**
 * Qual tela o balcão mostra.
 *
 * A ordem importa e cada degrau existe por um motivo:
 *
 * 1. sem as variáveis do banco não há nem o que perguntar (e a tela MANDA
 *    publicar de novo, porque o pacote construído sem elas nem tem a biblioteca
 *    dentro);
 * 2. sem login, entrar -- e é o MESMO login do Clube e do Catálogo;
 * 3. logado mas sem loja: a pessoa não é lojista da rede. Dizer isso é melhor
 *    que mostrar um balcão vazio que não funciona.
 */
export function qualTelaDoBalcao(
  sessao: { logado: boolean; faltaConfigurar?: boolean },
  loja: MinhaLoja | null,
  carregando: boolean,
): TelaDoBalcao {
  if (sessao.faltaConfigurar) return { qual: 'falta-configurar' }
  if (!sessao.logado) return { qual: 'entrar' }
  if (carregando) return { qual: 'carregando' }
  if (!loja) return { qual: 'nao-e-lojista' }
  return { qual: 'balcao', loja }
}

/** Dinheiro como ele lê: `R$ 1.234,50`. */
export function emReais(valor: number): string {
  return `R$ ${valor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/**
 * Quanto de cashback uma compra rende nesta loja.
 *
 * 🔴 ISTO É PRÉVIA, NÃO É A CONTA. Quem calcula de verdade é o banco
 * (`cash.dar_cashback`), e é ele que manda: regra de dinheiro no navegador é
 * sugestão. Esta função existe para o vendedor DIZER o valor antes de lançar --
 * *"você vai ganhar R$ 20"* --, e o arredondamento é o mesmo de lá (2 casas).
 */
export function cashbackDaCompra(valorDaCompra: number, percentual: number): number {
  if (!(valorDaCompra > 0) || !(percentual > 0)) return 0
  return Math.round(valorDaCompra * percentual) / 100
}

/**
 * O valor digitado, lido do jeito que gente digita.
 *
 * Aceita `12,50` e `12.50`, com ou sem `R$`, com ou sem ponto de milhar. Devolve
 * `null` para o que não é número -- e `null` é diferente de zero: a tela
 * **desabilita** o botão em vez de lançar zero calado.
 */
export function lerValor(digitado: string): number | null {
  const limpo = digitado
    .replace(/\s/g, '')
    .replace(/^R\$?/i, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.')
  if (limpo === '' || !/^\d+(\.\d+)?$/.test(limpo)) return null
  const n = Number(limpo)
  return Number.isFinite(n) ? n : null
}

/**
 * O que o balcão pode cobrar deste cliente nesta compra.
 *
 * São dois tetos ao mesmo tempo, e os dois são do banco:
 *
 * - o saldo que serve AQUI (`pode_usar_aqui`);
 * - o valor da própria compra -- *ninguém paga 60 numa compra de 50*.
 */
export function tetoDaCobranca(valorDaCompra: number, podeUsarAqui: number): number {
  if (!(valorDaCompra > 0)) return 0
  return Math.min(valorDaCompra, Math.max(0, podeUsarAqui))
}

/**
 * A frase que o vendedor lê em voz alta para o cliente.
 *
 * Ela existe porque o produto se explica no balcão, não na tela: quem convence a
 * pessoa a voltar é o vendedor dizendo o número.
 */
export function fraseDoAtendimento(cliente: Cliente, loja: MinhaLoja): string {
  if (cliente.pode_usar_aqui > 0) {
    return `${cliente.nome} tem ${emReais(cliente.pode_usar_aqui)} para usar aqui agora.`
  }
  if (cliente.acumulado > 0) {
    return `${cliente.nome} está juntando: ${emReais(cliente.acumulado)}. Ainda não dá para gastar.`
  }
  return `${cliente.nome} ainda não tem saldo. Esta compra rende ${loja.cashback_percentual}%.`
}

/** `2026-11-08T14:30:00Z` -> `08/11 14:30`. Vazio vira vazio, não "Invalid Date". */
export function dataCurta(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const dois = (n: number) => String(n).padStart(2, '0')
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)} ${dois(d.getHours())}:${dois(d.getMinutes())}`
}
