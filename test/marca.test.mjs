// D22: o símbolo oficial do Agronomy Center, recortado do logo do app sem redesenho. Os dois SVG do site têm os
// mesmos `d`, a mesma transformação e as mesmas cores do grupo do arquivo oficial; o escuro só não tem o fio branco.
// A lista de `d` esperada foi copiada do grupo do símbolo de basefertilapp/static/marca/agronomy-center.svg e
// conferida contra ele em 24/11/2026; o teste não lê o basefertilapp.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const ler = (nome) => readFileSync(new URL(`../site/marca/${nome}`, import.meta.url), 'utf8');

const HEXAGONO_DE_FORA =
  'M46.5 8.52 A7 7 0 0 1 53.5 8.52 L84.17 26.23 A7 7 0 0 1 87.67 32.29 L87.67 67.71 A7 7 0 0 1 84.17 73.77 L53.5 91.48 A7 7 0 0 1 46.5 91.48 L15.83 73.77 A7 7 0 0 1 12.33 67.71 L12.33 32.29 A7 7 0 0 1 15.83 26.23 Z';

// [pintura, d], na ordem do arquivo oficial. `fio` é o fio branco (só no claro); `anel` é o anel cinza; `miolo`, o
// hexágono laranja; `traco` e `ponto`, a tela com o gráfico, a haste e a terra pontilhada.
const OFICIAL = [
  ['fio', HEXAGONO_DE_FORA],
  ['anel', HEXAGONO_DE_FORA],
  ['miolo', 'M48 14.58 A4 4 0 0 1 52 14.58 L79.67 30.56 A4 4 0 0 1 81.67 34.02 L81.67 65.98 A4 4 0 0 1 79.67 69.44 L52 85.42 A4 4 0 0 1 48 85.42 L20.33 69.44 A4 4 0 0 1 18.33 65.98 L18.33 34.02 A4 4 0 0 1 20.33 30.56 Z'],
  ['traco', 'M39.9 25.5 H60.1 A3.4 3.4 0 0 1 63.5 28.9 V43.1 A3.4 3.4 0 0 1 60.1 46.5 H39.9 A3.4 3.4 0 0 1 36.5 43.1 V28.9 A3.4 3.4 0 0 1 39.9 25.5 Z'],
  ['traco', 'M41.6 29 H58.4 A1.6 1.6 0 0 1 60 30.6 V38.4 A1.6 1.6 0 0 1 58.4 40 H41.6 A1.6 1.6 0 0 1 40 38.4 V30.6 A1.6 1.6 0 0 1 41.6 29 Z'],
  ['traco', 'M43 37.2 L46 34.4 L48.8 36.2 L52.4 32.4 L54.7 34 L57.2 31.8'],
  ['ponto', 'M44.4 43.3 L47 41.8 L47 44.8 Z'],
  ['ponto', 'M48.7 43.3 A1.3 1.3 0 1 0 51.3 43.3 A1.3 1.3 0 1 0 48.7 43.3 Z'],
  ['ponto', 'M55.6 43.3 L53 41.8 L53 44.8 Z'],
  ['traco', 'M50 46.5 L50 64.2'],
  ['traco', 'M47.6 66.6 A2.4 2.4 0 1 0 52.4 66.6 A2.4 2.4 0 1 0 47.6 66.6 Z'],
  ['traco', 'M24 58.5 L76 58.5'],
  ['ponto', 'M25.9 62.6 A1.1 1.1 0 1 0 28.1 62.6 A1.1 1.1 0 1 0 25.9 62.6 Z'],
  ['ponto', 'M33.6 63.8 A0.9 0.9 0 1 0 35.4 63.8 A0.9 0.9 0 1 0 33.6 63.8 Z'],
  ['ponto', 'M39.8 62.4 A1.2 1.2 0 1 0 42.2 62.4 A1.2 1.2 0 1 0 39.8 62.4 Z'],
  ['ponto', 'M57.5 62.8 A1 1 0 1 0 59.5 62.8 A1 1 0 1 0 57.5 62.8 Z'],
  ['ponto', 'M64.3 63.9 A1.2 1.2 0 1 0 66.7 63.9 A1.2 1.2 0 1 0 64.3 63.9 Z'],
  ['ponto', 'M71.6 62.5 A0.9 0.9 0 1 0 73.4 62.5 A0.9 0.9 0 1 0 71.6 62.5 Z'],
  ['ponto', 'M29.3 67.4 A1.2 1.2 0 1 0 31.7 67.4 A1.2 1.2 0 1 0 29.3 67.4 Z'],
  ['ponto', 'M37 68.6 A1 1 0 1 0 39 68.6 A1 1 0 1 0 37 68.6 Z'],
  ['ponto', 'M42.8 66.6 A0.8 0.8 0 1 0 44.4 66.6 A0.8 0.8 0 1 0 42.8 66.6 Z'],
  ['ponto', 'M56.4 67.4 A1 1 0 1 0 58.4 67.4 A1 1 0 1 0 56.4 67.4 Z'],
  ['ponto', 'M61.8 68.8 A1.2 1.2 0 1 0 64.2 68.8 A1.2 1.2 0 1 0 61.8 68.8 Z'],
  ['ponto', 'M69 67.2 A1 1 0 1 0 71 67.2 A1 1 0 1 0 69 67.2 Z'],
  ['ponto', 'M32.6 72.4 A0.9 0.9 0 1 0 34.4 72.4 A0.9 0.9 0 1 0 32.6 72.4 Z'],
  ['ponto', 'M39.8 73.2 A1.2 1.2 0 1 0 42.2 73.2 A1.2 1.2 0 1 0 39.8 73.2 Z'],
  ['ponto', 'M47.5 73 A1 1 0 1 0 49.5 73 A1 1 0 1 0 47.5 73 Z'],
  ['ponto', 'M54.6 73.6 A0.9 0.9 0 1 0 56.4 73.6 A0.9 0.9 0 1 0 54.6 73.6 Z'],
  ['ponto', 'M61.3 72.2 A1.2 1.2 0 1 0 63.7 72.2 A1.2 1.2 0 1 0 61.3 72.2 Z'],
  ['ponto', 'M67.2 73.6 A0.8 0.8 0 1 0 68.8 73.6 A0.8 0.8 0 1 0 67.2 73.6 Z'],
  ['ponto', 'M37.5 77.4 A1 1 0 1 0 39.5 77.4 A1 1 0 1 0 37.5 77.4 Z'],
  ['ponto', 'M44.3 78.4 A1.2 1.2 0 1 0 46.7 78.4 A1.2 1.2 0 1 0 44.3 78.4 Z'],
  ['ponto', 'M52.1 77.6 A0.9 0.9 0 1 0 53.9 77.6 A0.9 0.9 0 1 0 52.1 77.6 Z'],
  ['ponto', 'M59 78.2 A1 1 0 1 0 61 78.2 A1 1 0 1 0 59 78.2 Z'],
  ['ponto', 'M45.6 82 A0.9 0.9 0 1 0 47.4 82 A0.9 0.9 0 1 0 45.6 82 Z'],
  ['ponto', 'M52.4 81.8 A1.1 1.1 0 1 0 54.6 81.8 A1.1 1.1 0 1 0 52.4 81.8 Z'],
];

// As tintas do logo: o fio branco, o anel cinza, o miolo laranja e o grafite do desenho.
const PINTURAS = {
  fio: { fill: '#ffffff' },
  anel: { fill: 'none', stroke: '#696865', 'stroke-width': '6', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
  miolo: { fill: '#d66a2f' },
  traco: { fill: 'none', stroke: '#201f1d', 'stroke-width': '2.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' },
  ponto: { fill: '#201f1d' },
};

const atributos = (tag) => Object.fromEntries([...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v]));

function desenho(svg) {
  const elementos = [...svg.matchAll(/<([a-zA-Z][\w:-]*)\b/g)].map((m) => m[1]);
  const raiz = atributos(svg.match(/<svg\b[^>]*>/)[0]);
  const grupo = atributos(svg.match(/<g\b[^>]*>/)[0]);
  const caminhos = [...svg.matchAll(/<path\b[^>]*>/g)].map((m) => atributos(m[0]));
  return { elementos, raiz, grupo, caminhos };
}

const esperado = (lista) => lista.map(([pintura, d]) => ({ ...PINTURAS[pintura], d }));

for (const [nome, lista] of [
  ['simbolo.svg', OFICIAL],
  ['simbolo-escuro.svg', OFICIAL.filter(([pintura]) => pintura !== 'fio')],
]) {
  test(`D22: ${nome} é o grupo do símbolo oficial, sem redesenho`, () => {
    const { elementos, raiz, grupo, caminhos } = desenho(ler(nome));
    // Só o quadro, um grupo e os caminhos: nada de texto, imagem, script ou link.
    assert.deepEqual(elementos, ['svg', 'g', ...caminhos.map(() => 'path')]);
    assert.deepEqual(raiz, { xmlns: 'http://www.w3.org/2000/svg', viewBox: '0 0 42 42', 'aria-hidden': 'true' });
    assert.deepEqual(grupo, { transform: 'translate(-4.313 -2.119) scale(0.462)' });
    assert.deepEqual(caminhos, esperado(lista));
  });
}

test('D22: o escuro é o claro sem o fio branco, e só ele muda', () => {
  const claro = desenho(ler('simbolo.svg'));
  const escuro = desenho(ler('simbolo-escuro.svg'));
  const brancos = claro.caminhos.filter((c) => c.fill === '#ffffff');
  assert.equal(brancos.length, 1, 'um só fio branco no claro');
  assert.deepEqual(escuro.caminhos, claro.caminhos.filter((c) => c !== brancos[0]));
  assert.ok(!/#fff\b|#ffffff|white/i.test(ler('simbolo-escuro.svg')), 'nada de branco no escuro');
  // As cores do logo nos dois; o fio do claro e o anel desenham o mesmo hexágono de fora.
  for (const svg of [ler('simbolo.svg'), ler('simbolo-escuro.svg')]) {
    for (const cor of ['#696865', '#d66a2f', '#201f1d']) assert.ok(svg.includes(cor), cor);
  }
  assert.equal(brancos[0].d, claro.caminhos.find((c) => c.stroke === '#696865').d);
  assert.equal(new Set(OFICIAL.map(([, d]) => d)).size, OFICIAL.length - 1, 'só o fio e o anel repetem o d');
});
