// Preenche os {campos} de um texto do catálogo.
export function preencher(modelo, valores = {}) {
  return modelo.replace(/\{(\w+)\}/g, (inteiro, chave) =>
    Object.hasOwn(valores, chave) ? String(valores[chave]) : inteiro,
  );
}

// O mesmo texto do catálogo nos dois idiomas: { "pt-BR": ..., "es-PY": ... }.
// `valores` pode ser uma função do idioma, para quando o valor muda com ele.
export function emCadaIdioma(textos, chave, valores = {}) {
  const resultado = {};
  for (const idioma of Object.keys(textos)) {
    const v = typeof valores === 'function' ? valores(idioma) : valores;
    resultado[idioma] = preencher(textos[idioma][chave], v);
  }
  return resultado;
}
