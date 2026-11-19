// ---------------------------------------------------------------------------
// O APLICATIVO EM DEMONSTRAÇÃO: `/beta` (19/11). As telas são as do aplicativo de verdade; os dados moram neste
// aparelho, com as contas de teste (a Ana, o Bruno, a Ótica, a Padaria e a administração) e o motor de dinheiro do
// navegador, com as mesmas regras do banco. É aqui que ele testa e diz o que mudar.
// ---------------------------------------------------------------------------

import './estilo.css'
import { MARCA } from './marca'
import { montarCasca } from './app/casca'
import { criarDemonstracao } from './demonstracao/repositorio'
import { fraseDoErro } from './dados'

document.documentElement.style.setProperty('--cash', MARCA.cor)
const casca = montarCasca(document.getElementById('app')!, {
  modo: 'demonstracao',
  repos: {
    cliente: criarDemonstracao('cliente', undefined, fraseDoErro),
    loja: criarDemonstracao('loja', undefined, fraseDoErro),
    admin: criarDemonstracao('admin', undefined, fraseDoErro),
  },
})
// Outra aba mexeu no mundo da demonstração (a loja cobrou, a cliente confirmou): esta aba repinta.
window.addEventListener('storage', (e) => {
  if (e.key?.startsWith('trocoprime:demonstracao')) void casca.recarregar()
})
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void casca.recarregar()
})
