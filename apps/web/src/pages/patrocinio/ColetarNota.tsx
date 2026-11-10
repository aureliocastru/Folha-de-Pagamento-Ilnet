import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Janela, Selo } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { abrirArquivo } from '../../lib/arquivo';
import { formatBRL } from '../../lib/format';
import type { NotaDeRecebimento, PagamentoAoPatrocinado } from '../../lib/types';
import { formatDataHora, linkDoWhatsapp } from './comum';

/** Quem recebe a nota: o bastante para escrever a mensagem e mandá-la. */
export interface QuemAssinaANota {
  id: string;
  nome: string;
  telefone: string | null;
}

/** O que mudou depois de mexer numa nota: as telas que mostram notas se refazem. */
export function useRecarregarNotas() {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: ['patrocinio-notas'] });
    void qc.invalidateQueries({ queryKey: ['patrocinio-pagamentos'] });
    void qc.invalidateQueries({ queryKey: ['patrocinado'] });
  };
}

export function notaVencida(n: Pick<NotaDeRecebimento, 'assinadoEm' | 'expiraEm'>): boolean {
  return !n.assinadoEm && new Date(n.expiraEm) < new Date();
}

/** Onde a nota está, numa palavra. */
export function SeloDaNota({ nota }: { nota: NotaDeRecebimento }) {
  if (nota.baixadaEm) {
    return (
      <Selo
        tom="pago"
        pequeno
        titulo={`Baixada${nota.baixadaPor ? ` por ${nota.baixadaPor}` : ''} em ${formatDataHora(nota.baixadaEm)}`}
      >
        nota baixada
      </Selo>
    );
  }
  if (nota.assinadoEm) {
    return (
      <Selo tom="info" pequeno titulo={`Assinada em ${formatDataHora(nota.assinadoEm)} — falta dar baixa`}>
        nota assinada
      </Selo>
    );
  }
  if (notaVencida(nota)) {
    return (
      <Selo tom="erro" pequeno titulo="O link venceu sem ninguém assinar — gere outro">
        link vencido
      </Selo>
    );
  }
  return (
    <Selo tom="atencao" pequeno titulo="O link saiu e ninguém assinou ainda">
      aguardando assinatura
    </Selo>
  );
}

/**
 * A nota de recebimento de um pagamento, na linha dele: pedir a assinatura,
 * ver o link que saiu, ou abrir a nota assinada.
 */
export function NotaDoPagamento({
  pagamento,
  patrocinado,
}: {
  pagamento: PagamentoAoPatrocinado;
  patrocinado: QuemAssinaANota;
}) {
  const qc = useQueryClient();
  const recarregar = useRecarregarNotas();
  const [coletando, setColetando] = useState<NotaDeRecebimento | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const n = pagamento.nota;

  const gerar = useMutation({
    mutationFn: async () =>
      (
        await api.post<NotaDeRecebimento>(`/patrocinios/${patrocinado.id}/notas`, {
          idFnApagar: pagamento.idFnApagar,
        })
      ).data,
    onSuccess: (nota) => {
      setErro(null);
      // O link renovado é a mesma nota com outro token: sem isto a janela
      // abriria com o token velho guardado.
      qc.setQueryData(['nota-patrocinio', nota.id], nota);
      setColetando(nota);
      recarregar();
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const abrir = useAbrirNota(setErro);

  return (
    <div className="flex flex-col items-start gap-1">
      {!n && (
        <button onClick={() => gerar.mutate()} disabled={gerar.isPending} className="btn btn-p btn-neutro">
          {gerar.isPending ? 'Preparando…' : 'Pedir assinatura'}
        </button>
      )}
      {n && (
        <div className="flex flex-wrap items-center gap-1.5">
          <SeloDaNota nota={n} />
          {n.assinadoEm ? (
            <button onClick={() => abrir.mutate(n)} disabled={abrir.isPending} className="btn btn-p btn-sutil">
              Ver
            </button>
          ) : notaVencida(n) ? (
            <button onClick={() => gerar.mutate()} disabled={gerar.isPending} className="btn btn-p btn-sutil">
              Gerar novo link
            </button>
          ) : (
            <button onClick={() => setColetando(n)} className="btn btn-p btn-sutil">
              Ver link
            </button>
          )}
        </div>
      )}
      {erro && <span className="max-w-[220px] text-xs text-rose-600">{erro}</span>}

      {coletando && (
        <ColetarNota
          nota={coletando}
          patrocinado={patrocinado}
          onFechar={() => setColetando(null)}
          onAssinou={recarregar}
        />
      )}
    </div>
  );
}

/** Abre a nota assinada em PDF, numa aba. */
export function useAbrirNota(onErro: (texto: string) => void) {
  return useMutation({
    mutationFn: (n: Pick<NotaDeRecebimento, 'id' | 'idFnApagar'>) =>
      abrirArquivo(
        `/patrocinios/notas/${n.id}/arquivo`,
        `nota-de-recebimento-${n.idFnApagar}.pdf`,
        'application/pdf',
      ),
    onError: (e) => onErro(mensagemErro(e)),
  });
}

/**
 * O link da nota, para mandar ou abrir ali mesmo — o mesmo desenho da coleta
 * do contrato. A janela fica perguntando enquanto ninguém assina, e vira
 * comprovante no instante em que a assinatura chega.
 */
export function ColetarNota({
  nota,
  patrocinado,
  onFechar,
  onAssinou,
}: {
  nota: NotaDeRecebimento;
  patrocinado: QuemAssinaANota;
  onFechar: () => void;
  onAssinou: () => void;
}) {
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const atual = useQuery({
    queryKey: ['nota-patrocinio', nota.id],
    queryFn: async () => (await api.get<NotaDeRecebimento>(`/patrocinios/notas/${nota.id}`)).data,
    initialData: nota,
    refetchInterval: (q) => (q.state.data?.assinadoEm ? false : 4000),
    // Perguntando com a aba no fundo: é enquanto se está no WhatsApp mandando o
    // link que a assinatura chega.
    refetchIntervalInBackground: true,
  });

  const n = atual.data;
  const assinada = !!n.assinadoEm;

  const avisou = useRef(false);
  useEffect(() => {
    if (assinada && !avisou.current) {
      avisou.current = true;
      onAssinou();
    }
  }, [assinada, onAssinou]);

  const abrir = useAbrirNota(setErro);

  const url = `${window.location.origin}/assinar-nota/${n.token}`;
  const mensagem =
    `Olá! Segue a nota de recebimento do patrocínio da ILNET: ${formatBRL(n.valor)}, ` +
    `referente a ${n.referente}. Confira e assine pelo celular: ${url}`;
  const whatsapp = linkDoWhatsapp(patrocinado.telefone, mensagem);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(url);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setErro('Não deu para copiar sozinho — selecione o endereço e copie.');
    }
  }

  return (
    <Janela titulo="Nota de recebimento" onFechar={onFechar}>
      <div className="p-5 sm:p-6">
        <div className="rounded-2xl bg-realce p-4 text-sm text-tinta-600">
          <span className="font-semibold text-tinta-800">{patrocinado.nome}</span> ·{' '}
          <span className="valor text-tinta-800">{formatBRL(n.valor)}</span>
          <div className="mt-0.5 text-xs text-tinta-500">
            {n.referente} · título nº {n.idFnApagar}
          </div>
        </div>

        {assinada ? (
          <div className="mt-5">
            <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <span className="text-base">✓</span>
              Assinada por {n.nomeAssinante ?? 'o patrocinado'} em {formatDataHora(n.assinadoEm!)}. Ela já está na
              aba Notas, esperando a baixa.
            </div>
            {n.assinaturaPng && (
              <div className="mt-4 rounded-2xl border border-tinta-100 p-4">
                <img src={n.assinaturaPng} alt="Assinatura do patrocinado" className="mx-auto max-h-24" />
              </div>
            )}
            <button
              onClick={() => abrir.mutate(n)}
              disabled={abrir.isPending}
              className="btn btn-primario mt-5 w-full"
            >
              {abrir.isPending ? 'Abrindo…' : 'Ver a nota em PDF'}
            </button>
          </div>
        ) : (
          <div className="mt-5">
            <div className="rotulo">Link para assinar</div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input readOnly value={url} onFocus={(e) => e.target.select()} className="campo num flex-1 text-xs" />
              <button onClick={copiar} className="btn btn-neutro shrink-0">
                {copiado ? 'Copiado!' : 'Copiar link'}
              </button>
            </div>
            <p className="ajuda">Vale até {formatDataHora(n.expiraEm)}.</p>

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              {whatsapp && (
                <a href={whatsapp} target="_blank" rel="noreferrer" className="btn btn-primario flex-1">
                  Mandar pelo WhatsApp
                </a>
              )}
              <a href={url} target="_blank" rel="noreferrer" className="btn btn-neutro flex-1">
                Abrir a tela de assinar agora
              </a>
            </div>
            <p className="ajuda">
              Mande o link para o patrocinado (ou o responsável) assinar do celular, ou abra aqui e passe o
              aparelho. Esta janela avisa quando a assinatura chegar.
            </p>
          </div>
        )}

        {erro && <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{erro}</p>}

        <div className="mt-6 flex justify-end">
          <button onClick={onFechar} className="btn btn-neutro">
            Fechar
          </button>
        </div>
      </div>
    </Janela>
  );
}
