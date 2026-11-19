// @vitest-environment jsdom
//
// A RECARGA POR PIX (19/11), lida como ele lê: a folha "Adicionar crédito" do balcão, a demonstração (o /beta) e as
// regras pequenas (o mínimo, o valor digitado, a situação em palavras).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { abrirFolhaDeRecarga } from './folha'
import { RECARGA_MINIMA, lerValorDaRecarga, situacaoDaRecarga, type Recarga, type RecargaCriada } from './estado'
import { criarDemonstracao, type Armazem } from '../demonstracao/repositorio'

const texto = (n: Element) => (n.textContent ?? '').replace(/\s+/g, ' ')
const botaoQueDiz = (n: Element, t: string) => [...n.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(t))

describe('as regras pequenas', () => {
  it('o mínimo é R$ 100 (o mesmo da 0027), e o valor digitado aceita vírgula e milhar', () => {
    expect(RECARGA_MINIMA).toBe(100)
    expect(lerValorDaRecarga('150')).toBe(150)
    expect(lerValorDaRecarga('150,50')).toBe(150.5)
    expect(lerValorDaRecarga('R$ 1.000,00')).toBe(1000)
    expect(lerValorDaRecarga('abc')).toBeNull()
    expect(lerValorDaRecarga('0')).toBeNull()
  })

  it('a situação em palavras', () => {
    expect(situacaoDaRecarga({ situacao: 'paga' })).toBe('Crédito na conta')
    expect(situacaoDaRecarga({ situacao: 'aguardando', expira_em: '2099-01-01T00:00:00Z' })).toBe('Esperando o Pix')
    expect(situacaoDaRecarga({ situacao: 'aguardando', expira_em: '2020-01-01T00:00:00Z' })).toBe('Pix vencido, sem pagamento')
  })
})

describe('a folha "Adicionar crédito"', () => {
  beforeEach(() => {
    document.body.replaceChildren()
    history.replaceState(null, '', '/')
  })
  afterEach(() => vi.useRealTimers())

  function repoDeMentira() {
    let situacao: Recarga['situacao'] = 'aguardando'
    const criada: RecargaCriada = { recarga_id: 'r1', valor: 200, copia_e_cola: '00020126PIX-DE-TESTE', expira_em: '2099-01-01T12:00:00Z' }
    return {
      pagar: () => (situacao = 'paga'),
      repo: {
        pedirRecarga: vi.fn(async (v: number) => ({ ...criada, valor: v })),
        lerMinhasRecargas: vi.fn(async (): Promise<Recarga[]> => [
          { id: 'r1', valor: 200, situacao, criada_em: '2026-11-19T12:00:00Z', paga_em: null, copia_e_cola: null, expira_em: null },
        ]),
        fraseDoErro: (e: unknown) => String((e as Error).message),
      },
    }
  }

  it('🔴 abaixo do mínimo, o botão de gerar fica travado e a tela diz o mínimo', async () => {
    const { repo } = repoDeMentira()
    const f = abrirFolhaDeRecarga({ repo, aoCreditar: () => {} })
    expect(f.elemento.querySelector('.app-seta')?.getAttribute('aria-label')).toBe('Voltar')
    expect(botaoQueDiz(f.elemento, 'Gerar o Pix de R$ 100,00')).toBeDefined()
    const outro = f.elemento.querySelector<HTMLInputElement>('input.rc-outro')!
    outro.value = '50'
    outro.dispatchEvent(new Event('input'))
    const gerar = f.elemento.querySelector<HTMLButtonElement>('.rc-gerar')!
    expect(gerar.disabled).toBe(true)
    expect(texto(f.elemento)).toContain('O mínimo é R$ 100,00.')
    gerar.click()
    expect(repo.pedirRecarga).not.toHaveBeenCalled()
    f.fechar()
  })

  it('escolhe R$ 200, gera o Pix, mostra o QR e o copia-e-cola; quando cai, diz "Pronto" e avisa o balcão', async () => {
    const { repo, pagar } = repoDeMentira()
    const creditou = vi.fn()
    const f = abrirFolhaDeRecarga({ repo, aoCreditar: creditou, intervalo: 20 })
    botaoQueDiz(f.elemento, 'R$ 200,00')!.click()
    botaoQueDiz(f.elemento, 'Gerar o Pix de R$ 200,00')!.click()
    await vi.waitFor(() => expect(f.elemento.querySelector<HTMLElement>('.rc-qr')?.dataset.pix).toBe('00020126PIX-DE-TESTE'))
    expect(repo.pedirRecarga).toHaveBeenCalledWith(200)
    expect(texto(f.elemento)).toContain('Pague este Pix de R$ 200,00')
    expect(botaoQueDiz(f.elemento, 'Copiar o código Pix')).toBeDefined()
    expect(creditou).not.toHaveBeenCalled()

    pagar()
    await vi.waitFor(() => expect(texto(f.elemento)).toContain('Pronto! R$ 200,00 de crédito na sua loja.'))
    expect(creditou).toHaveBeenCalledOnce()
    f.fechar()
  })

  it('fechada, para de perguntar se o Pix caiu', async () => {
    const { repo } = repoDeMentira()
    const f = abrirFolhaDeRecarga({ repo, aoCreditar: () => {}, intervalo: 10 })
    botaoQueDiz(f.elemento, 'Gerar o Pix')!.click()
    await vi.waitFor(() => expect(f.elemento.querySelector('.rc-qr')).toBeTruthy())
    f.fechar()
    const chamadas = repo.lerMinhasRecargas.mock.calls.length
    await new Promise((r) => setTimeout(r, 60))
    expect(repo.lerMinhasRecargas.mock.calls.length).toBe(chamadas)
    expect(document.querySelector('.rc-folha')).toBeNull()
  })

  it('erro do banco vira frase, e o Pix não aparece', async () => {
    const { repo } = repoDeMentira()
    repo.pedirRecarga.mockRejectedValueOnce(new Error('A recarga mínima é de R$ 100,00.'))
    const f = abrirFolhaDeRecarga({ repo, aoCreditar: () => {} })
    botaoQueDiz(f.elemento, 'Gerar o Pix')!.click()
    await vi.waitFor(() => expect(texto(f.elemento)).toContain('A recarga mínima é de R$ 100,00.'))
    expect(f.elemento.querySelector('.rc-qr')).toBeNull()
    f.fechar()
  })
})

describe('a recarga na demonstração (o /beta), com as regras da 0027', () => {
  function armazem(): Armazem {
    const m = new Map<string, string>()
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }
  }

  it('a Ótica recarrega R$ 100: o Pix pago credita UMA vez, a Padaria não vê, e o administrador vê a taxa', async () => {
    const a = armazem()
    const otica = criarDemonstracao('loja', a)
    const admin = criarDemonstracao('admin', a)
    await otica.entrarComo('otica@trocoprime.teste')
    await admin.entrarComo('admin@trocoprime.teste')
    const antes = (await otica.lerMinhaLoja())!.credito

    await expect(otica.pedirRecarga(99)).rejects.toThrow('recarga_abaixo_do_minimo')
    const pix = await otica.pedirRecarga(100)
    expect(pix.copia_e_cola).toMatch(/^000201/)
    expect((await otica.lerMinhasRecargas())[0].situacao).toBe('aguardando')

    expect(await otica.simularPixPago(pix.recarga_id)).toBe('creditada')
    expect(await otica.simularPixPago(pix.recarga_id)).toBe('ja_paga')
    expect((await otica.lerMinhaLoja())!.credito).toBe(antes + 100)

    const padaria = criarDemonstracao('loja', a)
    await padaria.sair()
    await padaria.entrarComo('padaria@trocoprime.teste')
    expect(await padaria.lerMinhasRecargas()).toHaveLength(0)

    const lista = await admin.lerRecargas()
    expect(lista[0]).toMatchObject({ loja_nome: 'Ótica Visão', situacao: 'paga', taxa_do_provedor: 0.99, valor_liquido: 99.01 })
    await expect(otica.lerRecargas()).rejects.toThrow('so_admin')
  })
})
