import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Indicador,
  Janela,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatData } from '../../lib/format';
import type {
  EmprestimoDeFerramenta,
  Ferramenta,
  PessoaDoAlmoxarifado,
} from '../../lib/types';

/** "há 3 dias", "hoje" — o tempo como quem cobra a ferramenta o conta. */
function haQuantoTempo(dias: number): string {
  if (dias <= 0) return 'hoje';
  if (dias === 1) return 'ontem';
  return `há ${dias} dias`;
}

/**
 * O caderno de ferramentas: quem levou o quê, e quando devolveu.
 *
 * A pergunta desta tela não é "quantas máquinas de fusão temos" — essa o
 * estoque responde. É **"quem está com ela?"**, e essa não se responde com
 * saldo: a ferramenta que saiu continua existindo, e o que mudou foi o lugar
 * dela. Por isso ela não dá baixa em nada: abre uma linha de saída que fica
 * esperando a linha de volta.
 *
 * É registro desta casa, e não do IXC. O que existe lá é comodato de cliente e
 * produto consumido em ordem de serviço, e nenhum dos dois é a chave de fenda
 * que o técnico levou na sexta.
 */
export function Ferramentas() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState('');
  const [soEmprestadas, setSoEmprestadas] = useState(false);
  const [verBaixadas, setVerBaixadas] = useState(false);
  const [cadastrando, setCadastrando] = useState(false);
  const [editando, setEditando] = useState<Ferramenta | null>(null);
  const [emprestando, setEmprestando] = useState<Ferramenta | null>(null);
  const [vendo, setVendo] = useState<Ferramenta | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [erro, setErro] = useState(false);

  const lista = useQuery({
    queryKey: ['almoxarifado', 'ferramentas', verBaixadas],
    queryFn: async () =>
      (
        await api.get<Ferramenta[]>('/almoxarifado/ferramentas', {
          params: verBaixadas ? { baixadas: 1 } : {},
        })
      ).data,
  });

  const pessoas = useQuery({
    queryKey: ['almoxarifado', 'pessoas'],
    queryFn: async () =>
      (await api.get<PessoaDoAlmoxarifado[]>('/almoxarifado/pessoas')).data,
  });

  function avisar(texto: string, ruim = false) {
    setErro(ruim);
    setFeedback(texto);
    if (!ruim) setTimeout(() => setFeedback(null), 3000);
  }

  function invalidar() {
    void qc.invalidateQueries({ queryKey: ['almoxarifado', 'ferramentas'] });
  }

  const salvar = useMutation({
    mutationFn: async (args: { id?: string; dados: Record<string, unknown> }) =>
      args.id
        ? (
            await api.patch<Ferramenta>(
              `/almoxarifado/ferramentas/${args.id}`,
              args.dados,
            )
          ).data
        : (await api.post<Ferramenta>('/almoxarifado/ferramentas', args.dados))
            .data,
    onSuccess: (f, args) => {
      setCadastrando(false);
      setEditando(null);
      avisar(args.id ? `"${f.nome}" atualizada.` : `"${f.nome}" cadastrada.`);
      invalidar();
    },
    onError: (e) => avisar(mensagemErro(e), true),
  });

  const emprestar = useMutation({
    mutationFn: async (args: { id: string; dados: Record<string, unknown> }) =>
      (
        await api.post<Ferramenta>(
          `/almoxarifado/ferramentas/${args.id}/emprestar`,
          args.dados,
        )
      ).data,
    onSuccess: (f) => {
      setEmprestando(null);
      avisar(`"${f.nome}" saiu com ${f.comQuem?.quem}.`);
      invalidar();
    },
    onError: (e) => avisar(mensagemErro(e), true),
  });

  const devolver = useMutation({
    mutationFn: async (args: { id: string; observacao?: string }) =>
      (
        await api.post<Ferramenta>(
          `/almoxarifado/ferramentas/${args.id}/devolver`,
          { observacao: args.observacao },
        )
      ).data,
    onSuccess: (f) => {
      avisar(`"${f.nome}" voltou para o almoxarifado.`);
      invalidar();
    },
    onError: (e) => avisar(mensagemErro(e), true),
  });

  const todas = lista.data ?? [];
  const termo = busca.trim().toLowerCase();
  const ferramentas = todas
    .filter((f) => (soEmprestadas ? f.comQuem : true))
    .filter((f) =>
      termo
        ? [f.nome, f.patrimonio, f.descricao, f.comQuem?.quem]
            .filter(Boolean)
            .some((t) => t!.toLowerCase().includes(termo))
        : true,
    );

  const naRua = todas.filter((f) => f.comQuem).length;
  const atrasadas = todas.filter((f) => f.comQuem?.atrasado).length;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Almoxarifado"
        titulo="Ferramentas"
        descricao="Quem está com o quê. Ferramenta não é material: ela sai com um nome e tem de voltar — e é isso que esta tela guarda."
        acoes={
          <button
            type="button"
            onClick={() => setCadastrando(true)}
            className="btn btn-primario"
          >
            Nova ferramenta
          </button>
        }
      />

      {feedback && <Aviso tom={erro ? 'erro' : 'pago'}>{feedback}</Aviso>}

      <div className="surgir surgir-1 mb-4 grid grid-cols-2 gap-2.5 sm:gap-4 lg:grid-cols-3">
        <Indicador
          acento
          rotulo="Ferramentas"
          valor={todas.length}
          detalhe="no cadastro"
        />
        <Indicador
          rotulo="Na rua"
          valor={naRua}
          detalhe="com alguém agora"
        />
        <Indicador
          rotulo="Atrasadas"
          valor={atrasadas}
          detalhe="passou o dia combinado"
          alerta={atrasadas > 0 ? 'cobrar a devolução' : undefined}
        />
      </div>

      <Bloco
        titulo={`${ferramentas.length} ${ferramentas.length === 1 ? 'ferramenta' : 'ferramentas'}`}
        semPadding
        acao={
          <label className="opcao text-[12px]">
            <input
              type="checkbox"
              className="marcador"
              checked={verBaixadas}
              onChange={(e) => setVerBaixadas(e.target.checked)}
            />
            Mostrar baixadas
          </label>
        }
      >
        <div className="flex flex-wrap items-center gap-3 px-3.5 py-3 md:px-5">
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por ferramenta, patrimônio ou quem está com ela…"
            className="campo min-w-0 flex-1"
            autoComplete="off"
          />
          <label className="opcao text-[12px]">
            <input
              type="checkbox"
              className="marcador"
              checked={soEmprestadas}
              onChange={(e) => setSoEmprestadas(e.target.checked)}
            />
            Só as que estão na rua
          </label>
        </div>

        {lista.isLoading && <Carregando />}
        {lista.isError && (
          <Vazio titulo="Não deu para ler o caderno">
            {mensagemErro(lista.error)}
          </Vazio>
        )}

        {!lista.isLoading && ferramentas.length === 0 && (
          <Vazio titulo="Nenhuma ferramenta aqui">
            Cadastre as ferramentas da casa — a máquina de fusão, o alicate de
            crimpar, a furadeira — e depois é só registrar quem levou cada uma.
          </Vazio>
        )}

        {ferramentas.length > 0 && (
          <div className="rolagem-fina overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Ferramenta</th>
                  <th className="th">Onde está</th>
                  <th className="th">Desde</th>
                  <th className="th text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {ferramentas.map((f) => (
                  <tr key={f.id} className={`linha ${f.ativa ? '' : 'opacity-50'}`}>
                    <td className="td">
                      <button
                        type="button"
                        onClick={() => setVendo(f)}
                        title="Ver o histórico desta ferramenta"
                        className="group text-left"
                      >
                        <span className="flex items-center gap-1.5 font-medium text-tinta-800 transition group-hover:text-brand-700 dark:group-hover:text-brand-300">
                          {f.nome}
                          <span className="text-tinta-300 transition group-hover:text-brand-500">
                            &rsaquo;
                          </span>
                        </span>
                        {(f.patrimonio || !f.ativa) && (
                          <span className="num block text-xs text-tinta-400">
                            {f.patrimonio ? `patrimônio ${f.patrimonio}` : ''}
                            {!f.ativa ? ' · baixada' : ''}
                          </span>
                        )}
                      </button>
                    </td>

                    <td className="td">
                      {f.comQuem ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-tinta-800">
                            {f.comQuem.quem}
                          </span>
                          {f.comQuem.atrasado && (
                            <Selo tom="erro" pequeno>
                              atrasada
                            </Selo>
                          )}
                        </div>
                      ) : (
                        <Selo tom="pago">no almoxarifado</Selo>
                      )}
                      {f.comQuem?.previsaoDeVolta && (
                        <div className="text-[11px] text-tinta-400">
                          combinado para {formatData(f.comQuem.previsaoDeVolta)}
                        </div>
                      )}
                    </td>

                    <td className="td whitespace-nowrap text-tinta-500">
                      {f.comQuem ? (
                        <>
                          {haQuantoTempo(f.comQuem.diasFora)}
                          <div className="num text-[11px] text-tinta-400">
                            {formatData(f.comQuem.saiuEm)}
                          </div>
                        </>
                      ) : (
                        <span className="text-tinta-400">—</span>
                      )}
                    </td>

                    <td className="td text-right">
                      {!f.ativa ? (
                        <span className="text-xs text-tinta-400">—</span>
                      ) : f.comQuem ? (
                        <button
                          type="button"
                          onClick={() => devolver.mutate({ id: f.id })}
                          disabled={devolver.isPending}
                          className="btn btn-p btn-pagar"
                          title="Registrar que ela voltou para o almoxarifado"
                        >
                          Devolveu
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setEmprestando(f)}
                          className="btn btn-p btn-primario"
                        >
                          Emprestar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>

      {(cadastrando || editando) && (
        <FormularioDaFerramenta
          ferramenta={editando}
          salvando={salvar.isPending}
          onSalvar={(dados) => salvar.mutate({ id: editando?.id, dados })}
          onFechar={() => {
            setCadastrando(false);
            setEditando(null);
          }}
        />
      )}

      {emprestando && (
        <FormularioDeEmprestimo
          ferramenta={emprestando}
          pessoas={pessoas.data ?? []}
          pendente={emprestar.isPending}
          onEmprestar={(dados) =>
            emprestar.mutate({ id: emprestando.id, dados })
          }
          onFechar={() => setEmprestando(null)}
        />
      )}

      {vendo && (
        <HistoricoDaFerramenta
          ferramenta={vendo}
          onFechar={() => setVendo(null)}
          onEditar={() => {
            setEditando(vendo);
            setVendo(null);
          }}
        />
      )}
    </Pagina>
  );
}

/** Cadastrar ou corrigir uma ferramenta. */
function FormularioDaFerramenta({
  ferramenta,
  salvando,
  onSalvar,
  onFechar,
}: {
  ferramenta: Ferramenta | null;
  salvando: boolean;
  onSalvar: (dados: Record<string, unknown>) => void;
  onFechar: () => void;
}) {
  const [nome, setNome] = useState(ferramenta?.nome ?? '');
  const [patrimonio, setPatrimonio] = useState(ferramenta?.patrimonio ?? '');
  const [descricao, setDescricao] = useState(ferramenta?.descricao ?? '');
  const [ativa, setAtiva] = useState(ferramenta?.ativa ?? true);

  return (
    <Janela
      titulo={ferramenta ? ferramenta.nome : 'Nova ferramenta'}
      onFechar={onFechar}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSalvar({
            nome,
            patrimonio: patrimonio.trim() || null,
            descricao: descricao.trim() || null,
            ...(ferramenta ? { ativa } : {}),
          });
        }}
        className="space-y-4"
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="rotulo" htmlFor="ferr-nome">
              Ferramenta *
            </label>
            <input
              id="ferr-nome"
              required
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="campo"
              placeholder="Máquina de fusão, alicate de crimpar, furadeira…"
              autoComplete="off"
            />
          </div>

          <div>
            <label className="rotulo" htmlFor="ferr-patrimonio">
              Patrimônio
            </label>
            <input
              id="ferr-patrimonio"
              value={patrimonio}
              onChange={(e) => setPatrimonio(e.target.value)}
              className="campo num"
              placeholder="o número da etiqueta"
              autoComplete="off"
            />
            <p className="ajuda">
              É ele que separa duas máquinas de fusão iguais. Sem ele, "quem
              está com a máquina de fusão" volta a não ter resposta quando a
              casa tem duas.
            </p>
          </div>

          <div className="md:col-span-2">
            <label className="rotulo" htmlFor="ferr-descricao">
              Observação
            </label>
            <textarea
              id="ferr-descricao"
              rows={2}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              className="campo"
              placeholder="Marca, modelo, o que vem na maleta…"
            />
          </div>

          {ferramenta && (
            <label className="opcao md:col-span-2">
              <input
                type="checkbox"
                className="marcador"
                checked={ativa}
                onChange={(e) => setAtiva(e.target.checked)}
              />
              Em uso — desmarque para dar baixa (quebrou, sumiu, foi vendida)
            </label>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-tinta-200 pt-4">
          <button type="button" onClick={onFechar} className="btn btn-neutro">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={salvando || nome.trim().length < 2}
            className="btn btn-primario"
          >
            {salvando ? 'Salvando…' : 'Salvar'}
          </button>
        </div>
      </form>
    </Janela>
  );
}

/** Entregar a ferramenta a alguém. */
function FormularioDeEmprestimo({
  ferramenta,
  pessoas,
  pendente,
  onEmprestar,
  onFechar,
}: {
  ferramenta: Ferramenta;
  pessoas: PessoaDoAlmoxarifado[];
  pendente: boolean;
  onEmprestar: (dados: Record<string, unknown>) => void;
  onFechar: () => void;
}) {
  const [funcionarioId, setFuncionarioId] = useState('');
  const [quem, setQuem] = useState('');
  const [previsao, setPrevisao] = useState('');
  const [observacao, setObservacao] = useState('');

  const pronto = funcionarioId !== '' || quem.trim().length >= 2;

  return (
    <Janela titulo={`Emprestar — ${ferramenta.nome}`} onFechar={onFechar}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!pronto) return;
          onEmprestar({
            ...(funcionarioId ? { funcionarioId } : {}),
            ...(quem.trim() ? { quem: quem.trim() } : {}),
            ...(previsao ? { previsaoDeVolta: previsao } : {}),
            observacao: observacao.trim() || null,
          });
        }}
        className="space-y-4"
      >
        <div>
          <label className="rotulo" htmlFor="empr-quem">
            Quem está levando *
          </label>
          <select
            id="empr-quem"
            value={funcionarioId}
            onChange={(e) => {
              setFuncionarioId(e.target.value);
              if (e.target.value) setQuem('');
            }}
            className="campo"
          >
            <option value="">Escolha quem, ou escreva abaixo…</option>
            {pessoas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.apelido ? `${p.nome} (${p.apelido})` : p.nome}
              </option>
            ))}
          </select>
          {/* O campo escrito existe para quem não está no cadastro: o
              terceirizado da obra, o eletricista contratado por fora. */}
          <input
            value={quem}
            onChange={(e) => {
              setQuem(e.target.value);
              if (e.target.value) setFuncionarioId('');
            }}
            className="campo mt-2"
            placeholder="…ou o nome de quem não está no cadastro"
            autoComplete="off"
          />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="rotulo" htmlFor="empr-previsao">
              Fica de voltar quando
            </label>
            <input
              id="empr-previsao"
              type="date"
              value={previsao}
              onChange={(e) => setPrevisao(e.target.value)}
              className="campo"
            />
            <p className="ajuda">
              Em branco não cobra ninguém — é o dia a partir do qual ela aparece
              como atrasada.
            </p>
          </div>

          <div>
            <label className="rotulo" htmlFor="empr-obs">
              Para onde vai
            </label>
            <input
              id="empr-obs"
              value={observacao}
              onChange={(e) => setObservacao(e.target.value)}
              className="campo"
              placeholder="Obra do Lago Verde, atendimento no Rivelino…"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-tinta-200 pt-4">
          <button type="button" onClick={onFechar} className="btn btn-neutro">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={!pronto || pendente}
            className="btn btn-primario"
          >
            {pendente ? 'Registrando…' : 'Entregar a ferramenta'}
          </button>
        </div>
      </form>
    </Janela>
  );
}

/** Por onde esta ferramenta já andou. */
function HistoricoDaFerramenta({
  ferramenta,
  onFechar,
  onEditar,
}: {
  ferramenta: Ferramenta;
  onFechar: () => void;
  onEditar: () => void;
}) {
  const historico = useQuery({
    queryKey: ['almoxarifado', 'ferramenta', ferramenta.id],
    queryFn: async () =>
      (
        await api.get<EmprestimoDeFerramenta[]>(
          `/almoxarifado/ferramentas/${ferramenta.id}/historico`,
        )
      ).data,
  });

  return (
    <Janela titulo={ferramenta.nome} onFechar={onFechar}>
      <p className="mb-4 text-[13px] text-tinta-500">
        {[
          ferramenta.patrimonio ? `patrimônio ${ferramenta.patrimonio}` : null,
          ferramenta.descricao,
          ferramenta.ativa ? null : 'baixada',
        ]
          .filter(Boolean)
          .join(' · ') || 'Sem patrimônio nem observação.'}
      </p>

      {historico.isLoading && <Carregando />}
      {historico.isError && (
        <Vazio titulo="Não deu para ler o histórico">
          {mensagemErro(historico.error)}
        </Vazio>
      )}

      {historico.data?.length === 0 && (
        <Vazio titulo="Ela nunca saiu">
          Está no almoxarifado desde que foi cadastrada.
        </Vazio>
      )}

      {historico.data && historico.data.length > 0 && (
        <div className="lista-dividida rounded-xl border border-tinta-200">
          {historico.data.map((e) => (
            <div key={e.id} className="px-3.5 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-tinta-800">{e.quem}</span>
                {e.voltouEm ? (
                  <Selo tom="pago" pequeno>
                    voltou em {formatData(e.voltouEm)}
                  </Selo>
                ) : e.atrasado ? (
                  <Selo tom="erro" pequeno>
                    na rua, atrasada
                  </Selo>
                ) : (
                  <Selo tom="marca" pequeno>
                    na rua
                  </Selo>
                )}
              </div>
              <div className="num text-[12px] text-tinta-400">
                saiu em {formatData(e.saiuEm)} · {e.diasFora} dia(s)
                {e.previsaoDeVolta
                  ? ` · combinado para ${formatData(e.previsaoDeVolta)}`
                  : ''}
              </div>
              {e.observacao && (
                <div className="mt-0.5 text-[12px] text-tinta-500">
                  {e.observacao}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 flex justify-end border-t border-tinta-200 pt-4">
        <button type="button" onClick={onEditar} className="btn btn-primario">
          Editar cadastro
        </button>
      </div>
    </Janela>
  );
}
