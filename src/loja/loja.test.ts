// @vitest-environment jsdom
//
// O CADASTRO DA LOJA (22/11): as regras (a MESMA conta de CPF/CNPJ do banco, com os mesmos exemplos do
// `supabase/testes/cadastro.sql`), o formulário do balcão e a volta inteira na demonstração.
import { describe, expect, it, vi } from 'vitest'
import { documentoFormatado, documentoValido, linkDoWhatsapp, problemaDoPedido } from './estado'
import { blocoDoCadastro, rascunhoNovo } from './cadastro'
import { criarDemonstracao, type Armazem } from '../demonstracao/repositorio'

const texto = (n: Element) => (n.textContent ?? '').replace(/\s+/g, ' ')

describe('as regras do cadastro', () => {
  it('CPF e CNPJ com os dígitos verificadores (os mesmos exemplos do teste do banco)', () => {
    expect(documentoValido('529.982.247-25')).toBe(true)
    expect(documentoValido('52998224724')).toBe(false)
    expect(documentoValido('11111111111')).toBe(false)
    expect(documentoValido('11.222.333/0001-81')).toBe(true)
    expect(documentoValido('11222333000180')).toBe(false)
    expect(documentoValido('123')).toBe(false)
    expect(documentoFormatado('11222333000181')).toBe('11.222.333/0001-81')
    expect(linkDoWhatsapp('(31) 98888-7777')).toBe('https://wa.me/5531988887777')
  })

  it('as mesmas recusas do banco, em palavras de gente', () => {
    const ok = { nome: 'Ótica Nova', documento: '52998224725', whatsapp: '31988887777', cidade: 'Lagoa Santa', uf: 'MG', troco: 10, desconto: 5 }
    expect(problemaDoPedido(ok)).toBeNull()
    expect(problemaDoPedido({ ...ok, documento: '52998224724' })).toMatch(/CPF ou o CNPJ/)
    expect(problemaDoPedido({ ...ok, whatsapp: '8888' })).toMatch(/DDD/)
    expect(problemaDoPedido({ ...ok, troco: 60, desconto: 50 })).toMatch(/passam de 100%/)
    expect(problemaDoPedido({ ...ok, uf: '' })).toMatch(/UF/)
  })
})

describe('o formulário "Quero ser loja Troco Prime"', () => {
  function preencher(f: HTMLElement, valores: string[]) {
    const inputs = [...f.querySelectorAll('input')]
    valores.forEach((v, i) => {
      inputs[i].value = v
      inputs[i].dispatchEvent(new Event('input'))
    })
  }

  it('🔴 CPF errado não sai da tela: diz o problema e não manda', () => {
    const enviou = vi.fn()
    const rascunho = rascunhoNovo()
    const f = blocoDoCadastro({ pedido: null, rascunho, ocupado: false }, enviou, () => {})
    preencher(f, ['Ótica Nova', '52998224724', '31988887777', 'Lagoa Santa', 'MG', '10', '0'])
    f.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(enviou).not.toHaveBeenCalled()
    expect(texto(f)).toContain('Confira o CPF ou o CNPJ')
  })

  it('certo, manda os dados limpos; e o que foi digitado fica no rascunho (sobrevive à repintura)', () => {
    const enviou = vi.fn()
    const rascunho = rascunhoNovo()
    const f = blocoDoCadastro({ pedido: null, rascunho, ocupado: false }, enviou, () => {})
    preencher(f, ['Ótica Nova', '529.982.247-25', '(31) 98888-7777', 'Lagoa Santa', 'mg', '10', '5'])
    expect(rascunho.nome).toBe('Ótica Nova')
    f.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(enviou).toHaveBeenCalledWith({ nome: 'Ótica Nova', documento: '529.982.247-25', whatsapp: '(31) 98888-7777', cidade: 'Lagoa Santa', uf: 'MG', troco: 10, desconto: 5 })
  })

  it('pedido aberto: "Pedido enviado" e "Corrigir"; recusado: o motivo e o formulário de novo', () => {
    const aberto = blocoDoCadastro(
      { pedido: { id: 'p', nome: 'Ótica Nova', situacao: 'pedido', motivo: null, criado_em: '', decidido_em: null }, rascunho: rascunhoNovo(), ocupado: false },
      () => {}, () => {},
    )
    expect(texto(aberto)).toContain('Pedido enviado')
    expect(aberto.querySelector('form')).toBeNull()
    const recusado = blocoDoCadastro(
      { pedido: { id: 'p', nome: 'Ótica Nova', situacao: 'recusado', motivo: 'Faltou o CNPJ', criado_em: '', decidido_em: null }, rascunho: rascunhoNovo(), ocupado: false },
      () => {}, () => {},
    )
    expect(texto(recusado)).toContain('não foi aprovado: Faltou o CNPJ')
    expect(recusado.querySelector('form')).not.toBeNull()
  })
})

describe('a volta inteira na demonstração (o /beta)', () => {
  function armazem(): Armazem {
    const m = new Map<string, string>()
    return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) }
  }

  it('a Sorveteria Nova pede, o administrador aprova, e o balcão dela abre sem crédito (pronto para a recarga)', async () => {
    const a = armazem()
    const nova = criarDemonstracao('loja', a)
    const admin = criarDemonstracao('admin', a)
    await nova.entrarComo('nova@trocoprime.teste')
    await admin.entrarComo('admin@trocoprime.teste')
    expect(await nova.lerMinhaLoja()).toBeNull()

    await expect(nova.pedirParaSerLoja({ nome: 'Sorveteria Nova', documento: '52998224724', whatsapp: '31988887777', cidade: 'Lagoa Santa', uf: 'MG', troco: 10, desconto: 0 })).rejects.toThrow('documento_invalido')
    await nova.pedirParaSerLoja({ nome: 'Sorveteria Nova', documento: '52998224725', whatsapp: '31988887777', cidade: 'Lagoa Santa', uf: 'MG', troco: 10, desconto: 0 })
    expect((await nova.meuPedidoDeLoja())?.situacao).toBe('pedido')

    const [p] = await admin.lerPedidosDeLoja()
    await expect(nova.aprovarLoja(p.id, 'troco')).rejects.toThrow('so_admin')
    await admin.aprovarLoja(p.id, 'troco')
    expect((await nova.meuPedidoDeLoja())?.situacao).toBe('aprovado')
    const loja = await nova.lerMinhaLoja()
    expect(loja).toMatchObject({ nome: 'Sorveteria Nova', cashback_percentual: 10, credito: 0 })
    await expect(nova.pedirParaSerLoja({ nome: 'X', documento: '52998224725', whatsapp: '31988887777', cidade: 'BH', uf: 'MG', troco: 10, desconto: 0 })).rejects.toThrow('ja_e_lojista')
    await expect(admin.aprovarLoja(p.id, 'troco')).rejects.toThrow('pedido_de_loja_nao_encontrado')
  })
})
