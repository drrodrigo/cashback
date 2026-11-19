// O título com o ícone da marca na frente (19/11): o T com a seta laranja, ao lado do nome, no alto do site, do balcão
// e do administrador. O texto do título continua o mesmo (o ícone não tem texto), então quem lê o título lê igual.
import { MARCA } from '../marca'

export function iconeDaMarca(tamanho = 32): HTMLImageElement {
  const img = document.createElement('img')
  img.className = 'ca-icone'
  img.src = MARCA.icone
  img.alt = ''
  img.width = tamanho
  img.height = tamanho
  img.decoding = 'async'
  return img
}

export function tituloComIcone(texto: string): HTMLHeadingElement {
  const h1 = document.createElement('h1')
  h1.append(iconeDaMarca(), texto)
  return h1
}
