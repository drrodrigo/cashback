// @vitest-environment jsdom
//
// O APLICATIVO MONTADO (/app e /beta), lido como ele lê: as três portas, a setinha em toda tela, as contas de teste e a
// carteirinha de teste. As telas de dentro são as do site, já testadas cada uma no seu arquivo.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { montarCasca } from './casca'
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

  it('o cliente vê a carteirinha; tocar abre a folha com o QR que o balcão lê, e a setinha fecha', async () => {
    const { raiz, casca } = beta()
    casca.ir('cliente')
    botaoQueDiz(raiz, 'Entrar como Ana Souza')!.click()
    await vi.waitFor(() => expect(texto(raiz)).toContain('CPAN A000 01'))
    expect(texto(raiz)).toContain('ANA SOUZA')
    raiz.querySelector<HTMLButtonElement>('button.ct-cartao')!.click()
    const folha = await vi.waitFor(() => {
      const f = document.querySelector<HTMLElement>('.ct-folha')
      expect(f?.querySelector('.ct-qr svg')).toBeTruthy()
      return f!
    })
    // O QR leva o token que o balcão do /beta lê pelo atalho "Ler a carteirinha de Ana".
    expect(folha.querySelector<HTMLElement>('.ct-qr')!.dataset.token).toBe(CARTEIRINHAS_DE_TESTE.ana)
    expect(texto(folha)).toContain('Ler a carteirinha de Ana')
    // Fechar desfaz o passo do histórico que a folha criou (o "voltar" do celular fecha a folha, não o aplicativo).
    const voltou = new Promise((ok) => window.addEventListener('popstate', ok, { once: true }))
    folha.querySelector<HTMLButtonElement>('.app-seta')!.click()
    expect(document.querySelector('.ct-folha')).toBeNull()
    await voltou
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
  it('não tem contas de teste nem faixa de demonstração', () => {
    const raiz = document.createElement('div')
    document.body.replaceChildren(raiz)
    const casca = montarCasca(raiz, {
      modo: 'banco',
      repos: { cliente: repositorioDoBanco, loja: repositorioDoBanco, admin: repositorioDoBanco },
    })
    expect(texto(raiz)).not.toContain('Modo demonstração')
    casca.ir('cliente')
    expect(texto(raiz)).not.toContain('Contas de teste')
    expect(raiz.querySelector('.app-seta')).not.toBeNull()
  })
})
