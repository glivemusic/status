// D17: a página montada com dados reais e com os de exemplo, desenhada num DOM falso (sem navegador), o CNAME e o
// site com a fonte `dados` sem nada de exemplo/.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { termoProibido, textoParaConferir } from '../lib/vazamento.mjs';

const RAIZ = fileURLToPath(new URL('..', import.meta.url));
const EXEMPLO = join(RAIZ, 'exemplo');
const config = JSON.parse(readFileSync(join(RAIZ, 'config', 'alvos.json'), 'utf8'));
const pastas = [];
after(() => {
  for (const p of pastas) rmSync(p, { recursive: true, force: true });
});
function temporaria() {
  const p = mkdtempSync(join(tmpdir(), 'status-pagina-'));
  pastas.push(p);
  return p;
}
function arquivos(dir) {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    return statSync(caminho).isDirectory() ? arquivos(caminho) : [caminho];
  });
}
function montar(fonte) {
  const saida = temporaria();
  execFileSync(process.execPath, ['scripts/montar-site.mjs', '--fonte', fonte, '--saida', saida], { cwd: RAIZ, encoding: 'utf8' });
  return saida;
}

// Dados reais de teste: só o app com dados e nenhum incidente. Para o login e o banco, restos de estado de antes
// de D17 (o banco também com um dia), que a página não deve mostrar nas linhas em breve nem levar ao geral.
const AGORA = '2026-11-23T21:05:00Z';
function dadosReais() {
  const fonte = temporaria();
  const linha = (estado) => ({ estado, fora_seguidas: 0, degradadas_seguidas: 0, boas_seguidas: 2, serie_inicio: null, incidente: null });
  const dia = { feitas: 250, ok: 250, degradado: 0, fora: 0, minutos_fora: 0 };
  writeFileSync(
    join(fonte, 'estado.json'),
    JSON.stringify({
      verificado_em: '2026-11-23T21:02:00Z',
      publicado_em: '2026-11-23T21:02:00Z',
      linhas: { app: linha('ok'), banco: linha('fora'), login: linha('degradado') },
    }),
  );
  writeFileSync(join(fonte, 'dias.json'), JSON.stringify({ app: { '2026-11-22': dia, '2026-11-23': dia }, banco: { '2026-11-22': dia } }));
  writeFileSync(join(fonte, 'incidentes.json'), JSON.stringify({ incidentes: [] }));
  return fonte;
}

// --- Um DOM mínimo, só o que site/pagina.mjs usa ---
class Elemento {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.filhos = [];
    this.texto = '';
    this.atributos = {};
    this.dataset = {};
    this.hidden = false;
    this.className = '';
    this.ouvintes = {};
  }
  get classList() {
    const el = this;
    const lista = () => el.className.split(/\s+/).filter(Boolean);
    return {
      add: (c) => (el.className = [...new Set([...lista(), c])].join(' ')),
      contains: (c) => lista().includes(c),
      toggle: (c, ligar) => {
        const tem = lista().includes(c);
        const quer = ligar ?? !tem;
        el.className = (quer ? [...new Set([...lista(), c])] : lista().filter((x) => x !== c)).join(' ');
        return quer;
      },
    };
  }
  set textContent(v) {
    this.filhos = [];
    this.texto = String(v);
  }
  get textContent() {
    return this.texto + this.filhos.map((f) => f.textContent).join('');
  }
  append(...nos) {
    this.filhos.push(...nos);
  }
  replaceChildren(...nos) {
    this.texto = '';
    this.filhos = [...nos];
  }
  get lastChild() {
    return this.filhos.at(-1);
  }
  setAttribute(k, v) {
    this.atributos[k] = String(v);
  }
  getAttribute(k) {
    return this.atributos[k] ?? null;
  }
  addEventListener(tipo, f) {
    (this.ouvintes[tipo] ??= []).push(f);
  }
  // Os descendentes com a classe.
  todos(classe) {
    return this.filhos.flatMap((f) => [...(f.classList.contains(classe) ? [f] : []), ...f.todos(classe)]);
  }
}

// Desenha a página montada em `dir`, no idioma, com o relógio em `agora`. -> o document falso.
// `estreita`: a tela abaixo de 48rem (D19: 30 barras); sem ela, não há matchMedia (como antes).
let rodada = 0;
async function desenhar(dir, idioma, agora = AGORA, { estreita } = {}) {
  const ids = new Map();
  const document = {
    documentElement: new Elemento('html'),
    title: '',
    activeElement: null,
    createElement: (tag) => new Elemento(tag),
    getElementById: (id) => {
      if (!ids.has(id)) ids.set(id, new Elemento('div'));
      return ids.get(id);
    },
    addEventListener: () => {},
  };
  const antes = {
    document: globalThis.document,
    location: globalThis.location,
    history: globalThis.history,
    fetch: globalThis.fetch,
    matchMedia: globalThis.matchMedia,
    now: Date.now,
  };
  Object.assign(globalThis, {
    document,
    location: { search: `?lang=${idioma}`, href: `http://127.0.0.1/status/?lang=${idioma}` },
    history: { replaceState: () => {} },
    fetch: async (caminho) => {
      const texto = readFileSync(join(dir, caminho), 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(texto) };
    },
    matchMedia:
      estreita === undefined
        ? undefined
        : (consulta) => {
            assert.equal(consulta, '(max-width: 47.99rem)');
            return { matches: estreita, addEventListener: () => {} };
          },
  });
  Date.now = () => Date.parse(agora);
  try {
    rodada += 1;
    await import(`${pathToFileURL(join(dir, 'pagina.mjs')).href}?rodada=${rodada}`);
  } finally {
    Object.assign(globalThis, {
      document: antes.document,
      location: antes.location,
      history: antes.history,
      fetch: antes.fetch,
      matchMedia: antes.matchMedia,
    });
    Date.now = antes.now;
  }
  return { $: (id) => ids.get(id), lang: document.documentElement.lang };
}

function linhasDesenhadas(pagina) {
  return pagina.$('linhas').filhos.map((li) => ({
    nome: li.todos('linha-nome')[0]?.textContent,
    estado: li.todos('linha-estado')[0]?.textContent,
    classe: li.todos('linha-estado')[0]?.className,
    barras: li.todos('barra').length,
    rodape: li.todos('linha-rodape').length,
    pct: li.todos('linha-pct').length,
    verificado: li.todos('linha-verificado').length,
  }));
}

test('com dados reais: sem a faixa de exemplo; as linhas em breve com o nome e «Em breve», sem barras nem percentual', async () => {
  const site = montar(dadosReais());
  for (const [idioma, rotulo, geral] of [
    ['pt-BR', 'Em breve', 'Todos os sistemas operacionais'],
    ['es-PY', 'Próximamente', 'Todos los sistemas operativos'],
  ]) {
    const p = await desenhar(site, idioma);
    assert.equal(p.lang, idioma);
    assert.equal(p.$('aviso').hidden, true, 'sem a faixa de exemplo');
    assert.equal(p.$('aviso-texto').textContent, '');
    // O banco e o login tinham «fora» e «degradado» antigos: não entram no geral.
    assert.equal(p.$('geral-texto').textContent, geral);
    assert.equal(p.$('geral').className, 'geral geral-ok');
    const linhas = linhasDesenhadas(p);
    assert.deepEqual(linhas.map((l) => l.nome), config.linhas.map((l) => l.nome[idioma]));
    const [app, ...emBreve] = linhas;
    assert.equal(app.barras, 90);
    assert.equal(app.rodape, 1);
    assert.equal(app.pct, 1);
    for (const l of emBreve) {
      assert.equal(l.estado, rotulo, l.nome);
      assert.equal(l.classe, 'linha-estado estado-em_breve');
      assert.equal(l.barras, 0, `${l.nome}: sem barras`);
      assert.equal(l.rodape, 0, `${l.nome}: sem «Há 90 dias · % · Hoje»`);
      assert.equal(l.pct, 0);
      assert.equal(l.verificado, 0, `${l.nome}: sem «Verificado há»`);
    }
  }
});

test('com os dados de exemplo: a página fica como antes de D17 (faixa, as 4 linhas com barras, o geral com o banco)', async () => {
  const site = montar('exemplo');
  const p = await desenhar(site, 'pt-BR', '2026-12-01T00:00:00Z');
  assert.equal(p.$('aviso').hidden, false);
  assert.equal(p.$('aviso-texto').textContent, 'Dados de exemplo: a página ainda não está ligada à checagem real.');
  assert.equal(p.$('geral').className, 'geral geral-degradado', 'o banco degradado do exemplo entra no geral');
  const linhas = linhasDesenhadas(p);
  assert.deepEqual(linhas.map((l) => l.estado), ['Operacional', 'Operacional', 'Instável', 'Operacional']);
  for (const l of linhas) {
    assert.equal(l.barras, 90, l.nome);
    assert.equal(l.rodape, 1, l.nome);
  }
  assert.equal(linhas[3].verificado, 1, 'o «Verificado há» do satélite');
  assert.ok(!linhas.some((l) => l.classe.includes('em_breve')));
});

// D19: o que a página mostra de uma linha com barras.
function barrasDaLinha(pagina, n = 0) {
  const li = pagina.$('linhas').filhos[n];
  const grupo = li.todos('barras')[0];
  return {
    grupo,
    barras: li.todos('barra'),
    rodape: li.todos('linha-rodape')[0].filhos.map((f) => f.textContent),
    dica: li.todos('dica')[0],
  };
}

test('D19: o seletor PT-BR/ES-PY com o rótulo «Idioma» e a opção ativa em aria-pressed, nos dois idiomas', async () => {
  const site = montar('exemplo');
  for (const [idioma, pt, es] of [
    ['pt-BR', 'true', 'false'],
    ['es-PY', 'false', 'true'],
  ]) {
    const p = await desenhar(site, idioma, '2026-11-23T21:00:00Z');
    assert.equal(p.lang, idioma);
    assert.equal(p.$('idioma').hidden, false);
    assert.equal(p.$('idioma-rotulo').textContent, 'Idioma');
    assert.equal(p.$('idioma').getAttribute('aria-label'), 'Idioma', 'o nome do grupo, sem caixa alta');
    assert.equal(p.$('idioma-pt').textContent, 'PT-BR');
    assert.equal(p.$('idioma-es').textContent, 'ES-PY');
    assert.equal(p.$('idioma-pt').getAttribute('aria-pressed'), pt, idioma);
    assert.equal(p.$('idioma-es').getAttribute('aria-pressed'), es, idioma);
  }
});

test('D19: a faixa geral por estado (a classe escolhe a cor e o ícone), inclusive «Monitoramento atrasado»', async () => {
  const site = montar('exemplo');
  const p = await desenhar(site, 'pt-BR', '2026-11-23T21:00:00Z');
  assert.equal(p.$('geral').className, 'geral geral-degradado');
  assert.equal(p.$('geral-texto').textContent, 'Alguns serviços estão lentos ou instáveis');
  // O cenário de teste «atrasado» (scripts/cenario.mjs): a última checagem tem 2 h.
  for (const [cenario, classe] of [['atrasado', 'geral geral-atrasado'], ['fora', 'geral geral-fora'], ['tudo-ok', 'geral geral-ok']]) {
    const dados = temporaria();
    execFileSync(process.execPath, ['scripts/cenario.mjs', '--cenario', cenario, '--saida', dados], { cwd: RAIZ });
    const p2 = await desenhar(montar(dados), 'es-PY');
    assert.equal(p2.$('geral').className, classe, cenario);
  }
  const dados = temporaria();
  execFileSync(process.execPath, ['scripts/cenario.mjs', '--cenario', 'atrasado', '--saida', dados], { cwd: RAIZ });
  const atrasada = await desenhar(montar(dados), 'es-PY');
  assert.equal(atrasada.$('geral').className, 'geral geral-atrasado');
  assert.equal(atrasada.$('geral-texto').textContent, 'Monitoreo atrasado: la última verificación tiene más de 60 minutos');
});

test('D19: 90 barras num grupo com o resumo, um só ponto de parada (hoje) e o nome acessível de cada dia', async () => {
  const site = montar('exemplo');
  const p = await desenhar(site, 'pt-BR', '2026-11-23T21:00:00Z');
  assert.equal(p.$('legenda').textContent, 'Últimos 90 dias');
  const { grupo, barras, rodape, dica } = barrasDaLinha(p, 0);
  assert.equal(grupo.getAttribute('role'), 'group');
  assert.match(grupo.getAttribute('aria-label'), /^Últimos 90 dias: \d+,\d\d % de disponibilidade$/);
  assert.equal(barras.length, 90);
  assert.deepEqual(barras.map((b) => b.tabIndex).filter((t) => t === 0).length, 1);
  assert.equal(barras.at(-1).tabIndex, 0, 'hoje é a parada de Tab');
  for (const b of barras) {
    assert.match(
      b.getAttribute('aria-label'),
      /^\d{1,2} de [a-z]{3}\.: (\d+,\d\d % no ar(, \d+ min fora do ar|, falhas isoladas sem incidente)?|sem dados)$/,
    );
    assert.equal(b.title, undefined, 'sem title (a dica é a da página)');
  }
  assert.equal(barras.at(-1).getAttribute('aria-label').slice(0, 11), '23 de nov.:');
  // O dia sem registro do exemplo (5/9).
  assert.ok(barras.some((b) => b.getAttribute('aria-label') === '5 de set.: sem dados'));
  // O dia 2/11 do aplicativo: 50 min fora do ar, no nome e na dica.
  const dia2 = barras.find((b) => b.getAttribute('aria-label').startsWith('2 de nov.:'));
  assert.match(dia2.getAttribute('aria-label'), /^2 de nov\.: \d+,\d\d % no ar, 50 min fora do ar$/);
  assert.match(dia2.dataset.dica, /^2 de nov\.: \d+,\d\d % no ar · 50 min fora do ar$/);
  assert.equal(dia2.className, 'barra barra-vermelha');
  assert.equal(dica.hidden, true);
  assert.equal(dica.getAttribute('aria-hidden'), 'true');
  assert.deepEqual(rodape.slice(0, 1).concat(rodape.slice(2)), ['Há 90 dias', 'Hoje']);
  assert.match(rodape[1], /^\d+,\d\d % de disponibilidade$/);
});

test('D19: abaixo de 48rem, 30 barras, «Há 30 dias» e o percentual dos mesmos 90 dias, nos dois idiomas', async () => {
  const site = montar('exemplo');
  const larga = barrasDaLinha(await desenhar(site, 'pt-BR', '2026-11-23T21:00:00Z', { estreita: false }), 0);
  const pct = larga.rodape[1].replace(' de disponibilidade', '');
  for (const [idioma, legenda, atras, texto] of [
    ['pt-BR', 'Últimos 30 dias', 'Há 30 dias', `${pct} de disponibilidade em 90 dias`],
    ['es-PY', 'Últimos 30 días', 'Hace 30 días', `${pct} de disponibilidad en 90 días`],
  ]) {
    const p = await desenhar(site, idioma, '2026-11-23T21:00:00Z', { estreita: true });
    assert.equal(p.$('legenda').textContent, legenda);
    const { grupo, barras, rodape } = barrasDaLinha(p, 0);
    assert.equal(barras.length, 30);
    assert.equal(barras.filter((b) => b.tabIndex === 0).length, 1);
    assert.equal(barras.at(-1).tabIndex, 0);
    // Os 30 últimos dos 90: o mais velho é 25/10.
    assert.equal(barras[0].getAttribute('aria-label').slice(0, 11), idioma === 'pt-BR' ? '25 de out.:' : '25 de oct.:');
    assert.deepEqual(rodape, [atras, texto, idioma === 'pt-BR' ? 'Hoje' : 'Hoy']);
    // O resumo do grupo continua o dos 90 dias.
    assert.ok(grupo.getAttribute('aria-label').includes(pct));
  }
  assert.equal(larga.barras.length, 90);
});

// D21: dados reais com `n` dias medidos do app, terminando hoje (23/11); um dia a mais só com `feitas: 0`.
function dadosComDias(n) {
  const fonte = dadosReais();
  // Uma checagem fora sem incidente (D4 não abriu): o dia continua verde (D21).
  const dia = { feitas: 100, ok: 98, degradado: 1, fora: 1, minutos_fora: 0 };
  const app = { '2026-11-01': { feitas: 0, ok: 0, degradado: 0, fora: 0, minutos_fora: 0 } };
  for (let k = 0; k < n; k += 1) app[`2026-11-${String(23 - k).padStart(2, '0')}`] = dia;
  writeFileSync(join(fonte, 'dias.json'), JSON.stringify({ app }));
  return fonte;
}

test('D21: com menos de 7 dias medidos, «—» e «medindo desde {data}» nas duas larguras e no resumo, nos dois idiomas', async () => {
  const site = montar(dadosComDias(6));
  for (const [idioma, rotulo, resumo] of [
    ['pt-BR', '— medindo desde 18/11/2026', 'Últimos 90 dias: medindo desde 18/11/2026'],
    ['es-PY', '— midiendo desde 18/11/2026', 'Últimos 90 días: midiendo desde 18/11/2026'],
  ]) {
    for (const estreita of [false, true]) {
      const { grupo, rodape, barras } = barrasDaLinha(await desenhar(site, idioma, AGORA, { estreita }), 0);
      assert.equal(rodape[1], rotulo, `${idioma} ${estreita ? 'estreita' : 'larga'}`);
      assert.equal(grupo.getAttribute('aria-label'), resumo);
      assert.equal(barras.length, estreita ? 30 : 90);
      // Os dias com checagem são verdes (D21), o dia só com `feitas: 0` e os sem registro são cinza.
      assert.equal(barras.at(-1).className, 'barra barra-verde');
      assert.equal(barras.filter((b) => b.className === 'barra barra-verde').length, 6);
    }
  }
});

test('D21: um dia medido fora da janela de 90 dias não conta: «medindo desde» é o mais velho dentro dela', async () => {
  const fonte = dadosComDias(5);
  const dias = JSON.parse(readFileSync(join(fonte, 'dias.json'), 'utf8'));
  const dia = dias.app['2026-11-23'];
  // 95 dias antes de 23/11 (a janela começa em 26/08) e um dia antigo dentro dela: 6 medidos na janela.
  dias.app['2026-08-20'] = dia;
  dias.app['2026-09-10'] = dia;
  writeFileSync(join(fonte, 'dias.json'), JSON.stringify(dias));
  const site = montar(fonte);
  for (const [idioma, rotulo] of [
    ['pt-BR', '— medindo desde 10/09/2026'],
    ['es-PY', '— midiendo desde 10/09/2026'],
  ]) {
    for (const estreita of [false, true]) {
      const { rodape } = barrasDaLinha(await desenhar(site, idioma, AGORA, { estreita }), 0);
      assert.equal(rodape[1], rotulo, `${idioma} ${estreita ? 'estreita' : 'larga'}`);
    }
  }
});

test('D21: com 7 dias medidos, o percentual de volta e sem «medindo desde»; sem nenhum, «—» como antes', async () => {
  const site = montar(dadosComDias(7));
  for (const [idioma, larga, estreita, resumo] of [
    ['pt-BR', '99,00 % de disponibilidade', '99,00 % de disponibilidade em 90 dias', 'Últimos 90 dias: 99,00 % de disponibilidade'],
    ['es-PY', '99,00 % de disponibilidad', '99,00 % de disponibilidad en 90 días', 'Últimos 90 días: 99,00 % de disponibilidad'],
  ]) {
    const l = barrasDaLinha(await desenhar(site, idioma, AGORA, { estreita: false }), 0);
    assert.equal(l.rodape[1], larga);
    assert.equal(l.grupo.getAttribute('aria-label'), resumo);
    const e = barrasDaLinha(await desenhar(site, idioma, AGORA, { estreita: true }), 0);
    assert.equal(e.rodape[1], estreita);
  }
  const vazio = barrasDaLinha(await desenhar(montar(dadosComDias(0)), 'pt-BR', AGORA, { estreita: false }), 0);
  assert.equal(vazio.rodape[1], '— de disponibilidade');
  assert.equal(vazio.grupo.getAttribute('aria-label'), 'Últimos 90 dias: — de disponibilidade');
  assert.ok(vazio.barras.every((b) => b.className === 'barra barra-cinza'));
});

// D23: dados reais do app com um dia por caso e os incidentes que tocam (ou não) cada um.
function dadosD23() {
  const fonte = dadosReais();
  const app = {
    // Minutos fora sem incidente que toque o dia (dado inconsistente, como incidente apagado à mão).
    '2026-11-17': { feitas: 100, ok: 80, degradado: 0, fora: 20, minutos_fora: 40 },
    // Sem `minutos_fora` no registro e sem incidente: conta como 0.
    '2026-11-18': { feitas: 100, ok: 100, degradado: 0, fora: 0 },
    // Incidente «degradado» que toca o dia, sem minutos fora.
    '2026-11-19': { feitas: 100, ok: 90, degradado: 10, fora: 0, minutos_fora: 0 },
    // Incidente «fora» de 30 min.
    '2026-11-20': { feitas: 100, ok: 70, degradado: 0, fora: 30, minutos_fora: 30 },
    // Sem incidente da linha (só um de outra linha) e sem checagem fora.
    '2026-11-21': { feitas: 100, ok: 100, degradado: 0, fora: 0, minutos_fora: 0 },
    // Sem incidente, com checagens fora que não abriram incidente: sem nenhuma `ok`, vermelho (D21).
    '2026-11-22': { feitas: 3, ok: 0, degradado: 0, fora: 3, minutos_fora: 0 },
    // Sem incidente, com uma checagem fora isolada.
    '2026-11-23': { feitas: 100, ok: 99, degradado: 0, fora: 1, minutos_fora: 0 },
  };
  writeFileSync(join(fonte, 'dias.json'), JSON.stringify({ app }));
  const texto = { 'pt-BR': 'Teste', 'es-PY': 'Prueba' };
  const incidente = (id, linhas, tipo, inicio, fim) => ({
    id,
    linhas,
    tipo,
    inicio,
    fim,
    origem: 'manual',
    titulo: texto,
    atualizacoes: [{ em: inicio, estado: 'investigando', texto }],
  });
  writeFileSync(
    join(fonte, 'incidentes.json'),
    JSON.stringify({
      incidentes: [
        incidente('20261119-1500-manual', ['app'], 'degradado', '2026-11-19T15:00:00Z', '2026-11-19T16:00:00Z'),
        incidente('20261120-1500-manual', ['app'], 'fora', '2026-11-20T15:00:00Z', '2026-11-20T15:30:00Z'),
        incidente('20261121-1500-manual', ['banco'], 'fora', '2026-11-21T15:00:00Z', '2026-11-21T16:00:00Z'),
      ],
    }),
  );
  return fonte;
}

function barraDoDia(pagina, rotulo) {
  const barra = barrasDaLinha(pagina, 0).barras.find((b) => b.getAttribute('aria-label').startsWith(`${rotulo}:`));
  assert.ok(barra, rotulo);
  return { nome: barra.getAttribute('aria-label'), dica: barra.dataset.dica, classe: barra.className };
}

test('D23: o dia com incidente mantém os minutos fora do ar, na dica e no nome', async () => {
  const p = await desenhar(montar(dadosD23()), 'pt-BR');
  assert.deepEqual(barraDoDia(p, '20 de nov.'), {
    nome: '20 de nov.: 70,00 % no ar, 30 min fora do ar',
    dica: '20 de nov.: 70,00 % no ar · 30 min fora do ar',
    classe: 'barra barra-vermelha',
  });
  // Incidente «degradado» também é incidente: os minutos ficam, mesmo 0.
  assert.deepEqual(barraDoDia(p, '19 de nov.'), {
    nome: '19 de nov.: 100,00 % no ar, 0 min fora do ar',
    dica: '19 de nov.: 100,00 % no ar · 0 min fora do ar',
    classe: 'barra barra-amarela',
  });
  // Minutos fora sem incidente que toque o dia: os minutos ficam.
  assert.deepEqual(barraDoDia(p, '17 de nov.'), {
    nome: '17 de nov.: 80,00 % no ar, 40 min fora do ar',
    dica: '17 de nov.: 80,00 % no ar · 40 min fora do ar',
    classe: 'barra barra-vermelha',
  });
});

test('D23: o dia sem incidente e sem checagem fora mostra só o percentual (o incidente de outra linha não conta)', async () => {
  const p = await desenhar(montar(dadosD23()), 'pt-BR');
  assert.deepEqual(barraDoDia(p, '21 de nov.'), {
    nome: '21 de nov.: 100,00 % no ar',
    dica: '21 de nov.: 100,00 % no ar',
    classe: 'barra barra-verde',
  });
  // `minutos_fora` ausente conta como 0.
  assert.deepEqual(barraDoDia(p, '18 de nov.'), {
    nome: '18 de nov.: 100,00 % no ar',
    dica: '18 de nov.: 100,00 % no ar',
    classe: 'barra barra-verde',
  });
});

test('D23: o dia sem incidente com checagem fora mostra «falhas isoladas sem incidente», sem contagem, nos dois idiomas', async () => {
  const site = montar(dadosD23());
  for (const [idioma, casos] of [
    [
      'pt-BR',
      [
        ['22 de nov.', '0,00 % no ar', 'falhas isoladas sem incidente', 'barra barra-vermelha'],
        ['23 de nov.', '99,00 % no ar', 'falhas isoladas sem incidente', 'barra barra-verde'],
      ],
    ],
    [
      'es-PY',
      [
        ['22 de nov.', '0,00 % en línea', 'fallas aisladas sin incidente', 'barra barra-vermelha'],
        ['23 de nov.', '99,00 % en línea', 'fallas aisladas sin incidente', 'barra barra-verde'],
      ],
    ],
  ]) {
    const p = await desenhar(site, idioma);
    for (const [rotulo, pct, falhas, classe] of casos) {
      assert.deepEqual(
        barraDoDia(p, rotulo),
        { nome: `${rotulo}: ${pct}, ${falhas}`, dica: `${rotulo}: ${pct} · ${falhas}`, classe },
        `${idioma} ${rotulo}`,
      );
    }
    // O dia sem incidente e sem fora, também em es-PY.
    assert.equal(barraDoDia(p, '21 de nov.').dica, idioma === 'pt-BR' ? '21 de nov.: 100,00 % no ar' : '21 de nov.: 100,00 % en línea');
  }
});

test('o site com a fonte dados não leva nada de exemplo/', () => {
  const site = montar(dadosReais());
  const doExemplo = readdirSync(EXEMPLO).map((n) => readFileSync(join(EXEMPLO, n), 'utf8'));
  const { incidentes } = JSON.parse(readFileSync(join(EXEMPLO, 'incidentes.json'), 'utf8'));
  // Os textos dos manuais são só do exemplo (os automáticos vêm do catálogo, que a página leva).
  const textosDoExemplo = incidentes
    .filter((i) => i.origem === 'manual')
    .flatMap((i) => [i.titulo['pt-BR'], i.titulo['es-PY'], ...i.atualizacoes.flatMap((a) => [a.texto['pt-BR'], a.texto['es-PY']])]);
  assert.ok(textosDoExemplo.length > 0);
  for (const arquivo of arquivos(site)) {
    const texto = readFileSync(arquivo, 'utf8');
    assert.ok(!doExemplo.includes(texto), `${arquivo} é cópia de exemplo/`);
    for (const t of textosDoExemplo) assert.ok(!texto.includes(t), `${arquivo} tem «${t}» do exemplo`);
  }
  for (const nome of ['estado.json', 'dias.json', 'incidentes.json']) {
    const json = JSON.parse(readFileSync(join(site, 'dados', nome), 'utf8'));
    assert.equal(json.exemplo, undefined, `${nome} sem a marca de exemplo`);
    assert.equal(json.agora, undefined, `${nome} sem o «agora» do exemplo`);
  }
  // Os dias das linhas em breve (o banco tinha um) não vão.
  assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(site, 'dados', 'dias.json'), 'utf8'))), ['app']);
});

test('o CNAME vai com as duas fontes, uma linha só, e nada publicado tem o endereço checado', () => {
  for (const fonte of ['exemplo', dadosReais()]) {
    const site = montar(fonte);
    assert.equal(readFileSync(join(site, 'CNAME'), 'utf8'), 'status.basefertil.com\n');
    const urls = config.linhas.map((l) => l.url).filter(Boolean);
    assert.deepEqual(urls, ['https://basefertil.com/']);
    for (const arquivo of arquivos(site)) {
      const texto = readFileSync(arquivo, 'utf8');
      // D19: as fontes e a licença delas ficam de fora; dos SVG sai só o espaço de nomes (como no montar-site).
      const conferido = textoParaConferir(arquivo.slice(site.length + 1), texto);
      if (conferido !== null) assert.equal(termoProibido(conferido, urls), null, arquivo);
      assert.ok(!texto.includes('basefertil.com/'), `${arquivo} contém o endereço checado`);
    }
  }
});

test('o rótulo «Em breve» usa a cor neutra de apoio, que o teste de contraste confere nos dois temas', () => {
  const css = readFileSync(join(RAIZ, 'site', 'estilo.css'), 'utf8');
  assert.match(css, /\.estado-em_breve \{\n  color: var\(--apoio\);\n\}/);
});
