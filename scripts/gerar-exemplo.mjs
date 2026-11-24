// Gera os dados de exemplo (D7): node scripts/gerar-exemplo.mjs [--saida exemplo]
// Determinístico: «agora» fixo e sorteio com semente fixa. Os três arquivos levam "exemplo": true.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { atualizarMinutosFora, esperadasNoDia, intervaloDaLinha, linhaPorFato, minutosNoDia } from '../lib/dias.mjs';
import { CHAVES_DO_SATELITE, fecharAutomatico, novoIncidenteAutomatico } from '../lib/incidentes.mjs';
import { diaDeAssuncao, somarDias } from '../lib/tempo.mjs';
import { TEXTOS } from '../site/textos.mjs';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({ options: { saida: { type: 'string', default: join(RAIZ, 'exemplo') } } });

const AGORA = '2026-11-23T21:00:00Z';
const VERIFICADO = '2026-11-23T20:57:00Z';
const DIA_SEM_REGISTRO = '2026-09-05';
const DIA_CINZA = '2026-10-28';

// D11: a linha do satélite conta fatos (um a cada 2 h, nas horas pares UTC). Um incidente dela, resolvido:
// fatos degradados às 12:00 e às 14:00 (abre na checagem das 14:02), fato bom às 16:00 (fecha às 16:02).
const SATELITE_DIA = '2026-11-10';
const SATELITE_INICIO = '2026-11-10T12:00:00Z';
const SATELITE_FIM = '2026-11-10T16:00:00Z';
const SATELITE_BONS_NO_DIA = 6; // 16, 18, 20 e 22 h UTC do dia 10 e 0 e 2 h UTC do dia 11 (ainda 10 em Assunção)
const SATELITE_ULTIMO_FATO = '2026-11-23T20:00:00Z';

const config = JSON.parse(readFileSync(join(RAIZ, 'config', 'alvos.json'), 'utf8'));
const nome = Object.fromEntries(config.linhas.map((l) => [l.id, l.nome]));
const porFato = Object.fromEntries(config.linhas.map((l) => [l.id, linhaPorFato(l)]));
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
  const chaves = porFato[linha] ? CHAVES_DO_SATELITE : null;
  const i = novoIncidenteAutomatico({ linha, nome: nome[linha], tipo, inicio, instante: detectado, textos: TEXTOS, chaves });
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
  automatico('satelite', 'degradado', SATELITE_INICIO, t('11-10T14:02'), SATELITE_FIM, t('11-10T16:02')),
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
    if (porFato[l.id]) {
      // D11: fatos, não leituras; o degradado só nos 2 fatos do incidente; nunca fora.
      const previstos = esperadasNoDia(dia, AGORA, intervaloDaLinha(l));
      let feitas = dia === hoje || dia === SATELITE_DIA ? previstos : previstos - perdidas;
      if (dia === DIA_CINZA) feitas = Math.floor(previstos / 2) - 1;
      const degradado = dia === SATELITE_DIA ? 2 : 0;
      dias[l.id][dia] = { feitas, ok: feitas - degradado, degradado, fora: 0, minutos_fora: 0 };
      continue;
    }
    let feitas = 288 - perdidas;
    if (dia === hoje) feitas = esperadasNoDia(dia, AGORA);
    if (dia === DIA_CINZA) feitas = 120;
    const fora = Math.round(minutosNoDia(incidentes, l.id, dia, AGORA, 'fora') / 5);
    const degradado = Math.round(minutosNoDia(incidentes, l.id, dia, AGORA, 'degradado') / 5) + degradadaSolta;
    dias[l.id][dia] = { feitas, ok: feitas - fora - degradado, degradado, fora, minutos_fora: 0 };
  }
}
atualizarMinutosFora(dias, incidentes, AGORA);

// Os fatos bons desde o que fechou o incidente do satélite.
const satelite = config.linhas.find((l) => porFato[l.id]).id;
const fatosBons =
  SATELITE_BONS_NO_DIA +
  Object.entries(dias[satelite])
    .filter(([dia]) => dia > SATELITE_DIA)
    .reduce((soma, [, r]) => soma + r.ok, 0);

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
    [satelite]: {
      estado: 'ok',
      fora_seguidas: 0,
      degradadas_seguidas: 0,
      boas_seguidas: fatosBons,
      serie_inicio: SATELITE_FIM,
      incidente: null,
      verificado_em: SATELITE_ULTIMO_FATO,
    },
  },
};

const saida = resolve(values.saida);
mkdirSync(saida, { recursive: true });
const gravar = (arquivo, valor) => writeFileSync(join(saida, arquivo), `${JSON.stringify(valor, null, 2)}\n`);
gravar('estado.json', estado);
gravar('dias.json', dias);
gravar('incidentes.json', { exemplo: true, incidentes });
console.log(`Exemplo gerado em ${saida}.`);
