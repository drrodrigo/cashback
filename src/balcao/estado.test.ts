// As contas do balcão, sem tela e sem rede.
//
// 🔴 Os valores esperados aqui são escritos À MÃO, nunca lidos da constante do
// código: teste espelho não mede nada -- ele repete o defeito.

import { describe, expect, it } from 'vitest'
import {
  cashbackDaCompra,
  emReais,
  fraseDoAtendimento,
  lerValor,
  qualTelaDoBalcao,
  tetoDaCobranca,
  type Cliente,
  type MinhaLoja,
} from './estado'
import { extrairToken } from '../lib/token'

const LOJA: MinhaLoja = {
  loja_id: 'l1',
  nome: 'Joalheria Sol',
  cashback_percentual: 10,
  credito: 1000,
  recebido: 0,
  saque_pedido: 0,
}
const CLIENTE: Cliente = {
  cliente_id: 'c1',
  nome: 'Ana',
  pode_usar_aqui: 40,
  acumulado: 12,
  validacao_id: 'v1',
  nivel: 'prime',
}

describe('qual tela', () => {
  it('a falta de configuração ganha de tudo, inclusive de estar logado', () => {
    expect(qualTelaDoBalcao({ logado: true, faltaConfigurar: true }, LOJA, false).qual).toBe(
      'falta-configurar',
    )
  })

  it('sem login, entrar -- mesmo enquanto carrega', () => {
    expect(qualTelaDoBalcao({ logado: false }, null, true).qual).toBe('entrar')
  })

  // 🔴 O CASO COM CONFLITO. "Sem loja" e "ainda carregando" dariam a mesma tela
  // vazia se a ordem estivesse errada -- e aí quem é lojista de verdade leria
  // "esta conta não tem loja" por um instante, no balcão, na frente do cliente.
  it('logado e carregando é CARREGANDO, não "não é lojista"', () => {
    expect(qualTelaDoBalcao({ logado: true }, null, true).qual).toBe('carregando')
    expect(qualTelaDoBalcao({ logado: true }, null, false).qual).toBe('nao-e-lojista')
  })

  it('com loja, é o balcão, e a loja vem junto', () => {
    const t = qualTelaDoBalcao({ logado: true }, LOJA, false)
    expect(t.qual).toBe('balcao')
    expect(t.qual === 'balcao' && t.loja.nome).toBe('Joalheria Sol')
  })
})

describe('o dinheiro, do jeito que ele lê', () => {
  it('escreve em reais com milhar e dois dígitos', () => {
    expect(emReais(1234.5)).toBe('R$ 1.234,50')
    expect(emReais(0)).toBe('R$ 0,00')
  })

  it('10% de 200 são 20', () => {
    expect(cashbackDaCompra(200, 10)).toBe(20)
  })

  it('arredonda em dois dígitos, igual ao banco', () => {
    expect(cashbackDaCompra(33.33, 7)).toBe(2.33)
  })

  it('compra zerada ou percentual zerado não rendem nada', () => {
    expect(cashbackDaCompra(0, 10)).toBe(0)
    expect(cashbackDaCompra(100, 0)).toBe(0)
    expect(cashbackDaCompra(-5, 10)).toBe(0)
  })
})

describe('ler o que foi digitado', () => {
  it('aceita vírgula, ponto de milhar, R$ e espaço', () => {
    expect(lerValor('12,50')).toBe(12.5)
    expect(lerValor('12.50')).toBe(12.5)
    expect(lerValor('R$ 1.234,50')).toBe(1234.5)
    expect(lerValor(' 80 ')).toBe(80)
  })

  // 🔴 NULO NÃO É ZERO, e a diferença é o botão ficar desligado em vez de lançar
  // zero calado.
  it('o que não é número vira nulo, não zero', () => {
    expect(lerValor('')).toBeNull()
    expect(lerValor('abc')).toBeNull()
    expect(lerValor('R$')).toBeNull()
    expect(lerValor('1,2,3')).toBeNull()
  })

  it('zero digitado é zero mesmo, e quem decide o que fazer é a tela', () => {
    expect(lerValor('0')).toBe(0)
  })
})

describe('o teto da cobrança são DOIS', () => {
  it('o saldo que serve aqui', () => {
    expect(tetoDaCobranca(100, 40)).toBe(40)
  })

  it('e a própria compra: ninguém paga 60 numa compra de 50', () => {
    expect(tetoDaCobranca(50, 500)).toBe(50)
  })

  it('saldo negativo não vira crédito', () => {
    expect(tetoDaCobranca(100, -5)).toBe(0)
  })
})

describe('a frase que o vendedor fala', () => {
  it('quem tem saldo ouve o valor', () => {
    expect(fraseDoAtendimento(CLIENTE, LOJA)).toBe('Ana tem R$ 40,00 para usar aqui agora.')
  })

  it('quem só juntou ouve que ainda não dá', () => {
    expect(fraseDoAtendimento({ ...CLIENTE, pode_usar_aqui: 0 }, LOJA)).toBe(
      'Ana está juntando: R$ 12,00. Ainda não dá para gastar.',
    )
  })

  it('quem está começando ouve o convite, com o percentual da loja', () => {
    expect(fraseDoAtendimento({ ...CLIENTE, pode_usar_aqui: 0, acumulado: 0 }, LOJA)).toBe(
      'Ana ainda não tem saldo. Esta compra rende 10%.',
    )
  })
})

describe('o que o QR carrega', () => {
  const T = 'a'.repeat(32)

  it('o endereço novo do Clube', () => {
    expect(extrairToken(`https://clubeprime.com.br/validar#${T}`)).toBe(T)
  })

  it('o token puro, que ainda existe em aba antiga', () => {
    expect(extrairToken(T)).toBe(T)
  })

  it('o leitor do caixa manda espaço e quebra de linha junto', () => {
    expect(extrairToken(`  ${T}\n`)).toBe(T)
  })

  // 🔴 QR de cardápio, de Pix, de site: recusado AQUI, sem gastar chamada ao
  // banco -- e sem gastar o token de ninguém.
  it('QR de outro site com 32 hexadecimais depois do # é recusado', () => {
    expect(extrairToken(`https://outrolugar.com/qualquer#${T}`)).toBeNull()
  })

  it('texto que não é token nenhum é recusado', () => {
    expect(extrairToken('https://exemplo.com')).toBeNull()
    expect(extrairToken('00000000-0000-0000-0000-000000000000')).toBeNull()
    expect(extrairToken('')).toBeNull()
  })
})
