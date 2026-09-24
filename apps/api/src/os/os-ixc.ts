/**
 * O que se lê e o que se escreve no IXC dentro de uma ordem de serviço —
 * montado aqui, sem cliente HTTP nenhum, para poder ser conferido campo a
 * campo. O mesmo cuidado de `almoxarifado/produtos-ixc.ts`: nada que não esteja
 * na documentação (a coleção "API - IXC Provedor", pasta Suporte › Ordem de
 * serviço).
 *
 * Três escritas, todas na própria OS, e todas mexendo no almoxarifado do
 * técnico:
 *
 *  - **aparelho instalado** — `su_oss_mov_comodato_wiz` ("Comodato › Tipo
 *    Patrimônio (inserir)"): a peça sai do almoxarifado dele e fica em
 *    comodato no contrato, presa à OS;
 *  - **aparelho retirado** — `baixar_comodato_23069` ("Baixar Comodato do
 *    Contrato"): a linha de comodato é baixada e a peça volta para o
 *    almoxarifado que se manda — o do técnico, que é com quem ela está;
 *  - **material gasto** — `su_oss_mov_produto` ("Produtos › Tipo Produto
 *    (inserir)"): o conector e o drop saem do almoxarifado dele pela OS.
 *
 * Os exemplos da documentação mandam `"ixcsoft": "listar"` também nas
 * inserções. Não se repete isso aqui: o `IxcClient` só põe esse cabeçalho nas
 * listagens, como em toda outra escrita desta casa.
 */

import { BadRequestException } from '@nestjs/common';
import { qtdeParaIxc } from '../almoxarifado/produtos-ixc';
import { numeroDoIxc } from '../almoxarifado/estoque.mapper';

/** A situação da OS no IXC, em palavras. */
export const STATUS_DA_OS: Record<string, string> = {
  A: 'aberta',
  AN: 'em análise',
  EN: 'encaminhada',
  AS: 'assumida',
  AG: 'agendada',
  DS: 'em deslocamento',
  EX: 'em execução',
  RAG: 'aguardando reagendamento',
  F: 'finalizada',
};

/**
 * Quantos dias depois de finalizada uma OS ainda aceita material por aqui.
 *
 * É comum a OS ser finalizada no IXC (pelo atendimento, ou pelo aplicativo de
 * lá) antes de o técnico lançar o que gastou — e o que ele gastou continua
 * tendo saído da van. Três dias cobrem o fim de semana; depois disso o que
 * falta se lança no próprio IXC, por quem sabe por que ficou para trás.
 */
export const DIAS_DEPOIS_DE_FINALIZADA = 3;

/** Uma OS lida do IXC, só com o que as telas daqui usam. */
export interface OsDoIxc {
  id: number;
  protocolo: string | null;
  /** A, AN, EN, AS, AG, DS, EX, RAG, F. */
  status: string;
  assuntoId: number;
  clienteId: number;
  /** `id_contrato_kit` — o contrato do cliente em que a OS foi aberta. */
  contratoId: number;
  loginId: number;
  filialId: number;
  /** `funcionarios.id` do IXC — o mesmo `ixcId` do cadastro daqui. */
  tecnicoId: number;
  /** "AAAA-MM-DD HH:MM:SS", ou null. */
  abertura: string | null;
  agenda: string | null;
  fechamento: string | null;
  /** O que o atendimento escreveu ao abrir. */
  mensagem: string | null;
  endereco: string | null;
}

function texto(v: unknown): string | null {
  const t = v === null || v === undefined ? '' : String(v).trim();
  return t === '' || t === '0' ? null : t;
}

/** "0000-00-00 00:00:00" é o vazio das datas do IXC. */
function dataDoIxc(v: unknown): string | null {
  const t = texto(v);
  return !t || t.startsWith('0000') ? null : t;
}

/** Uma linha de `su_oss_chamado`. Null quando não tem id. */
export function lerOs(l: Record<string, unknown>): OsDoIxc | null {
  const id = numeroDoIxc(l.id);
  if (id <= 0) return null;
  const rua = [texto(l.endereco), texto(l.numero)].filter(Boolean).join(', ');
  // Nesta base o `endereco` da OS às vezes já vem montado com cidade e bairro
  // ("… Serraria - Rua da Serraria, 169"): o pedaço que já está escrito não se
  // repete.
  const endereco = [texto(l.complemento), texto(l.bairro), texto(l.referencia)]
    .reduce<string[]>(
      (partes, p) =>
        p && !partes.some((x) => x.toLowerCase().includes(p.toLowerCase())) ? [...partes, p] : partes,
      rua ? [rua] : [],
    )
    .join(' — ');
  return {
    id,
    protocolo: texto(l.protocolo),
    status: String(l.status ?? '').trim().toUpperCase(),
    assuntoId: numeroDoIxc(l.id_assunto),
    clienteId: numeroDoIxc(l.id_cliente),
    contratoId: numeroDoIxc(l.id_contrato_kit),
    loginId: numeroDoIxc(l.id_login),
    filialId: numeroDoIxc(l.id_filial),
    tecnicoId: numeroDoIxc(l.id_tecnico),
    abertura: dataDoIxc(l.data_abertura),
    agenda: dataDoIxc(l.data_agenda),
    fechamento: dataDoIxc(l.data_fechamento),
    mensagem: texto(l.mensagem),
    endereco: endereco || null,
  };
}

/**
 * A OS aceita material por aqui? Aberta, sim. Finalizada, só nos
 * `DIAS_DEPOIS_DE_FINALIZADA` seguintes (ver lá o porquê). Devolve o motivo
 * da recusa, ou null.
 */
export function osRecusaMaterial(os: OsDoIxc, agora = new Date()): string | null {
  if (os.status !== 'F') return null;
  const fechada = os.fechamento ? Date.parse(os.fechamento.replace(' ', 'T') + '-03:00') : NaN;
  if (Number.isNaN(fechada)) {
    return 'A OS está finalizada no IXC e não diz quando. Lance o material pelo IXC.';
  }
  const limite = fechada + DIAS_DEPOIS_DE_FINALIZADA * 24 * 60 * 60_000;
  if (agora.getTime() > limite) {
    return (
      `A OS foi finalizada no IXC há mais de ${DIAS_DEPOIS_DE_FINALIZADA} dias. ` +
      'O que ficou para trás se lança pelo IXC.'
    );
  }
  return null;
}

/** Uma linha de comodato do contrato (`cliente_contrato_comodato`). */
export interface ComodatoDoContrato {
  /** O id da linha — é ele que a baixa recebe. */
  comodatoId: number;
  produtoId: number;
  descricao: string | null;
  quantidade: number;
  patrimonioId: number | null;
  numeroPatrimonial: string | null;
  mac: string | null;
  numeroSerie: string | null;
  /** "AAAA-MM-DD" do dia em que foi para o cliente. */
  desde: string | null;
  /** "E" = emprestado (está com o cliente). */
  status: string;
}

export function lerComodato(l: Record<string, unknown>): ComodatoDoContrato | null {
  const comodatoId = numeroDoIxc(l.id);
  const produtoId = numeroDoIxc(l.id_produto);
  if (comodatoId <= 0 || produtoId <= 0) return null;
  const patrimonioId = numeroDoIxc(l.id_patrimonio);
  return {
    comodatoId,
    produtoId,
    descricao: texto(l.descricao),
    quantidade: numeroDoIxc(l.qtde_saida) || 1,
    patrimonioId: patrimonioId > 0 ? patrimonioId : null,
    numeroPatrimonial: texto(l.numero_patrimonial) ?? texto(l.patrimonio),
    mac: texto(l.mac),
    numeroSerie: texto(l.numero_serie),
    desde: dataDoIxc(l.data)?.slice(0, 10) ?? null,
    status: String(l.status_comodato ?? '').trim().toUpperCase(),
  };
}

/** O cadastro do produto, no que as escritas da OS precisam dele. */
export interface ProdutoParaOs {
  id: number;
  unidadeId: number;
  unidadeSigla: string;
  /** `produtos.tipo`: C, O, M, P… */
  tipo: string;
  /** "S" quando o produto controla estoque. */
  controlaEstoque: boolean;
  /** `produtos.id_class_fiscal` — a "classificação tributária" do movimento. */
  classificacaoFiscal: number;
  /** O preço base do cadastro. Zero quando não tem. */
  valorUnitario: number;
  descricao: string;
}

/**
 * O produto como a OS precisa dele, lido do cadastro cru do IXC. Recusa o que
 * falta: sem unidade ou classificação fiscal o IXC não grava o movimento.
 */
export function produtoParaOs(
  bruto: Record<string, unknown> | undefined,
  unidades: Array<{ id: number; sigla: string }>,
): ProdutoParaOs {
  const id = numeroDoIxc(bruto?.id);
  const descricao = texto(bruto?.descricao) ?? `Produto ${id || '?'}`;
  if (!bruto || id <= 0) {
    throw new BadRequestException('O cadastro do produto não foi achado no IXC.');
  }
  if (String(bruto.ativo ?? 'S').trim().toUpperCase() === 'N') {
    throw new BadRequestException(`"${descricao}" está inativo no IXC.`);
  }
  const unidade = unidades.find((u) => u.id === numeroDoIxc(bruto.unidade));
  if (!unidade) {
    throw new BadRequestException(
      `"${descricao}" está sem unidade no cadastro do IXC — acerte no cadastro do produto.`,
    );
  }
  const classificacaoFiscal = numeroDoIxc(bruto.id_class_fiscal);
  if (classificacaoFiscal <= 0) {
    throw new BadRequestException(
      `"${descricao}" está sem classificação fiscal no IXC, e o IXC não grava movimento ` +
        'de produto sem ela. Acerte no cadastro do produto.',
    );
  }
  return {
    id,
    unidadeId: unidade.id,
    unidadeSigla: unidade.sigla,
    tipo: String(bruto.tipo ?? '').trim().toUpperCase(),
    controlaEstoque: String(bruto.controla_estoque ?? 'S').trim().toUpperCase() !== 'N',
    classificacaoFiscal,
    valorUnitario: Math.max(0, numeroDoIxc(bruto.preco_base)),
    descricao,
  };
}

/** A OS, no que as escritas dentro dela pedem. */
export interface OsParaEscrever {
  osId: number;
  contratoId: number;
  loginId: number;
  filialId: number;
  /** O almoxarifado do técnico: de onde sai, para onde volta. */
  almoxId: number;
  /** "DD/MM/AAAA". */
  dia: string;
}

/** Uma peça de patrimônio (ONU, roteador), como o comodato a pede. */
export interface PecaParaOs {
  patrimonioId: number;
  numeroPatrimonial: string | null;
  mac: string | null;
  numeroSerie: string | null;
  /** A situação da peça antes de sair (1 Disponível, 7 Disponível Técnico). */
  situacao?: string | null;
}

function id(n: number, oQue: string): string {
  if (!Number.isInteger(n) || n <= 0) throw new BadRequestException(`Falta ${oQue}.`);
  return String(n);
}

/** "12.50" — o valor, com duas casas e ponto. */
function valor(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

/**
 * O corpo do `POST /su_oss_mov_comodato_wiz` ("Comodato › Tipo Patrimônio
 * (inserir)"): a peça sai do almoxarifado do técnico e fica em comodato no
 * contrato, dentro da OS.
 *
 * Os obrigatórios da documentação, e de onde cada um vem:
 *
 *  - `id_oss_chamado`, `id_contrato`, `filial_id` — da OS; `id_login` também,
 *    quando ela tem (é o que liga a peça à conexão do cliente);
 *  - `id_patrimonio`, `patrimonio`, `numero_patrimonial`, `mac` — da peça. A
 *    documentação avisa que sem o `mac` a peça "ficará oculta na interface";
 *  - `id_produto`, `id_unidade`, `unidade_sigla`, `tipo`, `estoque`,
 *    `id_classificacao_tributaria` — do cadastro do produto;
 *  - `id_almox` — o almoxarifado do técnico, de onde ela sai;
 *  - `qtde_saida` 1, `fator_conversao` 1: patrimônio anda peça por peça;
 *  - `status_comodato` "E" — emprestado.
 *
 * **O `tipo` da documentação está errado**, e por isso não se segue ela aqui.
 * O exemplo manda `"tipo": "C"`; a linha que o próprio IXC grava quando o
 * técnico põe a ONU na OS (lida na base em 24/09/2026, OS 92279, linha
 * 1016480) tem `tipo: "S"` — é o tipo do **movimento** (saída), como o "E" da
 * entrada de compra e o "I" do inventário — e `tipo_produto: "P"`. A mesma
 * linha traz `garantia_oss: "N"` e, em `ultima_situacao_patrimonio`, a
 * situação que a peça tinha antes de sair ("7", disponível com o técnico):
 * mandam-se os dois iguais.
 *
 * Na mesma leitura, a peça já estava em comodato (situação 4) com a OS ainda
 * encaminhada: o comodato vale quando a linha nasce, e não ao finalizar.
 */
export function montarComodatoNaOs(
  os: OsParaEscrever,
  produto: ProdutoParaOs,
  peca: PecaParaOs,
): Record<string, unknown> {
  return {
    id_oss_mensagem: '',
    id_saida: '',
    id_oss_chamado: id(os.osId, 'a OS'),
    id_contrato: id(os.contratoId, 'o contrato da OS — sem ele não há onde pôr o comodato'),
    id_login: os.loginId > 0 ? String(os.loginId) : '',
    id_patrimonio: id(peca.patrimonioId, 'a peça'),
    id_produto: id(produto.id, 'o produto'),
    descricao: produto.descricao.slice(0, 200),
    data: os.dia,
    id_unidade: id(produto.unidadeId, 'a unidade'),
    id_almox: id(os.almoxId, 'o almoxarifado do técnico'),
    filial_id: id(os.filialId, 'a filial da OS'),
    qtde_saida: qtdeParaIxc(1),
    valor_unitario: valor(produto.valorUnitario),
    pcomissao: '',
    pdesconto: '',
    vdesconto: '',
    valor_total: valor(produto.valorUnitario),
    patrimonio: peca.numeroPatrimonial ?? '',
    mac: peca.mac ?? '',
    numero_serie: peca.numeroSerie ?? '',
    numero_patrimonial: peca.numeroPatrimonial ?? '',
    garantia_oss: 'N',
    id_terceiro_oss: '',
    id_su_oss_kit_equipamento: '',
    id_classificacao_tributaria: id(produto.classificacaoFiscal, 'a classificação fiscal'),
    tipo: 'S',
    estoque: produto.controlaEstoque ? 'S' : 'N',
    unidade_sigla: produto.unidadeSigla,
    fator_conversao: '1.000000000',
    tipo_produto: 'P',
    status_comodato: 'E',
    status_patrimonio: '',
    ultima_situacao_patrimonio: peca.situacao ?? '',
    id_pedido_os: '',
  };
}

/**
 * O corpo do `POST /baixar_comodato_23069` ("Baixar Comodato do Contrato ›
 * Outros Almoxarifados"): a linha de comodato é baixada e a peça volta para o
 * almoxarifado mandado. Os rótulos vão junto porque a documentação os traz —
 * é o formulário da tela do IXC, que manda o nome ao lado do número.
 */
export function montarBaixaDeComodato(dados: {
  comodatoId: number;
  almoxId: number;
  almoxNome: string;
  filialId: number;
  filialNome?: string | null;
}): Record<string, unknown> {
  return {
    id: id(dados.comodatoId, 'a linha de comodato'),
    id_almox: id(dados.almoxId, 'o almoxarifado para onde a peça volta'),
    id_almox_label: dados.almoxNome,
    id_filial_baixa: id(dados.filialId, 'a filial'),
    id_filial_baixa_label: dados.filialNome ?? '',
  };
}

/**
 * O corpo do `POST /su_oss_mov_produto` ("Produtos › Tipo Produto
 * (inserir)"): o material que o técnico gastou sai do almoxarifado dele pela
 * OS. Os obrigatórios são os mesmos do comodato, sem contrato e sem peça.
 *
 * `tipo: "S"` pelo mesmo motivo do comodato (ver `montarComodatoNaOs`): toda
 * linha de OS lida nesta base é saída, e o "C" do exemplo da documentação não
 * aparece em linha nenhuma. O tipo do produto vai em `tipo_produto`.
 */
export function montarMaterialNaOs(
  os: OsParaEscrever,
  produto: ProdutoParaOs,
  quantidade: number,
): Record<string, unknown> {
  if (!(quantidade > 0)) throw new BadRequestException('A quantidade tem de ser maior que zero.');
  if (produto.tipo === 'P') {
    throw new BadRequestException(
      `"${produto.descricao}" é patrimônio, que anda peça por peça. Instale pela peça.`,
    );
  }
  return {
    id_oss_mensagem: '',
    id_saida: '',
    id_oss_chamado: id(os.osId, 'a OS'),
    id_patrimonio: '',
    id_produto: id(produto.id, 'o produto'),
    descricao: produto.descricao.slice(0, 200),
    data: os.dia,
    id_unidade: id(produto.unidadeId, 'a unidade'),
    id_almox: id(os.almoxId, 'o almoxarifado do técnico'),
    qtde_saida: qtdeParaIxc(quantidade),
    valor_unitario: valor(produto.valorUnitario),
    pcomissao: '',
    pdesconto: '',
    vdesconto: '',
    valor_total: valor(produto.valorUnitario * quantidade),
    valor_total2: '',
    patrimonio: '',
    numero_serie: '',
    numero_patrimonial: '',
    garantia_oss: 'N',
    id_terceiro_oss: '',
    id_su_oss_kit_equipamento: '',
    id_classificacao_tributaria: id(produto.classificacaoFiscal, 'a classificação fiscal'),
    tipo: 'S',
    estoque: produto.controlaEstoque ? 'S' : 'N',
    unidade_sigla: produto.unidadeSigla,
    fator_conversao: '1.000000000',
    tipo_produto: produto.tipo,
    saldo_produto: '',
    id_estrutura: '',
    ultima_situacao_patrimonio: '',
    id_pedido_os: '',
  };
}
