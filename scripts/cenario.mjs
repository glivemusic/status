// D19: os cenários de teste das fotos, feitos a partir dos dados de exemplo:
//   node scripts/cenario.mjs --cenario tudo-ok|fora|atrasado --saida <pasta>
// Só para fotografar (scripts/fotos.mjs grava numa pasta temporária). Os três arquivos levam "exemplo": true, como o
// exemplo, e nunca vão ao site publicado: o workflow das páginas só monta com `exemplo` ou com o ramo dados.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { atualizarMinutosFora } from '../lib/dias.mjs';
import { novoIncidenteAutomatico } from '../lib/incidentes.mjs';
import { emMs } from '../lib/tempo.mjs';
import { TEXTOS } from '../site/textos.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MINUTO = 60_000;

export const CENARIOS = ['tudo-ok', 'fora', 'atrasado'];

const iso = (ms) => new Date(ms).toISOString();

// `exemplo`: { estado, dias, incidentes } como em exemplo/. Não muda a entrada. -> { estado, dias, incidentes }
// - tudo-ok: todas as linhas operacionais e nenhum incidente aberto;
// - fora: o aplicativo fora do ar há 40 min, com o incidente automático aberto;
// - atrasado: a última checagem tem 2 h (monitoramento atrasado).
export function montarCenario(nome, exemplo, { config, textos = TEXTOS }) {
  const estado = structuredClone(exemplo.estado);
  const dias = structuredClone(exemplo.dias);
  let incidentes = structuredClone(exemplo.incidentes.incidentes ?? []);
  const agora = emMs(estado.agora);
  if (nome === 'tudo-ok') {
    for (const linha of Object.values(estado.linhas)) {
      linha.estado = 'ok';
      linha.incidente = null;
      linha.fora_seguidas = 0;
      linha.degradadas_seguidas = 0;
    }
    incidentes = incidentes.filter((i) => i.fim !== null);
  } else if (nome === 'fora') {
    const app = config.linhas.find((l) => l.id === 'app');
    const inicio = iso(agora - 40 * MINUTO);
    const i = novoIncidenteAutomatico({
      linha: app.id,
      nome: app.nome,
      tipo: 'fora',
      inicio,
      instante: iso(agora - 35 * MINUTO),
      textos,
    });
    incidentes.push(i);
    // D4: o incidente abre na 2ª leitura fora seguida.
    estado.linhas[app.id] = {
      ...estado.linhas[app.id],
      estado: 'fora',
      fora_seguidas: 2,
      degradadas_seguidas: 0,
      boas_seguidas: 0,
      serie_inicio: inicio,
      incidente: i.id,
    };
    atualizarMinutosFora(dias, incidentes, agora);
  } else if (nome === 'atrasado') {
    estado.verificado_em = iso(agora - 120 * MINUTO);
    estado.publicado_em = estado.verificado_em;
  } else {
    throw new Error(`cenário desconhecido: ${nome}`);
  }
  return { estado, dias, incidentes: { exemplo: true, incidentes } };
}

function principal() {
  const { values } = parseArgs({ options: { cenario: { type: 'string' }, saida: { type: 'string' } } });
  if (!CENARIOS.includes(values.cenario) || !values.saida) {
    console.error(`Uso: node scripts/cenario.mjs --cenario ${CENARIOS.join('|')} --saida <pasta>`);
    process.exit(2);
  }
  const ler = (nome) => JSON.parse(readFileSync(join(RAIZ, 'exemplo', nome), 'utf8'));
  const config = JSON.parse(readFileSync(join(RAIZ, 'config', 'alvos.json'), 'utf8'));
  const exemplo = { estado: ler('estado.json'), dias: ler('dias.json'), incidentes: ler('incidentes.json') };
  const r = montarCenario(values.cenario, exemplo, { config });
  const saida = resolve(values.saida);
  mkdirSync(saida, { recursive: true });
  for (const [nome, valor] of [['estado.json', r.estado], ['dias.json', r.dias], ['incidentes.json', r.incidentes]]) {
    writeFileSync(join(saida, nome), `${JSON.stringify(valor, null, 2)}\n`);
  }
  console.log(`Cenário ${values.cenario} em ${saida}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) principal();
