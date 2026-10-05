// ---------------------------------------------------------------------------
// A CONTA DA PESSOA. O endereço principal do cash.
//
// Este arquivo só COSTURA: a decisão de qual tela mostrar está em
// `carteira/estado.ts`, o desenho em `carteira/tela.ts`, e a conversa com o
// banco em `dados.ts`. A separação existe para a trava poder montar a tela de
// verdade e ler o que aparece, sem rede -- ver `carteira/tela.test.ts`.
//
// A demonstração do modelo (balcão, carteira, rede, relógio) mudou para
// `/demonstracao.html` e continua funcionando sem banco nenhum.
// ---------------------------------------------------------------------------

import './estilo.css'
import { MARCA } from './marca'
import { desenhar, type Acoes, type Dados } from './carteira/tela'
import {
  ativar,
  entrar,
  estaLogado,
  faltaConfigurar,
  fraseDoErro,
  lerCarteira,
  lerExtrato,
  lerLojas,
  sair,
  transferir,
} from './dados'

const onde = document.getElementById('app')!
document.documentElement.style.setProperty('--cash', MARCA.cor)

const dados: Dados = {
  faltaConfigurar,
  logado: false,
  carteira: null,
  lojas: [],
  extrato: [],
  erro: null,
  ocupado: false,
}

function pintar() {
  desenhar(onde, dados, acoes)
}

/** Roda uma ação, mostra o erro em vez de engolir, e sempre repinta. */
async function tentar(o_que: () => Promise<void>) {
  dados.ocupado = true
  dados.erro = null
  pintar()
  try {
    await o_que()
    await carregar()
  } catch (e) {
    dados.erro = fraseDoErro(e)
  } finally {
    dados.ocupado = false
    pintar()
  }
}

const acoes: Acoes = {
  entrar: (email, senha) => tentar(() => entrar(email, senha)),
  ativar: () => tentar(ativar),
  transferir: (valor) => tentar(() => transferir(valor)),
  sair: () =>
    tentar(async () => {
      await sair()
      dados.carteira = null
      dados.extrato = []
    }),
}

async function carregar() {
  dados.logado = await estaLogado()
  if (!dados.logado) {
    dados.carteira = null
    // AS LOJAS APARECEM ANTES DO LOGIN, de propósito: quem chegou sem conta
    // precisa ver onde ganharia antes de decidir entrar. Pedir login para só
    // depois mostrar a oferta é pedir fé.
    dados.lojas = await lerLojas().catch(() => [])
    return
  }
  dados.carteira = await lerCarteira()
  dados.lojas = await lerLojas().catch(() => [])
  dados.extrato = dados.carteira?.aderiu ? await lerExtrato().catch(() => []) : []
}

async function comecar() {
  // Sem as variáveis não há nem o que perguntar: a tela mostra o aviso (e ele
  // manda PUBLICAR DE NOVO, porque o pacote construído sem elas não tem nem a
  // biblioteca dentro -- ver `tela.ts`).
  pintar()
  if (faltaConfigurar) return
  await carregar()
  pintar()
}

void comecar()
