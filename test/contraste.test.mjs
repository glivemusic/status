// D16: a marca (laranja e cinza) e o contraste AA dos pares de texto que mudaram, nos dois temas.
// Lê site/estilo.css, tira os tokens do :root claro e do escuro e confere >= 4,5:1.
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

// [texto, fundo]: os pares de texto que mudaram com D16.
const PARES = [
  ...['--tinta', '--apoio', '--discreto'].flatMap((t) => [[t, '--chao'], [t, '--cartao']]),
  ...['--acao', '--acao-hover'].flatMap((t) => [[t, '--chao'], [t, '--cartao'], [t, '--acao-suave']]),
  ['--marca-rotulo', '--chao'],
  ['--aviso-texto', '--aviso-fundo'],
];

test('contraste AA (>= 4,5:1) em cada par de texto que mudou, nos dois temas', (t) => {
  for (const tema of Object.keys(TEMAS)) {
    for (const [texto, fundo] of PARES) {
      const r = contraste(valor(tema, texto), valor(tema, fundo));
      t.diagnostic(`${tema}: ${texto} sobre ${fundo} = ${r.toFixed(2)}:1`);
      assert.ok(r >= 4.5, `${tema}: ${texto} sobre ${fundo} = ${r.toFixed(2)}:1`);
    }
  }
});

test('o cálculo de contraste confere com valores conhecidos', () => {
  assert.equal(contraste('#000000', '#ffffff'), 21);
  assert.equal(contraste('#777777', '#777777'), 1);
  assert.ok(Math.abs(contraste('#767676', '#ffffff') - 4.54) < 0.01);
});

test('os tokens de D16 com as cores do documento', () => {
  const claro = {
    '--marca-grafite': '#41403e',
    '--marca-laranja': '#d66a2f',
    '--acao': '#9d4d16',
    '--acao-hover': '#8c4311',
    '--acao-suave': '#ebeae8',
    '--tinta': '#201f1d',
    '--apoio': '#545351',
    '--discreto': '#696865',
    '--chao': '#f7f6f5',
    '--linha': '#e5e4e2',
    '--linha-forte': '#d8d7d5',
    '--cartao': '#ffffff',
    '--marca-rotulo': '#41403e',
  };
  for (const [k, v] of Object.entries(claro)) assert.equal(valor('claro', k), v, k);
  // No escuro: o laranja de texto e borda, o cinza de apoio, o rótulo no texto primário, o hexágono igual.
  assert.equal(valor('escuro', '--acao'), '#ea874c');
  assert.equal(valor('escuro', '--acao-hover'), '#ea874c');
  assert.equal(valor('escuro', '--apoio'), '#b2b0ae');
  assert.equal(valor('escuro', '--marca-rotulo'), valor('escuro', '--tinta'));
  assert.equal(valor('escuro', '--marca-laranja'), '#d66a2f');
  // A faixa de exemplo é a mesma nos dois temas.
  for (const tema of Object.keys(TEMAS)) {
    assert.equal(valor(tema, '--aviso-fundo'), '#faf0df');
    assert.equal(valor(tema, '--aviso-borda'), '#936228');
    assert.equal(valor(tema, '--aviso-texto'), '#201f1d');
  }
});

// As regras de um seletor exato (o corpo do bloco).
function regra(seletor) {
  const escapado = seletor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = CSS.match(new RegExp(`(?:^|\\n)${escapado}\\s*\\{([^}]*)\\}`));
  assert.ok(m, `falta a regra ${seletor}`);
  return m[1];
}

test('a marca: rótulo em maiúsculas, hexágono laranja só forma, botão e foco na cor da ação', () => {
  assert.match(regra('.marca'), /text-transform:\s*uppercase/);
  assert.match(regra('.marca'), /color:\s*var\(--marca-rotulo\)/);
  assert.match(regra('.hexagono'), /background:\s*var\(--marca-laranja\)/);
  assert.match(regra('.hexagono'), /clip-path:\s*polygon\(/);
  assert.match(HTML, /<span class="hexagono" aria-hidden="true"><\/span>/);
  assert.ok(!/\sstyle=/.test(HTML), 'sem estilo em linha (a CSP o bloqueia)');
  // O laranja da marca nunca vai em texto.
  assert.ok(![...CSS.matchAll(/(^|[\s;{])color:\s*var\(--marca-laranja\)/g)].length, 'laranja da marca em texto');
  assert.match(regra('.idioma'), /color:\s*var\(--acao\)/);
  assert.match(regra('.idioma'), /border:\s*1px solid var\(--acao\)/);
  assert.match(regra('.idioma:hover'), /color:\s*var\(--acao-hover\)/);
  assert.match(regra('.idioma:hover'), /background:\s*var\(--acao-suave\)/);
  assert.match(regra(':focus-visible'), /outline:\s*2px solid var\(--acao\)/);
  assert.ok(!CSS.includes('--foco'), 'o azul do foco saiu');
  assert.match(regra('.aviso'), /border:\s*1px dashed var\(--aviso-borda\)/);
  assert.match(regra('.aviso'), /color:\s*var\(--aviso-texto\)/);
});

test('verde, amarelo e vermelho só no estado; os neutros antigos saíram', () => {
  const doEstado = /^\.(estado-|tipo-|incidente-aberto|barra-|geral-)/;
  for (const [, seletor, corpo] of CSS.matchAll(/(?:^|\n)([^{}@\n][^{}\n]*?)\s*\{([^}]*)\}/g)) {
    if (/var\(--(barra-)?(verde|amarelo|vermelho)\)/.test(corpo)) {
      assert.match(seletor.trim(), doEstado, `cor de estado fora do estado em ${seletor.trim()}`);
    }
  }
  for (const antigo of ['--fundo', '--borda', '--texto', '--suave']) {
    assert.ok(!new RegExp(`${antigo}\\b`).test(CSS), `sobrou ${antigo}`);
  }
});
