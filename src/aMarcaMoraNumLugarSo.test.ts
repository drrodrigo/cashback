// O NOME DOS PONTOS MORA EM src/marca.ts, E SÓ LÁ (19/11/2026).
//
// O comentário de marca.ts prometia "trocar o nome é editar este arquivo", mas em 19/11, na troca de "cash" para
// "Troco Prime", havia 11 frases de tela com "cash" escrito à mão (a carteira, o balcão, o motor e os títulos das
// páginas). Esta trava reprova frase de tela com o nome velho escrito à mão: toda frase usa MARCA.moeda / MARCA.valor.
import { describe, expect, it } from 'vitest'
import { MARCA } from './marca'
import paginaDaConta from '../index.html?raw'
import paginaDoBalcao from '../balcao.html?raw'
import paginaDaDemonstracao from '../demonstracao.html?raw'

// Os arquivos lidos pelo próprio Vite (o projeto não tem os tipos do Node, e o build confere os testes também).
const FONTES = import.meta.glob<string>('./**/*.ts', { query: '?raw', import: 'default', eager: true })

function semComentarios(s: string) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Frases (texto com espaço) que escrevem "cash" como palavra solta: não pega cashback, cash_x, cash.x, cash-x, emCash
 * nem a chamada cash(...) (a função que formata o valor, que já vem de MARCA.valor). */
export function frasesComONomeVelho(fonte: string): string[] {
  const literais = semComentarios(fonte).match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) ?? []
  return literais.filter((l) => /\s/.test(l) && /(?<![\w$.-])cash(?![\w._(-])/i.test(l))
}

/**
 * Frases de tela com a PALAVRA "cashback" (19/11, à noite: *"troca o cashback para ele"*). O produto se chama Troco
 * Prime e a unidade é "troco": a tela diz isso, lido de MARCA. Pega só a palavra solta no meio do texto (depois de espaço
 * ou no começo da frase); não pega nome de função (`cash_balcao_dar_cashback`), coluna (`cashback_percentual`), chave
 * (`cashback:${id}`) nem atributo (`data-acao="cashback"`).
 */
export function frasesComCashback(fonte: string): string[] {
  const literais = semComentarios(fonte).match(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g) ?? []
  return literais.filter((l) => /\s/.test(l) && /(^|\s)cashback(?=$|[\s.,!?;<])/im.test(l.slice(1, -1)))
}

describe('o nome dos pontos mora em src/marca.ts', () => {
  it('nenhuma frase de tela escreve "cashback" à mão', () => {
    const lidos = Object.entries(FONTES).filter(([f]) => !f.endsWith('.test.ts') && !f.endsWith('/marca.ts'))
    const achados = lidos.flatMap(([f, fonte]) => frasesComCashback(fonte).map((l) => `${f}: ${l}`))
    expect(achados).toEqual([])
  })

  it('a trava do "cashback" pega o caso de verdade (falsificada)', () => {
    expect(frasesComCashback("const t = 'Onde ganhar cashback'")).toHaveLength(1)
    expect(frasesComCashback('const r = `Cashback lançado para ${nome}.`')).toHaveLength(1)
    expect(frasesComCashback('const b = `<button data-acao="cashback">Dar cashback</button>`')).toHaveLength(1)
    // e não acusa o que não é frase de tela
    expect(frasesComCashback("rpc('cash_balcao_dar_cashback', { p_x: 1 })")).toHaveLength(0)
    expect(frasesComCashback('const k = `cashback:${id}:${Date.now()}`')).toHaveLength(0)
    // a chave de idempotência de verdade (dados.ts), que tem espaço dentro e não é frase de tela
    expect(frasesComCashback('const k = `cashback:${c}:${Math.random().toString(36).slice(2, 10)}`')).toHaveLength(0)
    expect(frasesComCashback('const h = `<b data-acao="cashback">${l.cashback_percentual}% de volta</b>`')).toHaveLength(0)
  })

  it('nenhuma frase de tela escreve "cash" à mão', () => {
    const lidos = Object.entries(FONTES).filter(([f]) => !f.endsWith('.test.ts') && !f.endsWith('/marca.ts'))
    expect(lidos.length).toBeGreaterThan(10) // leu os arquivos de verdade (e não uma lista vazia que passa sempre)
    const achados = lidos.flatMap(([f, fonte]) => frasesComONomeVelho(fonte).map((l) => `${f}: ${l}`))
    expect(achados).toEqual([])
  })

  it('os títulos das páginas usam o nome novo', () => {
    for (const pagina of [paginaDaConta, paginaDoBalcao, paginaDaDemonstracao]) {
      expect(pagina).toMatch(/<title>Troco Prime — /)
    }
  })

  it('a trava pega o caso de verdade (falsificada)', () => {
    expect(frasesComONomeVelho("const a = 'Quanto em cash'")).toHaveLength(1)
    expect(frasesComONomeVelho('const b = `Devolve ${p}% em cash a cada compra.`')).toHaveLength(1)
    // e não acusa o que não é frase de tela
    expect(frasesComONomeVelho("supabase.schema('cash').rpc('cash_saldo'); const k = 'cash.demonstracao.v1'")).toHaveLength(0)
    expect(frasesComONomeVelho("const t = 'Onde ganhar cashback'; // em cash")).toHaveLength(0)
    expect(frasesComONomeVelho('const h = `<b>${cash(emCash)}</b> no saldo`')).toHaveLength(0)
    expect(frasesComONomeVelho('const h = `<span>Cash que existe</span>`')).toHaveLength(1)
  })
})

describe('o valor do jeito que ele fala: "você tem 20 de troco" (19/11)', () => {
  it('número redondo sai sem centavos', () => {
    expect(MARCA.valor(20)).toBe('20 de troco')
    expect(MARCA.valor(30)).toBe('30 de troco')
    expect(MARCA.valor(0)).toBe('0 de troco')
  })
  it('com centavos, mostra os centavos', () => {
    expect(MARCA.valor(20.5)).toBe('20,50 de troco')
    expect(MARCA.valor(9.99)).toBe('9,99 de troco')
  })
  it('a conta quebrada do computador não vira centavo fantasma', () => {
    expect(MARCA.valor(0.1 + 0.2)).toBe('0,30 de troco')
    expect(MARCA.valor(29.999999)).toBe('30 de troco')
  })
})
