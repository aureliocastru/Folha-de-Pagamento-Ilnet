import { useEffect, useRef, useState } from 'react';
import { api, mensagemErro } from '../lib/api';
import { prepararArquivo } from '../lib/foto';
import { FotoAmpliada } from './ui';

/** Um arquivo de nota, já lido, esperando para subir ao título no IXC. */
export interface ArquivoDaNota {
  /** Vazio no print colado: quem nomeia é a API. */
  nome: string;
  dados: string;
}

/** Um arquivo com o nome que a aba de arquivos do IXC vai mostrar. */
export type NotaParaSubir = ArquivoDaNota & { descricao: string };

/**
 * Abre o PDF escolhido numa aba, para conferir antes de lançar.
 *
 * Ele já está na memória (o `dados` é o arquivo inteiro), então a aba abre no
 * próprio clique, sem espera — e por isso o navegador não a bloqueia.
 */
function abrirPdf(dados: string): void {
  const [, base64 = ''] = dados.split(',', 2);
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }));
  window.open(url, '_blank');
  // A aba já leu o arquivo; um minuto de folga e a memória volta.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** No máximo tantos por conta: cada um é uma ida ao webservice do IXC. */
export const NOTAS_POR_CONTA = 10;

/**
 * Sobe as notas ao título, uma a uma.
 *
 * Uma a uma, e a que falha não para as outras: quem anexou a nota e o
 * comprovante quer os dois lá, e se um falhar quer o outro guardado. Volta o
 * que não subiu, para a tela dizer e tentar de novo só aquilo.
 */
export async function subirNotas(
  idFnApagar: number,
  notas: NotaParaSubir[],
): Promise<{ falhas: NotaParaSubir[]; motivo: string }> {
  const falhas: NotaParaSubir[] = [];
  let motivo = '';
  for (const [i, nota] of notas.entries()) {
    try {
      await api.post(`/contas-abertas/${idFnApagar}/nota`, {
        arquivo: nota.dados,
        nome: nota.nome,
        // Na aba de arquivos do IXC elas aparecem pela descrição: com várias,
        // cada uma com o seu número.
        descricao:
          notas.length > 1 ? `${nota.descricao} (${i + 1} de ${notas.length})` : nota.descricao,
      });
    } catch (err) {
      falhas.push(nota);
      motivo ||= mensagemErro(err);
    }
  }
  return { falhas, motivo };
}

/**
 * As notas que vão anexadas à conta, no IXC.
 *
 * Dois caminhos, porque são dois hábitos: quem tem o arquivo salvo escolhe o
 * arquivo; quem acabou de receber o comprovante no WhatsApp ou no internet
 * banking dá um print e cola aqui — e é esse o caminho que não existia em lugar
 * nenhum, porque colar imagem não é coisa que um `<input type=file>` aceite.
 *
 * Mais de uma: a nota e o comprovante do pagamento, a nota de duas páginas, o
 * cupom e a foto da peça. Escolher vários de uma vez ou colar um print depois
 * do outro — tudo vai somando.
 *
 * O print colado não tem nome: quem nomeia é a API, com a data e a extensão
 * certa. Sem extensão, o anexo do IXC vira um binário que não abre.
 */
export function CampoDaNota({
  notas,
  onMudar,
  parcelado = false,
  colar = true,
  dicaDeColar = 'ou dê Ctrl+V para colar um print — ele vai como foto',
  rotulo = 'Notas',
}: {
  notas: ArquivoDaNota[];
  onMudar: (notas: ArquivoDaNota[]) => void;
  /** Em conta parcelada as notas vão na primeira parcela, e a tela diz isso. */
  parcelado?: boolean;
  /**
   * Escuta o Ctrl+V da janela. Só um campo por tela pode: com as notas de cada
   * veículo abertas, o print colado iria para todas ao mesmo tempo.
   */
  colar?: boolean;
  /** Ao lado do botão, enquanto não há arquivo — curta onde a coluna é estreita. */
  dicaDeColar?: string;
  rotulo?: string;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);
  /** Qual foto está aberta em tela cheia, para ver se saiu legível. */
  const [vendo, setVendo] = useState<number | null>(null);
  const cheia = notas.length >= NOTAS_POR_CONTA;

  /*
   * As notas de agora e o `onMudar`, lidos depois da espera: enquanto uma foto
   * é reduzida, outra pode ter sido colada ou tirada.
   */
  const atual = useRef({ notas, onMudar });
  atual.current = { notas, onMudar };

  async function somar(arquivos: File[], nomear: boolean) {
    const cabem = NOTAS_POR_CONTA - atual.current.notas.length;
    if (arquivos.length === 0 || cabem <= 0) return;
    setLendo(true);
    setErro(null);
    try {
      // A foto da câmera passa dos 8 MB e o HEIC do iPhone não abre no
      // computador: as duas saem daqui em JPEG. PDF vai como veio.
      const prontas = await Promise.all(
        arquivos.slice(0, cabem).map(prepararArquivo),
      );
      const novas = prontas.map((p) => (nomear ? p : { ...p, nome: '' }));
      atual.current.onMudar([...atual.current.notas, ...novas]);
      if (arquivos.length > cabem) {
        setErro(
          `Cabem ${NOTAS_POR_CONTA} arquivos por conta; os outros ficaram de fora.`,
        );
      }
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setLendo(false);
    }
  }
  const somarAgora = useRef(somar);
  somarAgora.current = somar;

  /*
   * O Ctrl+V vale na janela inteira, e não só dentro de um quadrado.
   *
   * Quem copiou o comprovante quer colar; procurar onde clicar antes é um passo
   * que ninguém dá. Só entra imagem — texto colado é texto de campo, e roubá-lo
   * daqui quebraria a digitação normal.
   */
  useEffect(() => {
    if (!colar) return;
    function aoColar(e: ClipboardEvent) {
      const imagens = [...(e.clipboardData?.files ?? [])].filter((f) =>
        f.type.startsWith('image/'),
      );
      if (imagens.length === 0) return;
      e.preventDefault();
      // O print colado não tem nome: quem nomeia é a API.
      void somarAgora.current(imagens, false);
    }

    window.addEventListener('paste', aoColar);
    return () => window.removeEventListener('paste', aoColar);
  }, [colar]);

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    // A cópia sai antes de limpar o campo: `files` é uma lista viva.
    const arquivos = [...(e.target.files ?? [])];
    e.target.value = '';
    await somar(arquivos, true);
  }

  /** Só as fotos — são elas que a tela cheia percorre com as setas. */
  const fotos = notas
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => n.dados.startsWith('data:image/'));
  const naSequencia = fotos.findIndex(({ i }) => i === vendo);

  return (
    <div>
      {rotulo && <span className="rotulo">{rotulo}</span>}
      <div className="flex flex-wrap items-center gap-3">
        {notas.map((nota, i) => (
          <div key={nota.dados.slice(-32) + i} className="flex items-center gap-2">
            {nota.dados.startsWith('data:image/') ? (
              <button
                type="button"
                onClick={() => setVendo(i)}
                title="Ver em tela cheia"
                className="cursor-zoom-in"
              >
                <img
                  src={nota.dados}
                  alt={`Nota ${i + 1}`}
                  className="h-10 w-16 rounded-lg border border-tinta-200 object-cover"
                />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => abrirPdf(nota.dados)}
                title="Abrir o PDF"
                className="rounded-lg border border-tinta-200 px-2 py-1 text-xs text-tinta-600 transition hover:border-brand-300 hover:text-brand-700"
              >
                PDF
              </button>
            )}
            {/* O nome também abre: é nele que o olho está. */}
            <button
              type="button"
              onClick={() =>
                nota.dados.startsWith('data:image/') ? setVendo(i) : abrirPdf(nota.dados)
              }
              title={nota.dados.startsWith('data:image/') ? 'Ver em tela cheia' : 'Abrir o PDF'}
              className="max-w-[160px] truncate text-sm text-tinta-600 hover:text-brand-700 hover:underline"
            >
              {nota.nome || 'print colado'}
            </button>
            <button
              type="button"
              onClick={() => onMudar(notas.filter((_, j) => j !== i))}
              className="text-xs font-semibold text-rose-500 hover:underline"
            >
              tirar
            </button>
          </div>
        ))}

        {!cheia && (
          <label className="btn btn-p btn-neutro w-fit cursor-pointer">
            {lendo ? 'Lendo…' : notas.length > 0 ? '+ outra' : 'Anexar nota'}
            {/* Da galeria ou da pasta dá para marcar várias de uma vez. */}
            <input
              type="file"
              accept="image/*,application/pdf"
              multiple
              className="hidden"
              onChange={escolher}
            />
          </label>
        )}

        {colar && notas.length === 0 && (
          <span className="text-xs text-tinta-400">{dicaDeColar}</span>
        )}
      </div>
      {parcelado && notas.length > 0 && (
        <p className="ajuda">Em conta parcelada, vão na primeira parcela.</p>
      )}
      {erro && <p className="mt-1 text-sm text-rose-600">{erro}</p>}
      {naSequencia >= 0 && (
        <FotoAmpliada
          src={fotos[naSequencia].n.dados}
          titulo={
            fotos.length > 1
              ? `Foto ${naSequencia + 1} de ${fotos.length}`
              : fotos[naSequencia].n.nome || 'Nota'
          }
          onFechar={() => setVendo(null)}
          onAnterior={
            naSequencia > 0 ? () => setVendo(fotos[naSequencia - 1].i) : undefined
          }
          onProxima={
            naSequencia < fotos.length - 1
              ? () => setVendo(fotos[naSequencia + 1].i)
              : undefined
          }
        />
      )}
    </div>
  );
}
