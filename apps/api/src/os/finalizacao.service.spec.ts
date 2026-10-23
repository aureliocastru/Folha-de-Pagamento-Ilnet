import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { FinalizacaoService } from './finalizacao.service';
import type { AssuntoDoIxc, OsDoIxc } from './os-ixc';

/**
 * Finalizar a OS pelo celular. O que este arquivo protege:
 *
 *  - o que ficou anotado vai antes, e o item que não foi segura o fechamento
 *    (a finalização espera, com o motivo, sem fechar nada);
 *  - o fechamento leva o técnico, a mensagem com o relato e a comissão do
 *    assunto;
 *  - o IXC que responde erro e fecha vira "finalizada com aviso", o que não
 *    fechou vira "recusada" (e pode ir de novo), e o que não dá para saber vai
 *    para a base conferir — nunca um segundo fechamento às cegas;
 *  - a OS que o atendimento fechou no meio não se fecha de novo;
 *  - a foto vai direto à aba "Arquivos" da OS no IXC, com a descrição, sem
 *    passar pelo banco daqui; o mínimo do assunto conta o que está lá;
 *  - o que o assunto exige e o celular não faz recusa antes de guardar.
 */

type Linha = Record<string, unknown> & { id: string };

const TECNICO = {
  funcionarioId: 'f-cleyson',
  nome: 'Cleyson',
  ixcId: 17,
  almox: { id: 12, nome: 'VAN CLEYSON', filialId: 1 },
};

const OS: OsDoIxc = {
  id: 3788,
  protocolo: '2026092400123',
  status: 'EX',
  prioridade: 'N',
  assuntoId: 4,
  clienteId: 900,
  contratoId: 2294,
  loginId: 51,
  filialId: 1,
  setorId: 3,
  tecnicoId: 17,
  abertura: '2026-09-23 08:00:00',
  agenda: null,
  fechamento: null,
  mensagem: null,
  endereco: 'Rua das Palmeiras, 42',
};

const ASSUNTO: AssuntoDoIxc = {
  id: 4,
  nome: 'Troca de equipamento',
  respostaPadraoId: 12,
  diagnosticoObrigatorio: false,
  fotosExigidas: 0,
  aparelhosExigidos: 0,
  produtosExigidos: 0,
  equipeObrigatoria: false,
  assinaturaObrigatoria: false,
  geraComissao: true,
};

const PEDIDO = {
  respostaId: 12,
  relato: 'Troquei a ONU queimada, sinal -19 dBm.',
  inicio: new Date(Date.now() - 60 * 60_000).toISOString(),
  gps: { latitude: -12.9714, longitude: -38.5014, precisao: 8, em: new Date().toISOString() },
};

const login = { id: 'u1', nome: 'cleyson' };

const FOTO = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1]).toString('base64');

function montar(opcoes: { assunto?: AssuntoDoIxc } = {}) {
  const registro = { id: 'r1', osIxcId: OS.id };
  const finalizacoes: Linha[] = [];
  /** A situação dos itens da OS depois de `executar`. */
  const itensDepois: Array<{ situacao: string }> = [];
  /** O status da OS no IXC, como a releitura o vê. */
  const ixcOs = { status: 'EX', falhaAoReler: false };
  const ordem: string[] = [];
  /** A aba "Arquivos" da OS no IXC. */
  const arquivosNoIxc: Array<{ id: number; osId: number; descricao: string; classificacao: string | null }> = [];

  const combina = (f: Linha, where: Record<string, unknown>) =>
    Object.entries(where).every(([campo, cond]) => {
      if (cond && typeof cond === 'object' && 'in' in (cond as object)) {
        return ((cond as { in: unknown[] }).in).includes(f[campo]);
      }
      if (cond && typeof cond === 'object' && 'lt' in (cond as object)) {
        return (f[campo] as Date).getTime() < ((cond as { lt: Date }).lt).getTime();
      }
      return f[campo] === cond;
    });
  const aplicar = (f: Linha, data: Record<string, unknown>) => {
    for (const [campo, v] of Object.entries(data)) {
      f[campo] =
        v && typeof v === 'object' && 'increment' in (v as object)
          ? Number(f[campo] ?? 0) + Number((v as { increment: number }).increment)
          : v;
    }
    f.updatedAt = new Date();
  };
  const comTecnico = (f: Linha) => ({ ...f, tecnico: { nome: 'Cleyson Souza', apelido: 'Cleyson' } });

  const prisma = {
    registroDeOs: {
      findUnique: jest.fn(async () => {
        const f = finalizacoes[0];
        return { ...registro, itens: [], finalizacao: f ? comTecnico(f) : null };
      }),
    },
    finalizacaoDeOs: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const nova: Linha = {
          id: 'fin1',
          tentativas: 0,
          gravadoEm: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
        };
        finalizacoes.push(nova);
        return nova;
      }),
      updateMany: jest.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const achadas = finalizacoes.filter((f) => combina(f, where));
        achadas.forEach((f) => aplicar(f, data));
        return { count: achadas.length };
      }),
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const f = finalizacoes.find((x) => x.id === where.id)!;
        aplicar(f, data);
        return comTecnico(f);
      }),
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) => {
        const f = finalizacoes.find((x) => x.id === where.id);
        return f ? { ...f, registro } : null;
      }),
      findUniqueOrThrow: jest.fn(async ({ where }: { where: { id?: string; registroId?: string } }) =>
        comTecnico(finalizacoes.find((x) => (where.id ? x.id === where.id : x.registroId === where.registroId))!),
      ),
      deleteMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const antes = finalizacoes.length;
        for (let k = finalizacoes.length - 1; k >= 0; k--) {
          if (combina(finalizacoes[k], where)) finalizacoes.splice(k, 1);
        }
        return { count: antes - finalizacoes.length };
      }),
    },
    itemDeOs: { findMany: jest.fn(async () => itensDepois) },
    funcionario: { findUnique: jest.fn(async () => ({ nome: 'Cleyson Souza', apelido: 'Cleyson' })) },
  };

  const ixc = {
    action: jest.fn(async (recurso: string, corpo: Record<string, unknown>) => {
      ordem.push(recurso);
      ixcOs.status = 'F';
      return { type: 'success', corpo };
    }),
    upload: jest.fn(
      async (recurso: string, _campo: string, _arquivo: unknown, campos: Record<string, string>) => {
        ordem.push(recurso);
        const id = 500 + arquivosNoIxc.length;
        arquivosNoIxc.push({
          id,
          osId: Number(campos.id_oss_chamado),
          descricao: campos.descricao,
          classificacao: campos.classificacao_arquivo,
        });
        return { type: 'success', id: String(id) };
      },
    ),
  };
  const doIxc = {
    os: jest.fn(async () => {
      if (ixcOs.falhaAoReler) throw new ServiceUnavailableException('IXC fora do ar');
      return { ...OS, status: ixcOs.status };
    }),
    assunto: jest.fn(async () => opcoes.assunto ?? ASSUNTO),
    respostas: jest.fn(async () => [{ id: 12, nome: 'Concluída', texto: 'Serviço concluído.', setorId: 0 }]),
    diagnosticos: jest.fn(async () => [{ id: 5, nome: 'ONU queimada', texto: null, setorId: 0 }]),
    comodatosDaOs: jest.fn(async () => [{ id: 7001, patrimonioId: 9 }]),
    materiaisDaOs: jest.fn(async () => []),
    arquivosDaOs: jest.fn(async () => [...arquivosNoIxc]),
  };
  const osService = {
    contexto: jest.fn(async () => ({ tecnico: TECNICO, os: { ...OS, status: ixcOs.status } })),
    registroDaOs: jest.fn(async () => registro),
    executar: jest.fn(async () => {
      ordem.push('itens');
      return { gravados: 2, falharam: 0, conferir: 0, avisos: 0 };
    }),
  };

  const service = new FinalizacaoService(
    prisma as never,
    ixc as never,
    doIxc as never,
    osService as never,
  );
  return { service, prisma, ixc, doIxc, osService, finalizacoes, itensDepois, ixcOs, ordem, arquivosNoIxc };
}

describe('FinalizacaoService.finalizar', () => {
  it('leva os itens antes e fecha a OS com o técnico, o relato e a comissão do assunto', async () => {
    const t = montar();
    const r = await t.service.finalizar(login, OS.id, PEDIDO);

    expect(t.ordem).toEqual(['itens', 'su_oss_chamado_fechar']);
    expect(t.osService.executar).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'r1' }),
      expect.objectContaining({ id: OS.id }),
      { tecnicoId: 'f-cleyson' },
      'cleyson',
    );
    const corpo = t.ixc.action.mock.calls[0][1];
    expect(corpo).toMatchObject({
      id_chamado: '3788',
      id_tecnico: '17',
      status: 'F',
      id_resposta: '12',
      gera_comissao: 'S',
      mensagem: 'Troquei a ONU queimada, sinal -19 dBm.\n\n— Finalizada pelo celular por Cleyson.',
      latitude: '-12.9714000',
    });
    expect(r.finalizacao).toMatchObject({ situacao: 'GRAVADO', resposta: 'Concluída', aviso: null, tentativas: 1 });
    expect(r.itens.gravados).toBe(2);
  });

  it('o item que não foi ao IXC segura o fechamento: a finalização espera, com o motivo', async () => {
    const t = montar();
    t.itensDepois.push({ situacao: 'FALHOU' });
    const r = await t.service.finalizar(login, OS.id, PEDIDO);

    expect(t.ixc.action).not.toHaveBeenCalled();
    expect(r.finalizacao.situacao).toBe('PENDENTE');
    expect(r.finalizacao.erro).toMatch(/1 item\(ns\) recusado\(s\) pelo IXC/);

    // A base acerta o item, e manda a finalização de novo — agora fecha.
    t.itensDepois.length = 0;
    const depois = await t.service.levarPelaBase('fin1', { nome: 'Base' });
    expect(t.osService.executar).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), {}, 'Base');
    expect(depois.finalizacao.situacao).toBe('GRAVADO');
  });

  it('o IXC responde erro mas a OS fechou: finalizada, com aviso', async () => {
    const t = montar();
    t.ixc.action.mockImplementationOnce(async () => {
      t.ixcOs.status = 'F';
      throw new ServiceUnavailableException('IXC (/su_oss_chamado_fechar): Erro inesperado');
    });
    const r = await t.service.finalizar(login, OS.id, PEDIDO);
    expect(r.finalizacao.situacao).toBe('GRAVADO');
    expect(r.finalizacao.aviso).toMatch(/respondeu erro.*relida a OS está finalizada/);
  });

  it('o IXC recusa e a OS continua aberta: recusada, e o técnico pode mandar de novo', async () => {
    const t = montar();
    t.ixc.action.mockImplementationOnce(async () => {
      throw new ServiceUnavailableException('IXC (/su_oss_chamado_fechar): Diagnóstico obrigatório');
    });
    const r = await t.service.finalizar(login, OS.id, PEDIDO);
    expect(r.finalizacao.situacao).toBe('FALHOU');
    expect(r.finalizacao.erro).toMatch(/Diagnóstico obrigatório/);

    const segunda = await t.service.finalizar(login, OS.id, { ...PEDIDO, relato: 'Troquei a ONU, de novo.' });
    expect(segunda.finalizacao).toMatchObject({ situacao: 'GRAVADO', relato: 'Troquei a ONU, de novo.', tentativas: 2 });
    expect(t.prisma.finalizacaoDeOs.create).toHaveBeenCalledTimes(1);
  });

  it('erro e releitura que falha: vai para a base conferir, e o técnico não repete', async () => {
    const t = montar();
    t.ixc.action.mockImplementationOnce(async () => {
      t.ixcOs.falhaAoReler = true;
      throw new ServiceUnavailableException('Não foi possível contatar o IXC');
    });
    const r = await t.service.finalizar(login, OS.id, PEDIDO);
    expect(r.finalizacao.situacao).toBe('CONFERIR');
    expect(r.finalizacao.erro).toMatch(/Confira lá antes de repetir/);

    t.ixcOs.falhaAoReler = false;
    await expect(t.service.finalizar(login, OS.id, PEDIDO)).rejects.toThrow(/esperando a base conferir/);
    await expect(t.service.levarPelaBase('fin1', { nome: 'Base' })).rejects.toThrow(/não está esperando envio/);

    const conferida = await t.service.resolverConferencia('fin1', true, { nome: 'Base' });
    expect(conferida).toMatchObject({ situacao: 'GRAVADO' });
    expect(conferida.aviso).toMatch(/Conferido no IXC por Base: a OS fechou/);
    expect(t.ixc.action).toHaveBeenCalledTimes(1);
  });

  it('a OS que o atendimento fechou no meio não se fecha de novo', async () => {
    const t = montar();
    // Fechada entre a conferência do pedido e o envio.
    t.osService.executar.mockImplementationOnce(async () => {
      t.ixcOs.status = 'F';
      return { gravados: 0, falharam: 0, conferir: 0, avisos: 0 };
    });
    const r = await t.service.finalizar(login, OS.id, PEDIDO);
    expect(t.ixc.action).not.toHaveBeenCalled();
    expect(r.finalizacao.situacao).toBe('GRAVADO');
    expect(r.finalizacao.aviso).toMatch(/já estava finalizada no IXC/);
  });

  it('a OS já finalizada recusa antes de guardar', async () => {
    const fechada = montar();
    fechada.ixcOs.status = 'F';
    await expect(fechada.service.finalizar(login, OS.id, PEDIDO)).rejects.toThrow(/já está finalizada/);
    expect(fechada.finalizacoes).toHaveLength(0);
  });

  it('as fotos que o assunto exige contam o que está na aba "Arquivos" da OS no IXC', async () => {
    const t = montar({ assunto: { ...ASSUNTO, fotosExigidas: 2 } });
    await t.service.anexarFoto(login, OS.id, { foto: FOTO, descricao: 'Sinal na ONU' });
    await expect(t.service.finalizar(login, OS.id, PEDIDO)).rejects.toThrow(/exige 2 fotos.*tem 1 no IXC/);
    expect(t.finalizacoes).toHaveLength(0);
    expect(t.doIxc.arquivosDaOs).toHaveBeenCalledWith(OS.id);

    await t.service.anexarFoto(login, OS.id, { foto: FOTO, descricao: 'Caixa CTO' });
    const r = await t.service.finalizar(login, OS.id, PEDIDO);
    expect(r.finalizacao.situacao).toBe('GRAVADO');
  });

  it('o assunto que não exige foto não lê os arquivos da OS', async () => {
    const t = montar();
    await t.service.finalizar(login, OS.id, PEDIDO);
    expect(t.doIxc.arquivosDaOs).not.toHaveBeenCalled();
  });

  it('o aparelho que o assunto exige conta o que já está na OS no IXC', async () => {
    const t = montar({ assunto: { ...ASSUNTO, aparelhosExigidos: 2 } });
    await expect(t.service.finalizar(login, OS.id, PEDIDO)).rejects.toThrow(/2 aparelho\(s\).*tem 1/);
    expect(t.doIxc.comodatosDaOs).toHaveBeenCalledWith(OS.id);
    // O assunto que não exige produto não lê os produtos da OS.
    expect(t.doIxc.materiaisDaOs).not.toHaveBeenCalled();
  });
});

describe('FinalizacaoService.anexarFoto', () => {
  it('manda a foto direto à aba "Arquivos" da OS no IXC, com a descrição, sem guardar nada aqui', async () => {
    const t = montar();
    const r = await t.service.anexarFoto(login, OS.id, { foto: FOTO, descricao: '  Sinal -19 dBm na ONU ' });

    const [recurso, campo, arquivo, campos] = t.ixc.upload.mock.calls[0];
    expect(recurso).toBe('su_oss_chamado_arquivos');
    expect(campo).toBe('local_arquivo');
    expect(arquivo).toMatchObject({ tipo: 'image/jpeg', nome: expect.stringMatching(/^os-3788-\d+\.jpg$/) });
    expect(campos).toEqual({
      id_oss_chamado: '3788',
      descricao: 'Sinal -19 dBm na ONU',
      classificacao_arquivo: 'P',
    });
    expect(r).toEqual({ id: 500, osId: 3788, descricao: 'Sinal -19 dBm na ONU', classificacao: 'P' });
    // Nada no banco daqui: nem finalização, nem foto.
    expect(t.prisma.finalizacaoDeOs.create).not.toHaveBeenCalled();
    expect(t.prisma.finalizacaoDeOs.updateMany).not.toHaveBeenCalled();
  });

  it('cada foto vai com a sua descrição, e a que veio sem ganha uma', async () => {
    const t = montar();
    await t.service.anexarFoto(login, OS.id, { foto: FOTO, descricao: 'Caixa CTO' });
    await t.service.anexarFoto(login, OS.id, { foto: FOTO });
    expect(t.arquivosNoIxc.map((a) => a.descricao)).toEqual(['Caixa CTO', 'Foto do serviço']);
  });

  it('o que não é foto, e a OS já finalizada, não vão', async () => {
    const t = montar();
    const pdf = 'data:application/pdf;base64,' + Buffer.from('%PDF-1.4').toString('base64');
    await expect(t.service.anexarFoto(login, OS.id, { foto: pdf })).rejects.toThrow(BadRequestException);

    t.ixcOs.status = 'F';
    await expect(t.service.anexarFoto(login, OS.id, { foto: FOTO })).rejects.toThrow(/já está finalizada/);
    expect(t.ixc.upload).not.toHaveBeenCalled();
  });

  it('o IXC que recusa o anexo responde o motivo ao técnico', async () => {
    const t = montar();
    t.ixc.upload.mockRejectedValueOnce(new ServiceUnavailableException('IXC (/su_oss_chamado_arquivos): fora'));
    await expect(t.service.anexarFoto(login, OS.id, { foto: FOTO })).rejects.toThrow(/fora/);
  });
});

describe('a assinatura do cliente', () => {
  const ASSINATURA = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]).toString('base64');

  it('vai direto à aba "Arquivos" da OS como a do app do IXC: classificação A, com o nome de quem assinou', async () => {
    const t = montar();
    const r = await t.service.anexarAssinatura(login, OS.id, { assinatura: ASSINATURA, nome: ' Maria da Silva ' });

    const [recurso, campo, arquivo, campos] = t.ixc.upload.mock.calls[0];
    expect(recurso).toBe('su_oss_chamado_arquivos');
    expect(campo).toBe('local_arquivo');
    expect(arquivo).toMatchObject({ tipo: 'image/png', nome: expect.stringMatching(/^os-3788-assinatura-\d+\.png$/) });
    expect(campos).toEqual({
      id_oss_chamado: '3788',
      descricao: 'Assinatura do Cliente — Maria da Silva',
      classificacao_arquivo: 'A',
    });
    expect(r).toMatchObject({ classificacao: 'A', descricao: 'Assinatura do Cliente — Maria da Silva' });
    expect(t.prisma.finalizacaoDeOs.create).not.toHaveBeenCalled();
  });

  it('o assunto que exige assinatura não fecha sem ela nos arquivos da OS', async () => {
    const t = montar({ assunto: { ...ASSUNTO, assinaturaObrigatoria: true } });
    await expect(
      t.service.finalizar(login, OS.id, { ...PEDIDO, semAssinatura: 'Não estava em casa' }),
    ).rejects.toThrow(/exige a assinatura do cliente/);
    expect(t.finalizacoes).toHaveLength(0);

    await t.service.anexarAssinatura(login, OS.id, { assinatura: ASSINATURA, nome: 'Maria da Silva' });
    const r = await t.service.finalizar(login, OS.id, { ...PEDIDO, assinadaPor: 'Maria da Silva' });
    expect(r.finalizacao).toMatchObject({ situacao: 'GRAVADO', assinadaPor: 'Maria da Silva', semAssinatura: null });
    expect(t.ixc.action.mock.calls[0][1].mensagem).toBe(
      'Troquei a ONU queimada, sinal -19 dBm.\n\n' +
        'Assinada por Maria da Silva — a assinatura está nos arquivos da OS.\n' +
        '— Finalizada pelo celular por Cleyson.',
    );
  });

  it('a assinatura que o app do IXC já pôs na OS vale', async () => {
    const t = montar({ assunto: { ...ASSUNTO, assinaturaObrigatoria: true } });
    t.arquivosNoIxc.push({ id: 242347, osId: OS.id, descricao: 'Assinatura do Cliente', classificacao: 'A' });
    const r = await t.service.finalizar(login, OS.id, { ...PEDIDO, assinadaPor: 'Maria da Silva' });
    expect(r.finalizacao.situacao).toBe('GRAVADO');
  });

  it('no assunto que não exige, o motivo de não ter assinado vai na mensagem', async () => {
    const t = montar();
    const r = await t.service.finalizar(login, OS.id, { ...PEDIDO, semAssinatura: 'Não estava em casa' });
    expect(r.finalizacao).toMatchObject({ assinadaPor: null, semAssinatura: 'Não estava em casa' });
    expect(t.ixc.action.mock.calls[0][1].mensagem).toMatch(/O cliente não assinou: Não estava em casa\.\n— Finalizada/);
    // Nada a conferir no IXC: o assunto não exige, e ninguém disse que assinou.
    expect(t.doIxc.arquivosDaOs).not.toHaveBeenCalled();
  });

  it('a assinatura não conta como foto', async () => {
    const t = montar({ assunto: { ...ASSUNTO, fotosExigidas: 1 } });
    await t.service.anexarAssinatura(login, OS.id, { assinatura: ASSINATURA, nome: 'Maria da Silva' });
    await expect(t.service.finalizar(login, OS.id, PEDIDO)).rejects.toThrow(/exige 1 foto.*tem nenhuma/);
  });
});

describe('FinalizacaoService.paraFinalizar', () => {
  it('sugere a resposta padrão do assunto e diz quantas fotos ele exige', async () => {
    const t = montar({ assunto: { ...ASSUNTO, fotosExigidas: 1 } });
    const para = await t.service.paraFinalizar(login, OS.id);
    expect(para.sugestao.respostaId).toBe(12);
    expect(para.respostas).toEqual([{ id: 12, nome: 'Concluída', texto: 'Serviço concluído.' }]);
    expect(para.assunto.fotosExigidas).toBe(1);
    expect(para.recusa).toBeNull();
  });

  it('diz por que não dá quando o assunto exige a equipe', async () => {
    const t = montar({ assunto: { ...ASSUNTO, equipeObrigatoria: true } });
    const para = await t.service.paraFinalizar(login, OS.id);
    expect(para.recusa).toMatch(/exige a equipe.*pelo IXC/);
  });
});
