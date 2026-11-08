// @vitest-environment jsdom
//
// ---------------------------------------------------------------------------
// O QUE ELA VÊ. A trava que faltou na loja de temas.
//
// Em 01/10 eu entreguei quatro consertos seguidos para "a secretária não
// consegue aplicar tema", todos raciocinados LENDO o componente. Na quinta vez
// montei a página com os dados reais e imprimi o que aparecia: a tela abria com
// ZERO botão de tema. Era isso o tempo todo. As onze travas que eu havia escrito
// liam o ARQUIVO; nenhuma montava a tela.
//
// Então esta monta. Cinco estados, texto e botões lidos de verdade -- sem rede,
// sem banco, sem servidor de pé (trava que precisa de ambiente é trava que
// ninguém roda, lição de 29/09).
// ---------------------------------------------------------------------------

import { describe, expect, it, vi } from 'vitest'
import { desenhar, VOLTAR_AO_CLUBE, type Acoes, type Dados } from './tela'
import type { Carteira } from './estado'

const ACOES: Acoes = {
  entrar: vi.fn(async () => {}),
  ativar: vi.fn(async () => {}),
  transferir: vi.fn(async () => {}),
  sair: vi.fn(async () => {}),
}

function carteira(mudanças: Partial<Carteira> = {}): Carteira {
  return {
    cliente_id: 'c1',
    nome: 'Ana',
    e_do_clube: true,
    aderiu: true,
    acumulado: 0,
    disponivel: 0,
    vence_em: null,
    gatilho: 30,
    falta_para_liberar: 30,
    pode_descer: false,
    minimo_para_transferir: 30,
    pode_transferir_ate: 0,
    ...mudanças,
  }
}

function montar(d: Partial<Dados> = {}): HTMLElement {
  const onde = document.createElement('div')
  desenhar(
    onde,
    { logado: true, carteira: carteira(), lojas: [], extrato: [], erro: null, ocupado: false, ...d },
    ACOES,
  )
  return onde
}

/** O que a pessoa LÊ na tela, numa string só. */
const texto = (e: HTMLElement) => (e.textContent ?? '').replace(/\s+/g, ' ')
/** Os botões e links clicáveis, pelo rótulo. */
const botoes = (e: HTMLElement) =>
  [...e.querySelectorAll('button, a')].map((b) => (b.textContent ?? '').trim())

describe('quem não entrou', () => {
  it('vê a porta de entrar, e a tela DIZ que a conta é a mesma do Clube', () => {
    const t = montar({ logado: false, carteira: null })
    expect(texto(t)).toContain('mesmo e-mail e a mesma senha do Clube')
    expect(t.querySelector('input[type="email"]')).not.toBeNull()
    expect(t.querySelector('input[type="password"]')).not.toBeNull()
  })

  it('NÃO vê o botão de ativar antes de entrar', () => {
    // Botão que pede login para funcionar é meia porta: a pessoa toca e toma erro.
    expect(botoes(montar({ logado: false, carteira: null }))).not.toContain('Ativar cashback')
  })
})

describe('🔴 quem está logado mas não é do Clube', () => {
  it('NÃO vê o botão "Ativar cashback" -- ele existiria só para falhar', () => {
    // É a PORTA PINTADA NA PAREDE de 21/09: botão com rótulo, na posição certa,
    // que não leva a nada. Para estas contas (medido: ~1.180 das 5.083), ativar
    // levanta `precisa_ser_do_clube`.
    const t = montar({ carteira: carteira({ e_do_clube: false, aderiu: false }) })
    expect(botoes(t)).not.toContain('Ativar cashback')
  })

  it('vê o caminho de entrar no Clube, que é a resposta útil', () => {
    const t = montar({ carteira: carteira({ e_do_clube: false, aderiu: false }) })
    expect(botoes(t)).toContain('Entrar no Clube Prime')
    expect(texto(t)).toContain('não é membro do Clube Prime')
  })
})

describe('quem é do Clube e ainda não ativou', () => {
  it('vê o botão de ativar e a promessa certa: saldo zero, dados já cadastrados', () => {
    const t = montar({ carteira: carteira({ aderiu: false }) })
    expect(botoes(t)).toContain('Ativar cashback')
    expect(texto(t)).toContain('saldo zero')
    expect(texto(t)).toContain('não precisa preencher nada')
  })

  it('já vê onde vai ganhar, antes de ativar', () => {
    // Pedir para ativar sem dizer onde usar é pedir fé. A lista das lojas vem
    // antes do compromisso, de propósito.
    const t = montar({
      carteira: carteira({ aderiu: false }),
      lojas: [{ loja_id: 'l1', nome: 'Joalheria Sol', cashback_percentual: 10, cidade: 'Lagoa Santa', uf: 'MG', catalogo_slug: null, clube_parceiro_id: 'p1' }],
    })
    expect(texto(t)).toContain('Joalheria Sol')
    expect(texto(t)).toContain('10% de volta')
  })

  it('o botão chama a ação de ativar', () => {
    const t = montar({ carteira: carteira({ aderiu: false }) })
    const b = [...t.querySelectorAll('button')].find((x) => x.textContent === 'Ativar cashback')
    b!.click()
    expect(ACOES.ativar).toHaveBeenCalled()
  })
})

describe('🔴 o ciclo dos 30, que é o motor do produto', () => {
  it('com zero juntado, convida a juntar e NÃO oferece transferir', () => {
    const t = montar({ carteira: carteira({ acumulado: 0, falta_para_liberar: 30 }) })
    expect(texto(t)).toContain('Junte 30,00 cash')
    expect(botoes(t)).not.toContain('Transferir para gastar')
  })

  it('com 20 juntado, a tela DIZ que falta 10 -- a frase dele, inteira', () => {
    // *"quando ele estiver com 20, ele fala: falta só 10, vou gastar na loja que
    // tem cashback para ganhar mais 10 e poder gastar 30"*. Meta que a pessoa não
    // vê não apressa ninguém. Este caso tem CONFLITO: 20 não é 0 nem 30, então
    // ele distingue o cálculo de um número fixo.
    const t = montar({ carteira: carteira({ acumulado: 20, falta_para_liberar: 10 }) })
    expect(texto(t)).toContain('Falta 10,00 cash')
    expect(botoes(t)).not.toContain('Transferir para gastar')
  })

  it('com 40 juntado, oferece transferir e DIZ o mínimo antes do toque', () => {
    const t = montar({
      carteira: carteira({ acumulado: 40, falta_para_liberar: 0, pode_descer: true, pode_transferir_ate: 40 }),
    })
    expect(botoes(t)).toContain('Transferir para gastar')
    expect(texto(t)).toContain('Mínimo de 30,00 cash')
    const campo = t.querySelector('input[type="number"]') as HTMLInputElement
    expect(campo.min).toBe('30')
    expect(campo.max).toBe('40')
  })

  it('e avisa que depois de transferir começa a juntar de novo', () => {
    const t = montar({
      carteira: carteira({ acumulado: 40, pode_descer: true, pode_transferir_ate: 40 }),
    })
    expect(texto(t)).toContain('começa a juntar de novo')
  })

  it('a barra do ciclo não transborda quando ela junta mais que o gatilho', () => {
    // Juntar não tem teto -- *"ele pode juntar 80, 100 reais"*.
    const t = montar({
      carteira: carteira({ acumulado: 100, pode_descer: true, pode_transferir_ate: 100 }),
    })
    const barra = t.querySelector('[role="progressbar"]')!
    expect(barra.getAttribute('aria-valuenow')).toBe('100')
  })
})

describe('🔴 o prazo do que já está liberado', () => {
  it('aparece com a data e diz que o saldo não volta', () => {
    // O prazo é o que traz a pessoa de volta à loja. Escondê-lo seria a meia
    // porta mais cara deste produto: ela perde saldo sem ter sido avisada.
    const t = montar({ carteira: carteira({ disponivel: 40, vence_em: '2026-11-20' }) })
    expect(texto(t)).toContain('Use até 20/11')
    expect(texto(t)).toContain('não volta')
  })

  it('diz que vale em qualquer loja da rede, que é a promessa dele', () => {
    // *"você pode gastar aqui, OU pode gastar em outra loja parceira nossa."*
    const t = montar({ carteira: carteira({ disponivel: 40, vence_em: '2026-11-20' }) })
    expect(texto(t)).toContain('qualquer loja da rede')
  })

  it('não desenha o bloco quando não há nada liberado', () => {
    expect(texto(montar())).not.toContain('Pronto para gastar')
  })
})

describe('onde ganhar, e a busca', () => {
  const LOJAS = [
    { loja_id: 'l1', nome: 'Joalheria Sol', cashback_percentual: 10, cidade: 'Lagoa Santa', uf: 'MG', catalogo_slug: null, clube_parceiro_id: 'p1' },
    { loja_id: 'l2', nome: 'Pet Amigo', cashback_percentual: 5, cidade: 'Belo Horizonte', uf: 'MG', catalogo_slug: null, clube_parceiro_id: 'p2' },
  ]

  it('mostra as lojas com o percentual e a cidade', () => {
    const t = montar({ lojas: LOJAS })
    expect(texto(t)).toContain('Joalheria Sol')
    expect(texto(t)).toContain('Lagoa Santa - MG')
  })

  it('a busca filtra por nome E por cidade, sem diferenciar maiúscula', () => {
    const t = montar({ lojas: LOJAS })
    const busca = t.querySelector('input[type="text"]') as HTMLInputElement
    busca.value = 'LAGOA'
    busca.dispatchEvent(new Event('input'))
    expect(texto(t)).toContain('Joalheria Sol')
    expect(texto(t)).not.toContain('Pet Amigo')
  })

  // 🔴 ELE DITA POR VOZ, e o aplicativo transcreve "sao joao" tanto quanto
  // "São João". O banco (`cash_lojas_da_rede`) já ignora o acento; se este
  // filtro não ignorar, a loja volta do banco e o navegador a tira da lista --
  // a lista PULA na mão dela, e a conclusão é que a loja não está na rede.
  it('a busca ignora o acento, nos dois lados: "sao joao" acha "São João"', () => {
    const t = montar({
      lojas: [
        { ...LOJAS[0], cidade: 'São João del Rei' },
        { ...LOJAS[1], nome: 'José Pneus', cidade: 'Ipatinga' },
      ],
    })
    const busca = t.querySelector('input[type="text"]') as HTMLInputElement

    busca.value = 'sao joao'
    busca.dispatchEvent(new Event('input'))
    expect(texto(t)).toContain('Joalheria Sol')
    expect(texto(t)).not.toContain('José Pneus')

    // E o contrário: com acento digitado, achando o que está sem.
    busca.value = 'josé'
    busca.dispatchEvent(new Event('input'))
    expect(texto(t)).toContain('José Pneus')
    expect(texto(t)).not.toContain('Joalheria Sol')
  })

  it('busca sem resultado diz isso, em vez de ficar em branco', () => {
    const t = montar({ lojas: LOJAS })
    const busca = t.querySelector('input[type="text"]') as HTMLInputElement
    busca.value = 'xyz'
    busca.dispatchEvent(new Event('input'))
    expect(texto(t)).toContain('Nenhuma loja com esse nome ou cidade')
  })
})

describe('o extrato', () => {
  it('vazio diz o que fazer, em vez de ficar em branco', () => {
    expect(texto(montar())).toContain('primeira compra na rede aparece nesta lista')
  })

  it('mostra o lançamento com valor e descrição', () => {
    const t = montar({
      extrato: [{ em: '2026-10-05', tipo: 'cashback', valor: 20, valor_compra: 200, descricao: 'Joalheria Sol: compra de R$ 200,00' }],
    })
    expect(texto(t)).toContain('20,00 cash')
    expect(texto(t)).toContain('Joalheria Sol')
  })
})

describe('a volta para o Clube', () => {
  it('existe em TODOS os estados -- quem entra por um módulo precisa saber voltar', () => {
    const estados: Partial<Dados>[] = [
      { logado: false, carteira: null },
      { carteira: carteira({ e_do_clube: false, aderiu: false }) },
      { carteira: carteira({ aderiu: false }) },
      { carteira: carteira() },
      { carteira: carteira({ acumulado: 40, pode_descer: true, pode_transferir_ate: 40, disponivel: 10, vence_em: '2026-11-20' }) },
    ]
    for (const e of estados) {
      const t = montar(e)
      const voltar = [...t.querySelectorAll('a')].find((a) => a.getAttribute('href') === VOLTAR_AO_CLUBE)
      expect(voltar, `o estado ${JSON.stringify(e).slice(0, 60)} ficou sem a volta`).not.toBeUndefined()
    }
  })
})

describe('o erro da última ação aparece', () => {
  it('em letra de alerta, e não engolido', () => {
    // Erro engolido é a classe de defeito mais caro deste projeto: a tela fica
    // igual e a pessoa não sabe se funcionou.
    const t = montar({ carteira: carteira({ aderiu: false }), erro: 'Não foi possível ativar agora.' })
    expect(texto(t)).toContain('Não foi possível ativar agora.')
    expect(t.querySelector('[role="alert"]')).not.toBeNull()
  })
})

describe('🔴 publicado sem as variáveis do banco', () => {
  it('a tela DIZ isso, em vez de abrir branca ou pedir senha', () => {
    // Sem as variáveis, toda a lógica abaixo diria "não logado" -- e mandaria a
    // pessoa digitar senha numa tela que nunca vai conseguir entrar.
    const t = montar({ faltaConfigurar: true, logado: false, carteira: null })
    expect(texto(t)).toContain('Falta configuração')
    expect(t.querySelector('input[type="password"]')).toBeNull()
  })

  it('manda PUBLICAR DE NOVO, não só preencher a variável', () => {
    // Medido em 05/10: o pacote construído sem as variáveis tem 9,66 kB; com
    // elas, 218,60 kB. A diferença é a biblioteca do Supabase, que o empacotador
    // ELIMINA porque o ramo que a usa fica inalcançável. Não falta só o dado --
    // falta o código. Preencher no painel sem publicar de novo não resolve.
    const t = montar({ faltaConfigurar: true, logado: false, carteira: null })
    expect(texto(t)).toContain('publicar de novo')
  })
})
