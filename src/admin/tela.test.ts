// @vitest-environment jsdom
//
// A TELA DO ADMINISTRADOR MONTADA, lida como ele lê: o texto e os botões que aparecem, com os dados que o banco
// devolveria. A conferência que mais importa é a do DEPÓSITO: ele cria troco de verdade, e não pode sair de um
// clique só.

import { describe, expect, it, vi } from 'vitest'
import { desenharAdmin, type AcoesDoAdmin, type DadosDoAdmin } from './tela'
import type { Achado, LojaAdmin, Painel, SaquePedido } from './estado'

const PAINEL: Painel = {
  cash_existente: 300,
  dinheiro_em_custodia: 300,
  diferenca: 0,
  fecha: true,
  fundo_de_promocao: 12,
  lojas: 1,
  clientes: 4,
  saques_a_pagar: 0,
}

const OTICA: Achado = {
  origem: 'qrunico',
  origem_id: 'u-otica',
  nome: 'Ótica Visão',
  cidade: 'Belo Horizonte',
  uf: 'MG',
  contato: 'oticavisao',
  desconto_do_clube: null,
  loja_id: null,
  cashback_percentual: null,
  vinculada: false,
}

const ACAI: Achado = {
  origem: 'catalogo',
  origem_id: 'c-acai',
  nome: 'Açaí da Praça',
  cidade: 'Lagoa Santa',
  uf: 'MG',
  contato: 'acaidapraca',
  desconto_do_clube: 12,
  loja_id: 'l-acai',
  cashback_percentual: 12,
  vinculada: true,
}

const LOJA: LojaAdmin = {
  loja_id: 'l-acai',
  nome: 'Açaí da Praça',
  origem: 'catalogo',
  cashback_percentual: 12,
  ativa: true,
  cidade: 'Lagoa Santa',
  uf: 'MG',
  credito: 0,
  recebido: 40,
  saque_pedido: 0,
}

function dados(mais: Partial<DadosDoAdmin> = {}): DadosDoAdmin {
  return {
    logado: true,
    naoEAdmin: false,
    painel: PAINEL,
    busca: '',
    achados: null,
    lojas: [],
    saques: [],
    depositoPendente: null,
    erro: null,
    recado: null,
    ocupado: false,
    ...mais,
  }
}

function acoes(): AcoesDoAdmin & Record<string, ReturnType<typeof vi.fn>> {
  return {
    entrar: vi.fn(async () => {}),
    sair: vi.fn(async () => {}),
    buscar: vi.fn(async () => {}),
    vincular: vi.fn(async () => {}),
    prepararDeposito: vi.fn(),
    confirmarDeposito: vi.fn(async () => {}),
    cancelarDeposito: vi.fn(),
    pagarSaque: vi.fn(async () => {}),
    recusarSaque: vi.fn(async () => {}),
    vencerAgora: vi.fn(async () => {}),
  } as unknown as AcoesDoAdmin & Record<string, ReturnType<typeof vi.fn>>
}

function montar(d: DadosDoAdmin, a = acoes()) {
  const onde = document.createElement('div')
  desenharAdmin(onde, d, a)
  const botoes = () => [...onde.querySelectorAll('button')]
  const botao = (texto: string | RegExp) =>
    botoes().find((b) => (typeof texto === 'string' ? b.textContent === texto : texto.test(b.textContent ?? '')))
  return { onde, a, texto: () => onde.textContent ?? '', botoes, botao }
}

function digitar(entrada: HTMLInputElement, valor: string) {
  entrada.value = valor
  entrada.dispatchEvent(new Event('input'))
}

describe('as telas de antes do painel', () => {
  it('sem login: o formulário de entrar, e nada de painel', () => {
    const t = montar(dados({ logado: false, painel: null }))
    expect(t.texto()).toContain('Entrar como administrador')
    expect(t.texto()).not.toContain('A conta da rede')
  })
  it('o banco disse so_admin: diz que a conta não é de administrador e aponta o balcão', () => {
    const t = montar(dados({ naoEAdmin: true }))
    expect(t.texto()).toContain('Esta conta não é de administrador')
    expect(t.onde.querySelector('a[href="./balcao.html"]')).not.toBeNull()
    expect(t.texto()).not.toContain('Vincular lojista')
  })
  it('sem as variáveis: manda publicar de novo', () => {
    const t = montar(dados({ faltaConfigurar: true }))
    expect(t.texto()).toContain('é preciso publicar de novo')
  })
})

describe('a conferência da rede', () => {
  it('quando fecha, diz que bate', () => {
    const t = montar(dados())
    expect(t.texto()).toContain('✓ Bate')
    expect(t.texto()).toContain('R$ 300,00')
  })
  it('quando NÃO fecha, grita, mostra a diferença e manda segurar os saques', () => {
    const t = montar(dados({ painel: { ...PAINEL, cash_existente: 310, diferenca: 10, fecha: false } }))
    expect(t.texto()).toContain('✗ NÃO BATE')
    expect(t.texto()).toContain('R$ 10,00')
    expect(t.texto()).toContain('Não pague saque')
  })
})

describe('vincular o lojista pelo nome', () => {
  it('buscar chama a busca com o que foi digitado', () => {
    const t = montar(dados())
    const busca = t.onde.querySelector('input[type="search"]') as HTMLInputElement
    busca.value = 'otica'
    t.onde.querySelector('form')!.dispatchEvent(new Event('submit'))
    expect(t.a.buscar).toHaveBeenCalledWith('otica')
  })

  it('a empresa do QR Único aparece com a origem e a cidade, e o botão já diz o percentual (10% do Clube)', () => {
    const t = montar(dados({ busca: 'otica', achados: [OTICA] }))
    expect(t.texto()).toContain('Ótica Visão')
    expect(t.texto()).toContain('QR Único · Belo Horizonte/MG')
    const ligar = t.botao('Vincular com 10%')!
    expect(ligar).toBeDefined()
    ligar.click()
    expect(t.a.vincular).toHaveBeenCalledWith('qrunico', 'u-otica', 10)
  })

  it('a loja já vinculada mostra que já está, e o botão vira "Mudar para"', () => {
    const t = montar(dados({ busca: 'acai', achados: [ACAI] }))
    expect(t.texto()).toContain('já no Troco Prime · 12%')
    expect(t.botao('Mudar para 12%')).toBeDefined()
  })

  it('percentual trocado no campo vai no clique; percentual inválido desliga o botão', () => {
    const t = montar(dados({ busca: 'otica', achados: [OTICA] }))
    const pct = t.onde.querySelector('input[aria-label^="Percentual de troco"]') as HTMLInputElement
    digitar(pct, '15')
    t.botao('Vincular com 15%')!.click()
    expect(t.a.vincular).toHaveBeenCalledWith('qrunico', 'u-otica', 15)

    digitar(pct, '0')
    const ruim = t.botao('Percentual inválido')!
    expect(ruim.disabled).toBe(true)
  })

  it('buscou e não achou: diz que não achou (é diferente de nunca ter buscado)', () => {
    expect(montar(dados({ busca: 'xyz', achados: [] })).texto()).toContain('Nada com "xyz"')
    expect(montar(dados({ achados: null })).texto()).not.toContain('Nada com')
  })
})

describe('🔴 o depósito nunca é um clique só', () => {
  it('o primeiro botão só PREPARA: não registra nada', () => {
    const t = montar(dados({ lojas: [LOJA] }))
    const valor = t.onde.querySelector('input[aria-label="Depósito de Açaí da Praça"]') as HTMLInputElement
    const registrar = t.botao('Registrar depósito')!
    expect(registrar.disabled).toBe(true)
    digitar(valor, '300,00')
    expect(registrar.disabled).toBe(false)
    registrar.click()
    expect(t.a.prepararDeposito).toHaveBeenCalledWith('l-acai', 300)
    expect(t.a.confirmarDeposito).not.toHaveBeenCalled()
  })

  it('a confirmação diz o valor e a loja por extenso, e só ela registra', () => {
    const t = montar(dados({ lojas: [LOJA], depositoPendente: { loja_id: 'l-acai', nome: 'Açaí da Praça', valor: 300 } }))
    expect(t.texto()).toContain('Confirme o depósito')
    expect(t.texto()).toContain('Entrou R$ 300,00 na conta da plataforma, pago por Açaí da Praça?')
    t.botao('Confirmo: entrou R$ 300,00')!.click()
    expect(t.a.confirmarDeposito).toHaveBeenCalledTimes(1)
  })

  it('cancelar não registra', () => {
    const t = montar(dados({ lojas: [LOJA], depositoPendente: { loja_id: 'l-acai', nome: 'Açaí da Praça', valor: 300 } }))
    t.botao('Cancelar')!.click()
    expect(t.a.cancelarDeposito).toHaveBeenCalled()
    expect(t.a.confirmarDeposito).not.toHaveBeenCalled()
  })

  it('valor que não é dinheiro não prepara nada', () => {
    const t = montar(dados({ lojas: [LOJA] }))
    const valor = t.onde.querySelector('input[aria-label="Depósito de Açaí da Praça"]') as HTMLInputElement
    digitar(valor, 'trezentos')
    expect(t.botao('Registrar depósito')!.disabled).toBe(true)
  })
})

describe('os saques', () => {
  const PEDIDO: SaquePedido = { id: 's1', loja_id: 'l-acai', loja_nome: 'Açaí da Praça', valor: 40, situacao: 'pedido', pedido_em: '2026-11-19T10:00:00Z' }
  const PAGO: SaquePedido = { ...PEDIDO, id: 's2', situacao: 'pago' }

  it('só o pedido em aberto tem botão de pagar, e o botão diz o valor', () => {
    const t = montar(dados({ saques: [PEDIDO, PAGO] }))
    const pagar = t.botoes().filter((b) => (b.textContent ?? '').startsWith('Marcar pago'))
    expect(pagar).toHaveLength(1)
    expect(pagar[0].textContent).toBe('Marcar pago: R$ 40,00')
    pagar[0].click()
    expect(t.a.pagarSaque).toHaveBeenCalledWith('s1')
  })

  it('sem pedido em aberto, diz que não há', () => {
    expect(montar(dados({ saques: [PAGO] })).texto()).toContain('Nenhum saque esperando pagamento.')
  })
})
