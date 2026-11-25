// D20: a checagem se encadeia. A espera (as bordas do minuto ≡ 2 módulo 5, os 5 min do início do run, o teto de
// 420 s), o teto diário no estado.json (dia de Assunção), «uma corrente só» e o que não vai à página.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ESPERAS_DISPARO_S,
  LISTA_INVALIDA,
  TENTATIVAS_DISPARO,
  contarEncadeado,
  decidirNovaTentativa,
  dispararComNovaTentativa,
  outrosRunsAtivos,
  segundosDeEspera,
  segundosDeEsperaReserva,
  statusDoErro,
  statusTentavel,
} from '../lib/encadear.mjs';
import { visaoDoEstado } from '../lib/visao.mjs';
import { operacaoDaChecagem } from '../scripts/gravar-dados.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const config = JSON.parse(readFileSync(join(RAIZ, 'config', 'alvos.json'), 'utf8'));
const pastas = [];
after(() => {
  for (const p of pastas) rmSync(p, { recursive: true, force: true });
});
function temporaria() {
  const p = mkdtempSync(join(tmpdir(), 'status-encadear-'));
  pastas.push(p);
  return p;
}

const ms = (iso) => Date.parse(iso);
// O run começou 10 min antes: o piso é o mínimo de 60 s.
const esperaCom10min = (agora) => segundosDeEspera(agora, ms(agora) - 10 * 60_000);

test('a espera: as bordas do minuto ≡ 2 módulo 5, com o run começado há 10 min (piso de 60 s)', () => {
  // 13:02:00 + 60 s cai em 13:03: o próximo horário é 13:07:00.
  assert.equal(esperaCom10min('2026-11-24T13:02:00Z'), 300);
  // 13:01:59 + 60 s cai em 13:02:59, dentro do minuto 2.
  assert.equal(esperaCom10min('2026-11-24T13:01:59Z'), 60);
  assert.equal(esperaCom10min('2026-11-24T13:06:59Z'), 60);
  // A virada da hora: 13:58:30 e 14:00:30 não são horário; os dois caem em 14:02:00 (4 min 30 s e 2 min 30 s).
  assert.equal(esperaCom10min('2026-11-24T13:57:30Z'), 270);
  assert.equal(esperaCom10min('2026-11-24T13:59:30Z'), 150);
  // A virada do dia (UTC): cai em 00:02:00 do dia seguinte.
  assert.equal(esperaCom10min('2026-11-24T23:59:30Z'), 150);
});

test('a espera nunca dispara antes de 5 min do início do run', () => {
  // O run começou há 30 s: faltam 270 s para os 5 min; 13:00:30 + 270 s = 13:05:00, o próximo horário é 13:07:00.
  const agora = '2026-11-24T13:00:30Z';
  const espera = segundosDeEspera(agora, '2026-11-24T13:00:00Z');
  assert.equal(espera, 390);
  assert.ok(espera >= 270);
  // Em segundos quebrados, arredonda para cima: nunca um instante antes dos 5 min.
  assert.equal(segundosDeEspera(ms('2026-11-24T13:01:59.500Z'), ms('2026-11-24T12:57:00Z')), 60);
  assert.equal(segundosDeEspera(ms('2026-11-24T12:59:00.250Z'), ms('2026-11-24T12:57:00Z')), 180);
});

test('a espera: a borda dos 420 s (420 alinha; 421 fica no piso)', () => {
  // Run de 1 min: piso de 240 s. 13:00:00 + 240 s = 13:04:00; até 13:07:00 são 420 s: alinha.
  assert.equal(segundosDeEspera('2026-11-24T13:00:00Z', '2026-11-24T12:59:00Z'), 420);
  // 12:59:59 + 240 s = 13:03:59; até 13:07:00 seriam 421 s: fica o piso.
  assert.equal(segundosDeEspera('2026-11-24T12:59:59Z', '2026-11-24T12:58:59Z'), 240);
});

test('a espera: o alinhamento que passaria de 420 s fica no piso', () => {
  // Run começado agora: piso de 300 s; 13:03 + 300 s = 13:08, e o próximo horário (13:12) daria 540 s.
  assert.equal(segundosDeEspera('2026-11-24T13:03:00Z', '2026-11-24T13:03:00Z'), 300);
  // Com o piso já no horário, fica o piso: 13:02:30 + 300 s = 13:07:30.
  assert.equal(segundosDeEspera('2026-11-24T13:02:30Z', '2026-11-24T13:02:30Z'), 300);
});

test('a espera: início ausente, inválido ou no futuro vale como agora (piso de 300 s)', () => {
  const agora = '2026-11-24T13:02:30Z';
  for (const inicio of [undefined, null, '', 'ontem', NaN, '2026-11-24T13:10:00Z']) {
    const espera = segundosDeEspera(agora, inicio);
    assert.ok(espera >= 300, `${inicio}: ${espera}`);
  }
  assert.throws(() => segundosDeEspera('não é data', agora), TypeError);
});

test('a espera fica sempre entre 60 e 420 s e nunca antes dos 5 min do início', () => {
  const base = ms('2026-11-24T13:00:00Z');
  for (let s = 0; s < 3600; s += 7) {
    for (const idade of [0, 30, 120, 299, 300, 301, 600, 7200]) {
      const agora = base + s * 1000;
      const espera = segundosDeEspera(agora, agora - idade * 1000);
      assert.ok(espera >= 60 && espera <= 420, `${s} ${idade}: ${espera}`);
      assert.ok(espera >= 300 - idade, `${s} ${idade}: ${espera} antes dos 5 min`);
      // Quando não fica no piso, cai no começo de um minuto ≡ 2 módulo 5.
      const alvo = new Date(agora + espera * 1000);
      const piso = Math.max(60, 300 - idade);
      if (espera !== piso) {
        assert.equal(alvo.getUTCMinutes() % 5, 2, `${s} ${idade}`);
        assert.equal(alvo.getUTCSeconds(), 0, `${s} ${idade}`);
      } else if (alvo.getUTCMinutes() % 5 !== 2) {
        // Ficou no piso fora do horário: só porque o alinhamento teria passado de 420 s.
        let proximo = Math.floor(alvo.getTime() / 60_000) * 60_000 + 60_000;
        while (new Date(proximo).getUTCMinutes() % 5 !== 2) proximo += 60_000;
        assert.ok(Math.ceil((proximo - agora) / 1000) > 420, `${s} ${idade}: ficou no piso sem passar de 420 s`);
      }
    }
  }
});

test('o teto diário: 299 encadeia e vira 300; 300 não encadeia e avisa', () => {
  const agora = '2026-11-24T15:00:00.000Z';
  assert.deepEqual(contarEncadeado({ dia: '2026-11-24', n: 299 }, agora), {
    encadeados: { dia: '2026-11-24', n: 300 },
    encadear: true,
    aviso: null,
  });
  assert.deepEqual(contarEncadeado({ dia: '2026-11-24', n: 300 }, agora), {
    encadeados: { dia: '2026-11-24', n: 300 },
    encadear: false,
    aviso: { tipo: 'teto-diario', em: agora },
  });
  // O aviso leva a hora em ISO UTC, também com a hora em ms.
  assert.equal(contarEncadeado({ dia: '2026-11-24', n: 300 }, ms(agora)).aviso.em, agora);
  assert.equal(contarEncadeado({ dia: '2026-11-24', n: 3 }, agora, 3).encadear, false);
});

test('o teto diário zera na meia-noite de Assunção, não na do UTC', () => {
  const cheio = { dia: '2026-11-23', n: 300 };
  // 00:30 UTC ainda é 23/11 em Assunção: o teto vale.
  assert.equal(contarEncadeado(cheio, '2026-11-24T00:30:00Z').encadear, false);
  assert.equal(contarEncadeado(cheio, '2026-11-24T02:59:59Z').encadear, false);
  // 03:00 UTC é a meia-noite de Assunção: zera, sem aviso.
  assert.deepEqual(contarEncadeado(cheio, '2026-11-24T03:00:00Z'), {
    encadeados: { dia: '2026-11-24', n: 1 },
    encadear: true,
    aviso: null,
  });
});

test('o teto diário: ausente ou malformado zera', () => {
  const agora = '2026-11-24T15:00:00Z';
  for (const ruim of [undefined, null, 7, 'x', [], {}, { dia: '2026-11-24' }, { dia: '2026-11-24', n: -1 }, { dia: '2026-11-24', n: 1.5 }, { dia: '24/11/2026', n: 300 }, { dia: '2026-11-24', n: '300' }]) {
    assert.deepEqual(contarEncadeado(ruim, agora), { encadeados: { dia: '2026-11-24', n: 1 }, encadear: true, aviso: null }, JSON.stringify(ruim));
  }
});

test('uma corrente só: os runs não terminados, fora o próprio (id comparado como texto)', () => {
  const runs = [
    { id: 1, status: 'queued' },
    { id: 2, status: 'in_progress' },
    { id: 3, status: 'pending' },
    { id: 4, status: 'waiting' },
    { id: 5, status: 'requested' },
    { id: 6, status: 'completed' },
    { id: 7, status: 'in_progress' },
  ];
  assert.deepEqual(outrosRunsAtivos(runs, '7').map((r) => r.id), [1, 2, 3, 4, 5]);
  assert.deepEqual(outrosRunsAtivos(runs, 2).map((r) => r.id), [1, 3, 4, 5, 7]);
  assert.deepEqual(outrosRunsAtivos([{ id: 7, status: 'in_progress' }, { id: 6, status: 'completed' }], '7'), []);
  assert.deepEqual(outrosRunsAtivos([], '7'), []);
  // A resposta sem lista fecha: null, e o script não dispara.
  for (const ruim of [undefined, null, {}, 'x', 3]) assert.equal(outrosRunsAtivos(ruim, '7'), null, String(ruim));
});

// A operação da checagem (D13) com os JSON lidos por uma função: sem git.
const MEDIDA = { instante: '2026-11-24T15:02:00.000Z', resultados: { app: 'ok' }, fatos: {} };
function operar(estado) {
  return operacaoDaChecagem({ config, medida: MEDIDA })((nome) => (nome === 'estado.json' ? estado : undefined));
}

test('a gravação da checagem conta o encadeado no estado.json lido e diz se encadeia', () => {
  const primeiro = operar(undefined);
  assert.equal(primeiro.saida.encadear, true);
  assert.deepEqual(primeiro.arquivos['estado.json'].encadeados, { dia: '2026-11-24', n: 1 });
  assert.ok(!('aviso' in primeiro.arquivos['estado.json']));

  const quase = operar({ encadeados: { dia: '2026-11-24', n: 299 } });
  assert.equal(quase.saida.encadear, true);
  assert.deepEqual(quase.arquivos['estado.json'].encadeados, { dia: '2026-11-24', n: 300 });

  const cheio = operar({ encadeados: { dia: '2026-11-24', n: 300 } });
  assert.equal(cheio.saida.encadear, false);
  assert.deepEqual(cheio.arquivos['estado.json'].encadeados, { dia: '2026-11-24', n: 300 });
  assert.deepEqual(cheio.arquivos['estado.json'].aviso, { tipo: 'teto-diario', em: MEDIDA.instante });
  // A checagem em si gravou.
  assert.equal(cheio.arquivos['estado.json'].verificado_em, MEDIDA.instante);
  assert.equal(cheio.arquivos['dias.json'].app['2026-11-24'].ok, 1);

  // No dia seguinte de Assunção, o aviso de ontem sai.
  const ontem = operar({ encadeados: { dia: '2026-11-23', n: 300 }, aviso: { tipo: 'teto-diario', em: '2026-11-24T02:00:00.000Z' } });
  assert.equal(ontem.saida.encadear, true);
  assert.deepEqual(ontem.arquivos['estado.json'].encadeados, { dia: '2026-11-24', n: 1 });
  assert.ok(!('aviso' in ontem.arquivos['estado.json']));
});

test('o encadeados e o aviso não vão à página: nem na visão do estado, nem no estado.json publicado', () => {
  const estado = {
    verificado_em: MEDIDA.instante,
    publicado_em: MEDIDA.instante,
    encadeados: { dia: '2026-11-24', n: 300 },
    aviso: { tipo: 'teto-diario', em: MEDIDA.instante },
    linhas: { app: { estado: 'ok', fora_seguidas: 0, degradadas_seguidas: 0, boas_seguidas: 2, serie_inicio: null, incidente: null } },
  };
  const visao = JSON.stringify(visaoDoEstado(config, estado));
  for (const termo of ['encadeados', 'aviso', 'teto-diario']) assert.ok(!visao.includes(termo), termo);

  const fonte = temporaria();
  writeFileSync(join(fonte, 'estado.json'), JSON.stringify(estado));
  writeFileSync(join(fonte, 'dias.json'), JSON.stringify({ app: { '2026-11-24': { feitas: 1, ok: 1, degradado: 0, fora: 0, minutos_fora: 0 } } }));
  writeFileSync(join(fonte, 'incidentes.json'), JSON.stringify({ incidentes: [] }));
  const saida = temporaria();
  execFileSync(process.execPath, ['scripts/montar-site.mjs', '--fonte', fonte, '--saida', saida], { cwd: RAIZ, encoding: 'utf8' });
  const publicado = readFileSync(join(saida, 'dados', 'estado.json'), 'utf8');
  for (const termo of ['encadeados', 'aviso', 'teto-diario']) assert.ok(!publicado.includes(termo), termo);
  assert.equal(JSON.parse(publicado).verificado_em, MEDIDA.instante);
});

test('o CLI recusa GITHUB_RUN_ID e GITHUB_REPOSITORY errados, com mensagem clara, antes de chamar o gh', () => {
  const vazio = temporaria();
  const rodar = (env) =>
    spawnSync(process.execPath, ['scripts/encadear.mjs'], { cwd: RAIZ, encoding: 'utf8', env: { PATH: vazio, ...env } });
  for (const [env, mensagem] of [
    [{ GITHUB_REPOSITORY: 'dono/repo' }, /GITHUB_RUN_ID precisa ser o número do run/],
    [{ GITHUB_RUN_ID: '12a', GITHUB_REPOSITORY: 'dono/repo' }, /GITHUB_RUN_ID precisa ser o número do run/],
    [{ GITHUB_RUN_ID: '123' }, /GITHUB_REPOSITORY precisa ser «dono\/repo»/],
    [{ GITHUB_RUN_ID: '123', GITHUB_REPOSITORY: 'dono/repo/../x' }, /GITHUB_REPOSITORY precisa ser «dono\/repo»/],
    [{ GITHUB_RUN_ID: '123', GITHUB_REPOSITORY: 'dono/..' }, /GITHUB_REPOSITORY precisa ser «dono\/repo»/],
    [{ GITHUB_RUN_ID: '123', GITHUB_REPOSITORY: 'dono' }, /GITHUB_REPOSITORY precisa ser «dono\/repo»/],
  ]) {
    const r = rodar(env);
    assert.equal(r.status, 1, JSON.stringify(env));
    assert.match(r.stderr, mensagem);
    assert.equal(r.stdout, '', 'nada de espera nem disparo');
  }
});

test('D25: o CLI recusa argumento desconhecido antes de chamar o gh; só --reserva é aceito', () => {
  const pasta = temporaria();
  const registro = join(pasta, 'gh.log');
  // Um gh que só anota que foi chamado: o PATH é só esta pasta.
  writeFileSync(join(pasta, 'gh'), `#!/bin/sh\necho "$*" >> "${registro}"\nexit 1\n`);
  chmodSync(join(pasta, 'gh'), 0o755);
  const env = { PATH: pasta, GITHUB_RUN_ID: '123', GITHUB_REPOSITORY: 'dono/repo' };
  for (const args of [['--outro'], ['--reserva', '--outro'], ['--reserva=sim'], ['reserva'], ['--reserva', 'x']]) {
    const r = spawnSync(process.execPath, ['scripts/encadear.mjs', ...args], { cwd: RAIZ, encoding: 'utf8', env });
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.stderr, /uso: node scripts\/encadear\.mjs \[--reserva\]\. Nada foi disparado\./);
    assert.equal(r.stdout, '', args.join(' '));
  }
  assert.throws(() => readFileSync(registro), { code: 'ENOENT' }, 'o gh não foi chamado');
  // Com --reserva, as conferências do ambiente continuam valendo.
  const r = spawnSync(process.execPath, ['scripts/encadear.mjs', '--reserva'], {
    cwd: RAIZ,
    encoding: 'utf8',
    env: { PATH: pasta, GITHUB_REPOSITORY: 'dono/repo' },
  });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /GITHUB_RUN_ID precisa ser o número do run/);
});

test('D25: o status HTTP da saída de erro do gh', () => {
  assert.equal(statusDoErro('could not create workflow dispatch event: HTTP 500: Internal Server Error (https://api.github.com/x)'), 500);
  assert.equal(statusDoErro('HTTP 502: Bad Gateway'), 502);
  assert.equal(statusDoErro('could not create workflow dispatch event: HTTP 404: Not Found'), 404);
  assert.equal(statusDoErro('HTTP 422: Unprocessable Entity\nmais uma linha'), 422);
  // Sem status: erro de rede.
  for (const sem of ['error connecting to api.github.com', 'dial tcp: i/o timeout', '', undefined, null, 'HTTP 5000']) {
    assert.equal(statusDoErro(sem), null, String(sem));
  }
});

test('D25: a decisão da nova tentativa: 5xx e rede tentam com 15 s e 30 s; 4xx e a 3ª esgotada falham', () => {
  assert.equal(TENTATIVAS_DISPARO, 3);
  assert.deepEqual(ESPERAS_DISPARO_S, [15, 30]);
  for (const status of [500, 502, 503, 599, null]) {
    assert.deepEqual(decidirNovaTentativa({ tentativa: 1, status }), { acao: 'tentar', esperaS: 15 }, String(status));
    assert.deepEqual(decidirNovaTentativa({ tentativa: 2, status }), { acao: 'tentar', esperaS: 30 }, String(status));
    assert.deepEqual(decidirNovaTentativa({ tentativa: 3, status }), { acao: 'falhar' }, String(status));
  }
  // 4xx, 3xx e o que não é status HTTP de erro de servidor: falha na hora.
  for (const status of [400, 401, 403, 404, 422, 499, 302, 600]) {
    assert.deepEqual(decidirNovaTentativa({ tentativa: 1, status }), { acao: 'falhar' }, String(status));
    assert.deepEqual(decidirNovaTentativa({ tentativa: 2, status }), { acao: 'falhar' }, String(status));
  }
});

// O disparo com fakes: `disparos` em ordem (true = ok; número ou null = falha com esse status); `listas` em ordem.
// `esperas`: os ms de cada espera; `statusDasEsperas`: o status que o `esperar` recebeu (para o log).
function laco(disparos, listas = []) {
  const chamadas = { disparos: 0, listas: 0, esperas: [], statusDasEsperas: [] };
  const execucao = dispararComNovaTentativa({
    disparar: async () => {
      const d = disparos[chamadas.disparos];
      chamadas.disparos += 1;
      return d === true ? { ok: true } : { ok: false, status: d, detalhe: `falha ${chamadas.disparos}` };
    },
    listarAtivos: async () => listas[chamadas.listas++],
    esperar: async (ms, status) => {
      chamadas.esperas.push(ms);
      chamadas.statusDasEsperas.push(status);
    },
  });
  return execucao.then((saida) => ({ saida, ...chamadas }));
}

test('D25: 500, a lista vazia e o disparo na 2ª tentativa, depois de 15 s', async () => {
  const r = await laco([500, true], [[]]);
  assert.deepEqual(r.saida, { resultado: 'disparou', tentativas: 2 });
  assert.equal(r.disparos, 2);
  assert.equal(r.listas, 1);
  assert.deepEqual(r.esperas, [15_000]);
  assert.deepEqual(r.statusDasEsperas, [500]);
});

test('D25: 500 e um run ativo na lista (o 500 criou o run): para sem o 2º disparo; lista inválida falha', async () => {
  const r = await laco([500, true], [[{ id: 9, status: 'queued' }]]);
  assert.deepEqual(r.saida, { resultado: 'parou', tentativas: 1, detalhe: 'há run ativo' });
  assert.equal(r.disparos, 1);
  assert.equal(r.listas, 1);
  // A lista inválida falha, sem disparar de novo (o job falho aciona a reserva).
  const invalida = await laco([500, true], [null]);
  assert.deepEqual(invalida.saida, {
    resultado: 'falhou',
    tentativas: 1,
    status: 500,
    podeTerSaido: true,
    detalhe: LISTA_INVALIDA,
  });
  assert.equal(LISTA_INVALIDA, 'lista de runs inválida');
  assert.equal(invalida.disparos, 1);
});

test('D25: 500, 500, 500: falha depois de 3 disparos, com 15 s e 30 s de espera', async () => {
  const r = await laco([500, 500, 500, true], [[], [], []]);
  assert.deepEqual(r.saida, { resultado: 'falhou', tentativas: 3, status: 500, podeTerSaido: true, detalhe: 'falha 3' });
  assert.equal(r.disparos, 3);
  assert.equal(r.listas, 2);
  assert.deepEqual(r.esperas, [15_000, 30_000]);
});

test('D25: 404 falha na 1ª, sem esperar nem listar; a rede (sem status) tenta de novo', async () => {
  const r = await laco([404, true]);
  assert.deepEqual(r.saida, { resultado: 'falhou', tentativas: 1, status: 404, podeTerSaido: false, detalhe: 'falha 1' });
  assert.equal(r.disparos, 1);
  assert.equal(r.listas, 0);
  assert.deepEqual(r.esperas, []);
  assert.ok(!statusTentavel(r.saida.status));

  const rede = await laco([null, 502, true], [[], []]);
  assert.deepEqual(rede.saida, { resultado: 'disparou', tentativas: 3 });
  assert.deepEqual(rede.esperas, [15_000, 30_000]);
  assert.deepEqual(rede.statusDasEsperas, [null, 502]);
  // 500 e depois 404: o 4xx encerra, mas o 500 de antes pode ter criado o run.
  const misto = await laco([500, 404, true], [[]]);
  assert.deepEqual(misto.saida, { resultado: 'falhou', tentativas: 2, status: 404, podeTerSaido: true, detalhe: 'falha 2' });
  assert.deepEqual(misto.esperas, [15_000]);
  // Sem status até o fim: o disparo pode ter saído.
  const semStatus = await laco([null, null, null], [[], []]);
  assert.deepEqual(semStatus.saida, { resultado: 'falhou', tentativas: 3, status: null, podeTerSaido: true, detalhe: 'falha 3' });
});

test('D25: a espera da reserva: só o que falta para os 5 min desde o início do run, sem o horário', () => {
  const agora = '2026-11-25T15:49:31Z';
  assert.equal(segundosDeEsperaReserva(agora, ms(agora) - 10 * 60_000), 0);
  assert.equal(segundosDeEsperaReserva(agora, ms(agora) - 4 * 60_000), 60);
  assert.equal(segundosDeEsperaReserva(agora, ms(agora) - 5 * 60_000), 0);
  // Em segundos quebrados, arredonda para cima.
  assert.equal(segundosDeEsperaReserva(ms(agora), ms(agora) - 299_500), 1);
  for (const inicio of [undefined, null, '', 'ontem', NaN, '2026-11-25T16:00:00Z']) {
    assert.equal(segundosDeEsperaReserva(agora, inicio), 300, String(inicio));
  }
  assert.throws(() => segundosDeEsperaReserva('não é data', agora), TypeError);
});

// Um gh falso (só builtins do sh; o PATH é só a pasta dele): o início do run de muito tempo atrás, a lista de runs
// de `GH_LISTA` e o disparo que falha com `GH_FALHA` no stderr, se houver. Cada chamada vai a `GH_LOG`.
function ghFalso() {
  const pasta = temporaria();
  writeFileSync(
    join(pasta, 'gh'),
    [
      '#!/bin/sh',
      'echo "$*" >> "$GH_LOG"',
      'case "$1 $2" in',
      '  "api repos/dono/repo/actions/runs/123") echo \'{"run_started_at":"2020-01-01T00:00:00Z"}\' ;;',
      '  "api repos/dono/repo/actions/workflows/checagem.yml/runs?per_page=50") echo "$GH_LISTA" ;;',
      '  "workflow run") if [ -n "$GH_FALHA" ]; then echo "$GH_FALHA" >&2; exit 1; fi ;;',
      '  *) exit 3 ;;',
      'esac',
      '',
    ].join('\n'),
  );
  chmodSync(join(pasta, 'gh'), 0o755);
  const log = join(pasta, 'gh.log');
  const rodar = (args, env) =>
    spawnSync(process.execPath, ['scripts/encadear.mjs', ...args], {
      cwd: RAIZ,
      encoding: 'utf8',
      env: { PATH: pasta, GH_LOG: log, GITHUB_RUN_ID: '123', GITHUB_REPOSITORY: 'dono/repo', GH_TOKEN: 'tok-secreto', ...env },
    });
  const chamadas = () => readFileSync(log, 'utf8').trim().split('\n');
  return { rodar, chamadas };
}

test('D25: o CLI na reserva: sem a espera do horário (o run começou há muito), lista e dispara', () => {
  const gh = ghFalso();
  const r = gh.rodar(['--reserva'], { GH_LISTA: '{"workflow_runs":[{"id":123,"status":"in_progress"},{"id":5,"status":"completed"}]}' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'Reserva.\nEspera: 0 s.\nDisparou.\n');
  assert.deepEqual(gh.chamadas(), [
    'api repos/dono/repo/actions/runs/123',
    'api repos/dono/repo/actions/workflows/checagem.yml/runs?per_page=50',
    'workflow run checagem.yml --ref main --repo dono/repo',
  ]);
});

test('D25: o CLI na reserva com run ativo não dispara; com 404 no disparo falha na 1ª, sem o token no log', () => {
  const ativo = ghFalso();
  const r = ativo.rodar(['--reserva'], { GH_LISTA: '{"workflow_runs":[{"id":77,"status":"queued"}]}' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'Reserva.\nEspera: 0 s.\nNão disparou: há run ativo.\n');
  assert.equal(ativo.chamadas().length, 2, 'sem disparo');

  const negado = ghFalso();
  const f = negado.rodar(['--reserva'], {
    GH_LISTA: '{"workflow_runs":[]}',
    GH_FALHA: 'could not create workflow dispatch event: HTTP 404: Not Found tok-secreto',
  });
  assert.equal(f.status, 1);
  assert.equal(f.stdout, 'Reserva.\nEspera: 0 s.\n');
  assert.equal(
    f.stderr,
    'Erro: o gh falhou ao disparar a checagem: could not create workflow dispatch event: HTTP 404: Not Found *** Nada foi disparado.\n',
  );
  assert.equal(negado.chamadas().length, 3, 'um disparo só: o 4xx não tenta de novo');
});

test('D25: o CLI com a lista de runs inválida falha com mensagem fixa, sem disparar', () => {
  for (const lista of ['{}', '{"workflow_runs":"x"}', '[]']) {
    const gh = ghFalso();
    const r = gh.rodar(['--reserva'], { GH_LISTA: lista });
    assert.equal(r.status, 1, lista);
    assert.equal(r.stdout, 'Reserva.\nEspera: 0 s.\n');
    assert.equal(r.stderr, 'Erro: a lista de runs é inválida. Nada foi disparado.\n');
    assert.equal(gh.chamadas().length, 2, 'sem disparo');
  }
});

// D25: o job `reserva` e o timeout do `encadear`, lidos como texto do workflow.
function jobDoWorkflow(yml, nome) {
  const inicio = yml.indexOf(`\n  ${nome}:\n`);
  assert.ok(inicio >= 0, `o job ${nome} existe`);
  const resto = yml.slice(inicio + 1);
  const fim = resto.slice(1).search(/\n {2}[a-z][\w-]*:\n/);
  return fim < 0 ? resto : resto.slice(0, fim + 2);
}

test('D25: o job reserva na checagem.yml: needs, if, permissões, timeout, ações fixadas, GH_TOKEN por env', () => {
  const yml = readFileSync(join(RAIZ, '.github', 'workflows', 'checagem.yml'), 'utf8');
  const reserva = jobDoWorkflow(yml, 'reserva');
  const needs = /^ {4}needs: \[(.*)\]$/m.exec(reserva)[1].split(',').map((s) => s.trim());
  assert.deepEqual(needs.sort(), ['checar', 'encadear']);
  // A linha `if:` inteira: falha ou cancelado (o timeout estourado) do `encadear`, nunca o run cancelado por gente,
  // e os mesmos freios.
  assert.equal(
    /^ {4}if: (.*)$/m.exec(reserva)[1],
    "${{ !cancelled() && (needs.encadear.result == 'failure' || needs.encadear.result == 'cancelled') && vars.ENCADEAR != 'nao' && needs.checar.outputs.encadear != 'nao' }}",
  );
  // Permissões: exatamente estas duas.
  const permissoes = /^ {4}permissions:\n((?: {6}.*\n)+)/m.exec(reserva)[1].trim().split('\n').map((s) => s.trim());
  assert.deepEqual(permissoes.sort(), ['actions: write', 'contents: read']);
  const timeout = Number(/^ {4}timeout-minutes: (\d+)$/m.exec(reserva)[1]);
  assert.ok(timeout > 0 && timeout <= 7, String(timeout));
  // Ações fixadas por SHA completo, com a versão em comentário.
  const usos = [...reserva.matchAll(/^ *- uses: (.*)$/gm)].map((m) => m[1]);
  assert.equal(usos.length, 2);
  for (const uso of usos) assert.match(uso, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+(\.\d+)*$/);
  assert.match(reserva, /persist-credentials: false/);
  // O passo: o modo --reserva, o GH_TOKEN só por env e nada de ${{ }} no run.
  assert.match(
    reserva,
    /\n {6}- name: [^\n]+\n {8}env:\n {10}GH_TOKEN: \$\{\{ github\.token \}\}\n {8}run: node scripts\/encadear\.mjs --reserva\n?$/,
  );
  assert.equal(reserva.match(/GH_TOKEN/g).length, 1);
  assert.equal(reserva.match(/\$\{\{/g).length, 2, 'só o if e o GH_TOKEN usam expressão');
  assert.ok(!/secrets\./.test(reserva));

  // O encadear sobe para 9 min (as novas tentativas do disparo).
  assert.match(jobDoWorkflow(yml, 'encadear'), /^ {4}timeout-minutes: 9$/m);
});
