// D8: o incidente à mão. A CLI recusa cada entrada inválida sem gravar nada e grava as válidas.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { ErroDeEntrada, aplicarAcaoManual } from '../lib/manual.mjs';
import { TERMOS_PROIBIDOS } from '../lib/vazamento.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const SCRIPT = join(RAIZ, 'scripts', 'incidente.mjs');
const pastas = [];
after(() => {
  for (const p of pastas) rmSync(p, { recursive: true, force: true });
});

const AUTOMATICO = {
  id: '20261123-1947-banco',
  linhas: ['banco'],
  tipo: 'degradado',
  inicio: '2026-11-23T19:47:00Z',
  fim: null,
  origem: 'automatico',
  titulo: { 'pt-BR': 'Banco: instável', 'es-PY': 'Base: inestable' },
  atualizacoes: [{ em: '2026-11-23T19:57:00Z', estado: 'investigando', texto: { 'pt-BR': 'a', 'es-PY': 'b' } }],
};
const RESOLVIDO = { ...AUTOMATICO, id: '20261102-1312-app', linhas: ['app'], fim: '2026-11-02T14:02:00Z' };

function pasta(incidentes = [AUTOMATICO, RESOLVIDO]) {
  const p = mkdtempSync(join(tmpdir(), 'status-incidente-'));
  pastas.push(p);
  writeFileSync(join(p, 'incidentes.json'), `${JSON.stringify({ incidentes }, null, 2)}\n`);
  return p;
}

function rodar(dir, entrada, agora = '2026-11-23T21:04:00Z') {
  const env = { PATH: process.env.PATH };
  for (const [k, v] of Object.entries(entrada)) env[k] = v;
  return spawnSync(process.execPath, [SCRIPT, '--dados', dir, '--agora', agora], { cwd: RAIZ, env, encoding: 'utf8' });
}

const ler = (dir) => JSON.parse(readFileSync(join(dir, 'incidentes.json'), 'utf8')).incidentes;

const ABRIR = {
  ACAO: 'abrir',
  LINHAS: 'login, banco',
  TIPO: 'fora',
  ESTADO: 'investigando',
  TITULO_PT: 'Falha no login',
  TITULO_ES: 'Falla en el inicio de sesión',
  TEXTO_PT: 'Estamos investigando.',
  TEXTO_ES: 'Estamos investigando.',
};

test('abrir grava o manual com id AAAAMMDD-HHMM-manual', () => {
  const dir = pasta();
  const r = rodar(dir, ABRIR);
  assert.equal(r.status, 0, r.stderr);
  const novo = ler(dir).find((i) => i.origem === 'manual');
  assert.equal(novo.id, '20261123-2104-manual');
  assert.deepEqual(novo.linhas, ['login', 'banco']);
  assert.equal(novo.tipo, 'fora');
  assert.equal(novo.inicio, '2026-11-23T21:04:00.000Z');
  assert.equal(novo.fim, null);
  assert.deepEqual(novo.titulo, { 'pt-BR': 'Falha no login', 'es-PY': 'Falla en el inicio de sesión' });
  assert.deepEqual(novo.atualizacoes, [
    { em: '2026-11-23T21:04:00.000Z', estado: 'investigando', texto: { 'pt-BR': 'Estamos investigando.', 'es-PY': 'Estamos investigando.' } },
  ]);
});

test('abrir recusa cada entrada inválida, sem gravar nada', () => {
  const longo = (n) => 'a'.repeat(n);
  const invalidos = [
    { ACAO: 'apagar' },
    { ID: '20261123-2104-manual' },
    { LINHAS: '' },
    { LINHAS: 'app, agrodash' },
    { LINHAS: 'satelite' }, // pendente
    { LINHAS: 'app,app' },
    { TIPO: 'lento' },
    { TIPO: '' },
    { ESTADO: 'resolvido' },
    { ESTADO: 'pensando' },
    { TITULO_PT: '' },
    { TITULO_ES: '' },
    { TEXTO_PT: '' },
    { TEXTO_ES: '   ' },
    { TITULO_PT: longo(121) },
    { TEXTO_ES: longo(1001) },
    { TITULO_ES: 'Falha <b>grave</b>' },
    { TEXTO_PT: 'a > b' },
  ];
  for (const troca of invalidos) {
    const dir = pasta();
    const antes = readFileSync(join(dir, 'incidentes.json'), 'utf8');
    const r = rodar(dir, { ...ABRIR, ...troca });
    assert.notEqual(r.status, 0, `devia recusar ${JSON.stringify(troca)}`);
    assert.match(r.stderr, /^Erro: .+ Nada foi gravado\./);
    assert.equal(readFileSync(join(dir, 'incidentes.json'), 'utf8'), antes);
  }
});

test('os limites exatos passam: título de 120 e texto de 1000 caracteres', () => {
  const dir = pasta();
  const r = rodar(dir, { ...ABRIR, TITULO_PT: 'ã'.repeat(120), TEXTO_ES: 'ñ'.repeat(1000) });
  assert.equal(r.status, 0, r.stderr);
});

test('abrir duas vezes no mesmo minuto falha com mensagem clara', () => {
  const dir = pasta();
  assert.equal(rodar(dir, ABRIR).status, 0);
  const r = rodar(dir, ABRIR);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Já existe um incidente com o id 20261123-2104-manual/);
  assert.equal(ler(dir).filter((i) => i.origem === 'manual').length, 1);
});

test('sem incidentes.json, abrir começa a lista', () => {
  const dir = mkdtempSync(join(tmpdir(), 'status-incidente-'));
  pastas.push(dir);
  assert.equal(rodar(dir, ABRIR).status, 0);
  assert.equal(ler(dir).length, 1);
});

test('atualizar põe a causa no automático; títulos substituem; linhas e tipo são ignorados', () => {
  const dir = pasta();
  const r = rodar(dir, {
    ACAO: 'atualizar',
    ID: AUTOMATICO.id,
    LINHAS: 'app',
    TIPO: 'fora',
    ESTADO: 'identificado',
    TITULO_PT: 'Lentidão nos dados dos talhões',
    TITULO_ES: 'Lentitud en los datos de los lotes',
    TEXTO_PT: 'A causa foi identificada.',
    TEXTO_ES: 'La causa fue identificada.',
  });
  assert.equal(r.status, 0, r.stderr);
  const i = ler(dir).find((x) => x.id === AUTOMATICO.id);
  assert.equal(i.titulo['pt-BR'], 'Lentidão nos dados dos talhões');
  assert.deepEqual(i.linhas, ['banco']);
  assert.equal(i.tipo, 'degradado');
  assert.equal(i.fim, null);
  assert.equal(i.atualizacoes.at(-1).estado, 'identificado');
  assert.equal(i.atualizacoes.at(-1).texto['es-PY'], 'La causa fue identificada.');
});

test('atualizar sem título mantém o título', () => {
  const dir = pasta();
  const r = rodar(dir, { ACAO: 'atualizar', ID: AUTOMATICO.id, ESTADO: 'monitorando', TEXTO_PT: 'x', TEXTO_ES: 'y' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(ler(dir).find((x) => x.id === AUTOMATICO.id).titulo['pt-BR'], 'Banco: instável');
});

test('atualizar e resolver recusam entradas inválidas, sem gravar nada', () => {
  const base = { ACAO: 'atualizar', ID: AUTOMATICO.id, ESTADO: 'monitorando', TEXTO_PT: 'x', TEXTO_ES: 'y' };
  const invalidos = [
    { ID: '' },
    { ID: 'qualquer' },
    { ID: '20261123-1947-outra' },
    { ID: '20261123-1948-banco' }, // não existe
    { ID: RESOLVIDO.id }, // já resolvido
    { ESTADO: 'resolvido' },
    { TEXTO_ES: '' },
    { TITULO_PT: 'só um título' },
    { TEXTO_PT: '<script>' },
    { ACAO: 'resolver', ID: RESOLVIDO.id },
    { ACAO: 'resolver', ID: '' },
    { ACAO: 'resolver', TEXTO_PT: '' },
  ];
  for (const troca of invalidos) {
    const dir = pasta();
    const antes = readFileSync(join(dir, 'incidentes.json'), 'utf8');
    const r = rodar(dir, { ...base, ...troca });
    assert.notEqual(r.status, 0, `devia recusar ${JSON.stringify(troca)}`);
    assert.match(r.stderr, /^Erro: /);
    assert.equal(readFileSync(join(dir, 'incidentes.json'), 'utf8'), antes);
  }
});

test('resolver fecha com fim = agora e a atualização «resolvido»', () => {
  const dir = pasta();
  const r = rodar(dir, {
    ACAO: 'resolver',
    ID: AUTOMATICO.id,
    ESTADO: 'investigando', // ignorado
    TEXTO_PT: 'Resolvido.',
    TEXTO_ES: 'Resuelto.',
  });
  assert.equal(r.status, 0, r.stderr);
  const i = ler(dir).find((x) => x.id === AUTOMATICO.id);
  assert.equal(i.fim, '2026-11-23T21:04:00.000Z');
  assert.equal(i.atualizacoes.at(-1).estado, 'resolvido');
  assert.equal(i.atualizacoes.at(-1).texto['pt-BR'], 'Resolvido.');
});

test('--agora inválido falha sem gravar', () => {
  const dir = pasta();
  const r = rodar(dir, ABRIR, 'ontem');
  assert.notEqual(r.status, 0);
  assert.equal(ler(dir).length, 2);
  assert.ok(existsSync(join(dir, 'incidentes.json')));
});

test('recusa endereço e nome de fornecedor em título e texto (§1.4), sem diferenciar maiúscula', () => {
  for (const termo of TERMOS_PROIBIDOS) {
    for (const campo of ['TITULO_PT', 'TITULO_ES', 'TEXTO_PT', 'TEXTO_ES']) {
      const dir = pasta();
      const antes = readFileSync(join(dir, 'incidentes.json'), 'utf8');
      const r = rodar(dir, { ...ABRIR, [campo]: `Falha em ${termo.toUpperCase()}exemplo` });
      assert.notEqual(r.status, 0, `devia recusar ${termo} em ${campo}`);
      assert.match(r.stderr, new RegExp(`O campo ${campo.toLowerCase()} contém`));
      assert.equal(readFileSync(join(dir, 'incidentes.json'), 'utf8'), antes);
    }
  }
});

const config = JSON.parse(readFileSync(join(RAIZ, 'config', 'alvos.json'), 'utf8'));
function aplicar(troca) {
  const entrada = {};
  for (const [k, v] of Object.entries({ ...ABRIR, ...troca })) entrada[k.toLowerCase()] = v;
  return aplicarAcaoManual({ incidentes: [], entrada, config, instante: '2026-11-23T21:04:00.000Z' });
}

test('recusa caracteres de controle, de direção e de largura zero; no texto só \\n passa', () => {
  const proibidos = [
    '\u0000', '\u0001', '\u0009', '\u000D', '\u001B', '\u001F', '\u007F',
    '\u200B', '\u200C', '\u200D', '\u200E', '\u200F', '\u202A', '\u202B', '\u202C', '\u202D', '\u202E',
    '\u2060', '\u2066', '\u2067', '\u2068', '\u2069', '\uFEFF',
    '\u00AD', '\u061C', '\u2028', '\u2029', '\u{E0000}', '\u{E0001}', '\u{E0041}', '\u{E007F}',
  ];
  for (const c of proibidos) {
    for (const campo of ['TITULO_PT', 'TITULO_ES', 'TEXTO_PT', 'TEXTO_ES']) {
      assert.throws(() => aplicar({ [campo]: `antes${c}depois` }), ErroDeEntrada, `${campo} com U+${c.codePointAt(0).toString(16)}`);
    }
  }
  // Etiqueta fora do BMP: a mensagem traz o code point inteiro, não a metade do par substituto.
  assert.throws(() => aplicar({ TEXTO_ES: 'ok\u{E0041}' }), /\(U\+E0041\)/);
  // Vizinhos das faixas continuam aceitos.
  for (const c of ['\u00AC', '\u061B', '\u202F', '\u{DFFFF}', '\u{E0080}']) aplicar({ TEXTO_PT: `a${c}b` });
  assert.throws(() => aplicar({ TITULO_PT: 'linha\nquebrada' }), /caractere de controle ou invisível \(U\+000A\)/);
  const lista = aplicar({ TEXTO_PT: 'primeira linha\nsegunda linha' });
  assert.equal(lista[0].atualizacoes[0].texto['pt-BR'], 'primeira linha\nsegunda linha');
});

test('pela CLI: caractere invisível é recusado, e a mensagem não ecoa o texto livre', () => {
  const dir = pasta();
  const r = rodar(dir, { ...ABRIR, TITULO_ES: 'Falla\u202Eoculta' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /U\+202E/);
  assert.ok(!r.stderr.includes('oculta'));
  const r2 = rodar(dir, { ...ABRIR, LINHAS: 'app, x\nErro: falso' });
  assert.notEqual(r2.status, 0);
  assert.equal(r2.stderr.trim().split('\n').length, 1, 'a mensagem fica numa linha só');
  assert.match(r2.stderr, /"x\\nErro: falso"/);
});
