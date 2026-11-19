// ---------------------------------------------------------------------------
// O ADMINISTRADOR. O terceiro endereço do Troco Prime: `/admin.html`.
//
// Só monta: a costura mora em `telas/montar.ts` (a mesma do /app e do /beta), o desenho em `admin/tela.ts`, e os dados
// vêm do banco de verdade (`repositorio.ts`). Quem decide se a pessoa é administradora é o banco, a cada chamada.
// ---------------------------------------------------------------------------

import './estilo.css'
import { MARCA } from './marca'
import { montarAdmin } from './telas/montar'
import { repositorioDoBanco } from './repositorio'

document.documentElement.style.setProperty('--cash', MARCA.cor)
montarAdmin(document.getElementById('app')!, repositorioDoBanco)
