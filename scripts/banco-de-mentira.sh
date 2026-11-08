#!/usr/bin/env bash
# Levanta um Postgres de mentira e planta o banco do BipeChat inteiro nele.
#
# POR QUE ISSO EXISTE: ate hoje o unico jeito de conferir uma migration era aplicar no
# banco de VERDADE. Foi assim que, em 30/08, um `grant` esquecido derrubou o acesso
# publico de todas as lojas -- o erro so apareceu depois de estar no ar. Aqui a migration
# roda num banco descartavel, de graca, e o que quebrar quebra longe de quem usa.
#
#   bash scripts/banco-de-mentira.sh            # planta o banco e para de pe
#   bash scripts/banco-de-mentira.sh --testes   # planta e roda supabase/testes/*.sql
#   bash scripts/banco-de-mentira.sh --parar    # derruba
#
# ESTA COPIA veio do \`drrodrigo/catologoonline\` (bipechat/scripts/), onde o script
# nasceu, quando o cashback virou repositorio proprio em 08/11/2026. Aqui ela nao
# precisa do --raiz: a pasta supabase/ esta na raiz deste repositorio, que e o
# padrao do script. Se um dia o original de la ganhar conserto, vale trazer.
#
# --raiz <pasta> planta OUTRO produto deste repositorio (o padrao e o BipeChat, que e
# onde este script nasceu). A pasta precisa ter supabase/local/preludio.sql e
# supabase/migrations/. Serve pro cash e pra qualquer gaveta nova -- um script so, em vez
# de uma copia por produto, que e o que a regra de nao duplicar pede:
#
#   bash bipechat/scripts/banco-de-mentira.sh --raiz cash --testes
#
# Depois de plantado: psql -h $PGDIR -p 55432 -U postgres
set -euo pipefail

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"
MODO=""
RELATORIO=""
while [ $# -gt 0 ]; do
  case "$1" in
    --raiz) RAIZ="$(cd "$2" && pwd)"; shift 2;;
    --parar|--testes) MODO="$1"; shift;;
    # Mostra o relatorio dos testes que passaram, e nao so o veredito. Ler o
    # relatorio e o que pegou o contador mentindo em 16/09 (`not NULL` nao e
    # falso): o passo saia vermelho na tela e nao era contado.
    --relatorio) RELATORIO=1; shift;;
    *) echo "opcao desconhecida: $1"; exit 2;;
  esac
done
DONO=pgtest
BASE=/home/$DONO/banco-de-mentira
export PGHOST=$BASE PGPORT=55432 PGUSER=postgres
BIN=$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)

if [ -z "$BIN" ]; then echo "Postgres nao instalado aqui (apt install postgresql)"; exit 1; fi

parar() { su $DONO -c "$BIN/pg_ctl -D $BASE/data stop" >/dev/null 2>&1 || true; }
if [ "$MODO" = "--parar" ]; then parar; echo "parado"; exit 0; fi

parar
id $DONO >/dev/null 2>&1 || useradd -m $DONO
rm -rf "$BASE"; mkdir -p "$BASE"; chown -R $DONO /home/$DONO
su $DONO -c "$BIN/initdb -D $BASE/data -U postgres --auth=trust" >/dev/null
su $DONO -c "$BIN/pg_ctl -D $BASE/data -l $BASE/log -o '-p 55432 -k $BASE' -w start" >/dev/null

# A extensao `pg_cron` de mentira (ver preludio.sql). Escrita no disco porque
# `create extension` procura o arquivo de controle, e nao adianta declarar por SQL.
EXT=$(ls -d /usr/share/postgresql/*/extension 2>/dev/null | tail -1)
cat > "$EXT/pg_cron.control" <<'CTL'
comment = 'agendador de mentira, so para plantar o banco fora do Supabase'
default_version = '1.0'
relocatable = false
schema = 'cron'
CTL
cat > "$EXT/pg_cron--1.0.sql" <<'CRON'
create table cron.job (jobid bigserial primary key, jobname text, schedule text, command text);
create function cron.schedule(p_nome text, p_quando text, p_comando text) returns bigint
language sql as $$ insert into cron.job (jobname, schedule, command)
  values (p_nome, p_quando, p_comando) returning jobid; $$;
create function cron.unschedule(p_nome text) returns boolean
language sql as $$ delete from cron.job where jobname = p_nome; select true; $$;
CRON

psql -q -v ON_ERROR_STOP=1 -f "$RAIZ/supabase/local/preludio.sql"

falhas=0
for f in "$RAIZ"/supabase/migrations/*.sql; do
  if ! saida=$(psql -q -v ON_ERROR_STOP=1 -f "$f" 2>&1); then
    echo "### migration falhou: $(basename "$f")"; echo "$saida" | head -8; falhas=$((falhas+1))
  fi
done
if [ $falhas -gt 0 ]; then echo "PLANTIO FALHOU ($falhas migrations)"; exit 1; fi
echo "banco plantado: $(ls "$RAIZ"/supabase/migrations/*.sql | wc -l) migrations, 0 falhas"

if [ "$MODO" = "--testes" ]; then
  for t in "$RAIZ"/supabase/testes/*.sql; do
    [ -e "$t" ] || continue
    nome=$(basename "$t")
    # Teste que depende de coisa que so existe no Supabase (pg_net, o Catalogo de
    # verdade) fica de fora daqui de proposito -- ele mede o que este banco nao tem.
    case "$nome" in ponte_com_o_catalogo.sql|busca_catalogo.sql|loja_no_perfil.sql|push.sql|puxao.sql|isolamento*.sql) continue;; esac
    saida=$(psql -q -v ON_ERROR_STOP=1 -f "$t" 2>&1) && codigo=0 || codigo=1
    # Alguns testes RELATAM levantando excecao (`raise exception 'RESULTADO >>> ...'`),
    # porque e assim que se imprime de dentro de um bloco `do $$`. Sair com erro nao quer
    # dizer que reprovou -- quem diz e a marca `[FALHOU]` dentro do relatorio. Ler so o
    # codigo de saida daria vermelho em teste verde, e o vermelho que mente e o jeito
    # mais rapido de ensinar todo mundo a ignorar vermelho.
    if echo "$saida" | grep -q 'RESULTADO'; then codigo=0; fi
    # E o contrario tambem: `porta.sql` relata numa TABELA e sai com 0 mesmo reprovando.
    # Ler so o codigo de saida daria verde em teste vermelho -- que e pior do que nao ter
    # teste, porque da a sensacao de estar coberto.
    if echo "$saida" | grep -q 'FALHOU'; then codigo=1; fi
    # QUANTOS PASSOS O TESTE REALMENTE MEDIU. Sem este numero, um teste que
    # morresse no terceiro passo e relatasse tres [ok] apareceria igualzinho a um
    # que mediu vinte e dois -- e e barato errar para baixo escrevendo teste.
    passos=$(echo "$saida" | grep -c '\[ok\]' || true)
    if [ $codigo -eq 0 ]; then
      if [ "$passos" -gt 0 ]; then echo "ok   $nome ($passos passos)"; else echo "ok   $nome"; fi
      [ -n "$RELATORIO" ] && echo "$saida" | sed -n '/RESULTADO/,$p' | sed 's/^/     /'
    else echo "FALHA $nome"; echo "$saida" | head -12; falhas=$((falhas+1)); fi
  done
  [ $falhas -eq 0 ] || exit 1
fi
