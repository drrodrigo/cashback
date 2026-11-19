import { describe, expect, it } from 'vitest'
import { emPercentual, lerPercentual, ondeFica, percentualSugerido, qualTelaDoAdmin, type Painel } from './estado'

const PAINEL: Painel = {
  cash_existente: 300,
  dinheiro_em_custodia: 300,
  diferenca: 0,
  fecha: true,
  fundo_de_promocao: 0,
  lojas: 1,
  clientes: 0,
  saques_a_pagar: 0,
}

describe('qual tela do administrador', () => {
  it('sem as variáveis, diz que falta configurar (antes de qualquer outra coisa)', () => {
    expect(qualTelaDoAdmin({ logado: true, faltaConfigurar: true }, PAINEL, false).qual).toBe('falta-configurar')
  })
  it('sem login, pede para entrar', () => {
    expect(qualTelaDoAdmin({ logado: false }, null, false).qual).toBe('entrar')
  })
  it('o banco disse so_admin: a tela diz que não é administrador, mesmo com painel velho na memória', () => {
    expect(qualTelaDoAdmin({ logado: true }, PAINEL, true).qual).toBe('nao-e-admin')
  })
  it('logado e administrador, sem painel ainda: carregando', () => {
    expect(qualTelaDoAdmin({ logado: true }, null, false).qual).toBe('carregando')
  })
  it('com o painel: o painel', () => {
    expect(qualTelaDoAdmin({ logado: true }, PAINEL, false)).toEqual({ qual: 'painel', painel: PAINEL })
  })
})

describe('o percentual sugerido', () => {
  it('loja já vinculada: o percentual dela, mesmo que o Catálogo diga outro', () => {
    expect(percentualSugerido({ vinculada: true, cashback_percentual: 15, desconto_do_clube: 10 })).toBe(15)
  })
  it('loja do Catálogo com o desconto do Clube declarado: esse (é ele que vira troco)', () => {
    expect(percentualSugerido({ vinculada: false, cashback_percentual: null, desconto_do_clube: 12 })).toBe(12)
  })
  it('sem nada declarado: os 10% do Clube Prime', () => {
    expect(percentualSugerido({ vinculada: false, cashback_percentual: null, desconto_do_clube: null })).toBe(10)
  })
  it('desconto declarado absurdo (0 ou acima de 100) não vira sugestão', () => {
    expect(percentualSugerido({ vinculada: false, cashback_percentual: null, desconto_do_clube: 0 })).toBe(10)
    expect(percentualSugerido({ vinculada: false, cashback_percentual: null, desconto_do_clube: 150 })).toBe(10)
  })
})

describe('ler o percentual digitado', () => {
  it('aceita "10", "12,5" e "15%"', () => {
    expect(lerPercentual('10')).toBe(10)
    expect(lerPercentual('12,5')).toBe(12.5)
    expect(lerPercentual(' 15% ')).toBe(15)
  })
  it('recusa zero, acima de 100, vazio e texto', () => {
    expect(lerPercentual('0')).toBeNull()
    expect(lerPercentual('101')).toBeNull()
    expect(lerPercentual('')).toBeNull()
    expect(lerPercentual('dez')).toBeNull()
  })
})

describe('os textos curtos', () => {
  it('percentual do jeito que se fala', () => {
    expect(emPercentual(10)).toBe('10%')
    expect(emPercentual(12.5)).toBe('12,5%')
  })
  it('cidade e UF, ou o que tiver', () => {
    expect(ondeFica('Lagoa Santa', 'MG')).toBe('Lagoa Santa/MG')
    expect(ondeFica(null, 'MG')).toBe('MG')
    expect(ondeFica(null, null)).toBe('sem cidade')
  })
})
