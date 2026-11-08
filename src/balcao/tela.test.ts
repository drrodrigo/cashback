// @vitest-environment jsdom
//
// O BALCÃO MONTADO, lido como o vendedor lê.
//
// Não é teste de componente: é a tela de verdade no DOM, com os dados que o
// banco devolveria, e a conferência é o TEXTO e os BOTÕES que aparecem. É a
// lição de 01/10 -- consertei a loja de temas quatro vezes lendo o código,
// quando o defeito era a tela abrir sem nenhum botão.

import { describe, expect, it, vi } from 'vitest'
import { desenharBalcao, type AcoesDoBalcao, type DadosDoBalcao } from './tela'
import type { Cliente, MinhaLoja } from './estado'

const LOJA: MinhaLoja = {
  loja_id: 'l1',
  nome: 'Joalheria Sol',
  cashback_percentual: 10,
  credito: 1000,
  recebido: 250,
  saque_pedido: 0,
}

const CLIENTE: Cliente = {
  cliente_id: 'c1',
  nome: 'Ana do Clube',
  pode_usar_aqui: 40,
  acumulado: 12,
  validacao_id: 'v1',
  nivel: 'prime',
}

function acoes(sobre: Partial<AcoesDoBalcao> = {}): AcoesDoBalcao {
  return {
    entrar: vi.fn(async () => undefined),
    sair: vi.fn(async () => undefined),
    lerCodigo: vi.fn(async () => undefined),
    darCashback: vi.fn(async () => undefined),
    cobrar: vi.fn(async () => undefined),
    pedirSaque: vi.fn(async () => undefined),
    limparAtendimento: vi.fn(),
    escolher: vi.fn(),
    ...sobre,
  }
}

function montar(sobre: Partial<DadosDoBalcao> = {}, a: AcoesDoBalcao = acoes()): HTMLElement {
  const onde = document.createElement('div')
  const d: DadosDoBalcao = {
    logado: true,
    carregando: false,
    loja: LOJA,
    cliente: null,
    modo: 'dar',
    cobrancas: [],
    extrato: [],
    camera: 'lendo',
    erro: null,
    recado: null,
    ocupado: false,
    ...sobre,
  }
  desenharBalcao(onde, d, a)
  return onde
}

const texto = (n: HTMLElement) => n.textContent ?? ''
const botoes = (n: HTMLElement) => [...n.querySelectorAll('button')].map((b) => b.textContent ?? '')
const acharBotao = (n: HTMLElement, parte: string) =>
  [...n.querySelectorAll('button')].find((b) => (b.textContent ?? '').includes(parte))
const digitar = (n: HTMLElement, rotulo: string, valor: string) => {
  const i = n.querySelector<HTMLInputElement>(`input[aria-label="${rotulo}"]`)!
  i.value = valor
  i.dispatchEvent(new Event('input'))
  return i
}

describe('antes do balcão', () => {
  it('publicado sem as variáveis manda PUBLICAR DE NOVO, em vez de abrir branco', () => {
    const t = montar({ faltaConfigurar: true, logado: false })
    expect(texto(t)).toContain('Falta configuração')
    expect(texto(t)).toContain('publicar de novo')
  })

  it('sem login, pede o login e DIZ que é o mesmo do Clube', () => {
    const t = montar({ logado: false })
    expect(texto(t)).toContain('Entrar no balcão')
    expect(texto(t)).toContain('mesmo e-mail e a mesma senha do Clube Prime')
  })

  // 🔴 O CASO QUE EVITA O BALCÃO VAZIO. Quem entrou e não tem loja precisa ler
  // isso, não uma tela sem botão -- inclusive quem VENDEU a loja, porque quem
  // decide é o banco a cada chamada.
  it('entrou e não é lojista: diz isso, e não mostra balcão nenhum', () => {
    const t = montar({ loja: null })
    expect(texto(t)).toContain('Esta conta não tem loja no cashback')
    expect(texto(t)).not.toContain('Ler a carteirinha')
  })
})

describe('a loja no balcão', () => {
  it('mostra o nome, o percentual e os dois números que importam', () => {
    const t = montar()
    expect(texto(t)).toContain('Joalheria Sol')
    expect(texto(t)).toContain('Devolve 10%')
    expect(texto(t)).toContain('R$ 1.000,00')
    expect(texto(t)).toContain('para dar de cashback')
    expect(texto(t)).toContain('R$ 250,00')
  })

  // Sem crédito, `cash.dar_cashback` recusa. O recado tem que vir ANTES de o
  // vendedor tentar, não como erro vermelho na frente do cliente.
  it('crédito zerado avisa antes de alguém tentar atender', () => {
    const t = montar({ loja: { ...LOJA, credito: 0 } })
    expect(texto(t)).toContain('Sem crédito para dar cashback')
  })

  it('o saque pedido aparece, e o botão oferece só o que sobrou', () => {
    const t = montar({ loja: { ...LOJA, recebido: 250, saque_pedido: 100 } })
    expect(texto(t)).toContain('Saque de R$ 100,00 pedido')
    expect(botoes(t).some((b) => b.includes('Pedir saque de R$ 150,00'))).toBe(true)
  })

  it('sem nada recebido, não oferece saque', () => {
    const t = montar({ loja: { ...LOJA, recebido: 0 } })
    expect(botoes(t).some((b) => b.includes('Pedir saque'))).toBe(false)
  })
})

describe('ler a carteirinha', () => {
  // 🔴 NÃO EXISTE CAMPO PARA DIGITAR QUEM É O CLIENTE, e isto é a trava disso:
  // se um dia alguém acrescentar um, este caso fica vermelho. É o que impede o
  // vendedor de creditar ou debitar a conta de um terceiro.
  it('não oferece nenhum jeito de dizer QUEM é o cliente', () => {
    const t = montar()
    const rotulos = [...t.querySelectorAll('input')].map((i) => i.getAttribute('aria-label') ?? '')
    expect(rotulos).toEqual(['Código da carteirinha'])
    expect(texto(t)).not.toContain('telefone')
    expect(texto(t)).not.toContain('CPF')
  })

  it('o campo de digitar o código aparece MESMO com a câmera lendo', () => {
    const t = montar({ camera: 'lendo' })
    expect(t.querySelector('input[aria-label="Código da carteirinha"]')).toBeTruthy()
    expect(texto(t)).toContain('Lendo. Aponte para o QR.')
  })

  it('câmera negada explica e manda digitar, em vez de ficar preta', () => {
    const t = montar({ camera: 'negada' })
    expect(texto(t)).toContain('câmera foi bloqueada')
    expect(t.querySelector('input[aria-label="Código da carteirinha"]')).toBeTruthy()
  })

  it('digitar o código e enviar chama a leitura com o que foi digitado', () => {
    const a = acoes()
    const t = montar({}, a)
    const i = t.querySelector<HTMLInputElement>('input[aria-label="Código da carteirinha"]')!
    i.value = 'abc'
    t.querySelector('form')!.dispatchEvent(new Event('submit'))
    expect(a.lerCodigo).toHaveBeenCalledWith('abc')
  })
})

describe('o atendimento, depois de ler', () => {
  it('mostra o nome e a frase que o vendedor fala em voz alta', () => {
    const t = montar({ cliente: CLIENTE })
    expect(texto(t)).toContain('Ana do Clube')
    expect(texto(t)).toContain('tem R$ 40,00 para usar aqui agora')
  })

  it('quem só está juntando ouve isso, não "tem saldo"', () => {
    const t = montar({ cliente: { ...CLIENTE, pode_usar_aqui: 0, acumulado: 12 } })
    expect(texto(t)).toContain('está juntando: R$ 12,00')
    expect(texto(t)).toContain('Ainda não dá para gastar')
  })

  // A pílula é ESCOLHA, não ação: `aria-pressed` diz qual está escolhida.
  it('as duas opções vêm numa pílula, com a escolhida marcada', () => {
    const t = montar({ cliente: CLIENTE, modo: 'dar' })
    const p = [...t.querySelectorAll('.ca-escolha button')]
    expect(p.map((b) => b.textContent)).toEqual(['Dar cashback', 'Cobrar'])
    expect(p.map((b) => b.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
  })

  it('clicar na outra opção só ESCOLHE: não lança nem cobra nada', () => {
    const a = acoes()
    const t = montar({ cliente: CLIENTE, modo: 'dar' }, a)
    acharBotao(t, 'Cobrar')!.click()
    expect(a.escolher).toHaveBeenCalledWith('cobrar')
    expect(a.darCashback).not.toHaveBeenCalled()
    expect(a.cobrar).not.toHaveBeenCalled()
  })
})

describe('dar cashback', () => {
  it('o botão diz o VALOR que vai ser lançado, não "confirmar"', () => {
    const t = montar({ cliente: CLIENTE })
    digitar(t, 'Valor da compra', '200')
    expect(texto(t)).toContain('Ana do Clube ganha R$ 20,00 de cash nesta compra')
    expect(botoes(t).some((b) => b === 'Lançar R$ 20,00')).toBe(true)
  })

  it('aceita o valor com vírgula, como gente digita', () => {
    const t = montar({ cliente: CLIENTE })
    digitar(t, 'Valor da compra', 'R$ 1.234,50')
    expect(botoes(t).some((b) => b === 'Lançar R$ 123,45')).toBe(true)
  })

  it('sem valor digitado, o botão fica desligado', () => {
    const t = montar({ cliente: CLIENTE })
    expect(acharBotao(t, 'Lançar')!.disabled).toBe(true)
  })

  // 🔴 O CASO COM CONFLITO: a compra é válida, mas o cashback dela passa do que
  // a loja tem para dar. Sem este caso, a trava mediria só "digitou ou não".
  it('cashback maior que o crédito da loja: explica e não deixa lançar', () => {
    const t = montar({ cliente: CLIENTE, loja: { ...LOJA, credito: 5 } })
    digitar(t, 'Valor da compra', '200')
    expect(texto(t)).toContain('Faltou crédito: a loja tem R$ 5,00 para dar')
    expect(acharBotao(t, 'Lançar')!.disabled).toBe(true)
  })

  it('lançar chama a ação com o valor da COMPRA (quem calcula é o banco)', () => {
    const a = acoes()
    const t = montar({ cliente: CLIENTE }, a)
    digitar(t, 'Valor da compra', '200')
    acharBotao(t, 'Lançar')!.click()
    expect(a.darCashback).toHaveBeenCalledWith(200)
  })
})

describe('cobrar', () => {
  it('diz o teto desta compra e deixa cobrar dentro dele', () => {
    const a = acoes()
    const t = montar({ cliente: CLIENTE, modo: 'cobrar' }, a)
    digitar(t, 'Valor da compra', '100')
    expect(texto(t)).toContain('Pode usar até R$ 40,00 nesta compra')
    digitar(t, 'Quanto em cash', '40')
    acharBotao(t, 'Pedir confirmação')!.click()
    expect(a.cobrar).toHaveBeenCalledWith(100, 40)
  })

  // 🔴 OS DOIS TETOS, medidos separados. Este é o saldo.
  it('passar do saldo do cliente é recusado na tela', () => {
    const t = montar({ cliente: CLIENTE, modo: 'cobrar' })
    digitar(t, 'Valor da compra', '100')
    digitar(t, 'Quanto em cash', '60')
    expect(texto(t)).toContain('Passou do limite: o máximo aqui é R$ 40,00')
    expect(acharBotao(t, 'Pedir confirmação')!.disabled).toBe(true)
  })

  // E este é a própria compra: ninguém paga 60 numa compra de 50, mesmo tendo
  // saldo de sobra. Sem este caso, o teto da compra nunca seria medido.
  it('ninguém paga mais que a compra, mesmo com saldo sobrando', () => {
    const t = montar({ cliente: { ...CLIENTE, pode_usar_aqui: 500 }, modo: 'cobrar' })
    digitar(t, 'Valor da compra', '50')
    expect(texto(t)).toContain('Pode usar até R$ 50,00 nesta compra')
    digitar(t, 'Quanto em cash', '60')
    expect(acharBotao(t, 'Pedir confirmação')!.disabled).toBe(true)
  })

  it('a tela DIZ que quem confirma é o cliente, no celular dele', () => {
    const t = montar({ cliente: CLIENTE, modo: 'cobrar' })
    expect(texto(t)).toContain('O cliente confirma no celular dele')
  })
})

describe('as listas', () => {
  it('cobrança esperando aparece com os dois valores e o nome', () => {
    const t = montar({
      cobrancas: [
        {
          id: 'p1',
          cliente_nome: 'Bruno',
          valor_compra: 80,
          valor_em_cash: 20,
          criado_em: '2026-11-08T14:30:00',
        },
      ],
    })
    expect(texto(t)).toContain('Esperando o cliente confirmar')
    expect(texto(t)).toContain('Bruno')
    expect(texto(t)).toContain('R$ 20,00 de cash numa compra de R$ 80,00')
    expect(texto(t)).toContain('08/11 14:30')
  })

  it('sem cobrança nenhuma, a lista nem aparece', () => {
    expect(texto(montar())).not.toContain('Esperando o cliente confirmar')
  })

  it('extrato vazio diz o que esperar, em vez de ficar em branco', () => {
    expect(texto(montar())).toContain('O primeiro atendimento aparece aqui')
  })
})
