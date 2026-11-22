// ---------------------------------------------------------------------------
// "QUERO SER LOJA TROCO PRIME" (22/11): o que aparece no balcão para quem entrou e ainda não é loja.
//
// Três jeitos, conforme o pedido:
//   - sem pedido (ou recusado): o formulário (nome, CPF ou CNPJ, WhatsApp, cidade, UF, troco e desconto no caixa);
//   - pedido aberto: "Pedido enviado", e dá para corrigir;
//   - recusado: o motivo, e o formulário para pedir de novo.
// O rascunho mora FORA da tela (`Rascunho`), porque o balcão se repinta inteiro a cada passo: sem isso, o que a pessoa
// digitou sumiria no "Enviando…".
// ---------------------------------------------------------------------------

import { MARCA } from '../marca'
import { problemaDoPedido, type DadosDoPedidoDeLoja, type MeuPedidoDeLoja } from './estado'

export interface Rascunho {
  nome: string
  documento: string
  whatsapp: string
  cidade: string
  uf: string
  troco: string
  desconto: string
  /** O pedido aberto: o formulário só aparece quando a pessoa quer corrigir. */
  corrigindo: boolean
}

export function rascunhoNovo(): Rascunho {
  return { nome: '', documento: '', whatsapp: '', cidade: '', uf: '', troco: '10', desconto: '0', corrigindo: false }
}

const numero = (s: string) => Number(String(s).replace(',', '.'))

export function dadosDoRascunho(r: Rascunho): DadosDoPedidoDeLoja {
  return {
    nome: r.nome.trim(),
    documento: r.documento,
    whatsapp: r.whatsapp,
    cidade: r.cidade.trim(),
    uf: r.uf.trim().toUpperCase(),
    troco: numero(r.troco),
    desconto: r.desconto.trim() === '' ? 0 : numero(r.desconto),
  }
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

export interface EstadoDoCadastro {
  pedido: MeuPedidoDeLoja | null
  rascunho: Rascunho
  ocupado: boolean
}

export function blocoDoCadastro(
  d: EstadoDoCadastro,
  aoEnviar: (dados: DadosDoPedidoDeLoja) => void,
  aoRepintar: () => void,
): HTMLElement {
  const s = el('section', { classe: 'ca-cartao lc-cadastro' })
  const r = d.rascunho
  const p = d.pedido

  if (p?.situacao === 'pedido' && !r.corrigindo) {
    s.appendChild(el('h2', { texto: 'Pedido enviado' }))
    s.appendChild(
      el('p', {
        texto: `Recebemos o pedido da ${p.nome}. A administração do ${MARCA.nome} confere os dados e aprova; a resposta aparece aqui, nesta tela.`,
      }),
    )
    s.appendChild(
      el('p', {
        classe: 'ca-dica',
        texto: 'Depois de aprovada, a loja coloca crédito por Pix (mínimo R$ 100,00) e já pode dar troco aos clientes do Clube Prime.',
      }),
    )
    const corrigir = el('button', { classe: 'ca-botao-fraco', texto: 'Corrigir o pedido' })
    corrigir.type = 'button'
    corrigir.addEventListener('click', () => {
      r.corrigindo = true
      aoRepintar()
    })
    s.appendChild(corrigir)
    return s
  }

  s.appendChild(el('h2', { texto: `Quero ser loja ${MARCA.nome}` }))
  if (p?.situacao === 'recusado') {
    const aviso = el('p', {
      classe: 'ca-erro',
      texto: `O pedido da ${p.nome} não foi aprovado${p.motivo ? `: ${p.motivo}` : '.'} Corrija e mande de novo.`,
    })
    aviso.setAttribute('role', 'alert')
    s.appendChild(aviso)
  } else {
    s.appendChild(
      el('p', {
        texto: `Sua loja devolve parte da compra como troco para os clientes do Clube Prime, e o troco deles volta para gastar na rede. Preencha e a administração aprova.`,
      }),
    )
  }

  const campo = (rotulo: string, chave: keyof Omit<Rascunho, 'corrigindo'>, props: Partial<HTMLInputElement> = {}) => {
    const input = el('input')
    input.type = 'text'
    Object.assign(input, props)
    input.value = r[chave]
    input.addEventListener('input', () => {
      r[chave] = input.value
    })
    const label = el('label', { classe: 'ca-campo lc-campo' }, [el('span', { texto: rotulo }), input])
    return label
  }

  const form = el('form', { classe: 'lc-form' })
  form.noValidate = true
  form.append(
    campo('Nome da loja', 'nome', { autocomplete: 'organization' }),
    campo('CPF ou CNPJ', 'documento', { inputMode: 'numeric' }),
    campo('WhatsApp da loja (com DDD)', 'whatsapp', { inputMode: 'tel', autocomplete: 'tel' }),
    el('div', { classe: 'lc-linha' }, [
      campo('Cidade', 'cidade', { autocomplete: 'address-level2' }),
      campo('UF', 'uf', { maxLength: 2, autocomplete: 'address-level1' }),
    ]),
    el('div', { classe: 'lc-linha' }, [
      campo('Troco (%)', 'troco', { inputMode: 'decimal' }),
      campo('Desconto no caixa (%)', 'desconto', { inputMode: 'decimal' }),
    ]),
    el('p', {
      classe: 'ca-dica',
      texto: 'O troco é o desconto do Clube Prime: em vez de abater no preço, a loja devolve em troco (10% no Clube Prime, 15% ou mais no Ofertas Prime). Desconto no caixa é opcional: deixe 0 para só troco.',
    }),
  )
  const problema = el('p', { classe: 'ca-erro lc-problema' })
  problema.setAttribute('role', 'alert')
  const enviar = el('button', { classe: 'ca-botao', texto: d.ocupado ? 'Enviando…' : 'Enviar o pedido' })
  enviar.type = 'submit'
  enviar.disabled = d.ocupado
  form.append(problema, enviar)
  form.addEventListener('submit', (ev) => {
    ev.preventDefault()
    const dados = dadosDoRascunho(r)
    const erro = problemaDoPedido(dados)
    problema.textContent = erro ?? ''
    if (!erro) aoEnviar(dados)
  })
  s.appendChild(form)
  return s
}
