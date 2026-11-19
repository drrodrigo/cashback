// ---------------------------------------------------------------------------
// O APLICATIVO NO NAVEGADOR: `/app` (19/11). O mesmo aplicativo da loja de aplicativos, aberto pela web: se o
// aplicativo instalado der problema ou estiver esperando atualização, a pessoa entra por aqui e usa igual.
// Os dados são os de verdade (o banco). Para testar sem mexer em nada real: `/beta`.
// ---------------------------------------------------------------------------

import './estilo.css'
import { MARCA } from './marca'
import { montarCasca } from './app/casca'
import { repositorioDoBanco } from './repositorio'

document.documentElement.style.setProperty('--cash', MARCA.cor)
const casca = montarCasca(document.getElementById('app')!, {
  modo: 'banco',
  repos: { cliente: repositorioDoBanco, loja: repositorioDoBanco, admin: repositorioDoBanco },
})
// Voltou para o aplicativo (trocou de aba, desbloqueou o celular): os saldos podem ter mudado.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) void casca.recarregar()
})
