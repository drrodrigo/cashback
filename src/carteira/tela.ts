// ---------------------------------------------------------------------------
// A TELA DA CARTEIRA. DOM na mão, sem framework.
//
// Desenha um dos cinco estados decididos em `estado.ts`. Não fala com a rede: as
// ações chegam como funções (`acoes`), e é isso que deixa a trava montar a tela
// de verdade e LER o que aparece -- a lição de 01/10, em que eu consertei a loja
// de temas quatro vezes lendo o componente, quando o defeito era a tela abrir sem
// nenhum botão.
// ---------------------------------------------------------------------------

import { MARCA } from '../marca'
import {
  dataCurta,
  filtrarLojas,
  fraseDoCiclo,
  progressoDoCiclo,
  qualTela,
  type Carteira,
  type Lancamento,
  type LojaDaRede,
} from './estado'

export interface Acoes {
  entrar(email: string, senha: string): Promise<void>
  ativar(): Promise<void>
  transferir(valor: number): Promise<void>
  sair(): Promise<void>
}

export interface Dados {
  /** Publicado sem `VITE_SUPABASE_URL`/`ANON_KEY`. Ver `dados.ts`. */
  faltaConfigurar?: boolean
  logado: boolean
  carteira: Carteira | null
  lojas: LojaDaRede[]
  extrato: Lancamento[]
  /** Mensagem de erro para mostrar, se a última ação falhou. */
  erro: string | null
  ocupado: boolean
}

/** Para onde o botão "voltar ao Clube" leva. Um lugar só, e é o de verdade. */
export const VOLTAR_AO_CLUBE = '/carteirinha'

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { classe?: string; texto?: string; html?: string } = {},
  filhos: (Node | null)[] = [],
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag)
  if (props.classe) n.className = props.classe
  if (props.texto !== undefined) n.textContent = props.texto
  if (props.html !== undefined) n.innerHTML = props.html
  for (const f of filhos) if (f) n.appendChild(f)
  return n
}

function cabecalho(): HTMLElement {
  const h = el('header', { classe: 'ca-topo' })
  h.appendChild(el('h1', { texto: MARCA.nome }))
  h.appendChild(el('p', { classe: 'ca-tagline', texto: MARCA.tagline }))
  const voltar = el('a', { classe: 'ca-voltar', texto: '← Voltar ao Clube' })
  voltar.setAttribute('href', VOLTAR_AO_CLUBE)
  h.appendChild(voltar)
  return h
}

function aviso(texto: string): HTMLElement {
  const p = el('p', { classe: 'ca-erro', texto })
  p.setAttribute('role', 'alert')
  return p
}

// --- os cinco estados ---------------------------------------------------------

/**
 * 🔴 PUBLICADO SEM AS VARIÁVEIS. A tela mais importante de todas, porque é a
 * única que aparece quando NADA funciona -- e tela branca não diz nada a
 * ninguém.
 *
 * E a frase tem que mandar PUBLICAR DE NOVO, não só preencher: medido em 05/10,
 * o pacote construído sem as variáveis tem **9,66 kB**; com elas, **218,60 kB**.
 * A diferença é a biblioteca do Supabase inteira, que o empacotador ELIMINA
 * porque o ramo que a usa fica inalcançável. Não falta só o dado -- falta o
 * código. Preencher a variável no painel e não publicar de novo deixa no ar um
 * pacote que nunca vai conectar.
 */
function telaFaltaConfigurar(): HTMLElement {
  const s = el('section', { classe: 'ca-cartao' })
  s.appendChild(el('h2', { texto: 'Falta configuração' }))
  s.appendChild(
    el('p', {
      texto:
        'Este endereço foi publicado sem as variáveis do banco (VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY).',
    }),
  )
  s.appendChild(
    el('p', {
      classe: 'ca-dica',
      texto:
        'Variável VITE_ só entra no pacote durante o build: depois de preencher no painel, é preciso publicar de novo.',
    }),
  )
  return s
}

function telaEntrar(acoes: Acoes, d: Dados): HTMLElement {
  const s = el('section', { classe: 'ca-cartao' })
  s.appendChild(el('h2', { texto: 'Entrar' }))
  // A CONTA É A MESMA DO CLUBE, e dizer isso evita a pessoa criar uma segunda.
  // Medido em 05/10: existe uma `auth.users` só, com 5.083 contas (spec §17).
  s.appendChild(
    el('p', {
      classe: 'ca-dica',
      texto: 'Use o mesmo e-mail e a mesma senha do Clube Prime. É a mesma conta.',
    }),
  )

  const form = el('form', { classe: 'ca-form' })
  const email = el('input')
  email.type = 'email'
  email.required = true
  email.placeholder = 'seu@email.com'
  email.setAttribute('aria-label', 'E-mail')
  const senha = el('input')
  senha.type = 'password'
  senha.required = true
  senha.placeholder = 'sua senha'
  senha.setAttribute('aria-label', 'Senha')
  const botao = el('button', { classe: 'ca-botao', texto: d.ocupado ? 'Entrando…' : 'Entrar' })
  botao.type = 'submit'
  botao.disabled = d.ocupado

  form.append(email, senha, botao)
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    void acoes.entrar(email.value, senha.value)
  })
  s.appendChild(form)
  if (d.erro) s.appendChild(aviso(d.erro))
  return s
}

function telaForaDoClube(): HTMLElement {
  const s = el('section', { classe: 'ca-cartao' })
  s.appendChild(el('h2', { texto: 'O cashback é do Clube Prime' }))
  // NÃO desenha o botão de ativar: ele existiria só para falhar. É a porta
  // pintada na parede de 21/09 -- botão com rótulo, na posição certa, que não
  // leva a nada. Aqui a resposta útil é o caminho de entrar no Clube.
  s.appendChild(
    el('p', {
      texto:
        'Esta conta ainda não é membro do Clube Prime, e a conta corrente de cash é do membro. Entre no Clube e volte aqui.',
    }),
  )
  const link = el('a', { classe: 'ca-botao', texto: 'Entrar no Clube Prime' })
  link.setAttribute('href', VOLTAR_AO_CLUBE)
  s.appendChild(link)
  return s
}

function telaAtivar(acoes: Acoes, d: Dados): HTMLElement {
  const s = el('section', { classe: 'ca-cartao' })
  s.appendChild(el('h2', { texto: 'Ativar meu cashback' }))
  s.appendChild(
    el('p', {
      texto:
        'Sua conta corrente de cash começa com saldo zero. A cada compra numa loja da rede, o valor do desconto entra aqui em vez de sair do preço.',
    }),
  )
  s.appendChild(
    el('p', {
      classe: 'ca-dica',
      texto: 'Seus dados já estão cadastrados no Clube — não precisa preencher nada.',
    }),
  )
  const botao = el('button', {
    classe: 'ca-botao',
    texto: d.ocupado ? 'Ativando…' : 'Ativar cashback',
  })
  botao.type = 'button'
  botao.disabled = d.ocupado
  botao.addEventListener('click', () => void acoes.ativar())
  s.appendChild(botao)
  if (d.erro) s.appendChild(aviso(d.erro))
  return s
}

function blocoDoCiclo(c: Carteira, acoes: Acoes, d: Dados): HTMLElement {
  const s = el('section', { classe: 'ca-cartao' })
  s.appendChild(el('h2', { texto: 'Meu saldo' }))

  const juntado = el('p', { classe: 'ca-numerao', texto: MARCA.valor(c.acumulado) })
  juntado.setAttribute('aria-label', `Juntado: ${MARCA.valor(c.acumulado)}`)
  s.appendChild(juntado)
  s.appendChild(el('p', { classe: 'ca-rotulo', texto: 'juntado' }))

  // A META, em frase e em barra. É o motor do produto.
  s.appendChild(el('p', { classe: 'ca-ciclo', texto: fraseDoCiclo(c, MARCA.valor) }))
  const barra = el('div', { classe: 'ca-barra' })
  const dentro = el('div', { classe: 'ca-barra-dentro' })
  dentro.style.width = `${progressoDoCiclo(c)}%`
  barra.appendChild(dentro)
  barra.setAttribute('role', 'progressbar')
  barra.setAttribute('aria-valuenow', String(progressoDoCiclo(c)))
  barra.setAttribute('aria-valuemin', '0')
  barra.setAttribute('aria-valuemax', '100')
  s.appendChild(barra)

  if (c.pode_descer) {
    const form = el('form', { classe: 'ca-form' })
    const valor = el('input')
    valor.type = 'number'
    valor.min = String(c.minimo_para_transferir)
    valor.max = String(c.pode_transferir_ate)
    valor.step = '0.01'
    valor.value = String(c.pode_transferir_ate)
    valor.setAttribute('aria-label', 'Quanto transferir')
    // A TELA DIZ O MÍNIMO, não espera o erro. Campo que aceita 10 e depois
    // recusa faz a pessoa se perguntar por que ele aceitou.
    form.appendChild(
      el('p', {
        classe: 'ca-dica',
        texto: `Mínimo de ${MARCA.valor(c.minimo_para_transferir)} por transferência. Depois de transferir, você começa a juntar de novo.`,
      }),
    )
    const botao = el('button', {
      classe: 'ca-botao',
      texto: d.ocupado ? 'Transferindo…' : 'Transferir para gastar',
    })
    botao.type = 'submit'
    botao.disabled = d.ocupado
    form.append(valor, botao)
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      void acoes.transferir(Number(valor.value))
    })
    s.appendChild(form)
  }

  if (d.erro) s.appendChild(aviso(d.erro))
  return s
}

function blocoDoDisponivel(c: Carteira): HTMLElement | null {
  if (c.disponivel <= 0) return null
  const s = el('section', { classe: 'ca-cartao ca-destaque' })
  s.appendChild(el('h2', { texto: 'Pronto para gastar' }))
  s.appendChild(el('p', { classe: 'ca-numerao', texto: MARCA.valor(c.disponivel) }))
  const dia = dataCurta(c.vence_em)
  // O PRAZO EM LETRA GRANDE, porque é ele que traz a pessoa de volta. Prazo que
  // ela não vê não apressa ninguém.
  s.appendChild(
    el('p', {
      classe: 'ca-prazo',
      texto: dia ? `Use até ${dia} — depois desta data o saldo não volta.` : 'Use nas lojas da rede.',
    }),
  )
  s.appendChild(
    el('p', {
      classe: 'ca-dica',
      texto: 'Na loja, mostre o QR da sua carteirinha do Clube. Vale em qualquer loja da rede.',
    }),
  )
  return s
}

function blocoDasLojas(lojas: LojaDaRede[]): HTMLElement {
  const s = el('section', { classe: 'ca-cartao' })
  s.appendChild(el('h2', { texto: 'Onde ganhar cashback' }))

  const busca = el('input')
  busca.type = 'text'
  busca.placeholder = 'Buscar por loja ou cidade'
  busca.setAttribute('aria-label', 'Buscar loja ou cidade')
  s.appendChild(busca)

  const lista = el('ul', { classe: 'ca-lojas' })
  const desenhar = (termo: string) => {
    lista.replaceChildren()
    const achadas = filtrarLojas(lojas, termo)
    if (achadas.length === 0) {
      lista.appendChild(el('li', { classe: 'ca-dica', texto: 'Nenhuma loja com esse nome ou cidade.' }))
      return
    }
    for (const l of achadas) {
      const onde = [l.cidade, l.uf].filter(Boolean).join(' - ')
      const li = el('li', {}, [
        el('strong', { texto: l.nome }),
        el('span', { classe: 'ca-pct', texto: `${l.cashback_percentual}% de volta` }),
        onde ? el('span', { classe: 'ca-dica', texto: onde }) : null,
      ])
      lista.appendChild(li)
    }
  }
  desenhar('')
  busca.addEventListener('input', () => desenhar(busca.value))
  s.appendChild(lista)
  return s
}

function blocoDoExtrato(extrato: Lancamento[]): HTMLElement {
  const s = el('section', { classe: 'ca-cartao' })
  s.appendChild(el('h2', { texto: 'Meus lançamentos' }))
  if (extrato.length === 0) {
    s.appendChild(
      el('p', { classe: 'ca-dica', texto: 'Nada por aqui ainda. Sua primeira compra na rede aparece nesta lista.' }),
    )
    return s
  }
  const lista = el('ul', { classe: 'ca-extrato' })
  for (const l of extrato) {
    lista.appendChild(
      el('li', {}, [
        el('span', { classe: 'ca-valor', texto: MARCA.valor(l.valor) }),
        el('span', { texto: l.descricao }),
      ]),
    )
  }
  s.appendChild(lista)
  return s
}

/** Monta a tela inteira dentro do container. Chamar de novo redesenha. */
export function desenhar(onde: HTMLElement, d: Dados, acoes: Acoes): void {
  const tela = qualTela({ logado: d.logado, faltaConfigurar: d.faltaConfigurar }, d.carteira)
  onde.replaceChildren()
  onde.appendChild(cabecalho())

  if (tela.qual === 'falta-configurar') {
    onde.appendChild(telaFaltaConfigurar())
    return
  }
  if (tela.qual === 'carregando') {
    onde.appendChild(el('p', { classe: 'ca-dica', texto: 'Carregando…' }))
    return
  }
  if (tela.qual === 'entrar') {
    onde.appendChild(telaEntrar(acoes, d))
    return
  }
  if (tela.qual === 'fora-do-clube') {
    onde.appendChild(telaForaDoClube())
    return
  }
  if (tela.qual === 'ativar') {
    onde.appendChild(telaAtivar(acoes, d))
    onde.appendChild(blocoDasLojas(d.lojas))
    return
  }

  const c = tela.carteira
  onde.appendChild(blocoDoCiclo(c, acoes, d))
  const disponivel = blocoDoDisponivel(c)
  if (disponivel) onde.appendChild(disponivel)
  onde.appendChild(blocoDasLojas(d.lojas))
  onde.appendChild(blocoDoExtrato(d.extrato))

  const sair = el('button', { classe: 'ca-sair', texto: 'Sair' })
  sair.type = 'button'
  sair.addEventListener('click', () => void acoes.sair())
  onde.appendChild(sair)
}
