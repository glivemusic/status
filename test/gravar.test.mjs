// D13: a gravação no ramo `dados` sem perder nada. Git local em pasta temporária, remoto = repositório bare local,
// nunca rede. Cada teste apaga as suas pastas no fim.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { devNull, tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { aplicarMedida } from '../lib/checagem.mjs';
import {
  ambienteDoGit,
  cabecalhoDoToken,
  classificarPush,
  esperaComVariacao,
  precisaRecriar,
  semToken,
} from '../lib/gravar.mjs';
import { aplicarAcaoManual } from '../lib/manual.mjs';
import { FalhaDaGravacao, executarGit, gravarNoRamo, operacaoDaChecagem } from '../scripts/gravar-dados.mjs';
import { TEXTOS } from '../site/textos.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const config = JSON.parse(readFileSync(join(RAIZ, 'config', 'alvos.json'), 'utf8'));

// --- A parte pura (lib/gravar.mjs) ---

test('recria quando o commit mais velho é de outro dia de Assunção', () => {
  // 03:00 UTC do dia 24 ainda é 23/11 em Assunção (UTC-3).
  assert.equal(precisaRecriar(['2026-11-23T04:00:00Z'], '2026-11-24T02:59:00Z'), false);
  assert.equal(precisaRecriar(['2026-11-23T04:00:00Z'], '2026-11-24T03:00:00Z'), true);
  assert.equal(precisaRecriar(['2026-11-23T02:59:00Z'], '2026-11-23T04:00:00Z'), true, 'o commit era de 22/11');
  // Vale o mais velho das raízes.
  assert.equal(precisaRecriar(['2026-11-23T20:00:00Z', '2026-11-22T20:00:00Z'], '2026-11-23T21:00:00Z'), true);
  assert.equal(precisaRecriar(['2026-11-23T20:00:00-03:00'], '2026-11-23T21:00:00Z'), false);
  assert.equal(precisaRecriar([], '2026-11-23T21:00:00Z'), false);
  // Raiz de hoje com `agora` de ontem (medida das 23:59:50 que grava depois da recriação das 00:00:10): não recria.
  assert.equal(precisaRecriar(['2026-11-24T03:00:10Z'], '2026-11-24T02:59:50Z'), false);
  assert.equal(precisaRecriar(['2026-11-25T12:00:00Z'], '2026-11-23T12:00:00Z'), false);
});

test('a medida de ontem que grava depois da recriação não recria de novo, e a seguinte também não', async () => {
  const raiz = pasta();
  try {
    const remoto = novoRemoto(raiz);
    const arquivo = (nome) => () => ({ arquivos: { [`${nome}.json`]: {} }, mensagem: nome });
    // Ontem (22/11 em Assunção); à 00:00:10 de 23/11 um incidente recria o ramo.
    await gravar(raiz, remoto, 'a', { agora: '2026-11-22T20:00:00.000Z', operacao: arquivo('ontem') });
    const recriou = await gravar(raiz, remoto, 'b', { agora: '2026-11-23T03:00:10.000Z', operacao: arquivo('meia-noite') });
    assert.equal(recriou.recriou, true);
    // A medida das 23:59:50 de 22/11 grava depois: não recria (a raiz é de hoje).
    const atrasada = await gravar(raiz, remoto, 'c', { agora: '2026-11-23T02:59:50.000Z', operacao: arquivo('atrasada') });
    assert.equal(atrasada.recriou, false);
    // A próxima, já de 23/11, também não.
    const seguinte = await gravar(raiz, remoto, 'd', { agora: '2026-11-23T03:05:00.000Z', operacao: arquivo('seguinte') });
    assert.equal(seguinte.recriou, false);
    assert.equal(commits(raiz, remoto), 3);
    assert.equal(raizes(raiz, remoto).length, 1);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('classificar o push: só a recusa por gravação no meio vale nova tentativa', () => {
  const recusas = [
    '!\tHEAD:refs/heads/dados\t[rejected] (non-fast-forward)',
    '!\tHEAD:refs/heads/dados\t[rejected] (fetch first)',
    '!\tHEAD:refs/heads/dados\t[rejected] (stale info)',
    ' ! [rejected]        HEAD -> dados (stale info)',
    '!\tHEAD:refs/heads/dados\t[remote rejected] (failed to update ref)',
    "!\tHEAD:refs/heads/dados\t[remote rejected] (cannot lock ref 'refs/heads/dados': is at 1 but expected 2)",
    // O começo do ramo em dois gravadores: o outro criou a ref depois do anúncio e antes da atualização.
    '!\tHEAD:refs/heads/dados\t[remote rejected] (reference already exists)',
    [
      'To /tmp/remoto.git',
      ' ! [remote rejected] HEAD -> refs/heads/dados (reference already exists)',
      "error: failed to push some refs to '/tmp/remoto.git'",
    ].join('\n'),
    '!\tHEAD:refs/heads/dados\t[remote rejected] (incorrect old value provided)',
  ];
  for (const s of recusas) assert.equal(classificarPush(s), 'recusado', s);
  const outros = [
    // O mesmo motivo solto no stderr, sem a linha de rejected, não vale nova tentativa.
    "remote: error: cannot lock ref 'refs/heads/dados': reference already exists",
    // Uma linha de estado que o remoto injeta pelo stderr sai sempre com o prefixo `remote: `.
    'remote: !\tHEAD:refs/heads/dados\t[remote rejected] (reference already exists)',
    'remote:  ! [remote rejected] HEAD -> refs/heads/dados (reference already exists)',
    // O `already exists` do cliente (ao recusar trocar uma tag) não é corrida de ref.
    '!\trefs/tags/x:refs/tags/x\t[rejected] (already exists)',
    '!\tHEAD:refs/heads/dados\t[remote rejected] (pre-receive hook declined)',
    '!\tHEAD:refs/heads/dados\t[remote rejected] (protected branch hook declined)',
    "fatal: unable to access 'https://github.com/x/y/': Could not resolve host: github.com",
    'remote: Permission to x/y.git denied to github-actions[bot].',
    'fatal: Authentication failed',
    '',
  ];
  for (const s of outros) assert.equal(classificarPush(s), 'outro', s);
});

test('a espera tem variação e fica dentro dos limites', () => {
  assert.equal(esperaComVariacao(() => 0), 1000);
  assert.equal(esperaComVariacao(() => 0.999999), 4000);
  assert.equal(esperaComVariacao(() => 0.5, 0, 50), 25);
  for (let i = 0; i < 200; i += 1) {
    const ms = esperaComVariacao(Math.random, 0, 50);
    assert.ok(Number.isInteger(ms) && ms >= 0 && ms <= 50, String(ms));
  }
});

test('o ambiente do git: sem token, sem rastreio, sem configuração herdada; o cabeçalho só com o token', () => {
  const base = {
    PATH: '/bin',
    GH_TOKEN: 'segredo',
    GITHUB_TOKEN: 'segredo',
    GIT_TRACE: '1',
    GIT_TRACE_CURL: '1',
    GIT_CURL_VERBOSE: '1',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.pager',
    GIT_CONFIG_VALUE_0: 'x',
    GIT_CONFIG_PARAMETERS: "'a.b'='c'",
  };
  const sem = ambienteDoGit(base);
  assert.deepEqual(sem, { PATH: '/bin', LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0' });
  const com = ambienteDoGit(base, 'segredo');
  assert.equal(com.GH_TOKEN, undefined);
  assert.equal(com.GIT_CONFIG_COUNT, '1');
  assert.equal(com.GIT_CONFIG_KEY_0, 'http.https://github.com/.extraheader');
  assert.equal(com.GIT_CONFIG_VALUE_0, `AUTHORIZATION: basic ${Buffer.from('x-access-token:segredo').toString('base64')}`);
  assert.equal(semToken(`a ${cabecalhoDoToken('segredo')} b segredo`, 'segredo'), 'a *** b ***');
});

test('aplicarMedida é pura: a mesma medida dá o `publicar` dos dados de cada tentativa', () => {
  const medida = { instante: '2026-11-23T21:00:00.000Z', resultados: { app: 'ok', login: 'ok', banco: 'ok', satelite: 'sem_dado' }, fatos: { satelite: null } };
  const aplicar = (estado) => aplicarMedida({ config, estado, dias: {}, incidentes: [], medida, textos: TEXTOS });
  assert.equal(aplicar({ publicado_em: '2026-11-23T20:30:00.000Z' }).publicar, true);
  assert.equal(aplicar({ publicado_em: '2026-11-23T20:58:00.000Z' }).publicar, false);
  const antes = structuredClone(medida);
  aplicar({});
  assert.deepEqual(medida, antes, 'a medida não muda');
});

// --- O laço com git (scripts/gravar-dados.mjs) ---

function pasta() {
  return mkdtempSync(join(tmpdir(), 'status-gravar-'));
}

// O ambiente dos filhos: sem configuração global nem do sistema (sem assinatura, sem gancho de quem roda).
function ambiente(raiz, extra = {}) {
  return { PATH: process.env.PATH, HOME: raiz, GIT_CONFIG_GLOBAL: devNull, GIT_CONFIG_NOSYSTEM: '1', ...extra };
}

function git(raiz, cwd, ...args) {
  return execFileSync('git', args, { cwd, env: ambiente(raiz), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function novoRemoto(raiz) {
  const remoto = join(raiz, 'remoto.git');
  git(raiz, raiz, 'init', '-q', '--bare', remoto);
  return remoto;
}

const noRamo = (raiz, remoto, nome) => JSON.parse(git(raiz, raiz, '--git-dir', remoto, 'show', `refs/heads/dados:${nome}`));
const commits = (raiz, remoto) => Number(git(raiz, raiz, '--git-dir', remoto, 'rev-list', '--count', 'refs/heads/dados'));
const raizes = (raiz, remoto) =>
  git(raiz, raiz, '--git-dir', remoto, 'rev-list', '--max-parents=0', 'refs/heads/dados').trim().split('\n');
const existeRamo = (raiz, remoto) => {
  try {
    git(raiz, raiz, '--git-dir', remoto, 'rev-parse', '--verify', '-q', 'refs/heads/dados');
    return true;
  } catch {
    return false;
  }
};

const MEDIDA = {
  instante: '2026-11-23T21:00:00.000Z',
  resultados: { app: 'fora', login: 'sem_dado', banco: 'sem_dado', satelite: 'sem_dado' },
  fatos: { satelite: null },
};
const AGORA_DO_INCIDENTE = '2026-11-23T21:04:00.000Z';
const ID_DO_MANUAL = '20261123-2104-manual';
const ENTRADA = {
  ACAO: 'abrir',
  LINHAS: 'app',
  TIPO: 'fora',
  ESTADO: 'investigando',
  TITULO_PT: 'Falha no aplicativo',
  TITULO_ES: 'Falla en la aplicación',
  TEXTO_PT: 'Estamos investigando.',
  TEXTO_ES: 'Estamos investigando.',
};

// Uma gravação de incidente manual pela lógica (sem a CLI), para os ganchos.
function operacaoDoIncidente(instante = AGORA_DO_INCIDENTE, entrada = ENTRADA) {
  const minusculas = Object.fromEntries(Object.entries(entrada).map(([k, v]) => [k.toLowerCase(), v]));
  return (ler) => {
    const atual = ler('incidentes.json') ?? { incidentes: [] };
    const lista = aplicarAcaoManual({ incidentes: atual.incidentes, entrada: minusculas, config, instante });
    return { arquivos: { 'incidentes.json': { ...atual, incidentes: lista } }, mensagem: `Incidente (${instante})`, saida: null };
  };
}

function gravar(raiz, remoto, nome, opcoes) {
  return gravarNoRamo({
    arvore: join(raiz, nome),
    remoto,
    ambiente: ambiente(raiz),
    esperaMinMs: 0,
    esperaMaxMs: 50,
    avisar: () => {},
    ...opcoes,
  });
}

const checagem = (medida = MEDIDA) => ({ agora: medida.instante, operacao: operacaoDaChecagem({ config, medida }) });
const incidente = (instante = AGORA_DO_INCIDENTE) => ({ agora: instante, operacao: operacaoDoIncidente(instante) });

function rodarNode(args, env) {
  return new Promise((resolver) => {
    const filho = spawn(process.execPath, args, { cwd: RAIZ, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    filho.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    filho.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    filho.on('close', (status) => resolver({ status, stdout, stderr }));
  });
}

function cliDaChecagem(raiz, remoto, nome, extra = {}) {
  const medida = join(raiz, `${nome}-medida.json`);
  writeFileSync(medida, JSON.stringify(MEDIDA));
  return rodarNode(
    ['scripts/gravar-dados.mjs', '--medida', medida, '--arvore', join(raiz, nome), '--remoto', remoto, '--espera-min', '0', '--espera-max', '50'],
    ambiente(raiz, extra),
  );
}

function cliDoIncidente(raiz, remoto, nome, entrada = ENTRADA, agora = AGORA_DO_INCIDENTE) {
  return rodarNode(
    ['scripts/incidente.mjs', '--arvore', join(raiz, nome), '--remoto', remoto, '--agora', agora, '--espera-min', '0', '--espera-max', '50'],
    ambiente(raiz, entrada),
  );
}

// Os dois efeitos: a checagem (app fora 1 vez, no dia) e o incidente manual.
function temOsDoisEfeitos(raiz, remoto) {
  const estado = noRamo(raiz, remoto, 'estado.json');
  const dias = noRamo(raiz, remoto, 'dias.json');
  const { incidentes } = noRamo(raiz, remoto, 'incidentes.json');
  assert.equal(estado.verificado_em, MEDIDA.instante, 'a checagem gravou');
  assert.equal(estado.linhas.app.fora_seguidas, 1);
  assert.equal(dias.app['2026-11-23'].fora, 1);
  assert.deepEqual(incidentes.map((i) => i.id), [ID_DO_MANUAL], 'o incidente gravou');
}

test('(a) uma checagem e um incidente ao mesmo tempo, em dois processos: o dados tem os dois efeitos', async () => {
  const raiz = pasta();
  try {
    const remoto = novoRemoto(raiz);
    const saidaDoJob = join(raiz, 'github-output');
    writeFileSync(saidaDoJob, '');
    const [c, i] = await Promise.all([
      cliDaChecagem(raiz, remoto, 'arvore-checagem', { GITHUB_OUTPUT: saidaDoJob }),
      cliDoIncidente(raiz, remoto, 'arvore-incidente'),
    ]);
    assert.equal(c.status, 0, c.stderr);
    assert.equal(i.status, 0, i.stderr);
    assert.match(i.stdout, new RegExp(`Incidente aberto: ${ID_DO_MANUAL}`));
    temOsDoisEfeitos(raiz, remoto);
    assert.equal(commits(raiz, remoto), 2);
    assert.equal(readFileSync(saidaDoJob, 'utf8'), 'publicar=true\n', 'o output vem do gravar-dados');
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('D18: três incidentes manuais e uma checagem ao mesmo tempo, em quatro processos: o dados tem os quatro efeitos', async () => {
  const raiz = pasta();
  try {
    const remoto = novoRemoto(raiz);
    // O ramo já existe (de hoje): as recusas são as de avanço rápido, sem recriação.
    await gravar(raiz, remoto, 'semente', { agora: '2026-11-23T20:00:00.000Z', operacao: () => ({ arquivos: {}, mensagem: 'semente' }) });
    // Um minuto diferente para cada manual (o id é AAAAMMDD-HHMM-manual).
    const horas = ['2026-11-23T21:04:00.000Z', '2026-11-23T21:05:00.000Z', '2026-11-23T21:06:00.000Z'];
    const ids = ['20261123-2104-manual', '20261123-2105-manual', '20261123-2106-manual'];
    const todos = await Promise.all([
      cliDaChecagem(raiz, remoto, 'arvore-checagem'),
      ...horas.map((agora, n) => cliDoIncidente(raiz, remoto, `arvore-incidente-${n}`, ENTRADA, agora)),
    ]);
    // Com 4 tentativas e 4 gravadores, cada um é recusado no máximo 3 vezes (uma por gravação dos outros).
    for (const r of todos) assert.equal(r.status, 0, r.stderr);
    for (const [n, r] of todos.slice(1).entries()) assert.match(r.stdout, new RegExp(`Incidente aberto: ${ids[n]}`));
    const estado = noRamo(raiz, remoto, 'estado.json');
    const dias = noRamo(raiz, remoto, 'dias.json');
    const { incidentes } = noRamo(raiz, remoto, 'incidentes.json');
    assert.equal(estado.verificado_em, MEDIDA.instante, 'a checagem gravou');
    assert.equal(estado.linhas.app.fora_seguidas, 1);
    assert.equal(dias.app['2026-11-23'].fora, 1);
    assert.deepEqual(incidentes.map((i) => i.id).sort(), ids, 'os três incidentes gravaram');
    assert.equal(commits(raiz, remoto), 5, 'a semente e as quatro gravações');
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('(a) a outra gravação entre o fetch e o push: o push é recusado, a tentativa se repete e nada se perde', async () => {
  const raiz = pasta();
  try {
    const remoto = novoRemoto(raiz);
    // O ramo já existe (de hoje), para a recusa ser a de avanço rápido.
    await gravar(raiz, remoto, 'semente', { agora: '2026-11-23T20:00:00.000Z', operacao: () => ({ arquivos: {}, mensagem: 'semente' }) });
    const avisos = [];
    const r = await gravar(raiz, remoto, 'arvore-checagem', {
      ...checagem(),
      avisar: (t) => avisos.push(t),
      antesDoPush: async ({ tentativa }) => {
        if (tentativa !== 1) return;
        const i = await cliDoIncidente(raiz, remoto, 'arvore-incidente');
        assert.equal(i.status, 0, i.stderr);
      },
    });
    assert.equal(r.tentativas, 2);
    assert.equal(r.recriou, false);
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /Push recusado.*Nova tentativa \(2 de 4\)/);
    temOsDoisEfeitos(raiz, remoto);
    assert.equal(commits(raiz, remoto), 3);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('(a) o publicar sai da tentativa que gravou, calculado contra os dados dela', async () => {
  const raiz = pasta();
  try {
    const remoto = novoRemoto(raiz);
    const ok = { app: 'ok', login: 'ok', banco: 'ok', satelite: 'sem_dado' };
    const medida = (instante) => ({ instante, resultados: ok, fatos: { satelite: null } });
    // Publicado há 30 min: na 1ª tentativa daria publicar=true.
    await gravar(raiz, remoto, 'semente', checagem(medida('2026-11-23T20:30:00.000Z')));
    const r = await gravar(raiz, remoto, 'arvore', {
      ...checagem(medida('2026-11-23T21:00:00.000Z')),
      antesDoPush: async ({ tentativa }) => {
        // Outra checagem publica às 20:58 no meio: a 2ª tentativa vê o publicado_em novo.
        if (tentativa === 1) await gravar(raiz, remoto, 'outra', checagem(medida('2026-11-23T20:58:00.000Z')));
      },
    });
    assert.equal(r.tentativas, 2);
    assert.equal(r.saida.publicar, false);
    assert.equal(noRamo(raiz, remoto, 'estado.json').publicado_em, '2026-11-23T20:58:00.000Z');
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('(b) recriação diária: vira um commit só; com uma gravação no meio, o lease recusa e a do meio fica', async () => {
  const raiz = pasta();
  try {
    const remoto = novoRemoto(raiz);
    // Ontem (22/11 em Assunção): três gravações.
    for (const hora of ['12', '15', '18']) {
      await gravar(raiz, remoto, 'ontem', { agora: `2026-11-22T${hora}:00:00.000Z`, operacao: () => ({ arquivos: { [`ontem-${hora}.json`]: { hora } }, mensagem: hora }) });
    }
    assert.equal(commits(raiz, remoto), 3);

    const avisos = [];
    const r = await gravar(raiz, remoto, 'arvore-checagem', {
      ...checagem(),
      avisar: (t) => avisos.push(t),
      antesDoPush: async ({ tentativa }) => {
        // Uma gravação de ontem que chega no meio (a do meio não recria: o ramo ainda é do dia dela).
        if (tentativa === 1) {
          const meio = await gravar(raiz, remoto, 'arvore-meio', incidente('2026-11-23T02:30:00.000Z'));
          assert.equal(meio.recriou, false);
        }
      },
    });
    assert.equal(r.tentativas, 2, 'o lease recusou a 1ª');
    assert.equal(r.recriou, true);
    assert.match(avisos[0], /Push recusado/);
    assert.equal(commits(raiz, remoto), 1, 'um commit só');
    assert.equal(raizes(raiz, remoto).length, 1);
    // Nada se perdeu: os arquivos de ontem, a gravação do meio e a checagem.
    for (const hora of ['12', '15', '18']) assert.deepEqual(noRamo(raiz, remoto, `ontem-${hora}.json`), { hora });
    const { incidentes } = noRamo(raiz, remoto, 'incidentes.json');
    assert.deepEqual(incidentes.map((i) => i.id), ['20261123-0230-manual'], 'a gravação do meio continua lá');
    assert.equal(noRamo(raiz, remoto, 'estado.json').verificado_em, MEDIDA.instante);
    assert.match(git(raiz, raiz, '--git-dir', remoto, 'log', '-1', '--format=%s', 'refs/heads/dados'), /^Dados: recriados\. Checagem/);

    // No mesmo dia, a próxima gravação só soma um commit.
    const depois = await gravar(raiz, remoto, 'arvore-incidente', incidente());
    assert.equal(depois.recriou, false);
    assert.equal(commits(raiz, remoto), 2);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('(c) primeira gravação com o ramo inexistente', async () => {
  const raiz = pasta();
  try {
    const remoto = novoRemoto(raiz);
    assert.equal(existeRamo(raiz, remoto), false);
    const r = await gravar(raiz, remoto, 'arvore', checagem());
    assert.deepEqual([r.tentativas, r.criou, r.recriou], [1, true, false]);
    assert.equal(commits(raiz, remoto), 1);
    assert.equal(noRamo(raiz, remoto, 'estado.json').verificado_em, MEDIDA.instante);
    assert.deepEqual(noRamo(raiz, remoto, 'incidentes.json'), { incidentes: [] });
    const [autor, data, assunto] = git(raiz, raiz, '--git-dir', remoto, 'log', '-1', '--format=%an <%ae>%n%cI%n%s', 'refs/heads/dados')
      .trim()
      .split('\n');
    assert.equal(autor, 'github-actions[bot] <41898282+github-actions[bot]@users.noreply.github.com>');
    assert.equal(Date.parse(data), Date.parse(MEDIDA.instante), 'o commit leva a hora da medida');
    assert.match(assunto, /^Dados: começo\. Checagem \(2026-11-23T21:00:00\.000Z\)$/);
    // Só os três JSON vão ao ramo.
    assert.deepEqual(git(raiz, raiz, '--git-dir', remoto, 'ls-tree', '--name-only', 'refs/heads/dados').trim().split('\n'), [
      'dias.json',
      'estado.json',
      'incidentes.json',
    ]);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('(c) dois começos ao mesmo tempo: o segundo é recusado e grava por cima do primeiro', async () => {
  const raiz = pasta();
  try {
    const remoto = novoRemoto(raiz);
    const r = await gravar(raiz, remoto, 'arvore-checagem', {
      ...checagem(),
      antesDoPush: async ({ tentativa }) => {
        if (tentativa === 1) assert.equal((await gravar(raiz, remoto, 'arvore-incidente', incidente())).criou, true);
      },
    });
    assert.deepEqual([r.tentativas, r.criou], [2, false]);
    temOsDoisEfeitos(raiz, remoto);
    assert.equal(commits(raiz, remoto), 2);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('(c) o outro começo chega entre o anúncio das refs e a atualização: a ref já criada (reference already exists) vale nova tentativa', async (t) => {
  const raiz = pasta();
  try {
    const remoto = novoRemoto(raiz);
    // O commit do outro gravador, feito antes num segundo remoto e trazido para o do teste numa ref auxiliar.
    const outro = join(raiz, 'outro.git');
    git(raiz, raiz, 'init', '-q', '--bare', outro);
    assert.equal((await gravar(raiz, outro, 'arvore-outro', incidente())).criou, true);
    git(raiz, raiz, '--git-dir', remoto, 'fetch', '-q', outro, 'refs/heads/dados:refs/preparado/outro');
    const preparado = git(raiz, raiz, '--git-dir', remoto, 'rev-parse', '--verify', 'refs/preparado/outro').trim();
    assert.equal(existeRamo(raiz, remoto), false);

    // Só no primeiro push: depois de o receive-pack anunciar as refs (sem o dados), o gancho cria o dados com o
    // commit do outro. Fora da quarentena, que o git não deixa atualizar ref de dentro dela.
    // A marca fica no próprio remoto bare, a pasta em que o pre-receive roda.
    const gancho = join(remoto, 'hooks', 'pre-receive');
    writeFileSync(
      gancho,
      [
        '#!/bin/sh',
        'cat >/dev/null',
        'if [ ! -e ./gancho-rodou ]; then',
        '  : >./gancho-rodou',
        `  (unset GIT_QUARANTINE_PATH GIT_OBJECT_DIRECTORY GIT_ALTERNATE_OBJECT_DIRECTORIES; git update-ref refs/heads/dados ${preparado} '') || exit 1`,
        'fi',
        'exit 0',
        '',
      ].join('\n'),
    );
    chmodSync(gancho, 0o755);

    const pushes = [];
    const avisos = [];
    const r = await gravar(raiz, remoto, 'arvore-checagem', {
      ...checagem(),
      avisar: (texto) => avisos.push(texto),
      git: async (args, o) => {
        const feito = await executarGit(args, o);
        if (args[0] === 'push') pushes.push(feito);
        return feito;
      },
    });

    // A primeira tentativa foi recusada pela ref já criada, não por «fetch first». Cada versão do git relata de um
    // jeito na linha `[remote rejected]` (`reference already exists` ou `failed to update ref`); a causa de fundo,
    // `reference already exists`, aparece na saída nas duas.
    const primeiro = `${pushes[0].saida}\n${pushes[0].erro}`;
    const recusa = primeiro.split('\n').find((linha) => linha.includes('[remote rejected]'));
    t.diagnostic(`primeiro push: ${recusa}`);
    assert.notEqual(pushes[0].codigo, 0);
    // No git mais velho (`failed to update ref`), este teste passaria mesmo sem o motivo novo em RECUSAS; a guarda
    // da regex são os casos puros de «classificar o push».
    assert.match(recusa ?? '', /\[remote rejected\][^\n]*\((reference already exists|failed to update ref)\)/, primeiro);
    assert.ok(primeiro.includes('reference already exists'), primeiro);
    assert.ok(!primeiro.includes('fetch first'), primeiro);

    assert.ok(existsSync(join(remoto, 'gancho-rodou')), 'o gancho gravou a marca no remoto');
    assert.equal(pushes.length, 2);
    assert.deepEqual([r.tentativas, r.criou], [2, false]);
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /Push recusado.*Nova tentativa \(2 de 4\)/);
    temOsDoisEfeitos(raiz, remoto);
    assert.equal(commits(raiz, remoto), 2);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('(d) esgotar as tentativas falha com mensagem clara; nada desta gravação fica', async () => {
  const raiz = pasta();
  try {
    const remoto = novoRemoto(raiz);
    const esperas = [];
    let outras = 0;
    await assert.rejects(
      gravar(raiz, remoto, 'arvore', {
        ...checagem(),
        esperar: async (ms) => esperas.push(ms),
        antesDoPush: async () => {
          outras += 1;
          await gravar(raiz, remoto, 'outra', { agora: AGORA_DO_INCIDENTE, operacao: () => ({ arquivos: { [`outra-${outras}.json`]: {} }, mensagem: 'outra' }) });
        },
      }),
      (erro) => {
        assert.ok(erro instanceof FalhaDaGravacao);
        assert.match(erro.message, /O push foi recusado nas 4 tentativas.*Nada desta execução foi gravado/);
        return true;
      },
    );
    assert.equal(outras, 4);
    assert.equal(esperas.length, 3, 'espera entre as tentativas, não depois da última');
    for (const ms of esperas) assert.ok(ms >= 0 && ms <= 50);
    assert.equal(commits(raiz, remoto), 4, 'só as outras gravações');
    assert.throws(() => noRamo(raiz, remoto, 'estado.json'));
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('(d) outro erro de git falha na hora, sem nova tentativa', async () => {
  const raiz = pasta();
  try {
    // Remoto que não existe: o ls-remote falha.
    let chamadas = 0;
    const contar = (args, o) => ((chamadas += args[0] === 'ls-remote'), executarGit(args, o));
    await assert.rejects(gravar(raiz, join(raiz, 'nao-existe.git'), 'a', { ...checagem(), git: contar }), (erro) => {
      assert.ok(erro instanceof FalhaDaGravacao);
      assert.match(erro.message, /^git ls-remote falhou \(código 128\)/);
      return true;
    });
    assert.equal(chamadas, 1);

    // O remoto recusa por outro motivo (um gancho): falha na 1ª, sem nova tentativa.
    const remoto = novoRemoto(raiz);
    const gancho = join(remoto, 'hooks', 'pre-receive');
    writeFileSync(gancho, '#!/bin/sh\nexit 1\n');
    chmodSync(gancho, 0o755);
    let pushes = 0;
    const contarPush = (args, o) => ((pushes += args[0] === 'push'), executarGit(args, o));
    await assert.rejects(gravar(raiz, remoto, 'b', { ...checagem(), git: contarPush }), /git push falhou \(código 1\) sem ser recusa/);
    assert.equal(pushes, 1);
    assert.equal(existeRamo(raiz, remoto), false);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('incidente: erro de entrada falha antes de qualquer git; erro que depende dos dados falha sem push', async () => {
  const raiz = pasta();
  try {
    const remoto = novoRemoto(raiz);
    // Antes de qualquer git: nem a pasta da árvore é criada.
    const antes = await cliDoIncidente(raiz, remoto, 'arvore-1', { ...ENTRADA, TITULO_PT: 'a <b>' });
    assert.equal(antes.status, 1);
    assert.match(antes.stderr, /^Erro: .+ Nada foi gravado\./);
    assert.equal(existsSync(join(raiz, 'arvore-1')), false);

    // Contra os dados: atualizar um id que não existe.
    await gravar(raiz, remoto, 'semente', checagem());
    const entrada = { ACAO: 'atualizar', ID: '20261123-1947-banco', ESTADO: 'monitorando', TEXTO_PT: 'x', TEXTO_ES: 'y' };
    const r = await cliDoIncidente(raiz, remoto, 'arvore-2', entrada);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^Erro: Não existe incidente com o id 20261123-1947-banco\. Nada foi gravado\./);
    assert.equal(commits(raiz, remoto), 1, 'sem push');

    // Abrir duas vezes no mesmo minuto: a segunda vê o id no arquivo recém-lido.
    assert.equal((await cliDoIncidente(raiz, remoto, 'arvore-3')).status, 0);
    const dupla = await cliDoIncidente(raiz, remoto, 'arvore-4');
    assert.equal(dupla.status, 1);
    assert.match(dupla.stderr, /Já existe um incidente com o id 20261123-2104-manual/);
    assert.equal(commits(raiz, remoto), 2);
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('(e) o token só vai ao push, pelo ambiente; nunca em argv nem a outro git', async () => {
  const raiz = pasta();
  try {
    const remoto = novoRemoto(raiz);
    const token = 'tok-de-teste-123';
    const base64 = Buffer.from(`x-access-token:${token}`).toString('base64');
    const chamadas = [];
    const gravarComToken = (nome, opcoes) =>
      gravar(raiz, remoto, nome, {
        ...opcoes,
        ambiente: ambiente(raiz, { GH_TOKEN: token }),
        git: (args, o) => (chamadas.push({ args, env: o.env }), executarGit(args, o)),
      });
    await gravarComToken('a', checagem());
    // Uma segunda com recusa no meio, para passar por mais de um push.
    await gravarComToken('b', {
      ...incidente(),
      antesDoPush: async ({ tentativa }) => {
        if (tentativa === 1) await gravar(raiz, remoto, 'meio', checagem({ ...MEDIDA, instante: '2026-11-23T21:05:00.000Z' }));
      },
    });

    const pushes = chamadas.filter((c) => c.args[0] === 'push');
    assert.equal(pushes.length, 3);
    for (const { args, env } of chamadas) {
      for (const a of args) {
        for (const proibido of [token, base64, 'extraheader', 'AUTHORIZATION', 'GH_TOKEN']) {
          assert.ok(!a.includes(proibido), `argv com ${proibido}: ${args.join(' ')}`);
        }
      }
      assert.equal(env.GH_TOKEN, undefined, `GH_TOKEN no git ${args[0]}`);
      assert.ok(!Object.values(env).some((v) => v.includes(token)), `token cru no ambiente do git ${args[0]}`);
      if (args[0] === 'push') {
        assert.equal(env.GIT_CONFIG_COUNT, '1');
        assert.equal(env.GIT_CONFIG_KEY_0, 'http.https://github.com/.extraheader');
        assert.equal(env.GIT_CONFIG_VALUE_0, `AUTHORIZATION: basic ${base64}`);
        assert.deepEqual(args.slice(-2), ['origin', 'HEAD:refs/heads/dados'], 'o refspec é sempre HEAD:refs/heads/dados');
        assert.ok(!args.some((a) => a === '--force' || a === '-f' || a.startsWith('+')), 'nenhum outro push forçado');
      } else {
        for (const k of ['GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0', 'GIT_CONFIG_VALUE_0']) {
          assert.equal(env[k], undefined, `${k} no git ${args.join(' ')}`);
        }
      }
    }

    // Sem GH_TOKEN (os testes), push sem cabeçalho.
    const semToken = [];
    await gravar(raiz, remoto, 'c', { ...incidente('2026-11-23T21:10:00.000Z'), git: (args, o) => (semToken.push(o.env), executarGit(args, o)) });
    assert.ok(semToken.every((env) => env.GIT_CONFIG_COUNT === undefined));
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('(e) a CLI não imprime o token nem o cabeçalho', async () => {
  const raiz = pasta();
  try {
    const remoto = novoRemoto(raiz);
    const token = 'tok-de-teste-456';
    const r = await cliDaChecagem(raiz, remoto, 'arvore', { GH_TOKEN: token, GIT_TRACE: '1', GIT_TRACE_CURL: '1' });
    assert.equal(r.status, 0, r.stderr);
    const tudo = r.stdout + r.stderr;
    assert.ok(!tudo.includes(token));
    assert.ok(!tudo.includes(Buffer.from(`x-access-token:${token}`).toString('base64')));
    assert.ok(!/trace|AUTHORIZATION/i.test(tudo), 'sem rastreio do git');
  } finally {
    rmSync(raiz, { recursive: true, force: true });
  }
});

test('os workflows: a checagem no seu grupo sem cancelar, o incidente sem grupo (D18), token só por env, entrada fora do run, sem outro push', () => {
  for (const nome of ['checagem', 'incidente']) {
    const yml = readFileSync(join(RAIZ, '.github', 'workflows', `${nome}.yml`), 'utf8');
    if (nome === 'checagem') {
      assert.match(yml, /^concurrency:\n  group: checagem\n  cancel-in-progress: false\n/m, nome);
    } else {
      // D18: um terceiro incidente pendente cancelaria o do meio; o laço de gravação (D13) já protege o dado.
      assert.ok(!/^\s*concurrency:/m.test(yml), 'o incidente não tem grupo de concurrency');
    }
    assert.match(yml, /GH_TOKEN: \$\{\{ github\.token \}\}/);
    assert.ok(!/secrets\./.test(yml), `${nome}: sem secrets`);
    assert.ok(!/\bgit (push|commit|fetch|worktree)\b/.test(yml), `${nome}: o git fica no script`);
    assert.match(yml, /persist-credentials: false/);
    // Nenhum `${{ }}` dentro de um run:.
    const runs = [...yml.matchAll(/^( *)run: [>|]-?\n((?:\1  .*\n)+)|^ *run: (.*)$/gm)].map((m) => m[2] ?? m[3]);
    assert.ok(runs.length > 0);
    for (const run of runs) assert.ok(!run.includes('${{'), `${nome}: ${run}`);
  }
  const checagemYml = readFileSync(join(RAIZ, '.github', 'workflows', 'checagem.yml'), 'utf8');
  assert.match(checagemYml, /publicar: \$\{\{ steps\.gravar\.outputs\.publicar \}\}/);
  assert.match(checagemYml, /--medida "\$RUNNER_TEMP\/medida\.json"/);
});
