// A DEMONSTRAÇÃO (/beta) faz o caminho inteiro do dinheiro com as MESMAS regras do banco, cada papel com o seu login e
// os três olhando o mesmo mundo. É o teste que diz que o /beta não mente para quem testa.
import { describe, expect, it } from 'vitest'
import { CARTEIRINHAS_DE_TESTE, criarDemonstracao, type Armazem } from './repositorio'

function armazemDeTeste(): Armazem {
  const m = new Map<string, string>()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }
}

function tres() {
  const a = armazemDeTeste()
  return { cliente: criarDemonstracao('cliente', a), loja: criarDemonstracao('loja', a), admin: criarDemonstracao('admin', a) }
}

describe('o caminho inteiro do dinheiro, no /beta', () => {
  it('ativar, ganhar troco, liberar, pagar na outra loja com a confirmação, sacar, e a conta fecha', async () => {
    const { cliente, loja, admin } = tres()

    // A Ana entra e ativa.
    await cliente.entrarComo('ana@trocoprime.teste')
    expect((await cliente.lerCarteira())!.aderiu).toBe(false)
    await cliente.ativar()
    expect((await cliente.lerCarteira())!.aderiu).toBe(true)

    // A Ótica (10%, só troco) lê a carteirinha da Ana e lança R$ 200: 20 de troco, sem dobro.
    await loja.entrarComo('otica@trocoprime.teste')
    const ana = await loja.lerCarteirinha(CARTEIRINHAS_DE_TESTE.ana)
    expect(ana!.nome).toBe('Ana Souza')
    await loja.darCashback(ana!.cliente_id, 200, ana!.validacao_id)
    const c1 = await cliente.lerCarteira()
    expect(c1!.acumulado).toBe(20)
    expect(c1!.falta_para_liberar).toBe(10)
    // 500 depositados, menos os 40 que o Bruno já tinha ganhado no começo, menos os 20 de agora.
    expect((await loja.lerMinhaLoja())!.credito).toBe(440)

    // Mais R$ 150: 35 juntados, libera os 35.
    const ana2 = await loja.lerCarteirinha(CARTEIRINHAS_DE_TESTE.ana)
    await loja.darCashback(ana2!.cliente_id, 150, ana2!.validacao_id)
    await cliente.transferir(35)
    expect((await cliente.lerCarteira())!.disponivel).toBe(35)

    // A Padaria cobra 30 numa compra de 80: só sai com a confirmação da Ana.
    await loja.sair()
    await loja.entrarComo('padaria@trocoprime.teste')
    const ana3 = await loja.lerCarteirinha(CARTEIRINHAS_DE_TESTE.ana)
    expect(ana3!.pode_usar_aqui).toBe(35)
    await loja.pedirPagamento(ana3!.cliente_id, 80, 30)
    expect((await cliente.lerCarteira())!.disponivel).toBe(35) // ainda não saiu
    const [cobranca] = await cliente.lerMinhasCobrancas()
    expect(cobranca.loja_nome).toBe('Padaria Pão Quente')
    await cliente.confirmarCobranca(cobranca.id)
    expect((await cliente.lerCarteira())!.disponivel).toBe(5)
    expect((await loja.lerMinhaLoja())!.recebido).toBe(30)

    // A Padaria pede o saque e o administrador paga: 5% vão para o fundo.
    await loja.pedirSaque(30)
    await admin.entrarComo('admin@trocoprime.teste')
    const [saque] = await admin.lerSaquesPedidos()
    await admin.pagarSaque(saque.id)
    const painel = await admin.lerPainel()
    expect(painel!.fecha).toBe(true)
    expect(painel!.fundo_de_promocao).toBe(1.5)
  })

  it('cada papel tem o seu login: a Ana no celular e a Padaria no balcão, ao mesmo tempo', async () => {
    const { cliente, loja } = tres()
    await cliente.entrarComo('ana@trocoprime.teste')
    await loja.entrarComo('padaria@trocoprime.teste')
    expect(cliente.contaAtual()!.nome).toBe('Ana Souza')
    expect(loja.contaAtual()!.nome).toBe('Padaria Pão Quente')
    expect((await loja.lerMinhaLoja())!.desconto_no_caixa).toBe(10)
  })
})

describe('as recusas, com os MESMOS códigos do banco', () => {
  it('quem não ativou não é atendido no balcão', async () => {
    const { loja } = tres()
    await loja.entrarComo('otica@trocoprime.teste')
    await expect(loja.lerCarteirinha(CARTEIRINHAS_DE_TESTE.ana)).rejects.toThrow('membro_nao_ativou')
  })

  it('liberar menos que 30 é recusado (abaixo_do_minimo); a cobrança não passa do valor da compra', async () => {
    const { cliente, loja } = tres()
    await cliente.entrarComo('bruno@trocoprime.teste')
    await expect(cliente.transferir(10)).rejects.toThrow('abaixo_do_minimo')
    await cliente.transferir(40)
    await loja.entrarComo('otica@trocoprime.teste')
    await expect(loja.pedirPagamento('bruno', 20, 30)).rejects.toThrow('cash_passa_da_compra')
  })

  it('quem não é administrador toma so_admin, e regras acima de 100% são recusadas', async () => {
    const { admin } = tres()
    await expect(admin.lerPainel()).rejects.toThrow('so_admin')
    await admin.entrarComo('ana@trocoprime.teste')
    await expect(admin.lerPainel()).rejects.toThrow('so_admin')
    await admin.sair()
    await admin.entrarComo('admin@trocoprime.teste')
    await expect(admin.salvarRegrasDaLoja('otica', 60, 50)).rejects.toThrow('regras_passam_de_100')
  })

  it('erro no meio não deixa o mundo pela metade', async () => {
    const { cliente, admin } = tres()
    await admin.entrarComo('admin@trocoprime.teste')
    const antes = await admin.lerPainel()
    await cliente.entrarComo('bruno@trocoprime.teste')
    await expect(cliente.transferir(999)).rejects.toThrow()
    expect(await admin.lerPainel()).toEqual(antes)
  })
})

describe('o administrador, na demonstração', () => {
  it('acha a loja pelo nome sem acento e vincula com as duas porcentagens', async () => {
    const { admin } = tres()
    await admin.entrarComo('admin@trocoprime.teste')
    const [acai] = await admin.buscarLojistas('acai')
    expect(acai.nome).toBe('Açaí da Praça')
    expect(acai.vinculada).toBe(false)
    const id = await admin.vincularLojista(acai.origem, acai.origem_id, 15)
    await admin.salvarRegrasDaLoja(id, 15, 5)
    const loja = (await admin.lerLojasDoAdmin()).find((l) => l.loja_id === id)!
    expect(loja.cashback_percentual).toBe(15)
    expect(loja.desconto_no_caixa).toBe(5)
    expect((await admin.buscarLojistas('acai'))[0].vinculada).toBe(true)
  })

  it('"Passar 30 dias" vence o troco liberado e manda para o fundo; recomeçar volta ao começo', async () => {
    const { cliente, admin } = tres()
    await cliente.entrarComo('bruno@trocoprime.teste')
    await cliente.transferir(40)
    expect(cliente.passarDias(31)).toBeGreaterThan(0)
    expect((await cliente.lerCarteira())!.disponivel).toBe(0)
    await admin.entrarComo('admin@trocoprime.teste')
    expect((await admin.lerPainel())!.fundo_de_promocao).toBe(40)
    admin.recomecar()
    expect(await admin.estaLogado()).toBe(false)
    await admin.entrarComo('admin@trocoprime.teste')
    expect((await admin.lerPainel())!.fundo_de_promocao).toBe(0)
  })
})
