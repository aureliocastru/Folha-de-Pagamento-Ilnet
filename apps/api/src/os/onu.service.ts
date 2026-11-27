import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { AutorizacaoDeOnu, SituacaoAutorizacaoOnu } from '@prisma/client';
import { numeroDoIxc } from '../almoxarifado/estoque.mapper';
import { IxcClient } from '../ixc/ixc.client';
import { PrismaService } from '../prisma/prisma.service';
import {
  corpoDaOnuNova,
  corpoDaOnuReaproveitada,
  explicarRecusa,
  falhaDeRede,
  lerCaixa,
  lerGravacao,
  lerOlt,
  lerOnuDoIxc,
  lerPendente,
  lerPerfil,
  mesmoMac,
  naoEstavaNaOlt,
  perfilSugerido,
  perfisDaOlt,
  portasDaCaixa,
  vlanSugerida,
  vlanValida,
  type Caixa,
  type DadosDaAutorizacao,
  type DesfechoNaOlt,
  type Olt,
  type OnuDoIxc,
  type OnuPendente,
  type Perfil,
  type PortaDaCaixa,
  type SinalDaOnu,
} from './onu';
import type { OsDoIxc } from './os-ixc';
import { OsService, type Login } from './os.service';
import type { TecnicoDaOs } from './tecnicos.service';

/** Os botões do IXC, com o número que a tela de lá usa (`rel_22408.php`…). */
const GRAVAR_NO_DISPOSITIVO = 'botao_gravar_dispositivo_22408';
const EXCLUIR_DISPOSITIVO = 'botao_excluir_dispositivo_22434';
const LER_POTENCIA = 'botao_rel_22991';

const FIBRA = 'radpop_radio_cliente_fibra';

/** Quanto tempo uma autorização "gravando" segura a mesma ONU — o toque duplo. */
const TRAVA_MS = 3 * 60_000;

/** Quantas OLTs se consultam ao mesmo tempo no "todas". */
const OLTS_EM_PARALELO = 3;

/** O que a tela abre: o login da OS, as ONUs dele, as OLTs e o que já se fez aqui. */
export interface OnuDaOs {
  /** Por que esta OS não autoriza ONU. Null: autoriza. */
  motivo: string | null;
  login: {
    id: number;
    usuario: string | null;
    contratoId: number;
    caixaId: number | null;
    caixa: string | null;
    porta: number | null;
  } | null;
  /** As ONUs que o IXC tem neste login. */
  onus: Array<OnuDoIxc & { olt: string | null }>;
  olts: Array<{ id: number; nome: string }>;
  /** A OLT da caixa do login, ou da ONU dele — onde a consulta começa. */
  oltSugerida: number | null;
  autorizacoes: AutorizacaoNaTela[];
}

export interface AutorizacaoNaTela {
  id: string;
  situacao: SituacaoAutorizacaoOnu;
  mac: string;
  modelo: string;
  olt: string;
  ponid: string;
  caixa: string | null;
  porta: number;
  vlan: string;
  perfil: string | null;
  reaproveitou: boolean;
  macAnterior: string | null;
  fibraId: number | null;
  retorno: string | null;
  registradoPor: string;
  criadoEm: string;
}

/** O formulário de uma ONU escolhida na consulta, já preenchido. */
export interface PreparoDaOnu {
  pendente: OnuPendente;
  perfis: Array<{ id: number; nome: string }>;
  perfilSugerido: number | null;
  vlanSugerida: string | null;
  caixa: Caixa | null;
  portas: PortaDaCaixa[];
  portaSugerida: number | null;
  /** Esta ONU já tem cadastro no IXC — de outro login, ou deste mesmo. */
  jaCadastrada: (OnuDoIxc & { olt: string | null }) | null;
  /** As ONUs deste login, para dizer se a nova substitui uma delas. */
  doLogin: Array<OnuDoIxc & { olt: string | null }>;
}

export interface PedidoDeAutorizacao {
  oltId: number;
  chave: string;
  caixaId: number;
  porta: number;
  perfilId: number;
  vlan: string;
  /** O cadastro deste login que a ONU nova substitui (a troca de ONU). */
  substituirId?: number;
  /** A ONU é mais uma do login, e não substitui nenhuma. */
  adicional?: boolean;
  /** A ONU tem cadastro em outro login e passa para este. */
  confirmarMudanca?: boolean;
}

/**
 * Autorizar ONU pela OS — o "Autorizar ONUs" do IXC na tela do técnico (ver
 * `onu.ts` para o caminho que o IXC faz e que aqui se repete).
 *
 * É a OS do próprio técnico, como o resto da tela dele (`OsService.contexto`),
 * e a ONU autentica o login da OS: não se escolhe outro cliente aqui.
 *
 * **Nada se repete sozinho.** O que vai à OLT é escrita de verdade numa rede
 * de clientes. Uma resposta que não deu para ler fica INCERTA e é mostrada
 * como está; quem tenta de novo é o técnico, e a segunda tentativa cai no
 * cadastro que a primeira criou (o MAC é o mesmo), em vez de criar outro.
 */
@Injectable()
export class OnuDaOsService {
  private readonly logger = new Logger(OnuDaOsService.name);

  constructor(
    private readonly ixc: IxcClient,
    private readonly prisma: PrismaService,
    private readonly os: OsService,
  ) {}

  async abrir(login: Login, osId: number): Promise<OnuDaOs> {
    const { os } = await this.os.contexto(login, osId);
    const [usuario, olts, autorizacoes] = await Promise.all([
      os.loginId > 0 ? this.ixc.getById<Record<string, unknown>>('radusuarios', 'radusuarios.id', os.loginId) : null,
      this.olts(),
      this.prisma.autorizacaoDeOnu.findMany({
        where: { osIxcId: osId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
    ]);
    const onus = os.loginId > 0 ? await this.onusDoLogin(os.loginId) : [];
    const caixaId = numeroDoIxc(usuario?.id_caixa_ftth);
    const caixa = caixaId > 0 ? await this.caixa(caixaId) : null;
    const nomeDaOlt = new Map(olts.map((o) => [o.id, o.nome]));
    const daOlt = (id: number | null) => (id && nomeDaOlt.has(id) ? id : null);

    return {
      motivo: motivoParaNaoAutorizar(os),
      login: usuario
        ? {
            id: os.loginId,
            usuario: textoOuNulo(usuario.login),
            contratoId: numeroDoIxc(usuario.id_contrato) || os.contratoId,
            caixaId: caixa?.id ?? null,
            caixa: caixa?.nome ?? null,
            porta: numeroDoIxc(usuario.ftth_porta) || null,
          }
        : null,
      onus: onus.map((o) => ({ ...o, olt: nomeDaOlt.get(o.oltId) ?? null })),
      olts: olts.map((o) => ({ id: o.id, nome: o.nome })),
      oltSugerida:
        daOlt(caixa?.oltId ?? null) ??
        daOlt(numeroDoIxc(usuario?.id_transmissor)) ??
        daOlt(onus[0]?.oltId ?? null) ??
        (olts.length === 1 ? olts[0].id : null),
      autorizacoes: autorizacoes.map(naTela),
    };
  }

  /**
   * O "Consultar" do IXC: o que está plugado na OLT e não foi autorizado.
   * Sem OLT, todas — o técnico nem sempre sabe de qual OLT é a caixa. A OLT que
   * não respondeu não derruba as outras: vai em `falhas`, com o motivo.
   */
  async pendentes(
    login: Login,
    osId: number,
    oltId: number | null,
  ): Promise<{ pendentes: OnuPendente[]; falhas: Array<{ olt: string; motivo: string }> }> {
    await this.os.contexto(login, osId);
    const olts = await this.olts();
    const alvo = oltId ? olts.filter((o) => o.id === oltId) : olts;
    if (oltId && alvo.length === 0) throw new NotFoundException(`A OLT ${oltId} não está entre as OLTs do IXC.`);

    const pendentes: OnuPendente[] = [];
    const falhas: Array<{ olt: string; motivo: string }> = [];
    for (let i = 0; i < alvo.length; i += OLTS_EM_PARALELO) {
      const lote = alvo.slice(i, i + OLTS_EM_PARALELO);
      const lidas = await Promise.allSettled(lote.map((o) => this.pendentesDaOlt(o.id)));
      lidas.forEach((r, j) => {
        if (r.status === 'fulfilled') pendentes.push(...r.value);
        else falhas.push({ olt: lote[j].nome, motivo: motivo(r.reason) });
      });
    }
    return { pendentes, falhas };
  }

  /** O formulário da ONU escolhida: perfil, VLAN, caixa e porta já sugeridos. */
  async preparar(login: Login, osId: number, oltId: number, chave: string): Promise<PreparoDaOnu> {
    const { os } = await this.os.contexto(login, osId);
    const olts = await this.olts();
    const olt = olts.find((o) => o.id === oltId);
    if (!olt) throw new NotFoundException(`A OLT ${oltId} não está entre as OLTs do IXC.`);
    const pendente = await this.pendenteAinda(oltId, chave);

    const [perfis, doPon, daOlt, doModelo, porMac, doLogin, usuario] = await Promise.all([
      this.perfis(olt),
      this.fibras({ qtype: `${FIBRA}.id_transmissor`, query: String(olt.id) }, [
        { TB: `${FIBRA}.slotno`, OP: '=', P: String(pendente.slot) },
        { TB: `${FIBRA}.ponno`, OP: '=', P: String(pendente.pon) },
      ]),
      this.fibras({ qtype: `${FIBRA}.id_transmissor`, query: String(olt.id) }),
      pendente.modelo ? this.fibras({ qtype: `${FIBRA}.onu_tipo`, query: pendente.modelo }) : nenhuma(),
      this.fibras({ qtype: `${FIBRA}.mac`, query: pendente.mac }),
      os.loginId > 0 ? this.onusDoLogin(os.loginId) : nenhuma(),
      os.loginId > 0 ? this.ixc.getById<Record<string, unknown>>('radusuarios', 'radusuarios.id', os.loginId) : null,
    ]);

    const caixaId = numeroDoIxc(usuario?.id_caixa_ftth);
    const caixa = caixaId > 0 ? await this.caixa(caixaId) : null;
    const portas = caixa ? portasDaCaixa(caixa, await this.fibrasDaCaixa(caixa.id)) : [];
    const nomes = new Map(olts.map((o) => [o.id, o.nome]));
    const comOlt = (o: OnuDoIxc) => ({ ...o, olt: nomes.get(o.oltId) ?? null });
    const jaCadastrada = porMac.find((o) => mesmoMac(o.mac, pendente.mac)) ?? null;

    return {
      pendente,
      perfis: perfis.map((p) => ({ id: p.id, nome: p.nome })),
      perfilSugerido: perfilSugerido(doModelo, perfis, olt),
      vlanSugerida: vlanSugerida(doPon, daOlt),
      caixa,
      portas,
      portaSugerida: numeroDoIxc(usuario?.ftth_porta) || null,
      jaCadastrada: jaCadastrada ? comOlt(jaCadastrada) : null,
      doLogin: doLogin.filter((o) => !mesmoMac(o.mac, pendente.mac)).map(comOlt),
    };
  }

  /** As caixas cujo nome tem o que foi digitado ("R63", "CTO10"). */
  async caixas(login: Login, osId: number, busca: string): Promise<Caixa[]> {
    await this.os.contexto(login, osId);
    const termo = busca.trim();
    if (termo.length < 2) return [];
    const res = await this.ixc.list<Record<string, unknown>>('rad_caixa_ftth', {
      qtype: 'rad_caixa_ftth.descricao',
      query: termo,
      oper: 'L',
      rp: 30,
      sortname: 'rad_caixa_ftth.descricao',
    });
    return res.registros.map(lerCaixa).filter((c): c is Caixa => !!c && c.ativa);
  }

  async portas(login: Login, osId: number, caixaId: number): Promise<{ caixa: Caixa; portas: PortaDaCaixa[] }> {
    await this.os.contexto(login, osId);
    const caixa = await this.caixa(caixaId);
    if (!caixa) throw new NotFoundException(`A caixa ${caixaId} não foi achada no IXC.`);
    return { caixa, portas: portasDaCaixa(caixa, await this.fibrasDaCaixa(caixaId)) };
  }

  /**
   * Autoriza a ONU: o cadastro (novo, ou o que já existia) e o "Gravar no
   * dispositivo". Tudo é conferido de novo contra o IXC — a ONU ainda
   * pendente na OLT, o perfil, a caixa — antes da primeira escrita.
   */
  async autorizar(login: Login, osId: number, pedido: PedidoDeAutorizacao): Promise<AutorizacaoNaTela> {
    const { tecnico, os } = await this.os.contexto(login, osId);
    const recusa = motivoParaNaoAutorizar(os);
    if (recusa) throw new BadRequestException(recusa);

    const vlan = vlanValida(pedido.vlan);
    if (!vlan) throw new BadRequestException('A VLAN vai de 1 a 4094.');

    const olt = await this.olt(pedido.oltId);
    const [pendente, perfis, caixa, usuario, doLogin] = await Promise.all([
      this.pendenteAinda(olt.id, pedido.chave),
      this.perfis(olt),
      this.caixa(pedido.caixaId),
      this.ixc.getById<Record<string, unknown>>('radusuarios', 'radusuarios.id', os.loginId),
      this.onusDoLogin(os.loginId),
    ]);

    const perfil = perfis.find((p) => p.id === pedido.perfilId);
    if (!perfil) {
      throw new BadRequestException('Este perfil não serve a esta OLT, ou está sem comando no IXC. Escolha outro.');
    }
    if (!caixa || !caixa.ativa) throw new BadRequestException('A caixa escolhida não foi achada no IXC.');
    const limite = caixa.capacidade ?? 256;
    if (!(pedido.porta >= 1 && pedido.porta <= limite)) {
      throw new BadRequestException(`A caixa ${caixa.nome} tem as portas de 1 a ${limite}.`);
    }

    const alvo = await this.cadastroAReaproveitar(pendente, os.loginId, doLogin, pedido);
    await this.travar(pendente.mac);

    const dados: DadosDaAutorizacao = {
      pendente,
      loginId: os.loginId,
      login: textoOuNulo(usuario?.login),
      contratoId: numeroDoIxc(usuario?.id_contrato) || os.contratoId,
      caixa,
      porta: pedido.porta,
      perfil,
      vlan,
    };

    const linha = await this.prisma.autorizacaoDeOnu.create({
      data: {
        osIxcId: os.id,
        loginIxcId: os.loginId,
        fibraIxcId: alvo?.id ?? null,
        reaproveitou: !!alvo,
        macAnterior: alvo && !mesmoMac(alvo.mac, pendente.mac) ? alvo.mac : null,
        oltIxcId: olt.id,
        olt: olt.nome,
        ponid: pendente.ponid,
        mac: pendente.mac,
        modelo: pendente.modelo,
        caixaIxcId: caixa.id,
        caixa: caixa.nome,
        porta: pedido.porta,
        perfilIxcId: perfil.id,
        perfil: perfil.nome,
        vlan,
        tecnicoId: tecnico.funcionarioId,
        registradoPor: login.nome,
      },
    });

    let fim: { situacao: DesfechoNaOlt; retorno: string; fibraId: number | null };
    try {
      fim = await this.gravar(dados, alvo, tecnico);
    } catch (e) {
      // Um passo estourou no meio: não dá para dizer o que chegou à OLT.
      this.logger.error(`Autorização da ONU ${pendente.mac} parou no meio: ${motivo(e)}`);
      fim = {
        situacao: 'INCERTA',
        retorno: `A autorização parou no meio (${motivo(e)}). Confira a ONU no IXC antes de tentar de novo.`,
        fibraId: alvo?.id ?? null,
      };
    }
    const salva = await this.prisma.autorizacaoDeOnu.update({
      where: { id: linha.id },
      data: { situacao: fim.situacao, retorno: fim.retorno.slice(0, 4000), fibraIxcId: fim.fibraId },
    });
    return naTela(salva);
  }

  /**
   * A potência da ONU, lida da OLT agora — o "Potência" do IXC. O botão
   * escreve a leitura no cadastro; é de lá que ela se lê, e não do HTML que ele
   * devolve. Só as ONUs do login da OS.
   */
  async sinal(login: Login, osId: number, fibraId: number): Promise<{ sinal: SinalDaOnu; aviso: string | null }> {
    const { os } = await this.os.contexto(login, osId);
    const onu = (await this.onusDoLogin(os.loginId)).find((o) => o.id === fibraId);
    if (!onu) throw new NotFoundException('Esta ONU não é do login desta OS.');

    let aviso: string | null = null;
    try {
      const resposta = await this.ixc.action(LER_POTENCIA, { id: String(fibraId) });
      const { desfecho, texto } = lerGravacao(resposta);
      if (desfecho === 'RECUSADA') aviso = explicarRecusa(texto || 'O IXC não leu a potência.');
    } catch (e) {
      aviso = explicarRecusa(motivo(e));
    }
    const relida = await this.ixc.getById<Record<string, unknown>>(FIBRA, `${FIBRA}.id`, fibraId);
    const sinal = (relida && lerOnuDoIxc(relida)?.sinal) ?? onu.sinal;
    if (!aviso && !sinal.rx) aviso = 'A OLT não devolveu a potência. A ONU pode estar desligada ou sem fibra.';
    return { sinal, aviso };
  }

  // ---------------------------------------------------------------------------

  /**
   * Qual cadastro do IXC recebe a ONU. O MAC manda: a ONU que já tem cadastro
   * usa o dela (de outro login, só com a mudança confirmada). Sem cadastro, a
   * troca de ONU usa o da antiga; e o login que já tem ONU precisa dizer se
   * esta substitui uma ou é mais uma — adivinhar aqui seria deixar duas ONUs
   * no mesmo login, ou tirar da OLT a que funcionava.
   */
  private async cadastroAReaproveitar(
    pendente: OnuPendente,
    loginId: number,
    doLogin: OnuDoIxc[],
    pedido: PedidoDeAutorizacao,
  ): Promise<OnuDoIxc | null> {
    const porMac = (await this.fibras({ qtype: `${FIBRA}.mac`, query: pendente.mac })).filter((o) =>
      mesmoMac(o.mac, pendente.mac),
    );
    if (porMac.length > 1) {
      throw new BadRequestException(
        `A ONU ${pendente.mac} tem ${porMac.length} cadastros no IXC (${porMac.map((o) => o.id).join(', ')}). ` +
          'Peça à base para deixar um só antes de autorizar.',
      );
    }
    const doMac = porMac[0];
    if (doMac) {
      if (doMac.loginId !== loginId && !pedido.confirmarMudanca) {
        throw new BadRequestException(
          `A ONU ${pendente.mac} está cadastrada no IXC para ${doMac.nome ?? `o login ${doMac.loginId}`}. ` +
            'Confirme que ela passa para este cliente.',
        );
      }
      return doMac;
    }

    const outras = doLogin.filter((o) => !mesmoMac(o.mac, pendente.mac));
    if (pedido.substituirId) {
      const velha = outras.find((o) => o.id === pedido.substituirId);
      if (!velha) throw new BadRequestException('A ONU a substituir não é deste login.');
      return velha;
    }
    if (outras.length > 0 && !pedido.adicional) {
      throw new BadRequestException(
        `Este login já tem ONU no IXC (${outras.map((o) => o.mac).join(', ')}). ` +
          'Diga se a nova substitui ela, ou se é mais uma.',
      );
    }
    return null;
  }

  /** Outra autorização da mesma ONU em andamento — o toque duplo, ou dois celulares. */
  private async travar(mac: string): Promise<void> {
    const andando = await this.prisma.autorizacaoDeOnu.findFirst({
      where: { mac, situacao: 'GRAVANDO', createdAt: { gte: new Date(Date.now() - TRAVA_MS) } },
    });
    if (andando) {
      throw new BadRequestException(
        `A ONU ${mac} já está sendo autorizada por ${andando.registradoPor}. Espere a resposta da OLT.`,
      );
    }
  }

  /**
   * As escritas, na ordem do IXC. Cada passo que falha para ali e diz em que
   * ponto ficou: o que já foi à OLT não se desfaz sozinho.
   */
  private async gravar(
    dados: DadosDaAutorizacao,
    alvo: OnuDoIxc | null,
    tecnico: TecnicoDaOs,
  ): Promise<{ situacao: DesfechoNaOlt; retorno: string; fibraId: number | null }> {
    const { mac } = dados.pendente;
    let fibraId = alvo?.id ?? null;

    if (alvo) {
      // 1. A posição velha sai da OLT — se a OLT ainda a tem.
      if (alvo.naOlt) {
        const saiu = await this.botao(EXCLUIR_DISPOSITIVO, alvo.id);
        if (saiu.desfecho !== 'AUTORIZADA' && !naoEstavaNaOlt(saiu.texto)) {
          return {
            situacao: saiu.desfecho === 'INCERTA' ? 'INCERTA' : 'RECUSADA',
            retorno: `A ONU ${alvo.mac} não saiu da OLT, e nada foi mudado no cadastro.\n${saiu.texto}`,
            fibraId,
          };
        }
      }
      // 2. O cadastro, inteiro, com a ONU nova.
      try {
        const atual = await this.ixc.getById<Record<string, unknown>>(FIBRA, `${FIBRA}.id`, alvo.id);
        if (!atual) throw new Error(`o cadastro ${alvo.id} sumiu do IXC`);
        await this.ixc.update(FIBRA, alvo.id, corpoDaOnuReaproveitada(atual, dados));
      } catch (e) {
        return {
          situacao: falhaDeRede(motivo(e)) ? 'INCERTA' : 'RECUSADA',
          retorno:
            (alvo.naOlt ? `A ONU ${alvo.mac} já saiu da OLT, mas o IXC não editou o cadastro: ` : 'O IXC não editou o cadastro: ') +
            explicarRecusa(motivo(e)),
          fibraId,
        };
      }
    } else {
      try {
        const criado = await this.ixc.create(FIBRA, corpoDaOnuNova(dados));
        fibraId = criado.id ?? (await this.idDoCriado(mac, dados.loginId));
      } catch (e) {
        if (falhaDeRede(motivo(e))) fibraId = await this.idDoCriado(mac, dados.loginId).catch(() => null);
        if (!fibraId) {
          return {
            situacao: falhaDeRede(motivo(e)) ? 'INCERTA' : 'RECUSADA',
            retorno: `O IXC não criou o cadastro da ONU: ${explicarRecusa(motivo(e))}`,
            fibraId: null,
          };
        }
      }
      if (!fibraId) {
        return {
          situacao: 'INCERTA',
          retorno: 'O IXC respondeu, mas o cadastro da ONU não apareceu. Confira em Clientes Fibra antes de tentar de novo.',
          fibraId: null,
        };
      }
    }

    // 3. "Gravar no dispositivo": os comandos do perfil vão à OLT.
    if (fibraId === null) {
      return { situacao: 'INCERTA', retorno: 'O cadastro da ONU não apareceu no IXC.', fibraId: null };
    }
    const gravou = await this.botao(GRAVAR_NO_DISPOSITIVO, fibraId);
    this.logger.log(
      `ONU ${mac} (cadastro ${fibraId}) por ${tecnico.nome}: ${gravou.desfecho} — ${gravou.texto.slice(0, 300)}`,
    );
    return {
      situacao: gravou.desfecho,
      retorno:
        gravou.texto ||
        (gravou.desfecho === 'AUTORIZADA' ? 'A OLT gravou a ONU.' : 'A OLT não respondeu nada que desse para ler.'),
      fibraId,
    };
  }

  /** Um botão do IXC que fala com a OLT. A falha de rede é INCERTA: o pedido pode ter chegado. */
  private async botao(endpoint: string, fibraId: number): Promise<{ desfecho: DesfechoNaOlt; texto: string }> {
    try {
      return lerGravacao(await this.ixc.action(endpoint, { id: String(fibraId) }));
    } catch (e) {
      const m = motivo(e);
      return { desfecho: falhaDeRede(m) ? 'INCERTA' : 'RECUSADA', texto: explicarRecusa(m) };
    }
  }

  /** O insert do IXC nem sempre devolve o id: acha-se pelo MAC, no login. */
  private async idDoCriado(mac: string, loginId: number): Promise<number | null> {
    const achados = (await this.fibras({ qtype: `${FIBRA}.mac`, query: mac })).filter(
      (o) => mesmoMac(o.mac, mac) && o.loginId === loginId,
    );
    return achados.length > 0 ? Math.max(...achados.map((o) => o.id)) : null;
  }

  /** A ONU ainda está pendente nesta OLT — conferido na OLT, agora. */
  private async pendenteAinda(oltId: number, chave: string): Promise<OnuPendente> {
    const pendentes = await this.pendentesDaOlt(oltId);
    const achada = pendentes.find((p) => p.chave === chave);
    if (!achada) {
      throw new BadRequestException(
        'Esta ONU não aparece mais como não autorizada na OLT — pode já ter sido autorizada, ou ter saído da ' +
          'fibra. Consulte a OLT de novo.',
      );
    }
    return achada;
  }

  private async pendentesDaOlt(oltId: number): Promise<OnuPendente[]> {
    try {
      const res = await this.ixc.list<Record<string, unknown>>('fh_onu_nao_autorizadas', {
        qtype: '',
        query: '',
        oper: 'L',
        rp: 1000,
        sortname: '',
        gridParam: [{ TB: 'id_olt', OP: '=', P: String(oltId) }],
      });
      return res.registros.map(lerPendente).filter((p): p is OnuPendente => p !== null);
    } catch (e) {
      // "Nenhuma ONU disponível" vem como erro, e é a OLT sem pendência.
      if (/nenhuma onu/i.test(motivo(e))) return [];
      throw e;
    }
  }

  private async olts(): Promise<Olt[]> {
    const res = await this.ixc.list<Record<string, unknown>>('radpop_radio', {
      qtype: 'radpop_radio.ativo',
      query: 'S',
      oper: '=',
      rp: 500,
      sortname: 'radpop_radio.descricao',
    });
    return res.registros.map(lerOlt).filter((o): o is Olt => o !== null);
  }

  private async olt(oltId: number): Promise<Olt> {
    const olt = (await this.olts()).find((o) => o.id === oltId);
    if (!olt) throw new NotFoundException(`A OLT ${oltId} não está entre as OLTs do IXC.`);
    return olt;
  }

  private async perfis(olt: Olt): Promise<Perfil[]> {
    const res = await this.ixc.list<Record<string, unknown>>(`${FIBRA}_perfil`, {
      qtype: `${FIBRA}_perfil.id`,
      query: '0',
      oper: '>',
      rp: 500,
      sortname: `${FIBRA}_perfil.nome`,
    });
    return perfisDaOlt(res.registros.map(lerPerfil).filter((p): p is Perfil => p !== null), olt);
  }

  private async caixa(caixaId: number): Promise<Caixa | null> {
    const linha = await this.ixc.getById<Record<string, unknown>>('rad_caixa_ftth', 'rad_caixa_ftth.id', caixaId);
    return linha ? lerCaixa(linha) : null;
  }

  private onusDoLogin(loginId: number): Promise<OnuDoIxc[]> {
    return this.fibras({ qtype: `${FIBRA}.id_login`, query: String(loginId) });
  }

  private fibrasDaCaixa(caixaId: number): Promise<OnuDoIxc[]> {
    return this.fibras({ qtype: `${FIBRA}.id_caixa_ftth`, query: String(caixaId) }, undefined, 300);
  }

  /** Os cadastros de ONU de um filtro, os mais novos primeiro. */
  private async fibras(
    filtro: { qtype: string; query: string },
    gridParam?: Array<{ TB: string; OP: string; P: string }>,
    rp = 200,
  ): Promise<OnuDoIxc[]> {
    const res = await this.ixc.list<Record<string, unknown>>(FIBRA, {
      ...filtro,
      oper: '=',
      rp,
      sortname: `${FIBRA}.id`,
      sortorder: 'desc',
      ...(gridParam ? { gridParam } : {}),
    });
    return res.registros.map(lerOnuDoIxc).filter((o): o is OnuDoIxc => o !== null);
  }
}

/** A OS que não autoriza ONU, e por quê. Null: autoriza. */
export function motivoParaNaoAutorizar(os: OsDoIxc): string | null {
  if (os.loginId <= 0) {
    return (
      'Esta OS não tem o login do cliente no IXC, e a ONU autentica um login. Peça ao atendimento para pôr o ' +
      'login na OS.'
    );
  }
  if (os.status === 'F') {
    return 'A OS já está finalizada no IXC. A ONU de uma OS fechada se autoriza pelo IXC.';
  }
  return null;
}

function naTela(a: AutorizacaoDeOnu): AutorizacaoNaTela {
  return {
    id: a.id,
    situacao: a.situacao,
    mac: a.mac,
    modelo: a.modelo,
    olt: a.olt,
    ponid: a.ponid,
    caixa: a.caixa,
    porta: a.porta,
    vlan: a.vlan,
    perfil: a.perfil,
    reaproveitou: a.reaproveitou,
    macAnterior: a.macAnterior,
    fibraId: a.fibraIxcId,
    retorno: a.retorno,
    registradoPor: a.registradoPor,
    criadoEm: a.createdAt.toISOString(),
  };
}

function nenhuma(): Promise<OnuDoIxc[]> {
  return Promise.resolve([]);
}

function textoOuNulo(v: unknown): string | null {
  const t = v === null || v === undefined ? '' : String(v).trim();
  return t || null;
}

function motivo(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
