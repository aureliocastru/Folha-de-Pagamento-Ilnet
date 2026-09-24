/**
 * De que almoxarifado do IXC sai o material de um técnico — sem cliente HTTP,
 * para a regra poder ser provada.
 *
 * O IXC não guarda "o almoxarifado do técnico" num campo só. O caminho é o do
 * fluxo "Produtos do técnico" da documentação:
 *
 *   colaborador (`funcionarios.id`, o `ixcId` daqui)
 *     → usuário do IXC com esse colaborador (`usuarios.funcionario`)
 *     → almoxarifados ligados a esse usuário (`almox_usuario`)
 *     → o marcado como padrão (`padrao_usuario = "S"`), que é o que a OS dele
 *       consome no próprio IXC.
 *
 * Quando o caminho não chega a um almoxarifado só, o administrador fixa um à
 * mão (tabela `almox_do_tecnico`), e o fixado vence.
 */

import { ehAlmoxDeRecolhidos, ehAlmoxForaDaCasa } from '../almoxarifado/estoque.mapper';

export interface UsuarioDoIxc {
  id: number;
  /** `usuarios.funcionario` — 0 quando o usuário não é de um colaborador. */
  funcionarioId: number;
  ativo: boolean;
}

export interface LigacaoDoIxc {
  usuarioId: number;
  almoxId: number;
  padrao: boolean;
}

/** Um almoxarifado que o sistema enxerga no IXC. */
export interface AlmoxVisivel {
  id: number;
  nome: string;
  filialId: number;
  ativo: boolean;
}

export type AlmoxDoTecnico =
  | {
      ok: true;
      almoxId: number;
      nome: string;
      filialId: number;
      /** Como se chegou nele: fixado aqui, padrão no IXC, ou o único ligado. */
      origem: 'fixado' | 'padrao' | 'unico';
    }
  | {
      ok: false;
      motivo: string;
      /** Os almoxarifados ligados ao técnico, para quem vai fixar escolher. */
      candidatos: Array<{ id: number; nome: string }>;
    };

export function resolverAlmoxDoTecnico(dados: {
  /** `funcionarios.id` no IXC. 0 = cadastro só daqui. */
  ixcId: number;
  fixado?: { almoxId: number; nome: string } | null;
  usuarios: UsuarioDoIxc[];
  ligacoes: LigacaoDoIxc[];
  almoxarifados: AlmoxVisivel[];
}): AlmoxDoTecnico {
  const porId = new Map(dados.almoxarifados.map((a) => [a.id, a]));
  const nomeDe = (id: number) => porId.get(id)?.nome ?? `Almoxarifado ${id}`;

  const usuarios = dados.ixcId
    ? dados.usuarios.filter((u) => u.ativo && u.funcionarioId === dados.ixcId).map((u) => u.id)
    : [];
  const ligados = dados.ligacoes.filter(
    (l) => usuarios.includes(l.usuarioId) && !foraDoTecnico(nomeDe(l.almoxId)),
  );
  const candidatos = unicos(ligados.map((l) => l.almoxId)).map((id) => ({ id, nome: nomeDe(id) }));

  const conferido = (
    almoxId: number,
    origem: 'fixado' | 'padrao' | 'unico',
  ): AlmoxDoTecnico => {
    const almox = porId.get(almoxId);
    if (!almox) {
      return {
        ok: false,
        motivo:
          `O almoxarifado dele no IXC (#${almoxId}${origem === 'fixado' ? `, ${dados.fixado?.nome}` : ''}) ` +
          'não está liberado para o sistema. Libere na aba Almoxarifados.',
        candidatos,
      };
    }
    if (!almox.ativo) {
      return { ok: false, motivo: `O almoxarifado "${almox.nome}" está desativado no IXC.`, candidatos };
    }
    return { ok: true, almoxId, nome: almox.nome, filialId: almox.filialId, origem };
  };

  if (dados.fixado) return conferido(dados.fixado.almoxId, 'fixado');

  if (!dados.ixcId) {
    return {
      ok: false,
      motivo: 'O cadastro desta pessoa não está ligado a um colaborador do IXC.',
      candidatos,
    };
  }
  if (usuarios.length === 0) {
    return {
      ok: false,
      motivo:
        'Nenhum usuário ativo do IXC está ligado a este colaborador. No IXC, em Usuários, ' +
        'preencha o campo Colaborador no usuário dele — ou fixe o almoxarifado aqui.',
      candidatos,
    };
  }

  const padroes = unicos(ligados.filter((l) => l.padrao).map((l) => l.almoxId));
  if (padroes.length === 1) return conferido(padroes[0], 'padrao');
  if (padroes.length > 1) {
    return {
      ok: false,
      motivo:
        `Os usuários dele no IXC têm ${padroes.length} almoxarifados padrão ` +
        `(${padroes.map(nomeDe).join(', ')}). Deixe um só, ou fixe o almoxarifado aqui.`,
      candidatos,
    };
  }
  if (candidatos.length === 1) return conferido(candidatos[0].id, 'unico');
  return {
    ok: false,
    motivo:
      candidatos.length === 0
        ? 'Ele não tem almoxarifado ligado no IXC. Crie o da van na aba Almoxarifados.'
        : `Ele tem ${candidatos.length} almoxarifados no IXC e nenhum é o padrão. Marque o ` +
          'padrão na aba Almoxarifados, ou fixe o almoxarifado aqui.',
    candidatos,
  };
}

/** Um cadastro daqui, no que a procura do gêmeo precisa. */
export interface CadastroLocal {
  id: string;
  nome: string;
  cpfCnpj: string | null;
  ixcId: number | null;
  ativo: boolean;
}

/**
 * O colaborador do IXC de um cadastro daqui — mesmo quando o cadastro não o
 * tem.
 *
 * **A mesma pessoa pode estar duas vezes no banco.** A sincronização traz o
 * funcionário de dois lugares do IXC: de `funcionarios` (com o `ixcId` — o
 * número que a OS usa em `id_tecnico`) e de `fornecedor` (com os dados de
 * pagamento, e é esse o marcado como funcionário, o da folha e o do login). As
 * duas linhas se juntam pelo CPF; quando o colaborador do IXC está sem CPF, ou
 * com outro, nascem duas. Visto com a base real em 24/09/2026: o Cleyson, o
 * Juan Felipe, o Alisson Matheus e o Matheus Batista — quatro dos seis
 * técnicos com OS aberta — estavam assim.
 *
 * Juntar as duas linhas mexeria na folha; aqui só se acha o gêmeo, nesta
 * ordem: o próprio `ixcId`; o CPF igual (só dígitos); o nome completo igual
 * (sem acento, sem diferença de maiúscula) e único entre os ativos. Mais de um
 * com o mesmo nome é dúvida, e dúvida não vira técnico de ninguém.
 */
export function colaboradorDoIxc(pessoa: CadastroLocal, outros: CadastroLocal[]): number | null {
  if (pessoa.ixcId) return pessoa.ixcId;
  const comIxc = outros.filter((o) => o.id !== pessoa.id && o.ixcId);

  const doc = digitos(pessoa.cpfCnpj);
  if (doc.length >= 11) {
    const porDoc = unicos(comIxc.filter((o) => digitos(o.cpfCnpj) === doc).map((o) => o.ixcId ?? 0));
    if (porDoc.length === 1) return porDoc[0];
  }

  const nome = nomeComparavel(pessoa.nome);
  if (!nome.includes(' ')) return null; // "Cleyson" sozinho não é nome completo
  const porNome = unicos(
    comIxc.filter((o) => o.ativo && nomeComparavel(o.nome) === nome).map((o) => o.ixcId ?? 0),
  );
  return porNome.length === 1 ? porNome[0] : null;
}

function digitos(v: string | null): string {
  return String(v ?? '').replace(/\D/g, '');
}

function nomeComparavel(nome: string): string {
  return nome
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Almoxarifado que nunca é de técnico, mesmo ligado a ele: Perdas e Falhas,
 * Saídas e a triagem dos recolhidos. Quem vê esses no IXC é o almoxarife, e o
 * almoxarife pode ser técnico também.
 */
function foraDoTecnico(nome: string): boolean {
  return ehAlmoxForaDaCasa(nome) || ehAlmoxDeRecolhidos(nome);
}

function unicos(ids: number[]): number[] {
  return [...new Set(ids)].filter((id) => id > 0);
}
