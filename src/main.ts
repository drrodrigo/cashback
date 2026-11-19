// ---------------------------------------------------------------------------
// A CONTA DA PESSOA. O endereço principal do Troco Prime.
//
// Só monta: a costura mora em `telas/montar.ts` (a mesma do /app e do /beta), o desenho em `carteira/tela.ts`, e os
// dados vêm do banco de verdade (`repositorio.ts`). A demonstração do modelo inteiro continua em `/demonstracao.html`.
// ---------------------------------------------------------------------------

import './estilo.css'
import { MARCA } from './marca'
import { montarConta } from './telas/montar'
import { repositorioDoBanco } from './repositorio'

document.documentElement.style.setProperty('--cash', MARCA.cor)
montarConta(document.getElementById('app')!, repositorioDoBanco)
