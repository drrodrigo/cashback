// @vitest-environment jsdom
//
// O APLICATIVO MONTADO (/app e /beta), lido como ele lê: as três portas, a setinha em toda tela, as contas de teste e a
// carteirinha de teste. As telas de dentro são as do site, já testadas cada uma no seu arquivo.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CARTEIRINHA_NO_QR_BIO, montarCasca } from './casca'
import { CARTEIRINHAS_DE_TESTE, criarDemonstracao, type Armazem } from '../demonstracao/repositorio'
import { repositorioDoBanco } from '../repositorio'

function armazem(): Armazem {
  const m = new Map<string, string>()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }
}

function beta() {
  const a = armazem()
  const raiz = document.createElement('div')
  document.body.replaceChildren(raiz)
  const casca = montarCasca(raiz, {
    modo: 'demonstracao',
    repos: { cliente: criarDemonstracao('cliente', a), loja: criarDemonstracao('loja', a), admin: criarDemonstracao('admin', a) },
  })
  return { raiz, casca }
}

const texto = (n: HTMLElement) => (n.textContent ?? '').replace(/\s+/g, ' ')
const botaoQueDiz = (n: HTMLElement, t: string) => [...n.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(t))
const esperar = () => vi.waitFor(() => Promise.resolve(), { timeout: 50 })

beforeEach(() => {
  history.replaceState(null, '', '/')
})

describe('a entrada do aplicativo', () => {
  it('mostra as três portas, sem setinha (é o começo), e no /beta avisa que é demonstração', () => {
    const { raiz } = beta()
    expect(texto(raiz)).toContain('Sou cliente do Clube')
    expect(texto(raiz)).toContain('Sou loja')
    expect(texto(raiz)).toContain('Administração')
    expect(raiz.querySelector('.app-seta')).toBeNull()
    expect(texto(raiz)).toContain('Modo demonstração: os dados ficam só neste aparelho')
  })
})

describe('🔴 a setinha de voltar em TODA tela (regra dele)', () => {
  it.each(['cliente', 'loja', 'admin'] as const)('a tela "%s" tem a setinha, e ela volta para a entrada', (rota) => {
    const { raiz, casca } = beta()
    casca.ir(rota)
    const seta = raiz.querySelector<HTMLButtonElement>('.app-seta')
    expect(seta).not.toBeNull()
    expect(seta!.getAttribute('aria-label')).toBe('Voltar')
    seta!.click()
    expect(casca.rota()).toBe('inicio')
    expect(texto(raiz)).toContain('Sou cliente do Clube')
  })
})

describe('as contas de teste do /beta', () => {
  it('na loja, mostra só as lojas de teste; tocar entra, e aparecem os atalhos para ler a carteirinha', async () => {
    const { raiz, casca } = beta()
    casca.ir('loja')
    expect(texto(raiz)).toContain('Entrar como Ótica Visão')
    expect(texto(raiz)).toContain('Entrar como Padaria Pão Quente')
    expect(texto(raiz)).not.toContain('Entrar como Ana Souza')
    botaoQueDiz(raiz, 'Entrar como Ótica Visão')!.click()
    await vi.waitFor(() => expect(texto(raiz)).toContain('Na demonstração você está como Ótica Visão'))
    expect(botaoQueDiz(raiz, 'Ler a carteirinha de Ana')).toBeDefined()
    await vi.waitFor(() => expect(texto(raiz)).toContain('Devolve 10% em troco a cada compra.'))
  })

  it('o cliente vê a carteirinha de teste com o código que o balcão lê', async () => {
    const { raiz, casca } = beta()
    casca.ir('cliente')
    botaoQueDiz(raiz, 'Entrar como Ana Souza')!.click()
    await vi.waitFor(() => expect(texto(raiz)).toContain('A carteirinha de Ana Souza'))
    expect(texto(raiz)).toContain(CARTEIRINHAS_DE_TESTE.ana)
  })

  it('a loja lê a carteirinha do Bruno pelo atalho e atende', async () => {
    const { raiz, casca } = beta()
    casca.ir('loja')
    botaoQueDiz(raiz, 'Entrar como Ótica Visão')!.click()
    await vi.waitFor(() => expect(botaoQueDiz(raiz, 'Ler a carteirinha de Bruno')).toBeDefined())
    await vi.waitFor(() => expect(texto(raiz)).toContain('Devolve 10%'))
    botaoQueDiz(raiz, 'Ler a carteirinha de Bruno')!.click()
    await vi.waitFor(() => expect(texto(raiz)).toContain('Bruno Lima'))
    await esperar()
  })
})

describe('o /app de verdade', () => {
  it('não tem contas de teste nem faixa de demonstração, e o cliente acha a carteirinha no QR Bio', () => {
    const raiz = document.createElement('div')
    document.body.replaceChildren(raiz)
    const casca = montarCasca(raiz, {
      modo: 'banco',
      repos: { cliente: repositorioDoBanco, loja: repositorioDoBanco, admin: repositorioDoBanco },
    })
    expect(texto(raiz)).not.toContain('Modo demonstração')
    casca.ir('cliente')
    expect(texto(raiz)).not.toContain('Contas de teste')
    const link = raiz.querySelector<HTMLAnchorElement>(`a[href="${CARTEIRINHA_NO_QR_BIO}"]`)
    expect(link?.textContent).toBe('Abrir a minha carteirinha no QR Bio')
  })
})
