import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bloco,
  CabecalhoPagina,
  Carregando,
  Janela,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { mesAtual } from '../../lib/folha';
import { formatBRL, formatData } from '../../lib/format';
import type {
  PagamentosDoPatrocinio,
  Patrocinado,
  PatrocinadoNaLista,
  ResumoDosPagamentos,
} from '../../lib/types';
import {
  CADASTRO_VAZIO,
  Campo,
  CamposDoPatrocinado,
  EscolherFornecedor,
  SeloDoContrato,
  corpoDoCadastro,
  type Cadastro,
  type FornecedorEscolhido,
} from './comum';

/**
 * Quem a ILNET patrocina: a lista, com o que já se mandou a cada um e onde
 * está o contrato. A ficha de cada um abre por cima da linha.
 *
 * O que já se mandou é lido do IXC e chega depois da lista: é a mesma leitura
 * da aba Pagamentos (e o mesmo cache), e a lista não espera por ela.
 */
export function Patrocinados() {
  const navigate = useNavigate();
  const [busca, setBusca] = useState('');
  const [verInativos, setVerInativos] = useState(false);
  const [novo, setNovo] = useState(false);

  const lista = useQuery({
    queryKey: ['patrocinados', busca, verInativos],
    queryFn: async () => {
      const params: Record<string, string> = {};
      if (busca.trim()) params.busca = busca.trim();
      if (verInativos) params.todos = 'true';
      return (await api.get<PatrocinadoNaLista[]>('/patrocinios', { params })).data;
    },
  });

  const mes = mesAtual();
  const pagamentos = useQuery({
    queryKey: ['patrocinio-pagamentos', mes],
    queryFn: async () =>
      (await api.get<PagamentosDoPatrocinio>('/patrocinios/pagamentos', { params: { mes } })).data,
  });
  const doIxcDe = new Map<string, { resumo: ResumoDosPagamentos; erro: string | null }>(
    (pagamentos.data?.linhas ?? []).map((l) => [l.patrocinado.id, l]),
  );

  const itens = lista.data ?? [];
  const ativos = itens.filter((i) => i.patrocinado.ativo);
  const totalMandado = (pagamentos.data?.linhas ?? []).reduce((s, l) => s + l.resumo.totalPago, 0);
  const semContrato = ativos.filter((i) => i.contrato !== 'ASSINADO').length;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Patrocínios"
        titulo="Quem a ILNET patrocina"
        acoes={
          <button onClick={() => setNovo(true)} className="btn btn-primario">
            Cadastrar patrocinado
          </button>
        }
      />

      <div className="surgir mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Numero rotulo="Patrocinados ativos" valor={String(ativos.length)} />
        <Numero
          rotulo="Já mandado aos ativos"
          valor={pagamentos.isLoading ? '…' : pagamentos.isError ? '—' : formatBRL(totalMandado)}
        />
        <Numero
          rotulo="Sem contrato assinado"
          valor={String(semContrato)}
          alerta={semContrato > 0}
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Procurar por nome, projeto, responsável, CPF ou fornecedor"
          className="campo max-w-md flex-1"
        />
        <label className="flex items-center gap-2 text-sm text-tinta-600">
          <input
            type="checkbox"
            checked={verInativos}
            onChange={(e) => setVerInativos(e.target.checked)}
          />
          Mostrar os encerrados
        </label>
      </div>

      <Bloco className="surgir surgir-2" semPadding>
        <div className="overflow-x-auto rolagem-fina">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="th">Patrocinado</th>
                <th className="th">Contato</th>
                <th className="th">Contrato</th>
                <th className="th text-right">Por mês</th>
                <th className="th text-right">Já mandado</th>
                <th className="th">Último</th>
              </tr>
            </thead>
            <tbody>
              {lista.isLoading && (
                <tr>
                  <td colSpan={6}>
                    <Carregando />
                  </td>
                </tr>
              )}
              {lista.isError && (
                <tr>
                  <td colSpan={6}>
                    <Vazio titulo="Não deu para carregar">{mensagemErro(lista.error)}</Vazio>
                  </td>
                </tr>
              )}
              {!lista.isLoading && !lista.isError && itens.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <Vazio titulo={busca ? 'Ninguém com esse nome' : 'Nenhum patrocinado ainda'}>
                      Cadastre o atleta, o time ou o projeto que a ILNET apoia, ligado ao
                      fornecedor dele no IXC. O pagamento sai pela aba Pagamentos, e o
                      contrato vai por link.
                    </Vazio>
                  </td>
                </tr>
              )}
              {itens.map((i) => {
                const p = i.patrocinado;
                const doIxc = doIxcDe.get(p.id);
                return (
                  <tr
                    key={p.id}
                    onClick={() => navigate(p.id)}
                    className={`linha cursor-pointer ${p.ativo ? '' : 'opacity-50'}`}
                  >
                    <td className="td">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-tinta-900">{p.nome}</span>
                        {!p.ativo && (
                          <Selo tom="neutro" pequeno>
                            encerrado
                          </Selo>
                        )}
                        {!p.idFornecedorIxc && (
                          <Selo tom="erro" pequeno titulo="Não está ligado a nenhum fornecedor do IXC">
                            sem fornecedor
                          </Selo>
                        )}
                      </div>
                      {p.projeto && <div className="mt-0.5 text-xs text-tinta-500">{p.projeto}</div>}
                    </td>
                    <td className="td text-tinta-500">
                      {p.responsavel && <div>{p.responsavel}</div>}
                      <div className="num text-xs">{p.telefone || '—'}</div>
                      {p.instagram && <div className="text-xs text-tinta-400">{p.instagram}</div>}
                    </td>
                    <td className="td">
                      <SeloDoContrato situacao={i.contrato} />
                    </td>
                    <td className="td text-right text-tinta-500">
                      {p.valorMensal && Number(p.valorMensal) > 0 ? (
                        <span className="valor">{formatBRL(p.valorMensal)}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="td text-right">
                      {doIxc?.erro ? (
                        <span className="text-xs text-rose-600" title={doIxc.erro}>
                          não deu para ler
                        </span>
                      ) : doIxc ? (
                        <>
                          <span className="valor">{formatBRL(doIxc.resumo.totalPago)}</span>
                          <div className="num text-xs text-tinta-400">
                            {doIxc.resumo.quantidadePagos} pagamento(s)
                          </div>
                          {doIxc.resumo.totalEmAberto > 0 && (
                            <div className="num text-xs text-amber-600" title="Lançado no IXC, ainda não pago">
                              + {formatBRL(doIxc.resumo.totalEmAberto)} em aberto
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-tinta-300">{pagamentos.isLoading && p.ativo ? '…' : '—'}</span>
                      )}
                    </td>
                    <td className="td num text-tinta-500">
                      {doIxc?.resumo.ultimoPagamento ? formatData(doIxc.resumo.ultimoPagamento) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Bloco>

      {novo && (
        <NovoPatrocinado
          onFechar={() => setNovo(false)}
          onCriado={(p) => {
            setNovo(false);
            // O aviso vai junto para a ficha, que é onde a pessoa cai.
            navigate(p.id, { state: { aviso: { texto: `${p.nome} cadastrado.`, ruim: false } } });
          }}
        />
      )}
    </Pagina>
  );
}

function Numero({ rotulo, valor, alerta = false }: { rotulo: string; valor: string; alerta?: boolean }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs text-tinta-500">{rotulo}</div>
      <div className={`valor mt-0.5 text-xl ${alerta ? 'text-amber-600' : 'text-tinta-900'}`}>{valor}</div>
    </div>
  );
}

/**
 * O cadastro novo, com o fornecedor por onde ele recebe.
 *
 * O patrocinado já é fornecedor no IXC: é lá que se escolhe, e é para ele que
 * sai a conta a pagar de cada mês. Escolhido o fornecedor, o nome e o CPF que
 * ainda estiverem em branco vêm dele.
 */
function NovoPatrocinado({
  onFechar,
  onCriado,
}: {
  onFechar: () => void;
  onCriado: (p: Patrocinado) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Cadastro>(CADASTRO_VAZIO);
  const [fornecedor, setFornecedor] = useState<FornecedorEscolhido | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const salvar = useMutation({
    mutationFn: async () => {
      const corpo = {
        ...corpoDoCadastro(form),
        idFornecedorIxc: fornecedor!.idFornecedor,
        fornecedorNome: fornecedor!.nome,
      };
      return (await api.post<{ patrocinado: Patrocinado }>('/patrocinios', corpo)).data;
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['patrocinados'] });
      void qc.invalidateQueries({ queryKey: ['patrocinio-pagamentos'] });
      onCriado(r.patrocinado);
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  function escolher(f: FornecedorEscolhido | null) {
    setFornecedor(f);
    if (!f) return;
    setForm({
      ...form,
      nome: form.nome.trim() ? form.nome : f.nome,
      cpfCnpj: form.cpfCnpj.trim() ? form.cpfCnpj : (f.cpfCnpj ?? ''),
    });
  }

  const podeSalvar = form.nome.trim().length >= 2 && !!fornecedor && !salvar.isPending;

  return (
    <Janela titulo="Novo patrocinado" onFechar={onFechar}>
      <div className="p-5 sm:p-6">
        <CamposDoPatrocinado form={form} setForm={setForm} />

        <section className="mt-6 rounded-xl border border-tinta-100 p-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-tinta-500">
            Fornecedor no IXC
          </h3>
          <p className="ajuda mt-1">
            O patrocinado recebe como o fornecedor que ele já é no IXC: o pagamento de cada mês é
            uma conta a pagar para ele, lançada pela aba Pagamentos.
          </p>
          <div className="mt-3 max-w-2xl">
            <Campo label="Fornecedor">
              <EscolherFornecedor valor={fornecedor} onChange={escolher} />
            </Campo>
          </div>
        </section>

        {erro && <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{erro}</p>}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button onClick={onFechar} className="btn btn-neutro">
            Cancelar
          </button>
          <button onClick={() => salvar.mutate()} disabled={!podeSalvar} className="btn btn-primario">
            {salvar.isPending ? 'Salvando…' : 'Cadastrar'}
          </button>
        </div>
      </div>
    </Janela>
  );
}
