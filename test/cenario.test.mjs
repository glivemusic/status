// D19: os cenários de teste das fotos (scripts/cenario.mjs): o que a página mostraria em cada um, e que eles
// levam a marca de exemplo.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { CENARIOS, montarCenario } from '../scripts/cenario.mjs';
import { corDoDia, esperadasNoDia, temIncidenteDegradadoNoDia } from '../lib/dias.mjs';
import { estadoGeral, estadosDoGeral } from '../lib/geral.mjs';
import { incidentesRecentes } from '../lib/incidentes.mjs';
import { diaDeAssuncao } from '../lib/tempo.mjs';
import { visaoDoEstado } from '../lib/visao.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const ler = (...p) => JSON.parse(readFileSync(join(RAIZ, ...p), 'utf8'));
const config = ler('config', 'alvos.json');
const exemplo = { estado: ler('exemplo', 'estado.json'), dias: ler('exemplo', 'dias.json'), incidentes: ler('exemplo', 'incidentes.json') };
const pastas = [];
after(() => {
  for (const p of pastas) rmSync(p, { recursive: true, force: true });
});

// O estado geral e os incidentes abertos que a página mostraria.
function naPagina(c) {
  const visao = visaoDoEstado(config, c.estado);
  const agora = c.estado.agora;
  return {
    geral: estadoGeral(estadosDoGeral(visao.linhas), visao.verificado_em, agora),
    abertos: incidentesRecentes(c.incidentes.incidentes, agora).filter((i) => i.fim === null),
    linhas: Object.fromEntries(visao.linhas.map((l) => [l.id, l.estado])),
  };
}

test('os cenários: tudo ok, fora do ar e monitoramento atrasado', () => {
  assert.deepEqual(CENARIOS, ['tudo-ok', 'fora', 'atrasado']);
  const ok = naPagina(montarCenario('tudo-ok', exemplo, { config }));
  assert.equal(ok.geral, 'ok');
  assert.deepEqual(ok.abertos, []);
  assert.ok(Object.values(ok.linhas).every((e) => e === 'ok'));

  const fora = montarCenario('fora', exemplo, { config });
  const p = naPagina(fora);
  assert.equal(p.geral, 'fora');
  assert.equal(fora.estado.linhas.app.fora_seguidas, 2, 'D4: abre na 2ª fora seguida');
  assert.equal(p.linhas.app, 'fora');
  const aberto = p.abertos.find((i) => i.tipo === 'fora');
  assert.deepEqual(aberto.linhas, ['app']);
  assert.equal(aberto.titulo['pt-BR'], 'Interrupção em Agronomy Center: aplicativo');
  assert.equal(aberto.titulo['es-PY'], 'Interrupción en Agronomy Center: aplicación');
  // 40 min fora hoje: a barra de hoje do aplicativo fica vermelha.
  const agora = fora.estado.agora;
  const hoje = diaDeAssuncao(agora);
  const registro = fora.dias.app[hoje];
  assert.equal(registro.minutos_fora, 40);
  const cor = corDoDia({
    registro,
    temDegradado: temIncidenteDegradadoNoDia(fora.incidentes.incidentes, 'app', hoje, agora),
    esperadas: esperadasNoDia(hoje, agora),
  });
  assert.equal(cor, 'vermelha');

  const atrasado = naPagina(montarCenario('atrasado', exemplo, { config }));
  assert.equal(atrasado.geral, 'atrasado');
});

test('os cenários não mudam o exemplo e levam a marca de exemplo nos três arquivos', () => {
  const antes = JSON.stringify(exemplo);
  for (const nome of CENARIOS) {
    const c = montarCenario(nome, exemplo, { config });
    assert.equal(c.estado.exemplo, true, nome);
    assert.equal(c.dias.exemplo, true, nome);
    assert.equal(c.incidentes.exemplo, true, nome);
  }
  assert.equal(JSON.stringify(exemplo), antes);
  assert.throws(() => montarCenario('outro', exemplo, { config }), /cenário desconhecido/);
});

test('a CLI grava os três arquivos, e o site monta com eles sem vazamento', () => {
  const dados = mkdtempSync(join(tmpdir(), 'status-cenario-'));
  const site = mkdtempSync(join(tmpdir(), 'status-cenario-site-'));
  pastas.push(dados, site);
  execFileSync(process.execPath, ['scripts/cenario.mjs', '--cenario', 'fora', '--saida', dados], { cwd: RAIZ });
  execFileSync(process.execPath, ['scripts/montar-site.mjs', '--fonte', dados, '--saida', site], { cwd: RAIZ });
  const estado = JSON.parse(readFileSync(join(site, 'dados', 'estado.json'), 'utf8'));
  assert.equal(estado.exemplo, true);
  assert.equal(estado.linhas.find((l) => l.id === 'app').estado, 'fora');
});
