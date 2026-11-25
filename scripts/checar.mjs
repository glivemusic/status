// A medida de uma checagem (D13): node scripts/checar.mjs --medida <arquivo> [--config config/alvos.json]
// Chama os alvos uma vez só e grava { instante, resultados, fatos } em <arquivo> (no Actions, em $RUNNER_TEMP,
// fora da árvore do ramo). Quem aplica a medida aos dados e grava no ramo é scripts/gravar-dados.mjs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as esperarMs } from 'node:timers/promises';
import { arquivoDaMedida, medirChecagem } from '../lib/checagem.mjs';

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
writeFileSync(values.medida, `${JSON.stringify(arquivoDaMedida(medida), null, 2)}\n`);

// O log do Actions é público: só o id da linha e o estado e, por alvo que falhou, o motivo (um texto fixo de
// `MOTIVOS`, D25; nunca corpo, cabeçalho, endereço ou mensagem de erro).
for (const [linha, resultado] of Object.entries(medida.resultados)) console.log(`${linha}: ${resultado}`);
for (const [alvo, motivo] of Object.entries(medida.motivos)) console.log(`Motivo de ${alvo}: ${motivo}.`);
console.log(`Medida de ${medida.instante} gravada.`);
