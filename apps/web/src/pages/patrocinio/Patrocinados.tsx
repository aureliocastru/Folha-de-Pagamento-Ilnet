import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SeletorComBusca } from '../../components/SeletorComBusca';
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
import { formatBRL, formatData } from '../../lib/format';
import type {
  FormaPagamento,
  Patrocinado,
  PatrocinadoNaLista,
  RecebedorPossivel,
} from '../../lib/types';
import {
  CADASTRO_VAZIO,
  Campo,
  CamposDoPatrocinado,
  SeloDoContrato,
  corpoDoCadastro,
  type Cadastro,
} from './comum';

/**
 * Quem a ILNET patrocina: a lista, com o que já se mandou a cada um e onde
 * está o contrato. A ficha de cada um abre por cima da linha.
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

  const itens = lista.data ?? [];
  const ativos = itens.filter((i) => i.patrocinado.ativo);
  const totalMandado = ativos.reduce((s, i) => s + i.totalPago, 0);
  const semContrato = ativos.filter((i) => i.contrato !== 'ASSINADO').length;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Patrocinadores"
        titulo="Quem a ILNET patrocina"
        acoes={
          <button onClick={() => setNovo(true)} className="btn btn-primario">
            Cadastrar patrocinado
          </button>
        }
      />

      <div className="surgir mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Numero rotulo="Patrocinados ativos" valor={String(ativos.length)} />
        <Numero rotulo="Já mandado aos ativos" valor={formatBRL(totalMandado)} />
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
          placeholder="Procurar por nome, projeto, responsável ou CPF"
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
                      Cadastre o atleta, o time ou o projeto que a ILNET apoia. O
                      pagamento sai pela aba Diaristas, e o contrato vai por link.
                    </Vazio>
                  </td>
                </tr>
              )}
              {itens.map((i) => {
                const p = i.patrocinado;
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
                        {!i.recebedor && (
                          <Selo tom="erro" pequeno titulo="Não está ligado a nenhum cadastro de diarista">
                            sem por onde receber
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
                      <span className="valor">{formatBRL(i.totalPago)}</span>
                      <div className="num text-xs text-tinta-400">{i.quantidadePagos} pagamento(s)</div>
                      {i.totalAguardando > 0 && (
                        <div className="num text-xs text-amber-600" title="Lançado no IXC, ainda não pago pelo banco">
                          + {formatBRL(i.totalAguardando)} a caminho
                        </div>
                      )}
                    </td>
                    <td className="td num text-tinta-500">
                      {i.ultimoPagamento ? formatData(i.ultimoPagamento) : '—'}
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
          onCriado={(p, avisoIxc) => {
            setNovo(false);
            // O aviso vai junto para a ficha, que é onde a pessoa cai.
            navigate(p.id, {
              state: {
                aviso: avisoIxc
                  ? {
                      texto: `${p.nome} cadastrado. O IXC não aceitou o fornecedor de quem recebe (${avisoIxc}) — o primeiro pagamento tenta de novo sozinho.`,
                      ruim: true,
                    }
                  : { texto: `${p.nome} cadastrado.`, ruim: false },
              },
            });
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

const RECEBEDOR_VAZIO = {
  nome: '',
  cpfCnpj: '',
  telefone: '',
  chavePix: '',
  formaPagamento: 'IXC' as FormaPagamento,
};

/**
 * O cadastro novo, com por onde ele recebe.
 *
 * Quem recebe é um cadastro de diarista: o atleta que já recebia como diarista
 * é escolhido na lista; o resto nasce aqui, com o fornecedor no IXC, e passa a
 * aparecer na aba Diaristas pronto para pagar.
 */
function NovoPatrocinado({
  onFechar,
  onCriado,
}: {
  onFechar: () => void;
  onCriado: (p: Patrocinado, avisoIxc: string | null) => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState<Cadastro>(CADASTRO_VAZIO);
  const [jeito, setJeito] = useState<'novo' | 'existente'>('novo');
  const [recebedor, setRecebedor] = useState(RECEBEDOR_VAZIO);
  const [diaristaId, setDiaristaId] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  const recebedores = useQuery({
    queryKey: ['patrocinio-recebedores'],
    queryFn: async () => (await api.get<RecebedorPossivel[]>('/patrocinios/recebedores')).data,
    enabled: jeito === 'existente',
  });

  const salvar = useMutation({
    mutationFn: async () => {
      const corpo = {
        ...corpoDoCadastro(form),
        ...(jeito === 'existente'
          ? { diaristaId }
          : {
              // Vazio = os dados do próprio cadastro: quem recebe costuma ser o
              // responsável, ou o patrocinado mesmo.
              recebedor: {
                nome: recebedor.nome.trim() || form.responsavel.trim() || form.nome.trim(),
                cpfCnpj: recebedor.cpfCnpj.trim() || form.cpfCnpj.trim() || undefined,
                telefone: recebedor.telefone.trim() || form.telefone.trim() || undefined,
                chavePix: recebedor.chavePix.trim() || undefined,
                formaPagamento: recebedor.formaPagamento,
              },
            }),
      };
      return (
        await api.post<{ patrocinado: Patrocinado; avisoIxc: string | null }>('/patrocinios', corpo)
      ).data;
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['patrocinados'] });
      void qc.invalidateQueries({ queryKey: ['diaristas'] });
      onCriado(r.patrocinado, r.avisoIxc);
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const opcoes = (recebedores.data ?? []).map((d) => ({
    valor: d.id,
    rotulo:
      `${d.nome}${d.nomeFantasia ? ` (${d.nomeFantasia})` : ''}` +
      (d.patrocinado ? ` — já recebe por ${d.patrocinado.nome}` : ''),
  }));
  const escolhido = recebedores.data?.find((d) => d.id === diaristaId);
  const podeSalvar =
    form.nome.trim().length >= 2 &&
    (jeito === 'novo' || (!!diaristaId && !escolhido?.patrocinado)) &&
    !salvar.isPending;

  return (
    <Janela titulo="Novo patrocinado" onFechar={onFechar} larga>
      <div className="p-5 sm:p-6">
        <CamposDoPatrocinado form={form} setForm={setForm} />

        <section className="mt-6 rounded-xl border border-tinta-100 p-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.1em] text-tinta-500">
            Por onde ele recebe
          </h3>
          <p className="ajuda mt-1">
            O patrocínio é pago pela aba Diaristas da folha — pelo IXC ou em mãos,
            com recibo. Quem recebe precisa de um cadastro lá.
          </p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setJeito('novo')}
              className={`btn btn-p ${jeito === 'novo' ? 'btn-primario' : 'btn-neutro'}`}
            >
              Cadastrar quem recebe
            </button>
            <button
              type="button"
              onClick={() => setJeito('existente')}
              className={`btn btn-p ${jeito === 'existente' ? 'btn-primario' : 'btn-neutro'}`}
            >
              Já é diarista
            </button>
          </div>

          {jeito === 'novo' ? (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Campo label="Nome de quem recebe" span2>
                <input
                  value={recebedor.nome}
                  onChange={(e) => setRecebedor({ ...recebedor, nome: e.target.value })}
                  className="campo"
                  placeholder={form.responsavel || form.nome || 'Vazio = o responsável, ou o patrocinado'}
                  autoComplete="off"
                />
              </Campo>
              <Campo label="CPF de quem recebe">
                <input
                  value={recebedor.cpfCnpj}
                  onChange={(e) => setRecebedor({ ...recebedor, cpfCnpj: e.target.value })}
                  className="campo"
                  placeholder={form.cpfCnpj || ''}
                  autoComplete="off"
                />
              </Campo>
              <Campo label="Telefone">
                <input
                  value={recebedor.telefone}
                  onChange={(e) => setRecebedor({ ...recebedor, telefone: e.target.value })}
                  className="campo"
                  placeholder={form.telefone || ''}
                  autoComplete="off"
                />
              </Campo>
              <Campo label="Chave PIX">
                <input
                  value={recebedor.chavePix}
                  onChange={(e) => setRecebedor({ ...recebedor, chavePix: e.target.value })}
                  className="campo"
                  placeholder="Para pagar pelo IXC"
                  autoComplete="off"
                />
              </Campo>
              <Campo label="Como costuma receber">
                <select
                  value={recebedor.formaPagamento}
                  onChange={(e) =>
                    setRecebedor({ ...recebedor, formaPagamento: e.target.value as FormaPagamento })
                  }
                  className="campo"
                >
                  <option value="IXC">Pelo IXC (conta a pagar)</option>
                  <option value="EM_MAOS">Em mãos (sai do caixa)</option>
                </select>
              </Campo>
              <p className="ajuda sm:col-span-2">
                Campo vazio usa o do patrocinado. O cadastro de diarista nasce já
                com o fornecedor no IXC.
              </p>
            </div>
          ) : (
            <div className="mt-4">
              <Campo label="Diarista">
                <SeletorComBusca
                  opcoes={opcoes}
                  value={diaristaId}
                  onChange={setDiaristaId}
                  vazio="Escolha quem recebe"
                  carregando={recebedores.isLoading}
                  procurar="Procurar diarista…"
                />
              </Campo>
              {escolhido?.patrocinado && (
                <p className="mt-2 text-sm text-amber-700">
                  {escolhido.nome} já recebe pelo patrocínio de {escolhido.patrocinado.nome}. Cada
                  cadastro de diarista paga um patrocinado só.
                </p>
              )}
            </div>
          )}
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
