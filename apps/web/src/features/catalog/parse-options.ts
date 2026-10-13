// "Azul, Verde,  azul" -> ['Azul', 'Verde']. Tira vazios e repetidos (sem
// diferenciar caixa): "P" e "p" gerariam o mesmo SKU e o servidor recusaria a
// grade inteira.
export function parseOptions(texto: string): string[] {
  const vistas = new Set<string>();
  const out: string[] = [];
  for (const parte of texto.split(',')) {
    const opcao = parte.trim();
    const chave = opcao.toLowerCase();
    if (opcao === '' || vistas.has(chave)) continue;
    vistas.add(chave);
    out.push(opcao);
  }
  return out;
}

