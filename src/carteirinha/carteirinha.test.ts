// @vitest-environment jsdom
//
// A CARTEIRINHA NO APLICATIVO (19/11): o cartão, a folha do QR e o relógio. Lido como ele lê, montando a tela.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { codigoEmGrupos, quandoRenovar, segundosRestantes, validadeDaCarteirinha, type CarteirinhaDoClube } from './estado'
import { abrirFolhaDoQr, blocoDaCarteirinha } from './tela'
import { enderecoDoQr, extrairToken } from '../lib/token'

const ANA: CarteirinhaDoClube = {
  nome: 'Ana Souza', codigo_publico: 'CPANA00001', nivel: 'clube', prime_ate: null, prime_em_dia: false,
  membro_desde: '2026-09-02T12:00:00Z', ativa: true,
}
const texto = (n: Element) => (n.textContent ?? '').replace(/\s+/g, ' ')
const token = (n: number) => n.toString(16).padStart(32, '0')

describe('o cartão', () => {
  it('número em grupos de 4, titular em caixa alta e "Desde"; o Prime em dia diz "Prime até"', () => {
    expect(codigoEmGrupos('cpana00001')).toBe('CPAN A000 01')
    expect(validadeDaCarteirinha(ANA)).toBe('Desde 09/26')
    expect(validadeDaCarteirinha({ ...ANA, prime_em_dia: true, prime_ate: '2027-06-30' })).toBe('Prime até 06/27')
    // Prime VENCIDO não diz "Prime até": quem mostra o cartão na loja não pode parecer Prime sem ser.
    expect(validadeDaCarteirinha({ ...ANA, prime_em_dia: false, prime_ate: '2026-01-31' })).toBe('Desde 09/26')
  })

  it('tocar no cartão chama a folha; o cartão desligado avisa', () => {
    const tocou = vi.fn()
    const b = blocoDaCarteirinha(ANA, tocou)
    expect(texto(b)).toContain('CPAN A000 01')
    expect(texto(b)).toContain('ANA SOUZA')
    expect(texto(b)).toContain('Toque na carteirinha para mostrar o QR na loja.')
    b.querySelector<HTMLButtonElement>('button.ct-cartao')!.click()
    expect(tocou).toHaveBeenCalledOnce()
    expect(texto(blocoDaCarteirinha({ ...ANA, ativa: false }, tocou))).toContain('desligada')
  })
})

describe('o QR leva o endereço do Clube, que o balcão lê', () => {
  it('ida e volta: o balcão tira do QR o mesmo token', () => {
    expect(enderecoDoQr(token(7))).toBe(`https://www.clubeprime.com.br/validar#${token(7)}`)
    expect(extrairToken(enderecoDoQr(token(7)))).toBe(token(7))
  })

  it('o relógio nunca fica negativo, e o QR seguinte vem com 30 s de folga (nunca antes de 5 s)', () => {
    const agora = Date.parse('2026-11-19T12:00:00Z')
    expect(segundosRestantes('2026-11-19T12:01:30Z', agora)).toBe(90)
    expect(segundosRestantes('2026-11-19T11:59:00Z', agora)).toBe(0)
    expect(quandoRenovar('2026-11-19T12:01:30Z', agora)).toBe(60_000)
    expect(quandoRenovar('2026-11-19T12:00:10Z', agora)).toBe(5_000)
  })
})

describe('a folha do QR', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'Date'] })
    vi.setSystemTime(new Date('2026-11-19T12:00:00Z'))
    document.body.replaceChildren()
    history.replaceState(null, '', '/')
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function abrir(pedirQr = vi.fn()) {
    let n = 0
    pedirQr.mockImplementation(async () => ({ token: token(++n), expira_em: new Date(Date.now() + 90_000).toISOString() }))
    const folha = abrirFolhaDoQr({ carteirinha: ANA, pedirQr, fraseDoErro: () => 'Esta carteirinha está desligada no Clube Prime.' })
    return { folha, pedirQr }
  }

  it('mostra o QR, a setinha e o relógio; e SE RENOVA sozinho antes de vencer', async () => {
    const { folha, pedirQr } = abrir()
    await vi.waitFor(() => expect(folha.elemento.querySelector('.ct-qr svg')).toBeTruthy())
    expect(folha.elemento.querySelector('.app-seta')?.getAttribute('aria-label')).toBe('Voltar')
    expect(texto(folha.elemento)).toContain('Mostre este QR para a loja.')
    expect(texto(folha.elemento)).toContain('Vale por mais 90 s')
    expect(folha.elemento.querySelector<HTMLElement>('.ct-qr')!.dataset.token).toBe(token(1))

    await vi.advanceTimersByTimeAsync(10_000)
    expect(texto(folha.elemento)).toContain('Vale por mais 80 s')
    expect(pedirQr).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(50_000)
    await vi.waitFor(() => expect(folha.elemento.querySelector<HTMLElement>('.ct-qr')!.dataset.token).toBe(token(2)))
    expect(pedirQr).toHaveBeenCalledTimes(2)
    folha.fechar()
  })

  it('fechada, para de pedir QR (não gasta token de ninguém com a tela fechada)', async () => {
    const { folha, pedirQr } = abrir()
    await vi.waitFor(() => expect(pedirQr).toHaveBeenCalledTimes(1))
    folha.fechar()
    expect(document.querySelector('.ct-folha')).toBeNull()
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(pedirQr).toHaveBeenCalledTimes(1)
  })

  it('o "voltar" do celular fecha a folha', async () => {
    const { folha } = abrir()
    await vi.waitFor(() => expect(folha.elemento.querySelector('.ct-qr svg')).toBeTruthy())
    window.dispatchEvent(new PopStateEvent('popstate'))
    expect(document.querySelector('.ct-folha')).toBeNull()
  })

  it('erro do banco vira frase, sem QR velho na tela', async () => {
    const pedirQr = vi.fn().mockRejectedValue(new Error('carteirinha_inativa'))
    const folha = abrirFolhaDoQr({ carteirinha: ANA, pedirQr, fraseDoErro: () => 'Esta carteirinha está desligada no Clube Prime.' })
    await vi.waitFor(() => expect(texto(folha.elemento)).toContain('desligada no Clube Prime'))
    expect(folha.elemento.querySelector('.ct-qr svg')).toBeNull()
    folha.fechar()
  })
})
