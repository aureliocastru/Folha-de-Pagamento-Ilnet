import { conciliar, lerLancamentoDoIxc } from './relatorios/conciliacao';
import { lerOfx, valorDoOfx } from './ofx';
import { escaparXml, letraDaColuna, montarPlanilha, nomesDasAbas, serialDoExcel } from './planilha';
import { lerTudo } from './ixc-leitura';

/**
 * O que entra (o OFX do banco) e o que sai (a planilha), e a conciliação no
 * meio. O que este arquivo protege:
 *
 *  - os dois dialetos do OFX (SGML sem fechar a etiqueta e XML), com vírgula
 *    decimal e acento em Windows-1252;
 *  - a conciliação casa cada lançamento uma vez só, do mais certo ao menos
 *    certo, e devolve o que sobrou dos dois lados;
 *  - a planilha sai com as abas e células que o Excel aceita;
 *  - a leitura do IXC que volta vazia é conferida antes de virar relatório.
 */

const OFX_SGML = Buffer.from(
  [
    'OFXHEADER:100',
    'DATA:OFXSGML',
    'CHARSET:1252',
    '',
    '<OFX>',
    '<BANKMSGSRSV1><STMTTRNRS><STMTRS>',
    '<BANKACCTFROM><BANKID>0237<BRANCHID>0000<ACCTID>00000-0</BANKACCTFROM>',
    '<BANKTRANLIST><DTSTART>20260901<DTEND>20260930',
    '<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260901120000[-3:BRT]<TRNAMT>11043.31<FITID>A1<MEMO>LIQUIDACAO COBRANCA',
    '</STMTTRN>',
    '<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260901<TRNAMT>-96,03<FITID>A2<MEMO>TARIFA COBRAN\xc7A',
    '</STMTTRN>',
    '</BANKTRANLIST>',
    '<LEDGERBAL><BALAMT>1.234,56<DTASOF>20260930</LEDGERBAL>',
    '</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>',
  ].join('\r\n'),
  'latin1',
);

describe('OFX', () => {
  it('lê o SGML do banco, com vírgula decimal e acento em 1252', () => {
    const e = lerOfx(OFX_SGML);
    expect(e).toMatchObject({ banco: '0237', inicio: '2026-09-01', fim: '2026-09-30', saldoFinal: 1234.56, saldoEm: '2026-09-30' });
    expect(e.lancamentos).toEqual([
      { id: 'A1', dia: '2026-09-01', valor: 11043.31, descricao: 'LIQUIDACAO COBRANCA', tipo: 'CREDIT' },
      { id: 'A2', dia: '2026-09-01', valor: -96.03, descricao: 'TARIFA COBRANÇA', tipo: 'DEBIT' },
    ]);
  });

  it('lê o OFX 2, em XML com tudo fechado', () => {
    const xml = Buffer.from(
      '<?xml version="1.0" encoding="UTF-8"?><?OFX OFXHEADER="200"?><OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>' +
        '<BANKTRANLIST><STMTTRN><TRNTYPE>PAYMENT</TRNTYPE><DTPOSTED>20260915</DTPOSTED><TRNAMT>-50000.00</TRNAMT>' +
        '<FITID>X9</FITID><NAME>PIX ENVIADO</NAME><MEMO>Transferência</MEMO></STMTTRN></BANKTRANLIST>' +
        '</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>',
      'utf8',
    );
    expect(lerOfx(xml).lancamentos).toEqual([
      { id: 'X9', dia: '2026-09-15', valor: -50000, descricao: 'PIX ENVIADO — Transferência', tipo: 'PAYMENT' },
    ]);
  });

  it('tira o período dos lançamentos quando o cabeçalho traz o dia em que o arquivo foi gerado', () => {
    const gerado = Buffer.from(
      OFX_SGML.toString('latin1')
        .replace('<DTSTART>20260901<DTEND>20260930', '<DTSTART>20261009120000<DTEND>20261009120000')
        .replace('<DTPOSTED>20260901<TRNAMT>-96,03', '<DTPOSTED>20261009<TRNAMT>-96,03'),
      'latin1',
    );
    expect(lerOfx(gerado)).toMatchObject({ inicio: '2026-09-01', fim: '2026-10-09' });
  });

  it('recusa o que não é OFX', () => {
    expect(() => lerOfx(Buffer.from('%PDF-1.7 extrato'))).toThrow(/não é um extrato OFX/);
  });

  it('entende os jeitos de escrever dinheiro', () => {
    expect(valorDoOfx('-1234.56')).toBe(-1234.56);
    expect(valorDoOfx('1.234,56')).toBe(1234.56);
    expect(valorDoOfx('1,234.56')).toBe(1234.56);
    expect(valorDoOfx('')).toBeNull();
  });
});

describe('conciliação bancária', () => {
  const banco = (id: string, dia: string, valor: number) => ({ id, dia, valor, descricao: id, tipo: '' });
  const ixc = (id: number, dia: string, valor: number) => ({ id, dia, valor, historico: String(id) });

  it('casa por dia e valor, depois por valor com o dia perto, depois pela soma do dia', () => {
    const r = conciliar(
      [
        banco('tarifa', '2026-09-01', -96.03),
        banco('pix', '2026-09-03', -500),
        // O banco lança a cobrança de um dia num valor só.
        banco('cobranca', '2026-09-05', 300),
        banco('sobra', '2026-09-08', 12),
      ],
      [
        ixc(1, '2026-09-01', -96.03),
        ixc(2, '2026-09-02', -500),
        ixc(3, '2026-09-05', 100),
        ixc(4, '2026-09-05', 200),
        ixc(5, '2026-09-09', 7),
      ],
    );
    expect(r.casamentos.map((c) => [c.tipo, c.banco.map((b) => b.id), c.ixc.map((x) => x.id)])).toEqual([
      ['exato', ['tarifa'], [1]],
      ['data proxima', ['pix'], [2]],
      ['soma do dia', ['cobranca'], [3, 4]],
    ]);
    expect(r.soNoBanco.map((b) => b.id)).toEqual(['sobra']);
    expect(r.soNoIxc.map((x) => x.id)).toEqual([5]);
  });

  it('não casa o mesmo lançamento duas vezes', () => {
    const r = conciliar([banco('a', '2026-09-01', 50), banco('b', '2026-09-01', 50)], [ixc(1, '2026-09-01', 50)]);
    expect(r.casamentos).toHaveLength(1);
    expect(r.soNoBanco).toHaveLength(1);
  });

  it('lê o razão do IXC com débito entrando e crédito saindo', () => {
    expect(lerLancamentoDoIxc({ id: '1', data: '2026-09-01', debito: '11043.31', credito: '0.00' })?.valor).toBe(11043.31);
    expect(lerLancamentoDoIxc({ id: '2', data: '2026-09-01', debito: '0.00', credito: '96.03' })?.valor).toBe(-96.03);
    expect(lerLancamentoDoIxc({ id: '3', data: '2026-09-01', debito: '0.00', credito: '0.00' })).toBeNull();
  });
});

describe('planilha', () => {
  it('escreve o que o Excel aceita', async () => {
    expect(letraDaColuna(0)).toBe('A');
    expect(letraDaColuna(25)).toBe('Z');
    expect(letraDaColuna(26)).toBe('AA');
    expect(serialDoExcel('2026-09-30')).toBe(46295);
    expect(serialDoExcel(new Date('2026-09-30T00:00:00Z'))).toBe(46295);
    expect(escaparXml('A & B <c> "d"\u0001')).toBe('A &amp; B &lt;c&gt; &quot;d&quot;');
    expect(nomesDasAbas(['Resumo', 'resumo', 'Uma aba com um nome comprido demais aqui', 'a/b'])).toEqual([
      'Resumo',
      'resumo (2)',
      'Uma aba com um nome comprido de',
      'a-b',
    ]);

    const xlsx = await montarPlanilha([
      {
        nome: 'Teste',
        cabecalho: ['Título'],
        colunas: [
          { titulo: 'Data', tipo: 'data' },
          { titulo: 'Nome', tipo: 'texto' },
          { titulo: 'Valor', tipo: 'moeda' },
        ],
        linhas: [['2026-09-30', 'Ana & Cia', 10.005]],
        totais: ['Total', '', 10.01],
      },
    ]);
    // Um zip ("PK") com o livro e a aba dentro.
    expect(xlsx.subarray(0, 2).toString('latin1')).toBe('PK');
    const texto = xlsx.toString('latin1');
    expect(texto).toContain('xl/worksheets/sheet1.xml');
    expect(texto).toContain('xl/styles.xml');
  });
});

describe('a leitura do IXC que volta vazia', () => {
  it('confere sem o filtro e recusa quando a tabela inteira também vem vazia', async () => {
    const ixc = { list: jest.fn().mockResolvedValue({ total: 0, page: 1, registros: [] }) };
    await expect(
      lerTudo(ixc as any, { tabela: 'fn_areceber_baixas', qtype: 'fn_movim_finan.id_receber', query: '0', oper: '>', sortname: 'fn_areceber_baixas.id' }),
    ).rejects.toThrow(/vazia até sem filtro/);
    // A segunda pergunta é a sonda: a mesma, sem o grid, um registro só.
    expect(ixc.list).toHaveBeenCalledTimes(2);
    expect(ixc.list.mock.calls[1][1]).toMatchObject({ rp: 1 });
    expect(ixc.list.mock.calls[1][1].gridParam).toBeUndefined();
  });

  it('aceita o vazio quando a tabela tem registros e só o período não tem', async () => {
    const ixc = {
      list: jest
        .fn()
        .mockResolvedValueOnce({ total: 0, page: 1, registros: [] })
        .mockResolvedValueOnce({ total: 1669357, page: 1, registros: [{ id: '1' }] }),
    };
    await expect(
      lerTudo(ixc as any, { tabela: 'fn_movim_finan', qtype: 'fn_movim_finan.id', query: '0', oper: '>', sortname: 'fn_movim_finan.id', grid: [{ TB: 'fn_movim_finan.data', OP: 'BE', P: '2030-01-01', P2: '2030-01-31' }] }),
    ).resolves.toEqual([]);
  });

  it('lê página por página até a última', async () => {
    const pagina = (n: number) => ({ total: 2500, page: 1, registros: Array.from({ length: n }, (_, i) => ({ id: String(i) })) });
    const ixc = { list: jest.fn().mockResolvedValueOnce(pagina(1000)).mockResolvedValueOnce(pagina(1000)).mockResolvedValueOnce(pagina(500)) };
    const lidos = await lerTudo(ixc as any, { tabela: 'fn_areceber', qtype: 'fn_areceber.id', query: '0', oper: '>', sortname: 'fn_areceber.id' });
    expect(lidos).toHaveLength(2500);
    expect(ixc.list.mock.calls.map((c) => c[1].page)).toEqual([1, 2, 3]);
  });
});
