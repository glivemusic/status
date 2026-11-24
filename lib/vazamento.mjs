// Plano §1.4: o que nunca vai ao público. Uma lista só, usada pelo incidente à mão,
// pelo montar-site e pelos testes. Não é importado pela página.
//
// Antes de casar, o texto é normalizado: NFKC (largura, compatibilidade, espaço sem quebra),
// sem acento (NFD e as marcas combinantes removidas) e, para os termos, em minúsculas.

// Casados em qualquer parte do texto normalizado.
export const TERMOS_PROIBIDOS = [
  'http://',
  'https://',
  'www.',
  'develop',
  'vercel',
  'workers.dev',
  'worker',
  'supabase',
  'cloudflare',
  'api/v1',
  'painel_',
  // D11: o provedor das imagens de satélite. A raiz pega copernicus, copernico e copérnico.
  'copernic',
  'cdse',
];

// Entre «sentinel» e «hub»: nada, ou qualquer sequência de espaço Unicode, _, ., hífen ou travessão.
// «Sentinel-2» (o nome da linha) passa.
const SENTINEL_HUB = /sentinel[\s_.\-‐-―−]*hub/u;

// D11: palavras curtas, casadas só como palavra inteira (sem letra antes nem depois), sem diferenciar
// maiúscula. Assim «PU», «10PU» e «cota» são recusados, mas «pueden», «computador», «cotação» e
// «acotado» passam. O plural «PUs» casa em qualquer caixa, menos «pus» todo em minúsculas, que é
// palavra do português («eu pus»).
const PALAVRA = (padrao) => new RegExp(`(?<!\\p{L})(?:${padrao})(?!\\p{L})`, 'giu');
const PALAVRAS_PROIBIDAS = [
  { termo: 'PU', regex: PALAVRA('pu') },
  { termo: 'PUs', regex: PALAVRA('pus'), passa: (achado) => achado === 'pus' },
  { termo: 'cota', regex: PALAVRA('cotas?') },
  { termo: 'cuota', regex: PALAVRA('cuotas?') },
];

export function normalizar(texto) {
  return String(texto).normalize('NFKC').normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
}

// O primeiro termo proibido que aparece no texto, ou null.
// `extras`: termos a mais (por exemplo, o `url` dos alvos), casados em qualquer parte.
export function termoProibido(texto, extras = []) {
  const base = normalizar(texto);
  const minusculo = base.toLowerCase();
  for (const termo of [...TERMOS_PROIBIDOS, ...extras]) {
    if (termo && minusculo.includes(normalizar(termo).toLowerCase())) return termo;
  }
  if (SENTINEL_HUB.test(minusculo)) return 'sentinel hub';
  for (const { termo, regex, passa } of PALAVRAS_PROIBIDAS) {
    for (const [achado] of base.matchAll(regex)) {
      if (!passa?.(achado)) return termo;
    }
  }
  return null;
}
