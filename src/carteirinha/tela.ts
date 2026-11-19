// ---------------------------------------------------------------------------
// O CARTÃO E A FOLHA DO QR (19/11).
//
// Ele: *"Carteirinha, número tal, ela clica, aí a carteirinha aparece (...) com o QR Code para fazer a transferência do
// troco"*. Então são duas peças:
//   - o CARTÃO, no alto da conta: nome, número em grupos de 4, Prime até / Desde. Tocar abre a folha;
//   - a FOLHA, que sobe de baixo como quem puxa a carteirinha do bolso: o cartão, o QR de 90 s que a loja lê, e o
//     relógio. O QR se renova sozinho enquanto a folha está aberta e a tela está à vista (com a tela apagada, para).
//
// 🔴 A folha também tem a SETINHA DE VOLTAR no topo (regra dele: toda tela tem), e o "voltar" do celular fecha a folha
// em vez de sair do aplicativo.
// ---------------------------------------------------------------------------

import QRCode from 'qrcode'
import { enderecoDoQr } from '../lib/token'
import {
  codigoEmGrupos,
  quandoRenovar,
  segundosRestantes,
  validadeDaCarteirinha,
  type CarteirinhaDoClube,
  type QrDaCarteirinha,
} from './estado'

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

/** O desenho do cartão. `aoTocar` ausente = cartão parado (o que vai dentro da folha). */
export function cartaoDaCarteirinha(c: CarteirinhaDoClube, aoTocar?: () => void): HTMLElement {
  const cartao = el(aoTocar ? 'button' : 'div', { classe: 'ct-cartao' })
  if (aoTocar) {
    const b = cartao as HTMLButtonElement
    b.type = 'button'
    b.setAttribute('aria-label', `Mostrar o QR da carteirinha ${codigoEmGrupos(c.codigo_publico)}`)
    b.addEventListener('click', aoTocar)
  }
  if (!c.ativa) cartao.classList.add('ct-desligada')
  cartao.append(
    el('span', { classe: 'ct-marca', texto: 'CLUBE PRIME' }),
    c.prime_em_dia ? el('span', { classe: 'ct-selo', texto: 'PRIME' }) : el('span'),
    el('span', { classe: 'ct-chip' }),
    el('span', { classe: 'ct-numero', texto: codigoEmGrupos(c.codigo_publico) }),
    el('span', { classe: 'ct-titular', texto: (c.nome ?? '').toUpperCase() }),
    el('span', { classe: 'ct-validade', texto: c.ativa ? validadeDaCarteirinha(c) : 'Desligada' }),
  )
  return cartao
}

/** O bloco da conta: o cartão e a frase que ensina a tocar. */
export function blocoDaCarteirinha(c: CarteirinhaDoClube, aoTocar: () => void): HTMLElement {
  const s = el('section', { classe: 'ct-bloco' })
  s.appendChild(cartaoDaCarteirinha(c, aoTocar))
  s.appendChild(
    el('p', {
      classe: 'ca-dica ct-ensina',
      texto: c.ativa ? 'Toque na carteirinha para mostrar o QR na loja.' : 'Esta carteirinha está desligada no Clube Prime.',
    }),
  )
  return s
}

export interface OpcoesDaFolha {
  carteirinha: CarteirinhaDoClube
  pedirQr(): Promise<QrDaCarteirinha>
  fraseDoErro(e: unknown): string
  /** Uma linha a mais embaixo do QR (a demonstração explica como a loja lê sem câmera). */
  dica?: string
  /** Onde a folha mora. Padrão: o `body` (fora da tela que se repinta, para não fechar sozinha). */
  dentroDe?: HTMLElement
  aoFechar?: () => void
}

export interface Folha {
  readonly elemento: HTMLElement
  fechar(): void
  /** Pede outro QR agora (o relógio zerou, a tela voltou a ficar à vista). */
  renovar(): Promise<void>
}

/** Abre a folha do QR. Devolve como fechar; fechar duas vezes não faz mal. */
export function abrirFolhaDoQr(o: OpcoesDaFolha): Folha {
  const onde = o.dentroDe ?? document.body
  let aberta = true
  let qr: QrDaCarteirinha | null = null
  let timerRenovar: ReturnType<typeof setTimeout> | null = null
  let timerRelogio: ReturnType<typeof setInterval> | null = null
  let pedido = 0

  const fundo = el('div', { classe: 'ct-fundo' })
  const folha = el('section', { classe: 'ct-folha' })
  folha.setAttribute('role', 'dialog')
  folha.setAttribute('aria-modal', 'true')
  folha.setAttribute('aria-label', 'Minha carteirinha do Clube Prime')

  const barra = el('header', { classe: 'ct-barra' })
  const voltar = el('button', { classe: 'app-seta ct-seta', texto: '←' })
  voltar.type = 'button'
  voltar.setAttribute('aria-label', 'Voltar')
  voltar.addEventListener('click', () => fechar())
  barra.append(voltar, el('h2', { texto: 'Minha carteirinha' }))

  const areaDoQr = el('div', { classe: 'ct-qr' })
  areaDoQr.setAttribute('aria-live', 'polite')
  const relogio = el('p', { classe: 'ct-relogio', texto: 'Gerando o QR…' })
  const fechar2 = el('button', { classe: 'ca-botao-fraco ct-fechar', texto: 'Fechar' })
  fechar2.type = 'button'
  fechar2.addEventListener('click', () => fechar())

  folha.append(
    barra,
    cartaoDaCarteirinha(o.carteirinha),
    el('p', { classe: 'ct-mostre', texto: 'Mostre este QR para a loja.' }),
    areaDoQr,
    relogio,
    el('p', {
      classe: 'ca-dica',
      texto: 'A loja lê o QR para lançar o troco da compra ou para receber o troco que você liberou. Ele vale 90 segundos e uma vez só, e se renova sozinho.',
    }),
    ...(o.dica ? [el('p', { classe: 'ca-dica ct-dica-demo', texto: o.dica })] : []),
    fechar2,
  )
  fundo.addEventListener('click', () => fechar())
  onde.append(fundo, folha)
  // A subida: o quadro seguinte liga a classe, e o CSS anima de baixo para cima.
  requestAnimationFrame(() => {
    fundo.classList.add('ct-aberta')
    folha.classList.add('ct-aberta')
  })
  voltar.focus({ preventScroll: true })

  // O "voltar" do celular fecha a folha (e não o aplicativo).
  history.pushState({ ...(history.state ?? {}), folhaDaCarteirinha: true }, '')
  const aoVoltar = () => {
    if (aberta) fechar({ jaVoltou: true })
  }
  window.addEventListener('popstate', aoVoltar)

  const aoMudarVisibilidade = () => {
    if (!aberta) return
    if (document.visibilityState === 'visible') void renovar()
    else limparTimers()
  }
  document.addEventListener('visibilitychange', aoMudarVisibilidade)

  const aoTecla = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape') fechar()
  }
  document.addEventListener('keydown', aoTecla)

  function limparTimers() {
    if (timerRenovar) clearTimeout(timerRenovar)
    if (timerRelogio) clearInterval(timerRelogio)
    timerRenovar = null
    timerRelogio = null
  }

  function pintarRelogio() {
    if (!qr) return
    const s = segundosRestantes(qr.expira_em)
    relogio.textContent = s > 0 ? `Vale por mais ${s} s` : 'Gerando outro QR…'
    if (s === 0) void renovar()
  }

  async function renovar() {
    if (!aberta) return
    limparTimers()
    const meu = ++pedido
    try {
      const novo = await o.pedirQr()
      if (!aberta || meu !== pedido) return
      qr = novo
      const svg = await QRCode.toString(enderecoDoQr(novo.token), { type: 'svg', margin: 1, errorCorrectionLevel: 'M' })
      if (!aberta || meu !== pedido) return
      areaDoQr.innerHTML = svg
      areaDoQr.dataset.token = novo.token
      const desenho = areaDoQr.querySelector('svg')
      desenho?.setAttribute('role', 'img')
      desenho?.setAttribute('aria-label', 'QR da carteirinha')
      pintarRelogio()
      timerRelogio = setInterval(pintarRelogio, 1000)
      timerRenovar = setTimeout(() => void renovar(), quandoRenovar(novo.expira_em))
    } catch (e) {
      if (!aberta || meu !== pedido) return
      areaDoQr.replaceChildren()
      delete areaDoQr.dataset.token
      relogio.textContent = o.fraseDoErro(e)
      relogio.classList.add('ct-erro')
    }
  }

  function fechar(op: { jaVoltou?: boolean } = {}) {
    if (!aberta) return
    aberta = false
    limparTimers()
    window.removeEventListener('popstate', aoVoltar)
    document.removeEventListener('visibilitychange', aoMudarVisibilidade)
    document.removeEventListener('keydown', aoTecla)
    fundo.remove()
    folha.remove()
    if (!op.jaVoltou && history.state?.folhaDaCarteirinha) history.back()
    o.aoFechar?.()
  }

  void renovar()
  return { elemento: folha, fechar: () => fechar(), renovar }
}
