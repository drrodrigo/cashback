// ---------------------------------------------------------------------------
// A FOLHA "ADICIONAR CRÉDITO" DO BALCÃO (19/11).
//
// Ele: *"ele tem que (...) colocar lá R$ 100, R$ 50, R$ 200 para ele começar a trabalhar essa parte do troco (...) pelo
// menos os R$ 100 (...) ele tem que fazer um Pix para a gente, esse Pix cai na conta dele"*.
//
// Três momentos, na mesma folha que sobe de baixo (a mesma da carteirinha):
//   1. ESCOLHER: R$ 100 / 200 / 500 ou outro valor (mínimo R$ 100);
//   2. PAGAR: o QR do Pix e o "copia e cola"; a folha pergunta de 4 em 4 segundos se já caiu (só com a tela à vista);
//   3. PAGO: "R$ 100,00 de crédito na sua loja", e o balcão se atualiza sozinho.
// A folha tem a setinha de voltar (regra dele), e o "voltar" do celular fecha a folha.
// ---------------------------------------------------------------------------

import QRCode from 'qrcode'
import type { Repositorio } from '../repositorio'
import { MARCA } from '../marca'
import {
  RECARGA_MINIMA,
  VALORES_DE_RECARGA,
  lerValorDaRecarga,
  situacaoDaRecarga,
  type Recarga,
  type RecargaCriada,
} from './estado'

const reais = MARCA.reais

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { classe?: string; texto?: string } = {},
  filhos: (Node | null)[] = [],
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag)
  if (props.classe) n.className = props.classe
  if (props.texto !== undefined) n.textContent = props.texto
  for (const f of filhos) if (f) n.appendChild(f)
  return n
}

function botao(texto: string, classe: string, aoTocar: () => void): HTMLButtonElement {
  const b = el('button', { classe, texto })
  b.type = 'button'
  b.addEventListener('click', aoTocar)
  return b
}

export interface OpcoesDaFolhaDeRecarga {
  repo: Pick<Repositorio, 'pedirRecarga' | 'lerMinhasRecargas' | 'fraseDoErro'>
  /** O crédito caiu: o balcão se atualiza. */
  aoCreditar(): void
  /** Só no /beta: faz o papel do Mercado Pago avisando que foi pago. */
  simularPix?: (recargaId: string) => Promise<string>
  dentroDe?: HTMLElement
  /** De quantos em quantos milissegundos perguntar se o Pix caiu (o teste encurta). */
  intervalo?: number
  /** A folha fechou (pela setinha, pelo voltar do celular ou pelo fundo). */
  aoFechar?: () => void
}

export interface FolhaDeRecarga {
  readonly elemento: HTMLElement
  fechar(): void
}

export function abrirFolhaDeRecarga(o: OpcoesDaFolhaDeRecarga): FolhaDeRecarga {
  const onde = o.dentroDe ?? document.body
  const intervalo = o.intervalo ?? 4000
  let aberta = true
  let escolhido: number | null = VALORES_DE_RECARGA[0]
  let pix: RecargaCriada | null = null
  let ocupado = false
  let erro: string | null = null
  let pago = false
  let recentes: Recarga[] = []
  let timer: ReturnType<typeof setInterval> | null = null

  const fundo = el('div', { classe: 'ct-fundo' })
  const folha = el('section', { classe: 'ct-folha rc-folha' })
  folha.setAttribute('role', 'dialog')
  folha.setAttribute('aria-modal', 'true')
  folha.setAttribute('aria-label', 'Adicionar crédito')
  const barra = el('header', { classe: 'ct-barra' })
  const voltar = botao('←', 'app-seta ct-seta', () => fechar())
  voltar.setAttribute('aria-label', 'Voltar')
  barra.append(voltar, el('h2', { texto: 'Adicionar crédito' }))
  const corpo = el('div', { classe: 'rc-corpo' })
  folha.append(barra, corpo)
  fundo.addEventListener('click', () => fechar())
  onde.append(fundo, folha)
  requestAnimationFrame(() => {
    fundo.classList.add('ct-aberta')
    folha.classList.add('ct-aberta')
  })

  history.pushState({ ...(history.state ?? {}), folhaDaRecarga: true }, '')
  const aoVoltar = () => {
    if (aberta) fechar({ jaVoltou: true })
  }
  window.addEventListener('popstate', aoVoltar)
  const aoMudarVisibilidade = () => {
    if (!aberta || !pix || pago) return
    if (document.visibilityState === 'visible') ligarEspera()
    else pararEspera()
  }
  document.addEventListener('visibilitychange', aoMudarVisibilidade)

  // --- desenhar -------------------------------------------------------------------
  function pintar() {
    if (!aberta) return
    corpo.replaceChildren()
    if (erro) {
      const p = el('p', { classe: 'ca-erro', texto: erro })
      p.setAttribute('role', 'alert')
      corpo.appendChild(p)
    }
    if (pago && pix) corpo.appendChild(telaPago(pix))
    else if (pix) corpo.appendChild(telaPagar(pix))
    else corpo.appendChild(telaEscolher())
    if (recentes.length) corpo.appendChild(listaRecentes())
  }

  function telaEscolher(): HTMLElement {
    const s = el('div', { classe: 'rc-escolher' })
    s.appendChild(
      el('p', {
        classe: 'ca-dica',
        texto: `O crédito é o que a loja tem para dar de ${MARCA.moeda}. Cada ${MARCA.moeda} lançado sai daqui. Mínimo de ${reais(RECARGA_MINIMA)}.`,
      }),
    )
    const chips = el('div', { classe: 'rc-chips' })
    const outro = el('input', { classe: 'rc-outro' })
    outro.type = 'text'
    outro.inputMode = 'decimal'
    outro.placeholder = 'Outro valor (R$)'
    outro.setAttribute('aria-label', 'Outro valor')
    for (const v of VALORES_DE_RECARGA) {
      const b = botao(reais(v), 'rc-chip', () => {
        escolhido = v
        outro.value = ''
        pintar()
      })
      b.setAttribute('aria-pressed', String(escolhido === v && outro.value === ''))
      chips.appendChild(b)
    }
    s.appendChild(chips)
    s.appendChild(outro)
    const aviso = el('p', { classe: 'ca-dica rc-aviso' })
    const gerar = botao('', 'ca-botao rc-gerar', () => {
      if (escolhido !== null && escolhido >= RECARGA_MINIMA) void gerarPix(escolhido)
    })
    const atualizar = () => {
      const valido = escolhido !== null && escolhido >= RECARGA_MINIMA
      gerar.textContent = ocupado ? 'Gerando o Pix…' : valido ? `Gerar o Pix de ${reais(escolhido!)}` : 'Gerar o Pix'
      gerar.disabled = ocupado || !valido
      aviso.textContent =
        escolhido !== null && escolhido < RECARGA_MINIMA ? `O mínimo é ${reais(RECARGA_MINIMA)}.` : ''
      for (const c of chips.querySelectorAll<HTMLButtonElement>('.rc-chip')) {
        c.setAttribute('aria-pressed', String(outro.value === '' && c.textContent === reais(escolhido ?? -1)))
      }
    }
    outro.addEventListener('input', () => {
      escolhido = outro.value.trim() === '' ? VALORES_DE_RECARGA[0] : lerValorDaRecarga(outro.value)
      atualizar()
    })
    atualizar()
    s.append(aviso, gerar)
    return s
  }

  function telaPagar(p: RecargaCriada): HTMLElement {
    const s = el('div', { classe: 'rc-pagar' })
    s.appendChild(el('p', { classe: 'ct-mostre', texto: `Pague este Pix de ${reais(p.valor)} no app do seu banco.` }))
    const qr = el('div', { classe: 'ct-qr rc-qr' })
    qr.dataset.pix = p.copia_e_cola
    void QRCode.toString(p.copia_e_cola, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }).then((svg) => {
      qr.innerHTML = svg
      qr.querySelector('svg')?.setAttribute('aria-label', 'QR do Pix')
    })
    s.appendChild(qr)
    const copiado = el('p', { classe: 'ca-dica rc-copiado' })
    copiado.setAttribute('role', 'status')
    s.appendChild(
      botao('Copiar o código Pix', 'ca-botao', () => {
        void navigator.clipboard
          ?.writeText(p.copia_e_cola)
          .then(() => (copiado.textContent = 'Copiado! Cole no app do banco, em "Pix copia e cola".'))
          .catch(() => (copiado.textContent = 'Não consegui copiar. Leia o QR com o app do banco.'))
      }),
    )
    s.appendChild(copiado)
    const quando = new Date(p.expira_em)
    s.appendChild(
      el('p', {
        classe: 'ct-relogio',
        texto: `Esperando o pagamento… Vale até ${quando.toLocaleDateString('pt-BR')} às ${quando.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}.`,
      }),
    )
    s.appendChild(
      el('p', {
        classe: 'ca-dica',
        texto: 'Assim que o Pix cair, o crédito entra sozinho na sua loja. Pode deixar esta tela aberta.',
      }),
    )
    if (o.simularPix) {
      const sim = botao('Simular o Pix pago (só na demonstração)', 'ca-botao-fraco', () => {
        void o.simularPix!(p.recarga_id).then(() => conferir())
      })
      s.appendChild(sim)
    }
    return s
  }

  function telaPago(p: RecargaCriada): HTMLElement {
    const s = el('div', { classe: 'rc-pago' })
    const t = el('p', { classe: 'rc-pronto', texto: `Pronto! ${reais(p.valor)} de crédito na sua loja.` })
    t.setAttribute('role', 'status')
    s.appendChild(t)
    s.appendChild(el('p', { classe: 'ca-dica', texto: `Já dá para dar ${MARCA.moeda} aos clientes.` }))
    s.appendChild(botao('Voltar ao balcão', 'ca-botao', () => fechar()))
    return s
  }

  function listaRecentes(): HTMLElement {
    const s = el('div', { classe: 'rc-recentes' })
    s.appendChild(el('h3', { texto: 'Suas recargas' }))
    const ul = el('ul', { classe: 'rc-lista' })
    for (const r of recentes.slice(0, 5)) {
      const dia = new Date(r.criada_em).toLocaleDateString('pt-BR')
      ul.appendChild(
        el('li', {}, [
          el('strong', { texto: reais(r.valor) }),
          el('span', { texto: `${dia} · ${situacaoDaRecarga(r)}` }),
        ]),
      )
    }
    s.appendChild(ul)
    return s
  }

  // --- agir -----------------------------------------------------------------------
  async function gerarPix(valor: number) {
    ocupado = true
    erro = null
    pintar()
    try {
      pix = await o.repo.pedirRecarga(valor)
      ligarEspera()
    } catch (e) {
      erro = o.repo.fraseDoErro(e)
    } finally {
      ocupado = false
      pintar()
    }
    void carregarRecentes()
  }

  async function carregarRecentes() {
    try {
      recentes = await o.repo.lerMinhasRecargas()
    } catch {
      recentes = []
    }
    pintar()
  }

  async function conferir() {
    if (!aberta || !pix || pago) return
    try {
      recentes = await o.repo.lerMinhasRecargas()
    } catch {
      return
    }
    const minha = recentes.find((r) => r.id === pix!.recarga_id)
    if (minha?.situacao === 'paga') {
      pago = true
      pararEspera()
      o.aoCreditar()
    } else if (minha?.situacao === 'valor_divergente') {
      erro = 'O Pix chegou com valor diferente do pedido. A administração vai conferir e creditar.'
      pararEspera()
    }
    pintar()
  }

  function ligarEspera() {
    pararEspera()
    timer = setInterval(() => void conferir(), intervalo)
  }
  function pararEspera() {
    if (timer) clearInterval(timer)
    timer = null
  }

  function fechar(op: { jaVoltou?: boolean } = {}) {
    if (!aberta) return
    aberta = false
    pararEspera()
    window.removeEventListener('popstate', aoVoltar)
    document.removeEventListener('visibilitychange', aoMudarVisibilidade)
    fundo.remove()
    folha.remove()
    if (!op.jaVoltou && history.state?.folhaDaRecarga) history.back()
    o.aoFechar?.()
  }

  pintar()
  void carregarRecentes()
  return { elemento: folha, fechar: () => fechar() }
}
