// Gera os dados de exemplo (D7): node scripts/gerar-exemplo.mjs [--saida exemplo]
// Determinístico: «agora» fixo e sorteio com semente fixa. Os três arquivos levam "exemplo": true.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { atualizarMinutosFora, esperadasNoDia, minutosNoDia } from '../lib/dias.mjs';
import { fecharAutomatico, novoIncidenteAutomatico } from '../lib/incidentes.mjs';
import { diaDeAssuncao, somarDias } from '../lib/tempo.mjs';
import { TEXTOS } from '../site/textos.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { saida: { type: 'string', default: join(RAIZ, 'exemplo') } } });

const AGORA = '2026-11-23T21:00:00Z';
const VERIFICADO = '2026-11-23T20:57:00Z';
const DIA_SEM_REGISTRO = '2026-09-05';
const DIA_CINZA = '2026-10-28';

const config = JSON.parse(readFileSync(join(RAIZ, 'config', 'alvos.json'), 'utf8'));
const nome = Object.fromEntries(config.linhas.map((l) => [l.id, l.nome]));
const t = (s) => `2026-${s}:00Z`;

// Sorteio com semente (mulberry32).
let semente = 20261123;
function sorteio() {
  semente = (semente + 0x6d2b79f5) | 0;
  let x = Math.imul(semente ^ (semente >>> 15), 1 | semente);
  x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
  return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
}

function manual(id, linhas, tipo, inicio, fim, titulo, atualizacoes) {
  return {
    id,
    linhas,
    tipo,
    inicio,
    fim,
    origem: 'manual',
    titulo: { 'pt-BR': titulo[0], 'es-PY': titulo[1] },
    atualizacoes: atualizacoes.map(([em, estado, pt, es]) => ({ em, estado, texto: { 'pt-BR': pt, 'es-PY': es } })),
  };
}

function automatico(linha, tipo, inicio, detectado, fim, fechado, extras = []) {
  const i = novoIncidenteAutomatico({ linha, nome: nome[linha], tipo, inicio, instante: detectado, textos: TEXTOS });
  for (const [em, estado, pt, es] of extras) i.atualizacoes.push({ em, estado, texto: { 'pt-BR': pt, 'es-PY': es } });
  if (fim) fecharAutomatico(i, fim, fechado, TEXTOS);
  return i;
}

const incidentes = [
  manual(
    '20260714-1520-manual',
    ['banco'],
    'fora',
    t('07-14T15:20'),
    t('07-14T16:05'),
    ['Falha ao carregar os dados dos talhões', 'Falla al cargar los datos de los lotes'],
    [
      [
        t('07-14T15:20'),
        'investigando',
        'Estamos investigando uma falha ao carregar os dados dos talhões.',
        'Estamos investigando una falla al cargar los datos de los lotes.',
      ],
      [
        t('07-14T16:05'),
        'resolvido',
        'A falha foi corrigida e os dados voltaram a carregar normalmente.',
        'La falla fue corregida y los datos volvieron a cargar normalmente.',
      ],
    ],
  ),
  automatico('app', 'degradado', t('09-20T14:02'), t('09-20T14:12'), t('09-20T15:17'), t('09-20T15:22')),
  manual(
    '20261015-1100-manual',
    ['login'],
    'fora',
    t('10-15T11:00'),
    t('10-15T11:07'),
    ['Dificuldade para entrar nas contas', 'Dificultad para iniciar sesión en las cuentas'],
    [
      [
        t('10-15T11:00'),
        'investigando',
        'Alguns usuários não conseguem entrar. Estamos investigando.',
        'Algunos usuarios no logran iniciar sesión. Estamos investigando.',
      ],
      [
        t('10-15T11:04'),
        'monitorando',
        'A correção foi aplicada e estamos acompanhando.',
        'La corrección fue aplicada y estamos acompañando.',
      ],
      [
        t('10-15T11:07'),
        'resolvido',
        'O login voltou a funcionar normalmente.',
        'El inicio de sesión volvió a funcionar normalmente.',
      ],
    ],
  ),
  automatico('app', 'fora', t('11-02T13:12'), t('11-02T13:17'), t('11-02T14:02'), t('11-02T14:07'), [
    [
      t('11-02T13:30'),
      'identificado',
      'A causa foi identificada e a correção está sendo aplicada.',
      'La causa fue identificada y la corrección se está aplicando.',
    ],
  ]),
  manual(
    '20261110-1230-manual',
    ['satelite'],
    'degradado',
    t('11-10T12:30'),
    t('11-10T15:45'),
    ['Atraso na chegada de imagens novas', 'Retraso en la llegada de imágenes nuevas'],
    [
      [
        t('11-10T12:30'),
        'investigando',
        'As imagens de satélite novas estão chegando com atraso. Estamos investigando.',
        'Las imágenes satelitales nuevas están llegando con retraso. Estamos investigando.',
      ],
      [
        t('11-10T13:10'),
        'identificado',
        'O atraso vem da fila de processamento das imagens; a correção está em andamento.',
        'El retraso viene de la cola de procesamiento de las imágenes; la corrección está en curso.',
      ],
      [
        t('11-10T15:45'),
        'resolvido',
        'As imagens voltaram a chegar no prazo normal.',
        'Las imágenes volvieron a llegar en el plazo normal.',
      ],
    ],
  ),
  automatico('banco', 'degradado', t('11-23T19:47'), t('11-23T19:57'), null, null),
];

// Os dias: 90, do mais velho a hoje.
const hoje = diaDeAssuncao(AGORA);
const dias = { exemplo: true };
for (const l of config.linhas) {
  dias[l.id] = {};
  for (let n = 89; n >= 0; n -= 1) {
    const dia = somarDias(hoje, -n);
    const perdidas = Math.floor(sorteio() * 3);
    const degradadaSolta = sorteio() < 0.15 ? 1 : 0;
    if (dia === DIA_SEM_REGISTRO) continue;
    let feitas = 288 - perdidas;
    if (dia === hoje) feitas = esperadasNoDia(dia, AGORA);
    if (dia === DIA_CINZA) feitas = 120;
    const fora = Math.round(minutosNoDia(incidentes, l.id, dia, AGORA, 'fora') / 5);
    const degradado = Math.round(minutosNoDia(incidentes, l.id, dia, AGORA, 'degradado') / 5) + degradadaSolta;
    dias[l.id][dia] = { feitas, ok: feitas - fora - degradado, degradado, fora, minutos_fora: 0 };
  }
}
atualizarMinutosFora(dias, incidentes, AGORA);

function boasDesde(inicio) {
  return (Date.parse(VERIFICADO) - Date.parse(inicio)) / 300_000 + 1;
}
function linhaOk(inicio) {
  return {
    estado: 'ok',
    fora_seguidas: 0,
    degradadas_seguidas: 0,
    boas_seguidas: boasDesde(inicio),
    serie_inicio: inicio,
    incidente: null,
  };
}

const estado = {
  exemplo: true,
  agora: AGORA,
  verificado_em: VERIFICADO,
  publicado_em: VERIFICADO,
  linhas: {
    app: linhaOk(t('11-23T14:37')),
    login: linhaOk(t('11-22T09:12')),
    banco: {
      estado: 'degradado',
      fora_seguidas: 0,
      degradadas_seguidas: boasDesde(t('11-23T19:47')),
      boas_seguidas: 0,
      serie_inicio: t('11-23T19:47'),
      incidente: '20261123-1947-banco',
    },
    satelite: linhaOk(t('11-21T18:02')),
  },
};

const saida = resolve(values.saida);
mkdirSync(saida, { recursive: true });
const gravar = (arquivo, valor) => writeFileSync(join(saida, arquivo), `${JSON.stringify(valor, null, 2)}\n`);
gravar('estado.json', estado);
gravar('dias.json', dias);
gravar('incidentes.json', { exemplo: true, incidentes });
console.log(`Exemplo gerado em ${saida}.`);
