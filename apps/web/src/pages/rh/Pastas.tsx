import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { IconePasta } from '../../components/icones';
import {
  Aviso,
  CabecalhoPagina,
  Carregando,
  Janela,
  Pagina,
  Selo,
  Vazio,
} from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { combina, semAcento } from '../../lib/busca';
import type { EstanteRh, PastaRh } from '../../lib/types';

/**
 * A estante: a pasta da empresa, a gaveta dos funcionários e as de assunto.
 *
 * Ela já foi uma tela de quarenta e poucas pastas de gente em ordem alfabética,
 * com a da empresa e a das licitações perdidas no meio delas — quem entrava
 * para pegar um alvará rolava a tela procurando pela letra "E". Hoje a gente
 * mora um clique adentro, em "Funcionários", e o que abre primeiro é curto o
 * bastante para se ler de uma vez.
 *
 * As pastas de funcionário nascem sozinhas, do cadastro — abrir a estante e
 * ter de criar a pasta do Fulano antes de guardar o contrato dele seria
 * trabalho que o sistema já sabe fazer. O botão de criar existe para quem não
 * está no cadastro: o sócio, o estagiário da faculdade, quem já saiu antes de o
 * sistema existir — e, preenchido o CPF, a pasta nasce dentro da gaveta junto
 * com as outras.
 */
export function PastasRh() {
  const qc = useQueryClient();
  const [termo, setTermo] = useState('');
  const [criando, setCriando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const estante = useQuery({
    queryKey: ['rh', 'pastas'],
    queryFn: async () => (await api.get<EstanteRh>('/rh/pastas')).data,
  });

  const todas = useMemo(() => estante.data?.pastas ?? [], [estante.data]);

  /*
   * Parada, a estante é o primeiro nível: a empresa, a gaveta dos funcionários
   * e as pastas de assunto. Meia dúzia de cartões, e a tela abre inteira.
   *
   * Procurando, ela é a árvore toda. Quem digita "conceicao" nesta caixa quer o
   * Anderson, e ele está um clique adentro desde que a gaveta existe —
   * responder "nenhuma pasta com esse nome" porque ele não é de primeiro nível
   * seria trocar a organização da estante pelo jeito de achar gente nela. E,
   * de quebra, agora a busca alcança a subpasta: "recibos" acha as quarenta.
   */
  const pastas = useMemo(() => {
    // Sem acento: quem procura o Anderson Conceição escreve "conceicao".
    const busca = semAcento(termo.trim());
    /*
     * Parada, a estante mostra só o que ela é a única porta de entrada.
     *
     * Empresa, Licitações e Notas Fiscais têm item próprio no menu da esquerda.
     * Repeti-las aqui era encher a tela de atalhos duplicados e afogar no meio
     * deles o único cartão que só existe nesta tela — a gaveta dos
     * funcionários. Procurando, elas voltam: quem digita "licitação" quer achar
     * a pasta, não descobrir que ela mudou de lugar.
     */
    if (!busca) return todas.filter((p) => !p.paiId && !p.temPortaPropria);
    return todas.filter((p) =>
      combina([p.nome, p.apelido, p.funcao, p.cpf], busca),
    );
  }, [todas, termo]);

  const criar = useMutation({
    mutationFn: async (dados: { nome: string; cpf?: string }) =>
      (await api.post<PastaRh>('/rh/pastas', dados)).data,
    onSuccess: () => {
      setCriando(false);
      setErro(null);
      void qc.invalidateQueries({ queryKey: ['rh', 'pastas'] });
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  /*
   * O aviso conta a estante inteira, e não só o que está à vista.
   *
   * Ele saía da lista já filtrada, e por isso encolheu quando Empresa,
   * Licitações e Notas Fiscais saíram da grade — justamente as pastas cujo
   * papel vence: alvará, certidão, o atestado que a licitação pede. Um aviso
   * que deixa de avisar sobre elas por causa de uma mudança de layout é pior
   * que não existir. Por isso é a árvore toda, e a frase não promete mais um
   * crachá em cartão que talvez não esteja na tela.
   */
  const comPendencia = todas.filter(
    (p) => !p.paiId && (p.naArvore.vencidos > 0 || p.naArvore.aVencer > 0),
  );

  return (
    <Pagina>
      <CabecalhoPagina
        secao="RH"
        titulo="Pastas"
        descricao="Onde os documentos da casa ficam. A gente está em Funcionários; empresa, licitações e notas têm porta própria no menu. A busca acha em todas."
        acoes={
          <button
            type="button"
            onClick={() => {
              setErro(null);
              setCriando(true);
            }}
            className="btn btn-primario"
          >
            + Nova pasta
          </button>
        }
      />

      {erro && !criando && <Aviso tom="erro">{erro}</Aviso>}

      {comPendencia.length > 0 && (
        <Aviso tom="atencao">
          {comPendencia.length === 1
            ? '1 pasta tem documento vencido ou vencendo'
            : `${comPendencia.length} pastas têm documento vencido ou vencendo`}
          : {comPendencia.map((p) => p.nome).join(', ')}.
        </Aviso>
      )}

      <div className="surgir mb-5">
        <input
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Procurar em todas as pastas: nome, apelido, função ou CPF"
          className="campo max-w-md"
          autoComplete="off"
        />
      </div>

      {estante.isLoading ? (
        <Carregando texto="Abrindo a estante…" />
      ) : pastas.length === 0 ? (
        <Vazio
          titulo={termo ? 'Nenhuma pasta com esse nome' : 'A estante está vazia'}
        >
          {termo
            ? 'A busca olha a estante inteira, inclusive dentro de Funcionários. Procure por outro pedaço do nome, ou crie a pasta.'
            : 'As pastas dos funcionários nascem do cadastro. Sem nenhuma aqui, sincronize os funcionários no módulo da folha.'}
        </Vazio>
      ) : (
        <div className="surgir grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {pastas.map((p) => (
            <CartaoDaPasta
              key={p.id}
              pasta={p}
              /* Achada pela busca lá dentro: o cartão diz de onde ela veio,
                 senão a mesma tela mostraria "Anderson" e "Recibos de
                 pagamento" lado a lado sem dizer que um está dentro do outro. */
              onde={ondeFica(todas, p)}
            />
          ))}
        </div>
      )}

      {criando && (
        <Janela titulo="Nova pasta" onFechar={() => setCriando(false)}>
          <FormularioDaPasta
            pendente={criar.isPending}
            erro={erro}
            onSalvar={(dados) => criar.mutate(dados)}
          />
        </Janela>
      )}
    </Pagina>
  );
}

/**
 * Onde uma pasta mora, para o cartão dizer de onde a busca a tirou.
 *
 * Devolve nulo para a pasta de primeiro nível — ela está onde se está olhando,
 * e escrever isso seria só ruído em cima de cada cartão da estante parada.
 */
function ondeFica(pastas: PastaRh[], pasta: PastaRh): string | null {
  const caminho: string[] = [];
  let paiId = pasta.paiId;
  // Teto de segurança: um ciclo aqui travaria a tela em vez de desenhar um
  // caminho errado. O número acompanha o do servidor.
  for (let i = 0; paiId && i < 20; i += 1) {
    const pai = pastas.find((p) => p.id === paiId);
    if (!pai) break;
    caminho.unshift(pai.nome);
    paiId = pai.paiId;
  }
  return caminho.length > 0 ? caminho.join(' / ') : null;
}

/**
 * A pasta na estante: o nome, o que há dentro e o que está vencendo.
 *
 * Compacta de propósito. São dezenas delas numa tela só — uma por pessoa da
 * casa —, e cartão grande obriga a rolar para achar quem se procura. O que
 * sobra é o essencial: de quem é, quanto papel tem, e o que pede atenção.
 *
 * O quadrado da pasta é amarelo em todas: é por ele que o olho separa "isto é
 * uma pasta" de qualquer outro cartão da interface, e a cor não pode mudar de
 * pasta para pasta sem passar a querer dizer alguma coisa.
 */
export function CartaoDaPasta({
  pasta,
  onde,
}: {
  pasta: PastaRh;
  /** "Funcionários", quando o cartão aparece longe da pasta em que ele mora. */
  onde?: string | null;
}) {
  const resumo = pasta.naArvore;

  return (
    <Link
      to={`/rh/pastas/${pasta.id}`}
      /* O apelido e a função saíram do cartão para ele caber; ficam aqui, para
         quem passa o mouse em duas pastas de nome parecido. */
      title={[pasta.nome, pasta.apelido && `"${pasta.apelido}"`, pasta.funcao]
        .filter(Boolean)
        .join(' · ')}
      className="group flex items-center gap-2.5 rounded-xl border border-tinta-200 bg-papel px-3 py-2.5 transition hover:border-amber-300 hover:bg-amber-50/40 dark:hover:bg-amber-400/5"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-400/20 text-amber-600 dark:bg-amber-400/15 dark:text-amber-300">
        <IconePasta className="h-[18px] w-[18px]" />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium text-tinta-800">
            {pasta.nome}
          </span>
          {pasta.inativo && (
            <span className="shrink-0 text-[10px] uppercase tracking-wide text-tinta-400">
              saiu
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 text-xs text-tinta-400">
          {onde && (
            <span className="shrink-0 truncate text-tinta-500" title={onde}>
              {onde} ·
            </span>
          )}
          <span className="num truncate">
            {resumo.qtd === 0 ? 'vazia' : `${resumo.qtd} doc.`}
            {pasta.subpastas > 0 && ` · ${pasta.subpastas} pasta`}
            {pasta.subpastas > 1 && 's'}
          </span>
          {resumo.vencidos > 0 && (
            <Selo pequeno tom="erro">
              {resumo.vencidos}
            </Selo>
          )}
          {resumo.aVencer > 0 && (
            <Selo pequeno tom="atencao">
              {resumo.aVencer}
            </Selo>
          )}
        </div>
      </div>
    </Link>
  );
}

/**
 * Nome e CPF: o CPF é o que faz o recibo do mês achar esta pasta sozinho.
 *
 * O mesmo formulário cria e renomeia. Renomeando, os campos já chegam
 * preenchidos — o nome que se corrige é quase sempre o que já está lá, com uma
 * letra a menos.
 */
export function FormularioDaPasta({
  pasta,
  pendente,
  erro,
  semCpf = false,
  onSalvar,
  onSeguirCadastro,
}: {
  /** Preenchida = renomear esta pasta. Vazia = criar uma nova. */
  pasta?: PastaRh;
  pendente: boolean;
  erro: string | null;
  /** Subpasta é divisória, e não pessoa: ali o CPF não quer dizer nada. */
  semCpf?: boolean;
  onSalvar: (dados: { nome: string; cpf?: string }) => void;
  /**
   * Devolver a pasta ao nome do cadastro. Só existe na pasta que veio de lá e
   * já foi renomeada à mão — sem isto, renomear seria porta de uma via só.
   */
  onSeguirCadastro?: () => void;
}) {
  const [nome, setNome] = useState(pasta?.nome ?? '');
  const [cpf, setCpf] = useState(pasta?.cpf ?? '');
  const renomeando = !!pasta;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (nome.trim().length >= 2) {
          onSalvar({ nome: nome.trim(), cpf: cpf.trim() || undefined });
        }
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className={semCpf ? 'sm:col-span-2' : ''}>
          <label className="rotulo" htmlFor="nome-da-pasta">
            {semCpf || renomeando ? 'Nome da pasta' : 'De quem é a pasta'}
          </label>
          <input
            id="nome-da-pasta"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder={semCpf ? 'Ex.: Exames' : 'Nome completo'}
            className="campo"
            autoFocus
            autoComplete="off"
          />
          {/* O aviso é do administrador que está prestes a desligar esta pasta
              do cadastro — quem faz isso precisa saber que fez. */}
          {renomeando && !pasta.avulsa && !pasta.nomeManual && (
            <p className="ajuda">
              Esta pasta segue o nome do cadastro. Escrevendo um nome aqui, ela
              para de segui-lo — e passa a ser este que aparece na estante.
            </p>
          )}
          {renomeando && pasta.nomeManual && onSeguirCadastro && (
            <p className="ajuda">
              O nome desta pasta foi escrito à mão.{' '}
              <button
                type="button"
                onClick={onSeguirCadastro}
                className="font-semibold text-brand-700 underline underline-offset-2 dark:text-brand-300"
              >
                Voltar ao nome do cadastro
              </button>
              .
            </p>
          )}
        </div>
        <div className={semCpf ? 'hidden' : ''}>
          <label className="rotulo" htmlFor="cpf-da-pasta">
            CPF <span className="text-tinta-400">(opcional)</span>
          </label>
          <input
            id="cpf-da-pasta"
            value={cpf}
            onChange={(e) => setCpf(e.target.value)}
            placeholder="000.000.000-00"
            inputMode="numeric"
            className="campo"
            autoComplete="off"
          />
          <p className="ajuda">
            É por ele que o recibo de pagamento acha esta pasta sozinho quando o
            PDF do mês for separado. Nome muda de grafia; CPF não.
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
          disabled={nome.trim().length < 2 || pendente}
          className="btn btn-primario"
        >
          {pendente
            ? renomeando
              ? 'Salvando…'
              : 'Criando…'
            : renomeando
              ? 'Salvar nome'
              : 'Criar pasta'}
        </button>
      </div>
    </form>
  );
}
