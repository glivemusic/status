// D6: monitoramento atrasado e o estado geral.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estadoGeral, monitoramentoAtrasado } from '../lib/geral.mjs';

const verificado = '2026-11-23T20:00:00Z';

test('30 min não atrasa; 31 atrasa; sem checagem, atrasado', () => {
  assert.equal(monitoramentoAtrasado(verificado, '2026-11-23T20:30:00Z'), false);
  assert.equal(monitoramentoAtrasado(verificado, '2026-11-23T20:31:00Z'), true);
  assert.equal(monitoramentoAtrasado(null, '2026-11-23T20:00:00Z'), true);
});

test('a ordem do geral: atrasado, fora, degradado, ok; sem dado não muda', () => {
  const cedo = '2026-11-23T20:05:00Z';
  const tarde = '2026-11-23T21:00:00Z';
  assert.equal(estadoGeral(['fora', 'degradado'], verificado, tarde), 'atrasado');
  assert.equal(estadoGeral(['ok', 'degradado', 'fora'], verificado, cedo), 'fora');
  assert.equal(estadoGeral(['ok', 'degradado', 'sem_dado'], verificado, cedo), 'degradado');
  assert.equal(estadoGeral(['ok', 'sem_dado'], verificado, cedo), 'ok');
  assert.equal(estadoGeral(['ok', 'ok'], verificado, cedo), 'ok');
});
