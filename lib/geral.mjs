// D6: «monitoramento atrasado» e o estado geral. D14: o limite é de 60 min.
import { emMs } from './tempo.mjs';

export const ATRASO_MS = 60 * 60_000;

export function monitoramentoAtrasado(verificadoEm, agora) {
  if (!verificadoEm) return true;
  return emMs(agora) - emMs(verificadoEm) > ATRASO_MS;
}

// D17: os estados que entram no geral, das linhas da página (a visão de `dados/estado.json`). A linha em breve
// não entra.
export function estadosDoGeral(linhas) {
  return (linhas ?? []).filter((l) => l.em_breve !== true).map((l) => l.estado);
}

// `estados`: o estado de cada linha visível. -> 'atrasado' | 'fora' | 'degradado' | 'ok'
export function estadoGeral(estados, verificadoEm, agora) {
  if (monitoramentoAtrasado(verificadoEm, agora)) return 'atrasado';
  if (estados.includes('fora')) return 'fora';
  if (estados.includes('degradado')) return 'degradado';
  return 'ok';
}
