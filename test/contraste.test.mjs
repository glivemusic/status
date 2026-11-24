// D16, D19 e D21: as cores do Agronomy Center e o contraste, nos dois temas, lidos de site/estilo.css: >= 4,5:1 em
// cada par de texto e >= 3:1 em cada cor de barra (o cinza de «sem dados» também) e no ícone do aviso. Mais a fonte (Inter, servida
// daqui, sem peso 700), a marca, o seletor de idioma, o foco e os raios (docs/revisao-visual-2026-11-23.md).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const CSS = readFileSync(new URL('../site/estilo.css', import.meta.url), 'utf8');
const HTML = readFileSync(new URL('../site/index.html', import.meta.url), 'utf8');

function tokens(bloco) {
  return Object.fromEntries([...bloco.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map(([, k, v]) => [k, v.trim()]));
}

const claroBloco = CSS.match(/^:root\s*\{([^}]*)\}/m)[1];
const escuroBloco = CSS.match(/@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/)[1];
const TEMAS = {
  claro: tokens(claroBloco),
  escuro: { ...tokens(claroBloco), ...tokens(escuroBloco) },
};

// O valor final de um token (segue var(--x)).
function valor(tema, nome, passos = 0) {
  const v = TEMAS[tema][nome];
  assert.ok(v, `${tema}: falta ${nome}`);
  const ref = v.match(/^var\((--[\w-]+)\)$/);
  if (ref) {
    assert.ok(passos < 5, `${nome}: var() em ciclo`);
    return valor(tema, ref[1], passos + 1);
  }
  assert.match(v, /^#[0-9a-f]{6}$/i, `${tema} ${nome}`);
  return v.toLowerCase();
}

function luminancia(hex) {
  const canal = (i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
}

function contraste(a, b) {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

// [texto, fundo]: cada texto da página sobre o fundo em que aparece.
const PARES_DE_TEXTO = [
  // Neutros, na página e no cartão; o rótulo «Idioma» e a opção inativa estão no chão.
  ...['--tinta', '--apoio', '--discreto'].flatMap((t) => [[t, '--chao'], [t, '--cartao']]),
  // A ação (links, a opção ativa do seletor).
  ...['--acao', '--acao-hover'].flatMap((t) => [[t, '--chao'], [t, '--cartao'], [t, '--acao-suave']]),
  ['--tinta', '--acao-suave'],
  ['--marca-rotulo', '--chao'],
  ['--aviso-texto', '--aviso-fundo'],
  // O estado: o rótulo da linha e o tipo do incidente, no cartão.
  ...['--verde', '--amarelo', '--vermelho', '--cinza'].map((t) => [t, '--cartao']),
  // A faixa geral: texto branco no fundo de cada estado.
  ...['--geral-ok', '--geral-degradado', '--geral-fora', '--geral-atrasado'].map((f) => ['--geral-texto', f]),
];

// [cor, fundo]: o que não é texto e tem de ser visto (>= 3:1).
const PARES_GRAFICOS = [
  // D21: o cinza de «sem dados» também, sem exceção.
  ...['--barra-verde', '--barra-amarela', '--barra-vermelha', '--barra-cinza'].map((b) => [b, '--cartao']),
  ['--aviso-borda', '--aviso-fundo'],
  // O anel de foco.
  ['--acao', '--chao'],
  ['--acao', '--cartao'],
];

test('contraste AA (>= 4,5:1) em cada par de texto, nos dois temas', (t) => {
  for (const tema of Object.keys(TEMAS)) {
    for (const [texto, fundo] of PARES_DE_TEXTO) {
      const r = contraste(valor(tema, texto), valor(tema, fundo));
      t.diagnostic(`${tema}: ${texto} sobre ${fundo} = ${r.toFixed(2)}:1`);
      assert.ok(r >= 4.5, `${tema}: ${texto} sobre ${fundo} = ${r.toFixed(2)}:1`);
    }
  }
});

test('contraste (>= 3:1) de cada cor de barra de estado, do ícone do aviso e do foco, nos dois temas', (t) => {
  for (const tema of Object.keys(TEMAS)) {
    for (const [cor, fundo] of PARES_GRAFICOS) {
      const r = contraste(valor(tema, cor), valor(tema, fundo));
      t.diagnostic(`${tema}: ${cor} sobre ${fundo} = ${r.toFixed(2)}:1`);
      assert.ok(r >= 3, `${tema}: ${cor} sobre ${fundo} = ${r.toFixed(2)}:1`);
    }
  }
});

test('D21: o cinza de «sem dados» passa de 3:1 no cartão, é o mais discreto da escala da casa que passa e não se confunde com o estado', (t) => {
  // A escala de cinzas da casa (o guia de design do app), do cartão claro para o escuro, e a do tema escuro.
  const ESCALA = ['#ffffff', '#f7f6f5', '#f2f1f0', '#f5f4f2', '#ebeae8', '#e5e4e2', '#dfdedc', '#d8d7d5', '#c8c7c4', '#b2b0ae', '#8d8b89', '#696865', '#545351', '#41403e', '#302f2d', '#201f1d', '#151413'];
  const ESCALA_ESCURA = ['#303030', '#363636', '#3f3f3f', '#424242', '#444444', '#525252', '#666666', '#9f9f9f', '#b3b1ad', '#c7c5c1', '#e9e7e3'];
  const cinzas = [...new Set([...ESCALA, ...ESCALA_ESCURA])];
  for (const tema of Object.keys(TEMAS)) {
    const cinza = valor(tema, '--barra-cinza');
    const cartao = valor(tema, '--cartao');
    assert.ok(cinzas.includes(cinza), `${tema}: ${cinza} é da escala da casa`);
    const r = contraste(cinza, cartao);
    t.diagnostic(`${tema}: --barra-cinza ${cinza} sobre --cartao ${cartao} = ${r.toFixed(2)}:1`);
    assert.ok(r >= 3, `${tema}: ${r.toFixed(2)}:1`);
    // Nenhum cinza da casa que passe de 3:1 fica mais perto do cartão.
    for (const outro of cinzas) {
      const ro = contraste(outro, cartao);
      if (ro >= 3) assert.ok(ro >= r, `${tema}: ${outro} (${ro.toFixed(2)}:1) passa e é mais discreto`);
    }
    // Distinguível do verde, do amarelo e do vermelho: o cinza é neutro (sem matiz) e eles não.
    const croma = (hex) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return Math.max(...c) - Math.min(...c);
    };
    assert.ok(croma(cinza) <= 4, `${tema}: o cinza é neutro`);
    for (const cor of ['--barra-verde', '--barra-amarela', '--barra-vermelha']) {
      const estado = valor(tema, cor);
      t.diagnostic(`${tema}: --barra-cinza contra ${cor} = ${contraste(cinza, estado).toFixed(2)}:1, croma ${croma(estado)}`);
      assert.ok(croma(estado) >= 60, `${tema}: ${cor} tem matiz`);
      assert.ok(contraste(cinza, estado) >= 1.4, `${tema}: o cinza e ${cor} se separam também pela luz`);
    }
  }
  // As quatro cores de barra, todas na regra de 3:1.
  const barras = Object.keys(TEMAS.claro).filter((k) => k.startsWith('--barra-'));
  assert.deepEqual(barras.sort(), ['--barra-amarela', '--barra-cinza', '--barra-verde', '--barra-vermelha']);
  assert.deepEqual(PARES_GRAFICOS.filter(([c]) => c.startsWith('--barra-')).map(([c]) => c).sort(), barras.sort());
});

test('a barra sob o mouse ou escolhida não clareia: sem opacity nem filter nas barras; ela cresce', () => {
  for (const [, seletor, corpo] of CSS.matchAll(/(?:^|\n)\s*([^{}@\n][^{}]*?)\s*\{([^}]*)\}/g)) {
    if (/\.barra/.test(seletor)) assert.ok(!/(^|[\s;])(opacity|filter)\s*:/.test(corpo), `opacity ou filter em ${seletor.trim()}`);
  }
  assert.match(regra('.barras'), /align-items:\s*flex-end/);
  assert.match(regra('.barra'), /height:\s*calc\(100% - 0\.25rem\)/);
  assert.match(regra('.barra:hover,\n.barra-escolhida'), /height:\s*100%/);
});

test('o cálculo de contraste confere com valores conhecidos', () => {
  assert.equal(contraste('#000000', '#ffffff'), 21);
  assert.equal(contraste('#777777', '#777777'), 1);
  assert.ok(Math.abs(contraste('#767676', '#ffffff') - 4.54) < 0.01);
  // Os valores da revisão visual.
  assert.ok(Math.abs(contraste('#15803d', '#ffffff') - 5.02) < 0.01);
  assert.ok(Math.abs(contraste('#936228', '#ffffff') - 5.23) < 0.01);
  assert.ok(Math.abs(contraste('#c2352a', '#ffffff') - 5.47) < 0.01);
});

test('os tokens de D19, com as cores da revisão visual, nos dois temas', () => {
  const claro = {
    '--marca-grafite': '#41403e',
    '--marca-laranja': '#d66a2f',
    '--marca-rotulo': '#41403e',
    '--acao': '#9d4d16',
    '--acao-hover': '#8c4311',
    '--acao-suave': '#ebeae8',
    '--tinta': '#201f1d',
    '--apoio': '#545351',
    '--discreto': '#696865',
    '--chao': '#f7f6f5',
    '--cartao': '#ffffff',
    '--linha': '#e5e4e2',
    '--linha-forte': '#d8d7d5',
    '--aviso-fundo': '#faf0df',
    '--aviso-borda': '#936228',
    '--aviso-texto': '#201f1d',
    '--verde': '#15803d',
    '--amarelo': '#936228',
    '--vermelho': '#c2352a',
    '--cinza': '#545351',
    '--barra-verde': '#15803d',
    '--barra-amarela': '#936228',
    '--barra-vermelha': '#c2352a',
    '--barra-cinza': '#8d8b89',
    '--geral-ok': '#15803d',
    '--geral-degradado': '#936228',
    '--geral-fora': '#c2352a',
    '--geral-atrasado': '#545351',
    '--geral-texto': '#ffffff',
  };
  for (const [k, v] of Object.entries(claro)) assert.equal(valor('claro', k), v, `claro ${k}`);
  const escuro = {
    '--chao': '#363636',
    '--cartao': '#3f3f3f',
    '--linha': '#525252',
    '--linha-forte': '#666666',
    '--tinta': '#e9e7e3',
    '--apoio': '#c7c5c1',
    '--discreto': '#b3b1ad',
    '--acao': '#f2a66e',
    '--acao-hover': '#f5b184',
    '--acao-suave': '#444444',
    '--cinza': '#c7c5c1',
    '--aviso-fundo': '#494237',
    '--aviso-borda': '#d3aa6f',
    '--aviso-texto': '#e9e7e3',
    '--marca-rotulo': '#cfcdc9',
    '--barra-verde': '#6ec282',
    '--barra-amarela': '#d3aa6f',
    '--barra-vermelha': '#ff918e',
    '--barra-cinza': '#8d8b89',
    // O símbolo e a faixa geral são os mesmos nos dois temas.
    '--marca-laranja': '#d66a2f',
    '--geral-degradado': '#936228',
  };
  for (const [k, v] of Object.entries(escuro)) assert.equal(valor('escuro', k), v, `escuro ${k}`);
  // Os neutros verdes antigos saíram.
  for (const antigo of ['#111513', '#1a1f1d', '#2e3532', '#3b4340', '#e7ece9', '#c9cfcc', '#e0a810', '#7d5800', '#56605b']) {
    assert.ok(!CSS.toLowerCase().includes(antigo), `sobrou ${antigo}`);
  }
});

// As regras de um seletor exato (o corpo do bloco).
function regra(seletor) {
  const escapado = seletor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = CSS.match(new RegExp(`(?:^|\\n)\\s*${escapado}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `falta a regra ${seletor}`);
  return m[1];
}

test('a fonte: Inter servida daqui (latin e latin-ext, 400, 500 e 600, swap) e nenhum peso 700', () => {
  const faces = [...CSS.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);
  assert.equal(faces.length, 6);
  const vistos = new Set();
  for (const f of faces) {
    assert.match(f, /font-family:\s*Inter;/);
    assert.match(f, /font-display:\s*swap;/);
    const [, subconjunto, peso] = f.match(/src:\s*url\("fontes\/inter-(latin|latin-ext)-(400|500|600)\.woff2"\) format\("woff2"\);/);
    assert.match(f, new RegExp(`font-weight:\\s*${peso};`));
    assert.match(f, subconjunto === 'latin' ? /unicode-range:\s*U\+0000-00FF,/ : /unicode-range:\s*U\+0100-02BA,/);
    vistos.add(`${subconjunto}-${peso}`);
  }
  assert.equal(vistos.size, 6);
  assert.ok(!/url\(\s*["']?(https?:|\/\/|\/)/.test(CSS), 'nenhuma url absoluta ou de fora');
  assert.match(CSS, /--fonte-corpo:\s*Inter, -apple-system, "Segoe UI", Roboto, sans-serif;/);
  assert.match(regra('body'), /font-family:\s*var\(--fonte-corpo\)/);
  assert.match(regra('body'), /font-size:\s*0\.9375rem/);
  assert.match(regra('body'), /line-height:\s*1\.45/);
  assert.ok(!/font-weight:\s*(700|bold|bolder)\b/.test(CSS), 'nenhum font-weight 700');
  assert.ok(!/system-ui/.test(CSS), 'a fonte do sistema saiu da frente');
  // Os títulos e o strong, que o navegador põe em 700, vão a 600.
  assert.match(regra('h1,\nh2,\nh3,\nstrong,\nb'), /font-weight:\s*600/);
});

test('a escala de texto da casa (12 · 13 · 15 · 19 · 22 · 26)', () => {
  assert.match(regra('.titulo'), /font-size:\s*1\.625rem/);
  assert.match(regra('.titulo'), /letter-spacing:\s*-0\.03em/);
  assert.match(regra('.incidentes h2'), /font-size:\s*1\.1875rem/);
  assert.match(regra('.incidentes h2'), /letter-spacing:\s*-0\.03em/);
  assert.match(regra('.geral'), /font-size:\s*1\.1875rem/);
  assert.match(regra('.geral'), /font-weight:\s*600/);
  for (const s of ['.incidente-titulo', '.linha-nome']) {
    assert.match(regra(s), /font-size:\s*0\.9375rem/, s);
    assert.match(regra(s), /font-weight:\s*600/, s);
  }
  for (const s of ['.linha-verificado', '.incidente-meta', '.atualizacao-cabeca', '.rodape', '.linha-rodape', '.dica', '.cartao-legenda']) {
    assert.match(regra(s), /font-size:\s*0\.8125rem/, s);
  }
  const tamanhos = new Set([...CSS.matchAll(/font-size:\s*([\d.]+)rem/g)].map((m) => Number(m[1]) * 16));
  for (const px of tamanhos) assert.ok([12, 13, 15, 16, 19, 22, 26].includes(px), `${px} px fora da escala`);
});

test('a marca: «Agronomy Center» sem maiúsculas, com o símbolo de 32 px a 8 px do nome', () => {
  const marca = regra('.marca');
  assert.ok(!/text-transform/.test(marca), 'sem text-transform');
  assert.match(marca, /font-size:\s*1\.375rem/);
  assert.match(marca, /font-weight:\s*600/);
  assert.match(marca, /letter-spacing:\s*-0\.01em/);
  assert.match(marca, /gap:\s*0\.5rem/);
  assert.match(marca, /color:\s*var\(--marca-rotulo\)/);
  assert.match(regra('.marca-simbolo'), /width:\s*32px/);
  assert.match(regra('.marca-simbolo'), /height:\s*32px/);
  // D22: o símbolo oficial, claro e escuro, num <picture>; o nome em texto logo depois.
  assert.match(
    HTML,
    /<p class="marca"><picture><source media="\(prefers-color-scheme: dark\)" srcset="marca\/simbolo-escuro\.svg"><img class="marca-simbolo" src="marca\/simbolo\.svg" alt="" width="32" height="32"><\/picture><span id="marca"><\/span><\/p>/,
  );
  assert.match(regra('.marca picture'), /flex:\s*none/);
  assert.ok(!/display:/.test(regra('.marca picture')), 'sem display no <picture> (item de flex já é bloco)');
  assert.match(regra('.marca-simbolo'), /display:\s*block/);
  assert.ok(!/hexagono|clip-path/.test(CSS + HTML), 'o hexágono de CSS saiu');
  assert.ok(!/\sstyle=/.test(HTML), 'sem estilo em linha (a CSP o bloqueia)');
  // O laranja da marca nunca vai em texto.
  assert.ok(![...CSS.matchAll(/(^|[\s;{])color:\s*var\(--marca-laranja\)/g)].length, 'laranja da marca em texto');
});

test('o seletor de idioma do login: rótulo, grupo de dois botões, a ativa com aria-pressed, 44 px abaixo de 48rem', () => {
  assert.match(regra('.idioma-rotulo'), /font-size:\s*0\.75rem/);
  assert.match(regra('.idioma-rotulo'), /font-weight:\s*500/);
  assert.match(regra('.idioma-rotulo'), /letter-spacing:\s*0\.09em/);
  assert.match(regra('.idioma-rotulo'), /text-transform:\s*uppercase/);
  assert.match(regra('.idioma-rotulo'), /color:\s*var\(--discreto\)/);
  const grupo = regra('.idioma-opcoes');
  assert.match(grupo, /padding:\s*2px/);
  assert.match(grupo, /border:\s*1px solid var\(--linha\)/);
  assert.match(grupo, /border-radius:\s*4px/);
  assert.match(grupo, /background:\s*var\(--chao\)/);
  const opcao = regra('.idioma-opcao');
  assert.match(opcao, /padding:\s*4px 8px/);
  assert.match(opcao, /border-radius:\s*2px/);
  assert.match(opcao, /font-size:\s*0\.75rem/);
  assert.match(opcao, /font-weight:\s*500/);
  const ativa = regra('.idioma-opcao[aria-pressed="true"]');
  assert.match(ativa, /background:\s*var\(--acao-suave\)/);
  assert.match(ativa, /color:\s*var\(--acao\)/);
  assert.match(ativa, /font-weight:\s*600/);
  const estreita = CSS.match(/@media \(max-width: 47\.99rem\) \{([\s\S]*?)\n\}/)[1];
  assert.match(estreita, /\.idioma-opcao \{\s*min-width: 2\.75rem;\s*min-height: 2\.75rem;/);
  // O nome do grupo vem do catálogo (aria-label pela página); o rótulo em maiúsculas fica fora da árvore.
  assert.match(HTML, /<div class="idioma" id="idioma" role="group" hidden>/);
  assert.match(HTML, /<span class="idioma-rotulo" id="idioma-rotulo" aria-hidden="true"><\/span>/);
  assert.match(HTML, /<button class="idioma-opcao" id="idioma-pt" type="button" lang="pt-BR" data-idioma="pt-BR" aria-pressed="false"><\/button>/);
  assert.match(HTML, /<button class="idioma-opcao" id="idioma-es" type="button" lang="es-PY" data-idioma="es-PY" aria-pressed="false"><\/button>/);
});

test('foco visível em todo controle; raio de 10 px; aviso com borda sólida e ícone; faixa com ícone de 20 px', () => {
  assert.match(regra(':focus-visible'), /outline:\s*2px solid var\(--acao\)/);
  assert.match(regra(':focus-visible'), /outline-offset:\s*2px/);
  assert.ok(!/outline:\s*(none|0)\b/.test(CSS), 'nenhum controle tira o anel');
  assert.match(CSS, /--raio-superficie:\s*10px;/);
  for (const s of ['.cartao', '.incidente', '.geral', '.aviso']) {
    assert.match(regra(s), /border-radius:\s*var\(--raio-superficie\)/, s);
  }
  assert.match(regra('.aviso'), /border:\s*1px solid var\(--aviso-borda\)/);
  assert.match(regra('.aviso'), /color:\s*var\(--aviso-texto\)/);
  assert.ok(!/dashed/.test(CSS), 'sem tracejado');
  assert.match(regra('.incidente-aberto'), /border-left:\s*3px solid var\(--amarelo\)/);
  assert.match(regra('.geral'), /padding:\s*1rem 1\.25rem/);
  assert.match(regra('.geral'), /color:\s*var\(--geral-texto\)/);
  // Os ícones: SVG em linha, nossos, fora da árvore de acessibilidade.
  const icones = [...HTML.matchAll(/<svg class="icone icone-(\w+)"[^>]*>/g)];
  // O info: o aviso de exemplo e os dois avisos do <noscript>.
  assert.deepEqual(icones.map((m) => m[1]).sort(), ['atrasado', 'degradado', 'fora', 'info', 'info', 'info', 'ok']);
  for (const lang of ['pt-BR', 'es-PY']) {
    assert.match(HTML, new RegExp(`<p class="aviso" lang="${lang}"><svg class="icone icone-info"[^>]*>.*?</svg><span>`));
  }
  for (const [svg, nome] of icones) {
    assert.match(svg, /aria-hidden="true"/, nome);
    assert.match(svg, nome === 'info' ? /width="18" height="18"/ : /width="20" height="20"/, nome);
  }
});

test('verde, amarelo e vermelho só no estado', () => {
  const doEstado = /^\.(estado-|tipo-|incidente-aberto|barra-|geral-)/;
  for (const [, seletor, corpo] of CSS.matchAll(/(?:^|\n)([^{}@\n][^{}\n]*?)\s*\{([^}]*)\}/g)) {
    if (/var\(--(barra-|geral-)?(verde|amarelo|vermelho|ok|degradado|fora|atrasado)\)/.test(corpo)) {
      assert.match(seletor.trim(), doEstado, `cor de estado fora do estado em ${seletor.trim()}`);
    }
  }
  for (const antigo of ['--fundo', '--borda', '--texto', '--suave']) {
    assert.ok(!new RegExp(`(?<![\\w-])${antigo}\\b`).test(CSS), `sobrou ${antigo}`);
  }
});
