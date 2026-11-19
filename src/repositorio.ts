// ---------------------------------------------------------------------------
// TUDO O QUE AS TELAS PEDEM AOS DADOS, numa interface só (19/11).
//
// Duas respostas para a mesma pergunta, como no Aviso de Entrega (`src/lib/dados/tipos.ts` de lá):
//   - o BANCO (`repositorioDoBanco`, abaixo): o site, o /app e o balcão de verdade, pela fronteira `public.cash_*`;
//   - a DEMONSTRAÇÃO (`demonstracao/repositorio.ts`): o /beta, com o motor de dinheiro do navegador
//     (`nucleo/livro.ts`, as mesmas regras do banco) e os dados de teste guardados só neste aparelho.
//
// As telas não sabem de qual dos dois vem a resposta. É isso que deixa ele testar o aplicativo inteiro no /beta sem
// encostar em dinheiro de ninguém.
// ---------------------------------------------------------------------------

import type { Carteira, CobrancaDoCliente, Lancamento, LojaDaRede } from './carteira/estado'
import type { Cliente, Cobranca, MinhaLoja } from './balcao/estado'
import type { Achado, LojaAdmin, Painel, SaquePedido } from './admin/estado'
import * as banco from './dados'

export interface Repositorio {
  readonly modo: 'banco' | 'demonstracao'
  /** Só no banco: publicado sem as variáveis do Supabase. */
  readonly faltaConfigurar: boolean
  fraseDoErro(e: unknown): string

  // a conta
  estaLogado(): Promise<boolean>
  entrar(email: string, senha: string): Promise<void>
  sair(): Promise<void>

  // o cliente
  lerCarteira(): Promise<Carteira | null>
  ativar(): Promise<void>
  transferir(valor: number): Promise<void>
  lerLojas(busca?: string): Promise<LojaDaRede[]>
  lerExtrato(): Promise<Lancamento[]>
  lerMinhasCobrancas(): Promise<CobrancaDoCliente[]>
  confirmarCobranca(id: string): Promise<void>

  // o balcão
  lerMinhaLoja(): Promise<MinhaLoja | null>
  lerCarteirinha(token: string): Promise<Cliente | null>
  darCashback(clienteId: string, valorDaCompra: number, validacaoId: string | null): Promise<void>
  pedirPagamento(clienteId: string, valorDaCompra: number, valorEmCash: number): Promise<void>
  lerCobrancas(): Promise<Cobranca[]>
  lerExtratoDaLoja(): Promise<Lancamento[]>
  pedirSaque(valor: number): Promise<void>

  // o administrador
  eSoAdmin(e: unknown): boolean
  lerPainel(): Promise<Painel | null>
  buscarLojistas(busca: string): Promise<Achado[]>
  vincularLojista(origem: Achado['origem'], origemId: string, percentual: number): Promise<string>
  salvarRegrasDaLoja(lojaId: string, troco: number, descontoNoCaixa: number): Promise<void>
  lerLojasDoAdmin(): Promise<LojaAdmin[]>
  registrarDeposito(lojaId: string, valor: number, chave: string): Promise<void>
  lerSaquesPedidos(): Promise<SaquePedido[]>
  pagarSaque(id: string): Promise<void>
  recusarSaque(id: string): Promise<void>
  vencerAgora(): Promise<number>
}

/** O banco de verdade: as mesmas funções de `dados.ts`, que o site já usava. */
export const repositorioDoBanco: Repositorio = {
  modo: 'banco',
  faltaConfigurar: banco.faltaConfigurar,
  fraseDoErro: banco.fraseDoErro,
  estaLogado: banco.estaLogado,
  entrar: banco.entrar,
  sair: banco.sair,
  lerCarteira: banco.lerCarteira,
  ativar: banco.ativar,
  transferir: banco.transferir,
  lerLojas: banco.lerLojas,
  lerExtrato: banco.lerExtrato,
  lerMinhasCobrancas: banco.lerMinhasCobrancas,
  confirmarCobranca: banco.confirmarCobranca,
  lerMinhaLoja: banco.lerMinhaLoja,
  lerCarteirinha: banco.lerCarteirinha,
  darCashback: banco.darCashback,
  pedirPagamento: banco.pedirPagamento,
  lerCobrancas: banco.lerCobrancas,
  lerExtratoDaLoja: banco.lerExtratoDaLoja,
  pedirSaque: banco.pedirSaque,
  eSoAdmin: banco.eSoAdmin,
  lerPainel: banco.lerPainel,
  buscarLojistas: banco.buscarLojistas,
  vincularLojista: banco.vincularLojista,
  salvarRegrasDaLoja: banco.salvarRegrasDaLoja,
  lerLojasDoAdmin: banco.lerLojasDoAdmin,
  registrarDeposito: banco.registrarDeposito,
  lerSaquesPedidos: banco.lerSaquesPedidos,
  pagarSaque: banco.pagarSaque,
  recusarSaque: banco.recusarSaque,
  vencerAgora: banco.vencerAgora,
}
