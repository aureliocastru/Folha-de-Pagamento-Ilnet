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
    mutationFn: async (dados: Record<string, unknown>) =>
      (await api.post<DocumentoRh>('/rh/documentos', { ...dados, pastaId: id }))
        .data,
    onSuccess: (d) => {
      setGuardando(false);
      setErro(null);
      avisar(`"${d.titulo}" guardado.`);
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

  const lista = documentos.data ?? [];
  const vencidos = lista.filter((d) => d.prazo === 'vencido').length;
  const aVencer = lista.filter((d) => d.prazo === 'a-vencer').length;

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

      <div className="surgir mb-5">
        <input
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Procurar nesta pasta"
          className="campo max-w-md"
        />
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
            onSalvar={(dados) => guardar.mutate(dados)}
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
            onSalvar={(dados) =>
              substituir.mutate({ id: substituindo.id, ...dados })
            }
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
            onSalvar={(dados) => editar.mutate({ id: editando.id, ...dados })}
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

function LinhaDoDocumento({
  documento: d,
  onEditar,
  onSubstituir,
  onApagar,
}: {
  documento: DocumentoRh;
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
    <tr className="linha">
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
function Validade({ documento: d }: { documento: DocumentoRh }) {
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
function FormularioDoDocumento({
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
  onSalvar: (dados: Record<string, unknown>) => void;
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
  const [arquivo, setArquivo] = useState<{ nome: string; dados: string } | null>(
    null,
  );
  const [lendo, setLendo] = useState(false);
  const [sobreAArea, setSobreAArea] = useState(false);
  const [erroDoArquivo, setErroDoArquivo] = useState<string | null>(null);

  /** Corrigir: o mesmo documento, outros dados. Substituir não é isso. */
  const editando = !!documento && !substituindo;
  const podeSalvar =
    titulo.trim().length >= 2 &&
    tipo.trim().length >= 2 &&
    (editando || !!arquivo);

  async function receber(escolhido: File | undefined) {
    if (!escolhido) return;

    setLendo(true);
    setErroDoArquivo(null);
    try {
      const dados = await lerComoDataUrl(escolhido);
      setArquivo({ nome: escolhido.name, dados });
      // O nome do arquivo vira o título quando ninguém escreveu um: é o que
      // quem está subindo dez digitalizações não quer digitar dez vezes.
      if (!titulo.trim()) setTitulo(semExtensao(escolhido.name));
    } catch (err) {
      setErroDoArquivo(err instanceof Error ? err.message : String(err));
    } finally {
      setLendo(false);
    }
  }

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const escolhido = e.target.files?.[0];
    e.target.value = '';
    await receber(escolhido);
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
    await receber(e.dataTransfer.files?.[0]);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!podeSalvar) return;
        onSalvar({
          ...(editando && pastaId !== documento?.pastaId ? { pastaId } : {}),
          titulo: titulo.trim(),
          tipo: tipo.trim(),
          descricao: descricao.trim() || undefined,
          emitidoEm: emitidoEm || undefined,
          valeAte: valeAte || undefined,
          ...(arquivo
            ? { arquivo: arquivo.dados, arquivoNome: arquivo.nome }
            : {}),
        });
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
              {lendo ? 'Lendo…' : arquivo ? 'Trocar arquivo' : 'Escolher arquivo'}
              <input
                type="file"
                accept={ACEITOS}
                className="hidden"
                onChange={escolher}
              />
            </label>
            {arquivo ? (
              <span className="truncate text-sm text-tinta-600">
                {arquivo.nome}
              </span>
            ) : (
              <span className="text-sm text-tinta-400">
                {sobreAArea ? 'Solte aqui.' : 'ou arraste o arquivo para cá'}
              </span>
            )}
          </div>
          <p className="ajuda">
            PDF, foto, digitalização, documento do Word ou planilha — até 15 MB.
            {substituindo &&
              ` O que está aqui hoje não se perde: vai para a pasta “Substituídos”, com as datas que ele tinha.`}
          </p>
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

function emTamanho(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}
