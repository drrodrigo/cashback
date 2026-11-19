// ---------------------------------------------------------------------------
// O ADMINISTRADOR. O terceiro endereço do Troco Prime: `/admin.html`.
//
// Este arquivo só COSTURA: o que mostrar está em `admin/estado.ts`, o desenho em `admin/tela.ts` e a conversa com o
// banco em `dados.ts`. Quem decide se a pessoa é administradora é o banco, a cada chamada (`public.e_admin()`).
// ---------------------------------------------------------------------------

import './estilo.css'
import { MARCA } from './marca'
import { desenharAdmin, type AcoesDoAdmin, type DadosDoAdmin } from './admin/tela'
import { emReais, regraEmTexto } from './admin/estado'
import {
  buscarLojistas,
  eSoAdmin,
  entrar,
  estaLogado,
  faltaConfigurar,
  fraseDoErro,
  lerLojasDoAdmin,
  lerPainel,
  lerSaquesPedidos,
  pagarSaque,
  recusarSaque,
  registrarDeposito,
  sair,
  salvarRegrasDaLoja,
  vencerAgora,
  vincularLojista,
} from './dados'

const onde = document.getElementById('app')!
document.documentElement.style.setProperty('--cash', MARCA.cor)

const dados: DadosDoAdmin = {
  faltaConfigurar,
  logado: false,
  naoEAdmin: false,
  painel: null,
  busca: '',
  achados: null,
  lojas: [],
  saques: [],
  depositoPendente: null,
  erro: null,
  recado: null,
  ocupado: false,
}

/** A chave do depósito nasce quando a confirmação aparece: dois toques no "Confirmo" são UM depósito. */
let chaveDoDeposito = ''

function pintar() {
  desenharAdmin(onde, dados, acoes)
}

async function recarregar() {
  try {
    const [painel, lojas, saques] = await Promise.all([lerPainel(), lerLojasDoAdmin(), lerSaquesPedidos()])
    dados.painel = painel
    dados.lojas = lojas
    dados.saques = saques
    dados.naoEAdmin = false
  } catch (e) {
    if (eSoAdmin(e)) {
      dados.naoEAdmin = true
      return
    }
    throw e
  }
}

async function tentar(oQue: () => Promise<void>) {
  dados.ocupado = true
  dados.erro = null
  dados.recado = null
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

const acoes: AcoesDoAdmin = {
  entrar: (email, senha) =>
    tentar(async () => {
      await entrar(email, senha)
      dados.logado = true
      await recarregar()
    }),
  sair: () =>
    tentar(async () => {
      await sair()
      dados.logado = false
      dados.painel = null
      dados.lojas = []
      dados.saques = []
      dados.achados = null
      dados.naoEAdmin = false
    }),
  buscar: (texto) =>
    tentar(async () => {
      dados.busca = texto.trim()
      dados.achados = await buscarLojistas(dados.busca)
    }),
  vincular: (origem, origemId, troco, descontoNoCaixa) =>
    tentar(async () => {
      const lojaId = await vincularLojista(origem, origemId, troco)
      // As duas porcentagens moram juntas: vincular põe o troco; as regras põem o desconto no caixa (0 = só troco).
      await salvarRegrasDaLoja(lojaId, troco, descontoNoCaixa)
      const nome = dados.achados?.find((a) => a.origem_id === origemId)?.nome ?? 'A loja'
      dados.achados = dados.busca ? await buscarLojistas(dados.busca) : dados.achados
      await recarregar()
      dados.recado = `${nome} está no ${MARCA.nome}: ${regraEmTexto(troco, descontoNoCaixa)}. Agora registre o depósito dela.`
    }),
  salvarRegras: (lojaId, troco, descontoNoCaixa) =>
    tentar(async () => {
      await salvarRegrasDaLoja(lojaId, troco, descontoNoCaixa)
      const nome = dados.lojas.find((l) => l.loja_id === lojaId)?.nome ?? 'A loja'
      await recarregar()
      dados.recado = `${nome}: ${regraEmTexto(troco, descontoNoCaixa)}. O balcão dela já mostra a regra nova.`
    }),
  prepararDeposito: (lojaId, valor) => {
    const loja = dados.lojas.find((l) => l.loja_id === lojaId)
    if (!loja) return
    chaveDoDeposito = `deposito:${lojaId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`
    dados.depositoPendente = { loja_id: lojaId, nome: loja.nome, valor }
    dados.erro = null
    dados.recado = null
    pintar()
    window.scrollTo({ top: 0, behavior: 'smooth' })
  },
  confirmarDeposito: () =>
    tentar(async () => {
      const p = dados.depositoPendente
      if (!p) return
      await registrarDeposito(p.loja_id, p.valor, chaveDoDeposito)
      dados.depositoPendente = null
      await recarregar()
      dados.recado = `Depósito de ${emReais(p.valor)} registrado para ${p.nome}.`
    }),
  cancelarDeposito: () => {
    dados.depositoPendente = null
    pintar()
  },
  pagarSaque: (id) =>
    tentar(async () => {
      try {
        await pagarSaque(id)
        dados.recado = 'Saque marcado como pago.'
      } finally {
        await recarregar()
      }
    }),
  recusarSaque: (id) =>
    tentar(async () => {
      try {
        await recusarSaque(id)
        dados.recado = 'Saque recusado. O valor continua no recebido da loja.'
      } finally {
        await recarregar()
      }
    }),
  vencerAgora: () =>
    tentar(async () => {
      const n = await vencerAgora()
      await recarregar()
      dados.recado = n === 0 ? 'Nada para vencer hoje.' : `${n} ${n === 1 ? 'lote venceu' : 'lotes venceram'} e foram para o fundo.`
    }),
}

async function comecar() {
  pintar()
  if (faltaConfigurar) return
  try {
    dados.logado = await estaLogado()
    if (dados.logado) await recarregar()
  } catch (e) {
    dados.erro = fraseDoErro(e)
  }
  pintar()
}

void comecar()
