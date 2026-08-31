import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, mensagemErro } from '../lib/api';
import { formatBRL } from '../lib/format';
import type { AssinaturaDiaria, Diaria } from '../lib/types';
import { Aviso, Janela } from './ui';

/**
 * A coleta da assinatura de um pagamento em mãos.
 *
 * São dois jeitos de acontecer, e a janela abre já com o link nas mãos porque
 * os dois precisam dele:
 *
 * - a pessoa está na frente de quem pagou: passa-se o celular e ela assina ali
 *   mesmo, no botão "Abrir agora";
 * - a pessoa já foi embora: manda-se o link pelo WhatsApp e ela assina de onde
 *   estiver, do aparelho dela.
 *
 * Depois de assinado a janela vira comprovante: mostra o desenho e o caminho
 * do recibo em PDF, que fica guardado aqui dentro.
 */
export function ColetarAssinatura({
  diaria,
  onFechar,
}: {
  diaria: Diaria;
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const assinatura = useQuery({
    queryKey: ['assinatura-diaria', diaria.id],
    queryFn: async () =>
      (await api.get<AssinaturaDiaria | null>(`/diarias/${diaria.id}/assinatura`))
        .data,
    // Enquanto a janela está aberta e ninguém assinou, ela fica perguntando.
    // É o que faz a tela de quem pagou virar "assinado" sozinha no instante em
    // que a pessoa levanta o dedo do celular dela, do outro lado da cidade.
    // Durante a recoleta ela continua perguntando: `assinadoEm` já está
    // preenchido pela assinatura velha, e parar aqui deixaria a janela sem
    // saber que a nova chegou.
    refetchInterval: (q) =>
      q.state.data?.assinadoEm && !q.state.data?.recoletandoDesde ? false : 4000,
    // Perguntando **mesmo com a aba no fundo**, que é o caso normal: quem
    // copiou o link foi para o WhatsApp mandar, e é enquanto está lá que a
    // assinatura chega. O app inteiro desliga isto (`refetchOnWindowFocus`
    // falso no main.tsx) porque em tela de listagem só gera tráfego à toa —
    // aqui é o contrário, é a única coisa que a janela está esperando.
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: true,
  });

  /**
   * Substituir apaga a assinatura que está lá.
   *
   * A confirmação é aqui, e a recusa é no servidor: sem `substituir`, uma
   * diária já assinada volta com erro. É a rede que impede um clique solto de
   * apagar o que alguém assinou.
   */
  const [confirmandoTroca, setConfirmandoTroca] = useState(false);

  const gerar = useMutation({
    mutationFn: async (substituir?: boolean) =>
      (
        await api.post<AssinaturaDiaria>(`/diarias/${diaria.id}/assinatura`, {
          substituir: substituir || undefined,
        })
      ).data,
    onSuccess: (nova) => {
      queryClient.setQueryData(['assinatura-diaria', diaria.id], nova);
      // A fila lá atrás passa a dizer "link enviado" em vez de "sem link".
      void queryClient.invalidateQueries({
        queryKey: ['diarias-aguardando-assinatura'],
      });
      setErro(null);
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  /**
   * Abre o recibo em PDF.
   *
   * Não dá para apontar um link direto para a rota: o endereço do PDF pede
   * login, e o navegador não manda o token numa navegação comum — ele vive no
   * localStorage e quem o envia é o cliente HTTP daqui. Um `<a href>` levava a
   * um 401 em tela branca. Então o arquivo é buscado com o token, vira um
   * endereço temporário na memória do navegador, e é esse que se abre.
   */
  const abrirRecibo = useMutation({
    mutationFn: async () => {
      try {
        const res = await api.get(`/diarias/${diaria.id}/recibo.pdf`, {
          responseType: 'blob',
        });
        return URL.createObjectURL(
          new Blob([res.data as BlobPart], { type: 'application/pdf' }),
        );
      } catch (e) {
        // Pedindo um arquivo, o corpo do erro também vem como arquivo: a
        // mensagem da API estaria dentro de um Blob, e a tela mostraria um
        // "Request failed with status code 400" no lugar do motivo.
        throw new Error(await motivoDoErroEmArquivo(e));
      }
    },
    onSuccess: (endereco) => {
      setErro(null);
      const aba = window.open(endereco, '_blank');
      // Bloqueador de pop-up: em vez de não acontecer nada, o recibo desce
      // como arquivo. Ver ou salvar, mas nunca clicar e ficar no vazio.
      if (!aba) {
        const link = document.createElement('a');
        link.href = endereco;
        link.download = `recibo-${diaria.id}.pdf`;
        link.click();
      }
      // O endereço temporário segura o arquivo na memória enquanto existir.
      setTimeout(() => URL.revokeObjectURL(endereco), 60_000);
    },
    onError: (e) => setErro(mensagemErro(e)),
  });

  const atual = assinatura.data;
  /*
   * Assinado, e ainda assim esperando assinatura.
   *
   * Pedida a recoleta, os dois são verdade ao mesmo tempo: a assinatura antiga
   * fica guardada de propósito — o recibo dela pode já ser a nota de um
   * lançamento do caixa — e mesmo assim é o link novo que tem de aparecer.
   * Decidir por `assinadoEm` sozinho fazia o "Sim, substituir" gerar o link e
   * a janela continuar mostrando o comprovante de sempre: o clique parecia não
   * fazer nada, e o link novo ficava atrás de uma tela que dizia "já assinado".
   */
  const recoletando = Boolean(atual?.recoletandoDesde);
  const assinado = Boolean(atual?.assinadoEm) && !recoletando;
  const vencido = Boolean(
    atual && !assinado && new Date(atual.expiraEm) < new Date(),
  );
  const linkValido = Boolean(atual) && !assinado && !vencido;

  // Sem link de pé, a janela abre já criando um: quem clicou em "Coletar
  // assinatura" quer coletar, não apertar mais um botão para começar. O
  // guardião é uma referência porque isto tem de acontecer uma vez só — sem
  // ele, cada resposta da consulta pediria outro link.
  const jaPediu = useRef(false);
  useEffect(() => {
    if (assinatura.isSuccess && !atual && !jaPediu.current) {
      jaPediu.current = true;
      gerar.mutate(false);
    }
  }, [assinatura.isSuccess, atual, gerar]);

  // Assinou: as listas lá atrás precisam saber, para a linha ganhar o selo e
  // sair da fila de recibos sem depender de alguém recarregar a página.
  useEffect(() => {
    if (assinado) {
      void queryClient.invalidateQueries({ queryKey: ['diarias'] });
      void queryClient.invalidateQueries({
        queryKey: ['diarias-aguardando-assinatura'],
      });
    }
  }, [assinado, queryClient]);

  const url = atual ? `${window.location.origin}/assinar/${atual.token}` : '';

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
    <Janela titulo="Coletar assinatura" onFechar={onFechar}>
      <div className="p-5 sm:p-6">
        <div className="rounded-2xl bg-tinta-50 p-4">
          <div className="text-sm text-tinta-500">
            Pagamento em mãos de{' '}
            <span className="font-semibold text-tinta-800">
              {diaria.diarista?.nome ?? 'diarista'}
            </span>
          </div>
          <div className="valor mt-0.5 text-2xl">{formatBRL(diaria.valor)}</div>
          <div className="mt-0.5 text-sm text-tinta-500">{diaria.descricao}</div>
        </div>

        {assinatura.isLoading && (
          <p className="mt-5 text-sm text-tinta-400">Vendo se já há recibo…</p>
        )}

        {/* --- Já assinado: a janela é o comprovante --- */}
        {assinado && atual && (
          <div className="mt-5">
            <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <span className="text-base">✓</span>
              Assinado por {atual.nomeAssinante ?? diaria.diarista?.nome ?? 'quem recebeu'}{' '}
              em {formatDataHora(atual.assinadoEm!)}.
            </div>

            {atual.assinaturaPng && (
              <div className="mt-4 rounded-2xl border border-tinta-100 p-4">
                <img
                  src={atual.assinaturaPng}
                  alt="Assinatura de quem recebeu"
                  className="mx-auto max-h-24"
                />
                <div className="mx-auto mt-2 max-w-xs border-t border-tinta-200 pt-2 text-center text-sm font-semibold text-tinta-800">
                  {atual.nomeAssinante ?? diaria.diarista?.nome}
                </div>
                {atual.modo === 'DIGITADA' && (
                  <p className="mt-2 text-center text-xs italic text-tinta-400">
                    Gerada a partir do nome — quem recebeu não assina de
                    próprio punho.
                  </p>
                )}
              </div>
            )}

            <button
              onClick={() => abrirRecibo.mutate()}
              disabled={abrirRecibo.isPending}
              className="btn btn-primario mt-5 w-full"
            >
              {abrirRecibo.isPending ? 'Abrindo…' : 'Ver o recibo em PDF'}
            </button>
            <p className="ajuda text-center">
              O recibo fica guardado aqui — dá para abrir de novo quando
              precisar.
            </p>

            {/* Assinou no lugar errado, o traço saiu ilegível, quem segurava o
                celular era outra pessoa: sem este caminho, a saída era apagar a
                diária e lançar de novo — mexer no caixa por um rabisco. */}
            {confirmandoTroca ? (
              <div className="mt-4">
                <Aviso tom="atencao">
                  <p>
                    Coletar de novo <strong>apaga a assinatura atual</strong> e
                    gera um link novo. O recibo de hoje continua valendo até
                    alguém assinar outra vez.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setConfirmandoTroca(false);
                        gerar.mutate(true);
                      }}
                      disabled={gerar.isPending}
                      className="btn btn-p btn-primario"
                    >
                      {gerar.isPending ? 'Abrindo…' : 'Sim, substituir'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmandoTroca(false)}
                      className="btn btn-p btn-sutil"
                    >
                      Cancelar
                    </button>
                  </div>
                </Aviso>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmandoTroca(true)}
                className="btn btn-sutil mt-3 w-full"
              >
                Coletar assinatura de novo
              </button>
            )}
          </div>
        )}

        {/* --- Ainda por assinar: o link --- */}
        {!assinado && (
          <div className="mt-5">
            {gerar.isPending && !atual ? (
              <p className="text-sm text-tinta-400">Preparando o recibo…</p>
            ) : (
              <>
                {/* Quem pediu a troca precisa saber que não ficou sem recibo
                    no intervalo: a assinatura velha responde por ele até a
                    nova chegar, e é por isso que ela não foi apagada agora. */}
                {recoletando && (
                  <div className="mb-4">
                    <Aviso tom="atencao">
                      Link novo gerado. A assinatura anterior continua valendo
                      até alguém assinar outra vez — e o recibo dela também.
                    </Aviso>
                  </div>
                )}
                <div className="rotulo">Link de assinatura</div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <input
                    readOnly
                    value={url}
                    onFocus={(e) => e.target.select()}
                    className="campo num flex-1 text-xs"
                  />
                  <button
                    onClick={copiar}
                    disabled={!linkValido}
                    className="btn btn-neutro shrink-0"
                  >
                    {copiado ? 'Copiado!' : 'Copiar link'}
                  </button>
                </div>

                {linkValido && atual && (
                  <p className="ajuda">
                    Vale até {formatDataHora(atual.expiraEm)} e some assim que
                    for assinado.
                  </p>
                )}

                {vencido && (
                  <p className="mt-2 text-sm text-amber-700">
                    Este link venceu. Gere outro para mandar de novo.
                  </p>
                )}

                <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className={`btn btn-primario flex-1 ${
                      linkValido ? '' : 'pointer-events-none opacity-50'
                    }`}
                  >
                    Abrir a tela de assinar agora
                  </a>
                  <button
                    onClick={() => gerar.mutate(false)}
                    disabled={gerar.isPending}
                    className="btn btn-neutro"
                  >
                    {vencido ? 'Gerar novo link' : 'Trocar o link'}
                  </button>
                </div>

                <p className="ajuda">
                  Abra na frente da pessoa e passe o aparelho, ou mande o link
                  para ela assinar de onde estiver. Trocar o link derruba o
                  anterior.
                </p>
              </>
            )}
          </div>
        )}

        {erro && (
          <p className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
            {erro}
          </p>
        )}

        <div className="mt-6 flex justify-end">
          <button onClick={onFechar} className="btn btn-neutro">
            Fechar
          </button>
        </div>
      </div>
    </Janela>
  );
}

/** Abre o Blob de erro para achar a mensagem que a API escreveu lá dentro. */
async function motivoDoErroEmArquivo(erro: unknown): Promise<string> {
  const corpo = (erro as { response?: { data?: unknown } })?.response?.data;
  if (corpo instanceof Blob) {
    try {
      const texto = await corpo.text();
      const json = JSON.parse(texto) as { message?: string };
      if (json.message) return json.message;
    } catch {
      // Não era JSON: cai na mensagem genérica abaixo.
    }
  }
  return mensagemErro(erro);
}

function formatDataHora(iso: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}
