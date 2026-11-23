// Uma checagem: node scripts/checar.mjs --dados <dir> --config config/alvos.json
// Lê estado.json, dias.json e incidentes.json de <dir>, roda a lógica de lib/ e grava de volta.
// Escreve publicar=true|false em $GITHUB_OUTPUT, quando existir.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { setTimeout as esperarMs } from 'node:timers/promises';
import { executarChecagem } from '../lib/checagem.mjs';
import { TEXTOS } from '../site/textos.mjs';

const { values } = parseArgs({
  options: { dados: { type: 'string' }, config: { type: 'string', default: 'config/alvos.json' } },
});
if (!values.dados) {
  console.error('Uso: node scripts/checar.mjs --dados <dir> [--config config/alvos.json]');
  process.exit(2);
}

function lerJson(caminho, padrao) {
  return existsSync(caminho) ? JSON.parse(readFileSync(caminho, 'utf8')) : padrao;
}
function gravarJson(caminho, valor) {
  writeFileSync(caminho, `${JSON.stringify(valor, null, 2)}\n`);
}

const config = JSON.parse(readFileSync(values.config, 'utf8'));
mkdirSync(values.dados, { recursive: true });
const arquivo = (nome) => join(values.dados, nome);

const saida = await executarChecagem({
  config,
  estado: lerJson(arquivo('estado.json'), {}),
  dias: lerJson(arquivo('dias.json'), {}),
  incidentes: lerJson(arquivo('incidentes.json'), { incidentes: [] }).incidentes,
  fetch: globalThis.fetch,
  relogio: Date.now,
  esperar: (ms) => esperarMs(ms),
  textos: TEXTOS,
});

gravarJson(arquivo('estado.json'), saida.estado);
gravarJson(arquivo('dias.json'), saida.dias);
gravarJson(arquivo('incidentes.json'), { incidentes: saida.incidentes });

// O log do Actions é público: só o id da linha e o estado.
for (const [linha, resultado] of Object.entries(saida.resultados)) console.log(`${linha}: ${resultado}`);
console.log(`publicar=${saida.publicar}`);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `publicar=${saida.publicar}\n`);
