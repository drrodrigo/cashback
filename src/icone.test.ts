// A LOGO EM TODA PÁGINA (19/11). Ele escolheu o "T de retorno" (o T com a seta laranja) e disse: nada com cara de
// moeda. Até 19/11 o ícone do navegador era a moedinha 🪙. Esta trava reprova a página que voltar a ter a moeda, ou que
// fique sem o ícone da marca, e o manifesto que aponte para ícone que não existe.
//
// Falsificada em 19/11: devolver a moedinha ao `balcao.html` deixa este teste vermelho, apontando a página.
import { describe, expect, it } from 'vitest'
import { MARCA } from './marca'
import paginaDaConta from '../index.html?raw'
import paginaDoBalcao from '../balcao.html?raw'
import paginaDoAdmin from '../admin.html?raw'
import paginaDoApp from '../app.html?raw'
import paginaDoBeta from '../beta.html?raw'
import paginaDaDemonstracao from '../demonstracao.html?raw'
import manifesto from '../public/manifest.webmanifest?raw'

const PAGINAS: Record<string, string> = {
  'index.html': paginaDaConta,
  'balcao.html': paginaDoBalcao,
  'admin.html': paginaDoAdmin,
  'app.html': paginaDoApp,
  'beta.html': paginaDoBeta,
  'demonstracao.html': paginaDaDemonstracao,
}

const PUBLICOS = import.meta.glob('../public/*', { query: '?url', import: 'default', eager: true })
const existe = (caminho: string) => Object.keys(PUBLICOS).includes(`../public${caminho}`)

describe('a logo em toda página', () => {
  it.each(Object.keys(PAGINAS))('%s tem o ícone da marca, e não a moedinha', (nome) => {
    const html = PAGINAS[nome]
    expect(html).toContain('rel="icon" type="image/png" sizes="48x48" href="/icone-48.png"')
    expect(html).toContain('rel="apple-touch-icon" href="/apple-touch-icon.png"')
    expect(html).not.toContain('🪙')
  })

  it('os arquivos que as páginas e a marca pedem existem', () => {
    for (const f of ['/icone-48.png', '/icone-192.png', '/icone-512.png', '/icone-cheio-512.png', '/apple-touch-icon.png', MARCA.icone, MARCA.logo]) {
      expect(existe(f), f).toBe(true)
    }
  })

  it('o aplicativo instalável (/app) tem o manifesto, com nome, cor e ícones que existem', () => {
    expect(paginaDoApp).toContain('rel="manifest" href="/manifest.webmanifest"')
    const m = JSON.parse(manifesto) as { name: string; start_url: string; theme_color: string; icons: { src: string; purpose: string }[] }
    expect(m.name).toBe(MARCA.nome)
    expect(m.start_url).toBe('/app')
    expect(m.theme_color).toBe(MARCA.cor)
    expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true)
    for (const i of m.icons) expect(existe(i.src), i.src).toBe(true)
  })
})
