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
 * A estante: uma pasta por pessoa, mais a da empresa.
 *
 * As pastas de funcionário nascem sozinhas, do cadastro — abrir a estante e
 * ter de criar a pasta do Fulano antes de guardar o contrato dele seria
 * trabalho que o sistema já sabe fazer. O botão de criar existe para quem não
 * está no cadastro: o sócio, o estagiário da faculdade, quem já saiu antes de o
 * sistema existir.
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

  const pastas = useMemo(() => {
    // A estante é o primeiro nível. As subpastas aparecem dentro da pasta
    // delas, que é onde alguém foi procurá-las.
    const todas = (estante.data?.pastas ?? []).filter((p) => !p.paiId);
    // Sem acento: quem procura o Anderson Conceição escreve "conceicao".
    const busca = semAcento(termo.trim());
    if (!busca) return todas;
    return todas.filter((p) =>
      combina([p.nome, p.apelido, p.funcao, p.cpf], busca),
    );
  }, [estante.data, termo]);

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

  const comPendencia = pastas.filter(
    (p) => p.naArvore.vencidos > 0 || p.naArvore.aVencer > 0,
  );

  return (
    <Pagina>
      <CabecalhoPagina
        secao="RH"
        titulo="Pastas"
        descricao="Onde os documentos da casa ficam: uma pasta por pessoa, mais a da empresa. Contrato, exame, advertência e o recibo de pagamento de cada mês."
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
            : `${comPendencia.length} pastas têm documento vencido ou vencendo`}{' '}
          — o crachá vermelho na pasta diz quantos.
        </Aviso>
      )}

      <div className="surgir mb-5">
        <input
          value={termo}
          onChange={(e) => setTermo(e.target.value)}
          placeholder="Procurar por nome, apelido, função ou CPF"
          className="campo max-w-md"
        />
      </div>

      {estante.isLoading ? (
        <Carregando texto="Abrindo a estante…" />
      ) : pastas.length === 0 ? (
        <Vazio
          titulo={termo ? 'Nenhuma pasta com esse nome' : 'A estante está vazia'}
        >
          {termo
            ? 'Procure por outro pedaço do nome, ou crie a pasta.'
            : 'As pastas dos funcionários nascem do cadastro. Sem nenhuma aqui, sincronize os funcionários no módulo da folha.'}
        </Vazio>
      ) : (
        <div className="surgir grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {pastas.map((p) => (
            <CartaoDaPasta key={p.id} pasta={p} />
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
export function CartaoDaPasta({ pasta }: { pasta: PastaRh }) {
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
