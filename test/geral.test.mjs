// D6: monitoramento atrasado e o estado geral.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estadoGeral, estadosDoGeral, monitoramentoAtrasado } from '../lib/geral.mjs';
import { TEXTOS } from '../site/textos.mjs';

const verificado = '2026-11-23T20:00:00Z';

test('D14: 60 min não atrasa; 61 atrasa; sem checagem, atrasado', () => {
  assert.equal(monitoramentoAtrasado(verificado, '2026-11-23T20:31:00Z'), false);
  assert.equal(monitoramentoAtrasado(verificado, '2026-11-23T21:00:00Z'), false);
  assert.equal(monitoramentoAtrasado(verificado, '2026-11-23T21:00:59Z'), true);
  assert.equal(monitoramentoAtrasado(verificado, '2026-11-23T21:01:00Z'), true);
  assert.equal(monitoramentoAtrasado(null, '2026-11-23T20:00:00Z'), true);
});

test('D14: o texto do atrasado fala em 60 minutos nos dois idiomas', () => {
  assert.equal(TEXTOS['pt-BR']['geral.atrasado'], 'Monitoramento atrasado: a última checagem tem mais de 60 minutos');
  assert.equal(TEXTOS['es-PY']['geral.atrasado'], 'Monitoreo atrasado: la última verificación tiene más de 60 minutos');
});

test('a ordem do geral: atrasado, fora, degradado, ok; sem dado não muda', () => {
  const cedo = '2026-11-23T20:05:00Z';
  const tarde = '2026-11-23T21:01:00Z';
  assert.equal(estadoGeral(['fora', 'degradado'], verificado, tarde), 'atrasado');
  assert.equal(estadoGeral(['ok', 'degradado', 'fora'], verificado, cedo), 'fora');
  assert.equal(estadoGeral(['ok', 'degradado', 'sem_dado'], verificado, cedo), 'degradado');
  assert.equal(estadoGeral(['ok', 'sem_dado'], verificado, cedo), 'ok');
  assert.equal(estadoGeral(['ok', 'ok'], verificado, cedo), 'ok');
});

test('D24: estadosDoGeral deixa de fora a linha em breve e a linha fora_do_geral, só com o booleano true', () => {
  const linhas = [
    { id: 'app', estado: 'ok' },
    { id: 'login', estado: 'degradado' },
    { id: 'banco', em_breve: true, estado: 'fora' },
    { id: 'satelite', estado: 'degradado', fora_do_geral: true },
  ];
  assert.deepEqual(estadosDoGeral(linhas), ['ok', 'degradado']);
  // A marca só vale com true: outro valor não tira a linha do geral.
  assert.deepEqual(estadosDoGeral([{ estado: 'fora', fora_do_geral: 'sim' }, { estado: 'ok', fora_do_geral: false }]), ['fora', 'ok']);
  const cedo = '2026-11-23T20:05:00Z';
  assert.equal(estadoGeral(estadosDoGeral([{ estado: 'ok' }, { estado: 'fora', fora_do_geral: true }]), verificado, cedo), 'ok');
  assert.equal(estadoGeral(estadosDoGeral([{ estado: 'fora' }, { estado: 'ok', fora_do_geral: true }]), verificado, cedo), 'fora');
  assert.deepEqual(estadosDoGeral(undefined), []);
});
