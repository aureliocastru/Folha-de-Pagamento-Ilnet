/**
 * O que se escreve no IXC para mexer num almoxarifado — montado aqui, sem
 * cliente HTTP nenhum, para poder ser conferido campo a campo. Segue o mesmo
 * cuidado de `produtos-ixc.ts`: nada que não esteja documentado.
 *
 * A tabela é a `almox` ("Almoxarifados", na coleção Postman "API - IXC
 * Provedor"), e ela é pequena — a própria documentação lista os únicos quatro
 * campos que ela tem: `descricao`, `id_filial`, `ativo` e o oculto
 * `requisitar_preferencialmente_de` (o almoxarifado de onde um técnico é
 * sugerido a puxar material, quando o dele está baixo — não é isto que esta
 * tela resolve, e por isso ela nunca mexe nele).
 */

import { BadRequestException } from '@nestjs/common';

/** O almoxarifado novo, como a tela o descreve. */
export interface NovoAlmoxarifado {
  descricao: string;
  filialId: number;
  /**
   * O usuário do IXC do técnico dono, quando é o almoxarifado de um técnico
   * (a van dele). É o que se faz, no IXC, na aba Almoxarifados do usuário.
   */
  tecnicoUsuarioId?: number;
}

/** O que se pode mudar num almoxarifado a partir daqui. */
export interface EdicaoDoAlmoxarifado {
  descricao?: string;
  filialId?: number;
  ativo?: boolean;
}

/**
 * O corpo do `POST /almox` ("Almoxarifados (inserir)"). A documentação diz
 * que todo campo é obrigatório, inclusive o oculto — e o próprio exemplo dela
 * mostra `requisitar_preferencialmente_de` vazio como o padrão de quem não
 * tem preferência nenhuma.
 */
export function montarNovoAlmoxarifado(dados: NovoAlmoxarifado): Record<string, unknown> {
  return {
    descricao: descricaoValida(dados.descricao),
    id_filial: String(idValido(dados.filialId, 'a filial')),
    ativo: 'S',
    requisitar_preferencialmente_de: '',
  };
}

/**
 * O corpo do `PUT /almox/:id` ("Almoxarifados (editar)"): o registro que está
 * lá, inteiro, com as mudanças por cima — o `PUT` do webservice reescreve a
 * linha, e mandar só o campo mudado apagaria o resto (o `requisitar_
 * preferencialmente_de` que porventura exista, por exemplo). Mesmo cuidado de
 * `montarEdicaoProduto`.
 */
export function montarEdicaoAlmoxarifado(
  atual: Record<string, unknown>,
  mudancas: EdicaoDoAlmoxarifado,
): Record<string, unknown> {
  const corpo: Record<string, unknown> = { ...atual };
  if (mudancas.descricao !== undefined) {
    corpo.descricao = descricaoValida(mudancas.descricao);
  }
  if (mudancas.filialId !== undefined) {
    corpo.id_filial = String(idValido(mudancas.filialId, 'a filial'));
  }
  if (mudancas.ativo !== undefined) {
    corpo.ativo = mudancas.ativo ? 'S' : 'N';
  }
  return corpo;
}

/**
 * O corpo do `POST /almox_usuario` ("Almoxarifados do Usuário / inserir"): liga
 * um usuário do IXC a um almoxarifado — é o que o faz enxergá-lo, lá e na API.
 *
 * `padrao_usuario` é "N" salvo quando quem chama diz o contrário: o padrão é o
 * almoxarifado que a OS do técnico consome, e marcá-lo à toa mudaria de onde
 * sai o material dele.
 */
export function montarVinculo(
  usuarioId: number,
  almoxId: number,
  padrao = false,
): Record<string, unknown> {
  return {
    id_usuario: String(idValido(usuarioId, 'o usuário do IXC')),
    id_almox: String(idValido(almoxId, 'o almoxarifado')),
    padrao_usuario: padrao ? 'S' : 'N',
  };
}

/**
 * O corpo do `PUT /almox_usuario/:id` ("Almoxarifados do Usuário / editar"):
 * a ligação que está lá, inteira, só com o padrão por cima — o `PUT` do
 * webservice reescreve a linha, como em `montarEdicaoAlmoxarifado`.
 */
export function montarEdicaoDoVinculo(
  atual: Record<string, unknown>,
  padrao: boolean,
): Record<string, unknown> {
  return { ...atual, padrao_usuario: padrao ? 'S' : 'N' };
}

function descricaoValida(descricao: string): string {
  const d = String(descricao ?? '').trim().replace(/\s+/g, ' ');
  if (d.length < 2) throw new BadRequestException('O nome do almoxarifado é curto demais.');
  if (d.length > 100) {
    throw new BadRequestException('O nome do almoxarifado passa de 100 letras. Encurte.');
  }
  return d;
}

function idValido(id: number, oQue: string): number {
  const n = Number(id);
  if (!Number.isInteger(n) || n <= 0) {
    throw new BadRequestException(`Falta ${oQue}.`);
  }
  return n;
}
