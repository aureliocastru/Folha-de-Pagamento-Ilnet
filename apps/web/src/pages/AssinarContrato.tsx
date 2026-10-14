import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  AssinaturaCanvas,
  type AssinaturaCanvasRef,
} from '../components/AssinaturaCanvas';
import { api, mensagemErro } from '../lib/api';
import { formatBRL } from '../lib/format';
import type { ContratoPublico, ModoAssinatura } from '../lib/types';
import { TextoDoContrato, blocosDoTexto, textoDaVigencia } from './patrocinio/comum';

/**
 * A tela em que o patrocinado assina o contrato. Abre sem login, como a do
 * recibo da diária (`Assinar`): ele não tem conta aqui, e o link é a
 * credencial dele.
 *
 * Ao contrário do recibo, aqui há o que ler — sete cláusulas. O contrato vem
 * inteiro primeiro, e a prancheta só depois dele: ninguém assina o que não
 * passou pela frente dos olhos.
 */
export function AssinarContrato() {
  const { token = '' } = useParams();
  const queryClient = useQueryClient();
  const controle = useRef<AssinaturaCanvasRef>(null);
  const [nome, setNome] = useState('');
  const [temTraco, setTemTraco] = useState(false);
  const [modo, setModo] = useState<ModoAssinatura>('DESENHADA');
  const [li, setLi] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const contrato = useQuery({
    queryKey: ['contrato-publico', token],
    queryFn: async () => (await api.get<ContratoPublico>(`/assinar-contrato/${token}`)).data,
    retry: false,
  });

  const assinar = useMutation({
    mutationFn: async () => {
      const assinatura = controle.current?.exportar();
      if (!assinatura) throw new Error('Assine no quadro antes de confirmar.');
      return (
        await api.post<ContratoPublico>(`/assinar-contrato/${token}`, {
          assinatura,
          modo,
          ...(nome.trim() ? { nome: nome.trim() } : {}),
        })
      ).data;
    },
    onSuccess: (dados) => {
      queryClient.setQueryData(['contrato-publico', token], dados);
      setErro(null);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const nomeParaAssinar = nome.trim() || contrato.data?.quemAssina || '';

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

  if (contrato.isLoading) {
    return (
      <Moldura>
        <p className="text-center text-tinta-400">Abrindo o contrato…</p>
      </Moldura>
    );
  }

  if (contrato.isError || !contrato.data) {
    return (
      <Moldura>
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-2xl">
            ⏳
          </div>
          <h1 className="font-display text-xl font-semibold text-tinta-900">Não deu para abrir</h1>
          <p className="mt-2 text-sm text-tinta-500">{mensagemErro(contrato.error)}</p>
        </div>
      </Moldura>
    );
  }

  const c = contrato.data;

  if (c.assinado) {
    return (
      <Moldura>
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-emerald-50 text-2xl">
            ✓
          </div>
          <h1 className="font-display text-xl font-semibold text-tinta-900">Contrato assinado</h1>
          <p className="mt-2 text-sm text-tinta-500">
            {c.assinadoEm && `Assinado em ${formatDataHora(c.assinadoEm)}.`} Obrigado pela parceria!
          </p>
        </div>

        <Partes contrato={c} />

        {c.assinaturaPng && (
          <div className="mt-5 rounded-2xl border border-tinta-100 bg-papel p-4">
            <div className="rotulo">Assinatura</div>
            <img src={c.assinaturaPng} alt="Assinatura do patrocinado" className="mx-auto max-h-28" />
            <div className="mt-2 border-t border-tinta-200 pt-2 text-center text-sm font-semibold text-tinta-800">
              {c.nomeAssinante}
            </div>
            {c.modo === 'DIGITADA' && (
              <p className="mt-2 text-center text-xs italic text-tinta-400">
                Assinatura gerada a partir do nome, a pedido do patrocinado, por não assinar de
                próprio punho.
              </p>
            )}
          </div>
        )}

        <p className="mt-6 text-center text-xs text-tinta-400">
          Uma via deste contrato ficou guardada com a {c.empresa.nome}.
        </p>
      </Moldura>
    );
  }

  return (
    <Moldura>
      <div className="text-center">
        <div className="eyebrow">{c.empresa.nome}</div>
        <h1 className="mt-1 font-display text-xl font-semibold text-tinta-900">Termo de patrocínio</h1>
        <p className="mt-1.5 text-sm text-tinta-500">
          Leia o contrato até o fim e assine no quadro lá embaixo.
        </p>
      </div>

      <Partes contrato={c} />

      <div className="mt-5 rounded-2xl border border-tinta-100 bg-papel p-4 sm:p-5">
        <TextoDoContrato blocos={blocosDoTexto(c.texto)} />
      </div>

      <label className="mt-5 flex items-start gap-3 rounded-xl bg-brand-50 p-4 text-sm text-tinta-800">
        <input
          type="checkbox"
          checked={li}
          onChange={(e) => setLi(e.target.checked)}
          className="mt-0.5 h-5 w-5 shrink-0"
        />
        <span>Li o contrato e concordo com as contrapartidas acima.</span>
      </label>

      <div className="mt-5">
        <label className="rotulo" htmlFor="nome">
          Seu nome completo
        </label>
        <input
          id="nome"
          className="campo"
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          placeholder={c.quemAssina}
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
              A assinatura acima foi escrita pelo sistema com o nome informado. O contrato vai dizer
              isso — que ela foi gerada a pedido de quem assina, por não assinar de próprio punho.
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
        disabled={!li || !temTraco || assinar.isPending}
        className="btn btn-primario mt-5 w-full py-3.5 text-base"
      >
        {assinar.isPending ? 'Enviando…' : 'Assinar o contrato'}
      </button>
      {!li && (
        <p className="mt-2 text-center text-xs text-tinta-400">
          Marque que leu o contrato para poder assinar.
        </p>
      )}
    </Moldura>
  );
}

/** Quem patrocina, quem é patrocinado e o combinado. */
function Partes({ contrato: c }: { contrato: ContratoPublico }) {
  const vigencia = textoDaVigencia(c.inicio, c.fim);
  return (
    <dl className="mt-5 space-y-3 rounded-2xl border border-tinta-100 bg-papel p-4 text-sm">
      <Linha rotulo="Patrocinador" valor={c.empresa.cnpj ? `${c.empresa.nome} — CNPJ ${c.empresa.cnpj}` : c.empresa.nome} />
      <Linha
        rotulo="Patrocinado"
        valor={c.patrocinado.cpfCnpj ? `${c.patrocinado.nome} — ${c.patrocinado.cpfCnpj}` : c.patrocinado.nome}
      />
      {c.patrocinado.projeto && <Linha rotulo="Projeto" valor={c.patrocinado.projeto} />}
      {c.valorMensal && Number(c.valorMensal) > 0 && (
        <Linha rotulo="Apoio mensal" valor={formatBRL(c.valorMensal)} />
      )}
      {vigencia && <Linha rotulo="Vigência" valor={vigencia} />}
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
    <div className="min-h-screen bg-tinta-50 px-4 py-6 sm:py-8">
      <div className="mx-auto w-full max-w-2xl landscape:max-w-4xl">
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
