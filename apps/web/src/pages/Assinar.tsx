import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AssinaturaCanvas,
  type AssinaturaCanvasRef,
} from '../components/AssinaturaCanvas';
import { api, mensagemErro } from '../lib/api';
import { formatBRL, formatData } from '../lib/format';
import type { ModoAssinatura, ReciboPublico } from '../lib/types';

/**
 * A tela de quem recebeu o dinheiro. É a única do sistema que abre sem login:
 * o diarista não tem conta aqui e não vai criar uma para dizer que recebeu o
 * que já está no bolso dele. O link é a credencial.
 *
 * Ela é feita para um celular seguro na mão, possivelmente no meio da rua:
 * texto grande, um campo só, um botão só, e o que está sendo assinado à vista
 * o tempo todo — ninguém assina o que não consegue ler.
 */
export function Assinar() {
  const { token = '' } = useParams();
  const queryClient = useQueryClient();
  const controle = useRef<AssinaturaCanvasRef>(null);
  const [nome, setNome] = useState('');
  const [temTraco, setTemTraco] = useState(false);
  const [modo, setModo] = useState<ModoAssinatura>('DESENHADA');
  const [erro, setErro] = useState<string | null>(null);

  const recibo = useQuery({
    queryKey: ['assinatura', token],
    queryFn: async () =>
      (await api.get<ReciboPublico>(`/assinaturas/${token}`)).data,
    retry: false,
  });

  const assinar = useMutation({
    mutationFn: async () => {
      const assinatura = controle.current?.exportar();
      if (!assinatura) throw new Error('Assine no quadro antes de confirmar.');
      return (
        await api.post<ReciboPublico>(`/assinaturas/${token}`, {
          assinatura,
          modo,
          ...(nome.trim() ? { nome: nome.trim() } : {}),
        })
      ).data;
    },
    onSuccess: (dados) => {
      queryClient.setQueryData(['assinatura', token], dados);
      setErro(null);
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  /** O nome que vale: o digitado, ou o do cadastro quando ninguém mexeu. */
  const nomeParaAssinar = nome.trim() || recibo.data?.quemRecebe.nome || '';

  // No modo gerado, o quadro acompanha o campo de nome: corrigiu uma letra,
  // a assinatura é reescrita. Ela *é* o nome — deixar os dois diferentes seria
  // entregar um recibo assinado com um nome que ninguém confirmou.
  useEffect(() => {
    if (modo !== 'DIGITADA' || !nomeParaAssinar) return;
    controle.current?.gerarDoNome(nomeParaAssinar);
  }, [modo, nomeParaAssinar]);

  function trocarModo(novo: ModoAssinatura) {
    if (novo === modo) return;
    controle.current?.limpar();
    setModo(novo);
  }

  if (recibo.isLoading) {
    return <Moldura><p className="text-center text-tinta-400">Abrindo o recibo…</p></Moldura>;
  }

  if (recibo.isError) {
    return (
      <Moldura>
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-2xl">
            ⏳
          </div>
          <h1 className="font-display text-xl font-semibold text-tinta-900">
            Não deu para abrir
          </h1>
          <p className="mt-2 text-sm text-tinta-500">
            {mensagemErro(recibo.error)}
          </p>
        </div>
      </Moldura>
    );
  }

  const r = recibo.data!;

  /*
   * --- Já assinado: a tela vira o comprovante ---
   *
   * Menos quando se pediu outra assinatura lá de dentro. Aí os dois são verdade
   * ao mesmo tempo: a antiga continua guardada — o recibo dela pode já ser a
   * nota de um lançamento do caixa — e mesmo assim é a prancheta que tem de
   * aparecer. Era isto que fazia o "coletar de novo" não levar a lugar nenhum:
   * o link reabria e mostrava o comprovante da assinatura que se queria trocar.
   */
  if (r.assinado && !r.recoletando) {
    return (
      <Moldura>
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-2xl">
            ✓
          </div>
          <h1 className="font-display text-xl font-semibold text-tinta-900">
            Recibo assinado
          </h1>
          <p className="mt-2 text-sm text-tinta-500">
            {r.assinadoEm && `Assinado em ${formatDataHora(r.assinadoEm)}.`}
          </p>
        </div>

        <Resumo recibo={r} />

        {r.assinaturaPng && (
          <div className="mt-5 rounded-2xl border border-tinta-100 bg-papel p-4">
            <div className="rotulo">Assinatura</div>
            <img
              src={r.assinaturaPng}
              alt="Assinatura de quem recebeu"
              className="mx-auto max-h-28"
            />
            <div className="mt-2 border-t border-tinta-200 pt-2 text-center text-sm font-semibold text-tinta-800">
              {r.quemRecebe.nome}
            </div>
            {r.modo === 'DIGITADA' && (
              <p className="mt-2 text-center text-xs italic text-tinta-400">
                Assinatura gerada a partir do nome, a pedido de quem recebeu,
                por não assinar de próprio punho.
              </p>
            )}
          </div>
        )}

        <p className="mt-6 text-center text-xs text-tinta-400">
          Uma via deste recibo ficou guardada com quem fez o pagamento.
        </p>
      </Moldura>
    );
  }

  // --- Ainda por assinar ---
  return (
    <Moldura>
      <div className="text-center">
        <div className="eyebrow">{r.quemPaga.nome}</div>
        <h1 className="mt-1 font-display text-xl font-semibold text-tinta-900">
          Recibo de pagamento
        </h1>
        <p className="mt-1.5 text-sm text-tinta-500">
          Confira o que está escrito e assine abaixo.
        </p>
      </div>

      <div className="mt-5 rounded-2xl bg-brand-50 p-5 text-center">
        <div className="eyebrow text-brand-600">Você recebeu</div>
        <div className="valor mt-1 text-4xl text-brand-700">
          {formatBRL(r.valor)}
        </div>
        <div className="mt-1 text-sm text-tinta-600">em dinheiro, em mãos</div>
      </div>

      <Resumo recibo={r} />

      <div className="mt-6">
        <label className="rotulo" htmlFor="nome">
          Seu nome completo
        </label>
        <input
          id="nome"
          className="campo"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder={r.quemRecebe.nome}
          autoComplete="name"
        />
        <p className="ajuda">
          Deixe como está se o nome acima já estiver certo.
        </p>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="rotulo mb-0">Assinatura</span>
          <button
            type="button"
            onClick={() => controle.current?.limpar()}
            className="btn btn-sutil btn-p"
          >
            Limpar
          </button>
        </div>

        {/* Quem não escreve não pode ficar sem receber por causa disso — mas
            também não pode receber um papel que finge um punho que não houve.
            A saída fica abaixo do quadro, num link, e o recibo guarda qual
            das duas foi usada. */}
        <AssinaturaCanvas
          controle={controle}
          onMudou={setTemTraco}
          disabled={assinar.isPending || modo === 'DIGITADA'}
        />

        {modo === 'DIGITADA' ? (
          <>
            <p className="ajuda">
              A assinatura acima foi escrita pelo sistema com o nome informado.
              O recibo vai dizer isso — que ela foi gerada a pedido de quem
              recebeu, por não assinar de próprio punho. Corrija o nome no campo
              acima se estiver diferente.
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

      {erro && (
        <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {erro}
        </p>
      )}

      <button
        onClick={() => assinar.mutate()}
        disabled={!temTraco || assinar.isPending}
        className="btn btn-primario mt-5 w-full py-3.5 text-base"
      >
        {assinar.isPending ? 'Enviando…' : 'Confirmar que recebi'}
      </button>

      <p className="mt-4 text-center text-xs leading-relaxed text-tinta-400">
        Ao confirmar, você declara ter recebido {formatBRL(r.valor)} de{' '}
        {r.quemPaga.nome} pelo serviço acima, dando plena quitação.
      </p>
    </Moldura>
  );
}

/** O que o recibo diz, em linhas de conferir. */
function Resumo({ recibo }: { recibo: ReciboPublico }) {
  return (
    <dl className="mt-5 space-y-3 rounded-2xl border border-tinta-100 bg-papel p-4 text-sm">
      <Linha rotulo="Serviço" valor={recibo.descricao} />
      {recibo.detalhamento && (
        <Linha rotulo="Composição" valor={recibo.detalhamento} />
      )}
      <Linha rotulo="Data do serviço" valor={formatData(recibo.data)} />
      <Linha rotulo="Quem pagou" valor={recibo.quemPaga.nome} />
      {recibo.quemPaga.cnpj && (
        <Linha rotulo="CNPJ" valor={recibo.quemPaga.cnpj} />
      )}
    </dl>
  );
}

function Linha({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="flex gap-3">
      <dt className="w-32 shrink-0 text-tinta-400">{rotulo}</dt>
      <dd className="min-w-0 flex-1 text-tinta-800">{valor}</dd>
    </div>
  );
}

/**
 * A casca da tela. Ela não usa o Layout do sistema de propósito: aqui não há
 * menu, módulo nem para onde navegar — quem abriu tem uma coisa só para fazer.
 */
function Moldura({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-tinta-50 px-4 py-6 sm:py-8">
      {/* Deitado, o cartão se alarga: é assim que sobra espaço para a mão
          correr o nome inteiro sem espremer as letras no fim da linha. */}
      <div className="mx-auto w-full max-w-lg landscape:max-w-4xl">
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
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}
