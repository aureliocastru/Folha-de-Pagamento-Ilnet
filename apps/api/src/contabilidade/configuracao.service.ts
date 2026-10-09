import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * O papel de uma conta do IXC para a contabilidade.
 *
 * - `extrato`: conta de banco — pede PDF, Excel e OFX (item 1) e é conciliada
 *   (item 9);
 * - `aplicacao`: conta de investimento — pede o extrato da aplicação (item 2);
 * - `maquininha`: conta de cartão (PagSeguro) — pede o relatório da operadora
 *   (item 16);
 * - `caixa`: dinheiro em mãos — vai para o caixa físico (itens 10 e 11);
 * - `ignorar`: não entra em nada (conta morta, gateway importado).
 */
export type PapelDaConta = 'extrato' | 'aplicacao' | 'maquininha' | 'caixa' | 'ignorar';

export const PAPEIS: readonly PapelDaConta[] = ['extrato', 'aplicacao', 'maquininha', 'caixa', 'ignorar'];

/** O que conta como lucro, doação ou link: categorias daqui, plano de contas do IXC, fornecedores. */
export interface Selecao {
  categorias: string[];
  planos: number[];
  fornecedores: Array<{ id: number; nome: string }>;
}

export interface Configuracao {
  /** Id da conta no IXC → papel. A que não está aqui segue a sugestão. */
  papelDasContas: Record<string, PapelDaConta>;
  lucros: Selecao | null;
  doacoes: Selecao | null;
  link: Selecao | null;
}

const VAZIA: Selecao = { categorias: [], planos: [], fornecedores: [] };

/**
 * O papel que o nome e o tipo da conta sugerem.
 *
 * É sugestão, e a tela deixa trocar: "Conta aplicação Bradesco" é aplicação,
 * "Cartão PagSeguro" é maquininha, caixa é caixa (tipo C no IXC) e o resto do
 * tipo banco é conta corrente.
 */
export function papelSugerido(conta: { nome: string; tipo: string }): PapelDaConta {
  if (conta.tipo === 'C') return 'caixa';
  if (/aplica|invest|poupan|cdb/i.test(conta.nome)) return 'aplicacao';
  if (/cart[aã]o|pagseguro|maquin|stone|cielo|getnet|sumup|mercado ?pago|rede\b/i.test(conta.nome)) {
    return 'maquininha';
  }
  return 'extrato';
}

/** O que os nomes sugerem para cada recorte, enquanto ninguém escolheu. */
export const SUGESTAO: Record<'lucros' | 'doacoes' | 'link', RegExp> = {
  lucros: /dividendo|distribui[cç][aã]o de lucro|lucros distribu/i,
  doacoes: /doa[cç][aã]o|doa[cç][oõ]es|d[ií]zimo|caridade|filantr/i,
  link: /\blink\b|tr[aâ]nsito ip|ip tr[aâ]nsito|banda larga/i,
};

function lerSelecao(json: Prisma.JsonValue): Selecao | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const o = json as Record<string, unknown>;
  if (!('categorias' in o) && !('planos' in o) && !('fornecedores' in o)) return null;
  const categorias = Array.isArray(o.categorias) ? o.categorias.filter((c): c is string => typeof c === 'string') : [];
  const planos = Array.isArray(o.planos) ? o.planos.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  const fornecedores = Array.isArray(o.fornecedores)
    ? o.fornecedores
        .map((f) => f as { id?: unknown; nome?: unknown })
        .filter((f) => Number.isInteger(Number(f.id)) && Number(f.id) > 0)
        .map((f) => ({ id: Number(f.id), nome: String(f.nome ?? '') }))
    : [];
  return { categorias, planos, fornecedores };
}

@Injectable()
export class ConfiguracaoContabilService {
  constructor(private readonly prisma: PrismaService) {}

  async obter(): Promise<Configuracao> {
    const linha = await this.prisma.configuracaoContabil.findUnique({ where: { id: 1 } });
    const papeis: Record<string, PapelDaConta> = {};
    const cru = (linha?.papelDasContas ?? {}) as Record<string, unknown>;
    for (const [id, papel] of Object.entries(cru)) {
      if ((PAPEIS as readonly string[]).includes(String(papel))) papeis[id] = papel as PapelDaConta;
    }
    return {
      papelDasContas: papeis,
      lucros: linha ? lerSelecao(linha.lucros) : null,
      doacoes: linha ? lerSelecao(linha.doacoes) : null,
      link: linha ? lerSelecao(linha.link) : null,
    };
  }

  async salvar(mudanca: Partial<Configuracao>): Promise<Configuracao> {
    const atual = await this.obter();
    const nova: Configuracao = {
      papelDasContas: { ...atual.papelDasContas, ...(mudanca.papelDasContas ?? {}) },
      lucros: mudanca.lucros !== undefined ? (mudanca.lucros ?? VAZIA) : atual.lucros,
      doacoes: mudanca.doacoes !== undefined ? (mudanca.doacoes ?? VAZIA) : atual.doacoes,
      link: mudanca.link !== undefined ? (mudanca.link ?? VAZIA) : atual.link,
    };
    const json = (s: Selecao | null) => (s ?? {}) as unknown as Prisma.InputJsonValue;
    await this.prisma.configuracaoContabil.upsert({
      where: { id: 1 },
      create: {
        id: 1,
        papelDasContas: nova.papelDasContas,
        lucros: json(nova.lucros),
        doacoes: json(nova.doacoes),
        link: json(nova.link),
      },
      update: {
        papelDasContas: nova.papelDasContas,
        lucros: json(nova.lucros),
        doacoes: json(nova.doacoes),
        link: json(nova.link),
      },
    });
    return nova;
  }
}
