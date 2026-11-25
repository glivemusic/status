// D6: «monitoramento atrasado» e o estado geral. D14: o limite é de 60 min.
import { emMs } from './tempo.mjs';

export const ATRASO_MS = 60 * 60_000;

export function monitoramentoAtrasado(verificadoEm, agora) {
  if (!verificadoEm) return true;
  return emMs(agora) - emMs(verificadoEm) > ATRASO_MS;
}

// Os estados que entram no geral, das linhas da página (a visão de `dados/estado.json`). Não entram a linha em
// breve (D17) nem a linha `fora_do_geral` (D24: o satélite, que continua com o seu estado e o seu incidente).
export function estadosDoGeral(linhas) {
  return (linhas ?? []).filter((l) => l.em_breve !== true && l.fora_do_geral !== true).map((l) => l.estado);
}

// `estados`: o estado das linhas que `estadosDoGeral` deixa passar. -> 'atrasado' | 'fora' | 'degradado' | 'ok'
export function estadoGeral(estados, verificadoEm, agora) {
  if (monitoramentoAtrasado(verificadoEm, agora)) return 'atrasado';
  if (estados.includes('fora')) return 'fora';
  if (estados.includes('degradado')) return 'degradado';
  return 'ok';
}
