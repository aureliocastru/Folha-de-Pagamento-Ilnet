/**
 * O contrato padrão do patrocínio — as contrapartidas que o patrocinado assume.
 *
 * Veio do papel que a ILNET já usava ("Segmento de patrocínio"), palavra por
 * palavra. Mora no código, e não numa tela de edição, porque mudar o contrato
 * é decisão que se toma uma vez e com calma — e o que já foi assinado não muda
 * junto: cada link guarda uma cópia do texto do dia em que foi gerado (ver
 * `ContratoDePatrocinio.texto`).
 *
 * O formato é o mínimo que o PDF e a tela sabem desenhar: "1. Título" abre uma
 * seção, "• " é um item de lista, e o resto é parágrafo. Linha em branco
 * separa os blocos.
 */
export const CONTRATO_PADRAO = `1. Divulgação nas redes sociais

Durante o período do patrocínio, o patrocinado deverá realizar, no mínimo:

• 2 publicações mensais no feed ou em Reels;
• 4 divulgações mensais nos Stories;
• Marcar o perfil oficial da ILNET em todas as publicações;
• Utilizar a logomarca da empresa de maneira visível;
• Mencionar o apoio da ILNET em conteúdos relacionados ao projeto, competições, apresentações, viagens, treinos ou eventos;
• Autorizar que a ILNET compartilhe as publicações em seus próprios canais.

As publicações devem permanecer disponíveis e não poderão ser apagadas sem justificativa.

2. Divulgação em eventos e atividades

Sempre que possível, o patrocinado deverá:

• Utilizar a logomarca da ILNET em camisas, uniformes, banners, cartazes ou materiais de divulgação;
• Agradecer publicamente à empresa durante apresentações, entrevistas, premiações ou eventos;
• Registrar fotos e vídeos mostrando a participação e o apoio da ILNET.

3. Produção de conteúdo

Os conteúdos poderão incluir:

• Anúncio da parceria;
• Fotos e vídeos de treinos, preparações e bastidores;
• Convites para eventos ou apresentações;
• Resultados alcançados;
• Agradecimentos pelo patrocínio;
• Vídeos curtos falando sobre a importância do apoio da ILNET;
• Registros utilizando uniformes ou materiais com a marca da empresa.

Sugestão de texto:

"Agradecemos à ILNET por acreditar e apoiar o nosso projeto. Essa parceria fortalece o nosso trabalho e nos ajuda a continuar avançando. ILNET — conectando pessoas e apoiando novos talentos!"

4. Cuidados com a imagem da empresa

O patrocinado deverá manter uma postura respeitosa e responsável, evitando relacionar a marca ILNET a conteúdos ofensivos, discriminatórios, ilegais ou que possam prejudicar a imagem da empresa.

Durante o período do patrocínio, não deverá divulgar ou representar empresas concorrentes do segmento de internet sem autorização prévia da ILNET.

5. Acompanhamento das divulgações

Ao final de cada mês, o patrocinado deverá enviar:

• Links ou capturas das publicações;
• Quantidade de visualizações e alcance, quando disponível;
• Fotos e vídeos dos eventos realizados;
• Informações sobre resultados, premiações ou conquistas.

6. Responsabilidades da ILNET

A ILNET deverá disponibilizar:

• Logomarca oficial em boa qualidade;
• Perfil correto para marcação;
• Orientações sobre a aplicação da marca;
• Informações sobre campanhas que poderão ser divulgadas;
• Apoio definido no acordo de patrocínio.

7. Avaliação da parceria

O cumprimento dessas ações será considerado para a manutenção ou renovação do patrocínio. Caso as divulgações combinadas não sejam realizadas, a empresa poderá solicitar a regularização ou reavaliar a continuidade do apoio.

O objetivo é construir uma parceria positiva para os dois lados: a ILNET apoia o desenvolvimento do patrocinado, e o patrocinado contribui para fortalecer e divulgar a marca da empresa.`;

/** Um pedaço do contrato, como a tela e o PDF o desenham. */
export type BlocoDoContrato =
  | { tipo: 'secao'; texto: string }
  | { tipo: 'item'; texto: string }
  | { tipo: 'paragrafo'; texto: string };

/**
 * O texto em blocos. Linha que começa com "1. " é título de seção, "• " é item
 * de lista, o resto é parágrafo — e linha vazia não vira nada.
 */
export function blocosDoContrato(texto: string): BlocoDoContrato[] {
  return texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l): BlocoDoContrato => {
      if (/^\d+\.\s/.test(l)) return { tipo: 'secao', texto: l };
      if (l.startsWith('•')) return { tipo: 'item', texto: l.replace(/^•\s*/, '') };
      return { tipo: 'paragrafo', texto: l };
    });
}
