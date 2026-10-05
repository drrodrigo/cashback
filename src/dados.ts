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
import type { Carteira, Lancamento, LojaDaRede } from './carteira/estado'

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
  precisa_entrar: 'Entre na sua conta para ver o cashback.',
  precisa_ser_do_clube: 'A conta corrente de cash é do membro do Clube Prime. Entre no Clube e volte aqui.',
  gatilho_nao_alcancado: 'Você ainda não juntou o suficiente para transferir.',
  abaixo_do_minimo: 'A transferência tem um mínimo. Transfira pelo menos o valor indicado.',
  saldo_insuficiente: 'Você não tem esse valor juntado.',
  valor_invalido: 'Esse valor não serve.',
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
  const { data, error } = await cliente().rpc('cash_lojas_da_rede', { p_busca: busca })
  if (error) throw error
  return (data as LojaDaRede[] | null) ?? []
}

export async function lerExtrato(): Promise<Lancamento[]> {
  const { data, error } = await cliente().rpc('cash_meu_extrato', { p_limite: 30 })
  if (error) throw error
  return (data as Lancamento[] | null) ?? []
}
