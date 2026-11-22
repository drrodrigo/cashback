// ---------------------------------------------------------------------------
// O CADASTRO DA LOJA (22/11): a loja pede para entrar no Troco Prime, o administrador aprova (0028).
//
// Ele: *"a gente vai colocar a loja, né? Ela vai fazer um cadastro com a gente para ela poder fazer isso. E aí a gente vai
// vincular (...) ou o Troco Prime ou a loja do catálogo ou a loja do QR."*
// ---------------------------------------------------------------------------

/** O que a loja manda. */
export interface DadosDoPedidoDeLoja {
  nome: string
  documento: string
  whatsapp: string
  cidade: string
  uf: string
  troco: number
  desconto: number
}

export type SituacaoDoPedidoDeLoja = 'pedido' | 'aprovado' | 'recusado'

/** O que `public.cash_meu_pedido_de_loja()` devolve. */
export interface MeuPedidoDeLoja {
  id: string
  nome: string
  situacao: SituacaoDoPedidoDeLoja
  motivo: string | null
  criado_em: string
  decidido_em: string | null
}

/** O que `public.cash_admin_pedidos_de_loja()` devolve. */
export interface PedidoDeLojaAdmin {
  id: string
  nome: string
  documento: string
  whatsapp: string
  email: string | null
  cidade: string | null
  uf: string | null
  troco_percentual: number
  desconto_no_caixa: number
  situacao: SituacaoDoPedidoDeLoja
  criado_em: string
  loja_id: string | null
}

/** O vínculo escolhido na aprovação. */
export type OrigemDaAprovacao = 'troco' | 'catalogo' | 'qrunico'

const digitos = (s: string) => (s ?? '').replace(/\D/g, '')

/**
 * CPF ou CNPJ com os dígitos verificadores certos. 🔴 A MESMA conta de `cash.documento_valido` (0028): a tela avisa
 * antes de mandar; quem manda é o banco. Regra em dois lugares: mudou lá, muda aqui (o teste usa os mesmos exemplos).
 */
export function documentoValido(doc: string): boolean {
  const d = digitos(doc)
  if (/^(\d)\1*$/.test(d)) return false
  const n = [...d].map(Number)
  if (d.length === 11) {
    let s = 0
    for (let i = 0; i < 9; i++) s += n[i] * (10 - i)
    const dv1 = ((s * 10) % 11) % 10
    s = 0
    for (let i = 0; i < 10; i++) s += n[i] * (11 - i)
    const dv2 = ((s * 10) % 11) % 10
    return dv1 === n[9] && dv2 === n[10]
  }
  if (d.length === 14) {
    const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const p2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    let s = p1.reduce((t, p, i) => t + p * n[i], 0)
    const dv1 = s % 11 < 2 ? 0 : 11 - (s % 11)
    s = p2.reduce((t, p, i) => t + p * n[i], 0)
    const dv2 = s % 11 < 2 ? 0 : 11 - (s % 11)
    return dv1 === n[12] && dv2 === n[13]
  }
  return false
}

/** O que está errado no pedido, em palavras de gente; `null` quando dá para mandar. As mesmas recusas do banco. */
export function problemaDoPedido(p: DadosDoPedidoDeLoja): string | null {
  if (p.nome.trim().length < 2) return 'Escreva o nome da loja.'
  if (!documentoValido(p.documento)) return 'Confira o CPF ou o CNPJ: algum número está errado.'
  const fone = digitos(p.whatsapp)
  if (fone.length < 10 || fone.length > 13) return 'O WhatsApp precisa do DDD e do número.'
  if (!p.cidade.trim() || !/^[A-Za-z]{2}$/.test(p.uf.trim())) return 'Escreva a cidade e a UF (MG, SP...).'
  if (!(p.troco > 0 && p.troco <= 100)) return 'O troco tem que ser mais que 0% e até 100%.'
  if (!(p.desconto >= 0 && p.desconto < 100)) return 'O desconto no caixa vai de 0% a menos de 100%.'
  if (p.troco + p.desconto > 100) return 'Desconto no caixa e troco juntos passam de 100%.'
  return null
}

/** "52998224725" → "529.982.247-25"; "11222333000181" → "11.222.333/0001-81". */
export function documentoFormatado(doc: string): string {
  const d = digitos(doc)
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return doc
}

/** O link do WhatsApp (o administrador conversa com a loja antes de aprovar). */
export function linkDoWhatsapp(fone: string): string {
  const d = digitos(fone)
  return `https://wa.me/${d.length <= 11 ? '55' + d : d}`
}
