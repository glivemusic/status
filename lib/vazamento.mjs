// Plano §1.4: o que nunca vai ao público. Uma lista só, usada pelo incidente à mão,
// pelo montar-site e pelos testes. Não é importado pela página.

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
];

// O primeiro termo proibido que aparece no texto (sem diferenciar maiúscula), ou null.
// `extras`: termos a mais (por exemplo, o `url` dos alvos).
export function termoProibido(texto, extras = []) {
  const minusculo = String(texto).toLowerCase();
  for (const termo of [...TERMOS_PROIBIDOS, ...extras]) {
    if (termo && minusculo.includes(termo.toLowerCase())) return termo;
  }
  return null;
}
