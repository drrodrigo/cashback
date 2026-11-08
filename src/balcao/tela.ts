// ---------------------------------------------------------------------------
// A TELA DO BALCÃO. DOM na mão, sem framework, igual à da carteira.
//
// Não fala com a rede: as ações chegam como funções, e é isso que deixa a trava
// montar a tela de verdade e LER o que aparece.
//
// O desenho segue o padrão que ele aprovou em 02/10 (o Atacado de Alianças):
// **escolha é ALTERNADOR, ação é BOTÃO**. "Dar cashback | Cobrar" são duas
// opções coladas numa pílula, com `aria-pressed`; clicar ali só escolhe, não
// lança nada. Quem lança é o botão de baixo, que diz o valor.
// ---------------------------------------------------------------------------

import { MARCA } from '../marca'
import {
  cashbackDaCompra,
  dataCurta,
  emReais,
  fraseDoAtendimento,
  lerValor,
  qualTelaDoBalcao,
  tetoDaCobranca,
  type Cliente,
  type Cobranca,
  type Lancamento,
  type MinhaLoja,
} from './estado'
import type { EstadoDaCamera } from './leitorQr'

export interface AcoesDoBalcao {
  entrar(email: string, senha: string): Promise<void>
  sair(): Promise<void>
  lerCodigo(codigo: string): Promise<void>
  darCashback(valorDaCompra: number): Promise<void>
  cobrar(valorDaCompra: number, valorEmCash: number): Promise<void>
  pedirSaque(valor: number): Promise<void>
  limparAtendimento(): void
  escolher(modo: ModoDoAtendimento): void
  /** Onde pendurar o vídeo da câmera, quando houver. */
  video?: HTMLVideoElement | null
}

export type ModoDoAtendimento = 'dar' | 'cobrar'

export interface DadosDoBalcao {
  faltaConfigurar?: boolean
  logado: boolean
  carregando: boolean
  loja: MinhaLoja | null
  cliente: Cliente | null
  modo: ModoDoAtendimento
  cobrancas: Cobranca[]
  extrato: Lancamento[]
  camera: EstadoDaCamera
  erro: string | null
  recado: string | null
  ocupado: boolean
}

/** Para onde o "voltar" leva. Um lugar só, e é o de verdade. */
export const VOLTAR_AO_CLUBE = '/carteirinha'

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

function campo(rotulo: string, dica: string): { volta: HTMLElement; entrada: HTMLInputElement } {
  const entrada = el('input')
  entrada.type = 'text'
  entrada.inputMode = 'decimal'
  entrada.placeholder = dica
  entrada.setAttribute('aria-label', rotulo)
  const volta = el('label', { classe: 'ca-campo' }, [el('span', { texto: rotulo }), entrada])
  return { volta, entrada }
}

function aviso(texto: string, tipo: 'erro' | 'recado' = 'erro'): HTMLElement {
  const p = el('p', { classe: tipo === 'erro' ? 'ca-erro' : 'ca-recado', texto })
  p.setAttribute('role', tipo === 'erro' ? 'alert' : 'status')
  return p
}

function cabecalho(loja: MinhaLoja | null, acoes: AcoesDoBalcao): HTMLElement {
  const h = el('header', { classe: 'ca-topo' })
  h.appendChild(el('h1', { texto: `${MARCA.nome} — Balcão` }))
  h.appendChild(el('p', { classe: 'ca-tagline', texto: loja ? loja.nome : MARCA.tagline }))
  const voltar = el('a', { classe: 'ca-voltar', texto: '← Voltar ao Clube' })
  voltar.setAttribute('href', VOLTAR_AO_CLUBE)
  h.appendChild(voltar)
  if (loja) {
    const sair = el('button', { classe: 'ca-link', texto: 'Sair' })
    sair.addEventListener('click', () => void acoes.sair())
    h.appendChild(sair)
  }
  return h
}

// --- as telas de antes do balcão ----------------------------------------------

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

function telaEntrar(acoes: AcoesDoBalcao, d: DadosDoBalcao): HTMLElement {
  const s = el('section', { classe: 'ca-cartao' })
  s.appendChild(el('h2', { texto: 'Entrar no balcão' }))
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
  return s
}

/**
 * 🔴 ENTROU E NÃO É LOJISTA. Dizer isso é melhor que mostrar um balcão vazio: o
 * balcão vazio faz a pessoa tentar, falhar e chamar alguém. Quem decide é o
 * banco a cada chamada -- `cash.loja_do_usuario()` --, então esta tela também
 * aparece para quem VENDEU a loja, que é o certo.
 */
function telaNaoEhLojista(): HTMLElement {
  const s = el('section', { classe: 'ca-cartao' })
  s.appendChild(el('h2', { texto: 'Esta conta não tem loja no cashback' }))
  s.appendChild(
    el('p', {
      texto:
        'O balcão é de quem tem loja na rede. Se a sua loja já é parceira, peça para ligarem o cashback nela.',
    }),
  )
  const ir = el('a', { classe: 'ca-botao', texto: 'Ver minha carteira' })
  ir.setAttribute('href', '/')
  s.appendChild(ir)
  return s
}

// --- o balcão -----------------------------------------------------------------

function cartaoDaLoja(loja: MinhaLoja, acoes: AcoesDoBalcao, d: DadosDoBalcao): HTMLElement {
  const s = el('section', { classe: 'ca-cartao' })
  s.appendChild(el('h2', { texto: loja.nome }))
  s.appendChild(
    el('p', { classe: 'ca-dica', texto: `Devolve ${loja.cashback_percentual}% em cash a cada compra.` }),
  )

  const linha = el('div', { classe: 'ca-numeros' })
  linha.appendChild(
    el('div', { classe: 'ca-numero' }, [
      el('strong', { texto: emReais(loja.credito) }),
      el('span', { texto: 'para dar de cashback' }),
    ]),
  )
  linha.appendChild(
    el('div', { classe: 'ca-numero' }, [
      el('strong', { texto: emReais(loja.recebido) }),
      el('span', { texto: 'recebido de clientes' }),
    ]),
  )
  s.appendChild(linha)

  // 🔴 CRÉDITO ZERADO É O BALCÃO PARADO, e tem que doer na tela ANTES de o
  // vendedor tentar: sem crédito, `cash.dar_cashback` recusa -- é o que mata a
  // fraude da loja de fachada, e aqui vira recado em vez de erro vermelho na
  // frente do cliente.
  if (loja.credito <= 0) {
    s.appendChild(
      aviso(
        'Sem crédito para dar cashback. Fale com a plataforma para depositar antes de atender.',
        'recado',
      ),
    )
  }

  if (loja.saque_pedido > 0) {
    s.appendChild(aviso(`Saque de ${emReais(loja.saque_pedido)} pedido, esperando pagamento.`, 'recado'))
  }

  const livre = loja.recebido - loja.saque_pedido
  if (livre > 0) {
    const pedir = el('button', { classe: 'ca-botao-fraco', texto: `Pedir saque de ${emReais(livre)}` })
    pedir.disabled = d.ocupado
    pedir.addEventListener('click', () => void acoes.pedirSaque(livre))
    s.appendChild(pedir)
  }
  return s
}

/** O leitor: a câmera, e o campo de digitar que SEMPRE funciona. */
function cartaoDeLeitura(acoes: AcoesDoBalcao, d: DadosDoBalcao): HTMLElement {
  const s = el('section', { classe: 'ca-cartao' })
  s.appendChild(el('h2', { texto: 'Ler a carteirinha' }))
  s.appendChild(
    el('p', {
      classe: 'ca-dica',
      texto: 'Aponte para o QR na tela do cliente. O código dele vale 90 segundos e uma vez só.',
    }),
  )

  if (acoes.video && (d.camera === 'lendo' || d.camera === 'ligando')) {
    const moldura = el('div', { classe: 'ca-camera' })
    moldura.appendChild(acoes.video)
    s.appendChild(moldura)
  }

  const recadoDaCamera: Record<EstadoDaCamera, string> = {
    ligando: 'Ligando a câmera…',
    lendo: 'Lendo. Aponte para o QR.',
    negada: 'A câmera foi bloqueada neste navegador. Digite o código abaixo, ou libere a câmera e recarregue.',
    'sem-camera': 'Este aparelho não tem câmera. Digite o código abaixo.',
    falhou: 'A câmera não abriu. Digite o código abaixo.',
  }
  s.appendChild(
    aviso(recadoDaCamera[d.camera], d.camera === 'lendo' || d.camera === 'ligando' ? 'recado' : 'erro'),
  )

  // O SEGUNDO CAMINHO, que não é enfeite: computador de balcão sem câmera,
  // permissão negada sem querer, iPhone com a aba sem permissão. Ele sempre
  // aparece, não só quando a câmera falha -- esconder faria o vendedor procurar.
  const form = el('form', { classe: 'ca-form' })
  const codigo = el('input')
  codigo.type = 'text'
  codigo.placeholder = 'ou digite o código da carteirinha'
  codigo.setAttribute('aria-label', 'Código da carteirinha')
  const ler = el('button', { classe: 'ca-botao', texto: d.ocupado ? 'Lendo…' : 'Ler código' })
  ler.type = 'submit'
  ler.disabled = d.ocupado
  form.append(codigo, ler)
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    void acoes.lerCodigo(codigo.value)
  })
  s.appendChild(form)
  return s
}

/** O atendimento: quem é o cliente, e as duas coisas que o balcão faz. */
function cartaoDoAtendimento(
  cliente: Cliente,
  loja: MinhaLoja,
  acoes: AcoesDoBalcao,
  d: DadosDoBalcao,
): HTMLElement {
  const s = el('section', { classe: 'ca-cartao ca-atendimento' })
  s.appendChild(el('h2', { texto: cliente.nome }))
  s.appendChild(el('p', { classe: 'ca-frase', texto: fraseDoAtendimento(cliente, loja) }))

  // A PÍLULA DE ESCOLHA. Clicar aqui só escolhe -- não lança, não cobra.
  const pilula = el('div', { classe: 'ca-escolha' })
  const fazerBotao = (modo: ModoDoAtendimento, texto: string) => {
    const b = el('button', { texto })
    b.setAttribute('aria-pressed', String(d.modo === modo))
    if (d.modo === modo) b.classList.add('escolhido')
    b.addEventListener('click', () => acoes.escolher(modo))
    return b
  }
  pilula.append(fazerBotao('dar', 'Dar cashback'), fazerBotao('cobrar', 'Cobrar'))
  s.appendChild(pilula)

  if (d.modo === 'dar') {
    const { volta, entrada } = campo('Valor da compra', 'R$ 0,00')
    const previa = el('p', { classe: 'ca-dica', texto: ' ' })
    const lancar = el('button', { classe: 'ca-botao', texto: 'Lançar o cashback' })
    lancar.disabled = true

    const recalcular = () => {
      const valor = lerValor(entrada.value)
      const rende = valor === null ? 0 : cashbackDaCompra(valor, loja.cashback_percentual)
      previa.textContent =
        valor === null
          ? 'Digite o valor da compra.'
          : `${cliente.nome} ganha ${emReais(rende)} de cash nesta compra.`
      lancar.textContent = valor === null ? 'Lançar o cashback' : `Lançar ${emReais(rende)}`
      lancar.disabled = d.ocupado || valor === null || rende <= 0 || rende > loja.credito
      if (valor !== null && rende > loja.credito) {
        previa.textContent = `Faltou crédito: a loja tem ${emReais(loja.credito)} para dar.`
      }
    }
    entrada.addEventListener('input', recalcular)
    recalcular()

    lancar.addEventListener('click', () => {
      const valor = lerValor(entrada.value)
      if (valor !== null) void acoes.darCashback(valor)
    })
    s.append(volta, previa, lancar)
  } else {
    const compra = campo('Valor da compra', 'R$ 0,00')
    const emCash = campo('Quanto em cash', 'R$ 0,00')
    const previa = el('p', { classe: 'ca-dica', texto: ' ' })
    const cobrar = el('button', { classe: 'ca-botao', texto: 'Pedir confirmação' })
    cobrar.disabled = true

    const recalcular = () => {
      const vCompra = lerValor(compra.entrada.value)
      const vCash = lerValor(emCash.entrada.value)
      const teto = vCompra === null ? 0 : tetoDaCobranca(vCompra, cliente.pode_usar_aqui)
      if (vCompra === null) {
        previa.textContent = 'Digite o valor da compra.'
      } else if (teto <= 0) {
        previa.textContent = `${cliente.nome} não tem saldo para usar aqui nesta compra.`
      } else {
        previa.textContent = `Pode usar até ${emReais(teto)} nesta compra.`
      }
      const serve = vCompra !== null && vCash !== null && vCash > 0 && vCash <= teto + 0.005
      if (vCompra !== null && vCash !== null && vCash > teto + 0.005) {
        previa.textContent = `Passou do limite: o máximo aqui é ${emReais(teto)}.`
      }
      cobrar.disabled = d.ocupado || !serve
    }
    compra.entrada.addEventListener('input', recalcular)
    emCash.entrada.addEventListener('input', recalcular)
    recalcular()

    cobrar.addEventListener('click', () => {
      const vCompra = lerValor(compra.entrada.value)
      const vCash = lerValor(emCash.entrada.value)
      if (vCompra !== null && vCash !== null) void acoes.cobrar(vCompra, vCash)
    })
    s.append(compra.volta, emCash.volta, previa, cobrar)
    // 🔴 O BALCÃO NÃO DEBITA SOZINHO, e a tela diz isso: os dois números viram
    // acordo entre as duas partes, e quem confirma é o cliente no celular dele.
    s.appendChild(
      el('p', {
        classe: 'ca-dica',
        texto: 'O cliente confirma no celular dele. Só depois o cash sai da conta.',
      }),
    )
  }

  const outro = el('button', { classe: 'ca-link', texto: 'Atender outro cliente' })
  outro.addEventListener('click', () => acoes.limparAtendimento())
  s.appendChild(outro)
  return s
}

function cartaoDasCobrancas(cobrancas: Cobranca[]): HTMLElement | null {
  if (cobrancas.length === 0) return null
  const s = el('section', { classe: 'ca-cartao' })
  s.appendChild(el('h2', { texto: 'Esperando o cliente confirmar' }))
  const lista = el('ul', { classe: 'ca-lista' })
  for (const c of cobrancas) {
    lista.appendChild(
      el('li', {}, [
        el('strong', { texto: c.cliente_nome }),
        el('span', {
          texto: ` ${emReais(c.valor_em_cash)} de cash numa compra de ${emReais(c.valor_compra)}`,
        }),
        el('span', { classe: 'ca-quando', texto: dataCurta(c.criado_em) }),
      ]),
    )
  }
  s.appendChild(lista)
  return s
}

function cartaoDoExtrato(extrato: Lancamento[]): HTMLElement {
  const s = el('section', { classe: 'ca-cartao' })
  s.appendChild(el('h2', { texto: 'O que passou por aqui' }))
  if (extrato.length === 0) {
    s.appendChild(el('p', { classe: 'ca-dica', texto: 'Nada ainda. O primeiro atendimento aparece aqui.' }))
    return s
  }
  const lista = el('ul', { classe: 'ca-lista' })
  for (const l of extrato) {
    lista.appendChild(
      el('li', {}, [
        el('strong', { texto: emReais(l.valor) }),
        el('span', { texto: ` ${l.descricao}` }),
        el('span', { classe: 'ca-quando', texto: dataCurta(l.em) }),
      ]),
    )
  }
  s.appendChild(lista)
  return s
}

/** Desenha o balcão inteiro dentro de `onde`. */
export function desenharBalcao(onde: HTMLElement, d: DadosDoBalcao, acoes: AcoesDoBalcao): void {
  onde.textContent = ''
  const tela = qualTelaDoBalcao({ logado: d.logado, faltaConfigurar: d.faltaConfigurar }, d.loja, d.carregando)

  onde.appendChild(cabecalho(tela.qual === 'balcao' ? tela.loja : null, acoes))
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
  if (tela.qual === 'carregando') {
    onde.appendChild(el('p', { classe: 'ca-dica', texto: 'Abrindo o balcão…' }))
    return
  }
  if (tela.qual === 'nao-e-lojista') {
    onde.appendChild(telaNaoEhLojista())
    return
  }

  onde.appendChild(cartaoDaLoja(tela.loja, acoes, d))
  onde.appendChild(
    d.cliente ? cartaoDoAtendimento(d.cliente, tela.loja, acoes, d) : cartaoDeLeitura(acoes, d),
  )
  const cobrancas = cartaoDasCobrancas(d.cobrancas)
  if (cobrancas) onde.appendChild(cobrancas)
  onde.appendChild(cartaoDoExtrato(d.extrato))
}
