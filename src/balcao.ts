// ---------------------------------------------------------------------------
// O BALCÃO DA LOJA. O outro endereço do Troco Prime: `/balcao.html`.
//
// Só monta: a costura mora em `telas/montar.ts` (a mesma do /app e do /beta), o desenho em `balcao/tela.ts`, a câmera
// em `balcao/leitorQr.ts`, e os dados vêm do banco de verdade (`repositorio.ts`).
// ---------------------------------------------------------------------------

import './estilo.css'
import { MARCA } from './marca'
import { montarBalcao } from './telas/montar'
import { repositorioDoBanco } from './repositorio'

document.documentElement.style.setProperty('--cash', MARCA.cor)
montarBalcao(document.getElementById('app')!, repositorioDoBanco)
