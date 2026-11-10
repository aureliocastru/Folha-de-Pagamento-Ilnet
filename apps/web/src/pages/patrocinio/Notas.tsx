import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Aviso, Bloco, CabecalhoPagina, Carregando, Pagina, Vazio } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatBRL, formatData } from '../../lib/format';
import type { NotaNaAba, NotasDoPatrocinio, SituacaoDaNota } from '../../lib/types';
import { formatDataHora } from './comum';
import { ColetarNota, SeloDaNota, notaVencida, useAbrirNota, useRecarregarNotas } from './ColetarNota';

const ABAS: Array<{ id: SituacaoDaNota; nome: string; vazio: string }> = [
  {
    id: 'A_BAIXAR',
    nome: 'A dar baixa',
    vazio:
      'Nenhuma nota esperando. Quando o patrocinado assinar a nota de um pagamento, ela aparece aqui para ser conferida.',
  },
  {
    id: 'AGUARDANDO',
    nome: 'Aguardando assinatura',
    vazio: 'Nenhum link de nota aberto. Peça a assinatura na linha do pagamento — na ficha do patrocinado ou na aba Pagamentos.',
  },
  { id: 'BAIXADAS', nome: 'Baixadas', vazio: 'Nenhuma nota baixada ainda.' },
];

/**
 * As notas de recebimento dos patrocinados: as assinadas esperando a baixa, os
 * links que ainda ninguém assinou, e as já baixadas.
 *
 * Dar baixa é conferir a nota assinada e arquivá-la. O título no IXC não é
 * tocado — o pagamento continua sendo do Contas a Pagar.
 */
export function Notas() {
  const [aba, setAba] = useState<SituacaoDaNota>('A_BAIXAR');
  const [coletando, setColetando] = useState<NotaNaAba | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const recarregar = useRecarregarNotas();

  const dados = useQuery({
    queryKey: ['patrocinio-notas', aba],
    queryFn: async () =>
      (await api.get<NotasDoPatrocinio>('/patrocinios/notas', { params: { situacao: aba } })).data,
  });

  const baixar = useMutation({
    mutationFn: async (n: NotaNaAba) => (await api.post(`/patrocinios/notas/${n.id}/baixa`)).data,
    onSuccess: () => {
      setErro(null);
      recarregar();
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const desfazer = useMutation({
    mutationFn: async (n: NotaNaAba) => (await api.delete(`/patrocinios/notas/${n.id}/baixa`)).data,
    onSuccess: () => {
      setErro(null);
      recarregar();
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const cancelar = useMutation({
    mutationFn: async (n: NotaNaAba) => (await api.delete(`/patrocinios/notas/${n.id}`)).data,
    onSuccess: () => {
      setErro(null);
      recarregar();
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const abrir = useAbrirNota(setErro);

  const notas = dados.data?.notas ?? [];
  const contagem = dados.data?.contagem;
  const definicao = ABAS.find((a) => a.id === aba)!;
  const total = notas.reduce((t, n) => t + Number(n.valor), 0);

  return (
    <Pagina>
      <CabecalhoPagina secao="Patrocínios" titulo="Notas de recebimento" />

      <p className="mb-4 max-w-3xl text-sm text-tinta-500">
        A cada pagamento, o patrocinado assina pelo celular que recebeu o dinheiro. A nota assinada cai
        aqui: confira e dê baixa. A baixa não mexe no título do IXC.
      </p>

      <div className="mb-4 flex flex-wrap gap-1.5" role="tablist">
        {ABAS.map((a) => {
          const ativa = a.id === aba;
          const quantas = contagem?.[a.id];
          return (
            <button
              key={a.id}
              role="tab"
              aria-selected={ativa}
              onClick={() => setAba(a.id)}
              className={`btn btn-p ${ativa ? 'btn-primario' : 'btn-neutro'}`}
            >
              {a.nome}
              {quantas !== undefined && ` (${quantas})`}
            </button>
          );
        })}
      </div>

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <Bloco className="surgir" semPadding>
        <div className="overflow-x-auto rolagem-fina">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Patrocinado</th>
                <th className="th">Referente a</th>
                <th className="th text-right">Valor</th>
                <th className="th">{aba === 'AGUARDANDO' ? 'Link' : 'Assinada'}</th>
                {aba === 'BAIXADAS' && <th className="th">Baixa</th>}
                <th className="th text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {dados.isLoading && (
                <tr>
                  <td colSpan={6}>
                    <Carregando />
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
              {dados.data && notas.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <Vazio titulo="Nada por aqui">{definicao.vazio}</Vazio>
                  </td>
                </tr>
              )}
              {notas.map((n) => (
                <tr key={n.id} className="linha">
                  <td className="td">
                    <Link
                      to={`/patrocinio/patrocinados/${n.patrocinado.id}`}
                      className="font-medium text-tinta-900 hover:underline"
                    >
                      {n.patrocinado.nome}
                    </Link>
                    {n.patrocinado.responsavel && (
                      <div className="text-xs text-tinta-400">{n.patrocinado.responsavel}</div>
                    )}
                  </td>
                  <td className="td text-tinta-800">
                    {n.referente}
                    <div className="num text-xs text-tinta-400">
                      título nº {n.idFnApagar}
                      {n.pagoEm ? ` · pago em ${formatData(n.pagoEm)}` : n.vencimento ? ` · vence ${formatData(n.vencimento)}` : ''}
                    </div>
                  </td>
                  <td className="td text-right">
                    <span className="valor">{formatBRL(n.valor)}</span>
                  </td>
                  <td className="td">
                    {n.assinadoEm ? (
                      <>
                        <div className="num text-tinta-700">{formatDataHora(n.assinadoEm)}</div>
                        <div className="text-xs text-tinta-400">
                          {n.nomeAssinante}
                          {n.modo === 'DIGITADA' && ' · assinatura gerada do nome'}
                        </div>
                      </>
                    ) : (
                      <>
                        <SeloDaNota nota={n} />
                        <div className="num mt-0.5 text-xs text-tinta-400">
                          {notaVencida(n) ? 'venceu em' : 'vale até'} {formatDataHora(n.expiraEm)}
                        </div>
                      </>
                    )}
                  </td>
                  {aba === 'BAIXADAS' && (
                    <td className="td">
                      <div className="num text-tinta-700">{n.baixadaEm ? formatDataHora(n.baixadaEm) : '—'}</div>
                      {n.baixadaPor && <div className="text-xs text-tinta-400">{n.baixadaPor}</div>}
                    </td>
                  )}
                  <td className="td text-right">
                    <div className="flex flex-wrap justify-end gap-1.5">
                      {n.assinadoEm && (
                        <button onClick={() => abrir.mutate(n)} disabled={abrir.isPending} className="btn btn-p btn-neutro">
                          Ver nota
                        </button>
                      )}
                      {aba === 'A_BAIXAR' && (
                        <button
                          onClick={() => baixar.mutate(n)}
                          disabled={baixar.isPending}
                          className="btn btn-p btn-primario"
                        >
                          Dar baixa
                        </button>
                      )}
                      {aba === 'BAIXADAS' && (
                        <button
                          onClick={() => {
                            if (confirm(`Desfazer a baixa da nota de ${n.patrocinado.nome}? Ela volta para "A dar baixa".`)) {
                              desfazer.mutate(n);
                            }
                          }}
                          disabled={desfazer.isPending}
                          className="btn btn-p btn-sutil"
                        >
                          Desfazer baixa
                        </button>
                      )}
                      {aba === 'AGUARDANDO' && !notaVencida(n) && (
                        <button onClick={() => setColetando(n)} className="btn btn-p btn-neutro">
                          Ver link
                        </button>
                      )}
                      {aba === 'AGUARDANDO' && (
                        <button
                          onClick={() => {
                            if (confirm('Cancelar este link? Dá para pedir outro na linha do pagamento.')) {
                              cancelar.mutate(n);
                            }
                          }}
                          disabled={cancelar.isPending}
                          className="btn btn-p btn-perigo"
                        >
                          Cancelar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            {notas.length > 1 && (
              <tfoot>
                <tr>
                  <td className="td text-xs text-tinta-500" colSpan={2}>
                    {notas.length} nota(s)
                  </td>
                  <td className="td text-right">
                    <span className="valor">{formatBRL(total)}</span>
                  </td>
                  <td colSpan={aba === 'BAIXADAS' ? 3 : 2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Bloco>

      {aba === 'AGUARDANDO' && notas.some(notaVencida) && (
        <p className="ajuda mt-3">
          Link vencido: cancele aqui e peça outro na linha do pagamento, ou clique em "Gerar novo link" lá.
        </p>
      )}

      {coletando && (
        <ColetarNota
          nota={coletando}
          patrocinado={{ id: coletando.patrocinado.id, nome: coletando.patrocinado.nome, telefone: coletando.patrocinado.telefone }}
          onFechar={() => setColetando(null)}
          onAssinou={recarregar}
        />
      )}
    </Pagina>
  );
}
