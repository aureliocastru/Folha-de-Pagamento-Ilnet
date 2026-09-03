import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  AssinaturaCanvas,
  type AssinaturaCanvasRef,
} from '../../components/AssinaturaCanvas';
import { IconeMais } from '../../components/icones';
import { Janela } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { combina, semAcento } from '../../lib/busca';
import type { Apr, ModoAssinatura, PessoaDaEquipe } from '../../lib/types';

/**
 * O último passo: quem vai executar, e a assinatura de cada um.
 *
 * É o passo que transforma o formulário em documento. Tudo o que veio antes é
 * declaração da empresa sobre o serviço; aqui são as pessoas dizendo que sabem
 * a que vão se expor.
 *
 * A equipe é gravada assim que alguém entra nela — sem o executante salvo no
 * servidor não existe o que assinar.
 */

/** Alguém na equipe, antes de o servidor devolver o registro com assinatura. */
export interface PessoaEscolhida {
  funcionarioId?: string;
  nome: string;
  cpf?: string;
}



export function PassoEquipe({
  aprId,
  equipe,
  setEquipe,
  pessoas,
  executantes,
  onSalvarEquipe,
  onErro,
}: {
  aprId?: string;
  equipe: PessoaEscolhida[];
  setEquipe: React.Dispatch<React.SetStateAction<PessoaEscolhida[]>>;
  pessoas: PessoaDaEquipe[];
  executantes: Apr['executantes'];
  onSalvarEquipe: () => Promise<Apr>;
  onErro: (mensagem: string) => void;
}) {
  const [adicionando, setAdicionando] = useState(false);
  const [assinando, setAssinando] = useState<Apr['executantes'][number] | null>(
    null,
  );

  const naEquipe = new Set(
    equipe.map((e) => e.funcionarioId ?? e.nome.toLowerCase()),
  );
  const disponiveis = pessoas.filter((p) => !naEquipe.has(p.id));

  /** A assinatura mora no servidor; a lista local só sabe os nomes. */
  const assinadoPor = new Map(
    executantes.map((e) => [e.funcionarioId ?? e.nome.toLowerCase(), e]),
  );

  return (
    <div className="space-y-4">
      {equipe.length === 0 && (
        <div className="rounded-2xl border border-dashed border-tinta-300 px-5 py-10 text-center">
          <p className="text-sm font-semibold text-tinta-500">
            Nenhum executante informado
          </p>
        </div>
      )}

      {equipe.map((pessoa) => {
        const chave = pessoa.funcionarioId ?? pessoa.nome.toLowerCase();
        const salvo = assinadoPor.get(chave);
        const assinou = !!salvo?.assinadoEm;

        return (
          <div
            key={chave}
            className={`flex items-center gap-3 rounded-2xl border p-4 ${
              assinou
                ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-500/10'
                : 'border-tinta-200 bg-papel'
            }`}
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold text-tinta-900">
                {pessoa.nome}
              </p>
              <p className="text-[12px] text-tinta-500">
                {assinou
                  ? `Assinou ${formatHora(salvo!.assinadoEm!)}`
                  : salvo
                    ? 'Falta assinar'
                    : 'Salve para coletar a assinatura'}
              </p>
            </div>

            {salvo &&
              (assinou ? (
                /* Fundo branco atrás: a assinatura é tinta escura sobre
                   transparente, e sobre o cartão escuro ela sumia. */
                <img
                  src={salvo.assinaturaPng ?? ''}
                  alt=""
                  className="h-10 w-24 shrink-0 rounded-md bg-white object-contain p-0.5"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setAssinando(salvo)}
                  className="btn btn-acao btn-p shrink-0"
                >
                  Assinar
                </button>
              ))}

            {!assinou && (
              <button
                type="button"
                onClick={() =>
                  setEquipe((atual) =>
                    atual.filter(
                      (e) => (e.funcionarioId ?? e.nome.toLowerCase()) !== chave,
                    ),
                  )
                }
                aria-label={`Remover ${pessoa.nome}`}
                className="btn btn-perigo btn-p shrink-0"
              >
                Remover
              </button>
            )}
          </div>
        );
      })}

      <button
        type="button"
        onClick={() => setAdicionando(true)}
        className="btn btn-neutro w-full justify-center py-3"
      >
        <IconeMais className="h-4 w-4" />
        Adicionar executante
      </button>

      {adicionando && (
        <EscolherPessoa
          disponiveis={disponiveis}
          onEscolher={async (nova) => {
            setEquipe((atual) => [...atual, nova]);
            setAdicionando(false);
            // Salva na hora: sem o executante gravado não há o que assinar.
            try {
              await onSalvarEquipe();
            } catch (e) {
              onErro(mensagemErro(e));
            }
          }}
          onFechar={() => setAdicionando(false)}
        />
      )}

      {assinando && aprId && (
        <ColetarAssinaturaApr
          executante={assinando}
          onFechar={() => setAssinando(null)}
          onErro={onErro}
        />
      )}
    </div>
  );
}

/** Escolher da lista, ou digitar quem não está nela. */
function EscolherPessoa({
  disponiveis,
  onEscolher,
  onFechar,
}: {
  disponiveis: PessoaDaEquipe[];
  onEscolher: (p: PessoaEscolhida) => void;
  onFechar: () => void;
}) {
  const [busca, setBusca] = useState('');
  const [nomeLivre, setNomeLivre] = useState('');

  const termo = semAcento(busca.trim());
  const lista = termo
    ? disponiveis.filter((p) => combina([p.nome, p.apelido], termo))
    : disponiveis;

  return (
    <Janela titulo="Executantes da tarefa" onFechar={onFechar}>
      <input
        type="search"
        className="campo"
        value={busca}
        onChange={(e) => setBusca(e.target.value)}
        placeholder="Localizar por nome"
        aria-label="Localizar executante"
      />

      <div className="mt-4 max-h-[45vh] overflow-y-auto rolagem-fina">
        <ul className="lista-dividida">
          {lista.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() =>
                  onEscolher({
                    funcionarioId: p.id,
                    nome: p.nome,
                    cpf: p.cpf ?? undefined,
                  })
                }
                className="flex w-full items-center gap-3 px-1 py-3 text-left transition hover:bg-tinta-50"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500/15 font-display text-xs font-semibold text-brand-700 dark:text-brand-300">
                  {p.nome.slice(0, 2).toUpperCase()}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-tinta-900">
                    {p.nome}
                    {p.apelido ? ` (${p.apelido})` : ''}
                  </span>
                  {p.funcao && (
                    <span className="block truncate text-xs text-tinta-400">
                      {p.funcao}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>

        {lista.length === 0 && (
          /* A lista é de quem tem login: procurar um colega e não achar é o
             caso comum, não o vazio. Dizer por quê poupa a busca de novo com o
             nome escrito de outro jeito — e aponta a saída, logo abaixo. */
          <p className="py-6 text-center text-sm text-tinta-400">
            {termo ? 'Nenhum resultado.' : 'Ninguém disponível.'} Aqui aparece
            quem tem login no sistema; os demais entram pelo nome, abaixo.
          </p>
        )}
      </div>

      {/* Quem não está na lista: o terceirizado que apareceu no serviço, e o
          colega do cadastro que ainda não tem login para entrar no app. */}
      <div className="mt-5 border-t border-tinta-200 pt-4">
        <label className="rotulo" htmlFor="nome-livre">
          Executante sem login
        </label>
        <div className="flex gap-2">
          <input
            id="nome-livre"
            className="campo"
            value={nomeLivre}
            onChange={(e) => setNomeLivre(e.target.value)}
            placeholder="Nome completo"
            autoComplete="off"
          />
          <button
            type="button"
            disabled={nomeLivre.trim().length < 3}
            onClick={() => onEscolher({ nome: nomeLivre.trim() })}
            className="btn btn-primario shrink-0"
          >
            Adicionar
          </button>
        </div>
      </div>
    </Janela>
  );
}

/**
 * A assinatura de um executante, no próprio aparelho.
 *
 * O mesmo quadro do recibo da diária, e a mesma saída para quem não assina de
 * próprio punho: o sistema escreve o nome, e a APR guarda que foi assim. Um
 * papel que aparenta punho próprio sem ser vale menos que um sem assinatura.
 */
function ColetarAssinaturaApr({
  executante,
  onFechar,
  onErro,
}: {
  executante: Apr['executantes'][number];
  onFechar: () => void;
  onErro: (mensagem: string) => void;
}) {
  const qc = useQueryClient();
  const controle = useRef<AssinaturaCanvasRef>(null);
  const [temTraco, setTemTraco] = useState(false);
  const [modo, setModo] = useState<ModoAssinatura>('DESENHADA');

  const assinar = useMutation({
    mutationFn: async () => {
      const png = controle.current?.exportar();
      if (!png) throw new Error('Assine no quadro antes de confirmar.');
      return (
        await api.post<Apr>(`/apr/executantes/${executante.id}/assinar`, {
          assinaturaPng: png,
          modo,
        })
      ).data;
    },
    onSuccess: (apr) => {
      qc.setQueryData(['apr', apr.id], apr);
      onFechar();
    },
    onError: (e) => onErro(mensagemErro(e)),
  });

  function trocarModo(novo: ModoAssinatura) {
    setModo(novo);
    if (novo === 'DIGITADA') controle.current?.gerarDoNome(executante.nome);
    else controle.current?.limpar();
  }

  return (
    <Janela titulo={executante.nome} onFechar={onFechar}>
      <p className="text-sm leading-relaxed text-tinta-600">
        Ao assinar, {executante.nome} declara ter participado desta análise
        preliminar de risco, ter conhecimento dos riscos identificados e estar
        de posse dos equipamentos de proteção relacionados.
      </p>

      <div className="mt-4 flex items-center justify-between">
        <span className="rotulo mb-0">Assinatura</span>
        <button
          type="button"
          onClick={() => {
            controle.current?.limpar();
            setModo('DESENHADA');
          }}
          className="btn btn-sutil btn-p"
        >
          Limpar
        </button>
      </div>

      <AssinaturaCanvas
        controle={controle}
        onMudou={setTemTraco}
        disabled={assinar.isPending || modo === 'DIGITADA'}
        titulo={executante.nome}
      />

      {modo === 'DIGITADA' ? (
        <>
          <p className="ajuda">
            Assinatura gerada pelo sistema a partir do nome, a pedido de quem
            não assina de próprio punho. O documento registra essa condição.
          </p>
          <button
            type="button"
            onClick={() => trocarModo('DESENHADA')}
            className="mt-2 text-sm font-semibold text-brand-600 underline underline-offset-2 dark:text-brand-300"
          >
            Assinar de próprio punho
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => trocarModo('DIGITADA')}
          className="mt-2.5 text-sm text-tinta-500 underline underline-offset-2"
        >
          Não assino de próprio punho
        </button>
      )}

      <button
        type="button"
        onClick={() => assinar.mutate()}
        disabled={!temTraco || assinar.isPending}
        className="btn btn-primario mt-5 w-full py-3.5 text-base"
      >
        {assinar.isPending ? 'Enviando…' : 'Confirmar assinatura'}
      </button>
    </Janela>
  );
}

// --- Miudezas ---------------------------------------------------------------

function formatHora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}
