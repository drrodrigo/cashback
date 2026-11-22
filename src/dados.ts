// ---------------------------------------------------------------------------
// A CONVERSA COM O BANCO -- e ela passa SÓ pela fronteira.
//
// Nenhuma linha aqui lê tabela do schema `cash`. Não é disciplina minha: a
// gaveta é fechada (`anon` e `authenticated` não têm nem `usage` nela), então
// tentar seria erro de permissão. Quem serve a tela é a camada curta de funções
// `public.cash_*` -- e é essa lista que vira chamada de API no dia de separar o
// produto, sem a tela saber.
//
// 🔴 O LOGIN É O MESMO DO CLUBE, e isso foi MEDIDO, não suposto: existe uma
// `auth.users` só, com 5.083 contas, compartilhada por todos os produtos da casa
// (spec §17). Não há conta para criar nem dado para transferir -- o mesmo e-mail
// e a mesma senha entram aqui.
//
// E repare o que NÃO está aqui: `db: { schema: ... }`. O cliente do Clube aponta
// para o schema `clube`; este fica em `public` de propósito, porque é lá que a
// fronteira mora.
// ---------------------------------------------------------------------------

import { createClient } from '@supabase/supabase-js'
import type { Carteira, CobrancaDoCliente, Lancamento, LojaDaRede } from './carteira/estado'
import type { Cliente, Cobranca, MinhaLoja } from './balcao/estado'
import type { Achado, LojaAdmin, Painel, SaquePedido } from './admin/estado'
import type { CarteirinhaDoClube, QrDaCarteirinha } from './carteirinha/estado'
import type { Recarga, RecargaAdmin, RecargaCriada } from './recarga/estado'
import type { DadosDoPedidoDeLoja, MeuPedidoDeLoja, OrigemDaAprovacao, PedidoDeLojaAdmin } from './loja/estado'
import { MARCA } from './marca'

// `.trim()` porque copiar-e-colar em painel de deploy quase sempre traz um
// espaço ou uma quebra de linha grudada no fim -- o Clube já pagou por isso.
const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim()
const chaveBruta = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim()

// A chave vai num cabeçalho HTTP, e cabeçalho só aceita ASCII. Um caractere
// invisível que entre no copiar-e-colar faz o navegador recusar TODA requisição
// antes de sair, com "String contains non ISO-8859-1 code point" -- mensagem que
// não diz onde está o problema. Limpamos em vez de lançar: caractere invisível
// nunca faz parte de uma chave, então tirá-lo devolve a chave certa.
//
// E há um motivo a mais, específico desta casa: em 27/09 a chave chegou no painel
// da Vercel como `eyJhbGci` seguido de 200 bolinhas, porque o aplicativo de chat
// MASCARA texto com cara de chave e o que se copia é a máscara.
export const chave = [...chaveBruta].filter((c) => {
  const n = c.codePointAt(0) ?? 0
  return n > 32 && n < 127
}).join('')

/** Falta configuração? A tela precisa DIZER isso, não abrir branca. */
export const faltaConfigurar = !url || !chave

export const supabase = faltaConfigurar
  ? null
  : createClient(url, chave, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })

/** A frase que a pessoa lê quando a fronteira recusa. */
const FRASES: Record<string, string> = {
  precisa_entrar: `Entre na sua conta para ver o seu ${MARCA.nome}.`,
  precisa_ser_do_clube: `A conta corrente de ${MARCA.moeda} é do membro do Clube Prime. Entre no Clube e volte aqui.`,
  gatilho_nao_alcancado: 'Você ainda não juntou o suficiente para transferir.',
  abaixo_do_minimo: 'A transferência tem um mínimo. Transfira pelo menos o valor indicado.',
  saldo_insuficiente: 'Você não tem esse valor juntado.',
  valor_invalido: 'Esse valor não serve.',
  cobranca_nao_encontrada: 'Essa cobrança já foi confirmada ou cancelada. A lista foi atualizada.',
  cash_passa_da_compra: 'O troco não pode passar do valor da compra.',
  so_admin: 'Esta conta não é de administrador.',
  empresa_do_qrunico_nao_encontrada: 'Essa empresa não está mais ativa no QR Único.',
  loja_do_catalogo_nao_encontrada: 'Essa loja não existe mais no Catálogo Online.',
  pedido_ja_resolvido: 'Esse saque já foi resolvido por outra pessoa. A lista foi atualizada.',
  percentual_invalido: 'O troco tem que ser mais que 0% e até 100%; o desconto no caixa, de 0% a menos de 100%.',
  regras_passam_de_100: 'Desconto no caixa e troco juntos passam de 100%. Confira os números.',
  loja_nao_encontrada: 'Essa loja não está mais no Troco Prime. A lista foi atualizada.',
  // O balcão (19/11): até aqui estes chegavam crus na tela ("membro_nao_ativou").
  membro_nao_ativou: `Esse cliente ainda não ativou o ${MARCA.nome}. É um toque na conta dele, na parte do Clube Prime do QR Bio.`,
  nao_e_lojista: `Esta conta não é de uma loja do ${MARCA.nome}. Entre com o e-mail da loja.`,
  loja_sem_carteirinha: `Esta loja ainda não lê a carteirinha do Clube Prime. Fale com a administração do ${MARCA.nome}.`,
  loja_inativa: `Esta loja está desligada no ${MARCA.nome}. Fale com a administração.`,
  cliente_nao_encontrado: 'Esse cliente não foi encontrado. Leia a carteirinha de novo.',
  cashback_zero: `Com esse valor, o ${MARCA.moeda} dá zero. Confira o valor da compra.`,
  fundo_insuficiente: 'O fundo da rede não tem esse valor. É preciso depositar antes.',
  pedido_nao_encontrado: 'Esse pedido de saque não existe mais. A lista foi atualizada.',
  nao_e_do_clube: 'Essa pessoa não é do Clube Prime.',
  parceiro_nao_encontrado: 'Esse parceiro não existe mais no Clube Prime.',
  telefone_invalido: 'O telefone precisa ter DDD e número.',
  invariante_quebrada: 'A conta da rede não fechou, e nada foi lançado. Avise a administração.',
  // Os do Clube, que vêm na DICA de `clube.ler_carteirinha`.
  token_expirado: 'Esse QR já venceu ou já foi usado. Peça para o cliente abrir a carteirinha de novo.',
  qr_invalido: 'Esse QR não é de uma carteirinha do Clube Prime.',
  carteirinha_inativa: 'A carteirinha desse cliente está desligada no Clube Prime.',
  loja_nao_autorizada: 'Esta conta não é de uma loja ativa do Clube Prime.',
  // A recarga por Pix (19/11, 0027).
  recarga_abaixo_do_minimo: 'A recarga mínima é de R$ 100,00.',
  recargas_demais: 'Já tem Pix esperando pagamento. Pague o que está aberto, ou espere uns minutos para gerar outro.',
  recarga_nao_encontrada: 'Essa recarga não existe mais. A lista foi atualizada.',
  so_servidor: 'Só o sistema confirma o pagamento do Pix.',
  pix_desligado: 'O Pix automático ainda não está ligado. Fale com a administração do Troco Prime.',
  pix_falhou: 'O Mercado Pago não gerou o Pix agora. Tente de novo em instantes.',
  // O cadastro da loja (22/11, 0028).
  ja_e_lojista: `Esta conta já é de uma loja do ${MARCA.nome}. Saia e entre de novo para abrir o balcão.`,
  nome_da_loja_vazio: 'Escreva o nome da loja.',
  documento_invalido: 'Confira o CPF ou o CNPJ: algum número está errado.',
  whatsapp_invalido: 'O WhatsApp precisa do DDD e do número.',
  cidade_e_uf: 'Escreva a cidade e a UF (MG, SP...).',
  origem_invalida: 'Escolha como ligar a loja: só no Troco Prime, ou a uma loja do Catálogo ou do QR Único.',
  pedido_de_loja_nao_encontrado: 'Esse pedido já foi aprovado ou recusado. A lista foi atualizada.',
  loja_do_clube_tem_outro_dono: 'Já existe uma loja com esse nome no Clube Prime, de outro dono. Confira com a loja antes de aprovar.',
  parceiro_ja_tem_loja: 'Essa loja do Clube Prime já está ligada a outra loja do Troco Prime.',
  // A dica que o Clube manda quando quem aprova não é da administração DELE.
  nao_e_admin: 'Para aprovar, entre com a conta de administrador do Clube Prime: é o Clube que cadastra a loja parceira.',
}

/**
 * Transforma o erro do banco em frase de gente.
 *
 * 🔴 LÊ A MENSAGEM E A DICA. O cash põe o código na MENSAGEM; o Clube põe na
 * DICA e deixa a frase em português na mensagem. Ler só um dos dois é ficar cego
 * para metade dos erros -- e foi exatamente isso que deixou dois passos do
 * `fronteira.sql` vermelhos medindo a coisa errada, em 04/10.
 */
export function fraseDoErro(e: unknown): string {
  const bruto = e as { message?: string; hint?: string; details?: string } | null
  const junto = `${bruto?.message ?? ''} ${bruto?.hint ?? ''} ${bruto?.details ?? ''}`
  for (const [codigo, frase] of Object.entries(FRASES)) {
    if (junto.includes(codigo)) return frase
  }
  if (junto.toLowerCase().includes('invalid login credentials')) {
    return 'E-mail ou senha não conferem. É o mesmo login do Clube Prime.'
  }
  // Nada reconhecido: devolve o que veio, cortado. Engolir erro é pior -- a tela
  // fica igual e a pessoa não sabe se funcionou.
  const texto = (bruto?.message ?? '').trim()
  return texto ? texto.slice(0, 160) : 'Não deu certo agora. Tente de novo.'
}

function cliente() {
  if (!supabase) throw new Error('faltam as variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY')
  return supabase
}

export async function estaLogado(): Promise<boolean> {
  const { data } = await cliente().auth.getSession()
  return data.session !== null
}

export async function entrar(email: string, senha: string): Promise<void> {
  const { error } = await cliente().auth.signInWithPassword({ email: email.trim(), password: senha })
  if (error) throw error
}

export async function sair(): Promise<void> {
  await cliente().auth.signOut()
}

export async function lerCarteira(): Promise<Carteira | null> {
  const { data, error } = await cliente().rpc('cash_minha_carteira')
  if (error) throw error
  const linha = (data as Carteira[] | null)?.[0]
  return linha ?? null
}

export async function ativar(): Promise<void> {
  const { error } = await cliente().rpc('cash_aderir')
  if (error) throw error
}

export async function transferir(valor: number): Promise<void> {
  // A CHAVE DE IDEMPOTÊNCIA vem daqui, e não é preciosismo: é celular, com sinal
  // ruim, e o dedo toca duas vezes. Sem ela, dois toques viram duas
  // transferências -- e o ciclo dela recomeça sem motivo.
  const chaveDoToque = `descer:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`
  const { error } = await cliente().rpc('cash_descer', { p_valor: valor, p_chave: chaveDoToque })
  if (error) throw error
}

export async function lerLojas(busca = ''): Promise<LojaDaRede[]> {
  const { data, error } = await cliente().rpc('cash_lojas_da_rede_com_regras', { p_busca: busca })
  if (error) throw error
  return (data as LojaDaRede[] | null) ?? []
}

/** As cobranças de loja esperando a pessoa logada confirmar. */
export async function lerMinhasCobrancas(): Promise<CobrancaDoCliente[]> {
  const { data, error } = await cliente().rpc('cash_minhas_cobrancas')
  if (error) throw error
  return (data as CobrancaDoCliente[] | null) ?? []
}

/** Confirma a cobrança. A chave de idempotência é por toque: dois toques no "Confirmar" pagam UMA vez. */
export async function confirmarCobranca(cobrancaId: string): Promise<void> {
  const chave = `confirmar:${cobrancaId}`
  const { error } = await cliente().rpc('cash_confirmar', { p_pagamento: cobrancaId, p_chave: chave })
  if (error) throw error
}

export async function lerExtrato(): Promise<Lancamento[]> {
  const { data, error } = await cliente().rpc('cash_meu_extrato', { p_limite: 30 })
  if (error) throw error
  return (data as Lancamento[] | null) ?? []
}

// --- o BALCÃO -----------------------------------------------------------------
//
// Nenhuma destas lê tabela do schema `cash`: a gaveta é fechada (`anon` e
// `authenticated` não têm nem `usage` nela), então quem serve o balcão é a mesma
// camada curta de funções `public.cash_*`. Quem decide se a pessoa é lojista é o
// banco, a cada chamada -- guardar isso aqui deixaria quem vendeu a loja
// operando o balcão dela.

export async function lerMinhaLoja(): Promise<MinhaLoja | null> {
  const { data, error } = await cliente().rpc('cash_minha_loja')
  if (error) throw error
  return (data as MinhaLoja[] | null)?.[0] ?? null
}

/**
 * Lê a carteirinha do cliente e devolve quem é.
 *
 * 🔴 O TOKEN SE GASTA AQUI. Ele vale 90 segundos e UMA vez -- quem autoriza é o
 * Clube (`clube.ler_carteirinha`), não uma cópia da regra dele. Se a leitura
 * falhar depois de o token ter sido consumido, o cliente toca na carteirinha de
 * novo e sai outro: não há nada a desfazer, e é por isso que o crédito só é
 * lançado no passo seguinte.
 */
export async function lerCarteirinha(token: string): Promise<Cliente | null> {
  const { data, error } = await cliente().rpc('cash_balcao_ler_carteirinha', { p_token: token })
  if (error) throw error
  return (data as Cliente[] | null)?.[0] ?? null
}

/** Lança o cashback da compra na conta do cliente. */
export async function darCashback(
  clienteId: string,
  valorDaCompra: number,
  validacaoId: string | null,
): Promise<void> {
  // A CHAVE DE IDEMPOTÊNCIA, pelo mesmo motivo da transferência: é balcão, com
  // fila atrás, e o dedo toca duas vezes. Sem ela o cliente ganha em dobro e o
  // crédito da loja sai em dobro.
  const chaveDoToque = `cashback:${clienteId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`
  const { error } = await cliente().rpc('cash_balcao_dar_cashback', {
    p_cliente: clienteId,
    p_valor_compra: valorDaCompra,
    p_presencial: true,
    p_restrito: false,
    p_chave: chaveDoToque,
    p_validacao: validacaoId,
  })
  if (error) throw error
}

/**
 * PEDE a cobrança. Ela só vale depois que o cliente confirma na tela dele.
 *
 * Os dois números viram acordo entre as duas partes -- é isso que protege o
 * cliente de um débito errado, e é por isso que o balcão não debita sozinho.
 */
export async function pedirPagamento(
  clienteId: string,
  valorDaCompra: number,
  valorEmCash: number,
): Promise<void> {
  const { error } = await cliente().rpc('cash_balcao_pedir_pagamento', {
    p_cliente: clienteId,
    p_valor_compra: valorDaCompra,
    p_valor_em_cash: valorEmCash,
  })
  if (error) throw error
}

/** As cobranças desta loja esperando confirmação. Sem isto o balcão fica cego. */
export async function lerCobrancas(): Promise<Cobranca[]> {
  const { data, error } = await cliente().rpc('cash_balcao_pendentes')
  if (error) throw error
  return (data as Cobranca[] | null) ?? []
}

export async function lerExtratoDaLoja(): Promise<Lancamento[]> {
  const { data, error } = await cliente().rpc('cash_balcao_extrato', { p_limite: 30 })
  if (error) throw error
  return (data as Lancamento[] | null) ?? []
}

/** Pede o saque do que os clientes já pagaram. Quem manda o Pix é gente. */
export async function pedirSaque(valor: number): Promise<void> {
  const { error } = await cliente().rpc('cash_balcao_pedir_saque', { p_valor: valor })
  if (error) throw error
}

// --- o ADMINISTRADOR (19/11) ----------------------------------------------------
//
// Todas passam por `public.e_admin()` no banco, a cada chamada: a tela não guarda "sou admin", ela só repete o que
// o banco respondeu. Quem não é recebe `so_admin` em tudo.

export async function lerPainel(): Promise<Painel | null> {
  const { data, error } = await cliente().rpc('cash_admin_painel')
  if (error) throw error
  return (data as Painel[] | null)?.[0] ?? null
}

/** O erro do banco é o "você não é administrador"? (É o que muda a tela, não um recado.) */
export function eSoAdmin(e: unknown): boolean {
  const bruto = e as { message?: string; hint?: string } | null
  return `${bruto?.message ?? ''} ${bruto?.hint ?? ''}`.includes('so_admin')
}

/** Digita o nome, acha no Catálogo Online e no QR Único. */
export async function buscarLojistas(busca: string): Promise<Achado[]> {
  const { data, error } = await cliente().rpc('cash_admin_buscar_lojistas', { p_busca: busca })
  if (error) throw error
  return (data as Achado[] | null) ?? []
}

/** Vincula a loja e devolve o id dela no Troco Prime. */
export async function vincularLojista(origem: Achado['origem'], origemId: string, percentual: number): Promise<string> {
  const { data, error } =
    origem === 'qrunico'
      ? await cliente().rpc('cash_admin_vincular_qrunico', { p_usuario: origemId, p_cashback_percentual: percentual })
      : await cliente().rpc('cash_admin_ligar_loja_do_catalogo', {
          p_catalogo_loja_id: origemId,
          p_cashback_percentual: percentual,
        })
  if (error) throw error
  return String(data)
}

/** As regras da loja (19/11): % de troco e % de desconto no caixa. */
export async function salvarRegrasDaLoja(lojaId: string, troco: number, descontoNoCaixa: number): Promise<void> {
  const { error } = await cliente().rpc('cash_admin_regras_da_loja', {
    p_loja: lojaId,
    p_troco: troco,
    p_desconto_no_caixa: descontoNoCaixa,
  })
  if (error) throw error
}

export async function lerLojasDoAdmin(): Promise<LojaAdmin[]> {
  const { data, error } = await cliente().rpc('cash_admin_lojas')
  if (error) throw error
  return (data as LojaAdmin[] | null) ?? []
}

/**
 * Registra o depósito do lojista: é ele que vira o troco que a loja pode dar.
 *
 * A CHAVE DE IDEMPOTÊNCIA nasce na confirmação, uma por confirmação: dois toques no "Confirmo" viram UM depósito.
 */
export async function registrarDeposito(lojaId: string, valor: number, chave: string): Promise<void> {
  const { error } = await cliente().rpc('cash_admin_depositar', { p_loja: lojaId, p_valor: valor, p_chave: chave })
  if (error) throw error
}

export async function lerSaquesPedidos(): Promise<SaquePedido[]> {
  const { data, error } = await cliente().rpc('cash_admin_saques_pedidos')
  if (error) throw error
  return (data as SaquePedido[] | null) ?? []
}

export async function pagarSaque(id: string): Promise<void> {
  const { error } = await cliente().rpc('cash_admin_pagar_saque', { p_pedido: id })
  if (error) throw error
}

export async function recusarSaque(id: string): Promise<void> {
  const { error } = await cliente().rpc('cash_admin_recusar_saque', { p_pedido: id, p_motivo: '' })
  if (error) throw error
}

/** Adianta o vencimento de hoje. Devolve quantos lotes venceram. */
export async function vencerAgora(): Promise<number> {
  const { data, error } = await cliente().rpc('cash_admin_vencer')
  if (error) throw error
  return Number(data ?? 0)
}

/**
 * A carteirinha do Clube de quem está logado (0025), para o Troco Prime mostrar. Quem não é do Clube não tem: `null`,
 * e a tela simplesmente não desenha o cartão.
 */
export async function lerMinhaCarteirinha(): Promise<CarteirinhaDoClube | null> {
  const { data, error } = await cliente().rpc('cash_minha_carteirinha')
  if (error) {
    if (`${error.message ?? ''}`.includes('precisa_ser_do_clube')) return null
    throw error
  }
  return (data as CarteirinhaDoClube[] | null)?.[0] ?? null
}

/** O QR de 90 segundos da carteirinha (0025). Cada chamada é um token novo, de uso único. */
export async function pedirQrDaCarteirinha(): Promise<QrDaCarteirinha> {
  const { data, error } = await cliente().rpc('cash_qr_da_carteirinha')
  if (error) throw error
  const linha = (data as QrDaCarteirinha[] | null)?.[0]
  if (!linha) throw new Error('precisa_ser_do_clube')
  return linha
}

/**
 * A recarga por Pix (19/11). Quem cria o Pix é a função de borda `troco-recarga` (ela tem o token do Mercado Pago, o
 * navegador não): ela pede a recarga com o login da loja, cria o Pix e devolve o copia-e-cola.
 */
export async function pedirRecarga(valor: number): Promise<RecargaCriada> {
  const { data, error } = await cliente().functions.invoke('troco-recarga', { body: { valor } })
  if (error) {
    let codigo = 'pix_falhou'
    try {
      const corpo = (await (error as { context?: Response }).context?.json()) as { erro?: string } | undefined
      if (corpo?.erro) codigo = corpo.erro
    } catch {
      /* sem corpo: fica o genérico */
    }
    throw new Error(codigo)
  }
  const resposta = data as (RecargaCriada & { erro?: string }) | null
  if (!resposta || resposta.erro) throw new Error(resposta?.erro ?? 'pix_falhou')
  return resposta
}

export async function lerMinhasRecargas(): Promise<Recarga[]> {
  const { data, error } = await cliente().rpc('cash_minhas_recargas')
  if (error) throw error
  return (data as Recarga[] | null) ?? []
}

export async function lerRecargasDoAdmin(): Promise<RecargaAdmin[]> {
  const { data, error } = await cliente().rpc('cash_admin_recargas')
  if (error) throw error
  return (data as RecargaAdmin[] | null) ?? []
}

export async function confirmarRecarga(id: string): Promise<string> {
  const { data, error } = await cliente().rpc('cash_admin_confirmar_recarga', { p_recarga: id })
  if (error) throw error
  return String(data ?? '')
}

// --- o cadastro da loja (22/11, 0028) ---------------------------------------------------------------------------------

export async function pedirParaSerLoja(d: DadosDoPedidoDeLoja): Promise<string> {
  const { data, error } = await cliente().rpc('cash_pedir_para_ser_loja', {
    p_nome: d.nome,
    p_documento: d.documento,
    p_whatsapp: d.whatsapp,
    p_cidade: d.cidade,
    p_uf: d.uf,
    p_troco: d.troco,
    p_desconto: d.desconto,
  })
  if (error) throw error
  return String(data)
}

export async function meuPedidoDeLoja(): Promise<MeuPedidoDeLoja | null> {
  const { data, error } = await cliente().rpc('cash_meu_pedido_de_loja')
  if (error) throw error
  return (data as MeuPedidoDeLoja[] | null)?.[0] ?? null
}

export async function lerPedidosDeLoja(): Promise<PedidoDeLojaAdmin[]> {
  const { data, error } = await cliente().rpc('cash_admin_pedidos_de_loja')
  if (error) throw error
  return (data as PedidoDeLojaAdmin[] | null) ?? []
}

export async function aprovarLoja(pedidoId: string, origem: OrigemDaAprovacao, origemId?: string | null): Promise<string> {
  const { data, error } = await cliente().rpc('cash_admin_aprovar_loja', {
    p_pedido: pedidoId,
    p_origem: origem,
    p_origem_id: origemId ?? null,
  })
  if (error) throw error
  return String(data)
}

export async function recusarLoja(pedidoId: string, motivo: string): Promise<void> {
  const { error } = await cliente().rpc('cash_admin_recusar_loja', { p_pedido: pedidoId, p_motivo: motivo })
  if (error) throw error
}
