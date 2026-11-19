// ---------------------------------------------------------------------------
// A CASCA DO APLICATIVO (19/11): o /app (o aplicativo de verdade, no navegador) e o /beta (o mesmo, em demonstração).
//
// Ele, em 19/11, sobre o Aviso de Entrega: *"a gente fez um /app e aí colocou o app funcionando ali (...) o app mesmo
// que o cliente pode entrar por ali, não necessariamente depender do aplicativo em si (...) E aí a gente fez também o
// app beta, que seria essa página onde (...) você vai me mostrando e eu vou testando e vou te falando o que mudar"*.
//
// O desenho de aplicativo, não de site:
//   - a escolha na entrada: Sou cliente / Sou loja / Administração (como "Sou morador / portaria / síndico" de lá);
//   - 🔴 TODA TELA TEM A SETINHA DE VOLTAR no topo, à esquerda (regra dele, 18/11: "todo aplicativo tem que ter
//     setinha em cima pra voltar. Aprende, é regra.");
//   - no computador, o aplicativo fica numa coluna de celular no meio da tela.
//
// As telas de dentro são as MESMAS do site (`telas/montar.ts`); a casca só escolhe qual montar e com que dados.
// ---------------------------------------------------------------------------

import { MARCA } from '../marca'
import type { Repositorio } from '../repositorio'
import { montarAdmin, montarBalcao, montarConta, type BalcaoMontado, type Montada } from '../telas/montar'
import {
  CARTEIRINHAS_DE_TESTE,
  CONTAS_DE_TESTE,
  SENHA_DE_TESTE,
  type Demonstracao,
  type Papel,
} from '../demonstracao/repositorio'

export type Rota = 'inicio' | Papel

/** Onde a pessoa mostra a carteirinha do Clube de verdade: no QR Bio (decisão de 19/11, a porta do cliente). */
export const CARTEIRINHA_NO_QR_BIO = 'https://www.qrbio.com.br/painel?aba=clube'

export interface OpcoesDaCasca {
  modo: 'banco' | 'demonstracao'
  /** Um repositório por papel. No banco são o mesmo; na demonstração, cada papel tem o seu login. */
  repos: Record<Papel, Repositorio>
}

const TITULOS: Record<Rota, string> = {
  inicio: MARCA.nome,
  cliente: 'Minha conta',
  loja: 'Balcão da loja',
  admin: 'Administração',
}

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

/** A rota do endereço: só um nome simples depois do #. */
export function rotaDoEndereco(hash: string): Rota {
  const r = hash.replace(/^#/, '')
  return r === 'cliente' || r === 'loja' || r === 'admin' ? r : 'inicio'
}

export interface Casca {
  ir(rota: Rota): void
  rota(): Rota
  /** Repinta a tela aberta (os dados mudaram por fora: outra aba, o relógio da demonstração). */
  recarregar(): Promise<void>
}

export function montarCasca(raiz: HTMLElement, opcoes: OpcoesDaCasca): Casca {
  const demo = opcoes.modo === 'demonstracao'
  let rotaAtual: Rota = rotaDoEndereco(location.hash)
  let montada: Montada | null = null

  raiz.replaceChildren()
  raiz.classList.add('app-casca')
  const coluna = el('div', { classe: 'app-coluna' })
  raiz.appendChild(coluna)

  function desmontar() {
    montada?.desmontar()
    montada = null
  }

  // --- a barra de cima, com a setinha ----------------------------------------------
  function barra(rota: Rota): HTMLElement {
    const b = el('header', { classe: 'app-barra' })
    if (rota !== 'inicio') {
      const voltar = botao('←', 'app-seta', () => ir('inicio'))
      voltar.setAttribute('aria-label', 'Voltar')
      b.appendChild(voltar)
    }
    b.appendChild(el('h1', { texto: TITULOS[rota] }))
    return b
  }

  // --- a faixa da demonstração -------------------------------------------------------
  function faixaDaDemonstracao(): HTMLElement | null {
    if (!demo) return null
    const d = opcoes.repos.cliente as Demonstracao
    const dia = d.hoje().split('-').reverse().join('/')
    const f = el('div', { classe: 'app-faixa-demo' })
    f.setAttribute('role', 'note')
    f.appendChild(el('p', { texto: `Modo demonstração: os dados ficam só neste aparelho. Hoje na demonstração: ${dia}.` }))
    const acoes = el('div', { classe: 'app-faixa-acoes' })
    acoes.appendChild(
      botao('Passar 30 dias', 'app-link', () => {
        const n = d.passarDias(30)
        aviso(n === 0 ? 'Passaram 30 dias. Nada venceu.' : `Passaram 30 dias. ${n} ${n === 1 ? 'pedaço de troco venceu' : 'pedaços de troco venceram'} e foram para o fundo.`)
        void recarregar()
      }),
    )
    acoes.appendChild(
      botao('Recomeçar', 'app-link', () => {
        d.recomecar()
        aviso('Tudo voltou ao começo: a Ana sem ativar, o Bruno com 40 juntados e as duas lojas com depósito.')
        ir(rotaAtual)
      }),
    )
    f.appendChild(acoes)
    return f
  }

  let recadoDaCasca: string | null = null
  function aviso(texto: string) {
    recadoDaCasca = texto
  }

  // --- a entrada: as três portas -----------------------------------------------------
  function inicio(): HTMLElement {
    const s = el('section', { classe: 'app-inicio' })
    s.appendChild(el('p', { classe: 'app-lema', texto: MARCA.tagline }))
    const porta = (rota: Papel, titulo: string, sobre: string) => {
      const b = botao('', 'app-porta', () => ir(rota))
      b.append(el('strong', { texto: titulo }), el('span', { texto: sobre }))
      return b
    }
    s.appendChild(porta('cliente', 'Sou cliente do Clube', `Ver meu ${MARCA.moeda}, liberar para gastar e confirmar compras`))
    s.appendChild(porta('loja', 'Sou loja', `Dar ${MARCA.moeda} e receber ${MARCA.moeda} no balcão`))
    s.appendChild(porta('admin', 'Administração', 'Vincular lojas, registrar depósitos e pagar saques'))
    if (demo) {
      s.appendChild(
        el('p', {
          classe: 'app-dica',
          texto:
            'Para testar a volta inteira: entre como a Ana em "Sou cliente" e como a Ótica em "Sou loja". Abra as duas em abas diferentes, se quiser ver uma do lado da outra.',
        }),
      )
    }
    return s
  }

  // --- os atalhos da demonstração, em cada porta ---------------------------------------
  function contasDeTeste(papel: Papel): HTMLElement | null {
    if (!demo) return null
    const d = opcoes.repos[papel] as Demonstracao
    const atual = d.contaAtual()
    const s = el('section', { classe: 'app-contas' })
    if (atual) {
      s.appendChild(el('p', { texto: `Na demonstração você está como ${atual.nome} (${atual.sobre}).` }))
      s.appendChild(
        botao('Trocar de conta', 'app-link', async () => {
          await d.sair()
          ir(papel)
        }),
      )
      return s
    }
    s.appendChild(el('h2', { texto: 'Contas de teste' }))
    s.appendChild(el('p', { classe: 'app-dica', texto: `Toque para entrar. Ou digite o e-mail com a senha ${SENHA_DE_TESTE}.` }))
    for (const c of CONTAS_DE_TESTE.filter((x) => x.papel === papel)) {
      const b = botao('', 'app-conta', async () => {
        await d.entrarComo(c.email)
        ir(papel)
      })
      b.append(el('strong', { texto: `Entrar como ${c.nome}` }), el('span', { texto: `${c.email} · ${c.sobre}` }))
      s.appendChild(b)
    }
    return s
  }

  function carteirinha(): HTMLElement {
    const s = el('section', { classe: 'app-carteirinha' })
    if (!demo) {
      s.appendChild(el('p', { texto: 'No balcão, mostre a carteirinha do Clube Prime. Ela fica no QR Bio.' }))
      const a = el('a', { classe: 'app-link', texto: 'Abrir a minha carteirinha no QR Bio' })
      a.setAttribute('href', CARTEIRINHA_NO_QR_BIO)
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener')
      s.appendChild(a)
      return s
    }
    const atual = (opcoes.repos.cliente as Demonstracao).contaAtual()
    const codigo = atual ? CARTEIRINHAS_DE_TESTE[atual.id] : undefined
    if (!codigo) return el('div')
    s.appendChild(el('h2', { texto: `A carteirinha de ${atual!.nome}` }))
    s.appendChild(
      el('p', {
        classe: 'app-dica',
        texto: `Na demonstração, a loja lê esta carteirinha tocando em "Ler a carteirinha de ${atual!.nome.split(' ')[0]}" no balcão. No Clube de verdade, o QR muda a cada 90 segundos.`,
      }),
    )
    s.appendChild(el('code', { classe: 'app-codigo', texto: codigo }))
    return s
  }

  function atalhosDoBalcao(b: BalcaoMontado): HTMLElement | null {
    if (!demo) return null
    const s = el('section', { classe: 'app-contas' })
    s.appendChild(el('h2', { texto: 'Ler uma carteirinha de teste' }))
    s.appendChild(el('p', { classe: 'app-dica', texto: 'Na demonstração não precisa de câmera: toque no cliente que está no balcão.' }))
    for (const c of CONTAS_DE_TESTE.filter((x) => x.papel === 'cliente')) {
      s.appendChild(botao(`Ler a carteirinha de ${c.nome.split(' ')[0]}`, 'app-conta', () => void b.lerCodigo(CARTEIRINHAS_DE_TESTE[c.id])))
    }
    return s
  }

  // --- trocar de tela ----------------------------------------------------------------
  function ir(rota: Rota) {
    desmontar()
    rotaAtual = rota
    if (location.hash.replace(/^#/, '') !== (rota === 'inicio' ? '' : rota)) {
      history.replaceState(null, '', rota === 'inicio' ? location.pathname + location.search : `#${rota}`)
    }
    coluna.replaceChildren()
    coluna.appendChild(barra(rota))
    const faixa = faixaDaDemonstracao()
    if (faixa) coluna.appendChild(faixa)
    if (recadoDaCasca) {
      const r = el('p', { classe: 'ca-recado', texto: recadoDaCasca })
      r.setAttribute('role', 'status')
      coluna.appendChild(r)
      recadoDaCasca = null
    }

    if (rota === 'inicio') {
      coluna.appendChild(inicio())
      return
    }
    const contas = contasDeTeste(rota)
    if (contas) coluna.appendChild(contas)
    if (rota === 'cliente') coluna.appendChild(carteirinha())

    const tela = el('div', { classe: 'app-tela' })
    coluna.appendChild(tela)
    const repo = opcoes.repos[rota]
    if (rota === 'cliente') montada = montarConta(tela, repo)
    if (rota === 'admin') montada = montarAdmin(tela, repo)
    if (rota === 'loja') {
      const b = montarBalcao(tela, repo, { semCamera: demo })
      montada = b
      const atalhos = atalhosDoBalcao(b)
      if (atalhos) coluna.insertBefore(atalhos, tela)
    }
  }

  async function recarregar() {
    // A faixa mostra o dia da demonstração, que pode ter andado: refaz a tela inteira.
    if (demo) {
      ir(rotaAtual)
      return
    }
    await montada?.recarregar()
  }

  window.addEventListener('hashchange', () => {
    const r = rotaDoEndereco(location.hash)
    if (r !== rotaAtual) ir(r)
  })

  ir(rotaAtual)
  return { ir, rota: () => rotaAtual, recarregar }
}
