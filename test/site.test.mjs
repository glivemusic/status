// D7 e D9: os dados de exemplo, o site montado (sem vazamento) e o catálogo.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { corDoDia, esperadasNoDia, intervaloDaLinha, temIncidenteDegradadoNoDia } from '../lib/dias.mjs';
import { minutosDesde } from '../lib/tempo.mjs';
import { TERMOS_PROIBIDOS, termoProibido } from '../lib/vazamento.mjs';
import { linhasVisiveis } from '../lib/visao.mjs';
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

test('o exemplo do satélite segue D11: um incidente resolvido, um dia amarelo, nenhum vermelho, verificado há 60 min', () => {
  const ler = (nome) => JSON.parse(readFileSync(join(RAIZ, 'exemplo', nome), 'utf8'));
  const estado = ler('estado.json');
  const dias = ler('dias.json');
  const { incidentes } = ler('incidentes.json');
  const linha = config.linhas.find((l) => l.id === 'satelite');
  const doSatelite = incidentes.filter((i) => i.linhas.includes('satelite'));
  assert.equal(doSatelite.length, 1);
  const [i] = doSatelite;
  assert.equal(i.origem, 'automatico');
  assert.equal(i.tipo, 'degradado');
  assert.ok(i.fim !== null, 'resolvido');
  assert.equal(i.titulo['pt-BR'], TEXTOS['pt-BR']['incidente.satelite.titulo']);
  assert.equal(i.atualizacoes[0].texto['es-PY'], TEXTOS['es-PY']['incidente.satelite.texto']);
  const agora = estado.agora;
  const cores = Object.entries(dias.satelite).map(([dia, registro]) =>
    corDoDia({
      registro,
      temDegradado: temIncidenteDegradadoNoDia(incidentes, 'satelite', dia, agora),
      esperadas: esperadasNoDia(dia, agora, intervaloDaLinha(linha)),
      porFato: true,
    }),
  );
  assert.equal(cores.filter((c) => c === 'amarela').length, 1, 'um dia amarelo');
  assert.ok(!cores.includes('vermelha'), 'nenhum dia vermelho');
  for (const r of Object.values(dias.satelite)) {
    assert.ok(r.feitas <= 12, 'no máximo 12 fatos por dia');
    assert.equal(r.fora, 0);
  }
  assert.equal(minutosDesde(estado.linhas.satelite.verificado_em, agora), 60);
});

test('o site montado não vaza endereço, fornecedor nem dado interno', () => {
  const dir = temporaria();
  node('scripts/montar-site.mjs', '--fonte', 'exemplo', '--saida', dir);
  const proibidos = [...TERMOS_PROIBIDOS];
  for (const t of ['develop', 'vercel', 'workers.dev', 'supabase', 'cloudflare', 'http://', 'https://']) {
    assert.ok(proibidos.includes(t), `a lista tem ${t}`);
  }
  // D11: o provedor das imagens de satélite.
  for (const t of ['copernic', 'cdse']) assert.ok(proibidos.includes(t), `a lista tem ${t}`);
  for (const l of config.linhas) if (l.url) proibidos.push(l.url);
  const lista = arquivos(dir);
  assert.ok(lista.length >= 8);
  let temSentinel2 = false;
  for (const arquivo of lista) {
    const original = readFileSync(arquivo, 'utf8');
    const texto = original.toLowerCase();
    for (const p of proibidos) assert.ok(!texto.includes(p.toLowerCase()), `${arquivo} contém «${p}»`);
    // PU e cota (palavra inteira), pela mesma função que o montar-site usa.
    assert.equal(termoProibido(original), null, arquivo);
    temSentinel2 ||= original.includes('Sentinel-2');
  }
  assert.ok(temSentinel2, '«Sentinel-2» (o nome da linha) é permitido e está publicado');
});

test('D11: a lista de vazamento pega PU, cota e o provedor, sem falso positivo', () => {
  for (const texto of ['PU', '120 PU', '10PU', 'PUs', 'PUS', 'Pus', 'pu.', 'cota', 'Cotas do mês', 'cuota', 'CDSE']) {
    assert.notEqual(termoProibido(texto), null, texto);
  }
  // Fullwidth e compatibilidade (NFKC).
  for (const texto of ['ＰＵ', 'ｃｏｔａ', 'ＣＤＳＥ']) assert.notEqual(termoProibido(texto), null, texto);
  for (const texto of ['pueden', 'puede', 'computador', 'cotação', 'acotado', 'Sentinel-2', 'push', 'pus', 'eu pus', 'pulso']) {
    assert.equal(termoProibido(texto), null, texto);
  }
});

test('D11: «Sentinel Hub» com qualquer separador e «Copernicus» em qualquer grafia', () => {
  const separadores = ['', ' ', '  ', '\n', '\t', ' ', ' ', '　', '_', '.', '-', '–', '—', ' - ', ' — '];
  for (const s of separadores) {
    for (const texto of [`Sentinel${s}Hub`, `SENTINEL${s}HUB`, `o sentinel${s}hub caiu`]) {
      assert.equal(termoProibido(texto), 'sentinel hub', JSON.stringify(texto));
    }
  }
  for (const texto of ['Copernicus', 'COPERNICUS', 'Copérnico', 'Copernico', 'copérnico', 'Copérnico', 'ＣＯＰＥＲＮＩＣＵＳ']) {
    assert.equal(termoProibido(texto), 'copernic', JSON.stringify(texto));
  }
  for (const texto of ['Sentinel-2', 'Imágenes satelitales (Sentinel-2)', 'Sentinel 2 no hubo cambios']) {
    assert.equal(termoProibido(texto), null, texto);
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
  for (const l of estado.linhas.slice(0, 3)) assert.deepEqual(Object.keys(l), ['id', 'nome', 'estado']);
  // D11: o satélite leva o intervalo (previstos por dia) e o `verificado_em` do último fato, nada mais.
  const satelite = estado.linhas[3];
  assert.deepEqual(Object.keys(satelite), ['id', 'nome', 'estado', 'intervalo_s', 'verificado_em']);
  assert.equal(satelite.intervalo_s, 7200);
  assert.equal(satelite.verificado_em, '2026-11-23T20:00:00Z');
});

test('linha pendente só aparece com dados de exemplo', () => {
  const comPendente = { linhas: [...config.linhas, { id: 'futura', nome: { 'pt-BR': 'x', 'es-PY': 'y' }, pendente: true }] };
  assert.ok(linhasVisiveis(comPendente, true).some((l) => l.id === 'futura'));
  assert.ok(!linhasVisiveis(comPendente, false).some((l) => l.id === 'futura'));
});

test('com dados reais, não há marca de exemplo; as linhas em breve (D17) vão só com o nome e a marca', () => {
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
  assert.deepEqual(estado.linhas[0], { id: 'app', nome: config.linhas[0].nome, estado: 'ok' });
  for (const [n, id] of [[1, 'login'], [2, 'banco'], [3, 'satelite']]) {
    assert.deepEqual(estado.linhas[n], { id, nome: config.linhas[n].nome, em_breve: true });
  }
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
    'incidente.auto_resolvido', 'exemplo.aviso', 'linha.em_breve',
  ];
  for (const chave of doPlano) assert.ok(Object.hasOwn(pt, chave), `falta ${chave}`);
  // D11, ao pé da letra.
  assert.equal(pt['satelite.verificado'], 'Verificado há {minutos} min');
  assert.equal(es['satelite.verificado'], 'Verificado hace {minutos} min');
  assert.equal(pt['incidente.satelite.titulo'], 'Atraso nas imagens de satélite');
  assert.equal(es['incidente.satelite.titulo'], 'Demora en las imágenes satelitales');
  assert.equal(
    pt['incidente.satelite.texto'],
    'O provedor das imagens Sentinel-2 não está respondendo. Imagens novas podem demorar; o restante do aplicativo funciona normalmente.',
  );
  assert.equal(
    es['incidente.satelite.texto'],
    'El proveedor de las imágenes Sentinel-2 no está respondiendo. Las imágenes nuevas pueden demorar; el resto de la aplicación funciona con normalidad.',
  );
  // D17.
  assert.equal(pt['linha.em_breve'], 'Em breve');
  assert.equal(es['linha.em_breve'], 'Próximamente');
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
