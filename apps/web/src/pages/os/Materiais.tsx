import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Aviso, Bloco, CabecalhoPagina, Carregando, Pagina, Selo, Vazio } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { useTermoAdiado } from '../../lib/busca';
import { quantidadeComUnidade, type MaterialDeOs, type ProdutoParaIncluir } from '../../lib/os';

const CHAVE = ['os', 'materiais'];

/**
 * A lista da OS, em duas partes.
 *
 * - **Aparelhos de cliente**: os modelos de ONU e roteador que se instalam em
 *   comodato. A lista existe porque no IXC a ferramenta da van (a escada, a
 *   caneta de limpeza) é patrimônio igual à ONU, no mesmo subgrupo — sem ela
 *   o técnico veria a escada entre as coisas para "instalar" no cliente.
 * - **Materiais que se gastam**: conector, drop, esticador. O cadastro do IXC
 *   tem milhares de produtos; esta é a lista curta. O teto por OS não trava o
 *   técnico, mas acima dele ele escreve o porquê, e a frase aparece no
 *   relatório do mês.
 */
export function Materiais() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState('');
  const [comoAparelho, setComoAparelho] = useState(false);
  const termo = useTermoAdiado(busca);
  const [erro, setErro] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: CHAVE,
    queryFn: async () => (await api.get<MaterialDeOs[]>('/os/materiais')).data,
  });
  const produtos = useQuery({
    queryKey: ['os', 'materiais', 'produtos', termo, comoAparelho],
    queryFn: async () =>
      (
        await api.get<ProdutoParaIncluir[]>('/os/materiais/produtos', {
          params: { busca: termo, aparelho: comoAparelho ? 1 : 0 },
        })
      ).data,
    enabled: termo.trim().length >= 2,
  });

  function recarregar() {
    void qc.invalidateQueries({ queryKey: CHAVE });
  }

  const incluir = useMutation({
    mutationFn: async (produtoId: number) => {
      await api.post('/os/materiais', { produtoId, aparelho: comoAparelho });
    },
    onSuccess: () => setErro(null),
    onError: (e) => setErro(mensagemErro(e)),
    onSettled: recarregar,
  });

  const itens = lista.data ?? [];
  const aparelhos = itens.filter((m) => m.aparelho);
  const materiais = itens.filter((m) => !m.aparelho);

  return (
    <Pagina>
      <CabecalhoPagina secao="Ordens de Serviço" titulo="Lista da OS" />

      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {lista.isError && <Aviso tom="erro">{mensagemErro(lista.error)}</Aviso>}
      {lista.isSuccess && aparelhos.filter((a) => a.ativo).length === 0 && (
        <Aviso tom="atencao">
          Nenhum modelo de aparelho na lista: enquanto isso, os técnicos não conseguem anotar
          instalação. Inclua os modelos de ONU e roteador que vão para cliente.
        </Aviso>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-4">
          <Bloco titulo={`Aparelhos de cliente · ${aparelhos.length}`} semPadding>
            {lista.isLoading && <Carregando />}
            {lista.isSuccess && aparelhos.length === 0 && (
              <Vazio titulo="Nenhum modelo ainda">
                Inclua ao lado, marcando "aparelho", as ONUs e roteadores que se instalam em
                comodato. A escada e a caneta de limpeza ficam de fora.
              </Vazio>
            )}
            {aparelhos.length > 0 && <TabelaDaLista itens={aparelhos} comTeto={false} onErro={setErro} />}
          </Bloco>

          <Bloco titulo={`Materiais que se gastam · ${materiais.length}`} semPadding>
            {lista.isSuccess && materiais.length === 0 && (
              <Vazio titulo="Nenhum material ainda">
                Procure ao lado o conector, o drop, o esticador — o que o técnico gasta em OS — e
                inclua.
              </Vazio>
            )}
            {materiais.length > 0 && <TabelaDaLista itens={materiais} comTeto onErro={setErro} />}
          </Bloco>
        </div>

        <Bloco titulo="Incluir do IXC" semPadding>
          <div className="space-y-2 px-4 py-3 md:px-5">
            <div className="flex rounded-xl border border-tinta-200 p-0.5">
              {[
                { valor: false, rotulo: 'Material' },
                { valor: true, rotulo: 'Aparelho de cliente' },
              ].map((o) => (
                <button
                  key={o.rotulo}
                  type="button"
                  onClick={() => setComoAparelho(o.valor)}
                  className={`flex-1 rounded-lg px-3 py-1.5 text-[13px] font-medium ${
                    comoAparelho === o.valor
                      ? 'bg-brand-500/10 text-brand-800 dark:text-brand-200'
                      : 'text-tinta-500'
                  }`}
                >
                  {o.rotulo}
                </button>
              ))}
            </div>
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder={comoAparelho ? 'Procurar modelo: ONU, roteador…' : 'Procurar material: conector, drop…'}
              className="campo"
              autoComplete="off"
            />
            <p className="ajuda">
              {comoAparelho
                ? 'Só patrimônio (o que anda com MAC e série) entra como aparelho.'
                : 'Patrimônio não entra como material: ele se instala pela peça.'}
            </p>
          </div>
          {produtos.isFetching && <Carregando texto="Procurando no IXC…" />}
          {produtos.isError && (
            <p className="px-4 pb-3 text-[13px] text-rose-600 md:px-5">{mensagemErro(produtos.error)}</p>
          )}
          {produtos.data && produtos.data.length === 0 && (
            <p className="px-4 pb-4 text-[13px] text-tinta-400 md:px-5">Nada com esse nome.</p>
          )}
          <ul className="lista-dividida">
            {(produtos.data ?? []).map((p) => (
              <li key={p.produtoId} className="flex items-center gap-3 px-4 py-2.5 md:px-5">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-tinta-900">{p.descricao}</span>
                  <span className="block text-[12px] text-tinta-400">
                    #{p.produtoId} · {quantidadeComUnidade(p.total, p.unidade)} na casa
                  </span>
                </span>
                {p.naLista ? (
                  <Selo tom="pago" pequeno>
                    na lista
                  </Selo>
                ) : (
                  <button
                    type="button"
                    onClick={() => incluir.mutate(p.produtoId)}
                    disabled={incluir.isPending}
                    className="btn btn-neutro btn-p"
                  >
                    Incluir
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Bloco>
      </div>
    </Pagina>
  );
}

function TabelaDaLista({
  itens,
  comTeto,
  onErro,
}: {
  itens: MaterialDeOs[];
  /** O teto por OS é só do material: aparelho vai um por peça. */
  comTeto: boolean;
  onErro: (e: string | null) => void;
}) {
  const qc = useQueryClient();
  const [tetos, setTetos] = useState<Record<string, string>>({});

  function recarregar() {
    void qc.invalidateQueries({ queryKey: CHAVE });
  }

  const editar = useMutation({
    mutationFn: async (p: { id: string; dados: Record<string, unknown> }) => {
      await api.patch(`/os/materiais/${p.id}`, p.dados);
    },
    onSuccess: () => onErro(null),
    onError: (e) => onErro(mensagemErro(e)),
    onSettled: recarregar,
  });

  const apagar = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/os/materiais/${id}`);
    },
    onError: (e) => onErro(mensagemErro(e)),
    onSettled: recarregar,
  });

  function salvarTeto(m: MaterialDeOs) {
    const digitado = tetos[m.id];
    if (digitado === undefined) return;
    const limpo = digitado.trim().replace(',', '.');
    const valor = limpo === '' ? null : Number(limpo);
    if (valor !== null && !(valor > 0)) {
      onErro('O máximo por OS tem de ser maior que zero, ou vazio para não ter teto.');
      return;
    }
    if (valor === m.maximoPorOs) return;
    editar.mutate({ id: m.id, dados: { maximoPorOs: valor } });
  }

  return (
    <table className="w-full text-sm">
      <thead>
        <tr>
          <th className="th">{comTeto ? 'Material' : 'Modelo'}</th>
          {comTeto && <th className="th w-40">Máximo por OS</th>}
          <th className="th w-40" />
        </tr>
      </thead>
      <tbody>
        {itens.map((m) => (
          <tr key={m.id} className={`linha ${m.ativo ? '' : 'opacity-60'}`}>
            <td className="td">
              <span className="font-medium text-tinta-900">{m.descricao}</span>{' '}
              <span className="text-[12px] text-tinta-400">
                #{m.produtoId}
                {m.unidade ? ` · ${m.unidade}` : ''}
              </span>{' '}
              {!m.ativo && (
                <Selo tom="neutro" pequeno>
                  fora da lista do técnico
                </Selo>
              )}
            </td>
            {comTeto && (
              <td className="td">
                <input
                  value={tetos[m.id] ?? (m.maximoPorOs === null ? '' : String(m.maximoPorOs))}
                  onChange={(e) => setTetos((t) => ({ ...t, [m.id]: e.target.value.slice(0, 10) }))}
                  onBlur={() => salvarTeto(m)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                  inputMode="decimal"
                  placeholder="sem teto"
                  aria-label={`Máximo de ${m.descricao} por OS`}
                  className="campo num"
                />
              </td>
            )}
            <td className="td text-right">
              <button
                type="button"
                onClick={() => editar.mutate({ id: m.id, dados: { ativo: !m.ativo } })}
                disabled={editar.isPending}
                className="btn btn-sutil btn-p"
              >
                {m.ativo ? 'Desativar' : 'Ativar'}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Tirar "${m.descricao}" da lista? O que já foi registrado continua no relatório.`)) {
                    apagar.mutate(m.id);
                  }
                }}
                disabled={apagar.isPending}
                className="btn btn-sutil btn-p text-rose-600"
              >
                Tirar
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
