// ---------------------------------------------------------------------------
// AS TRÊS TELAS, prontas para montar em qualquer lugar com qualquer dado (19/11).
//
// Antes, cada página costurava a tela direto no banco (`main.ts`, `balcao.ts`, `admin.ts`). Agora a costura recebe o
// `Repositorio`: o site e o /app passam o banco de verdade, o /beta passa a demonstração. As telas são as MESMAS; só a
// resposta dos dados muda. O desenho de cada uma continua em `carteira/`, `balcao/` e `admin/`, testado montando a tela.
// ---------------------------------------------------------------------------

import { MARCA } from '../marca'
import type { Repositorio } from '../repositorio'
import { desenhar, type Acoes, type Dados } from '../carteira/tela'
import { desenharBalcao, type AcoesDoBalcao, type DadosDoBalcao, type ModoDoAtendimento } from '../balcao/tela'
import { desenharAdmin, type AcoesDoAdmin, type DadosDoAdmin } from '../admin/tela'
import { emReais, regraEmTexto } from '../admin/estado'
import { extrairToken } from '../lib/token'
import { ligarCamera, type EstadoDaCamera, type Leitor } from '../balcao/leitorQr'
import { abrirFolhaDoQr, type Folha } from '../carteirinha/tela'
import { abrirFolhaDeRecarga, type FolhaDeRecarga } from '../recarga/folha'

/** O que a montagem devolve: repintar quando os dados mudarem por fora, e desmontar ao sair da tela. */
export interface Montada {
  recarregar(): Promise<void>
  desmontar(): void
}

// --- a conta do cliente ------------------------------------------------------------

export interface OpcoesDaConta {
  /** Uma linha a mais na folha do QR (a demonstração explica como a loja lê sem câmera). */
  dicaDaCarteirinha?: (nome: string) => string
}

export function montarConta(onde: HTMLElement, repo: Repositorio, opcoes: OpcoesDaConta = {}): Montada {
  let folha: Folha | null = null
  const dados: Dados = {
    faltaConfigurar: repo.faltaConfigurar,
    logado: false,
    carteira: null,
    lojas: [],
    extrato: [],
    cobrancas: [],
    erro: null,
    ocupado: false,
  }
  const pintar = () => desenhar(onde, dados, acoes)

  async function carregar() {
    dados.logado = await repo.estaLogado()
    if (!dados.logado) {
      dados.carteira = null
      dados.carteirinha = null
      // AS LOJAS APARECEM ANTES DO LOGIN, de propósito: quem chegou sem conta precisa ver onde ganharia antes de
      // decidir entrar.
      dados.lojas = await repo.lerLojas().catch(() => [])
      return
    }
    dados.carteira = await repo.lerCarteira()
    dados.carteirinha = dados.carteira?.e_do_clube ? await repo.minhaCarteirinha().catch(() => null) : null
    dados.lojas = await repo.lerLojas().catch(() => [])
    dados.extrato = dados.carteira?.aderiu ? await repo.lerExtrato().catch(() => []) : []
    dados.cobrancas = dados.carteira?.aderiu ? await repo.lerMinhasCobrancas().catch(() => []) : []
  }

  /** Roda uma ação, mostra o erro em vez de engolir, e sempre repinta. */
  async function tentar(oQue: () => Promise<void>) {
    dados.ocupado = true
    dados.erro = null
    pintar()
    try {
      await oQue()
      await carregar()
    } catch (e) {
      dados.erro = repo.fraseDoErro(e)
    } finally {
      dados.ocupado = false
      pintar()
    }
  }

  const acoes: Acoes = {
    entrar: (email, senha) => tentar(() => repo.entrar(email, senha)),
    ativar: () => tentar(() => repo.ativar()),
    transferir: (valor) => tentar(() => repo.transferir(valor)),
    confirmar: (id) => tentar(() => repo.confirmarCobranca(id)),
    mostrarCarteirinha: () => {
      const c = dados.carteirinha
      if (!c || !c.ativa || folha) return
      folha = abrirFolhaDoQr({
        carteirinha: c,
        pedirQr: () => repo.qrDaCarteirinha(),
        fraseDoErro: (e) => repo.fraseDoErro(e),
        dica: opcoes.dicaDaCarteirinha?.(c.nome),
        aoFechar: () => {
          folha = null
        },
      })
    },
    sair: () =>
      tentar(async () => {
        await repo.sair()
        folha?.fechar()
        dados.carteira = null
        dados.carteirinha = null
        dados.extrato = []
        dados.cobrancas = []
      }),
  }

  const recarregar = async () => {
    pintar()
    if (repo.faltaConfigurar) return
    try {
      await carregar()
    } catch (e) {
      dados.erro = repo.fraseDoErro(e)
    }
    pintar()
  }
  void recarregar()
  return {
    recarregar,
    desmontar: () => {
      folha?.fechar()
      onde.replaceChildren()
    },
  }
}

// --- o balcão da loja --------------------------------------------------------------

export interface OpcoesDoBalcao {
  /** Sem câmera (a demonstração no computador): só o campo de digitar o código, e os atalhos de teste. */
  semCamera?: boolean
  /** Só no /beta: o botão que faz o papel do Mercado Pago avisando que o Pix foi pago. */
  simularPix?: (recargaId: string) => Promise<string>
}

export interface BalcaoMontado extends Montada {
  /** Lê um código como se a câmera tivesse lido (os atalhos da demonstração usam). */
  lerCodigo(texto: string): Promise<void>
}

export function montarBalcao(onde: HTMLElement, repo: Repositorio, opcoes: OpcoesDoBalcao = {}): BalcaoMontado {
  let folhaDaRecarga: FolhaDeRecarga | null = null
  const dados: DadosDoBalcao = {
    faltaConfigurar: repo.faltaConfigurar,
    logado: false,
    carregando: false,
    loja: null,
    cliente: null,
    modo: 'dar',
    cobrancas: [],
    extrato: [],
    camera: opcoes.semCamera ? 'sem-camera' : 'ligando',
    erro: null,
    recado: null,
    ocupado: false,
  }
  let leitor: Leitor | null = null
  let montado = true
  const pintar = () => {
    if (montado) desenharBalcao(onde, dados, acoes)
  }

  async function tentar(oQue: () => Promise<void>) {
    dados.ocupado = true
    dados.erro = null
    pintar()
    try {
      await oQue()
    } catch (e) {
      dados.erro = repo.fraseDoErro(e)
    } finally {
      dados.ocupado = false
      pintar()
    }
  }

  /**
   * O token lido, seja da câmera ou do campo. 🔴 O TOKEN SE GASTA NA LEITURA (no Clube de verdade), então o atendimento
   * inteiro acontece com o cliente JÁ na tela: ler de novo exige outro QR. Por isso a câmera para assim que alguém é
   * reconhecido, e volta a ler quando o vendedor diz "atender outro".
   */
  async function lerCodigo(bruto: string) {
    const token = extrairToken(bruto)
    if (!token) {
      dados.erro = 'Isso não é um código de carteirinha. Peça para o cliente abrir a carteirinha dele.'
      pintar()
      return
    }
    await tentar(async () => {
      const cliente = await repo.lerCarteirinha(token)
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
    if (opcoes.semCamera || !montado || leitor || dados.cliente || !dados.loja) return
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
        await repo.entrar(email, senha)
        await carregar()
      }),
    sair: () =>
      tentar(async () => {
        pararCamera()
        await repo.sair()
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
        await repo.darCashback(c.cliente_id, valorDaCompra, c.validacao_id)
        dados.recado = `${MARCA.nome} lançado para ${c.nome}.`
        dados.cliente = null
        await carregar()
        void ligar()
      }),
    cobrar: (valorDaCompra, valorEmCash) =>
      tentar(async () => {
        const c = dados.cliente
        if (!c) return
        await repo.pedirPagamento(c.cliente_id, valorDaCompra, valorEmCash)
        dados.recado = `Cobrança enviada. ${c.nome} confirma no celular dele.`
        dados.cliente = null
        await carregar()
        void ligar()
      }),
    pedirSaque: (valor) =>
      tentar(async () => {
        await repo.pedirSaque(valor)
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
    abrirRecarga: () => {
      if (folhaDaRecarga) return
      folhaDaRecarga = abrirFolhaDeRecarga({
        repo,
        simularPix: opcoes.simularPix,
        aoCreditar: () => {
          dados.recado = 'Crédito na conta. Já dá para dar troco.'
          void recarregar()
        },
        aoFechar: () => {
          folhaDaRecarga = null
        },
      })
    },
    video: null,
  }

  async function carregar() {
    dados.logado = await repo.estaLogado()
    if (!dados.logado) {
      dados.loja = null
      return
    }
    dados.carregando = true
    pintar()
    try {
      dados.loja = await repo.lerMinhaLoja()
      if (dados.loja) {
        dados.cobrancas = await repo.lerCobrancas().catch(() => [])
        dados.extrato = await repo.lerExtratoDaLoja().catch(() => [])
      }
    } finally {
      dados.carregando = false
    }
  }

  // A câmera NÃO fica acesa quando ninguém está olhando: luz acesa no balcão assusta cliente, e gasta bateria.
  const aoMudarVisibilidade = () => {
    if (document.hidden) pararCamera()
    else void ligar()
  }
  document.addEventListener('visibilitychange', aoMudarVisibilidade)

  const recarregar = async () => {
    pintar()
    if (repo.faltaConfigurar) return
    try {
      await carregar()
    } catch (e) {
      dados.erro = repo.fraseDoErro(e)
    }
    pintar()
    if (dados.loja) void ligar()
  }
  void recarregar()

  return {
    recarregar,
    lerCodigo,
    desmontar: () => {
      montado = false
      folhaDaRecarga?.fechar()
      pararCamera()
      document.removeEventListener('visibilitychange', aoMudarVisibilidade)
      onde.replaceChildren()
    },
  }
}

// --- o administrador ---------------------------------------------------------------

export function montarAdmin(onde: HTMLElement, repo: Repositorio): Montada {
  const dados: DadosDoAdmin = {
    faltaConfigurar: repo.faltaConfigurar,
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
  const pintar = () => desenharAdmin(onde, dados, acoes)

  async function recarregarDados() {
    try {
      const [painel, lojas, saques] = await Promise.all([repo.lerPainel(), repo.lerLojasDoAdmin(), repo.lerSaquesPedidos()])
      dados.painel = painel
      dados.lojas = lojas
      dados.saques = saques
      // As recargas vêm à parte: se a função ainda não existir no banco, o resto da administração continua de pé.
      dados.recargas = await repo.lerRecargas().catch(() => undefined)
      dados.naoEAdmin = false
    } catch (e) {
      if (repo.eSoAdmin(e)) {
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
      dados.erro = repo.fraseDoErro(e)
    } finally {
      dados.ocupado = false
      pintar()
    }
  }

  const acoes: AcoesDoAdmin = {
    entrar: (email, senha) =>
      tentar(async () => {
        await repo.entrar(email, senha)
        dados.logado = true
        await recarregarDados()
      }),
    sair: () =>
      tentar(async () => {
        await repo.sair()
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
        dados.achados = await repo.buscarLojistas(dados.busca)
      }),
    vincular: (origem, origemId, troco, descontoNoCaixa) =>
      tentar(async () => {
        const lojaId = await repo.vincularLojista(origem, origemId, troco)
        // As duas porcentagens moram juntas: vincular põe o troco; as regras põem o desconto no caixa (0 = só troco).
        await repo.salvarRegrasDaLoja(lojaId, troco, descontoNoCaixa)
        const nome = dados.achados?.find((a) => a.origem_id === origemId)?.nome ?? 'A loja'
        dados.achados = dados.busca ? await repo.buscarLojistas(dados.busca) : dados.achados
        await recarregarDados()
        dados.recado = `${nome} está no ${MARCA.nome}: ${regraEmTexto(troco, descontoNoCaixa)}. Agora registre o depósito dela.`
      }),
    salvarRegras: (lojaId, troco, descontoNoCaixa) =>
      tentar(async () => {
        await repo.salvarRegrasDaLoja(lojaId, troco, descontoNoCaixa)
        const nome = dados.lojas.find((l) => l.loja_id === lojaId)?.nome ?? 'A loja'
        await recarregarDados()
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
      onde.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    },
    confirmarDeposito: () =>
      tentar(async () => {
        const p = dados.depositoPendente
        if (!p) return
        await repo.registrarDeposito(p.loja_id, p.valor, chaveDoDeposito)
        dados.depositoPendente = null
        await recarregarDados()
        dados.recado = `Depósito de ${emReais(p.valor)} registrado para ${p.nome}.`
      }),
    cancelarDeposito: () => {
      dados.depositoPendente = null
      pintar()
    },
    pagarSaque: (id) =>
      tentar(async () => {
        try {
          await repo.pagarSaque(id)
          dados.recado = 'Saque marcado como pago.'
        } finally {
          await recarregarDados()
        }
      }),
    prepararRecarga: (id) => {
      dados.recargaAConfirmar = id
      pintar()
    },
    cancelarRecarga: () => {
      dados.recargaAConfirmar = null
      pintar()
    },
    confirmarRecarga: () =>
      tentar(async () => {
        const id = dados.recargaAConfirmar
        if (!id) return
        try {
          const r = await repo.confirmarRecarga(id)
          dados.recado = r === 'ja_paga' ? 'Essa recarga já estava paga.' : 'Recarga confirmada: o crédito entrou na loja.'
        } finally {
          dados.recargaAConfirmar = null
          await recarregarDados()
        }
      }),
    recusarSaque: (id) =>
      tentar(async () => {
        try {
          await repo.recusarSaque(id)
          dados.recado = 'Saque recusado. O valor continua no recebido da loja.'
        } finally {
          await recarregarDados()
        }
      }),
    vencerAgora: () =>
      tentar(async () => {
        const n = await repo.vencerAgora()
        await recarregarDados()
        dados.recado = n === 0 ? 'Nada para vencer hoje.' : `${n} ${n === 1 ? 'lote venceu' : 'lotes venceram'} e foram para o fundo.`
      }),
  }

  const recarregar = async () => {
    pintar()
    if (repo.faltaConfigurar) return
    try {
      dados.logado = await repo.estaLogado()
      if (dados.logado) await recarregarDados()
    } catch (e) {
      dados.erro = repo.fraseDoErro(e)
    }
    pintar()
  }
  void recarregar()
  return { recarregar, desmontar: () => onde.replaceChildren() }
}
