// O incidente à mão: node scripts/incidente.mjs --dados <dir> [--agora <iso>] [--config config/alvos.json]
// As entradas vêm do ambiente: ACAO, ID, LINHAS, TIPO, ESTADO, TITULO_PT, TITULO_ES, TEXTO_PT, TEXTO_ES.
// Erro de entrada: sai com código 1 e não grava nada.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ErroDeEntrada, aplicarAcaoManual } from '../lib/manual.mjs';

const { values } = parseArgs({
  options: {
    dados: { type: 'string' },
    agora: { type: 'string' },
    config: { type: 'string', default: 'config/alvos.json' },
  },
});
if (!values.dados) {
  console.error('Uso: node scripts/incidente.mjs --dados <dir> [--agora <iso>]');
  process.exit(2);
}

const instante = values.agora ? new Date(values.agora) : new Date();
if (Number.isNaN(instante.getTime())) {
  console.error('Erro: --agora não é uma data ISO válida.');
  process.exit(2);
}

const config = JSON.parse(readFileSync(values.config, 'utf8'));
const caminho = join(values.dados, 'incidentes.json');
const atual = existsSync(caminho) ? JSON.parse(readFileSync(caminho, 'utf8')) : { incidentes: [] };

const e = process.env;
let lista;
try {
  lista = aplicarAcaoManual({
    incidentes: atual.incidentes,
    entrada: {
      acao: e.ACAO,
      id: e.ID,
      linhas: e.LINHAS,
      tipo: e.TIPO,
      estado: e.ESTADO,
      titulo_pt: e.TITULO_PT,
      titulo_es: e.TITULO_ES,
      texto_pt: e.TEXTO_PT,
      texto_es: e.TEXTO_ES,
    },
    config,
    instante: instante.toISOString(),
  });
} catch (erro) {
  if (!(erro instanceof ErroDeEntrada)) throw erro;
  console.error(`Erro: ${erro.message} Nada foi gravado.`);
  process.exit(1);
}

mkdirSync(values.dados, { recursive: true });
writeFileSync(caminho, `${JSON.stringify({ ...atual, incidentes: lista }, null, 2)}\n`);
const ultimo = lista.find((i) => !atual.incidentes.some((a) => a.id === i.id)) ?? null;
console.log(ultimo ? `Incidente aberto: ${ultimo.id}` : 'Incidente gravado.');
