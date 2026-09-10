import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import {
  CoordenadorPontuacao,
  LancamentoDePontos,
  MotivoDePontos,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { conferirArquivo, lerDataUrl } from '../arquivos/data-url';
import { PrismaService } from '../prisma/prisma.service';
import { cpfValido, somenteDigitos } from './cpf';

/** Senhas erradas seguidas até o login do coordenador travar. */
const TENTATIVAS_ATE_TRAVAR = 5;
/** Por quanto tempo ele fica travado. */
const TRAVA_MS = 15 * 60 * 1000;
/** Quantos meses a tela do funcionário mostra de relance. */
const MESES_NO_HISTORICO = 6;

/**
 * A foto chega reduzida pelo navegador (1600px, JPEG a 70%, uns 300 KB). O
 * teto é folgado para o celular que não reduz, e apertado para ninguém
 * guardar um vídeo aqui.
 */
const FOTO_ACEITA = new Set(['image/jpeg', 'image/png', 'image/webp']);
const FOTO_MAXIMA = 3 * 1024 * 1024;

/** O que o token do portal carrega. */
export interface TokenDoCoordenador {
  sub: string;
  tipo: 'coordenador-pontuacao';
}

/** Quem está lançando: um coordenador do portal, ou o ADMIN por dentro. */
export type Autor =
  | { tipo: 'coordenador'; id: string; nome: string }
  | { tipo: 'admin'; id: string; nome: string };

/** Uma linha do painel: o funcionário, os pontos do mês e a posição. */
export interface FuncionarioNoPainel {
  id: string;
  nome: string;
  apelido: string | null;
  funcao: string | null;
  pontos: number;
  lancamentos: number;
  /** 1 = o primeiro. Empate divide a posição ("1º, 2º, 2º, 4º"). */
  posicao: number;
}

/** Um lançamento, como as telas o mostram. */
export interface LancamentoNaTela {
  id: string;
  pontos: number;
  motivo: string;
  data: Date;
  lancadoPor: string;
  /** Tem foto — que se pede à parte, só quando alguém quer ver. */
  temFoto: boolean;
  /** Quem está vendo pode apagar este. */
  podeApagar: boolean;
}

/**
 * A pontuação dos funcionários.
 *
 * Os coordenadores dão pontos — a mais ou a menos, sempre com motivo — e cada
 * funcionário vê os seus digitando o próprio CPF. O mês é a régua: o total que
 * importa é o do mês, e é por ele que se monta a posição.
 *
 * "Funcionário da empresa" aqui é o mesmo da folha: ativo e marcado pelo
 * sync como funcionário (`isentoIcms`). Quem saiu da empresa some da lista, e
 * os pontos dele ficam no banco.
 */
@Injectable()
export class PontuacaoService {
  private readonly logger = new Logger(PontuacaoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  // --- O portal: quem é esse CPF ---

  /**
   * Diz o que um CPF abre: a tela de coordenador (que pede a senha), a do
   * funcionário, ou as duas — o coordenador também é funcionário, e também
   * quer ver os próprios pontos.
   */
  async identificar(cpf: string): Promise<{
    coordenador: boolean;
    funcionario: boolean;
    nome: string | null;
  }> {
    const digitos = somenteDigitos(cpf);
    if (digitos.length !== 11) {
      throw new BadRequestException('Digite os 11 números do CPF.');
    }

    const coordenador = await this.prisma.coordenadorPontuacao.findFirst({
      where: { cpf: digitos, ativo: true },
      select: { nome: true },
    });
    const funcionario = await this.funcionarioPeloCpf(digitos);

    if (!coordenador && !funcionario) {
      throw new NotFoundException(
        'Este CPF não está entre os funcionários da empresa. Confira os números.',
      );
    }
    return {
      coordenador: !!coordenador,
      funcionario: !!funcionario,
      nome: primeiroNome(coordenador?.nome ?? funcionario?.nome ?? null),
    };
  }

  /**
   * O login do coordenador: CPF e senha, e volta um token de doze horas.
   *
   * O token é assinado com uma chave derivada da do sistema, e não com ela
   * mesma: um token do portal nunca pode valer como login do sistema, nem o
   * contrário.
   */
  async entrar(
    cpf: string,
    senha: string,
  ): Promise<{ token: string; nome: string }> {
    const digitos = somenteDigitos(cpf);
    const c = await this.prisma.coordenadorPontuacao.findUnique({
      where: { cpf: digitos },
    });
    // A mesma resposta para CPF desconhecido e senha errada: não se ensina a
    // quem está chutando qual das duas errou.
    const recusa = new UnauthorizedException('CPF ou senha não conferem.');
    if (!c || !c.ativo) throw recusa;

    if (c.bloqueadoAte && c.bloqueadoAte > new Date()) {
      const minutos = Math.ceil((c.bloqueadoAte.getTime() - Date.now()) / 60_000);
      throw new ForbiddenException(
        `Senha errada muitas vezes seguidas. Tente de novo em ${minutos} minuto(s), ` +
          'ou peça ao administrador para trocar a senha.',
      );
    }

    const ok = await bcrypt.compare(String(senha ?? ''), c.senhaHash);
    if (!ok) {
      const tentativas = c.tentativas + 1;
      const trava = tentativas >= TENTATIVAS_ATE_TRAVAR;
      await this.prisma.coordenadorPontuacao.update({
        where: { id: c.id },
        data: {
          tentativas: trava ? 0 : tentativas,
          bloqueadoAte: trava ? new Date(Date.now() + TRAVA_MS) : null,
        },
      });
      if (trava) {
        this.logger.warn(`Login de pontuação travado: ${c.nome}.`);
      }
      throw recusa;
    }

    await this.prisma.coordenadorPontuacao.update({
      where: { id: c.id },
      data: { tentativas: 0, bloqueadoAte: null, ultimoAcessoEm: new Date() },
    });

    const payload: TokenDoCoordenador = { sub: c.id, tipo: 'coordenador-pontuacao' };
    return { token: await this.jwt.signAsync(payload), nome: c.nome };
  }

  /** Confere o token do portal e devolve o coordenador — ativo — dono dele. */
  async coordenadorDoToken(token: string): Promise<CoordenadorPontuacao> {
    let payload: TokenDoCoordenador;
    try {
      payload = await this.jwt.verifyAsync<TokenDoCoordenador>(token);
    } catch {
      throw new UnauthorizedException('Entre de novo com o CPF e a senha.');
    }
    if (payload.tipo !== 'coordenador-pontuacao') {
      throw new UnauthorizedException('Entre de novo com o CPF e a senha.');
    }
    const c = await this.prisma.coordenadorPontuacao.findUnique({
      where: { id: payload.sub },
    });
    // Desligado no meio do dia sai no clique seguinte, e não quando o token
    // expirar.
    if (!c || !c.ativo) {
      throw new UnauthorizedException('Este login de coordenador foi desligado.');
    }
    return c;
  }

  // --- O que o funcionário vê ---

  /**
   * A tela do funcionário: os pontos do mês, a posição dele e cada lançamento
   * com o motivo. Não mostra os pontos dos colegas — só em que lugar ele está.
   */
  async visaoDoFuncionario(
    cpf: string,
    competencia?: string,
  ): Promise<{
    nome: string;
    competencia: string;
    pontos: number;
    posicao: number;
    de: number;
    lancamentos: Array<Omit<LancamentoNaTela, 'podeApagar'>>;
    meses: Array<{ competencia: string; pontos: number }>;
  }> {
    const alvo = validarCompetencia(competencia ?? mesAtual());
    const funcionario = await this.funcionarioPeloCpf(somenteDigitos(cpf));
    if (!funcionario) {
      throw new NotFoundException(
        'Este CPF não está entre os funcionários da empresa. Confira os números.',
      );
    }

    const painel = await this.painel(alvo);
    const eu = painel.funcionarios.find((f) => f.id === funcionario.id);

    const lancamentos = await this.prisma.lancamentoDePontos.findMany({
      where: { funcionarioId: funcionario.id, competencia: alvo },
      include: { foto: { select: { id: true } } },
      orderBy: [{ data: 'desc' }, { createdAt: 'desc' }],
    });

    const meses = ultimasCompetencias(alvo, MESES_NO_HISTORICO);
    const porMes = await this.prisma.lancamentoDePontos.groupBy({
      by: ['competencia'],
      where: { funcionarioId: funcionario.id, competencia: { in: meses } },
      _sum: { pontos: true },
    });

    return {
      nome: funcionario.apelido || funcionario.nome,
      competencia: alvo,
      pontos: eu?.pontos ?? 0,
      posicao: eu?.posicao ?? painel.funcionarios.length,
      de: painel.funcionarios.length,
      lancamentos: lancamentos.map(({ id, pontos, motivo, data, lancadoPor, foto }) => ({
        id,
        pontos,
        motivo,
        data,
        lancadoPor,
        temFoto: !!foto,
      })),
      meses: meses.map((m) => ({
        competencia: m,
        pontos: porMes.find((p) => p.competencia === m)?._sum.pontos ?? 0,
      })),
    };
  }

  // --- O que o coordenador (e o ADMIN) vê e faz ---

  /** Todos os funcionários, com os pontos do mês e a posição de cada um. */
  async painel(
    competencia?: string,
  ): Promise<{ competencia: string; funcionarios: FuncionarioNoPainel[] }> {
    const alvo = validarCompetencia(competencia ?? mesAtual());

    const funcionarios = await this.prisma.funcionario.findMany({
      where: { ativo: true, isentoIcms: true },
      select: { id: true, nome: true, apelido: true, funcao: true },
      orderBy: { nome: 'asc' },
    });
    const somas = await this.prisma.lancamentoDePontos.groupBy({
      by: ['funcionarioId'],
      where: { competencia: alvo },
      _sum: { pontos: true },
      _count: { _all: true },
    });

    const linhas = funcionarios.map((f) => {
      const s = somas.find((x) => x.funcionarioId === f.id);
      return {
        ...f,
        pontos: s?._sum.pontos ?? 0,
        lancamentos: s?._count._all ?? 0,
        posicao: 0,
      };
    });

    // A posição de cada um conta quantos têm mais pontos que ele: empatados
    // dividem o lugar, e o seguinte pula ("1º, 2º, 2º, 4º").
    for (const l of linhas) {
      l.posicao = 1 + linhas.filter((o) => o.pontos > l.pontos).length;
    }
    linhas.sort((a, b) => a.posicao - b.posicao || a.nome.localeCompare(b.nome));

    return { competencia: alvo, funcionarios: linhas };
  }

  /** Os lançamentos de um funcionário no mês. */
  async lancamentosDe(
    funcionarioId: string,
    competencia: string | undefined,
    quemVe: Autor,
  ): Promise<LancamentoNaTela[]> {
    const alvo = validarCompetencia(competencia ?? mesAtual());
    const lista = await this.prisma.lancamentoDePontos.findMany({
      where: { funcionarioId, competencia: alvo },
      include: { foto: { select: { id: true } } },
      orderBy: [{ data: 'desc' }, { createdAt: 'desc' }],
    });
    return lista.map((l) => ({
      id: l.id,
      pontos: l.pontos,
      motivo: l.motivo,
      data: l.data,
      lancadoPor: l.lancadoPor,
      temFoto: !!l.foto,
      podeApagar: podeApagar(l, quemVe),
    }));
  }

  /**
   * Um ponto a mais ou a menos, com o motivo e, se houver, a foto.
   *
   * É sempre um ponto: o que pesa é quantas vezes o motivo acontece, e não
   * quantos pontos cada coordenador acha que ele vale — dez de um e um de
   * outro pelo mesmo atraso fariam o ranking medir quem pontuou, e não quem
   * trabalhou.
   */
  async lancar(
    dados: {
      funcionarioId: string;
      pontos: number;
      motivo: string;
      data?: string;
      foto?: string;
    },
    autor: Autor,
  ): Promise<LancamentoDePontos> {
    const pontos = Number(dados.pontos);
    if (pontos !== 1 && pontos !== -1) {
      throw new BadRequestException('Cada lançamento é de um ponto: +1 ou −1.');
    }
    const motivo = String(dados.motivo ?? '').trim();
    if (motivo.length < 3) {
      throw new BadRequestException(
        'Escreva o motivo: é ele que diz ao funcionário o que fez para ganhar ou perder.',
      );
    }

    // A foto se confere antes de tudo: recusada depois de gravado o ponto,
    // ficaria um lançamento sem a prova que quem pontuou quis juntar.
    let foto: string | null = null;
    if (dados.foto) {
      const arquivo = lerDataUrl(dados.foto);
      conferirArquivo(arquivo, FOTO_ACEITA, FOTO_MAXIMA, 'A foto precisa ser JPEG, PNG ou WebP.');
      foto = dados.foto;
    }

    const funcionario = await this.prisma.funcionario.findFirst({
      where: { id: dados.funcionarioId, ativo: true, isentoIcms: true },
      select: { id: true, nome: true },
    });
    if (!funcionario) {
      throw new NotFoundException('Funcionário não encontrado entre os ativos.');
    }

    const data = dados.data ? dataUtc(dados.data) : hojeUtc();
    // Um dia de folga para o fuso: às 22h de Brasília o servidor já está no
    // dia seguinte.
    if (data.getTime() > hojeUtc().getTime() + 24 * 60 * 60 * 1000) {
      throw new BadRequestException('A data não pode ser no futuro.');
    }

    const criado = await this.prisma.lancamentoDePontos.create({
      data: {
        funcionarioId: funcionario.id,
        pontos,
        motivo: motivo.slice(0, 300),
        data,
        competencia: competenciaDe(data),
        coordenadorId: autor.tipo === 'coordenador' ? autor.id : null,
        usuarioId: autor.tipo === 'admin' ? autor.id : null,
        lancadoPor: autor.nome,
        ...(foto ? { foto: { create: { foto } } } : {}),
      },
    });
    this.logger.log(
      `${autor.nome} deu ${pontos > 0 ? '+' : ''}${pontos} a ${funcionario.nome}: ${motivo}` +
        (foto ? ' (com foto)' : ''),
    );
    return criado;
  }

  /**
   * A foto de um lançamento, em data URL.
   *
   * `doFuncionario` é a trava da tela do funcionário: ali quem pede só prova o
   * CPF, e só vê a foto dos próprios pontos.
   */
  async fotoDoLancamento(
    lancamentoId: string,
    doFuncionario?: string,
  ): Promise<{ foto: string }> {
    const f = await this.prisma.fotoDosPontos.findUnique({
      where: { lancamentoId },
      include: { lancamento: { select: { funcionarioId: true } } },
    });
    if (!f || (doFuncionario && f.lancamento.funcionarioId !== doFuncionario)) {
      throw new NotFoundException('Foto não encontrada.');
    }
    return { foto: f.foto };
  }

  /** A foto de um ponto, pedida da tela do funcionário (que só tem o CPF). */
  async fotoDoFuncionario(cpf: string, lancamentoId: string): Promise<{ foto: string }> {
    const funcionario = await this.funcionarioPeloCpf(somenteDigitos(cpf));
    if (!funcionario) throw new NotFoundException('Foto não encontrada.');
    return this.fotoDoLancamento(lancamentoId, funcionario.id);
  }

  // --- Os motivos de um toque ---

  /** Os a mais primeiro, cada lado em ordem alfabética. */
  listarMotivos(): Promise<MotivoDePontos[]> {
    return this.prisma.motivoDePontos.findMany({
      orderBy: [{ positivo: 'desc' }, { texto: 'asc' }],
    });
  }

  async criarMotivo(dados: { texto: string; positivo: boolean }): Promise<MotivoDePontos> {
    const texto = textoDoMotivo(dados.texto);
    await this.recusarMotivoRepetido(texto, dados.positivo);
    return this.prisma.motivoDePontos.create({
      data: { texto, positivo: dados.positivo },
    });
  }

  /** Troca o texto. O que já foi lançado com o texto velho fica como está. */
  async atualizarMotivo(id: string, dados: { texto: string }): Promise<MotivoDePontos> {
    const m = await this.prisma.motivoDePontos.findUnique({ where: { id } });
    if (!m) throw new NotFoundException('Motivo não encontrado.');
    const texto = textoDoMotivo(dados.texto);
    await this.recusarMotivoRepetido(texto, m.positivo, id);
    return this.prisma.motivoDePontos.update({ where: { id }, data: { texto } });
  }

  async removerMotivo(id: string): Promise<void> {
    const m = await this.prisma.motivoDePontos.findUnique({ where: { id } });
    if (!m) throw new NotFoundException('Motivo não encontrado.');
    await this.prisma.motivoDePontos.delete({ where: { id } });
  }

  /** O mesmo motivo duas vezes do mesmo lado é só um botão a mais na tela. */
  private async recusarMotivoRepetido(
    texto: string,
    positivo: boolean,
    menosEste?: string,
  ): Promise<void> {
    const repetido = await this.prisma.motivoDePontos.findFirst({
      where: {
        texto: { equals: texto, mode: 'insensitive' },
        positivo,
        ...(menosEste ? { id: { not: menosEste } } : {}),
      },
    });
    if (repetido) {
      throw new BadRequestException(
        `"${repetido.texto}" já está entre os motivos ${positivo ? 'a mais' : 'a menos'}.`,
      );
    }
  }

  /**
   * Apaga um lançamento. O coordenador apaga só os que ele mesmo deu — errou o
   * funcionário, errou o número. O ADMIN apaga qualquer um.
   */
  async apagar(id: string, quem: Autor): Promise<void> {
    const l = await this.prisma.lancamentoDePontos.findUnique({ where: { id } });
    if (!l) throw new NotFoundException('Lançamento não encontrado.');
    if (!podeApagar(l, quem)) {
      throw new ForbiddenException(
        'Só quem deu os pontos (ou o administrador) pode apagar este lançamento.',
      );
    }
    await this.prisma.lancamentoDePontos.delete({ where: { id } });
    this.logger.log(`${quem.nome} apagou o lançamento ${id} (${l.pontos} pontos).`);
  }

  // --- O cadastro dos coordenadores (só o ADMIN) ---

  async listarCoordenadores(): Promise<
    Array<Omit<CoordenadorPontuacao, 'senhaHash'> & { travado: boolean }>
  > {
    const lista = await this.prisma.coordenadorPontuacao.findMany({
      orderBy: [{ ativo: 'desc' }, { nome: 'asc' }],
    });
    const agora = new Date();
    return lista.map(({ senhaHash: _senha, ...c }) => ({
      ...c,
      travado: !!c.bloqueadoAte && c.bloqueadoAte > agora,
    }));
  }

  async criarCoordenador(
    dados: { nome: string; cpf: string; senha: string },
    usuarioId?: string,
  ): Promise<{ id: string }> {
    const cpf = somenteDigitos(dados.cpf);
    if (!cpfValido(cpf)) {
      throw new BadRequestException(
        'Este CPF não fecha nos dígitos verificadores. Confira os números.',
      );
    }
    const repetido = await this.prisma.coordenadorPontuacao.findUnique({
      where: { cpf },
    });
    if (repetido) {
      throw new BadRequestException(`Este CPF já é o login de ${repetido.nome}.`);
    }

    const c = await this.prisma.coordenadorPontuacao.create({
      data: {
        nome: dados.nome.trim(),
        cpf,
        senhaHash: await bcrypt.hash(senhaCurta(dados.senha), 10),
        criadoPor: usuarioId ?? null,
      },
    });
    this.logger.log(`Coordenador de pontuação cadastrado: ${c.nome}.`);
    return { id: c.id };
  }

  /** Nome, senha nova (destrava junto) e ligar/desligar. */
  async atualizarCoordenador(
    id: string,
    dados: { nome?: string; senha?: string; ativo?: boolean },
  ): Promise<void> {
    const c = await this.prisma.coordenadorPontuacao.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Coordenador não encontrado.');

    await this.prisma.coordenadorPontuacao.update({
      where: { id },
      data: {
        ...(dados.nome === undefined ? {} : { nome: dados.nome.trim() }),
        ...(dados.ativo === undefined ? {} : { ativo: dados.ativo }),
        // Trocar a senha é também o jeito de destravar quem errou demais.
        ...(dados.senha === undefined
          ? {}
          : {
              senhaHash: await bcrypt.hash(senhaCurta(dados.senha), 10),
              tentativas: 0,
              bloqueadoAte: null,
            }),
      },
    });
  }

  /** Tira o login. Os pontos que ele deu continuam, com o nome escrito. */
  async removerCoordenador(id: string): Promise<void> {
    const c = await this.prisma.coordenadorPontuacao.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Coordenador não encontrado.');
    await this.prisma.coordenadorPontuacao.delete({ where: { id } });
  }

  /**
   * O funcionário ativo com este CPF.
   *
   * A comparação é pelos dígitos, em memória: o IXC guarda o CPF com ponto e
   * traço, e nem sempre igual. São algumas dezenas de linhas — ler todas custa
   * menos do que errar a máscara e dizer a alguém que ele não trabalha aqui.
   */
  private async funcionarioPeloCpf(
    digitos: string,
  ): Promise<{ id: string; nome: string; apelido: string | null } | null> {
    if (digitos.length !== 11) return null;
    const ativos = await this.prisma.funcionario.findMany({
      where: { ativo: true, isentoIcms: true, cpfCnpj: { not: null } },
      select: { id: true, nome: true, apelido: true, cpfCnpj: true },
    });
    const achado = ativos.find((f) => somenteDigitos(f.cpfCnpj) === digitos);
    return achado ? { id: achado.id, nome: achado.nome, apelido: achado.apelido } : null;
  }
}

function podeApagar(
  l: { coordenadorId: string | null },
  quem: Autor,
): boolean {
  if (quem.tipo === 'admin') return true;
  return l.coordenadorId === quem.id;
}

function senhaCurta(senha: string): string {
  const s = String(senha ?? '').trim();
  if (!/^\d{4,6}$/.test(s)) {
    throw new BadRequestException('A senha é de 4 a 6 números.');
  }
  return s;
}

function textoDoMotivo(texto: string): string {
  const t = String(texto ?? '').trim().replace(/\s+/g, ' ');
  if (t.length < 3) {
    throw new BadRequestException('O motivo precisa de pelo menos 3 letras.');
  }
  if (t.length > 60) {
    throw new BadRequestException(
      'Motivo curto, de botão: até 60 letras. O detalhe se escreve na hora de pontuar.',
    );
  }
  return t;
}

function primeiroNome(nome: string | null): string | null {
  return nome ? nome.trim().split(/\s+/)[0] : null;
}

export function validarCompetencia(competencia: string): string {
  const c = String(competencia).trim();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(c)) {
    throw new BadRequestException(`"${competencia}" não é um mês no formato AAAA-MM.`);
  }
  return c;
}

function mesAtual(): string {
  const agora = new Date();
  return `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
}

function competenciaDe(data: Date): string {
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** As `quantas` competências até `ate`, da mais antiga para a mais nova. */
function ultimasCompetencias(ate: string, quantas: number): string[] {
  const [ano, mes] = ate.split('-').map(Number);
  const lista: string[] = [];
  for (let i = quantas - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(ano, mes - 1 - i, 1));
    lista.push(competenciaDe(d));
  }
  return lista;
}

function hojeUtc(): Date {
  const agora = new Date();
  return new Date(Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate()));
}

function dataUtc(iso: string): Date {
  const [ano, mes, dia] = iso.slice(0, 10).split('-').map(Number);
  if (!ano || !mes || !dia) {
    throw new BadRequestException(`"${iso}" não é uma data AAAA-MM-DD.`);
  }
  return new Date(Date.UTC(ano, mes - 1, dia));
}
