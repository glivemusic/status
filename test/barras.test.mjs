// D19: as barras da página: quantas aparecem, a navegação por setas e a data curta do nome de cada dia.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DIAS_NO_CELULAR, diaCurto, diaPelaTecla, quantasBarras } from '../lib/barras.mjs';
import { TEXTOS } from '../site/textos.mjs';

test('abaixo de 48rem são 30 barras; acima, as 90', () => {
  assert.equal(DIAS_NO_CELULAR, 30);
  assert.equal(quantasBarras(true), 30);
  assert.equal(quantasBarras(false), 90);
});

test('as setas andam um dia e param na ponta; Home vai ao mais velho, End a hoje', () => {
  // 90 dias: 0 é o mais velho, 89 é hoje (a parada de Tab inicial).
  assert.equal(diaPelaTecla(89, 'ArrowLeft', 90), 88);
  assert.equal(diaPelaTecla(88, 'ArrowRight', 90), 89);
  assert.equal(diaPelaTecla(89, 'ArrowRight', 90), 89, 'hoje é a ponta da direita');
  assert.equal(diaPelaTecla(0, 'ArrowLeft', 90), 0, 'o mais velho é a ponta da esquerda');
  assert.equal(diaPelaTecla(45, 'Home', 90), 0);
  assert.equal(diaPelaTecla(3, 'End', 90), 89);
  assert.equal(diaPelaTecla(29, 'End', 30), 29);
  // Andar pelos 30 dias, de hoje até o mais velho, com a seta esquerda.
  let i = 29;
  for (let passo = 0; passo < 40; passo += 1) i = diaPelaTecla(i, 'ArrowLeft', 30);
  assert.equal(i, 0);
});

test('outras teclas não são das barras (o Tab sai do grupo, as setas de cima e de baixo rolam a página)', () => {
  for (const tecla of ['Tab', 'ArrowUp', 'ArrowDown', 'Enter', ' ', 'Escape', 'a']) {
    assert.equal(diaPelaTecla(10, tecla, 90), null, tecla);
  }
  assert.equal(diaPelaTecla(0, 'ArrowLeft', 0), null, 'sem barras');
  // O foco fora do grupo (indexOf = -1) ou um índice que não é dia: nada muda.
  for (const atual of [-1, 90, 1.5, undefined]) assert.equal(diaPelaTecla(atual, 'ArrowLeft', 90), null, String(atual));
});

test('a data curta do nome do dia, nos dois idiomas', () => {
  const pt = TEXTOS['pt-BR'];
  const es = TEXTOS['es-PY'];
  assert.equal(diaCurto('2026-11-23', pt['barra.data'], pt.meses), '23 de nov.');
  assert.equal(diaCurto('2026-09-05', pt['barra.data'], pt.meses), '5 de set.');
  assert.equal(diaCurto('2026-02-01', pt['barra.data'], pt.meses), '1 de fev.');
  assert.equal(diaCurto('2026-11-23', es['barra.data'], es.meses), '23 de nov.');
  assert.equal(diaCurto('2026-01-02', es['barra.data'], es.meses), '2 de ene.');
  assert.equal(diaCurto('2026-12-31', es['barra.data'], es.meses), '31 de dic.');
  assert.equal(pt.meses.split(' ').length, 12);
  assert.equal(es.meses.split(' ').length, 12);
});
