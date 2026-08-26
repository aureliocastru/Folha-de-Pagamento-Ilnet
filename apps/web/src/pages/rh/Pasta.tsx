import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
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
import { useAuth } from '../../lib/auth';
import { formatData } from '../../lib/format';
import type {
  DocumentoRh,
  EstanteRh,
  PastaRh,
  PrazoDoDocumento,
} from '../../lib/types';
import { CartaoDaPasta, FormularioDaPasta } from './Pastas';

/** O que a pasta aceita — o mesmo que a API guarda. */
const ACEITOS =
  '.pdf,.png,.jpg,.jpeg,.webp,.gif,.heic,.doc,.docx,.xls,.xlsx,.txt,.csv';

/**
 * Uma pasta aberta: o que há dentro dela.
 *
 * Os documentos vêm sem o arquivo — são megabytes cada, e a lista mostra
 * dezenas de linhas. Quem clica em "ver" pede aquele arquivo, e ele abre numa
 * aba: PDF e digitalização se leem no visualizador do navegador, que é melhor
 * do que qualquer coisa que esta tela fosse desenhar.
 */
export function PastaRhAberta({ pastaId }: { pastaId?: string } = {}) {
  // A rota manda quando há `:id` na URL; o `pastaId` serve a quem já sabe qual
  // pasta é — a da empresa, que tem porta própria no menu.
  const { id: idDaRota = '' } = useParams();
  const id = pastaId ?? idDaRota;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { usuario } = useAuth();
  const [termo, setTermo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [criandoSubpasta, setCriandoSubpasta] = useState(false);
  const [renomeando, setRenomeando] = useState(false);
  const [editando, setEditando] = useState<DocumentoRh | null>(null);
  const [substituindo, setSubstituindo] = useState<DocumentoRh | null>(null);
  /** Os documentos marcados para ir junto para outra pasta. */
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [movendo, setMovendo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<string | null>(null);

  const estante = useQuery({
    queryKey: ['rh', 'pastas'],
    queryFn: async () => (await api.get<EstanteRh>('/rh/pastas')).data,
  });

  const documentos = useQuery({
    queryKey: ['rh', 'documentos', id, termo],
    queryFn: async () =>
      (
        await api.get<DocumentoRh[]>('/rh/documentos', {
          params: { pastaId: id, termo: termo || undefined },
        })
      ).data,
    enabled: !!id,
  });

  const todas = estante.data?.pastas ?? [];
  const pasta = todas.find((p) => p.id === id);
  /** As pastas de dentro desta. */
  const subpastas = todas.filter((p) => p.paiId === id);
  /** O caminho até aqui, da estante para dentro. */
  const caminho = trilha(todas, pasta);

  /*
   * Quem pode mexer na pasta em si.
   *
   * O RH cuida da pasta que ele mesmo criou. O administrador mexe em todas —
   * inclusive na que veio do cadastro e na que tem papel dentro. O servidor
   * recusa de todo jeito; aqui o botão some, em vez de existir para dar erro.
   */
  const ehAdmin = usuario?.role === 'ADMIN';
  const podeMexerNaPasta = !!pasta && (ehAdmin || pasta.avulsa);
  /** As pastas que somem junto com esta. */
  const dentroDela = descendentes(todas, id);

  function avisar(texto: string) {
    setFeito(texto);
    setTimeout(() => setFeito(null), 3000);
  }

  function recarregar() {
    void qc.invalidateQueries({ queryKey: ['rh', 'documentos'] });
    void qc.invalidateQueries({ queryKey: ['rh', 'pastas'] });
  }

  const criarSubpasta = useMutation({
    mutationFn: async (dados: { nome: string }) =>
      (await api.post<PastaRh>('/rh/pastas', { ...dados, paiId: id })).data,
    onSuccess: (p) => {
      setCriandoSubpasta(false);
      setErro(null);
      avisar(`Pasta "${p.nome}" criada aqui dentro.`);
      recarregar();
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  /*
   * Arrumar a pasta: marcar papéis e mandar todos para outra divisória.
   *
   * A pasta enche pelo caminho mais rápido — guardar dez documentos é rápido —,
   * e é depois que alguém quer os balanços separados das certidões. Fazer isso
   * pela ficha de cada um é abrir e fechar dez janelas para uma decisão só, que
   * é o tipo de trabalho que não se faz e a pasta fica como está.
   *
   * A pasta de destino pode nascer aqui: quase sempre ela não existe ainda, e
   * mandar a pessoa criar a pasta noutra tela para voltar e marcar tudo de novo
   * é perder a marcação que ela acabou de fazer.
   */
  const mover = useMutation({
    mutationFn: async (destino: { pastaId?: string; novaPasta?: string }) => {
      const pastaId = destino.pastaId
        ? destino.pastaId
        : (
            await api.post<PastaRh>('/rh/pastas', {
              nome: destino.novaPasta,
              paiId: id,
            })
          ).data.id;

      return (
        await api.post<{
          movidos: number;
          sumiram: number;
          pasta: { id: string; nome: string };
        }>('/rh/documentos/mover', {
          documentoIds: [...marcados],
          pastaId,
        })
      ).data;
    },
    onSuccess: (r) => {
      setMovendo(false);
      setMarcados(new Set());
      setErro(null);
      avisar(
        `${r.movidos} documento(s) movidos para "${r.pasta.nome}".` +
          (r.sumiram > 0
            ? ` ${r.sumiram} não existiam mais e ficaram de fora.`
            : ''),
      );
      recarregar();
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const renomear = useMutation({
    mutationFn: async (dados: {
      nome: string;
      cpf?: string;
      seguirCadastro?: boolean;
    }) => (await api.patch<PastaRh>(`/rh/pastas/${id}`, dados)).data,
    onSuccess: () => {
      setRenomeando(false);
      setErro(null);
      avisar('Nome da pasta trocado.');
      recarregar();
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  /*
   * Apagar a pasta leva junto o que há dentro dela.
   *
   * É a ação mais cara desta tela, e a única em que a conta do estrago dá para
   * fazer antes: a estante já sabe quantos papéis e quantas divisórias estão
   * ali. A pergunta diz o número — "apagar esta pasta?" não é pergunta quando a
   * resposta certa depende de haver sete documentos dentro.
   */
  const apagarPasta = useMutation({
    mutationFn: async () =>
      (await api.delete<{ documentos: number }>(`/rh/pastas/${id}`)).data,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['rh', 'pastas'] });
      void qc.invalidateQueries({ queryKey: ['rh', 'documentos'] });
      navigate(pasta?.paiId ? `/rh/pastas/${pasta.paiId}` : '/rh/pastas');
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  function pedirParaApagar() {
    if (!pasta) return;
    const papeis = pasta.naArvore.qtd;
    const estrago = [
      papeis > 0 && `${papeis} documento${papeis > 1 ? 's' : ''}`,
      dentroDela > 0 && `${dentroDela} pasta${dentroDela > 1 ? 's' : ''}`,
    ].filter(Boolean);

    const pergunta = [
      `Apagar a pasta "${pasta.nome}"?`,
      estrago.length > 0
        ? `Vai junto o que está dentro dela: ${estrago.join(' e ')}. Os arquivos saem daqui e não voltam.`
        : 'Ela está vazia.',
      !pasta.avulsa &&
        'Esta pasta é do cadastro: ela volta vazia na próxima vez que a estante abrir, porque o funcionário continua lá.',
    ]
      .filter(Boolean)
      .join('\n\n');

    if (confirm(pergunta)) apagarPasta.mutate();
  }

  const guardar = useMutation({
    mutationFn: async (documentos: Record<string, unknown>[]) =>
      guardarLeva(documentos, id!),
    onSuccess: (leva) => {
      setGuardando(false);
      setErro(null);
      avisar(contarLeva(leva));
      recarregar();
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const editar = useMutation({
    mutationFn: async (dados: { id: string } & Record<string, unknown>) =>
      (await api.patch<DocumentoRh>(`/rh/documentos/${dados.id}`, dados)).data,
    onSuccess: () => {
      setEditando(null);
      setErro(null);
      avisar('Documento corrigido.');
      recarregar();
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  /*
   * Substituir é guardar o novo e descer o velho uma gaveta, num gesto só.
   *
   * Feito à mão seriam três passos — subir o novo, criar a pasta, mover o
   * velho —, e é no terceiro que se desiste: a certidão velha fica ao lado da
   * nova, com o mesmo título, e quem for pegar "a CND estadual" acha duas.
   */
  const substituir = useMutation({
    mutationFn: async (dados: { id: string } & Record<string, unknown>) =>
      (
        await api.post<{ documento: DocumentoRh; guardadoEm: string }>(
          `/rh/documentos/${dados.id}/substituir`,
          dados,
        )
      ).data,
    onSuccess: (r) => {
      setSubstituindo(null);
      setErro(null);
      avisar(`"${r.documento.titulo}" entrou no lugar. O anterior foi para "${r.guardadoEm}".`);
      recarregar();
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const apagar = useMutation({
    mutationFn: async (docId: string) => api.delete(`/rh/documentos/${docId}`),
    onSuccess: () => {
      avisar('Documento apagado.');
      recarregar();
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  /*
   * Apagar os marcados.
   *
   * Mesmo gesto do mover, e o oposto dele em consequência: o que se move está
   * na outra gaveta, e o que se apaga não está em lugar nenhum. Por isso a
   * pergunta antes lista os papéis pelo nome — "apagar 7 documentos?" é um
   * número, e ninguém confere um número; nome é o que faz alguém reconhecer
   * que marcou uma linha a mais.
   */
  const apagarVarios = useMutation({
    mutationFn: async (documentoIds: string[]) =>
      (
        await api.post<{ apagados: number; sumiram: number }>(
          '/rh/documentos/apagar-lote',
          { documentoIds },
        )
      ).data,
    onSuccess: (r) => {
      setMarcados(new Set());
      setErro(null);
      avisar(
        `${r.apagados} documento(s) apagados.` +
          (r.sumiram > 0 ? ` ${r.sumiram} já não existiam.` : ''),
      );
      recarregar();
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const lista = documentos.data ?? [];
  const vencidos = lista.filter((d) => d.prazo === 'vencido').length;
  const aVencer = lista.filter((d) => d.prazo === 'a-vencer').length;

  const marcadosNaLista = lista.filter((d) => marcados.has(d.id)).length;
  const todosMarcados = lista.length > 0 && marcadosNaLista === lista.length;
  const algunsMarcados = marcadosNaLista > 0 && !todosMarcados;

  function alternarMarca(idDoc: string) {
    setMarcados((atuais) => {
      const proximo = new Set(atuais);
      if (proximo.has(idDoc)) proximo.delete(idDoc);
      else proximo.add(idDoc);
      return proximo;
    });
  }

  /**
   * A pergunta antes de apagar, com os papéis pelo nome.
   *
   * Até dez nomes cabem numa caixa de confirmação sem virar um muro que
   * ninguém lê; passando disso, o resto vira "e mais N". O que a lista não
   * mostrar mais não é lido de qualquer jeito.
   */
  function pedirParaApagarMarcados() {
    const nomes = lista
      .filter((d) => marcados.has(d.id))
      .map((d) => d.titulo);
    // O marcado que a busca escondeu vai junto, e a pergunta precisa dizê-lo:
    // apagar o que não está na tela é a surpresa que não pode acontecer aqui.
    const escondidos = marcados.size - nomes.length;

    const pergunta = [
      `Apagar ${marcados.size} documento(s)? Os arquivos saem daqui e não voltam.`,
      nomes
        .slice(0, 10)
        .map((n) => `• ${n}`)
        .join('\n') +
        (nomes.length > 10 ? `\n• e mais ${nomes.length - 10}` : ''),
      escondidos > 0 &&
        `Mais ${escondidos} marcado(s) que a busca não está mostrando vão junto.`,
    ]
      .filter(Boolean)
      .join('\n\n');

    if (confirm(pergunta)) apagarVarios.mutate([...marcados]);
  }

  function alternarTodos() {
    setMarcados((atuais) => {
      const proximo = new Set(atuais);
      // Desmarcar tira só os que estão à vista: o que a busca escondeu foi
      // marcado por alguém que o viu, e continua marcado.
      if (todosMarcados) for (const d of lista) proximo.delete(d.id);
      else for (const d of lista) proximo.add(d.id);
      return proximo;
    });
  }

  /*
   * Voltar é a tela anterior, e não uma rota fixa.
   *
   * Quem chegou aqui pela estante volta para a estante; quem entrou numa
   * subpasta volta para a pasta de cima. Sem histórico do app — link colado,
   * aba nova —, sobra o caminho da árvore, que é para onde a seta apontaria de
   * qualquer forma.
   */
  function voltar() {
    const temHistorico =
      (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (temHistorico > 0) {
      navigate(-1);
      return;
    }
    navigate(pasta?.paiId ? `/rh/pastas/${pasta.paiId}` : '/rh/pastas');
  }

  return (
    <Pagina>
      <CabecalhoPagina
        voltar={voltar}
        secao={
          pasta?.daEmpresa ? 'Pasta da empresa' : (pasta?.funcao ?? 'Pasta')
        }
        titulo={pasta?.nome ?? 'Pasta'}
        descricao={
          pasta?.daEmpresa
            ? 'Contrato social, alvará, certidões — o que é da empresa e não de uma pessoa.'
            : 'Contrato, exames, advertências e os recibos de pagamento desta pessoa.'
        }
        acoes={
          <div className="flex flex-wrap gap-2">
            {/* Mexer na pasta em si vem antes do que se faz dentro dela, e por
                isso fica à esquerda: renomear e apagar são raros, e o botão que
                fecha a tela continua sendo o último da fila. */}
            {podeMexerNaPasta && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setErro(null);
                    setRenomeando(true);
                  }}
                  className="btn btn-neutro"
                >
                  Renomear
                </button>
                <button
                  type="button"
                  onClick={pedirParaApagar}
                  disabled={apagarPasta.isPending}
                  className="btn btn-perigo"
                  title="Apaga a pasta e o que estiver dentro dela"
                >
                  {apagarPasta.isPending ? 'Apagando…' : 'Apagar pasta'}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => {
                setErro(null);
                setCriandoSubpasta(true);
              }}
              className="btn btn-neutro"
            >
              + Nova pasta
            </button>
            <button
              type="button"
              onClick={() => {
                setErro(null);
                setGuardando(true);
              }}
              className="btn btn-primario"
            >
              Guardar documento
            </button>
          </div>
        }
      />

      {/* O caminho de volta. Dentro de uma subpasta, "todas as pastas" não
          basta: quem entrou em "Fulano / Exames" quer voltar ao Fulano. */}
      <nav className="surgir mb-4 flex flex-wrap items-center gap-1.5 text-sm text-tinta-400">
        <Link to="/rh/pastas" className="hover:text-tinta-700">
          Todas as pastas
        </Link>
        {caminho.map((p) => (
          <span key={p.id} className="flex items-center gap-1.5">
            <span aria-hidden>/</span>
            {p.id === id ? (
              <span className="text-tinta-700">{p.nome}</span>
            ) : (
              <Link to={`/rh/pastas/${p.id}`} className="hover:text-tinta-700">
                {p.nome}
              </Link>
            )}
          </span>
        ))}
      </nav>

      {feito && <Aviso tom="pago">{feito}</Aviso>}
      {erro && !guardando && !editando && !renomeando && !substituindo && (
        <Aviso tom="erro">{erro}</Aviso>
      )}

      {/* O que está vencido nesta pasta, antes de a lista começar.
          A validade é a única coisa aqui que muda sozinha com o tempo: um ASO
          que valia ontem não vale hoje, e ninguém abre a pasta para conferir
          data de exame — abre para pegar um papel. Se a pasta não disser, a
          descoberta vem no dia da fiscalização. */}
      {(vencidos > 0 || aVencer > 0) && (
        <Aviso tom={vencidos > 0 ? 'erro' : 'atencao'}>
          {fraseDoPrazo(vencidos, aVencer)}
        </Aviso>
      )}

      {subpastas.length > 0 && (
        <div className="surgir mb-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {subpastas.map((p) => (
            <CartaoDaPasta key={p.id} pasta={p} />
          ))}
        </div>
      )}

      <div className="surgir mb-5 flex flex-wrap items-center gap-3">
        <input
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Procurar nesta pasta"
          className="campo max-w-md"
        />

        {/* A barra do que está marcado fica junto da busca, e não flutuando
            sobre a lista: é ali que o olho já está quando se acaba de marcar,
            e uma barra por cima taparia justamente as linhas que se quer
            conferir antes de mover. */}
        {marcados.size > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-tinta-600">
              {marcados.size} marcado{marcados.size === 1 ? '' : 's'}
            </span>
            <button
              type="button"
              onClick={() => {
                setErro(null);
                setMovendo(true);
              }}
              className="btn btn-p btn-acao"
            >
              Mover para…
            </button>
            {/* Apagar fica depois de "Mover", e em vermelho: é o único aqui
                que não tem volta, e o vermelho é o que separa o clique certo
                do clique de reflexo em quem já usou a barra dez vezes. */}
            <button
              type="button"
              disabled={apagarVarios.isPending}
              onClick={pedirParaApagarMarcados}
              className="btn btn-p btn-perigo"
            >
              {apagarVarios.isPending ? 'Apagando…' : 'Apagar'}
            </button>
            <button
              type="button"
              onClick={() => setMarcados(new Set())}
              className="btn btn-p btn-sutil"
            >
              Limpar
            </button>
          </div>
        )}
      </div>

      {documentos.isLoading ? (
        <Carregando texto="Abrindo a pasta…" />
      ) : lista.length === 0 ? (
        <Vazio titulo={termo ? 'Nada com esse nome nesta pasta' : 'Pasta vazia'}>
          {termo
            ? 'Procure por outro pedaço do nome, do tipo ou da descrição.'
            : 'Guarde aqui o contrato, a CTPS, os exames e o que mais for desta pessoa. O recibo de pagamento do mês entra sozinho, pela tela de recibos da folha.'}
        </Vazio>
      ) : (
        <Bloco semPadding>
          <div className="overflow-x-auto rolagem-fina">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="th w-8">
                    {/* Marcar tudo é sobre o que está à vista: com uma busca
                        ativa, marca o que a busca achou. Marcar em silêncio o
                        que está filtrado fora seria mover papel que a pessoa
                        não viu. */}
                    <input
                      type="checkbox"
                      checked={todosMarcados}
                      ref={(el) => {
                        if (el) el.indeterminate = algunsMarcados;
                      }}
                      onChange={alternarTodos}
                      aria-label={
                        todosMarcados
                          ? 'Desmarcar todos'
                          : 'Marcar todos os que estão à vista'
                      }
                      className="h-4 w-4 accent-brand-500"
                    />
                  </th>
                  <th className="th">Documento</th>
                  <th className="th">Tipo</th>
                  <th className="th">Validade</th>
                  <th className="th text-right">Arquivo</th>
                  <th className="th text-right" />
                </tr>
              </thead>
              <tbody>
                {lista.map((d) => (
                  <LinhaDoDocumento
                    key={d.id}
                    documento={d}
                    marcado={marcados.has(d.id)}
                    onMarcar={() => alternarMarca(d.id)}
                    onEditar={() => {
                      setErro(null);
                      setEditando(d);
                    }}
                    onSubstituir={() => {
                      setErro(null);
                      setSubstituindo(d);
                    }}
                    onApagar={() => {
                      if (
                        confirm(
                          `Apagar "${d.titulo}"? O arquivo sai daqui e não volta.`,
                        )
                      ) {
                        apagar.mutate(d.id);
                      }
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </Bloco>
      )}

      {renomeando && pasta && (
        <Janela
          titulo={`Renomear — ${pasta.nome}`}
          onFechar={() => setRenomeando(false)}
        >
          <FormularioDaPasta
            pasta={pasta}
            /* Subpasta é divisória, e não pessoa: ali o CPF não quer dizer
               nada. Na estante ele fica, porque é por ele que o recibo do mês
               acha a pasta sozinho. */
            semCpf={!!pasta.paiId}
            pendente={renomear.isPending}
            erro={erro}
            onSalvar={(dados) => renomear.mutate(dados)}
            onSeguirCadastro={
              pasta.nomeManual
                ? () =>
                    renomear.mutate({ nome: pasta.nome, seguirCadastro: true })
                : undefined
            }
          />
        </Janela>
      )}

      {criandoSubpasta && (
        <Janela
          titulo={`Nova pasta dentro de ${pasta?.nome ?? 'esta'}`}
          onFechar={() => setCriandoSubpasta(false)}
        >
          <FormularioDaPasta
            semCpf
            pendente={criarSubpasta.isPending}
            erro={erro}
            onSalvar={(dados) => criarSubpasta.mutate({ nome: dados.nome })}
          />
        </Janela>
      )}

      {guardando && (
        <Janela titulo="Guardar documento" onFechar={() => setGuardando(false)}>
          <FormularioDoDocumento
            tipos={estante.data?.tipos ?? []}
            pendente={guardar.isPending}
            erro={erro}
            onSalvar={(documentos) => guardar.mutate(documentos)}
          />
        </Janela>
      )}

      {substituindo && (
        <Janela
          titulo={`Substituir — ${substituindo.titulo}`}
          onFechar={() => setSubstituindo(null)}
        >
          <FormularioDoDocumento
            documento={substituindo}
            substituindo
            tipos={estante.data?.tipos ?? []}
            pendente={substituir.isPending}
            erro={erro}
            onSalvar={([dados]) =>
              substituir.mutate({ id: substituindo.id, ...dados })
            }
          />
        </Janela>
      )}

      {movendo && (
        <Janela
          titulo={`Mover ${marcados.size} documento${
            marcados.size === 1 ? '' : 's'
          }`}
          onFechar={() => setMovendo(false)}
        >
          <ParaOndeMover
            aqui={pasta?.nome ?? 'esta pasta'}
            subpastas={subpastas}
            todas={todas}
            pastaAtualId={id}
            pendente={mover.isPending}
            erro={erro}
            onMover={(destino) => mover.mutate(destino)}
          />
        </Janela>
      )}

      {editando && (
        <Janela
          titulo={`Corrigir — ${editando.titulo}`}
          onFechar={() => setEditando(null)}
        >
          <FormularioDoDocumento
            documento={editando}
            tipos={estante.data?.tipos ?? []}
            pastas={todas}
            pendente={editar.isPending}
            erro={erro}
            onSalvar={([dados]) => editar.mutate({ id: editando.id, ...dados })}
          />
        </Janela>
      )}
    </Pagina>
  );
}

/**
 * A pasta da empresa, aberta pelo menu.
 *
 * Ela não tem endereço fixo — nasce do banco e leva um id que ninguém decora —,
 * então quem chega pelo menu descobre qual é antes de abrir. É um pedido a mais
 * que a estante já ia fazer de qualquer jeito: a mesma consulta serve às duas
 * telas e vem do cache na segunda.
 */
export function PastaDaEmpresa() {
  const estante = useQuery({
    queryKey: ['rh', 'pastas'],
    queryFn: async () => (await api.get<EstanteRh>('/rh/pastas')).data,
  });

  const empresa = estante.data?.pastas.find((p) => p.daEmpresa);

  if (estante.isLoading) {
    return (
      <Pagina>
        <Carregando texto="Abrindo a pasta da empresa…" />
      </Pagina>
    );
  }
  if (!empresa) {
    return (
      <Pagina>
        <Vazio titulo="A pasta da empresa não existe">
          Ela nasce sozinha quando a estante abre. Vá em Pastas e volte aqui.
        </Vazio>
      </Pagina>
    );
  }
  return <PastaRhAberta pastaId={empresa.id} />;
}

/**
 * Para onde vão os documentos marcados.
 *
 * Duas respostas, e a primeira é a que quase sempre se quer: uma pasta nova
 * aqui dentro. Quem marcou os cinco balanços está justamente criando a gaveta
 * "Balanços" — mandá-lo criar a pasta noutra tela e voltar custaria a marcação
 * que ele acabou de fazer.
 *
 * A segunda é a estante inteira, para o papel que foi parar na pasta errada e
 * precisa atravessar a árvore. A pasta em que já se está não aparece na lista:
 * mover para onde já está não é uma escolha, é um clique perdido.
 */
function ParaOndeMover({
  aqui,
  subpastas,
  todas,
  pastaAtualId,
  pendente,
  erro,
  onMover,
}: {
  aqui: string;
  subpastas: PastaRh[];
  todas: PastaRh[];
  pastaAtualId?: string;
  pendente: boolean;
  erro: string | null;
  onMover: (destino: { pastaId?: string; novaPasta?: string }) => void;
}) {
  const [novaPasta, setNovaPasta] = useState('');
  const [escolhida, setEscolhida] = useState('');

  const destinos = [...todas]
    .filter((p) => p.id !== pastaAtualId)
    .sort((a, b) =>
      caminhoLegivel(todas, a).localeCompare(caminhoLegivel(todas, b), 'pt-BR'),
    );

  return (
    <div className="p-5 sm:p-6">
      <div>
        <label className="rotulo" htmlFor="nova-pasta-do-movimento">
          Numa pasta nova, aqui dentro de “{aqui}”
        </label>
        <div className="flex flex-wrap gap-2">
          <input
            id="nova-pasta-do-movimento"
            value={novaPasta}
            onChange={(e) => {
              setNovaPasta(e.target.value);
              if (e.target.value) setEscolhida('');
            }}
            placeholder="Ex.: Balanços"
            className="campo flex-1"
          />
          <button
            type="button"
            disabled={novaPasta.trim().length < 2 || pendente}
            onClick={() => onMover({ novaPasta: novaPasta.trim() })}
            className="btn btn-primario"
          >
            {pendente ? 'Movendo…' : 'Criar e mover'}
          </button>
        </div>
        <p className="ajuda">
          A pasta é criada agora e os documentos entram nela. Eles não mudam em
          nada ao mudar de gaveta: mesmo arquivo, mesmas datas, outro lugar.
        </p>
      </div>

      {destinos.length > 0 && (
        <div className="mt-6 border-t border-tinta-100 pt-5">
          <label className="rotulo" htmlFor="pasta-de-destino">
            Ou numa pasta que já existe
          </label>
          <div className="flex flex-wrap gap-2">
            <select
              id="pasta-de-destino"
              value={escolhida}
              onChange={(e) => {
                setEscolhida(e.target.value);
                if (e.target.value) setNovaPasta('');
              }}
              className="campo flex-1"
            >
              <option value="">Escolha a pasta…</option>
              {destinos.map((p) => (
                <option key={p.id} value={p.id}>
                  {caminhoLegivel(todas, p)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!escolhida || pendente}
              onClick={() => onMover({ pastaId: escolhida })}
              className="btn btn-neutro"
            >
              {pendente ? 'Movendo…' : 'Mover'}
            </button>
          </div>
          {subpastas.length > 0 && (
            <p className="ajuda">
              As divisórias desta pasta aparecem na lista com o caminho inteiro,
              como “{caminhoLegivel(todas, subpastas[0])}”.
            </p>
          )}
        </div>
      )}

      {erro && (
        <div className="mt-4">
          <Aviso tom="erro">{erro}</Aviso>
        </div>
      )}
    </div>
  );
}

function LinhaDoDocumento({
  documento: d,
  marcado,
  onMarcar,
  onEditar,
  onSubstituir,
  onApagar,
}: {
  documento: DocumentoRh;
  marcado: boolean;
  onMarcar: () => void;
  onEditar: () => void;
  onSubstituir: () => void;
  onApagar: () => void;
}) {
  const [abrindo, setAbrindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  /*
   * O arquivo vem pela API autenticada, e não por um `href` direto: o token
   * vive no cabeçalho, e uma aba aberta na mão chegaria lá sem ele.
   */
  async function abrir() {
    setAbrindo(true);
    setErro(null);
    try {
      const { data } = await api.get<Blob>(`/rh/documentos/${d.id}/arquivo`, {
        responseType: 'blob',
      });
      const url = URL.createObjectURL(data);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setAbrindo(false);
    }
  }

  return (
    <tr className={`linha ${marcado ? 'bg-brand-500/5' : ''}`}>
      <td className="td w-8 align-top">
        <input
          type="checkbox"
          checked={marcado}
          onChange={onMarcar}
          aria-label={`Marcar "${d.titulo}"`}
          className="mt-1 h-4 w-4 accent-brand-500"
        />
      </td>
      <td className="td">
        <div className="font-medium text-tinta-800">{d.titulo}</div>
        {d.descricao && (
          <div className="text-xs text-tinta-400">{d.descricao}</div>
        )}
        {erro && <div className="text-xs text-rose-600">{erro}</div>}
      </td>
      <td className="td">
        <Selo pequeno tom="neutro">
          {d.tipo}
        </Selo>
        {d.competencia && (
          <span className="ml-2 text-xs text-tinta-400">
            {d.competencia.slice(5)}/{d.competencia.slice(0, 4)}
          </span>
        )}
      </td>
      <td className="td whitespace-nowrap">
        <Validade documento={d} />
      </td>
      <td className="td whitespace-nowrap text-right text-xs text-tinta-400">
        <div className="num">{emTamanho(d.arquivoTamanho)}</div>
        <div className="truncate">{d.arquivoNome}</div>
      </td>
      <td className="td whitespace-nowrap text-right">
        <div className="flex justify-end gap-1.5">
          <button
            type="button"
            onClick={abrir}
            disabled={abrindo}
            className="btn btn-p btn-ferramenta"
          >
            {abrindo ? 'Abrindo…' : 'Ver'}
          </button>
          {/* Em toda linha, e não só nas que têm prazo. Papel sem validade
              também é trocado: o contrato social ganha uma alteração, a
              licença sai reemitida, a digitalização torta é refeita — e nesses
              casos o gesto é o mesmo, guardar o novo e descer o velho para
              "Substituídos". Antes o botão sumia justamente onde o caminho à
              mão é mais longo, porque ali não há data que lembre ninguém.
              Aceso na cor do estado quando o prazo aperta: é a ação que a
              linha vermelha está pedindo, e ela não pode ter o mesmo peso de
              "corrigir" ao lado. */}
          <button
            type="button"
            onClick={onSubstituir}
            className={`btn btn-p ${
              d.prazo === 'vencido' || d.prazo === 'a-vencer'
                ? 'btn-ferramenta'
                : 'btn-sutil'
            }`}
            title="Guarda o documento novo aqui e manda este para “Substituídos”"
          >
            Substituir
          </button>
          <button
            type="button"
            onClick={onEditar}
            className="btn btn-p btn-neutro"
          >
            Corrigir
          </button>
          <button
            type="button"
            onClick={onApagar}
            className="btn btn-p btn-sutil"
            title="Apaga o documento e o arquivo"
          >
            Apagar
          </button>
        </div>
      </td>
    </tr>
  );
}

/**
 * A validade, com o peso que ela tem.
 *
 * Ela era a terceira linha de um bloco de letra miúda, do mesmo tamanho e do
 * mesmo cinza da data de emissão — e as duas não valem o mesmo. A data de
 * emissão é história: diz quando o papel foi feito, e ninguém age por causa
 * dela. A validade é a única coisa da pasta que muda sozinha com o tempo, e a
 * única que cobra alguma coisa de quem está olhando: certidão vencida é o mesmo
 * que certidão nenhuma no dia em que ela é pedida.
 *
 * Por isso ela vem em corpo maior, na cor do estado, com a barra à esquerda
 * marcando a linha — e com quantos dias faltam escrito por extenso, porque "02
 * de setembro" só quer dizer alguma coisa depois de uma subtração que ninguém
 * faz de cabeça em vinte linhas seguidas. Quem está em dia continua discreto:
 * pintar as vinte de verde apagaria as duas que importam.
 */
export function Validade({ documento: d }: { documento: DocumentoRh }) {
  const emitido = d.emitidoEm && (
    <div className="text-[11px] leading-tight text-tinta-400">
      emitido {formatData(d.emitidoEm)}
    </div>
  );

  if (!d.valeAte) {
    return (
      <div className="border-l-2 border-transparent pl-2.5">
        <div className="text-xs text-tinta-400">
          {d.emitidoEm ? 'não vence' : '—'}
        </div>
        {emitido}
      </div>
    );
  }

  const alerta = d.prazo === 'vencido' || d.prazo === 'a-vencer';

  return (
    <div className={`border-l-2 pl-2.5 ${BARRA_DO_PRAZO[d.prazo]}`}>
      <div className="flex items-center gap-2">
        <span
          className={`num text-[15px] font-semibold leading-tight ${COR_DO_PRAZO[d.prazo]}`}
        >
          {formatData(d.valeAte)}
        </span>
        <SeloDoPrazo prazo={d.prazo} />
      </div>
      <div
        className={`text-xs leading-tight ${
          alerta ? COR_DO_PRAZO[d.prazo] : 'text-tinta-400'
        }`}
      >
        {quantoFalta(d.valeAte)}
      </div>
      {emitido}
    </div>
  );
}

/* A cor não é decoração: é ela que separa, de relance numa lista de vinte
   linhas, o papel que precisa ser refeito do que só está guardado. Quem está em
   dia fica na tinta comum, para não disputar atenção com quem não está. */
const COR_DO_PRAZO: Record<PrazoDoDocumento, string> = {
  vencido: 'text-rose-600 dark:text-rose-300',
  'a-vencer': 'text-amber-700 dark:text-amber-300',
  'em-dia': 'text-tinta-800',
  'sem-prazo': 'text-tinta-400',
};

/* A barra à esquerda leva a cor para fora da célula: numa tabela de linhas
   altas, é o que faz a linha inteira se destacar sem pintar o fundo dela. */
const BARRA_DO_PRAZO: Record<PrazoDoDocumento, string> = {
  vencido: 'border-rose-500',
  'a-vencer': 'border-amber-400',
  'em-dia': 'border-emerald-500/30',
  'sem-prazo': 'border-transparent',
};

/**
 * Quantos dias faltam, escrito como se fala.
 *
 * Conta em dia de calendário, e não em horas: a validade é o dia impresso no
 * papel, e um documento que vence hoje não pode aparecer como vencido só porque
 * são nove da noite.
 */
function quantoFalta(valeAte: string): string {
  const [ano, mes, dia] = valeAte.split('-').map(Number);
  const agora = new Date();
  const dias = Math.round(
    (Date.UTC(ano, mes - 1, dia) -
      Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate())) /
      86_400_000,
  );

  if (dias === -1) return 'venceu ontem';
  if (dias === 0) return 'vence hoje';
  if (dias === 1) return 'vence amanhã';
  return dias < 0 ? `venceu há ${emTempo(-dias)}` : `faltam ${emTempo(dias)}`;
}

/**
 * Uma distância em dias, na unidade em que ela se pensa.
 *
 * "Venceu há 1332 dias" é um número que ninguém converte de cabeça — e o papel
 * de 2022 numa gaveta de 2026 não precisa de precisão de dia nenhuma, precisa
 * de "há três anos", que é o que decide se vale a pena renovar ou jogar fora.
 * Perto do prazo é o contrário: aí o dia é a informação, porque é ele que cabe
 * ou não cabe na agenda desta semana.
 */
function emTempo(dias: number): string {
  if (dias < 60) return `${dias} dias`;
  if (dias < 550) {
    const meses = Math.round(dias / 30);
    return `${meses} ${meses === 1 ? 'mês' : 'meses'}`;
  }
  const anos = Math.floor(dias / 365);
  return `${anos} ${anos === 1 ? 'ano' : 'anos'}`;
}

/** O que a pasta tem a dizer sobre prazo, antes de a lista começar. */
function fraseDoPrazo(vencidos: number, aVencer: number): string {
  const partes = [
    vencidos > 0 &&
      `${vencidos} documento${vencidos > 1 ? 's' : ''} vencido${vencidos > 1 ? 's' : ''}`,
    aVencer > 0 && `${aVencer} vencendo nos próximos 30 dias`,
  ].filter(Boolean);
  return `Nesta pasta: ${partes.join(' e ')}.`;
}

/** Quantas pastas há dentro desta, contando as de dentro delas. */
function descendentes(pastas: PastaRh[], id: string): number {
  const filhas = pastas.filter((p) => p.paiId === id);
  return filhas.reduce((n, f) => n + 1 + descendentes(pastas, f.id), 0);
}

function SeloDoPrazo({ prazo }: { prazo: PrazoDoDocumento }) {
  if (prazo === 'vencido') {
    return (
      <Selo pequeno tom="erro">
        vencido
      </Selo>
    );
  }
  if (prazo === 'a-vencer') {
    return (
      <Selo pequeno tom="atencao">
        vencendo
      </Selo>
    );
  }
  return null;
}

/**
 * O formulário do documento — o mesmo para guardar e para corrigir.
 *
 * Corrigindo, o arquivo não aparece: trocar o conteúdo por baixo do mesmo
 * título é como um documento vira outro sem ninguém perceber. Errou o arquivo,
 * apaga e sobe de novo.
 */
export function FormularioDoDocumento({
  documento,
  substituindo = false,
  tipos,
  pastas,
  pendente,
  erro,
  onSalvar,
}: {
  documento?: DocumentoRh;
  /**
   * O documento chegou para tomar o lugar daquele.
   *
   * É o meio-termo entre guardar e corrigir: pede o arquivo, como quem guarda
   * um papel novo — a certidão de setembro não é a de agosto corrigida —, mas
   * nasce com o nome e o tipo do antigo já escritos, que é o que não muda de
   * uma renovação para a outra.
   */
  substituindo?: boolean;
  tipos: string[];
  /** Todas as pastas: corrigindo, dá para mudar o documento de lugar. */
  pastas?: PastaRh[];
  pendente: boolean;
  erro: string | null;
  /**
   * Os documentos a guardar — sempre uma lista, mesmo quando é um.
   *
   * Guardando papel novo dá para arrastar vários de uma vez, e cada arquivo
   * vira um documento com o seu nome. Corrigindo ou substituindo vem sempre um
   * só: os dois mexem num documento que já existe.
   */
  onSalvar: (documentos: Record<string, unknown>[]) => void;
}) {
  const [pastaId, setPastaId] = useState(documento?.pastaId ?? '');
  const [titulo, setTitulo] = useState(documento?.titulo ?? '');
  const [tipo, setTipo] = useState(documento?.tipo ?? '');
  const [descricao, setDescricao] = useState(documento?.descricao ?? '');
  // As datas do antigo não se herdam: são justamente elas que mudaram.
  const [emitidoEm, setEmitidoEm] = useState(
    substituindo ? '' : (documento?.emitidoEm ?? ''),
  );
  const [valeAte, setValeAte] = useState(
    substituindo ? '' : (documento?.valeAte ?? ''),
  );
  const [arquivos, setArquivos] = useState<ArquivoEscolhido[]>([]);
  const [converterParaPdf, setConverterParaPdf] = useState(false);
  const [lendo, setLendo] = useState(false);
  const [sobreAArea, setSobreAArea] = useState(false);
  const [erroDoArquivo, setErroDoArquivo] = useState<string | null>(null);

  /** Corrigir: o mesmo documento, outros dados. Substituir não é isso. */
  const editando = !!documento && !substituindo;

  /*
   * Vários de uma vez só ao guardar papel novo.
   *
   * Corrigir mexe num documento; substituir troca um por outro. Nos dois há um
   * documento do outro lado, e "cinco arquivos" não teria a quem responder.
   */
  const varios = !editando && !substituindo;

  /** Com dois ou mais, cada um tem o seu nome: um título só não serviria. */
  const emLote = arquivos.length > 1;

  const podeSalvar =
    tipo.trim().length >= 2 &&
    (editando || arquivos.length > 0) &&
    (emLote
      ? arquivos.every((a) => a.titulo.trim().length >= 2)
      : titulo.trim().length >= 2);

  /** Há Word ou planilha na mão — só aí a conversão tem o que fazer. */
  const temConversivel = arquivos.some((a) => viraPdf(a.nome));

  async function receber(lista: File[]) {
    if (lista.length === 0) return;

    setLendo(true);
    setErroDoArquivo(null);
    try {
      const lidos = await Promise.all(
        lista.map(async (f) => ({
          nome: f.name,
          dados: await lerComoDataUrl(f),
          // O nome do arquivo vira o título: é o que quem está subindo dez
          // digitalizações não quer digitar dez vezes.
          titulo: semExtensao(f.name),
        })),
      );

      // Arrastar de novo acrescenta, não recomeça: quem larga três e lembra do
      // quarto larga o quarto, e não os quatro.
      setArquivos((atuais) => (varios ? [...atuais, ...lidos] : lidos.slice(0, 1)));
      if (!titulo.trim() && lidos[0]) setTitulo(semExtensao(lidos[0].nome));
    } catch (err) {
      setErroDoArquivo(err instanceof Error ? err.message : String(err));
    } finally {
      setLendo(false);
    }
  }

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    // A cópia tem de sair antes de limpar o campo: `files` é uma lista viva, e
    // zerar o input a esvazia — o que chegaria em `receber` seria uma lista de
    // zero arquivos. O campo é limpo para escolher o mesmo arquivo de novo
    // ainda disparar `change`.
    const escolhidos = [...(e.target.files ?? [])];
    e.target.value = '';
    await receber(escolhidos);
  }

  function tirar(i: number) {
    setArquivos((atuais) => atuais.filter((_, n) => n !== i));
  }

  function renomear(i: number, novo: string) {
    setArquivos((atuais) =>
      atuais.map((a, n) => (n === i ? { ...a, titulo: novo } : a)),
    );
  }

  /*
   * Arrastar o papel para dentro da janela.
   *
   * O caminho do diálogo do sistema é o caminho longo quando o arquivo já está
   * à vista — recém-baixado, aberto ao lado, na área de trabalho. O arrasto é o
   * gesto que a pessoa já ia fazer, e o `dragOver` precisa do `preventDefault`
   * porque sem ele o navegador abre o PDF numa aba e a janela se perde.
   */
  function aoArrastar(e: React.DragEvent) {
    e.preventDefault();
    setSobreAArea(e.type === 'dragover');
  }

  async function aoSoltar(e: React.DragEvent) {
    e.preventDefault();
    setSobreAArea(false);
    await receber([...e.dataTransfer.files]);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!podeSalvar) return;

        // O que é do lote inteiro: tipo, observação e datas. Só o título muda
        // de um papel para o outro — cinco certidões são cinco documentos, mas
        // são o mesmo tipo, do mesmo dia, com a mesma validade.
        const comum = {
          ...(editando && pastaId !== documento?.pastaId ? { pastaId } : {}),
          tipo: tipo.trim(),
          descricao: descricao.trim() || undefined,
          emitidoEm: emitidoEm || undefined,
          valeAte: valeAte || undefined,
          ...(converterParaPdf ? { converterParaPdf: true } : {}),
        };

        onSalvar(
          emLote
            ? arquivos.map((a) => ({
                ...comum,
                titulo: a.titulo.trim(),
                arquivo: a.dados,
                arquivoNome: a.nome,
              }))
            : [
                {
                  ...comum,
                  titulo: titulo.trim(),
                  ...(arquivos[0]
                    ? {
                        arquivo: arquivos[0].dados,
                        arquivoNome: arquivos[0].nome,
                      }
                    : {}),
                },
              ],
        );
      }}
    >
      {!editando && (
        <div className="mb-4">
          <label className="rotulo">
            {substituindo ? 'O documento novo' : 'O arquivo'}
          </label>
          {/* A área inteira recebe o arrasto, e não só o botão: quem arrasta
              mira a caixa, não um alvo de 140 pixels. O botão continua ali
              para quem prefere o diálogo do sistema. */}
          <div
            onDragOver={aoArrastar}
            onDragLeave={aoArrastar}
            onDrop={aoSoltar}
            className={`flex flex-wrap items-center gap-3 rounded-xl border border-dashed px-4 py-4 transition ${
              sobreAArea
                ? 'border-brand-400 bg-brand-500/10'
                : 'border-tinta-200 bg-tinta-50/40 dark:bg-white/[0.02]'
            }`}
          >
            <label className="btn btn-neutro w-fit cursor-pointer">
              {lendo
                ? 'Lendo…'
                : arquivos.length === 0
                  ? varios
                    ? 'Escolher arquivos'
                    : 'Escolher arquivo'
                  : varios
                    ? 'Acrescentar'
                    : 'Trocar arquivo'}
              <input
                type="file"
                accept={ACEITOS}
                multiple={varios}
                className="hidden"
                onChange={escolher}
              />
            </label>
            {arquivos.length === 0 ? (
              <span className="text-sm text-tinta-400">
                {sobreAArea
                  ? 'Solte aqui.'
                  : varios
                    ? 'ou arraste os arquivos para cá — pode ser mais de um'
                    : 'ou arraste o arquivo para cá'}
              </span>
            ) : !emLote ? (
              <span className="truncate text-sm text-tinta-600">
                {arquivos[0].nome}
              </span>
            ) : (
              <span className="text-sm text-tinta-600">
                {arquivos.length} arquivos
              </span>
            )}
          </div>

          {/* Em lote, cada arquivo aparece com o nome que ele vai ter na
              estante: é o único campo que não dá para dividir com os outros.
              Um só continua usando o campo de sempre, lá embaixo — mostrar a
              lista de um item seria desenhar uma tabela para uma linha. */}
          {emLote && (
            <ul className="mt-3 space-y-2">
              {arquivos.map((a, i) => (
                <li
                  key={`${a.nome}-${i}`}
                  className="flex flex-wrap items-center gap-2 rounded-xl border border-tinta-100 px-3 py-2"
                >
                  <span
                    className="max-w-[14rem] truncate text-xs text-tinta-400"
                    title={a.nome}
                  >
                    {a.nome}
                  </span>
                  <input
                    value={a.titulo}
                    onChange={(e) => renomear(i, e.target.value)}
                    aria-label={`Como "${a.nome}" se chama na pasta`}
                    placeholder="Como este documento se chama"
                    className="campo min-w-[12rem] flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => tirar(i)}
                    className="btn btn-p btn-sutil"
                    title={`Tirar "${a.nome}" da lista`}
                  >
                    Tirar
                  </button>
                </li>
              ))}
            </ul>
          )}

          <p className="ajuda">
            PDF, foto, digitalização, documento do Word ou planilha — até 15 MB
            cada.
            {substituindo &&
              ` O que está aqui hoje não se perde: vai para a pasta “Substituídos”, com as datas que ele tinha.`}
          </p>

          {/* A caixa só aparece quando há o que converter: oferecer "virar PDF"
              a quem acabou de escolher um PDF é linha para não fazer nada. */}
          {temConversivel && (
            <label className="mt-3 flex cursor-pointer items-start gap-2">
              <input
                type="checkbox"
                checked={converterParaPdf}
                onChange={(e) => setConverterParaPdf(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-brand-500"
              />
              <span className="text-sm text-tinta-600">
                Guardar em PDF
                <span className="ajuda mt-0.5">
                  O Word e a planilha entram convertidos — é o formato que abre
                  igual em qualquer máquina e que não se altera no caminho. O
                  que já é PDF ou foto passa direto. Não dando para converter, o
                  arquivo entra como veio e a tela avisa.
                </span>
              </span>
            </label>
          )}

          {erroDoArquivo && (
            <p className="mt-1 text-sm text-rose-600">{erroDoArquivo}</p>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Mudar de pasta é o único jeito de pôr numa divisória nova o que já
            estava guardado. O arquivo vai junto: é o mesmo documento. */}
        {editando && pastas && pastas.length > 0 && (
          <div className="sm:col-span-2">
            <label className="rotulo" htmlFor="pasta-do-documento">
              Em que pasta ele fica
            </label>
            <select
              id="pasta-do-documento"
              value={pastaId}
              onChange={(e) => setPastaId(e.target.value)}
              className="campo"
            >
              {[...pastas]
                .sort((a, b) =>
                  caminhoLegivel(pastas, a).localeCompare(
                    caminhoLegivel(pastas, b),
                    'pt-BR',
                  ),
                )
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {caminhoLegivel(pastas, p)}
                  </option>
                ))}
            </select>
          </div>
        )}
        {/* Em lote o nome de cada um já foi perguntado na lista de arquivos. */}
        {!emLote && (
          <div>
            <label className="rotulo" htmlFor="titulo-do-documento">
              Como este documento se chama
            </label>
            <input
              id="titulo-do-documento"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex.: Contrato de experiência"
              className="campo"
            />
          </div>
        )}
        <div>
          <label className="rotulo" htmlFor="tipo-do-documento">
            Tipo
          </label>
          <input
            id="tipo-do-documento"
            value={tipo}
            onChange={(e) => setTipo(e.target.value)}
            placeholder="Ex.: Contrato"
            list="tipos-de-documento"
            className="campo"
          />
          <datalist id="tipos-de-documento">
            {[...new Set([...tipos, ...SUGESTOES])].map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </div>
        <div className="sm:col-span-2">
          <label className="rotulo" htmlFor="descricao-do-documento">
            Observação <span className="text-tinta-400">(opcional)</span>
          </label>
          <input
            id="descricao-do-documento"
            value={descricao}
            onChange={(e) => setDescricao(e.target.value)}
            placeholder="O que alguém precisaria saber sem abrir o arquivo"
            className="campo"
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="emitido-em">
            Data do documento <span className="text-tinta-400">(opcional)</span>
          </label>
          <input
            id="emitido-em"
            type="date"
            value={emitidoEm}
            onChange={(e) => setEmitidoEm(e.target.value)}
            className="campo"
          />
        </div>
        <div>
          <label className="rotulo" htmlFor="vale-ate">
            Vale até <span className="text-tinta-400">(opcional)</span>
          </label>
          <input
            id="vale-ate"
            type="date"
            value={valeAte}
            onChange={(e) => setValeAte(e.target.value)}
            className="campo"
          />
          <p className="ajuda">
            Exame e certidão vencem. Preenchendo aqui, a pasta avisa antes.
          </p>
        </div>
      </div>

      {erro && (
        <div className="mt-4">
          <Aviso tom="erro">{erro}</Aviso>
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <button
          type="submit"
          disabled={!podeSalvar || pendente || lendo}
          className="btn btn-primario"
        >
          {pendente
            ? substituindo
              ? 'Substituindo…'
              : 'Guardando…'
            : editando
              ? 'Salvar correção'
              : substituindo
                ? 'Substituir'
                : emLote
                  ? `Guardar os ${arquivos.length} na pasta`
                  : 'Guardar na pasta'}
        </button>
      </div>
    </form>
  );
}

/** Os tipos que toda pasta de RH acaba tendo, para a lista nunca nascer vazia. */
const SUGESTOES = [
  'Contrato',
  'CTPS',
  'Documento pessoal',
  'Exame médico',
  'Advertência',
  'Férias',
  'Rescisão',
  'Recibo de pagamento',
  'Certidão',
  'Alvará',
];

/** O caminho até uma pasta, da estante para dentro. */
function trilha(
  pastas: PastaRh[],
  pasta?: PastaRh,
): Array<{ id: string; nome: string }> {
  const caminho: Array<{ id: string; nome: string }> = [];
  let atual = pasta;
  // Teto de segurança: um ciclo aqui travaria a tela em vez de mostrar a pasta.
  // O número acompanha o do servidor, que é quem recusa criar mais fundo.
  for (let i = 0; atual && i < 20; i += 1) {
    caminho.unshift({ id: atual.id, nome: atual.nome });
    const paiId: string | null = atual.paiId;
    atual = paiId ? pastas.find((p) => p.id === paiId) : undefined;
  }
  return caminho;
}

/** "Fulano / Exames", para o seletor dizer onde cada pasta fica. */
function caminhoLegivel(pastas: PastaRh[], pasta: PastaRh): string {
  return trilha(pastas, pasta)
    .map((p) => p.nome)
    .join(' / ');
}

/** O arquivo como data URL — é assim que ele chega à API. */
function lerComoDataUrl(arquivo: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(String(leitor.result));
    leitor.onerror = () =>
      reject(new Error('Não consegui ler este arquivo do seu computador.'));
    leitor.readAsDataURL(arquivo);
  });
}

function semExtensao(nome: string): string {
  return nome.replace(/\.[^.]+$/, '').slice(0, 120);
}

/** O que saiu de guardar uma leva de documentos. */
export interface LevaGuardada {
  guardados: (DocumentoRh & { avisoDaConversao?: string })[];
  /** Os que não entraram, com o motivo. O resto entrou. */
  falhas: { nome: string; motivo: string }[];
}

/**
 * Guarda os documentos de uma leva, um a um.
 *
 * Um a um e não de uma vez porque cada arquivo é o corpo inteiro de uma
 * requisição — cinco de quinze megabytes ao mesmo tempo é o que o nginx recusa
 * com um 413 sem frase nenhuma.
 *
 * O que falha no meio não desfaz o que já entrou, e nem para a fila: quem
 * arrastou cinco certidões e tem uma grande demais quer as outras quatro
 * guardadas, e quer saber qual ficou de fora — não quer as cinco recusadas por
 * causa de uma. Só quando **nenhuma** entra é que isto vira erro, porque aí não
 * há nada a contar como feito.
 */
export async function guardarLeva(
  documentos: Record<string, unknown>[],
  pastaId: string,
): Promise<LevaGuardada> {
  const leva: LevaGuardada = { guardados: [], falhas: [] };

  for (const doc of documentos) {
    try {
      const { data } = await api.post<
        DocumentoRh & { avisoDaConversao?: string }
      >('/rh/documentos', { ...doc, pastaId });
      leva.guardados.push(data);
    } catch (err) {
      leva.falhas.push({
        nome: String(doc.arquivoNome ?? doc.titulo ?? 'arquivo'),
        motivo: mensagemErro(err),
      });
    }
  }

  if (leva.guardados.length === 0) {
    throw new Error(leva.falhas[0]?.motivo ?? 'Nenhum documento foi guardado.');
  }
  return leva;
}

/** A frase que conta o que aconteceu com a leva, para o aviso da tela. */
export function contarLeva(leva: LevaGuardada, verbo = 'guardado'): string {
  const partes: string[] = [];

  partes.push(
    leva.guardados.length === 1
      ? `"${leva.guardados[0].titulo}" ${verbo}.`
      : `${leva.guardados.length} documentos ${verbo}s.`,
  );

  if (leva.falhas.length > 0) {
    partes.push(
      `Não ${leva.falhas.length === 1 ? 'entrou' : 'entraram'}: ` +
        leva.falhas.map((f) => `${f.nome} (${f.motivo})`).join('; '),
    );
  }

  // O aviso da conversão vem do servidor e é por documento: "foi guardado como
  // veio porque tal coisa". Quem pediu PDF precisa saber na hora que não saiu.
  const daConversao = leva.guardados
    .map((d) => d.avisoDaConversao)
    .filter((a): a is string => !!a);
  if (daConversao.length > 0) partes.push(daConversao.join(' '));

  return partes.join(' ');
}

/** Um arquivo já lido, esperando para virar documento. */
interface ArquivoEscolhido {
  nome: string;
  /** O conteúdo como data URL, que é como ele viaja até a API. */
  dados: string;
  /** Como ele vai se chamar na estante. Começa no nome do arquivo. */
  titulo: string;
}

/**
 * Se este arquivo é dos que o servidor sabe converter em PDF.
 *
 * Pela extensão, e não pelo `File.type`: o navegador devolve tipo vazio para
 * arquivo vindo de rede ou de pen drive em algumas máquinas, e aí a caixa de
 * converter sumiria justamente para quem arrastou o .docx da rede. Quem decide
 * de verdade é a API, pelo conteúdo — aqui é só para saber se a caixa aparece.
 */
function viraPdf(nome: string): boolean {
  return /\.(docx?|xlsx?)$/i.test(nome);
}

function emTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}
