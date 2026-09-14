import { describe, expect, it } from 'vitest'
import {
  CONFIG_PADRAO,
  ErroDeRegra,
  PROMOCIONAL,
  avancarDias,
  confirmarPagamento,
  contaAcumulo,
  contaCredito,
  contaDisponivel,
  contaRecebido,
  contaRestrita,
  darCashback,
  depositar,
  descerParaGastar,
  distribuirPromocao,
  estadoVazio,
  invarianteFecha,
  pedirPagamento,
  podeDescer,
  reciclar,
  sacar,
  saldo,
  saldoTotal,
  somarDias,
  type Estado,
} from './livro'

const HOJE = '2026-09-14'

function cena(): Estado {
  const estado = estadoVazio(HOJE)
  estado.lojas = [
    { id: 'padaria', nome: 'Padaria da Esquina', cashbackPercentual: 10 },
    { id: 'pizzaria', nome: 'Pizzaria do Zé', cashbackPercentual: 20 },
  ]
  estado.clientes = [{ id: 'ana', nome: 'Ana', telefone: '+5531999990000' }]
  return estado
}

/** Paga direto, juntando os dois passos do balcão -- só para os testes que não são sobre a confirmação. */
function pagar(estado: Estado, lojaId: string, clienteId: string, compra: number, cash: number, chave?: string) {
  const pedido = pedirPagamento(estado, lojaId, clienteId, compra, cash)
  return confirmarPagamento(estado, pedido.id, chave)
}

describe('a invariante', () => {
  it('fecha no estado vazio', () => {
    expect(invarianteFecha(estadoVazio(HOJE))).toBe(true)
  })

  it('depósito cria cash e dinheiro em custódia na mesma medida', () => {
    const estado = cena()
    depositar(estado, 'padaria', 1000)
    expect(saldo(estado, contaCredito('padaria'))).toBe(1000)
    expect(estado.custodia).toBe(1000)
    expect(invarianteFecha(estado)).toBe(true)
  })

  it('continua fechando depois de uma volta completa do dinheiro', () => {
    const estado = cena()
    depositar(estado, 'padaria', 1000)
    depositar(estado, 'pizzaria', 500)
    darCashback(estado, 'padaria', 'ana', 300, { presencial: true })
    descerParaGastar(estado, 'ana', 60)
    pagar(estado, 'pizzaria', 'ana', 80, 60)
    sacar(estado, 'pizzaria', 40)
    avancarDias(estado, 400)
    expect(invarianteFecha(estado)).toBe(true)
  })
})

describe('cashback', () => {
  it('sai do crédito que o lojista já pagou -- não nasce do nada', () => {
    const estado = cena()
    depositar(estado, 'padaria', 100)
    darCashback(estado, 'padaria', 'ana', 200)

    expect(saldo(estado, contaCredito('padaria'))).toBe(80)
    expect(saldo(estado, contaAcumulo('ana'))).toBe(20)
    expect(saldoTotal(estado)).toBe(100)
  })

  it('compra na loja vale o dobro da compra pela internet', () => {
    const estado = cena()
    depositar(estado, 'padaria', 100)
    darCashback(estado, 'padaria', 'ana', 100, { presencial: true })
    const naLoja = saldo(estado, contaAcumulo('ana'))

    const outro = cena()
    depositar(outro, 'padaria', 100)
    darCashback(outro, 'padaria', 'ana', 100, { presencial: false })
    const naInternet = saldo(outro, contaAcumulo('ana'))

    expect(naLoja).toBe(naInternet * CONFIG_PADRAO.multiplicadorPresencial)
  })

  it('recusa quando o lojista não tem crédito suficiente', () => {
    const estado = cena()
    depositar(estado, 'padaria', 5)
    expect(() => darCashback(estado, 'padaria', 'ana', 1000)).toThrow(ErroDeRegra)
    expect(invarianteFecha(estado)).toBe(true)
  })

  it('o saldo restrito fica numa conta separada, da loja que deu', () => {
    const estado = cena()
    depositar(estado, 'padaria', 100)
    darCashback(estado, 'padaria', 'ana', 100, { restrito: true })

    expect(saldo(estado, contaRestrita('ana', 'padaria'))).toBe(10)
    expect(saldo(estado, contaAcumulo('ana'))).toBe(0)
  })
})

describe('o gatilho e o relógio', () => {
  it('não deixa descer antes de juntar o gatilho', () => {
    const estado = cena()
    depositar(estado, 'padaria', 100)
    darCashback(estado, 'padaria', 'ana', 100) // 10, abaixo do gatilho de 30

    expect(podeDescer(estado, 'ana')).toBe(false)
    expect(() => descerParaGastar(estado, 'ana', 10)).toThrow(/gatilho/)
  })

  it('deixa o cliente escolher quanto desce, e só o que desceu ganha prazo curto', () => {
    const estado = cena()
    depositar(estado, 'padaria', 1000)
    darCashback(estado, 'padaria', 'ana', 1000) // 100 no acúmulo

    descerParaGastar(estado, 'ana', 30)

    expect(saldo(estado, contaDisponivel('ana'))).toBe(30)
    expect(saldo(estado, contaAcumulo('ana'))).toBe(70)

    const disponivel = estado.lotes.find((l) => l.conta === contaDisponivel('ana'))
    expect(disponivel?.venceEm).toBe(somarDias(HOJE, CONFIG_PADRAO.prazoGastoDias))
  })

  it('o que desceu e não foi gasto vence e vira fundo de promoção', () => {
    const estado = cena()
    depositar(estado, 'padaria', 1000)
    darCashback(estado, 'padaria', 'ana', 1000)
    descerParaGastar(estado, 'ana', 50)

    avancarDias(estado, CONFIG_PADRAO.prazoGastoDias + 1)

    expect(saldo(estado, contaDisponivel('ana'))).toBe(0)
    expect(saldo(estado, PROMOCIONAL)).toBe(50)
    expect(invarianteFecha(estado)).toBe(true)
  })

  it('o saldo restrito morre antes do saldo da rede', () => {
    const estado = cena()
    depositar(estado, 'padaria', 1000)
    darCashback(estado, 'padaria', 'ana', 500, { restrito: true }) // vence em 30
    darCashback(estado, 'padaria', 'ana', 500) // acúmulo, vence em 365

    avancarDias(estado, CONFIG_PADRAO.prazoRestritoDias + 1)

    expect(saldo(estado, contaRestrita('ana', 'padaria'))).toBe(0)
    expect(saldo(estado, contaAcumulo('ana'))).toBe(50)
  })

  it('o relógio não anda para trás', () => {
    const estado = cena()
    expect(() => avancarDias(estado, -1)).toThrow(ErroDeRegra)
  })
})

describe('pagamento no balcão', () => {
  it('só move dinheiro depois que o cliente confirma', () => {
    const estado = cena()
    depositar(estado, 'padaria', 1000)
    darCashback(estado, 'padaria', 'ana', 1000)
    descerParaGastar(estado, 'ana', 100)

    const pedido = pedirPagamento(estado, 'pizzaria', 'ana', 80, 50)
    expect(saldo(estado, contaDisponivel('ana'))).toBe(100)
    expect(estado.pagamentosPendentes).toHaveLength(1)

    confirmarPagamento(estado, pedido.id)
    expect(saldo(estado, contaDisponivel('ana'))).toBe(50)
    expect(saldo(estado, contaRecebido('pizzaria'))).toBe(50)
    expect(estado.pagamentosPendentes).toHaveLength(0)
  })

  it('guarda o valor da compra junto -- é daqui que sai o painel do lojista', () => {
    const estado = cena()
    depositar(estado, 'padaria', 1000)
    darCashback(estado, 'padaria', 'ana', 1000)
    descerParaGastar(estado, 'ana', 100)

    const lancamento = pagar(estado, 'pizzaria', 'ana', 80, 50)

    expect(lancamento.valorCompra).toBe(80)
    expect(lancamento.valor).toBe(50)
  })

  it('gasta primeiro o restrito da própria loja, depois o da rede', () => {
    const estado = cena()
    depositar(estado, 'padaria', 1000)
    darCashback(estado, 'padaria', 'ana', 200, { restrito: true }) // 20 restritos na padaria
    darCashback(estado, 'padaria', 'ana', 1000) // 100 no acúmulo
    descerParaGastar(estado, 'ana', 100)

    pagar(estado, 'padaria', 'ana', 60, 30)

    expect(saldo(estado, contaRestrita('ana', 'padaria'))).toBe(0)
    expect(saldo(estado, contaDisponivel('ana'))).toBe(90)
  })

  it('o restrito de uma loja não vale na outra', () => {
    const estado = cena()
    depositar(estado, 'padaria', 1000)
    darCashback(estado, 'padaria', 'ana', 500, { restrito: true }) // 50 restritos na padaria

    expect(() => pedirPagamento(estado, 'pizzaria', 'ana', 100, 50)).toThrow(ErroDeRegra)
  })

  it('aceita pagar a compra inteira em cash -- a loja da rede não pode restringir', () => {
    const estado = cena()
    depositar(estado, 'padaria', 1000)
    darCashback(estado, 'padaria', 'ana', 1000)
    descerParaGastar(estado, 'ana', 100)

    const lancamento = pagar(estado, 'pizzaria', 'ana', 30, 30)

    expect(lancamento.valor).toBe(30)
    expect(saldo(estado, contaRecebido('pizzaria'))).toBe(30)
  })

  it('não deixa pagar mais cash do que o valor da compra', () => {
    const estado = cena()
    depositar(estado, 'padaria', 1000)
    darCashback(estado, 'padaria', 'ana', 1000)
    descerParaGastar(estado, 'ana', 100)

    expect(() => pedirPagamento(estado, 'pizzaria', 'ana', 30, 60)).toThrow(ErroDeRegra)
  })

  it('não deixa gastar o que está travado no acúmulo', () => {
    const estado = cena()
    depositar(estado, 'padaria', 1000)
    darCashback(estado, 'padaria', 'ana', 1000) // 100, tudo no acúmulo

    expect(() => pedirPagamento(estado, 'pizzaria', 'ana', 50, 50)).toThrow(ErroDeRegra)
  })
})

describe('saque e reciclagem', () => {
  it('a taxa vira fundo de promoção e só o líquido sai da custódia', () => {
    const estado = cena()
    depositar(estado, 'padaria', 1000)
    darCashback(estado, 'padaria', 'ana', 1000)
    descerParaGastar(estado, 'ana', 100)
    pagar(estado, 'pizzaria', 'ana', 200, 100)

    const antes = estado.custodia
    const { taxa, recebeEmReais } = sacar(estado, 'pizzaria', 100)

    expect(taxa).toBe(5)
    expect(recebeEmReais).toBe(95)
    expect(saldo(estado, PROMOCIONAL)).toBe(5)
    expect(estado.custodia).toBe(antes - 95)
    expect(invarianteFecha(estado)).toBe(true)
  })

  it('não deixa sacar mais do que recebeu de clientes', () => {
    const estado = cena()
    depositar(estado, 'padaria', 1000)
    expect(() => sacar(estado, 'padaria', 100)).toThrow(ErroDeRegra)
  })

  it('crédito depositado não vira saque por acidente', () => {
    const estado = cena()
    depositar(estado, 'padaria', 500)
    expect(saldo(estado, contaRecebido('padaria'))).toBe(0)
    expect(() => sacar(estado, 'padaria', 1)).toThrow(ErroDeRegra)
  })

  it('reciclar devolve ao crédito sem cobrar taxa', () => {
    const estado = cena()
    depositar(estado, 'padaria', 1000)
    darCashback(estado, 'padaria', 'ana', 1000)
    descerParaGastar(estado, 'ana', 100)
    pagar(estado, 'pizzaria', 'ana', 200, 100)

    reciclar(estado, 'pizzaria', 100)

    expect(saldo(estado, contaCredito('pizzaria'))).toBe(100)
    expect(saldo(estado, contaRecebido('pizzaria'))).toBe(0)
    expect(saldo(estado, PROMOCIONAL)).toBe(0)
  })
})

describe('idempotência (o balcão com sinal ruim)', () => {
  it('o mesmo cashback enviado duas vezes só conta uma', () => {
    const estado = cena()
    depositar(estado, 'padaria', 1000)

    darCashback(estado, 'padaria', 'ana', 100, { chave: 'venda-123' })
    darCashback(estado, 'padaria', 'ana', 100, { chave: 'venda-123' })

    expect(saldo(estado, contaAcumulo('ana'))).toBe(10)
    expect(estado.lancamentos.filter((l) => l.tipo === 'cashback')).toHaveLength(1)
  })

  it('o mesmo depósito enviado duas vezes não dobra a custódia', () => {
    const estado = cena()
    depositar(estado, 'padaria', 1000, 'pix-abc')
    depositar(estado, 'padaria', 1000, 'pix-abc')

    expect(estado.custodia).toBe(1000)
    expect(invarianteFecha(estado)).toBe(true)
  })

  it('o mesmo pagamento confirmado duas vezes não cobra dobrado', () => {
    const estado = cena()
    depositar(estado, 'padaria', 1000)
    darCashback(estado, 'padaria', 'ana', 1000)
    descerParaGastar(estado, 'ana', 100)

    const pedido = pedirPagamento(estado, 'pizzaria', 'ana', 80, 50)
    confirmarPagamento(estado, pedido.id, 'pag-xyz')
    confirmarPagamento(estado, pedido.id, 'pag-xyz')

    expect(saldo(estado, contaDisponivel('ana'))).toBe(50)
  })
})

describe('promoção da rede', () => {
  it('sai do fundo, que tem lastro', () => {
    const estado = cena()
    depositar(estado, 'padaria', 1000)
    darCashback(estado, 'padaria', 'ana', 1000)
    descerParaGastar(estado, 'ana', 100)
    avancarDias(estado, CONFIG_PADRAO.prazoGastoDias + 1) // os 100 vencem e viram fundo

    distribuirPromocao(estado, 'ana', 40)

    expect(saldo(estado, PROMOCIONAL)).toBe(60)
    expect(saldo(estado, contaAcumulo('ana'))).toBe(40)
    expect(invarianteFecha(estado)).toBe(true)
  })

  it('não deixa distribuir mais do que o fundo tem -- cash sem dinheiro atrás é saque que não acontece', () => {
    const estado = cena()
    depositar(estado, 'padaria', 1000)
    expect(() => distribuirPromocao(estado, 'ana', 50)).toThrow(/depositar dinheiro de verdade/)
  })
})

describe('nenhum saldo fica negativo', () => {
  it('em nenhuma conta, depois de uma sequência longa de operações', () => {
    const estado = cena()
    depositar(estado, 'padaria', 800)
    depositar(estado, 'pizzaria', 400)

    for (let i = 0; i < 12; i++) {
      darCashback(estado, 'padaria', 'ana', 120, { presencial: i % 2 === 0 })
      if (podeDescer(estado, 'ana')) descerParaGastar(estado, 'ana', 30)
      try {
        pagar(estado, 'pizzaria', 'ana', 45, 20)
      } catch {
        // sem saldo liberado nesta volta -- é resposta válida, não erro do teste
      }
      avancarDias(estado, 5)
    }

    for (const lote of estado.lotes) expect(lote.valor).toBeGreaterThan(0)
    expect(invarianteFecha(estado)).toBe(true)
  })
})
