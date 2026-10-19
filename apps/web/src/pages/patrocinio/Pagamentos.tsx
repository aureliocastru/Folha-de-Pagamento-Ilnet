import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { mesAnterior, mesAtual, mesSeguinte } from '../../lib/folha';
import { formatBRL, formatData } from '../../lib/format';
import type { LinhaDosPagamentos, PagamentosDoPatrocinio } from '../../lib/types';
import { SeloDoMes, SeloDoPagamento, mesPorExtenso } from './comum';
import { PagarPatrocinado, usePodePagar } from './Pagar';

/**
 * Os pagamentos dos patrocinados, mês a mês: quanto se combinou com cada um,
 * quanto já saiu, o que está lançado esperando, e quem falta pagar — com o
 * botão de pagar na linha.
 *
 * Tudo é lido dos títulos do fornecedor de cada um no IXC: o que se lança por
 * aqui e o que alguém lançou direto lá entram do mesmo jeito. O título conta
 * no mês do vencimento dele.
 */
export function Pagamentos() {
  const navigate = useNavigate();
  const podePagar = usePodePagar();
  const [mes, setMes] = useState(mesAtual);
  const [pagando, setPagando] = useState<LinhaDosPagamentos | null>(null);

  const dados = useQuery({
    queryKey: ['patrocinio-pagamentos', mes],
    queryFn: async () =>
      (await api.get<PagamentosDoPatrocinio>('/patrocinios/pagamentos', { params: { mes } })).data,
  });

  const linhas = dados.data?.linhas ?? [];
  const totais = dados.data?.totais;
  const doMes = linhas
    .flatMap((l) => l.mes.pagamentos.map((pg) => ({ pg, quem: l.patrocinado })))
    .sort((a, b) => (b.pg.vencimento ?? '').localeCompare(a.pg.vencimento ?? ''));

  return (
    <Pagina>
      <CabecalhoPagina secao="Patrocínios" titulo="Pagamentos" />

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={() => setMes(mesAnterior(mes))}
          className="btn btn-neutro btn-p"
          aria-label="Mês anterior"
        >
          ‹
        </button>
        <span className="inline-block min-w-[150px] text-center text-sm font-semibold text-tinta-800 first-letter:uppercase">
          {mesPorExtenso(mes)}
        </span>
        <button
          type="button"
          onClick={() => setMes(mesSeguinte(mes))}
          className="btn btn-neutro btn-p"
          aria-label="Próximo mês"
        >
          ›
        </button>
        {mes !== mesAtual() && (
          <button type="button" onClick={() => setMes(mesAtual())} className="btn btn-neutro btn-p ml-1">
            Este mês
          </button>
        )}
      </div>

      {!podePagar && (
        <Aviso tom="neutro">
          Para pagar daqui é preciso abrir o Contas a Pagar — peça a um administrador. Por aqui dá para
          ver o que já saiu.
        </Aviso>
      )}

      <div className="surgir mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Numero rotulo="Combinado no mês" valor={totais ? formatBRL(totais.combinado) : '…'} />
        <Numero rotulo="Já pago" valor={totais ? formatBRL(totais.pago) : '…'} />
        <Numero
          rotulo="Em aberto"
          valor={totais ? formatBRL(totais.emAberto) : '…'}
          nota="Lançado no IXC, esperando ser pago"
        />
        <Numero
          rotulo="Falta pagar"
          valor={totais ? String(totais.faltam) : '…'}
          nota="patrocinado(s)"
          alerta={!!totais && totais.faltam > 0}
        />
      </div>

      <Bloco className="surgir surgir-2" semPadding>
        <div className="overflow-x-auto rolagem-fina">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Patrocinado</th>
                <th className="th text-right">Por mês</th>
                <th className="th text-right">Pago no mês</th>
                <th className="th text-right">Em aberto</th>
                <th className="th">Situação</th>
                <th className="th text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {dados.isLoading && (
                <tr>
                  <td colSpan={6}>
                    <Carregando texto="Lendo os títulos no IXC…" />
                  </td>
                </tr>
              )}
              {dados.isError && (
                <tr>
                  <td colSpan={6}>
                    <Vazio titulo="Não deu para carregar">{mensagemErro(dados.error)}</Vazio>
                  </td>
                </tr>
              )}
              {dados.data && linhas.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <Vazio titulo="Nenhum patrocinado ativo">
                      Cadastre os patrocinados na aba Patrocinados, cada um ligado ao fornecedor dele no
                      IXC.
                    </Vazio>
                  </td>
                </tr>
              )}
              {linhas.map((l) => {
                const p = l.patrocinado;
                const combinado = Number(p.valorMensal ?? 0);
                return (
                  <tr
                    key={p.id}
                    onClick={() => navigate(`/patrocinio/patrocinados/${p.id}`)}
                    className="linha cursor-pointer"
                  >
                    <td className="td">
                      <div className="font-medium text-tinta-900">{p.nome}</div>
                      <div className="text-xs text-tinta-500">
                        {p.fornecedorNome ?? (
                          <Selo tom="erro" pequeno titulo="Não está ligado a nenhum fornecedor do IXC">
                            sem fornecedor
                          </Selo>
                        )}
                      </div>
                    </td>
                    <td className="td text-right text-tinta-500">
                      {combinado > 0 ? <span className="valor">{formatBRL(combinado)}</span> : '—'}
                    </td>
                    <td className="td text-right">
                      {l.mes.pago > 0 ? <span className="valor">{formatBRL(l.mes.pago)}</span> : '—'}
                    </td>
                    <td className="td text-right">
                      {l.mes.emAberto > 0 ? (
                        <span className="valor text-amber-600">{formatBRL(l.mes.emAberto)}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="td">
                      {l.erro ? (
                        <span className="text-xs text-rose-600" title={l.erro}>
                          não deu para ler o IXC
                        </span>
                      ) : (
                        <SeloDoMes situacao={l.situacao} />
                      )}
                    </td>
                    <td className="td text-right">
                      {podePagar && p.idFornecedorIxc && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPagando(l);
                          }}
                          className={`btn btn-p ${l.situacao === 'FALTA' || l.situacao === 'PARCIAL' ? 'btn-pagar' : 'btn-neutro'}`}
                        >
                          Pagar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Bloco>

      {doMes.length > 0 && (
        <Bloco titulo={`Títulos de ${mesPorExtenso(mes)}`} className="surgir surgir-3 mt-4" semPadding>
          <div className="overflow-x-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Patrocinado</th>
                  <th className="th">Vencimento</th>
                  <th className="th">Pago em</th>
                  <th className="th">Descrição</th>
                  <th className="th">Situação</th>
                  <th className="th text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {doMes.map(({ pg, quem }) => (
                  <tr key={pg.idFnApagar} className="linha">
                    <td className="td font-medium text-tinta-900">{quem.nome}</td>
                    <td className="td num text-tinta-600">{pg.vencimento ? formatData(pg.vencimento) : '—'}</td>
                    <td className="td num text-tinta-600">{pg.pagoEm ? formatData(pg.pagoEm) : '—'}</td>
                    <td className="td text-tinta-800">
                      {pg.descricao || '—'}
                      <div className="num text-xs text-tinta-400">título nº {pg.idFnApagar}</div>
                    </td>
                    <td className="td">
                      <SeloDoPagamento situacao={pg.situacao} />
                    </td>
                    <td className="td text-right">
                      <span className="valor">{formatBRL(pg.valor)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Bloco>
      )}

      {pagando && (
        <PagarPatrocinado
          patrocinado={pagando.patrocinado}
          mes={mes}
          valor={faltaNoMes(pagando)}
          onFechar={() => setPagando(null)}
        />
      )}
    </Pagina>
  );
}

/**
 * O que falta no mês: o combinado menos o que já saiu ou está lançado. Já
 * coberto, sugere o combinado inteiro.
 */
function faltaNoMes(l: LinhaDosPagamentos): number | null {
  const combinado = Number(l.patrocinado.valorMensal ?? 0);
  if (combinado <= 0) return null;
  const falta = Math.round((combinado - l.mes.pago - l.mes.emAberto) * 100) / 100;
  return falta > 0 ? falta : combinado;
}

function Numero({
  rotulo,
  valor,
  nota,
  alerta = false,
}: {
  rotulo: string;
  valor: string;
  nota?: string;
  alerta?: boolean;
}) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs text-tinta-500">{rotulo}</div>
      <div className={`valor mt-0.5 text-lg ${alerta ? 'text-amber-600' : 'text-tinta-900'}`}>{valor}</div>
      {nota && <div className="text-xs text-tinta-400">{nota}</div>}
    </div>
  );
}
