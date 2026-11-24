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

function rodar(dir, entrada, agora = '2026-11-23T21:04:00Z', config = null) {
  const env = { PATH: process.env.PATH };
  for (const [k, v] of Object.entries(entrada)) env[k] = v;
  const args = [SCRIPT, '--dados', dir, '--agora', agora, ...(config ? ['--config', config] : [])];
  return spawnSync(process.execPath, args, { cwd: RAIZ, env, encoding: 'utf8' });
}

const ler = (dir) => JSON.parse(readFileSync(join(dir, 'incidentes.json'), 'utf8')).incidentes;

const ABRIR = {
  ACAO: 'abrir',
  LINHAS: 'app',
  TIPO: 'fora',
  ESTADO: 'investigando',
  TITULO_PT: 'Falha no aplicativo',
  TITULO_ES: 'Falla en la aplicación',
  TEXTO_PT: 'Estamos investigando.',
  TEXTO_ES: 'Estamos investigando.',
};

test('abrir grava o manual com id AAAAMMDD-HHMM-manual', () => {
  const dir = pasta();
  const r = rodar(dir, ABRIR);
  assert.equal(r.status, 0, r.stderr);
  const novo = ler(dir).find((i) => i.origem === 'manual');
  assert.equal(novo.id, '20261123-2104-manual');
  assert.deepEqual(novo.linhas, ['app']);
  assert.equal(novo.tipo, 'fora');
  assert.equal(novo.inicio, '2026-11-23T21:04:00.000Z');
  assert.equal(novo.fim, null);
  assert.deepEqual(novo.titulo, { 'pt-BR': 'Falha no aplicativo', 'es-PY': 'Falla en la aplicación' });
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
// D17: hoje login, banco e satélite estão em breve. As regras de D11 valem para quando voltarem: o config real sem
// `em_breve` (e um arquivo dele, para a CLI).
const configDaRota = { linhas: config.linhas.map(({ em_breve: _emBreve, ...l }) => l) };
function arquivoDaRota() {
  const p = mkdtempSync(join(tmpdir(), 'status-incidente-config-'));
  pastas.push(p);
  const arquivo = join(p, 'alvos.json');
  writeFileSync(arquivo, JSON.stringify(configDaRota));
  return arquivo;
}
function aplicar(troca, cfg = config) {
  const entrada = {};
  for (const [k, v] of Object.entries({ ...ABRIR, ...troca })) entrada[k.toLowerCase()] = v;
  return aplicarAcaoManual({ incidentes: [], entrada, config: cfg, instante: '2026-11-23T21:04:00.000Z' });
}

test('D17: abrir numa linha em breve é recusado com mensagem clara, sem gravar nada; app aceita', () => {
  for (const linhas of ['login', 'banco', 'satelite', 'app, banco']) {
    const id = linhas.split(',').map((s) => s.trim()).find((s) => s !== 'app');
    assert.throws(
      () => aplicar({ LINHAS: linhas, TIPO: 'degradado' }),
      new RegExp(`^Error: A linha ${id} está «em breve»: ainda não é checada e não recebe incidente\\. Hoje só aceita: app\\.$`),
    );
    const dir = pasta();
    const antes = readFileSync(join(dir, 'incidentes.json'), 'utf8');
    const r = rodar(dir, { ...ABRIR, LINHAS: linhas, TIPO: 'degradado' });
    assert.equal(r.status, 1, linhas);
    assert.match(r.stderr, new RegExp(`^Erro: A linha ${id} está «em breve».+ Nada foi gravado\\.$`, 'm'));
    assert.equal(readFileSync(join(dir, 'incidentes.json'), 'utf8'), antes, 'o arquivo fica igual');
  }
  // Sem incidentes.json, a recusa também não cria o arquivo.
  const vazia = mkdtempSync(join(tmpdir(), 'status-incidente-'));
  pastas.push(vazia);
  assert.equal(rodar(vazia, { ...ABRIR, LINHAS: 'login' }).status, 1);
  assert.equal(existsSync(join(vazia, 'incidentes.json')), false);
  assert.deepEqual(aplicar({ LINHAS: 'app' })[0].linhas, ['app']);
});

test('D17: atualizar e resolver um automático antigo de linha em breve continuam aceitos', () => {
  const dir = pasta();
  const r = rodar(dir, { ACAO: 'resolver', ID: AUTOMATICO.id, TEXTO_PT: 'Resolvido.', TEXTO_ES: 'Resuelto.' });
  assert.equal(r.status, 0, r.stderr);
  assert.ok(ler(dir).find((i) => i.id === AUTOMATICO.id).fim);
});

test('linha pendente não aceita incidente; o satélite (D11) aceita quando não está em breve', () => {
  const comPendente = { linhas: [...config.linhas, { id: 'futura', nome: { 'pt-BR': 'x', 'es-PY': 'y' }, pendente: true }] };
  const entrada = {};
  for (const [k, v] of Object.entries({ ...ABRIR, LINHAS: 'futura' })) entrada[k.toLowerCase()] = v;
  assert.throws(
    () => aplicarAcaoManual({ incidentes: [], entrada, config: comPendente, instante: '2026-11-23T21:04:00.000Z' }),
    /^Error: O campo linhas tem uma linha desconhecida\. Use app\.$/,
  );
  assert.deepEqual(aplicar({ LINHAS: 'satelite', TIPO: 'degradado' }, configDaRota)[0].linhas, ['satelite']);
});

test('D11: abrir «fora» numa linha por fato é recusado, sem gravar nada; «degradado» passa', () => {
  // Pela lógica, com o config da rota e com outra linha por fato (a regra vem de `intervalo_s`, não do id).
  assert.throws(() => aplicar({ LINHAS: 'satelite' }, configDaRota), /A linha satelite não fica fora do ar/);
  assert.throws(() => aplicar({ LINHAS: 'app, satelite' }, configDaRota), /A linha satelite não fica fora do ar/);
  const outroFato = { linhas: [...config.linhas, { id: 'outra', nome: { 'pt-BR': 'x', 'es-PY': 'y' }, alvo: 'app', componente: 'outra', intervalo_s: 3600 }] };
  const entrada = {};
  for (const [k, v] of Object.entries({ ...ABRIR, LINHAS: 'outra' })) entrada[k.toLowerCase()] = v;
  assert.throws(
    () => aplicarAcaoManual({ incidentes: [], entrada, config: outroFato, instante: '2026-11-23T21:04:00.000Z' }),
    /A linha outra não fica fora do ar/,
  );
  assert.equal(aplicar({ LINHAS: 'app, satelite', TIPO: 'degradado' }, configDaRota)[0].tipo, 'degradado');
  // Pela CLI: falha com mensagem clara e o arquivo fica igual.
  const dir = pasta();
  const antes = readFileSync(join(dir, 'incidentes.json'), 'utf8');
  const r = rodar(dir, { ...ABRIR, LINHAS: 'satelite' }, undefined, arquivoDaRota());
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /^Erro: A linha satelite não fica fora do ar: use o tipo degradado/);
  assert.match(r.stderr, /Nada foi gravado\./);
  assert.equal(readFileSync(join(dir, 'incidentes.json'), 'utf8'), antes);
});

test('D11: recusa PU e cota como palavra inteira, sem pegar «pueden», «computador» nem «cotação»', () => {
  for (const texto of ['Acabou a cota do provedor', 'Sem COTAS', 'Consumo de PU', '10PU no mês', 'Faltan PUs', 'Sin cuota']) {
    assert.throws(() => aplicar({ TEXTO_PT: texto }), /contém "(PU|PUs|cota|cuota)"/, texto);
  }
  for (const texto of [
    'Las imágenes nuevas pueden demorar.',
    'Abra no computador.',
    'A cotação não muda.',
    'Plazo acotado.',
    'Imagens de satélite (Sentinel-2)',
    'Eu pus a correção no ar.',
  ]) {
    aplicar({ TEXTO_PT: texto });
  }
  for (const texto of ['Falha no Copernicus', 'Falla en Copérnico', 'Erro no CDSE', 'Sentinel Hub fora', 'sentinel-hub', 'Sentinel Hub', 'Sentinel — Hub', 'PUS']) {
    assert.throws(() => aplicar({ TITULO_ES: texto }), /contém/, texto);
  }
  // No texto a quebra de linha é aceita, mas não separa «Sentinel» de «Hub».
  assert.throws(() => aplicar({ TEXTO_PT: 'Sentinel\nHub' }), /contém "sentinel hub"/);
});

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
  // A linha desconhecida não é ecoada: só os ids válidos do config.
  assert.equal(r2.stderr, 'Erro: O campo linhas tem uma linha desconhecida. Use app. Nada foi gravado.\n');
  const r3 = rodar(dir, { ...ABRIR, LINHAS: 'app, agrodash-secreto' });
  assert.equal(r3.status, 1);
  assert.ok(!r3.stderr.includes('agrodash-secreto'), 'sem eco do texto livre');
});
