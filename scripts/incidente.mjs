// O incidente à mão.
//   No ramo dados (o workflow):  node scripts/incidente.mjs --arvore <pasta> --remoto <url> [--agora <iso>]
//                                     [--config config/alvos.json] [--espera-min 1000] [--espera-max 4000]
//   Numa pasta, sem git:         node scripts/incidente.mjs --dados <dir> [--agora <iso>] [--config ...]
// As entradas vêm do ambiente: ACAO, ID, LINHAS, TIPO, ESTADO, TITULO_PT, TITULO_ES, TEXTO_PT, TEXTO_ES.
// D13: o que não depende dos dados é conferido antes de qualquer git; a hora (e o id do manual) é fixada uma vez.
// O que depende dos dados (o id existir, ou já existir ao abrir) é conferido em cada tentativa, contra o arquivo
// recém-lido. Erro de entrada: sai com código 1, sem push e sem nova tentativa, e não grava nada.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ErroDeEntrada, aplicarConferida, conferirEntrada } from '../lib/manual.mjs';
import { FalhaDaGravacao, OPCOES_DA_GRAVACAO, esperaDasOpcoes, gravarNoRamo } from './gravar-dados.mjs';

const { values } = parseArgs({
  options: {
    ...OPCOES_DA_GRAVACAO,
    dados: { type: 'string' },
    agora: { type: 'string' },
    config: { type: 'string', default: 'config/alvos.json' },
  },
});
const noRamo = Boolean(values.arvore && values.remoto);
if (!values.dados === !noRamo) {
  console.error('Uso: node scripts/incidente.mjs (--arvore <pasta> --remoto <url> | --dados <dir>) [--agora <iso>]');
  process.exit(2);
}

const data = values.agora ? new Date(values.agora) : new Date();
if (Number.isNaN(data.getTime())) {
  console.error('Erro: --agora não é uma data ISO válida.');
  process.exit(2);
}
const instante = data.toISOString();

const config = JSON.parse(readFileSync(values.config, 'utf8'));
const e = process.env;
const entrada = {
  acao: e.ACAO,
  id: e.ID,
  linhas: e.LINHAS,
  tipo: e.TIPO,
  estado: e.ESTADO,
  titulo_pt: e.TITULO_PT,
  titulo_es: e.TITULO_ES,
  texto_pt: e.TEXTO_PT,
  texto_es: e.TEXTO_ES,
};

function falharDeEntrada(erro) {
  if (!(erro instanceof ErroDeEntrada)) throw erro;
  console.error(`Erro: ${erro.message} Nada foi gravado.`);
  process.exit(1);
}

let conferida;
try {
  conferida = conferirEntrada({ entrada, config });
} catch (erro) {
  falharDeEntrada(erro);
}

// Aplica a entrada ao incidentes.json lido agora. -> { arquivos, mensagem, saida }
function operacao(ler) {
  const atual = ler('incidentes.json') ?? { incidentes: [] };
  const lista = aplicarConferida({ incidentes: atual.incidentes, conferida, instante });
  const aberto = lista.find((i) => !atual.incidentes.some((a) => a.id === i.id)) ?? null;
  return {
    arquivos: { 'incidentes.json': { ...atual, incidentes: lista } },
    mensagem: `Incidente: ${conferida.acao} (${instante})`,
    saida: aberto ? `Incidente aberto: ${aberto.id}` : 'Incidente gravado.',
  };
}

let mensagem;
try {
  if (noRamo) {
    const gravado = await gravarNoRamo({
      arvore: values.arvore,
      remoto: values.remoto,
      agora: instante,
      ...esperaDasOpcoes(values),
      operacao,
    });
    mensagem = `${gravado.saida} Gravado no ramo dados na tentativa ${gravado.tentativas}.`;
  } else {
    const ler = (nome) => {
      const caminho = join(values.dados, nome);
      return existsSync(caminho) ? JSON.parse(readFileSync(caminho, 'utf8')) : undefined;
    };
    const { arquivos, saida } = operacao(ler);
    mkdirSync(values.dados, { recursive: true });
    for (const [nome, valor] of Object.entries(arquivos)) {
      writeFileSync(join(values.dados, nome), `${JSON.stringify(valor, null, 2)}\n`);
    }
    mensagem = saida;
  }
} catch (erro) {
  if (erro instanceof FalhaDaGravacao) {
    console.error(`Erro: ${erro.message}`);
    process.exit(1);
  }
  falharDeEntrada(erro);
}
console.log(mensagem);
