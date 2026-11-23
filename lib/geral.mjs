// D6: «monitoramento atrasado» e o estado geral.
import { emMs } from './tempo.mjs';

export const ATRASO_MS = 30 * 60_000;

export function monitoramentoAtrasado(verificadoEm, agora) {
  if (!verificadoEm) return true;
  return emMs(agora) - emMs(verificadoEm) > ATRASO_MS;
}

// `estados`: o estado de cada linha visível. -> 'atrasado' | 'fora' | 'degradado' | 'ok'
export function estadoGeral(estados, verificadoEm, agora) {
  if (monitoramentoAtrasado(verificadoEm, agora)) return 'atrasado';
  if (estados.includes('fora')) return 'fora';
  if (estados.includes('degradado')) return 'degradado';
  return 'ok';
}
