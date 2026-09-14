// ---------------------------------------------------------------------------
// O LIVRO-RAZÃO DO CASH
//
// Este arquivo é o produto. Tela se refaz numa tarde; dinheiro errado não se
// desfaz. Por isso o motor mora separado da interface, sem depender de
// navegador, de banco nem de rede -- o que permite testá-lo de verdade.
//
// A regra que sustenta tudo, e que todo o resto existe para proteger:
//
//     a soma de TODO o cash que existe  ==  o dinheiro parado em custódia
//
// Um lojista deposita reais e recebe cash; outro lojista recebe cash e saca
// reais. Se essa conta não fechar, alguém saca dinheiro que não existe. Por
// isso aqui não existe `saldo = saldo - x`: valor só se move de uma conta para
// outra, e só entra ou sai do sistema em dois lugares (depositar e sacar), que
// mexem na custódia na mesma operação.
// ---------------------------------------------------------------------------

export interface Config {
  /** Quanto o cliente precisa juntar antes de poder descer o saldo para gastar. */
  gatilho: number
  /** Prazo para gastar depois de descer. É o motor do produto: crédito parado não gera visita. */
  prazoGastoDias: number
  /** Prazo do que está acumulado, esperando o gatilho. */
  prazoAcumuloDias: number
  /** Prazo do saldo que só vale numa loja -- curto de propósito: ele existe para trazer de volta. */
  prazoRestritoDias: number
  /** Taxa cobrada quando o lojista saca em dinheiro. Reciclar é de graça, de propósito. */
  taxaSaquePercentual: number
  /** Compra presencial ganha mais cashback que compra pela internet. */
  multiplicadorPresencial: number
}

export const CONFIG_PADRAO: Config = {
  gatilho: 30,
  prazoGastoDias: 30,
  prazoAcumuloDias: 365,
  prazoRestritoDias: 30,
  taxaSaquePercentual: 5,
  multiplicadorPresencial: 2,
}

export interface Loja {
  id: string
  nome: string
  /** Quanto por cento da compra ela devolve em cash. */
  cashbackPercentual: number
}

export interface Cliente {
  id: string
  nome: string
  telefone: string
}

/**
 * Um pedaço de cash com identidade. Saldo aqui não é um número: é um monte de
 * lotes, porque cada real precisa saber DE QUEM veio e QUANDO morre -- sem isso
 * não há como vencer na data certa nem mostrar ao lojista o que ele emitiu.
 */
export interface Lote {
  id: string
  conta: string
  valor: number
  /** A loja que pagou por esse cash. `plataforma` quando veio do fundo de promoção. */
  emissor: string
  /** Data (AAAA-MM-DD) em que o lote morre. `null` = não vence. */
  venceEm: string | null
  criadoEm: string
}

export type TipoLancamento =
  | 'deposito'
  | 'cashback'
  | 'liberacao'
  | 'pagamento'
  | 'saque'
  | 'taxa'
  | 'reciclagem'
  | 'vencimento'

export interface Lancamento {
  id: string
  /** Chave de idempotência: a mesma operação enviada duas vezes só vale uma. */
  chave: string | null
  em: string
  tipo: TipoLancamento
  de: string
  para: string
  valor: number
  /** Só em pagamento: o valor da compra declarado no balcão. É daqui que sai todo o painel. */
  valorCompra?: number
  descricao: string
}

/** Uma cobrança esperando o cliente confirmar na tela dele. */
export interface Pagamento {
  id: string
  lojaId: string
  clienteId: string
  valorCompra: number
  valorEmCash: number
  criadoEm: string
}

export interface Estado {
  config: Config
  /** Data de hoje no mundo da demonstração (AAAA-MM-DD). Avança no botão, para dar para ver o vencimento acontecer. */
  hoje: string
  lojas: Loja[]
  clientes: Cliente[]
  lotes: Lote[]
  lancamentos: Lancamento[]
  pagamentosPendentes: Pagamento[]
  /** Dinheiro de verdade parado: tudo que os lojistas depositaram, menos tudo que sacaram. */
  custodia: number
  proximoId: number
}

// --- contas -----------------------------------------------------------------
// Conta é só um nome. Quem guarda valor é o lote; a conta é o lugar onde ele está.

export const PROMOCIONAL = 'plataforma:promocional'
export const contaCredito = (lojaId: string) => `loja:${lojaId}:credito`
export const contaRecebido = (lojaId: string) => `loja:${lojaId}:recebido`
export const contaAcumulo = (clienteId: string) => `cliente:${clienteId}:acumulo`
export const contaDisponivel = (clienteId: string) => `cliente:${clienteId}:disponivel`
export const contaRestrita = (clienteId: string, lojaId: string) => `cliente:${clienteId}:restrito:${lojaId}`

// --- datas ------------------------------------------------------------------
// Data como texto AAAA-MM-DD e aritmética em dias inteiros: sem fuso, sem hora,
// sem horário de verão. Vencimento é assunto de dia, não de relógio.

export function somarDias(data: string, dias: number): string {
  const d = new Date(`${data}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d.toISOString().slice(0, 10)
}

export function diasEntre(de: string, ate: string): number {
  const a = Date.parse(`${de}T12:00:00Z`)
  const b = Date.parse(`${ate}T12:00:00Z`)
  return Math.round((b - a) / 86400000)
}

// --- erros ------------------------------------------------------------------

export class ErroDeRegra extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'ErroDeRegra'
  }
}

// --- leitura -----------------------------------------------------------------

export function saldo(estado: Estado, conta: string): number {
  return arredondar(estado.lotes.filter((l) => l.conta === conta).reduce((s, l) => s + l.valor, 0))
}

export function saldoTotal(estado: Estado): number {
  return arredondar(estado.lotes.reduce((s, l) => s + l.valor, 0))
}

/**
 * A conferência que decide se o sistema está são. Roda depois de toda operação:
 * um bug que desequilibre isso precisa parar a demonstração na hora, não aparecer
 * três telas depois como um saldo esquisito.
 */
export function invarianteFecha(estado: Estado): boolean {
  return Math.abs(saldoTotal(estado) - arredondar(estado.custodia)) < 0.005
}

export function contasDoCliente(estado: Estado, clienteId: string) {
  const restritos = estado.lojas
    .map((loja) => ({ loja, valor: saldo(estado, contaRestrita(clienteId, loja.id)) }))
    .filter((r) => r.valor > 0)
  return {
    acumulo: saldo(estado, contaAcumulo(clienteId)),
    disponivel: saldo(estado, contaDisponivel(clienteId)),
    restritos,
  }
}

/** Quando morre o saldo que já está liberado para gastar (o que vence primeiro). */
export function venceEmDisponivel(estado: Estado, clienteId: string): string | null {
  const datas = estado.lotes
    .filter((l) => l.conta === contaDisponivel(clienteId) && l.venceEm)
    .map((l) => l.venceEm as string)
    .sort()
  return datas[0] ?? null
}

export function podeDescer(estado: Estado, clienteId: string): boolean {
  return saldo(estado, contaAcumulo(clienteId)) >= estado.config.gatilho
}

function arredondar(valor: number): number {
  return Math.round(valor * 100) / 100
}

// --- o motor -----------------------------------------------------------------

function novoId(estado: Estado, prefixo: string): string {
  estado.proximoId += 1
  return `${prefixo}${estado.proximoId}`
}

/**
 * Ordem de consumo, e ela importa mais do que parece: sai primeiro o que vence
 * antes. O contrário deixaria o cliente perder saldo tendo gasto -- a reclamação
 * mais cara que um programa desses pode gerar.
 */
function lotesParaConsumir(estado: Estado, conta: string): Lote[] {
  return estado.lotes
    .filter((l) => l.conta === conta)
    .sort((a, b) => {
      if (a.venceEm === b.venceEm) return a.criadoEm.localeCompare(b.criadoEm)
      if (a.venceEm === null) return 1
      if (b.venceEm === null) return -1
      return a.venceEm.localeCompare(b.venceEm)
    })
}

interface OpcoesMovimento {
  /** `'manter'` conserva a data do lote de origem; uma data nova a substitui. */
  venceEm: 'manter' | string | null
  /** `'manter'` conserva quem pagou pelo cash; útil para saber de quem era o dinheiro que venceu. */
  emissor?: string
}

/**
 * Move valor de uma conta para outra consumindo lotes. Nunca cria nem destrói
 * valor: o que sai de um lado entra do outro, sempre.
 */
function mover(estado: Estado, de: string, para: string, valor: number, opcoes: OpcoesMovimento): void {
  if (valor <= 0) throw new ErroDeRegra('Valor precisa ser maior que zero.')
  const disponivel = saldo(estado, de)
  if (disponivel + 0.005 < valor) {
    throw new ErroDeRegra(`Saldo insuficiente: a conta tem ${disponivel.toFixed(2)} e a operação pede ${valor.toFixed(2)}.`)
  }

  let restante = arredondar(valor)
  for (const lote of lotesParaConsumir(estado, de)) {
    if (restante <= 0) break
    const usado = Math.min(lote.valor, restante)
    lote.valor = arredondar(lote.valor - usado)
    restante = arredondar(restante - usado)
    estado.lotes.push({
      id: novoId(estado, 'lote'),
      conta: para,
      valor: usado,
      emissor: opcoes.emissor ?? lote.emissor,
      venceEm: opcoes.venceEm === 'manter' ? lote.venceEm : opcoes.venceEm,
      criadoEm: estado.hoje,
    })
  }
  estado.lotes = estado.lotes.filter((l) => l.valor > 0)
}

function registrar(
  estado: Estado,
  dados: Omit<Lancamento, 'id' | 'em' | 'chave'> & { chave?: string | null },
): Lancamento {
  const lancamento: Lancamento = {
    id: novoId(estado, 'lanc'),
    em: estado.hoje,
    chave: dados.chave ?? null,
    tipo: dados.tipo,
    de: dados.de,
    para: dados.para,
    valor: arredondar(dados.valor),
    valorCompra: dados.valorCompra,
    descricao: dados.descricao,
  }
  estado.lancamentos.push(lancamento)
  return lancamento
}

/**
 * Idempotência não é preciosismo aqui: a operação acontece no balcão, num
 * celular com sinal ruim, e o vendedor toca duas vezes. Sem isto, o cliente
 * ganha cashback dobrado -- ou paga duas vezes.
 */
function jaFeito(estado: Estado, chave?: string): Lancamento | null {
  if (!chave) return null
  return estado.lancamentos.find((l) => l.chave === chave) ?? null
}

function conferirInvariante(estado: Estado): void {
  if (!invarianteFecha(estado)) {
    throw new Error(
      `Invariante quebrada: existe ${saldoTotal(estado).toFixed(2)} em cash para ${estado.custodia.toFixed(2)} em custódia.`,
    )
  }
}

// --- operações ----------------------------------------------------------------

/** O lojista põe dinheiro de verdade e recebe cash para distribuir. É a única porta de entrada. */
export function depositar(estado: Estado, lojaId: string, valor: number, chave?: string): Lancamento {
  const repetido = jaFeito(estado, chave)
  if (repetido) return repetido
  if (valor <= 0) throw new ErroDeRegra('Depósito precisa ser maior que zero.')

  estado.lotes.push({
    id: novoId(estado, 'lote'),
    conta: contaCredito(lojaId),
    valor: arredondar(valor),
    emissor: lojaId,
    venceEm: null,
    criadoEm: estado.hoje,
  })
  estado.custodia = arredondar(estado.custodia + valor)

  const lancamento = registrar(estado, {
    chave,
    tipo: 'deposito',
    de: 'externo:banco',
    para: contaCredito(lojaId),
    valor,
    descricao: `Depósito de R$ ${valor.toFixed(2)} vira ${valor.toFixed(2)} de crédito`,
  })
  conferirInvariante(estado)
  return lancamento
}

export interface OpcoesCashback {
  /** Compra no balcão ganha o multiplicador; pela internet, não. */
  presencial?: boolean
  /** Parte do cashback pode valer só naquela loja -- é o que traz o cliente de volta. */
  restrito?: boolean
  chave?: string
}

/**
 * A venda com cashback. Sai do crédito que o lojista já pagou -- é por isso que
 * a loja de fachada não consegue fraudar: para dar 1.000 ela depositou 1.000.
 */
export function darCashback(
  estado: Estado,
  lojaId: string,
  clienteId: string,
  valorCompra: number,
  opcoes: OpcoesCashback = {},
): Lancamento {
  const repetido = jaFeito(estado, opcoes.chave)
  if (repetido) return repetido

  const loja = estado.lojas.find((l) => l.id === lojaId)
  if (!loja) throw new ErroDeRegra('Loja não encontrada.')
  if (valorCompra <= 0) throw new ErroDeRegra('Valor da compra precisa ser maior que zero.')

  const multiplicador = opcoes.presencial ? estado.config.multiplicadorPresencial : 1
  const valor = arredondar((valorCompra * loja.cashbackPercentual) / 100 * multiplicador)
  if (valor <= 0) throw new ErroDeRegra('Cashback calculado ficou em zero.')

  const destino = opcoes.restrito ? contaRestrita(clienteId, lojaId) : contaAcumulo(clienteId)
  const prazo = opcoes.restrito ? estado.config.prazoRestritoDias : estado.config.prazoAcumuloDias

  mover(estado, contaCredito(lojaId), destino, valor, {
    venceEm: somarDias(estado.hoje, prazo),
    emissor: lojaId,
  })

  const lancamento = registrar(estado, {
    chave: opcoes.chave,
    tipo: 'cashback',
    de: contaCredito(lojaId),
    para: destino,
    valor,
    valorCompra,
    descricao: `${loja.nome}: compra de R$ ${valorCompra.toFixed(2)}${opcoes.presencial ? ' na loja (dobro)' : ' pela internet'} rendeu ${valor.toFixed(2)}${opcoes.restrito ? ' só para usar aqui' : ''}`,
  })
  conferirInvariante(estado)
  return lancamento
}

/**
 * O cliente desce o saldo para gastar -- e nesse instante começa o relógio. Ele
 * escolhe quanto desce, de propósito: quem desce 30 e deixa 70 guardados não
 * está correndo risco nenhum com os 70.
 */
export function descerParaGastar(estado: Estado, clienteId: string, valor: number, chave?: string): Lancamento {
  const repetido = jaFeito(estado, chave)
  if (repetido) return repetido

  const acumulado = saldo(estado, contaAcumulo(clienteId))
  if (acumulado < estado.config.gatilho) {
    throw new ErroDeRegra(
      `Ainda não dá para descer: são ${acumulado.toFixed(2)} juntados e o gatilho é ${estado.config.gatilho}.`,
    )
  }
  if (valor > acumulado + 0.005) throw new ErroDeRegra('Não dá para descer mais do que está juntado.')

  const vence = somarDias(estado.hoje, estado.config.prazoGastoDias)
  mover(estado, contaAcumulo(clienteId), contaDisponivel(clienteId), valor, { venceEm: vence })

  const lancamento = registrar(estado, {
    chave,
    tipo: 'liberacao',
    de: contaAcumulo(clienteId),
    para: contaDisponivel(clienteId),
    valor,
    descricao: `Liberou ${valor.toFixed(2)} para gastar até ${vence}`,
  })
  conferirInvariante(estado)
  return lancamento
}

/** Quanto desse cliente pode ser usado nesta loja: o restrito dela mais o disponível. */
export function podeUsarNaLoja(estado: Estado, clienteId: string, lojaId: string): number {
  return arredondar(saldo(estado, contaRestrita(clienteId, lojaId)) + saldo(estado, contaDisponivel(clienteId)))
}

/**
 * O balcão pede a cobrança; ela só vale depois que o cliente confirma na tela
 * dele. São os dois números (a compra e o cash) acordados pelas duas partes --
 * é isso que protege o cliente de um débito errado e o que transforma o valor
 * declarado em dado que sustenta relatório.
 */
export function pedirPagamento(
  estado: Estado,
  lojaId: string,
  clienteId: string,
  valorCompra: number,
  valorEmCash: number,
): Pagamento {
  if (valorCompra <= 0) throw new ErroDeRegra('Valor da compra precisa ser maior que zero.')
  if (valorEmCash <= 0) throw new ErroDeRegra('Valor em cash precisa ser maior que zero.')
  // Aceitação é incondicional: loja da rede aceita cash sem compra mínima e sem
  // teto. O único limite é o valor da própria compra -- ninguém paga 60 numa
  // compra de 50.
  if (valorEmCash > valorCompra + 0.005) {
    throw new ErroDeRegra('O cash usado não pode passar do valor da compra.')
  }
  const pode = podeUsarNaLoja(estado, clienteId, lojaId)
  if (pode + 0.005 < valorEmCash) {
    throw new ErroDeRegra(`O cliente tem ${pode.toFixed(2)} para usar aqui.`)
  }

  const pagamento: Pagamento = {
    id: novoId(estado, 'pag'),
    lojaId,
    clienteId,
    valorCompra,
    valorEmCash,
    criadoEm: estado.hoje,
  }
  estado.pagamentosPendentes.push(pagamento)
  return pagamento
}

export function confirmarPagamento(estado: Estado, pagamentoId: string, chave?: string): Lancamento {
  const repetido = jaFeito(estado, chave)
  if (repetido) return repetido

  const pagamento = estado.pagamentosPendentes.find((p) => p.id === pagamentoId)
  if (!pagamento) throw new ErroDeRegra('Cobrança não encontrada (ou já confirmada).')

  const { lojaId, clienteId, valorCompra, valorEmCash } = pagamento
  const loja = estado.lojas.find((l) => l.id === lojaId)

  // Restrito da loja primeiro, depois o disponível: o contrário deixaria o
  // saldo restrito preso para sempre.
  const restrito = saldo(estado, contaRestrita(clienteId, lojaId))
  const doRestrito = Math.min(restrito, valorEmCash)
  const doDisponivel = arredondar(valorEmCash - doRestrito)

  if (doRestrito > 0) {
    mover(estado, contaRestrita(clienteId, lojaId), contaRecebido(lojaId), doRestrito, { venceEm: null })
  }
  if (doDisponivel > 0) {
    mover(estado, contaDisponivel(clienteId), contaRecebido(lojaId), doDisponivel, { venceEm: null })
  }

  estado.pagamentosPendentes = estado.pagamentosPendentes.filter((p) => p.id !== pagamentoId)

  const emDinheiro = arredondar(valorCompra - valorEmCash)
  const lancamento = registrar(estado, {
    chave,
    tipo: 'pagamento',
    de: `cliente:${clienteId}`,
    para: contaRecebido(lojaId),
    valor: valorEmCash,
    valorCompra,
    descricao: `${loja?.nome ?? lojaId}: compra de R$ ${valorCompra.toFixed(2)} paga com ${valorEmCash.toFixed(2)} de cash e R$ ${emDinheiro.toFixed(2)} em dinheiro`,
  })
  conferirInvariante(estado)
  return lancamento
}

/** Reciclar é de graça, de propósito: é o que mantém o cash girando na rede em vez de virar saque. */
export function reciclar(estado: Estado, lojaId: string, valor: number, chave?: string): Lancamento {
  const repetido = jaFeito(estado, chave)
  if (repetido) return repetido

  mover(estado, contaRecebido(lojaId), contaCredito(lojaId), valor, { venceEm: null })

  const lancamento = registrar(estado, {
    chave,
    tipo: 'reciclagem',
    de: contaRecebido(lojaId),
    para: contaCredito(lojaId),
    valor,
    descricao: `Reciclou ${valor.toFixed(2)} para dar cashback de novo (sem taxa)`,
  })
  conferirInvariante(estado)
  return lancamento
}

export interface ResultadoSaque {
  lancamento: Lancamento
  taxa: number
  recebeEmReais: number
}

/**
 * A saída de dinheiro. A taxa não vira lucro escondido: ela continua existindo
 * como cash, no fundo de promoção -- ou seja, volta para a rede em campanha.
 * Só o que o lojista leva embora sai da custódia.
 */
export function sacar(estado: Estado, lojaId: string, valor: number, chave?: string): ResultadoSaque {
  const repetido = jaFeito(estado, chave)
  if (repetido) {
    const taxa = arredondar((repetido.valor * estado.config.taxaSaquePercentual) / 100)
    return { lancamento: repetido, taxa, recebeEmReais: arredondar(repetido.valor - taxa) }
  }

  const recebido = saldo(estado, contaRecebido(lojaId))
  if (valor <= 0) throw new ErroDeRegra('Saque precisa ser maior que zero.')
  if (recebido + 0.005 < valor) {
    throw new ErroDeRegra(`A loja recebeu ${recebido.toFixed(2)} de clientes; não dá para sacar ${valor.toFixed(2)}.`)
  }

  const taxa = arredondar((valor * estado.config.taxaSaquePercentual) / 100)
  const emReais = arredondar(valor - taxa)

  if (taxa > 0) {
    mover(estado, contaRecebido(lojaId), PROMOCIONAL, taxa, { venceEm: null, emissor: 'plataforma' })
    registrar(estado, {
      chave: null,
      tipo: 'taxa',
      de: contaRecebido(lojaId),
      para: PROMOCIONAL,
      valor: taxa,
      descricao: `Taxa de ${estado.config.taxaSaquePercentual}% do saque foi para o fundo de promoção`,
    })
  }

  // O que o lojista leva some do sistema: os lotes são destruídos e a custódia
  // cai exatamente o mesmo tanto. É o espelho do depósito.
  let restante = emReais
  for (const lote of lotesParaConsumir(estado, contaRecebido(lojaId))) {
    if (restante <= 0) break
    const usado = Math.min(lote.valor, restante)
    lote.valor = arredondar(lote.valor - usado)
    restante = arredondar(restante - usado)
  }
  estado.lotes = estado.lotes.filter((l) => l.valor > 0)
  estado.custodia = arredondar(estado.custodia - emReais)

  const lancamento = registrar(estado, {
    chave,
    tipo: 'saque',
    de: contaRecebido(lojaId),
    para: 'externo:banco',
    valor,
    descricao: `Sacou ${valor.toFixed(2)} e recebeu R$ ${emReais.toFixed(2)} (taxa de ${taxa.toFixed(2)})`,
  })
  conferirInvariante(estado)
  return { lancamento, taxa, recebeEmReais: emReais }
}

/**
 * Passa o tempo. O que venceu sai do bolso de quem não usou e vira fundo de
 * promoção -- decisão do dono, e o dinheiro que dava lastro continua na
 * custódia, então a conta segue fechando.
 */
export function avancarPara(estado: Estado, novaData: string): Lancamento[] {
  if (diasEntre(estado.hoje, novaData) < 0) throw new ErroDeRegra('O relógio não anda para trás.')
  estado.hoje = novaData

  const vencidos = estado.lotes.filter(
    (l) => l.venceEm !== null && l.venceEm <= novaData && l.conta !== PROMOCIONAL,
  )

  const lancamentos: Lancamento[] = []
  for (const lote of vencidos) {
    const valor = lote.valor
    const conta = lote.conta
    lote.valor = 0
    estado.lotes.push({
      id: novoId(estado, 'lote'),
      conta: PROMOCIONAL,
      valor,
      emissor: 'plataforma',
      venceEm: null,
      criadoEm: novaData,
    })
    lancamentos.push(
      registrar(estado, {
        chave: null,
        tipo: 'vencimento',
        de: conta,
        para: PROMOCIONAL,
        valor,
        descricao: `Venceu ${valor.toFixed(2)} sem uso e virou fundo de promoção`,
      }),
    )
  }
  estado.lotes = estado.lotes.filter((l) => l.valor > 0)
  conferirInvariante(estado)
  return lancamentos
}

export function avancarDias(estado: Estado, dias: number): Lancamento[] {
  return avancarPara(estado, somarDias(estado.hoje, dias))
}

/**
 * Distribuir brinde é a única operação que parece criar cash do nada -- e não
 * cria: sai do fundo de promoção, que tem lastro. Se um dia a plataforma emitir
 * cash sem dinheiro atrás, o saque vira promessa e o modelo inteiro cai.
 */
export function distribuirPromocao(
  estado: Estado,
  clienteId: string,
  valor: number,
  chave?: string,
): Lancamento {
  const repetido = jaFeito(estado, chave)
  if (repetido) return repetido

  const fundo = saldo(estado, PROMOCIONAL)
  if (fundo + 0.005 < valor) {
    throw new ErroDeRegra(
      `O fundo tem ${fundo.toFixed(2)}. Para dar mais que isso, a plataforma precisa depositar dinheiro de verdade antes.`,
    )
  }

  mover(estado, PROMOCIONAL, contaAcumulo(clienteId), valor, {
    venceEm: somarDias(estado.hoje, estado.config.prazoAcumuloDias),
    emissor: 'plataforma',
  })

  const lancamento = registrar(estado, {
    chave,
    tipo: 'cashback',
    de: PROMOCIONAL,
    para: contaAcumulo(clienteId),
    valor,
    descricao: `Campanha da rede: ${valor.toFixed(2)} de brinde`,
  })
  conferirInvariante(estado)
  return lancamento
}

// --- estado inicial ------------------------------------------------------------

export function estadoVazio(hoje: string, config: Config = CONFIG_PADRAO): Estado {
  return {
    config: { ...config },
    hoje,
    lojas: [],
    clientes: [],
    lotes: [],
    lancamentos: [],
    pagamentosPendentes: [],
    custodia: 0,
    proximoId: 0,
  }
}
