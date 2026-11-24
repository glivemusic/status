// A medida de uma checagem (D13): node scripts/checar.mjs --medida <arquivo> [--config config/alvos.json]
// Chama os alvos uma vez só e grava { instante, resultados, fatos } em <arquivo> (no Actions, em $RUNNER_TEMP,
// fora da árvore do ramo). Quem aplica a medida aos dados e grava no ramo é scripts/gravar-dados.mjs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as esperarMs } from 'node:timers/promises';
import { medirChecagem } from '../lib/checagem.mjs';

const { values } = parseArgs({
  options: { medida: { type: 'string' }, config: { type: 'string', default: 'config/alvos.json' } },
});
if (!values.medida) {
  console.error('Uso: node scripts/checar.mjs --medida <arquivo> [--config config/alvos.json]');
  process.exit(2);
}

const config = JSON.parse(readFileSync(values.config, 'utf8'));
const medida = await medirChecagem({
  config,
  fetch: globalThis.fetch,
  relogio: Date.now,
  esperar: (ms) => esperarMs(ms),
});

mkdirSync(dirname(values.medida), { recursive: true });
writeFileSync(values.medida, `${JSON.stringify(medida, null, 2)}\n`);

// O log do Actions é público: só o id da linha e o estado.
for (const [linha, resultado] of Object.entries(medida.resultados)) console.log(`${linha}: ${resultado}`);
console.log(`Medida de ${medida.instante} gravada.`);
