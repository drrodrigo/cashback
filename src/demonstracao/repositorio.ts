// ---------------------------------------------------------------------------
// O MODO DEMONSTRAÇÃO do aplicativo (o /beta, 19/11). O "banco" mora no navegador.
//
// Ele, em 19/11: *"a gente fez também o app beta, que seria essa página onde (...) você vai me mostrando e eu vou
// testando e vou te falando o que mudar"*. Como no Aviso de Entrega (`src/lib/dados/local.ts` de lá): as telas são as
// de verdade, e só a resposta dos dados muda.
//
// O dinheiro anda pelo MESMO motor que o site usa para conferir as regras (`nucleo/livro.ts`, com os mesmos casos das
// funções `cash.*` do banco): troco sai do crédito que a loja depositou, o ciclo dos 30, liberar vale 30 dias, a
// cobrança só sai com a confirmação, o saque paga a taxa para o fundo, e a conta da rede fecha sempre.
//
// O que é DIFERENTE do banco, de propósito (e dito na tela):
//   - os dados ficam só neste aparelho (localStorage); "Recomeçar" volta ao começo;
//   - as contas de teste entram com a senha 123456, e há botão para entrar sem digitar;
//   - a carteirinha de teste tem um código FIXO (no Clube de verdade ele vale 90 segundos e uma vez só);
//   - o relógio da demonstração anda no botão "Passar 30 dias", para ver o troco vencer.
// ---------------------------------------------------------------------------

import { MARCA } from '../marca'
import {
  PROMOCIONAL,
  confirmarPagamento,
  contaAcumulo,
  contaCredito,
  contaDisponivel,
  contaRecebido,
  darCashback,
  depositar,
  descerParaGastar,
  estadoVazio,
  invarianteFecha,
  pedirPagamento,
  podeUsarNaLoja,
  saldo,
  saldoTotal,
  sacar,
  somarDias,
  avancarPara,
  venceEmDisponivel,
  type Estado,
} from '../nucleo/livro'
import type { Carteira, CobrancaDoCliente, Lancamento, LojaDaRede } from '../carteira/estado'
import type { CarteirinhaDoClube, QrDaCarteirinha } from '../carteirinha/estado'
import { RECARGA_MINIMA, type Recarga, type RecargaAdmin, type RecargaCriada } from '../recarga/estado'
import { documentoValido, type MeuPedidoDeLoja, type PedidoDeLojaAdmin } from '../loja/estado'
import type { Cliente, Cobranca, MinhaLoja } from '../balcao/estado'
import type { Achado, LojaAdmin, Origem, Painel, SaquePedido } from '../admin/estado'
import type { Repositorio } from '../repositorio'

export type Papel = 'cliente' | 'loja' | 'admin'

/** As contas de teste. A senha de todas é 123456. */
export const CONTAS_DE_TESTE = [
  { email: 'ana@trocoprime.teste', nome: 'Ana Souza', papel: 'cliente', id: 'ana', sobre: 'cliente do Clube, começa sem ativar' },
  { email: 'bruno@trocoprime.teste', nome: 'Bruno Lima', papel: 'cliente', id: 'bruno', sobre: 'cliente do Clube, começa com 40 de troco juntado' },
  { email: 'otica@trocoprime.teste', nome: 'Ótica Visão', papel: 'loja', id: 'otica', sobre: 'loja do QR Único, só troco: 10%' },
  { email: 'padaria@trocoprime.teste', nome: 'Padaria Pão Quente', papel: 'loja', id: 'padaria', sobre: 'loja do Catálogo, 10% de desconto + 10% de troco' },
  { email: 'nova@trocoprime.teste', nome: 'Sorveteria Nova', papel: 'loja', id: 'nova', sobre: 'ainda não é loja: faz o cadastro' },
  { email: 'admin@trocoprime.teste', nome: 'Administração', papel: 'admin', id: 'admin', sobre: 'vincula lojas, registra depósito, paga saque' },
] as const

export const SENHA_DE_TESTE = '123456'

/** O código da carteirinha de cada cliente de teste (32 letras, o formato do Clube). Fixo, só na demonstração. */
export const CARTEIRINHAS_DE_TESTE: Record<string, string> = {
  ana: 'a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0a0',
  bruno: 'b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0b0',
}

/** O cartão de cada cliente de teste (o número tem 10 letras, como no Clube). A Ana é do Clube; o Bruno é Prime. */
export const CARTOES_DE_TESTE: Record<string, CarteirinhaDoClube> = {
  ana: {
    nome: 'Ana Souza', codigo_publico: 'CPANA00001', nivel: 'clube', prime_ate: null, prime_em_dia: false,
    membro_desde: '2026-09-02T12:00:00Z', ativa: true,
  },
  bruno: {
    nome: 'Bruno Lima', codigo_publico: 'CPBRU00002', nivel: 'prime', prime_ate: '2027-06-30', prime_em_dia: true,
    membro_desde: '2026-03-15T12:00:00Z', ativa: true,
  },
}

interface LojaExtra {
  origem: Origem
  origemId: string
  descontoNoCaixa: number
  cidade: string | null
  uf: string | null
  ativa: boolean
}

interface Candidato {
  origem: 'catalogo' | 'qrunico'
  origemId: string
  nome: string
  cidade: string | null
  uf: string | null
  contato: string
  descontoDoClube: number | null
}

interface Mundo {
  versao: 1
  livro: Estado
  lojas: Record<string, LojaExtra>
  aderiram: string[]
  saques: SaquePedido[]
  candidatos: Candidato[]
  /** As recargas por Pix (19/11). Opcional: o mundo salvo antes disso não tem. */
  recargas?: RecargaAdmin[]
  /** Os pedidos para ser loja (22/11). */
  pedidosDeLoja?: (PedidoDeLojaAdmin & { pedido_por: string; motivo: string | null; decidido_em: string | null })[]
}

const CHAVE = 'trocoprime:demonstracao:v1'
const SESSAO = (papel: Papel) => `trocoprime:demonstracao:sessao:${papel}`

/** O dia de hoje, no fuso do aparelho (AAAA-MM-DD). */
function hojeLocal(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** O começo da demonstração: duas lojas com depósito, a Ana sem ativar e o Bruno com 40 juntados. */
export function mundoInicial(hoje = hojeLocal()): Mundo {
  const livro = estadoVazio(hoje)
  livro.lojas = [
    { id: 'otica', nome: 'Ótica Visão', cashbackPercentual: 10 },
    { id: 'padaria', nome: 'Padaria Pão Quente', cashbackPercentual: 10 },
  ]
  livro.clientes = [
    { id: 'ana', nome: 'Ana Souza', telefone: '31999990001' },
    { id: 'bruno', nome: 'Bruno Lima', telefone: '31999990002' },
  ]
  depositar(livro, 'otica', 500, 'semente:deposito:otica')
  depositar(livro, 'padaria', 300, 'semente:deposito:padaria')
  darCashback(livro, 'otica', 'bruno', 400, { presencial: true, chave: 'semente:troco:bruno' })
  return {
    versao: 1,
    livro,
    lojas: {
      otica: { origem: 'qrunico', origemId: 'qr-otica', descontoNoCaixa: 0, cidade: 'Belo Horizonte', uf: 'MG', ativa: true },
      padaria: { origem: 'catalogo', origemId: 'cat-padaria', descontoNoCaixa: 10, cidade: 'Lagoa Santa', uf: 'MG', ativa: true },
    },
    aderiram: ['bruno'],
    saques: [],
    recargas: [],
    pedidosDeLoja: [],
    candidatos: [
      { origem: 'qrunico', origemId: 'qr-otica', nome: 'Ótica Visão', cidade: 'Belo Horizonte', uf: 'MG', contato: 'oticavisao', descontoDoClube: null },
      { origem: 'catalogo', origemId: 'cat-padaria', nome: 'Padaria Pão Quente', cidade: 'Lagoa Santa', uf: 'MG', contato: 'paoquente', descontoDoClube: 10 },
      { origem: 'catalogo', origemId: 'cat-acai', nome: 'Açaí da Praça', cidade: 'Lagoa Santa', uf: 'MG', contato: 'acaidapraca', descontoDoClube: 15 },
      { origem: 'catalogo', origemId: 'cat-pet', nome: 'Pet Shop Amigo Fiel', cidade: 'Vespasiano', uf: 'MG', contato: 'amigofiel', descontoDoClube: 10 },
      { origem: 'qrunico', origemId: 'qr-agape', nome: 'Ágape Jóias', cidade: 'Belo Horizonte', uf: 'MG', contato: 'agapejoias', descontoDoClube: null },
      { origem: 'qrunico', origemId: 'qr-barbearia', nome: 'Barbearia do Zé', cidade: 'Confins', uf: 'MG', contato: 'barbeariadoze', descontoDoClube: null },
    ],
  }
}

/** Onde a demonstração guarda o mundo. No navegador, o localStorage; no teste, um objeto. */
export interface Armazem {
  getItem(k: string): string | null
  setItem(k: string, v: string): void
  removeItem(k: string): void
}

function armazemDoNavegador(): Armazem {
  const memoria = new Map<string, string>()
  const seguro: Armazem = {
    getItem: (k) => {
      try {
        return globalThis.localStorage?.getItem(k) ?? memoria.get(k) ?? null
      } catch {
        return memoria.get(k) ?? null
      }
    },
    setItem: (k, v) => {
      memoria.set(k, v)
      try {
        globalThis.localStorage?.setItem(k, v)
      } catch {
        /* janela anônima ou armazenamento cheio: fica na memória */
      }
    },
    removeItem: (k) => {
      memoria.delete(k)
      try {
        globalThis.localStorage?.removeItem(k)
      } catch {
        /* idem */
      }
    },
  }
  return seguro
}

/** Erro com o MESMO código do banco: a tela traduz igual (`fraseDoErro`). */
function erroDoBanco(codigo: string): Error {
  return new Error(codigo)
}

const semAcento = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

export interface Demonstracao extends Repositorio {
  readonly papel: Papel
  /** Entra com uma conta de teste sem digitar. */
  entrarComo(email: string): Promise<void>
  /** Quem está logado neste papel (ou null). */
  contaAtual(): (typeof CONTAS_DE_TESTE)[number] | null
  /** Volta tudo ao começo (as lojas, os saldos, os logins). */
  recomecar(): void
  /** Anda o relógio da demonstração; devolve quantos pedaços de troco venceram. */
  passarDias(dias: number): number
  /** O dia de hoje no mundo da demonstração (AAAA-MM-DD). */
  hoje(): string
  /** Faz o papel do Mercado Pago avisando que o Pix foi pago (com a taxa de 0,99%, a da página oficial). */
  simularPixPago(recargaId: string): Promise<string>
}

/**
 * Um repositório de demonstração para UM papel (cliente, loja ou administração). Cada papel tem o seu login, e os três
 * olham o MESMO mundo: dá para ser a Ana numa aba e a Padaria na outra, e ver a cobrança de uma chegar na outra.
 */
export function criarDemonstracao(
  papel: Papel,
  armazem: Armazem = armazemDoNavegador(),
  fraseDoErro: (e: unknown) => string = (e) => (e as Error)?.message ?? 'Não deu certo.',
): Demonstracao {
  const ler = (): Mundo => {
    const bruto = armazem.getItem(CHAVE)
    if (bruto) {
      try {
        const m = JSON.parse(bruto) as Mundo
        if (m?.versao === 1 && m.livro) return m
      } catch {
        /* estragado: recomeça */
      }
    }
    const novo = mundoInicial()
    armazem.setItem(CHAVE, JSON.stringify(novo))
    return novo
  }
  const gravar = (m: Mundo) => armazem.setItem(CHAVE, JSON.stringify(m))

  /** Roda uma mudança numa CÓPIA e só grava se der certo: erro no meio não deixa o mundo pela metade. */
  function mudar<T>(f: (m: Mundo) => T): T {
    const m = structuredClone(ler())
    const r = f(m)
    if (!invarianteFecha(m.livro)) throw new Error('A conta da rede deixou de fechar. Nada foi gravado.')
    gravar(m)
    return r
  }

  const sessao = () => armazem.getItem(SESSAO(papel))
  const conta = () => CONTAS_DE_TESTE.find((c) => c.email === sessao()) ?? null
  const precisaEntrar = () => {
    const c = conta()
    if (!c) throw erroDoBanco('precisa_entrar')
    return c
  }

  const lojaDaConta = (m: Mundo) => {
    const c = conta()
    if (!c || c.papel !== 'loja') return null
    const loja = m.livro.lojas.find((l) => l.id === c.id)
    return loja && m.lojas[loja.id]?.ativa ? loja : null
  }

  const clienteDaConta = () => {
    const c = conta()
    return c && c.papel === 'cliente' ? c : null
  }

  const exigirAdmin = () => {
    if (conta()?.papel !== 'admin') throw erroDoBanco('so_admin')
  }

  const lancamentosDe = (m: Mundo, prefixo: string): Lancamento[] =>
    [...m.livro.lancamentos]
      .filter((l) => l.de.startsWith(prefixo) || l.para.startsWith(prefixo))
      .reverse()
      .slice(0, 30)
      .map((l) => ({ em: l.em, tipo: l.tipo, valor: l.valor, valor_compra: l.valorCompra ?? null, descricao: l.descricao }))

  const chave = (base: string) => `${base}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`

  const repo: Demonstracao = {
    modo: 'demonstracao',
    faltaConfigurar: false,
    papel,
    fraseDoErro,

    // --- a conta
    async estaLogado() {
      return conta() !== null
    },
    async entrar(email, senha) {
      const c = CONTAS_DE_TESTE.find((x) => x.email === email.trim().toLowerCase())
      if (!c || senha !== SENHA_DE_TESTE) throw new Error('invalid login credentials')
      armazem.setItem(SESSAO(papel), c.email)
    },
    async entrarComo(email) {
      await repo.entrar(email, SENHA_DE_TESTE)
    },
    async sair() {
      armazem.removeItem(SESSAO(papel))
    },
    contaAtual: () => conta(),

    // --- o cliente
    async lerCarteira(): Promise<Carteira | null> {
      const c = clienteDaConta()
      if (!c) {
        // A conta de loja ou de administração não é cliente do Clube: a tela diz isso.
        return {
          cliente_id: null, nome: conta()?.nome ?? '', e_do_clube: false, aderiu: false, acumulado: 0, disponivel: 0,
          vence_em: null, gatilho: 30, falta_para_liberar: 30, pode_descer: false, minimo_para_transferir: 30,
          pode_transferir_ate: 0,
        }
      }
      const m = ler()
      const gatilho = m.livro.config.gatilho
      const aderiu = m.aderiram.includes(c.id)
      const acumulado = saldo(m.livro, contaAcumulo(c.id))
      const disponivel = saldo(m.livro, contaDisponivel(c.id))
      return {
        cliente_id: c.id,
        nome: c.nome,
        e_do_clube: true,
        aderiu,
        acumulado,
        disponivel,
        vence_em: venceEmDisponivel(m.livro, c.id),
        gatilho,
        falta_para_liberar: Math.max(0, Math.round((gatilho - acumulado) * 100) / 100),
        pode_descer: acumulado >= gatilho,
        minimo_para_transferir: gatilho,
        pode_transferir_ate: acumulado >= gatilho ? acumulado : 0,
      }
    },
    async ativar() {
      const c = precisaEntrar()
      if (c.papel !== 'cliente') throw erroDoBanco('precisa_ser_do_clube')
      mudar((m) => {
        if (!m.aderiram.includes(c.id)) m.aderiram.push(c.id)
      })
    },
    async transferir(valor) {
      const c = precisaEntrar()
      mudar((m) => {
        const gatilho = m.livro.config.gatilho
        if (!(valor > 0)) throw erroDoBanco('valor_invalido')
        if (saldo(m.livro, contaAcumulo(c.id)) < gatilho) throw erroDoBanco('gatilho_nao_alcancado')
        if (valor + 0.005 < gatilho) throw erroDoBanco('abaixo_do_minimo')
        descerParaGastar(m.livro, c.id, valor, chave('descer'))
      })
    },
    async lerLojas(busca = ''): Promise<LojaDaRede[]> {
      const m = ler()
      const b = semAcento(busca.trim())
      return m.livro.lojas
        .filter((l) => m.lojas[l.id]?.ativa)
        .map((l) => ({
          loja_id: l.id,
          nome: l.nome,
          cashback_percentual: l.cashbackPercentual,
          cidade: m.lojas[l.id].cidade,
          uf: m.lojas[l.id].uf,
          catalogo_slug: null,
          clube_parceiro_id: null,
          desconto_no_caixa: m.lojas[l.id].descontoNoCaixa,
        }))
        .filter((l) => !b || semAcento(`${l.nome} ${l.cidade ?? ''} ${l.uf ?? ''}`).includes(b))
    },
    async lerExtrato() {
      const c = clienteDaConta()
      return c ? lancamentosDe(ler(), `cliente:${c.id}:`) : []
    },
    async lerMinhasCobrancas(): Promise<CobrancaDoCliente[]> {
      const c = clienteDaConta()
      if (!c) return []
      const m = ler()
      return m.livro.pagamentosPendentes
        .filter((p) => p.clienteId === c.id)
        .map((p) => ({
          id: p.id,
          loja_nome: m.livro.lojas.find((l) => l.id === p.lojaId)?.nome ?? 'A loja',
          valor_compra: p.valorCompra,
          valor_em_cash: p.valorEmCash,
          criado_em: p.criadoEm,
        }))
    },
    async minhaCarteirinha(): Promise<CarteirinhaDoClube | null> {
      const c = clienteDaConta()
      return c ? { ...CARTOES_DE_TESTE[c.id] } : null
    },
    async qrDaCarteirinha(): Promise<QrDaCarteirinha> {
      precisaEntrar()
      const c = clienteDaConta()
      if (!c) throw erroDoBanco('precisa_ser_do_clube')
      // Na demonstração o token é fixo (o balcão do /beta lê pelo atalho); o relógio de 90 s é o de verdade.
      return { token: CARTEIRINHAS_DE_TESTE[c.id], expira_em: new Date(Date.now() + 90_000).toISOString() }
    },
    async confirmarCobranca(id) {
      const c = precisaEntrar()
      mudar((m) => {
        const p = m.livro.pagamentosPendentes.find((x) => x.id === id && x.clienteId === c.id)
        if (!p) throw erroDoBanco('cobranca_nao_encontrada')
        confirmarPagamento(m.livro, id, `confirmar:${id}`)
      })
    },

    // --- o balcão
    async lerMinhaLoja(): Promise<MinhaLoja | null> {
      const m = ler()
      const loja = lojaDaConta(m)
      if (!loja) return null
      return {
        loja_id: loja.id,
        nome: loja.nome,
        cashback_percentual: loja.cashbackPercentual,
        desconto_no_caixa: m.lojas[loja.id].descontoNoCaixa,
        credito: saldo(m.livro, contaCredito(loja.id)),
        recebido: saldo(m.livro, contaRecebido(loja.id)),
        saque_pedido: m.saques.filter((s) => s.loja_id === loja.id && s.situacao === 'pedido').reduce((t, s) => t + s.valor, 0),
      }
    },
    async lerCarteirinha(token): Promise<Cliente | null> {
      const m = ler()
      const loja = lojaDaConta(m)
      if (!loja) throw erroDoBanco('nao_e_lojista')
      const id = Object.entries(CARTEIRINHAS_DE_TESTE).find(([, t]) => t === token)?.[0]
      if (!id) return null
      if (!m.aderiram.includes(id)) throw erroDoBanco('membro_nao_ativou')
      const pessoa = m.livro.clientes.find((x) => x.id === id)!
      return {
        cliente_id: id,
        nome: pessoa.nome,
        pode_usar_aqui: podeUsarNaLoja(m.livro, id, loja.id),
        acumulado: saldo(m.livro, contaAcumulo(id)),
        validacao_id: chave('validacao'),
        nivel: 'prime',
      }
    },
    async darCashback(clienteId, valorDaCompra) {
      mudar((m) => {
        const loja = lojaDaConta(m)
        if (!loja) throw erroDoBanco('nao_e_lojista')
        darCashback(m.livro, loja.id, clienteId, valorDaCompra, { presencial: true, chave: chave('troco') })
      })
    },
    async pedirPagamento(clienteId, valorDaCompra, valorEmCash) {
      mudar((m) => {
        const loja = lojaDaConta(m)
        if (!loja) throw erroDoBanco('nao_e_lojista')
        if (valorEmCash > valorDaCompra + 0.005) throw erroDoBanco('cash_passa_da_compra')
        pedirPagamento(m.livro, loja.id, clienteId, valorDaCompra, valorEmCash)
      })
    },
    async lerCobrancas(): Promise<Cobranca[]> {
      const m = ler()
      const loja = lojaDaConta(m)
      if (!loja) return []
      return m.livro.pagamentosPendentes
        .filter((p) => p.lojaId === loja.id)
        .map((p) => ({
          id: p.id,
          cliente_nome: m.livro.clientes.find((x) => x.id === p.clienteId)?.nome ?? 'Cliente',
          valor_compra: p.valorCompra,
          valor_em_cash: p.valorEmCash,
          criado_em: p.criadoEm,
        }))
    },
    async lerExtratoDaLoja() {
      const m = ler()
      const loja = lojaDaConta(m)
      return loja ? lancamentosDe(m, `loja:${loja.id}:`) : []
    },
    async pedirSaque(valor) {
      mudar((m) => {
        const loja = lojaDaConta(m)
        if (!loja) throw erroDoBanco('nao_e_lojista')
        const pedido = m.saques.filter((s) => s.loja_id === loja.id && s.situacao === 'pedido').reduce((t, s) => t + s.valor, 0)
        if (!(valor > 0) || valor > saldo(m.livro, contaRecebido(loja.id)) - pedido + 0.005) throw erroDoBanco('saldo_insuficiente')
        m.saques.unshift({
          id: chave('saque'),
          loja_id: loja.id,
          loja_nome: loja.nome,
          valor,
          situacao: 'pedido',
          pedido_em: new Date().toISOString(),
        })
      })
    },

    // --- o administrador
    eSoAdmin: (e) => String((e as Error)?.message ?? '').includes('so_admin'),
    async lerPainel(): Promise<Painel | null> {
      exigirAdmin()
      const m = ler()
      const existente = saldoTotal(m.livro)
      return {
        cash_existente: existente,
        dinheiro_em_custodia: m.livro.custodia,
        diferenca: Math.round((existente - m.livro.custodia) * 100) / 100,
        fecha: invarianteFecha(m.livro),
        fundo_de_promocao: saldo(m.livro, PROMOCIONAL),
        lojas: Object.values(m.lojas).filter((l) => l.ativa).length,
        clientes: m.aderiram.length,
        saques_a_pagar: m.saques.filter((s) => s.situacao === 'pedido').reduce((t, s) => t + s.valor, 0),
      }
    },
    async buscarLojistas(busca): Promise<Achado[]> {
      exigirAdmin()
      const b = semAcento(busca.trim())
      if (b.length < 3) return []
      const m = ler()
      return m.candidatos
        .filter((c) => semAcento(`${c.nome} ${c.contato}`).includes(b))
        .map((c) => {
          const id = Object.entries(m.lojas).find(([, l]) => l.origem === c.origem && l.origemId === c.origemId)?.[0] ?? null
          const loja = id ? m.livro.lojas.find((l) => l.id === id) : undefined
          return {
            origem: c.origem,
            origem_id: c.origemId,
            nome: c.nome,
            cidade: c.cidade,
            uf: c.uf,
            contato: c.contato,
            desconto_do_clube: c.descontoDoClube,
            loja_id: id,
            cashback_percentual: loja?.cashbackPercentual ?? null,
            vinculada: Boolean(id && m.lojas[id].ativa),
          }
        })
        .sort((a, z) => Number(z.vinculada) - Number(a.vinculada) || a.nome.localeCompare(z.nome))
    },
    async vincularLojista(origem, origemId, percentual) {
      exigirAdmin()
      return mudar((m) => {
        const c = m.candidatos.find((x) => x.origem === origem && x.origemId === origemId)
        if (!c) throw erroDoBanco(origem === 'qrunico' ? 'empresa_do_qrunico_nao_encontrada' : 'loja_do_catalogo_nao_encontrada')
        if (!(percentual > 0 && percentual <= 100)) throw erroDoBanco('percentual_invalido')
        let id = Object.entries(m.lojas).find(([, l]) => l.origem === origem && l.origemId === origemId)?.[0]
        if (!id) {
          id = `loja-${origemId}`
          m.livro.lojas.push({ id, nome: c.nome, cashbackPercentual: percentual })
          m.lojas[id] = { origem, origemId, descontoNoCaixa: 0, cidade: c.cidade, uf: c.uf, ativa: true }
        } else {
          m.livro.lojas.find((l) => l.id === id)!.cashbackPercentual = percentual
          m.lojas[id].ativa = true
        }
        return id
      })
    },
    async salvarRegrasDaLoja(lojaId, troco, descontoNoCaixa) {
      exigirAdmin()
      mudar((m) => {
        if (!(troco > 0 && troco <= 100) || !(descontoNoCaixa >= 0 && descontoNoCaixa < 100)) throw erroDoBanco('percentual_invalido')
        if (troco + descontoNoCaixa > 100) throw erroDoBanco('regras_passam_de_100')
        const loja = m.livro.lojas.find((l) => l.id === lojaId)
        if (!loja || !m.lojas[lojaId]) throw erroDoBanco('loja_nao_encontrada')
        loja.cashbackPercentual = troco
        m.lojas[lojaId].descontoNoCaixa = descontoNoCaixa
      })
    },
    async lerLojasDoAdmin(): Promise<LojaAdmin[]> {
      exigirAdmin()
      const m = ler()
      return m.livro.lojas
        .map((l) => {
          const x = m.lojas[l.id]
          return {
            loja_id: l.id,
            nome: l.nome,
            origem: x.origem,
            cashback_percentual: l.cashbackPercentual,
            desconto_no_caixa: x.descontoNoCaixa,
            ativa: x.ativa,
            cidade: x.cidade,
            uf: x.uf,
            credito: saldo(m.livro, contaCredito(l.id)),
            recebido: saldo(m.livro, contaRecebido(l.id)),
            saque_pedido: m.saques.filter((s) => s.loja_id === l.id && s.situacao === 'pedido').reduce((t, s) => t + s.valor, 0),
          }
        })
        .sort((a, z) => Number(z.ativa) - Number(a.ativa) || a.nome.localeCompare(z.nome))
    },
    async registrarDeposito(lojaId, valor, chaveDoToque) {
      exigirAdmin()
      mudar((m) => {
        if (!(valor > 0)) throw erroDoBanco('valor_invalido')
        depositar(m.livro, lojaId, valor, chaveDoToque)
      })
    },
    async lerSaquesPedidos() {
      exigirAdmin()
      return ler().saques
    },
    async pagarSaque(id) {
      exigirAdmin()
      mudar((m) => {
        const s = m.saques.find((x) => x.id === id)
        if (!s) throw erroDoBanco('pedido_nao_encontrado')
        if (s.situacao !== 'pedido') throw erroDoBanco('pedido_ja_resolvido')
        sacar(m.livro, s.loja_id, s.valor, `saque:${id}`)
        s.situacao = 'pago'
      })
    },
    async recusarSaque(id) {
      exigirAdmin()
      mudar((m) => {
        const s = m.saques.find((x) => x.id === id && x.situacao === 'pedido')
        if (!s) throw erroDoBanco('pedido_nao_encontrado')
        s.situacao = 'recusado'
      })
    },
    async vencerAgora() {
      exigirAdmin()
      return mudar((m) => avancarPara(m.livro, m.livro.hoje).length)
    },

    // --- a recarga por Pix (19/11): as MESMAS regras da 0027
    async pedirRecarga(valor): Promise<RecargaCriada> {
      precisaEntrar()
      return mudar((m) => {
        const loja = lojaDaConta(m)
        if (!loja) throw erroDoBanco('nao_e_lojista')
        const v = Math.round(Number(valor) * 100) / 100
        if (!(v > 0) || v > 10000) throw erroDoBanco('valor_invalido')
        if (v < RECARGA_MINIMA) throw erroDoBanco('recarga_abaixo_do_minimo')
        m.recargas ??= []
        const abertas = m.recargas.filter(
          (r) => r.loja_id === loja.id && r.situacao === 'aguardando' && Date.now() - Date.parse(r.criada_em) < 600_000,
        )
        if (abertas.length >= 5) throw erroDoBanco('recargas_demais')
        const id = chave('recarga')
        const expira = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
        m.recargas.push({
          id, loja_id: loja.id, loja_nome: loja.nome, valor: v, situacao: 'aguardando', criada_em: new Date().toISOString(),
          paga_em: null, valor_pago: null, taxa_do_provedor: null, valor_liquido: null, confirmada_por: null,
        })
        // Um Pix de mentira, com cara de Pix: o QR abre, mas nenhum banco paga (é o /beta).
        return { recarga_id: id, valor: v, copia_e_cola: `000201-DEMONSTRACAO-TROCO-PRIME-${id}`, expira_em: expira }
      })
    },
    async lerMinhasRecargas(): Promise<Recarga[]> {
      const m = ler()
      const loja = lojaDaConta(m)
      if (!loja) throw erroDoBanco('nao_e_lojista')
      return (m.recargas ?? [])
        .filter((r) => r.loja_id === loja.id)
        .sort((a, b) => b.criada_em.localeCompare(a.criada_em))
        .slice(0, 20)
        .map((r) => ({
          id: r.id, valor: r.valor, situacao: r.situacao, criada_em: r.criada_em, paga_em: r.paga_em,
          copia_e_cola: r.situacao === 'aguardando' ? 'DEMONSTRACAO' : null, expira_em: null,
        }))
    },
    async lerRecargas(): Promise<RecargaAdmin[]> {
      exigirAdmin()
      return [...(ler().recargas ?? [])].sort(
        (a, b) => Number(b.situacao !== 'paga') - Number(a.situacao !== 'paga') || b.criada_em.localeCompare(a.criada_em),
      )
    },
    async confirmarRecarga(id) {
      exigirAdmin()
      return mudar((m) => {
        const r = (m.recargas ?? []).find((x) => x.id === id)
        if (!r || r.situacao === 'cancelada') throw erroDoBanco('recarga_nao_encontrada')
        if (r.situacao === 'paga') return 'ja_paga'
        depositar(m.livro, r.loja_id, r.valor, `recarga:${r.id}`)
        Object.assign(r, { situacao: 'paga', paga_em: new Date().toISOString(), confirmada_por: 'admin' })
        return 'creditada'
      })
    },
    async simularPixPago(recargaId) {
      return mudar((m) => {
        const r = (m.recargas ?? []).find((x) => x.id === recargaId)
        if (!r) return 'nao_encontrada'
        if (r.situacao === 'paga') return 'ja_paga'
        const taxa = Math.round(r.valor * 0.99) / 100
        depositar(m.livro, r.loja_id, r.valor, `recarga:${r.id}`)
        Object.assign(r, {
          situacao: 'paga', paga_em: new Date().toISOString(), valor_pago: r.valor, taxa_do_provedor: taxa,
          valor_liquido: Math.round((r.valor - taxa) * 100) / 100, confirmada_por: 'provedor',
        })
        return 'creditada'
      })
    },

    // --- o cadastro da loja (22/11): as MESMAS recusas da 0028
    async pedirParaSerLoja(d) {
      const c = precisaEntrar()
      return mudar((m) => {
        if (lojaDaConta(m)) throw erroDoBanco('ja_e_lojista')
        const doc = d.documento.replace(/\D/g, '')
        const fone = d.whatsapp.replace(/\D/g, '')
        if (d.nome.trim().length < 2) throw erroDoBanco('nome_da_loja_vazio')
        if (!documentoValido(doc)) throw erroDoBanco('documento_invalido')
        if (fone.length < 10 || fone.length > 13) throw erroDoBanco('whatsapp_invalido')
        if (!d.cidade.trim() || !/^[A-Za-z]{2}$/.test(d.uf.trim())) throw erroDoBanco('cidade_e_uf')
        if (!(d.troco > 0 && d.troco <= 100) || !(d.desconto >= 0 && d.desconto < 100)) throw erroDoBanco('percentual_invalido')
        if (d.troco + d.desconto > 100) throw erroDoBanco('regras_passam_de_100')
        m.pedidosDeLoja ??= []
        const aberto = m.pedidosDeLoja.find((p) => p.pedido_por === c.id && p.situacao === 'pedido')
        const dados = {
          nome: d.nome.trim(), documento: doc, whatsapp: fone, cidade: d.cidade.trim(), uf: d.uf.trim().toUpperCase(),
          troco_percentual: d.troco, desconto_no_caixa: d.desconto, criado_em: new Date().toISOString(),
        }
        if (aberto) {
          Object.assign(aberto, dados)
          return aberto.id
        }
        const id = chave('pedido-de-loja')
        m.pedidosDeLoja.push({
          id, pedido_por: c.id, email: c.email, situacao: 'pedido', motivo: null, decidido_em: null, loja_id: null, ...dados,
        })
        return id
      })
    },
    async meuPedidoDeLoja(): Promise<MeuPedidoDeLoja | null> {
      const c = precisaEntrar()
      const p = [...(ler().pedidosDeLoja ?? [])].filter((x) => x.pedido_por === c.id).pop()
      return p ? { id: p.id, nome: p.nome, situacao: p.situacao, motivo: p.motivo, criado_em: p.criado_em, decidido_em: p.decidido_em } : null
    },
    async lerPedidosDeLoja(): Promise<PedidoDeLojaAdmin[]> {
      exigirAdmin()
      return [...(ler().pedidosDeLoja ?? [])].sort(
        (a, b) => Number(b.situacao === 'pedido') - Number(a.situacao === 'pedido') || b.criado_em.localeCompare(a.criado_em),
      )
    },
    async aprovarLoja(pedidoId, origem, origemId) {
      exigirAdmin()
      return mudar((m) => {
        const p = (m.pedidosDeLoja ?? []).find((x) => x.id === pedidoId)
        if (!p || p.situacao !== 'pedido') throw erroDoBanco('pedido_de_loja_nao_encontrado')
        if (origem !== 'troco' && !origemId) throw erroDoBanco('origem_invalida')
        // Na demonstração a loja nasce com o id da conta de quem pediu: é assim que o balcão dela a acha.
        const id = p.pedido_por
        m.livro.lojas.push({ id, nome: p.nome, cashbackPercentual: p.troco_percentual })
        m.lojas[id] = {
          origem: origem === 'troco' ? 'clube' : origem, origemId: origemId ?? id, descontoNoCaixa: p.desconto_no_caixa,
          cidade: p.cidade, uf: p.uf, ativa: true,
        }
        Object.assign(p, { situacao: 'aprovado', loja_id: id, decidido_em: new Date().toISOString() })
        return id
      })
    },
    async recusarLoja(pedidoId, motivo) {
      exigirAdmin()
      mudar((m) => {
        const p = (m.pedidosDeLoja ?? []).find((x) => x.id === pedidoId)
        if (!p || p.situacao !== 'pedido') throw erroDoBanco('pedido_de_loja_nao_encontrado')
        Object.assign(p, { situacao: 'recusado', motivo: motivo.trim() || null, decidido_em: new Date().toISOString() })
      })
    },

    // --- o que só a demonstração tem
    recomecar() {
      armazem.setItem(CHAVE, JSON.stringify(mundoInicial()))
      for (const p of ['cliente', 'loja', 'admin'] as Papel[]) armazem.removeItem(SESSAO(p))
    },
    passarDias(dias) {
      return mudar((m) => avancarPara(m.livro, somarDias(m.livro.hoje, dias)).length)
    },
    hoje: () => ler().livro.hoje,
  }
  return repo
}

/** O nome da unidade, para os textos da faixa de demonstração. */
export const UNIDADE = MARCA.moeda
