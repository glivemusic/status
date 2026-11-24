// D20: a checagem se encadeia. A espera (as bordas do minuto ≡ 2 módulo 5, os 5 min do início do run, o teto de
// 420 s), o teto diário no estado.json (dia de Assunção), «uma corrente só» e o que não vai à página.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { contarEncadeado, outrosRunsAtivos, segundosDeEspera } from '../lib/encadear.mjs';
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
