/**
 * O que viaja dentro do QR da carteirinha, e como tirar o token dele.
 *
 * 🔴 ESTE ARQUIVO É CÓPIA do `src/lib/token.ts` do `drrodrigo/clubeprime`, e a
 * cópia é deliberada: quem desenha o QR é o Clube, quem lê aqui é o cashback, e
 * os dois repositórios não compartilham código. **Regra que mora em dois lugares
 * muda nos DOIS na mesma entrega** -- se o formato do QR mudar lá, este arquivo
 * muda junto, senão o balcão do cashback passa a recusar carteirinha boa.
 *
 * O que o Clube escreve no QR, nas palavras do arquivo de lá:
 *
 * > Era só o token: 32 caracteres hexadecimais que vencem em 90 segundos. O
 * > problema apareceu quando o Rodrigo apontou a câmera comum do celular para a
 * > própria carteirinha e viu 32 letras sem sentido. Agora viaja um endereço:
 * > `https://<site>/validar#<token>`. Qualquer câmera abre a tela de confirmação.
 *
 * O token vai depois do `#` de propósito: essa parte não é enviada ao servidor,
 * então não entra em log de acesso nem no `Referer`.
 */

const TOKEN = /^[0-9a-f]{32}$/

/**
 * Aceita as duas formas: o endereço novo e o token puro.
 *
 * O token puro continua valendo porque carteirinha é tela aberta no celular de
 * outra pessoa -- quem estiver com a aba antiga em pé tem de continuar sendo
 * atendido no balcão.
 *
 * Qualquer outra coisa lida pela câmera (QR de cardápio, de Pix, de site) é
 * recusada aqui, sem gastar chamada ao banco. O leitor do caixa costuma mandar
 * espaço ou quebra de linha junto: o `trim` cobre.
 */
export function extrairToken(lido: string): string | null {
  const bruto = lido.trim()

  const cerquilha = bruto.lastIndexOf('#')
  if (cerquilha !== -1) {
    // Só o nosso endereço. Sem esta conferência, qualquer QR de site com 32
    // hexadecimais depois do `#` viraria uma tentativa de validação.
    const antes = bruto.slice(0, cerquilha).replace(/\/+$/, '')
    if (!/\/validar$/i.test(antes)) return null
    const token = bruto.slice(cerquilha + 1).toLowerCase()
    return TOKEN.test(token) ? token : null
  }

  const token = bruto.toLowerCase()
  return TOKEN.test(token) ? token : null
}
