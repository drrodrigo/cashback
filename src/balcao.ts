// ---------------------------------------------------------------------------
// O BALCÃO DA LOJA. O outro endereço do cashback: `/balcao.html`.
//
// Este arquivo só COSTURA. A decisão de qual tela mostrar está em
// `balcao/estado.ts`, o desenho em `balcao/tela.ts`, a câmera em
// `balcao/leitorQr.ts` e a conversa com o banco em `dados.ts`.
// ---------------------------------------------------------------------------

import './estilo.css'
import { MARCA } from './marca'
import { extrairToken } from './lib/token'
import { ligarCamera, type EstadoDaCamera, type Leitor } from './balcao/leitorQr'
import {
  desenharBalcao,
  type AcoesDoBalcao,
  type DadosDoBalcao,
  type ModoDoAtendimento,
} from './balcao/tela'
import {
  pedirPagamento,
  darCashback,
  entrar,
  estaLogado,
  faltaConfigurar,
  fraseDoErro,
  lerCarteirinha,
  lerCobrancas,
  lerExtratoDaLoja,
  lerMinhaLoja,
  pedirSaque,
  sair,
} from './dados'

const onde = document.getElementById('app')!
document.documentElement.style.setProperty('--cash', MARCA.cor)

const dados: DadosDoBalcao = {
  faltaConfigurar,
  logado: false,
  carregando: false,
  loja: null,
  cliente: null,
  modo: 'dar',
  cobrancas: [],
  extrato: [],
  camera: 'ligando',
  erro: null,
  recado: null,
  ocupado: false,
}

let leitor: Leitor | null = null

function pintar() {
  desenharBalcao(onde, dados, acoes)
}

async function tentar(oQue: () => Promise<void>) {
  dados.ocupado = true
  dados.erro = null
  pintar()
  try {
    await oQue()
  } catch (e) {
    dados.erro = fraseDoErro(e)
  } finally {
    dados.ocupado = false
    pintar()
  }
}

/**
 * O token lido, seja da câmera ou do campo.
 *
 * 🔴 O TOKEN SE GASTA NA LEITURA, então o atendimento inteiro acontece com o
 * cliente JÁ na tela: ler de novo exige outro QR. Por isso a câmera para assim
 * que alguém é reconhecido -- e volta a ler quando o vendedor diz "atender
 * outro".
 */
async function lerCodigo(bruto: string) {
  const token = extrairToken(bruto)
  if (!token) {
    dados.erro = 'Isso não é um código de carteirinha. Peça para o cliente abrir a carteirinha dele.'
    pintar()
    return
  }
  await tentar(async () => {
    const cliente = await lerCarteirinha(token)
    if (!cliente) {
      dados.erro = 'Não achei esse cliente. Peça para ele gerar o código de novo.'
      return
    }
    dados.cliente = cliente
    dados.modo = 'dar'
    dados.recado = null
    pararCamera()
  })
}

function pararCamera() {
  leitor?.parar()
  leitor = null
  acoes.video = null
}

async function ligar() {
  if (leitor || dados.cliente || !dados.loja) return
  leitor = await ligarCamera(
    (texto) => void lerCodigo(texto),
    (e: EstadoDaCamera) => {
      dados.camera = e
      pintar()
    },
  )
  acoes.video = leitor.video
  pintar()
}

const acoes: AcoesDoBalcao = {
  entrar: (email, senha) =>
    tentar(async () => {
      await entrar(email, senha)
      await carregar()
    }),

  sair: () =>
    tentar(async () => {
      pararCamera()
      await sair()
      dados.loja = null
      dados.cliente = null
      dados.cobrancas = []
      dados.extrato = []
      dados.logado = false
    }),

  lerCodigo: (codigo) => lerCodigo(codigo),

  darCashback: (valorDaCompra) =>
    tentar(async () => {
      const c = dados.cliente
      if (!c) return
      await darCashback(c.cliente_id, valorDaCompra, c.validacao_id)
      dados.recado = `Cashback lançado para ${c.nome}.`
      dados.cliente = null
      await carregar()
      void ligar()
    }),

  cobrar: (valorDaCompra, valorEmCash) =>
    tentar(async () => {
      const c = dados.cliente
      if (!c) return
      await pedirPagamento(c.cliente_id, valorDaCompra, valorEmCash)
      dados.recado = `Cobrança enviada. ${c.nome} confirma no celular dele.`
      dados.cliente = null
      await carregar()
      void ligar()
    }),

  pedirSaque: (valor) =>
    tentar(async () => {
      await pedirSaque(valor)
      dados.recado = 'Saque pedido. A plataforma paga e marca aqui.'
      await carregar()
    }),

  limparAtendimento: () => {
    dados.cliente = null
    dados.erro = null
    pintar()
    void ligar()
  },

  escolher: (modo: ModoDoAtendimento) => {
    dados.modo = modo
    pintar()
  },

  video: null,
}

async function carregar() {
  dados.logado = await estaLogado()
  if (!dados.logado) {
    dados.loja = null
    return
  }
  dados.carregando = true
  pintar()
  try {
    dados.loja = await lerMinhaLoja()
    if (dados.loja) {
      dados.cobrancas = await lerCobrancas().catch(() => [])
      dados.extrato = await lerExtratoDaLoja().catch(() => [])
    }
  } finally {
    dados.carregando = false
  }
}

async function comecar() {
  pintar()
  if (faltaConfigurar) return
  await carregar()
  pintar()
  if (dados.loja) void ligar()
}

// A câmera NÃO fica acesa quando ninguém está olhando: luz acesa no balcão
// assusta cliente, e gasta bateria do aparelho do vendedor.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pararCamera()
  else void ligar()
})

void comecar()
