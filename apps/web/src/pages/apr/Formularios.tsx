import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { IconeLixeira, IconeMais } from '../../components/icones';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Janela,
  Pagina,
  Selo,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { CATEGORIA_APR_LABEL } from '../../lib/status';
import type { CategoriaItemApr, ItemApr, ModeloApr } from '../../lib/types';

/**
 * O formulário em branco, editado pela tela.
 *
 * É o que faz o módulo crescer sem release. A lista de riscos da ILNET de hoje
 * não é a de daqui a um ano, e uma norma nova ou um EPI que passou a ser
 * obrigatório não podem esperar alguém mexer no código — quem sabe disso é a
 * segurança do trabalho, não quem tem acesso ao repositório.
 *
 * Um formulário inteiro novo (poda em rede aérea, espaço confinado) nasce aqui
 * também, copiando os itens de um que já existe: o segundo modelo quase nunca
 * é diferente do primeiro, e obrigar a recadastrar oitenta linhas é o jeito
 * mais certo de um cadastro flexível deixar de ser usado.
 */

const BLOCOS: CategoriaItemApr[] = [
  'NORMA',
  'ATIVIDADE',
  'RISCO',
  'FERRAMENTA',
  'PROTECAO',
  'RELATO',
];

export function Formularios() {
  const qc = useQueryClient();
  const [modeloId, setModeloId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [erro, setErro] = useState(false);
  const [criando, setCriando] = useState(false);
  const [editandoTextos, setEditandoTextos] = useState(false);

  function avisar(texto: string, falhou = false) {
    setErro(falhou);
    setFeedback(texto);
    if (!falhou) setTimeout(() => setFeedback(null), 4000);
  }

  const modelos = useQuery({
    queryKey: ['apr-modelos'],
    queryFn: async () =>
      (await api.get<ModeloApr[]>('/apr/modelos', { params: { todos: true } }))
        .data,
  });

  const modelo =
    modelos.data?.find((m) => m.id === modeloId) ??
    modelos.data?.find((m) => m.padrao) ??
    modelos.data?.[0];

  const itens = useQuery({
    queryKey: ['apr-itens', modelo?.id],
    queryFn: async () =>
      (await api.get<ItemApr[]>(`/apr/modelos/${modelo!.id}/itens`)).data,
    enabled: !!modelo,
  });

  function invalidar() {
    void qc.invalidateQueries({ queryKey: ['apr-itens', modelo?.id] });
    // O formulário que os técnicos abrem também mudou.
    void qc.invalidateQueries({ queryKey: ['apr-formulario'] });
  }

  const criarItem = useMutation({
    mutationFn: async (dados: {
      categoria: CategoriaItemApr;
      textoItem: string;
      pedeDetalhe?: boolean;
    }) => (await api.post<ItemApr>(`/apr/modelos/${modelo!.id}/itens`, dados)).data,
    onSuccess: (item) => {
      avisar(`"${item.texto}" entrou na lista.`);
      invalidar();
    },
    onError: (e) => avisar(mensagemErro(e), true),
  });

  const alterarItem = useMutation({
    mutationFn: async ({
      id,
      dados,
    }: {
      id: string;
      dados: Record<string, unknown>;
    }) => (await api.patch<ItemApr>(`/apr/itens/${id}`, dados)).data,
    onSuccess: () => invalidar(),
    onError: (e) => avisar(mensagemErro(e), true),
  });

  const removerItem = useMutation({
    mutationFn: async (id: string) =>
      (await api.delete<{ apagado: boolean }>(`/apr/itens/${id}`)).data,
    onSuccess: (r) => {
      avisar(
        r.apagado
          ? 'Item apagado.'
          : 'Este item já foi usado em APRs, então foi só desativado — ' +
              'some do formulário e continua respondendo pelo que já assinaram.',
      );
      invalidar();
    },
    onError: (e) => avisar(mensagemErro(e), true),
  });

  const salvarTextos = useMutation({
    mutationFn: async (dados: Record<string, unknown>) =>
      (await api.patch<ModeloApr>(`/apr/modelos/${modelo!.id}`, dados)).data,
    onSuccess: () => {
      avisar('Formulário atualizado.');
      setEditandoTextos(false);
      void qc.invalidateQueries({ queryKey: ['apr-modelos'] });
      void qc.invalidateQueries({ queryKey: ['apr-formulario'] });
    },
    onError: (e) => avisar(mensagemErro(e), true),
  });

  if (modelos.isLoading) return <Carregando texto="Carregando…" />;

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Segurança do Trabalho"
        titulo="Formulários"
        descricao="Conteúdo do formulário da APR. As alterações valem para as próximas análises; as já assinadas preservam o texto vigente na data."
        acoes={
          <>
            <button
              type="button"
              onClick={() => setEditandoTextos(true)}
              disabled={!modelo}
              className="btn btn-neutro"
            >
              Orientações e plano de resgate
            </button>
            <button
              type="button"
              onClick={() => setCriando(true)}
              className="btn btn-primario"
            >
              <IconeMais className="h-4 w-4" />
              Novo formulário
            </button>
          </>
        }
      />

      {feedback && <Aviso tom={erro ? 'erro' : 'pago'}>{feedback}</Aviso>}

      {(modelos.data?.length ?? 0) > 1 && (
        <div className="surgir mb-5 flex flex-wrap gap-1.5">
          {modelos.data!.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setModeloId(m.id)}
              aria-pressed={m.id === modelo?.id}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                m.id === modelo?.id
                  ? 'bg-barra text-white'
                  : 'border border-tinta-200 bg-papel text-tinta-600 hover:border-tinta-300'
              }`}
            >
              {m.nome}
              {m.padrao ? ' ·' : ''}
            </button>
          ))}
        </div>
      )}

      {modelo && (
        <div className="surgir surgir-1 mb-5 flex flex-wrap items-center gap-2">
          <h2 className="font-display text-[17px] font-semibold text-tinta-900">
            {modelo.nome}
          </h2>
          {modelo.padrao && <Selo tom="marca">Abre por padrão</Selo>}
          {!modelo.ativo && <Selo tom="neutro">Desativado</Selo>}
          {!modelo.padrao && (
            <button
              type="button"
              onClick={() => salvarTextos.mutate({ padrao: true })}
              className="btn btn-sutil btn-p"
            >
              Tornar padrão
            </button>
          )}
        </div>
      )}

      {itens.isLoading && <Carregando texto="Carregando…" />}

      {modelo && itens.data && (
        <div className="space-y-5">
          {BLOCOS.map((categoria) => (
            <BlocoDoCatalogo
              key={categoria}
              categoria={categoria}
              itens={itens.data!.filter((i) => i.categoria === categoria)}
              onCriar={(textoItem, pedeDetalhe) =>
                criarItem.mutate({ categoria, textoItem, pedeDetalhe })
              }
              onAlterar={(id, dados) => alterarItem.mutate({ id, dados })}
              onRemover={(id) => removerItem.mutate(id)}
            />
          ))}
        </div>
      )}

      {criando && (
        <NovoFormulario
          modelos={modelos.data ?? []}
          onFechar={() => setCriando(false)}
          onCriado={(novo) => {
            setCriando(false);
            setModeloId(novo.id);
            avisar(`Formulário "${novo.nome}" criado.`);
            void qc.invalidateQueries({ queryKey: ['apr-modelos'] });
          }}
          onErro={(m) => avisar(m, true)}
        />
      )}

      {editandoTextos && modelo && (
        <EditarTextos
          modelo={modelo}
          pendente={salvarTextos.isPending}
          onSalvar={(dados) => salvarTextos.mutate(dados)}
          onFechar={() => setEditandoTextos(false)}
        />
      )}
    </Pagina>
  );
}

/** Uma categoria do catálogo, com os itens dela e o campo de acrescentar. */
function BlocoDoCatalogo({
  categoria,
  itens,
  onCriar,
  onAlterar,
  onRemover,
}: {
  categoria: CategoriaItemApr;
  itens: ItemApr[];
  onCriar: (texto: string, pedeDetalhe: boolean) => void;
  onAlterar: (id: string, dados: Record<string, unknown>) => void;
  onRemover: (id: string) => void;
}) {
  const [novo, setNovo] = useState('');
  const [pedeDetalhe, setPedeDetalhe] = useState(false);
  const relato = categoria === 'RELATO';

  return (
    <Bloco
      titulo={CATEGORIA_APR_LABEL[categoria]}
      acao={
        <span className="text-xs text-tinta-400">
          {itens.filter((i) => i.ativo).length} em uso
        </span>
      }
    >
      <ul className="lista-dividida">
        {itens.map((item) => (
          <li
            key={item.id}
            className={`flex flex-wrap items-center gap-2 py-2 ${
              item.ativo ? '' : 'opacity-50'
            }`}
          >
            <input
              defaultValue={item.texto}
              onBlur={(e) => {
                const textoItem = e.target.value.trim();
                if (textoItem && textoItem !== item.texto) {
                  onAlterar(item.id, { textoItem });
                }
              }}
              className="campo min-w-0 flex-1"
              aria-label={`Texto de ${item.texto}`}
            />

            {/* O "Outros, quais?" e os parentes dele: marcar abre um campo. */}
            {!relato && (
              <label className="opcao" title="Marcar este item abre um campo de texto">
                <input
                  type="checkbox"
                  className="marcador"
                  checked={item.pedeDetalhe}
                  onChange={(e) =>
                    onAlterar(item.id, { pedeDetalhe: e.target.checked })
                  }
                />
                pede detalhe
              </label>
            )}

            {/*
              O que é verdade em todo serviço da casa nasce marcado, e ao
              técnico cabe conferir. Quem decide isso é a segurança do
              trabalho, aqui — não o código, e não quem preenche em campo.
            */}
            {!relato && (
              <label
                className="opcao"
                title="O item já vem marcado numa APR nova. Continua desmarcável em campo."
              >
                <input
                  type="checkbox"
                  className="marcador"
                  checked={item.marcadoPorPadrao}
                  onChange={(e) =>
                    onAlterar(item.id, { marcadoPorPadrao: e.target.checked })
                  }
                />
                já vem marcado
              </label>
            )}

            {relato && (
              <label
                className="opcao"
                title='Responder "Não" obriga a escrever o que foi feito a respeito'
              >
                <input
                  type="checkbox"
                  className="marcador"
                  checked={item.exigeProvidencia}
                  onChange={(e) =>
                    onAlterar(item.id, { exigeProvidencia: e.target.checked })
                  }
                />
                exige providência
              </label>
            )}

            <label className="opcao" title="Desativado some do formulário">
              <input
                type="checkbox"
                className="marcador"
                checked={item.ativo}
                onChange={(e) => onAlterar(item.id, { ativo: e.target.checked })}
              />
              em uso
            </label>

            <button
              type="button"
              onClick={() => onRemover(item.id)}
              aria-label={`Remover ${item.texto}`}
              className="btn btn-perigo btn-p"
            >
              <IconeLixeira className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-tinta-200 pt-4">
        <input
          value={novo}
          onChange={(e) => setNovo(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && novo.trim().length >= 2) {
              onCriar(novo.trim(), pedeDetalhe);
              setNovo('');
              setPedeDetalhe(false);
            }
          }}
          className="campo min-w-0 flex-1"
          placeholder={
            relato
              ? 'Nova pergunta do relato (termine com "?")'
              : 'Acrescentar à lista'
          }
        />
        {!relato && (
          <label className="opcao">
            <input
              type="checkbox"
              className="marcador"
              checked={pedeDetalhe}
              onChange={(e) => setPedeDetalhe(e.target.checked)}
            />
            pede detalhe
          </label>
        )}
        <button
          type="button"
          disabled={novo.trim().length < 2}
          onClick={() => {
            onCriar(novo.trim(), pedeDetalhe);
            setNovo('');
            setPedeDetalhe(false);
          }}
          className="btn btn-primario btn-p shrink-0"
        >
          Acrescentar
        </button>
      </div>
    </Bloco>
  );
}

/** Um formulário novo, quase sempre copiado de um que já existe. */
function NovoFormulario({
  modelos,
  onFechar,
  onCriado,
  onErro,
}: {
  modelos: ModeloApr[];
  onFechar: () => void;
  onCriado: (m: ModeloApr) => void;
  onErro: (mensagem: string) => void;
}) {
  const [nome, setNome] = useState('');
  const [titulo, setTitulo] = useState('');
  const [tipoTrabalho, setTipoTrabalho] = useState('');
  const [copiarDe, setCopiarDe] = useState(modelos[0]?.id ?? '');

  const criar = useMutation({
    mutationFn: async () =>
      (
        await api.post<ModeloApr>('/apr/modelos', {
          nome: nome.trim(),
          titulo: titulo.trim(),
          tipoTrabalho: tipoTrabalho.trim(),
          copiarDe: copiarDe || undefined,
        })
      ).data,
    onSuccess: onCriado,
    onError: (e) => onErro(mensagemErro(e)),
  });

  return (
    <Janela titulo="Novo formulário" onFechar={onFechar}>
      <div className="space-y-4">
        <div>
          <label className="rotulo" htmlFor="novo-nome">
            Nome
          </label>
          <input
            id="novo-nome"
            className="campo"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Espaço confinado"
          />
        </div>

        <div>
          <label className="rotulo" htmlFor="novo-titulo">
            Título impresso
          </label>
          <input
            id="novo-titulo"
            className="campo"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="ANÁLISE DE RISCO PARA ESPAÇO CONFINADO (NR-33)"
          />
        </div>

        <div>
          <label className="rotulo" htmlFor="novo-tipo">
            Tipo de trabalho
          </label>
          <input
            id="novo-tipo"
            className="campo"
            value={tipoTrabalho}
            onChange={(e) => setTipoTrabalho(e.target.value)}
            placeholder="Espaço confinado"
          />
        </div>

        {modelos.length > 0 && (
          <div>
            <label className="rotulo" htmlFor="copiar">
              Copiar os itens de
            </label>
            <select
              id="copiar"
              className="campo"
              value={copiarDe}
              onChange={(e) => setCopiarDe(e.target.value)}
            >
              <option value="">Começar em branco</option>
              {modelos.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nome}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={onFechar} className="btn btn-neutro">
          Voltar
        </button>
        <button
          type="button"
          onClick={() => criar.mutate()}
          disabled={
            criar.isPending ||
            nome.trim().length < 3 ||
            titulo.trim().length < 3 ||
            tipoTrabalho.trim().length < 3
          }
          className="btn btn-primario"
        >
          {criar.isPending ? 'Criando…' : 'Criar formulário'}
        </button>
      </div>
    </Janela>
  );
}

/** As orientações e o plano de resgate — o texto fixo que sai no papel. */
function EditarTextos({
  modelo,
  pendente,
  onSalvar,
  onFechar,
}: {
  modelo: ModeloApr;
  pendente: boolean;
  onSalvar: (dados: Record<string, unknown>) => void;
  onFechar: () => void;
}) {
  const [titulo, setTitulo] = useState(modelo.titulo);
  const [orientacoes, setOrientacoes] = useState(modelo.orientacoes);
  const [planoResgate, setPlanoResgate] = useState(modelo.planoResgate);
  const [telefones, setTelefones] = useState(modelo.telefonesEmergencia);

  return (
    <Janela titulo="Orientações e plano de resgate" onFechar={onFechar}>
      <p className="text-sm leading-relaxed text-tinta-600">
        Texto fixo impresso na APR. As análises já assinadas preservam a versão
        vigente na data da assinatura.
      </p>

      <div className="mt-5 space-y-4">
        <div>
          <label className="rotulo" htmlFor="tit">
            Título impresso
          </label>
          <input
            id="tit"
            className="campo"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
          />
        </div>

        <div>
          <label className="rotulo" htmlFor="ori">
            Orientações de segurança e prevenção de acidentes
          </label>
          <textarea
            id="ori"
            className="campo min-h-[220px] resize-y font-sans text-[13px] leading-relaxed"
            value={orientacoes}
            onChange={(e) => setOrientacoes(e.target.value)}
          />
        </div>

        <div>
          <label className="rotulo" htmlFor="pla">
            Plano de resgate e emergência
          </label>
          <textarea
            id="pla"
            className="campo min-h-[200px] resize-y font-sans text-[13px] leading-relaxed"
            value={planoResgate}
            onChange={(e) => setPlanoResgate(e.target.value)}
          />
        </div>

        <div>
          <label className="rotulo" htmlFor="tel">
            Telefones de emergência
          </label>
          <input
            id="tel"
            className="campo"
            value={telefones}
            onChange={(e) => setTelefones(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button type="button" onClick={onFechar} className="btn btn-neutro">
          Voltar
        </button>
        <button
          type="button"
          onClick={() =>
            onSalvar({
              titulo: titulo.trim(),
              orientacoes: orientacoes.trim(),
              planoResgate: planoResgate.trim(),
              telefonesEmergencia: telefones.trim(),
            })
          }
          disabled={pendente}
          className="btn btn-primario"
        >
          {pendente ? 'Salvando…' : 'Salvar'}
        </button>
      </div>
    </Janela>
  );
}
