// D7 e D9: os dados de exemplo, o site montado (sem vazamento) e o catálogo.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { TERMOS_PROIBIDOS } from '../lib/vazamento.mjs';
import { TEXTOS } from '../site/textos.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const config = JSON.parse(readFileSync(join(RAIZ, 'config', 'alvos.json'), 'utf8'));
const pastas = [];
after(() => {
  for (const p of pastas) rmSync(p, { recursive: true, force: true });
});
function temporaria() {
  const p = mkdtempSync(join(tmpdir(), 'status-site-'));
  pastas.push(p);
  return p;
}
function node(...args) {
  return execFileSync(process.execPath, args, { cwd: RAIZ, encoding: 'utf8' });
}
function arquivos(dir) {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    return statSync(caminho).isDirectory() ? arquivos(caminho) : [caminho];
  });
}

test('os arquivos de exemplo são os que o gerador produz', () => {
  const dir = temporaria();
  node('scripts/gerar-exemplo.mjs', '--saida', dir);
  for (const nome of ['estado.json', 'dias.json', 'incidentes.json']) {
    assert.equal(readFileSync(join(dir, nome), 'utf8'), readFileSync(join(RAIZ, 'exemplo', nome), 'utf8'), nome);
  }
});

test('o exemplo cobre o cenário de D7', () => {
  const ler = (nome) => JSON.parse(readFileSync(join(RAIZ, 'exemplo', nome), 'utf8'));
  const estado = ler('estado.json');
  const dias = ler('dias.json');
  const { exemplo, incidentes } = ler('incidentes.json');
  assert.equal(estado.exemplo, true);
  assert.equal(dias.exemplo, true);
  assert.equal(exemplo, true);
  assert.equal(estado.agora, '2026-11-23T21:00:00Z');
  assert.ok(incidentes.some((i) => i.fim === null && i.tipo === 'degradado'), 'degradado aberto');
  assert.ok(incidentes.some((i) => i.fim && i.origem === 'manual'), 'manual resolvido');
  assert.ok(incidentes.some((i) => i.fim && i.origem === 'automatico'), 'automático resolvido');
  const registros = Object.entries(dias).filter(([k]) => k !== 'exemplo').flatMap(([, d]) => Object.values(d));
  assert.ok(registros.some((r) => r.minutos_fora >= 30), 'dia vermelho');
  assert.ok(registros.some((r) => r.minutos_fora > 0 && r.minutos_fora < 30), 'dia amarelo');
  assert.ok(registros.some((r) => r.feitas < 144), 'dia cinza');
  assert.ok(Object.keys(dias.satelite).length > 0, 'satélite com dados');
});

test('o site montado não vaza endereço, fornecedor nem dado interno', () => {
  const dir = temporaria();
  node('scripts/montar-site.mjs', '--fonte', 'exemplo', '--saida', dir);
  const proibidos = [...TERMOS_PROIBIDOS];
  for (const t of ['develop', 'vercel', 'workers.dev', 'supabase', 'cloudflare', 'http://', 'https://']) {
    assert.ok(proibidos.includes(t), `a lista tem ${t}`);
  }
  for (const l of config.linhas) if (l.url) proibidos.push(l.url);
  const lista = arquivos(dir);
  assert.ok(lista.length >= 8);
  for (const arquivo of lista) {
    const texto = readFileSync(arquivo, 'utf8').toLowerCase();
    for (const p of proibidos) assert.ok(!texto.includes(p.toLowerCase()), `${arquivo} contém «${p}»`);
  }
});

test('o site montado leva só o que a página usa', () => {
  const dir = temporaria();
  node('scripts/montar-site.mjs', '--fonte', 'exemplo', '--saida', dir);
  const nomes = arquivos(dir).map((a) => a.slice(dir.length + 1)).sort();
  assert.ok(!nomes.some((n) => n.startsWith('lib/') && /classificar|checagem|manual|estado\.mjs|visao/.test(n)));
  const estado = JSON.parse(readFileSync(join(dir, 'dados', 'estado.json'), 'utf8'));
  assert.deepEqual(Object.keys(estado), ['exemplo', 'agora', 'verificado_em', 'linhas']);
  assert.deepEqual(estado.linhas.map((l) => l.id), ['app', 'login', 'banco', 'satelite']);
  for (const l of estado.linhas) assert.deepEqual(Object.keys(l), ['id', 'nome', 'estado']);
});

test('com dados reais, a linha pendente não aparece e não há marca de exemplo', () => {
  const fonte = temporaria();
  const saida = temporaria();
  writeFileSync(
    join(fonte, 'estado.json'),
    JSON.stringify({
      verificado_em: '2026-11-23T21:00:00Z',
      publicado_em: '2026-11-23T21:00:00Z',
      linhas: { app: { estado: 'ok', fora_seguidas: 0, degradadas_seguidas: 0, boas_seguidas: 3, serie_inicio: null, incidente: null } },
    }),
  );
  writeFileSync(join(fonte, 'dias.json'), JSON.stringify({ app: { '2026-11-23': { feitas: 1, ok: 1, degradado: 0, fora: 0, minutos_fora: 0 } } }));
  mkdirSync(saida, { recursive: true });
  node('scripts/montar-site.mjs', '--fonte', fonte, '--saida', saida);
  const estado = JSON.parse(readFileSync(join(saida, 'dados', 'estado.json'), 'utf8'));
  assert.deepEqual(Object.keys(estado), ['verificado_em', 'linhas']);
  assert.deepEqual(estado.linhas.map((l) => [l.id, l.estado]), [['app', 'ok'], ['login', 'sem_dado'], ['banco', 'sem_dado']]);
  const incidentes = JSON.parse(readFileSync(join(saida, 'dados', 'incidentes.json'), 'utf8'));
  assert.deepEqual(incidentes, { incidentes: [] });
});

test('montar-site falha (código ≠ 0) se a fonte de dados contém um termo proibido', () => {
  const casos = [
    ['incidentes.json', { incidentes: [{ id: '20261123-2104-manual', linhas: ['app'], tipo: 'fora', inicio: '2026-11-23T21:04:00Z', fim: null, origem: 'manual', titulo: { 'pt-BR': 'Falha no Supabase', 'es-PY': 'x' }, atualizacoes: [] }] }],
    ['incidentes.json', { incidentes: [{ id: '20261123-2104-manual', linhas: ['app'], tipo: 'fora', inicio: '2026-11-23T21:04:00Z', fim: null, origem: 'manual', titulo: { 'pt-BR': 'x', 'es-PY': 'y' }, atualizacoes: [{ em: '2026-11-23T21:04:00Z', estado: 'investigando', texto: { 'pt-BR': 'veja https://algo', 'es-PY': 'z' } }] }] }],
    ['estado.json', { exemplo: true, agora: 'www.exemplo', verificado_em: null, linhas: {} }],
  ];
  for (const [arquivo, conteudo] of casos) {
    const fonte = temporaria();
    const saida = temporaria();
    writeFileSync(join(fonte, arquivo), JSON.stringify(conteudo));
    let erro;
    try {
      node('scripts/montar-site.mjs', '--fonte', fonte, '--saida', saida);
    } catch (e) {
      erro = e;
    }
    assert.ok(erro, `devia falhar com ${arquivo}`);
    assert.notEqual(erro.status, 0);
    assert.match(erro.stderr, /^Erro: dados\/.+ contém/m);
  }
});

test('o catálogo tem as mesmas chaves nos dois idiomas, sem texto vazio, com os mesmos campos', () => {
  assert.deepEqual(Object.keys(TEXTOS).sort(), ['es-PY', 'pt-BR']);
  const pt = TEXTOS['pt-BR'];
  const es = TEXTOS['es-PY'];
  assert.deepEqual(Object.keys(pt).sort(), Object.keys(es).sort());
  const campos = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const chave of Object.keys(pt)) {
    for (const idioma of ['pt-BR', 'es-PY']) {
      const v = TEXTOS[idioma][chave];
      assert.equal(typeof v, 'string');
      assert.ok(v.trim().length > 0, `${idioma} ${chave} vazio`);
    }
    assert.deepEqual(campos(pt[chave]), campos(es[chave]), chave);
  }
  const doPlano = [
    'titulo', 'geral.ok', 'geral.degradado', 'geral.fora', 'geral.atrasado', 'linha.ok', 'linha.degradado',
    'linha.fora', 'linha.sem_dado', 'barras.legenda', 'barras.disponibilidade', 'barras.hoje', 'barras.dias_atras',
    'barra.dica', 'incidentes.titulo', 'incidentes.nenhum', 'incidente.investigando', 'incidente.identificado',
    'incidente.monitorando', 'incidente.resolvido', 'incidente.automatico', 'incidente.duracao',
    'rodape.atualizado', 'rodape.contato', 'incidente.auto_titulo_fora', 'incidente.auto_titulo_degradado',
    'incidente.auto_resolvido', 'exemplo.aviso',
  ];
  for (const chave of doPlano) assert.ok(Object.hasOwn(pt, chave), `falta ${chave}`);
  assert.equal(pt['geral.ok'], 'Todos os sistemas operacionais');
  assert.equal(es['barra.dica'], '{dia}: {pct} en línea · {minutos} min fuera de línea');
});

test('nenhum arquivo de site/ usa innerHTML; o HTML tem a CSP, o referrer e o robots de D9', () => {
  for (const arquivo of arquivos(join(RAIZ, 'site'))) {
    const texto = readFileSync(arquivo, 'utf8');
    assert.ok(!/innerHTML|outerHTML|insertAdjacentHTML|document\.write/.test(texto), arquivo);
  }
  const html = readFileSync(join(RAIZ, 'site', 'index.html'), 'utf8');
  assert.ok(
    html.includes(
      `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'">`,
    ),
  );
  assert.ok(html.includes('<meta name="referrer" content="no-referrer">'));
  assert.ok(html.includes('<meta name="robots" content="noindex">'));
  assert.ok(!/<script(?![^>]*\bsrc="pagina\.mjs")/.test(html), 'só o script da página');
  assert.ok(!/(src|href)="\//.test(html), 'caminhos relativos');
});
