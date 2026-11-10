import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AssinaturaCanvas,
  type AssinaturaCanvasRef,
} from '../components/AssinaturaCanvas';
import { api, mensagemErro } from '../lib/api';
import { formatBRL, formatData } from '../lib/format';
import type { ModoAssinatura, NotaPublica } from '../lib/types';

/**
 * A tela em que o patrocinado assina que recebeu o dinheiro de um pagamento.
 * Abre sem login, como a do recibo da diária e a do contrato: ele não tem
 * conta aqui, e o link é a credencial dele.
 *
 * Feita para o celular: o valor grande no alto, a frase que o papel vai dizer
 * logo abaixo, e a prancheta só depois — ninguém assina o que não leu.
 */
export function AssinarNota() {
  const { token = '' } = useParams();
  const queryClient = useQueryClient();
  const controle = useRef<AssinaturaCanvasRef>(null);
  const [nome, setNome] = useState('');
  const [temTraco, setTemTraco] = useState(false);
  const [modo, setModo] = useState<ModoAssinatura>('DESENHADA');
  const [erro, setErro] = useState<string | null>(null);

  const nota = useQuery({
    queryKey: ['nota-publica', token],
    queryFn: async () => (await api.get<NotaPublica>(`/assinar-nota/${token}`)).data,
    retry: false,
  });

  const assinar = useMutation({
    mutationFn: async () => {
      const assinatura = controle.current?.exportar();
      if (!assinatura) throw new Error('Assine no quadro antes de confirmar.');
      return (
        await api.post<NotaPublica>(`/assinar-nota/${token}`, {
          assinatura,
          modo,
          ...(nome.trim() ? { nome: nome.trim() } : {}),
        })
      ).data;
    },
    onSuccess: (dados) => {
      queryClient.setQueryData(['nota-publica', token], dados);
      setErro(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const nomeParaAssinar = nome.trim() || nota.data?.quemAssina || '';

  // No modo gerado, o quadro acompanha o campo de nome (ver `Assinar`).
  useEffect(() => {
    if (modo !== 'DIGITADA' || !nomeParaAssinar) return;
    controle.current?.gerarDoNome(nomeParaAssinar);
  }, [modo, nomeParaAssinar]);

  function trocarModo(novo: ModoAssinatura) {
    if (novo === modo) return;
    controle.current?.limpar();
    setModo(novo);
  }

  if (nota.isLoading) {
    return (
      <Moldura>
        <p className="text-center text-tinta-400">Abrindo a nota…</p>
      </Moldura>
    );
  }

  if (nota.isError || !nota.data) {
    return (
      <Moldura>
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-2xl">
            ⏳
          </div>
          <h1 className="font-display text-xl font-semibold text-tinta-900">Não deu para abrir</h1>
          <p className="mt-2 text-sm text-tinta-500">{mensagemErro(nota.error)}</p>
        </div>
      </Moldura>
    );
  }

  const n = nota.data;

  if (n.assinado) {
    return (
      <Moldura>
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-2xl">
            ✓
          </div>
          <h1 className="font-display text-xl font-semibold text-tinta-900">Nota assinada</h1>
          <p className="mt-2 text-sm text-tinta-500">
            {n.assinadoEm && `Assinada em ${formatDataHora(n.assinadoEm)}.`} Obrigado pela parceria!
          </p>
        </div>

        <Resumo nota={n} />

        {n.assinaturaPng && (
          <div className="mt-5 rounded-2xl border border-tinta-100 bg-papel p-4">
            <div className="rotulo">Assinatura</div>
            <img src={n.assinaturaPng} alt="Assinatura de quem recebeu" className="mx-auto max-h-28" />
            <div className="mt-2 border-t border-tinta-200 pt-2 text-center text-sm font-semibold text-tinta-800">
              {n.nomeAssinante}
            </div>
            {n.modo === 'DIGITADA' && (
              <p className="mt-2 text-center text-xs italic text-tinta-400">
                Assinatura gerada a partir do nome, a pedido de quem recebeu, por não assinar de próprio
                punho.
              </p>
            )}
          </div>
        )}

        <p className="mt-6 text-center text-xs text-tinta-400">
          Uma via desta nota ficou guardada com a {n.empresa.nome}.
        </p>
      </Moldura>
    );
  }

  return (
    <Moldura>
      <div className="text-center">
        <div className="eyebrow">{n.empresa.nome}</div>
        <h1 className="mt-1 font-display text-xl font-semibold text-tinta-900">Nota de recebimento</h1>
        <p className="mt-1.5 text-sm text-tinta-500">Confira o que está escrito e assine abaixo.</p>
      </div>

      <div className="mt-5 rounded-2xl bg-brand-50 p-5 text-center dark:bg-brand-500/10">
        <div className="eyebrow text-brand-600 dark:text-brand-300">Você recebeu</div>
        <div className="valor mt-1 text-4xl text-brand-700 dark:text-brand-200">{formatBRL(n.valor)}</div>
        <div className="mt-1 text-sm text-tinta-600">de patrocínio da {n.empresa.nome}</div>
      </div>

      <Resumo nota={n} />

      <div className="mt-5 rounded-2xl border border-tinta-100 bg-papel p-4 text-sm leading-relaxed text-tinta-700">
        <div className="rotulo">O que você está assinando</div>
        {n.declaracao}
      </div>

      <div className="mt-6">
        <label className="rotulo" htmlFor="nome">
          Seu nome completo
        </label>
        <input
          id="nome"
          className="campo"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder={n.quemAssina}
          autoComplete="name"
        />
        <p className="ajuda">Deixe em branco se o nome acima já estiver certo.</p>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="rotulo mb-0">Assinatura</span>
          <button type="button" onClick={() => controle.current?.limpar()} className="btn btn-sutil btn-p">
            Limpar
          </button>
        </div>

        <AssinaturaCanvas
          controle={controle}
          onMudou={setTemTraco}
          disabled={assinar.isPending || modo === 'DIGITADA'}
          titulo={nomeParaAssinar}
        />

        {modo === 'DIGITADA' ? (
          <>
            <p className="ajuda">
              A assinatura acima foi escrita pelo sistema com o nome informado. A nota vai dizer isso — que
              ela foi gerada a pedido de quem recebeu, por não assinar de próprio punho.
            </p>
            <button
              type="button"
              onClick={() => trocarModo('DESENHADA')}
              className="mt-2 text-sm font-semibold text-brand-600 underline underline-offset-2"
            >
              Prefiro assinar com o dedo
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => trocarModo('DIGITADA')}
            className="mt-2.5 text-sm text-tinta-500 underline underline-offset-2"
          >
            Não sei assinar — escreva meu nome
          </button>
        )}
      </div>

      {erro && <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{erro}</p>}

      <button
        onClick={() => assinar.mutate()}
        disabled={!temTraco || assinar.isPending}
        className="btn btn-primario mt-5 w-full py-3.5 text-base"
      >
        {assinar.isPending ? 'Enviando…' : 'Assinar a nota'}
      </button>
    </Moldura>
  );
}

/** Quem pagou, quem recebeu e a que o dinheiro se refere. */
function Resumo({ nota: n }: { nota: NotaPublica }) {
  return (
    <dl className="mt-5 space-y-3 rounded-2xl border border-tinta-100 bg-papel p-4 text-sm">
      <Linha rotulo="Pago por" valor={n.empresa.cnpj ? `${n.empresa.nome} — CNPJ ${n.empresa.cnpj}` : n.empresa.nome} />
      <Linha
        rotulo="Patrocinado"
        valor={n.patrocinado.cpfCnpj ? `${n.patrocinado.nome} — ${n.patrocinado.cpfCnpj}` : n.patrocinado.nome}
      />
      {n.patrocinado.projeto && <Linha rotulo="Projeto" valor={n.patrocinado.projeto} />}
      <Linha rotulo="Referente a" valor={n.referente} />
      {n.pagoEm && <Linha rotulo="Pago em" valor={formatData(n.pagoEm)} />}
    </dl>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-28 shrink-0 text-tinta-400">{rotulo}</dt>
      <dd className="min-w-0 flex-1 text-tinta-800">{valor}</dd>
    </div>
  );
}

/** A casca da tela: sem menu nem módulo, como a do recibo. */
function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-fundo px-4 py-6 sm:py-8">
      <div className="mx-auto w-full max-w-xl">
        <div className="mb-5 flex justify-center">
          <img
            src="/logo-ilnet.png"
            alt="ilnet"
            width={104}
            height={64}
            className="h-auto w-[86px] opacity-90"
          />
        </div>
        <div className="card p-6 sm:p-7">{children}</div>
      </div>
    </div>
  );
}

function formatDataHora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
}
