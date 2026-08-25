import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Aviso,
  Bloco,
  CabecalhoPagina,
  Carregando,
  Janela,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { formatData } from '../../lib/format';
import type {
  DocumentoRh,
  EstanteRh,
  Licitacao,
  PastaRh,
} from '../../lib/types';
import { FormularioDoDocumento, Validade } from './Pasta';

/** A gaveta do papel trocado não entra na montagem: ela é o que já não vale. */
const SUBSTITUIDOS = 'substituídos';

/** Em que ponto da montagem a janela está. */
type Montagem =
  | { etapa: 'empresa'; licitacao: Licitacao }
  | { etapa: 'documentos'; licitacao: Licitacao; fonte: PastaRh }
  | { etapa: 'pronto'; licitacao: Licitacao; copiados: number; repetidos: number };

/**
 * Licitações — a pasta que se monta para entregar.
 *
 * O trabalho que esta tela substitui é o de sempre: abrir a pasta da empresa,
 * baixar catorze certidões uma a uma, juntá-las numa pasta do computador e
 * mandar. O que se perde nesse caminho não é tempo — é saber, depois, **o que
 * foi entregue**: a certidão é substituída no mês seguinte, e a pergunta "que
 * documento eu mandei naquele pregão?" fica sem lugar onde ser respondida.
 *
 * Por isso o documento entra na licitação por cópia, e não por atalho: a pasta
 * é a fotografia do dia do envio. Renovar a certidão na pasta da empresa não
 * reescreve o que já foi mandado.
 *
 * O que é feito por fora — proposta, planilha de preços, procuração — entra
 * pelo mesmo lugar, no botão de anexar: a pasta da licitação tem de ser o
 * pacote inteiro, senão ela vira meia resposta e alguém volta a montar o resto
 * na mão.
 */
export function Licitacoes() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [nomeando, setNomeando] = useState(false);
  const [nome, setNome] = useState('');
  const [montagem, setMontagem] = useState<Montagem | null>(null);
  const [anexando, setAnexando] = useState<Licitacao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  const licitacoes = useQuery({
    queryKey: ['rh', 'licitacoes'],
    queryFn: async () => (await api.get<Licitacao[]>('/rh/licitacoes')).data,
  });

  const estante = useQuery({
    queryKey: ['rh', 'pastas'],
    queryFn: async () => (await api.get<EstanteRh>('/rh/pastas')).data,
  });

  function avisar(texto: string) {
    setFeito(texto);
    setTimeout(() => setFeito(null), 4000);
  }

  function recarregar() {
    void qc.invalidateQueries({ queryKey: ['rh', 'licitacoes'] });
    void qc.invalidateQueries({ queryKey: ['rh', 'pastas'] });
    void qc.invalidateQueries({ queryKey: ['rh', 'documentos'] });
  }

  const abrir = useMutation({
    mutationFn: async (nomeDela: string) =>
      (await api.post<Licitacao>('/rh/licitacoes', { nome: nomeDela })).data,
    onSuccess: (l) => {
      setNomeando(false);
      setNome('');
      setErro(null);
      recarregar();
      // A pasta nasceu vazia; o passo seguinte é o motivo de ela existir.
      setMontagem({ etapa: 'empresa', licitacao: l });
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const copiar = useMutation({
    mutationFn: async (args: { licitacao: Licitacao; ids: string[] }) =>
      (
        await api.post<{ copiados: number; repetidos: number }>(
          `/rh/licitacoes/${args.licitacao.id}/documentos`,
          { documentoIds: args.ids },
        )
      ).data,
    onSuccess: (r, args) => {
      setErro(null);
      recarregar();
      setMontagem({ etapa: 'pronto', licitacao: args.licitacao, ...r });
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const anexar = useMutation({
    mutationFn: async (args: { pastaId: string } & Record<string, unknown>) =>
      (await api.post<DocumentoRh>('/rh/documentos', args)).data,
    onSuccess: (d) => {
      setAnexando(null);
      setErro(null);
      avisar(`"${d.titulo}" anexado à licitação.`);
      recarregar();
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const lista = licitacoes.data ?? [];
  const pastas = estante.data?.pastas ?? [];
  const daEmpresa = pastas.find((p) => p.daEmpresa) ?? null;
  /*
   * De onde os documentos saem.
   *
   * A pasta da empresa, e as divisórias dela — é ali que moram as certidões, o
   * contrato social e o alvará. Quando a casa tem mais de um CNPJ, cada um é
   * uma pasta dentro da da empresa, e é essa a escolha que este passo faz.
   */
  const fontes = daEmpresa
    ? [
        daEmpresa,
        ...pastas.filter(
          (p) =>
            p.paiId === daEmpresa.id &&
            p.nome.trim().toLowerCase() !== SUBSTITUIDOS,
        ),
      ]
    : [];

  return (
    <Pagina>
      <CabecalhoPagina
        secao="Licitações"
        titulo="A pasta que vai ser entregue"
        descricao="Cada licitação é uma pasta com cópia do que foi mandado. A certidão renovada depois não muda o que já saiu daqui — é por isso que dá para responder, meses adiante, o que exatamente foi entregue."
        acoes={
          <button
            onClick={() => {
              setErro(null);
              setNomeando(true);
            }}
            className="btn btn-primario"
          >
            Iniciar nova licitação
          </button>
        }
      />

      {feito && <Aviso tom="pago">{feito}</Aviso>}
      {erro && !nomeando && !montagem && !anexando && (
        <Aviso tom="erro">{erro}</Aviso>
      )}

      <Bloco semPadding>
        {licitacoes.isLoading ? (
          <Carregando texto="Abrindo as licitações…" />
        ) : lista.length === 0 ? (
          <Vazio titulo="Nenhuma licitação ainda">
            Comece pelo botão "Iniciar nova licitação": ele cria a pasta, mostra
            a empresa e deixa você marcar, de uma vez, os documentos que vão
            junto.
          </Vazio>
        ) : (
          <div className="overflow-x-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th">Licitação</th>
                  <th className="th">Aberta em</th>
                  <th className="th">Na pasta</th>
                  <th className="th text-right">Ação</th>
                </tr>
              </thead>
              <tbody>
                {lista.map((l) => (
                  <tr key={l.id} className="linha">
                    <td className="td">
                      <div className="font-medium text-tinta-800">{l.nome}</div>
                    </td>
                    <td className="td whitespace-nowrap text-tinta-500">
                      {formatData(l.criadaEm)}
                    </td>
                    <td className="td whitespace-nowrap">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="num text-tinta-600">
                          {l.qtd} documento(s)
                        </span>
                        {/* Certidão vencida dentro do pacote é o erro que
                            desclassifica — ela precisa gritar aqui, e não
                            só depois de a pasta ser aberta. */}
                        {l.vencidos > 0 && (
                          <Selo pequeno tom="erro">
                            {l.vencidos} vencido(s)
                          </Selo>
                        )}
                        {l.aVencer > 0 && (
                          <Selo pequeno tom="atencao">
                            {l.aVencer} vencendo
                          </Selo>
                        )}
                      </div>
                    </td>
                    <td className="td whitespace-nowrap text-right">
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => {
                            setErro(null);
                            setMontagem({ etapa: 'empresa', licitacao: l });
                          }}
                          className="btn btn-p btn-ferramenta"
                        >
                          Adicionar documentos
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setErro(null);
                            setAnexando(l);
                          }}
                          className="btn btn-p btn-neutro"
                        >
                          Anexar arquivo
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate(`/rh/pastas/${l.id}`)}
                          className="btn btn-p btn-sutil"
                        >
                          Abrir pasta
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Bloco>

      {/* --- Passo 1: o nome da licitação --------------------------------- */}
      {nomeando && (
        <Janela titulo="Nova licitação" onFechar={() => setNomeando(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (nome.trim().length >= 2) abrir.mutate(nome);
            }}
          >
            <label className="rotulo" htmlFor="nome-da-licitacao">
              Como esta licitação se chama
            </label>
            <input
              id="nome-da-licitacao"
              value={nome}
              autoFocus
              onChange={(e) => setNome(e.target.value)}
              placeholder="Ex.: Pregão Eletrônico 12/2026 — Prefeitura de Bacabal"
              className="campo"
            />
            <p className="ajuda">
              É o nome da pasta. Ponha o que você usaria para achá-la daqui a um
              ano — o órgão e o número do edital costumam bastar.
            </p>

            {erro && <Aviso tom="erro">{erro}</Aviso>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNomeando(false)}
                className="btn btn-neutro"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={nome.trim().length < 2 || abrir.isPending}
                className="btn btn-primario"
              >
                {abrir.isPending ? 'Criando a pasta…' : 'Criar e escolher a empresa'}
              </button>
            </div>
          </form>
        </Janela>
      )}

      {/* --- Passo 2: de qual empresa saem os documentos -------------------

          As três janelas da montagem somem enquanto a de anexar está aberta:
          duas por cima da outra respondem as duas ao Esc, e quem fecha o anexo
          fecharia junto o passo em que estava. --- */}
      {montagem?.etapa === 'empresa' && !anexando && (
        <Janela
          titulo={`${montagem.licitacao.nome} — de qual empresa?`}
          onFechar={() => setMontagem(null)}
        >
          {estante.isLoading ? (
            <Carregando texto="Lendo a estante…" />
          ) : fontes.length === 0 ? (
            <Vazio titulo="A pasta da empresa ainda não existe">
              Ela nasce sozinha na primeira vez que a estante abre. Passe em
              "Pastas" e volte aqui.
            </Vazio>
          ) : (
            <>
              <p className="text-sm text-tinta-500">
                Os documentos vão sair daqui. Escolhendo a pasta de cima, você vê
                também o que está nas divisórias dela.
              </p>
              <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {fontes.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() =>
                      setMontagem({
                        etapa: 'documentos',
                        licitacao: montagem.licitacao,
                        fonte: f,
                      })
                    }
                    className="rounded-xl border border-tinta-200 px-4 py-3 text-left transition hover:border-brand-400 hover:bg-brand-50 dark:hover:bg-brand-500/10"
                  >
                    <span className="block font-semibold text-tinta-800">
                      {f.nome}
                    </span>
                    <span className="block text-xs text-tinta-400">
                      {f.naArvore.qtd} documento(s)
                      {f.naArvore.vencidos > 0
                        ? ` · ${f.naArvore.vencidos} vencido(s)`
                        : ''}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={() => setMontagem(null)}
              className="btn btn-neutro"
            >
              Fechar
            </button>
          </div>
        </Janela>
      )}

      {/* --- Passo 3: marcar o que vai junto ------------------------------ */}
      {montagem?.etapa === 'documentos' && !anexando && (
        <Janela
          titulo={`${montagem.licitacao.nome} — o que vai junto`}
          onFechar={() => setMontagem(null)}
        >
          <EscolhaDosDocumentos
            key={`${montagem.licitacao.id}-${montagem.fonte.id}`}
            licitacao={montagem.licitacao}
            fonte={montagem.fonte}
            pastas={pastas}
            erro={erro}
            pendente={copiar.isPending}
            onVoltar={() =>
              setMontagem({ etapa: 'empresa', licitacao: montagem.licitacao })
            }
            onEnviar={(ids) =>
              copiar.mutate({ licitacao: montagem.licitacao, ids })
            }
            onAnexar={() => setAnexando(montagem.licitacao)}
          />
        </Janela>
      )}

      {/* --- Fim: o que entrou, e o que fazer agora ------------------------ */}
      {montagem?.etapa === 'pronto' && !anexando && (
        <Janela
          titulo={`${montagem.licitacao.nome} — pronto`}
          onFechar={() => setMontagem(null)}
        >
          <Aviso tom="pago">
            {montagem.copiados === 0
              ? 'Nenhum documento novo entrou — todos os marcados já estavam na pasta.'
              : `${montagem.copiados} documento(s) copiados para a pasta da licitação.`}
            {montagem.repetidos > 0 && montagem.copiados > 0
              ? ` ${montagem.repetidos} já estavam lá e não entraram de novo.`
              : ''}
          </Aviso>

          <p className="mt-3 text-sm text-tinta-500">
            O que é feito por fora — proposta, planilha de preços, procuração —
            entra pelo botão de anexar. A pasta da licitação tem de ser o pacote
            inteiro.
          </p>

          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={() =>
                setMontagem({
                  etapa: 'empresa',
                  licitacao: montagem.licitacao,
                })
              }
              className="btn btn-neutro mr-auto"
            >
              Marcar mais documentos
            </button>
            <button
              type="button"
              onClick={() => setAnexando(montagem.licitacao)}
              className="btn btn-neutro"
            >
              Anexar arquivo de fora
            </button>
            <button
              type="button"
              onClick={() => navigate(`/rh/pastas/${montagem.licitacao.id}`)}
              className="btn btn-primario"
            >
              Abrir a pasta da licitação
            </button>
          </div>
        </Janela>
      )}

      {/* --- O anexo feito por fora --------------------------------------- */}
      {anexando && (
        <Janela
          titulo={`Anexar à licitação — ${anexando.nome}`}
          onFechar={() => setAnexando(null)}
        >
          <FormularioDoDocumento
            tipos={estante.data?.tipos ?? []}
            pendente={anexar.isPending}
            erro={erro}
            onSalvar={(dados) =>
              anexar.mutate({ ...dados, pastaId: anexando.id })
            }
          />
        </Janela>
      )}
    </Pagina>
  );
}

/**
 * A lista do que **ainda não está** na licitação, com uma caixa em cada linha.
 *
 * Quem volta para acrescentar o que faltou não quer rever os quarenta papéis:
 * quer os que ficaram de fora. Listar tudo de novo, com doze deles já dentro da
 * pasta e sem nada dizendo isso, faz a mesma escolha ser refeita no escuro — e
 * marcar de novo o que já foi não muda nada (a API recusa a repetição), o que é
 * pior: o trabalho parece ter acontecido e não aconteceu.
 *
 * A comparação é pelo título, que é a mesma régua com que a API decide o que
 * não entra duas vezes — se fosse outra, a tela esconderia uma linha que o
 * servidor deixaria passar, ou o contrário.
 *
 * A marcação vive aqui dentro, e não na tela: trocar de empresa recomeça a
 * escolha, e é o que se espera — o que estava marcado era da outra pasta.
 *
 * A validade aparece do mesmo jeito que aparece na pasta, com a mesma cor e o
 * mesmo "faltam 8 dias", porque é a informação que decide o que vai: mandar
 * certidão vencida é o erro que desclassifica, e ele acontece justamente na
 * pressa de montar o pacote.
 */
function EscolhaDosDocumentos({
  licitacao,
  fonte,
  pastas,
  erro,
  pendente,
  onEnviar,
  onVoltar,
  onAnexar,
}: {
  licitacao: Licitacao;
  fonte: PastaRh;
  /** Todas as pastas, para dizer de qual divisória cada documento veio. */
  pastas: PastaRh[];
  erro: string | null;
  pendente: boolean;
  onEnviar: (ids: string[]) => void;
  onVoltar: () => void;
  onAnexar: () => void;
}) {
  const [marcados, setMarcados] = useState<Set<string>>(new Set());

  const documentos = useQuery({
    queryKey: ['rh', 'documentos', fonte.id, 'com-subpastas'],
    queryFn: async () =>
      (
        await api.get<DocumentoRh[]>('/rh/documentos', {
          params: { pastaId: fonte.id, comSubpastas: true },
        })
      ).data,
  });

  /** O que a licitação já tem — é ele que sai da lista de escolher. */
  const jaNaLicitacao = useQuery({
    queryKey: ['rh', 'documentos', licitacao.id, 'na-licitacao'],
    queryFn: async () =>
      (
        await api.get<DocumentoRh[]>('/rh/documentos', {
          params: { pastaId: licitacao.id },
        })
      ).data,
  });

  const naEmpresa = documentos.data ?? [];
  const dentro = new Set(
    (jaNaLicitacao.data ?? []).map((d) => d.titulo.trim().toLowerCase()),
  );
  const lista = naEmpresa.filter(
    (d) => !dentro.has(d.titulo.trim().toLowerCase()),
  );
  /** Quantos ficaram de fora da lista por já estarem na pasta. */
  const jaForam = naEmpresa.length - lista.length;

  function alternar(id: string) {
    setMarcados((atual) => {
      const proximo = new Set(atual);
      if (proximo.has(id)) proximo.delete(id);
      else proximo.add(id);
      return proximo;
    });
  }

  // As duas leituras esperam juntas: mostrar a lista antes de saber o que já
  // está na licitação acenderia por um instante justamente as linhas que este
  // filtro existe para tirar.
  if (documentos.isLoading || jaNaLicitacao.isLoading) {
    return <Carregando texto="Lendo o que a empresa tem…" />;
  }

  if (lista.length === 0) {
    return (
      <>
        <Vazio
          titulo={
            jaForam > 0
              ? 'Já foi tudo'
              : 'Esta pasta está vazia'
          }
        >
          {jaForam > 0
            ? `Os ${jaForam} documento(s) de "${fonte.nome}" já estão nesta licitação. O que falta, se falta, é o que se faz por fora.`
            : `Não há documento nenhum em "${fonte.nome}" para mandar junto.`}
        </Vazio>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onVoltar} className="btn btn-neutro">
            Escolher outra
          </button>
          <button type="button" onClick={onAnexar} className="btn btn-primario">
            Anexar arquivo de fora
          </button>
        </div>
      </>
    );
  }

  const vencidosMarcados = lista.filter(
    (d) => marcados.has(d.id) && d.prazo === 'vencido',
  ).length;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-tinta-500">
          {fonte.nome} — {lista.length} documento(s)
          {/* O que já entrou some da lista, mas não em silêncio: sem esta
              frase, a pasta de quarenta papéis que abre com vinte e oito
              parece ter perdido doze pelo caminho. */}
          {jaForam > 0 && (
            <span className="text-tinta-400">
              {' '}
              · {jaForam} já {jaForam === 1 ? 'está' : 'estão'} na licitação
            </span>
          )}
        </span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setMarcados(new Set(lista.map((d) => d.id)))}
            className="btn btn-p btn-sutil"
          >
            Marcar todos
          </button>
          {/* O atalho que se usa de verdade: o pacote é o que está valendo, e
              o vencido some da marcação em vez de ter de ser caçado nela. */}
          <button
            type="button"
            onClick={() =>
              setMarcados(
                new Set(
                  lista.filter((d) => d.prazo !== 'vencido').map((d) => d.id),
                ),
              )
            }
            className="btn btn-p btn-sutil"
          >
            Só os que não venceram
          </button>
          <button
            type="button"
            onClick={() => setMarcados(new Set())}
            className="btn btn-p btn-sutil"
          >
            Limpar
          </button>
        </div>
      </div>

      <div className="mt-3 max-h-[50vh] overflow-y-auto rolagem-fina rounded-xl border border-tinta-100">
        <table className="w-full text-sm">
          <tbody>
            {lista.map((d) => {
              const de = pastas.find((p) => p.id === d.pastaId);
              return (
                <tr key={d.id} className="linha">
                  <td className="td w-8 align-top">
                    <input
                      type="checkbox"
                      checked={marcados.has(d.id)}
                      onChange={() => alternar(d.id)}
                      aria-label={`Mandar "${d.titulo}" junto`}
                      className="mt-1 h-4 w-4 accent-brand-500"
                    />
                  </td>
                  <td className="td">
                    <label
                      onClick={() => alternar(d.id)}
                      className="block cursor-pointer font-medium text-tinta-800"
                    >
                      {d.titulo}
                    </label>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-tinta-400">
                      <Selo pequeno tom="neutro">
                        {d.tipo}
                      </Selo>
                      {/* De qual divisória ele veio: sem isto, dois papéis de
                          nome parecido em pastas diferentes viram um enigma. */}
                      {de && de.id !== fonte.id && <span>em {de.nome}</span>}
                    </div>
                  </td>
                  <td className="td whitespace-nowrap align-top">
                    <Validade documento={d} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {vencidosMarcados > 0 && (
        <Aviso tom="atencao">
          {vencidosMarcados === 1
            ? 'Um documento vencido está marcado.'
            : `${vencidosMarcados} documentos vencidos estão marcados.`}{' '}
          Eles vão do jeito que estão — renove na pasta da empresa antes, se for
          o caso.
        </Aviso>
      )}

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onVoltar}
          className="btn btn-neutro mr-auto"
        >
          Trocar de empresa
        </button>
        <button type="button" onClick={onAnexar} className="btn btn-neutro">
          Anexar arquivo de fora
        </button>
        <button
          type="button"
          onClick={() => onEnviar([...marcados])}
          disabled={marcados.size === 0 || pendente}
          className="btn btn-primario"
        >
          {pendente
            ? 'Copiando…'
            : `Mandar ${marcados.size} para a licitação`}
        </button>
      </div>
    </>
  );
}
