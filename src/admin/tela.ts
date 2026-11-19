// ---------------------------------------------------------------------------
// A TELA DO ADMINISTRADOR. DOM na mão, sem framework, igual à da carteira e à do balcão.
//
// Não fala com a rede: as ações chegam como funções, e é isso que deixa a trava montar a tela de verdade e LER o que
// aparece.
//
// 🔴 O DEPÓSITO NUNCA É UM CLIQUE SÓ. Registrar depósito cria troco de verdade (é o lastro do que a loja dá), então
// o primeiro botão só PREPARA, e a tela pede a confirmação com o valor e o nome da loja escritos por extenso. Um
// toque errado no celular não pode virar R$ 3.000 de troco.
// ---------------------------------------------------------------------------

import { MARCA } from '../marca'
import {
  emPercentual,
  emReais,
  lerPercentual,
  lerValor,
  nomeDaOrigem,
  ondeFica,
  percentualSugerido,
  qualTelaDoAdmin,
  type Achado,
  type LojaAdmin,
  type Painel,
  type SaquePedido,
} from './estado'

export interface AcoesDoAdmin {
  entrar(email: string, senha: string): Promise<void>
  sair(): Promise<void>
  buscar(texto: string): Promise<void>
  vincular(origem: Achado['origem'], origemId: string, percentual: number): Promise<void>
  prepararDeposito(lojaId: string, valor: number): void
  confirmarDeposito(): Promise<void>
  cancelarDeposito(): void
  pagarSaque(id: string): Promise<void>
  recusarSaque(id: string): Promise<void>
  vencerAgora(): Promise<void>
}

export interface DepositoPendente {
  loja_id: string
  nome: string
  valor: number
}

export interface DadosDoAdmin {
  faltaConfigurar?: boolean
  logado: boolean
  naoEAdmin: boolean
  painel: Painel | null
  busca: string
  /** `null` = ainda não buscou nada (é diferente de "buscou e não achou"). */
  achados: Achado[] | null
  lojas: LojaAdmin[]
  saques: SaquePedido[]
  depositoPendente: DepositoPendente | null
  erro: string | null
  recado: string | null
  ocupado: boolean
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: { classe?: string; texto?: string } = {},
  filhos: (Node | null)[] = [],
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag)
  if (props.classe) n.className = props.classe
  if (props.texto !== undefined) n.textContent = props.texto
  for (const f of filhos) if (f) n.appendChild(f)
  return n
}

function botao(texto: string, classe = 'ca-botao'): HTMLButtonElement {
  const b = el('button', { classe, texto })
  b.type = 'button'
  return b
}

function aviso(texto: string, tipo: 'erro' | 'recado' = 'erro'): HTMLElement {
  const p = el('p', { classe: tipo === 'erro' ? 'ca-erro' : 'ca-recado', texto })
  p.setAttribute('role', tipo === 'erro' ? 'alert' : 'status')
  return p
}

function cabecalho(logado: boolean, acoes: AcoesDoAdmin): HTMLElement {
  const h = el('header', { classe: 'ca-topo' })
  h.appendChild(el('h1', { texto: `${MARCA.nome} — Administrador` }))
  h.appendChild(el('p', { classe: 'ca-tagline', texto: 'Lojistas, depósitos, saques e a conferência da rede.' }))
  if (logado) {
    const sair = botao('Sair', 'ca-link')
    sair.addEventListener('click', () => void acoes.sair())
    h.appendChild(sair)
  }
  return h
}

// --- as telas de antes do painel ------------------------------------------------

function telaFaltaConfigurar(): HTMLElement {
  const s = el('section', { classe: 'ca-cartao' })
  s.appendChild(el('h2', { texto: 'Falta configuração' }))
  s.appendChild(
    el('p', {
      texto: 'Este endereço foi publicado sem as variáveis do banco (VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY).',
    }),
  )
  s.appendChild(
    el('p', {
      classe: 'ca-dica',
      texto: 'Variável VITE_ só entra no pacote durante o build: depois de preencher no painel, é preciso publicar de novo.',
    }),
  )
  return s
}

function telaEntrar(acoes: AcoesDoAdmin, d: DadosDoAdmin): HTMLElement {
  const s = el('section', { classe: 'ca-cartao' })
  s.appendChild(el('h2', { texto: 'Entrar como administrador' }))
  s.appendChild(el('p', { classe: 'ca-dica', texto: 'Use o e-mail e a senha de administrador do Catálogo Online.' }))
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
  const entrar = el('button', { classe: 'ca-botao', texto: d.ocupado ? 'Entrando…' : 'Entrar' })
  entrar.type = 'submit'
  entrar.disabled = d.ocupado
  form.append(email, senha, entrar)
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    void acoes.entrar(email.value, senha.value)
  })
  s.appendChild(form)
  return s
}

function telaNaoEAdmin(): HTMLElement {
  const s = el('section', { classe: 'ca-cartao' })
  s.appendChild(el('h2', { texto: 'Esta conta não é de administrador' }))
  s.appendChild(
    el('p', { texto: 'Esta tela é só da administração do Troco Prime. Se você é lojista, o seu lugar é o balcão.' }),
  )
  const ir = el('a', { classe: 'ca-botao', texto: 'Abrir o balcão' })
  ir.setAttribute('href', './balcao.html')
  s.appendChild(ir)
  return s
}

// --- o painel -------------------------------------------------------------------

function numero(valor: string, rotulo: string): HTMLElement {
  return el('div', { classe: 'ca-numero' }, [el('strong', { texto: valor }), el('span', { texto: rotulo })])
}

function cartaoDaConferencia(p: Painel): HTMLElement {
  const s = el('section', { classe: 'ca-cartao' })
  s.appendChild(el('h2', { texto: 'A conta da rede' }))
  const selo = p.fecha
    ? el('p', { classe: 'ca-recado', texto: '✓ Bate: cada troco que existe tem um real guardado atrás.' })
    : el('p', {
        classe: 'ca-erro',
        texto: `✗ NÃO BATE: diferença de ${emReais(Math.abs(p.diferenca))}. Não pague saque até achar a causa.`,
      })
  selo.setAttribute('role', p.fecha ? 'status' : 'alert')
  s.appendChild(selo)
  s.appendChild(
    el('div', { classe: 'ca-numeros' }, [
      numero(MARCA.valor(p.cash_existente), 'troco que existe'),
      numero(emReais(p.dinheiro_em_custodia), 'dinheiro guardado'),
      numero(MARCA.valor(p.fundo_de_promocao), 'fundo de promoção'),
    ]),
  )
  s.appendChild(
    el('div', { classe: 'ca-numeros' }, [
      numero(String(p.lojas), p.lojas === 1 ? 'loja ativa' : 'lojas ativas'),
      numero(String(p.clientes), p.clientes === 1 ? 'cliente' : 'clientes'),
      numero(emReais(p.saques_a_pagar), 'saques a pagar'),
    ]),
  )
  return s
}

function linhaDoAchado(a: Achado, acoes: AcoesDoAdmin, d: DadosDoAdmin): HTMLElement {
  const li = el('li', { classe: 'ca-achado' })
  li.appendChild(el('strong', { texto: a.nome }))
  li.appendChild(
    el('span', {
      classe: 'ca-dica',
      texto: ` ${nomeDaOrigem(a.origem)} · ${ondeFica(a.cidade, a.uf)}${a.contato ? ` · ${a.contato}` : ''}`,
    }),
  )
  if (a.vinculada && a.cashback_percentual !== null) {
    li.appendChild(el('span', { classe: 'ca-etiqueta', texto: `já no ${MARCA.nome} · ${emPercentual(a.cashback_percentual)}` }))
  }

  const sugerido = percentualSugerido(a)
  const pct = el('input')
  pct.type = 'text'
  pct.inputMode = 'decimal'
  pct.value = String(sugerido).replace('.', ',')
  pct.setAttribute('aria-label', `Percentual de troco de ${a.nome}`)
  const ligar = botao('')
  const rotular = () => {
    const p = lerPercentual(pct.value)
    ligar.disabled = d.ocupado || p === null
    ligar.textContent =
      p === null ? 'Percentual inválido' : a.vinculada ? `Mudar para ${emPercentual(p)}` : `Vincular com ${emPercentual(p)}`
  }
  rotular()
  pct.addEventListener('input', rotular)
  ligar.addEventListener('click', () => {
    const p = lerPercentual(pct.value)
    if (p !== null) void acoes.vincular(a.origem, a.origem_id, p)
  })
  li.appendChild(el('div', { classe: 'ca-acao' }, [el('label', { classe: 'ca-campo' }, [el('span', { texto: '% de troco' }), pct]), ligar]))
  return li
}

function cartaoDaBusca(acoes: AcoesDoAdmin, d: DadosDoAdmin): HTMLElement {
  const s = el('section', { classe: 'ca-cartao' })
  s.appendChild(el('h2', { texto: 'Vincular lojista' }))
  s.appendChild(
    el('p', {
      classe: 'ca-dica',
      texto:
        'Digite o nome da loja. A busca olha no Catálogo Online e no QR Único, sem precisar de acento. Se a mesma loja aparecer nos dois, vincule só uma vez.',
    }),
  )
  const form = el('form', { classe: 'ca-form' })
  const busca = el('input')
  busca.type = 'search'
  busca.value = d.busca
  busca.placeholder = 'nome da loja'
  busca.setAttribute('aria-label', 'Nome da loja')
  const ir = el('button', { classe: 'ca-botao', texto: d.ocupado ? 'Buscando…' : 'Buscar' })
  ir.type = 'submit'
  ir.disabled = d.ocupado
  form.append(busca, ir)
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    void acoes.buscar(busca.value)
  })
  s.appendChild(form)

  if (d.achados !== null) {
    if (d.achados.length === 0) {
      s.appendChild(
        el('p', { classe: 'ca-dica', texto: `Nada com "${d.busca}". Use pelo menos 3 letras do nome, sem o "Ltda".` }),
      )
    } else {
      const lista = el('ul', { classe: 'ca-lista' })
      for (const a of d.achados) lista.appendChild(linhaDoAchado(a, acoes, d))
      s.appendChild(lista)
    }
  }
  return s
}

function cartaoDaConfirmacao(p: { loja_id: string; nome: string; valor: number }, acoes: AcoesDoAdmin, d: DadosDoAdmin): HTMLElement {
  const s = el('section', { classe: 'ca-cartao ca-confirmar' })
  s.setAttribute('role', 'alertdialog')
  s.appendChild(el('h2', { texto: 'Confirme o depósito' }))
  s.appendChild(
    el('p', {
      texto: `Entrou ${emReais(p.valor)} na conta da plataforma, pago por ${p.nome}? Isso cria ${MARCA.valor(p.valor)} para a loja dar aos clientes.`,
    }),
  )
  const sim = botao(d.ocupado ? 'Registrando…' : `Confirmo: entrou ${emReais(p.valor)}`)
  sim.disabled = d.ocupado
  sim.addEventListener('click', () => void acoes.confirmarDeposito())
  const nao = botao('Cancelar', 'ca-link')
  nao.addEventListener('click', () => acoes.cancelarDeposito())
  s.appendChild(el('div', { classe: 'ca-acao' }, [sim, nao]))
  return s
}

function linhaDaLoja(l: LojaAdmin, acoes: AcoesDoAdmin, d: DadosDoAdmin): HTMLElement {
  const li = el('li', { classe: 'ca-achado' })
  li.appendChild(el('strong', { texto: l.nome }))
  li.appendChild(
    el('span', {
      classe: 'ca-dica',
      texto: ` ${nomeDaOrigem(l.origem)} · ${ondeFica(l.cidade, l.uf)} · ${emPercentual(l.cashback_percentual)}${l.ativa ? '' : ' · desligada'}`,
    }),
  )
  li.appendChild(
    el('div', { classe: 'ca-numeros' }, [
      numero(emReais(l.credito), 'para dar de troco'),
      numero(emReais(l.recebido), 'recebido de clientes'),
      numero(emReais(l.saque_pedido), 'saque pedido'),
    ]),
  )
  const valor = el('input')
  valor.type = 'text'
  valor.inputMode = 'decimal'
  valor.placeholder = 'R$ 0,00'
  valor.setAttribute('aria-label', `Depósito de ${l.nome}`)
  const registrar = botao('Registrar depósito', 'ca-botao-fraco')
  const conferir = () => {
    const v = lerValor(valor.value)
    registrar.disabled = d.ocupado || v === null || v <= 0
  }
  conferir()
  valor.addEventListener('input', conferir)
  registrar.addEventListener('click', () => {
    const v = lerValor(valor.value)
    if (v !== null && v > 0) acoes.prepararDeposito(l.loja_id, v)
  })
  li.appendChild(el('div', { classe: 'ca-acao' }, [el('label', { classe: 'ca-campo' }, [el('span', { texto: 'Depósito recebido' }), valor]), registrar]))
  return li
}

function cartaoDasLojas(acoes: AcoesDoAdmin, d: DadosDoAdmin): HTMLElement {
  const s = el('section', { classe: 'ca-cartao' })
  s.appendChild(el('h2', { texto: `Lojas do ${MARCA.nome}` }))
  if (d.lojas.length === 0) {
    s.appendChild(el('p', { classe: 'ca-dica', texto: 'Nenhuma loja vinculada ainda. Comece buscando o lojista acima.' }))
    return s
  }
  s.appendChild(
    el('p', {
      classe: 'ca-dica',
      texto: 'A loja só dá troco depois de depositar: cada troco que ela dá sai do que ela pôs. Registre o depósito quando o dinheiro cair na conta.',
    }),
  )
  const lista = el('ul', { classe: 'ca-lista' })
  for (const l of d.lojas) lista.appendChild(linhaDaLoja(l, acoes, d))
  s.appendChild(lista)
  return s
}

function cartaoDosSaques(acoes: AcoesDoAdmin, d: DadosDoAdmin): HTMLElement {
  const s = el('section', { classe: 'ca-cartao' })
  s.appendChild(el('h2', { texto: 'Saques pedidos' }))
  const abertos = d.saques.filter((x) => x.situacao === 'pedido')
  if (abertos.length === 0) {
    s.appendChild(el('p', { classe: 'ca-dica', texto: 'Nenhum saque esperando pagamento.' }))
    return s
  }
  s.appendChild(
    el('p', { classe: 'ca-dica', texto: 'Pague pelo Pix primeiro; depois marque aqui. A taxa do saque vai para o fundo.' }),
  )
  const lista = el('ul', { classe: 'ca-lista' })
  for (const x of abertos) {
    const pagar = botao(`Marcar pago: ${emReais(x.valor)}`)
    pagar.disabled = d.ocupado
    pagar.addEventListener('click', () => void acoes.pagarSaque(x.id))
    const recusar = botao('Recusar', 'ca-link')
    recusar.disabled = d.ocupado
    recusar.addEventListener('click', () => void acoes.recusarSaque(x.id))
    lista.appendChild(el('li', { classe: 'ca-achado' }, [el('strong', { texto: x.loja_nome }), el('div', { classe: 'ca-acao' }, [pagar, recusar])]))
  }
  s.appendChild(lista)
  return s
}

function cartaoDoVencimento(acoes: AcoesDoAdmin, d: DadosDoAdmin): HTMLElement {
  const s = el('section', { classe: 'ca-cartao' })
  s.appendChild(el('h2', { texto: 'Vencimento' }))
  s.appendChild(
    el('p', {
      classe: 'ca-dica',
      texto: `O ${MARCA.moeda} que passou do prazo vence sozinho todo dia, de madrugada, e vai para o fundo de promoção. Este botão só adianta a rodada de hoje.`,
    }),
  )
  const vencer = botao('Vencer agora', 'ca-botao-fraco')
  vencer.disabled = d.ocupado
  vencer.addEventListener('click', () => void acoes.vencerAgora())
  s.appendChild(vencer)
  return s
}

/** Desenha a tela do administrador inteira dentro de `onde`. */
export function desenharAdmin(onde: HTMLElement, d: DadosDoAdmin, acoes: AcoesDoAdmin): void {
  onde.textContent = ''
  const tela = qualTelaDoAdmin({ logado: d.logado, faltaConfigurar: d.faltaConfigurar }, d.painel, d.naoEAdmin)

  onde.appendChild(cabecalho(d.logado && tela.qual !== 'falta-configurar', acoes))
  if (d.erro) onde.appendChild(aviso(d.erro))
  if (d.recado) onde.appendChild(aviso(d.recado, 'recado'))

  if (tela.qual === 'falta-configurar') {
    onde.appendChild(telaFaltaConfigurar())
    return
  }
  if (tela.qual === 'entrar') {
    onde.appendChild(telaEntrar(acoes, d))
    return
  }
  if (tela.qual === 'nao-e-admin') {
    onde.appendChild(telaNaoEAdmin())
    return
  }
  if (tela.qual === 'carregando') {
    onde.appendChild(el('p', { classe: 'ca-dica', texto: 'Abrindo a administração…' }))
    return
  }

  if (d.depositoPendente) onde.appendChild(cartaoDaConfirmacao(d.depositoPendente, acoes, d))
  onde.appendChild(cartaoDaConferencia(tela.painel))
  onde.appendChild(cartaoDaBusca(acoes, d))
  onde.appendChild(cartaoDasLojas(acoes, d))
  onde.appendChild(cartaoDosSaques(acoes, d))
  onde.appendChild(cartaoDoVencimento(acoes, d))
}
