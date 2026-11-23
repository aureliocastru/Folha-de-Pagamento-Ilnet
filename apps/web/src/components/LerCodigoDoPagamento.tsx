import { useEffect, useRef, useState } from 'react';
import { api, mensagemErro } from '../lib/api';
import {
  escolherCodigoDoArquivo,
  lerCodigoDePagamento,
  pareceCodigoDePagamento,
} from '../lib/codigo-lido';
import { formatBRL } from '../lib/format';
import type { ContaAberta } from '../lib/types';
import { LeitorDeCodigo, leitorDeCodigoSuportado } from './LeitorDeCodigo';
import { imagemDaColagem } from './LeitorDeTexto';

/** O que o código mudou no título, para a janela de pagar mostrar o valor novo. */
export interface MudancaDoCodigo {
  valor?: number;
  vencimento?: string;
}

/** Está digitando num campo de texto? Aí o Ctrl+V é dele, e não do leitor. */
function emCampoDeTexto(alvo: EventTarget | null): boolean {
  if (!(alvo instanceof HTMLElement)) return false;
  if (alvo.closest('textarea, [contenteditable=""], [contenteditable="true"]')) return true;
  const campo = alvo.closest('input');
  return !!campo && !['checkbox', 'radio', 'button', 'file', 'submit'].includes(campo.type);
}

/**
 * Ler o código de barras do boleto ou o QR do Pix de dentro da janela de pagar.
 *
 * O título que não tem código (ou tem o errado) não obriga mais a fechar,
 * editar e voltar: o que se lê aqui é gravado no próprio título — o código, o
 * valor e o vencimento que ele traz — e a janela já refaz a consulta ao banco,
 * com o botão de mandar para pagar à vista.
 *
 * Quatro jeitos de entrar, todos pelo mesmo caminho:
 * - o print colado com Ctrl+V (ou arrastado) — é o do computador;
 * - a câmera, para o papel na mão;
 * - o texto copiado (a linha do boleto, o Pix copia e cola);
 * - uma imagem ou PDF escolhido do arquivo.
 */
export function LerCodigoDoPagamento({
  conta,
  onAtualizada,
}: {
  conta: ContaAberta;
  onAtualizada: (mudanca: MudancaDoCodigo, recado: string) => void;
}) {
  const [etapa, setEtapa] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  const [camera, setCamera] = useState<'boleto' | 'pix' | null>(null);
  const escolher = useRef<HTMLInputElement>(null);

  /** Grava o código no título e avisa a janela. */
  async function usar(bruto: string) {
    setErro(null);
    setRecado(null);
    setEtapa('Lendo o código…');
    try {
      const lido = await lerCodigoDePagamento(bruto);
      if ('erro' in lido) {
        setErro(lido.erro);
        return;
      }

      const mudanca: MudancaDoCodigo = {};
      if (lido.valor && Math.abs(lido.valor - conta.valor) > 0.004) mudanca.valor = lido.valor;
      const diaDoTitulo = conta.vencimento?.slice(0, 10);
      if (lido.vencimento && lido.vencimento !== diaDoTitulo) mudanca.vencimento = lido.vencimento;

      setEtapa('Guardando no título…');
      await api.patch(`/contas-abertas/${conta.idFnApagar}`, {
        // O tipo vai junto: é ele que diz ao banco qual dos dois usar, quando
        // o título tem o código de barras e também uma chave Pix.
        ...(lido.forma === 'BOLETO'
          ? { tipoPagamento: 'Boleto', codigoBarras: lido.codigo }
          : { tipoPagamento: 'Pix', chavePix: lido.codigo, tipoChavePix: 'Código copia e cola' }),
        ...(mudanca.valor !== undefined ? { valor: mudanca.valor } : {}),
        ...(mudanca.vencimento ? { dataVencimento: mudanca.vencimento } : {}),
      });

      const texto =
        mudanca.valor !== undefined
          ? `${lido.recado} · o valor era ${formatBRL(conta.valor)}`
          : lido.recado;
      setRecado(texto);
      onAtualizada(mudanca, texto);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEtapa(null);
    }
  }

  /** Procura o código dentro do print, da foto ou do PDF e o usa. */
  async function doArquivo(arquivo: File) {
    setErro(null);
    setRecado(null);
    setEtapa('Procurando o código na imagem…');
    try {
      const { lerCodigosDoArquivo } = await import('../lib/ocr-pdf');
      const achados = await lerCodigosDoArquivo(arquivo);
      const codigo = escolherCodigoDoArquivo(achados);
      if (!codigo) {
        setErro(
          'Não achei código de barras nem QR Code nessa imagem. Corte só o código e tente de novo, ou use a câmera.',
        );
        return;
      }
      await usar(codigo);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEtapa(null);
    }
  }

  async function colar() {
    let texto = '';
    try {
      texto = (await navigator.clipboard?.readText?.()) ?? '';
    } catch {
      // O navegador não deixou ler: o Ctrl+V na janela faz o mesmo.
    }
    if (!texto.trim()) {
      setErro('Não há código copiado. Copie e toque de novo, ou use Ctrl+V na janela.');
      return;
    }
    await usar(texto);
  }

  // O Ctrl+V vale na janela inteira, sem ninguém clicar antes: a imagem copiada
  // vira leitura, e o texto só quando tem cara de código (um "bom dia" que
  // ficou copiado não é lido). Digitando num campo, o colar é do campo.
  const usarRef = useRef(usar);
  const doArquivoRef = useRef(doArquivo);
  const ocupadoRef = useRef(false);
  usarRef.current = usar;
  doArquivoRef.current = doArquivo;
  ocupadoRef.current = !!etapa;
  useEffect(() => {
    function aoColar(e: ClipboardEvent) {
      if (ocupadoRef.current || emCampoDeTexto(e.target)) return;
      const imagem = imagemDaColagem(e.clipboardData);
      if (imagem) {
        e.preventDefault();
        void doArquivoRef.current(imagem);
        return;
      }
      const texto = e.clipboardData?.getData('text') ?? '';
      if (pareceCodigoDePagamento(texto)) {
        e.preventDefault();
        void usarRef.current(texto);
      }
    }
    window.addEventListener('paste', aoColar);
    return () => window.removeEventListener('paste', aoColar);
  }, []);

  return (
    <div
      className="mt-4 rounded-2xl border border-dashed border-tinta-200 p-3"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const arquivo = Array.from(e.dataTransfer.files).find(
          (f) => f.type.startsWith('image/') || f.type === 'application/pdf',
        );
        if (arquivo && !etapa) void doArquivo(arquivo);
      }}
    >
      <p className="text-[13px] font-semibold text-tinta-800">
        Ler o código do boleto ou do Pix
      </p>
      {/* Ctrl+V e arrastar são do computador: no celular a linha só atrapalha. */}
      <p className="mt-0.5 hidden text-xs text-tinta-500 md:block">
        Cole o print do código de barras ou do QR (Ctrl+V), ou arraste a imagem aqui.
      </p>

      {/* No celular, duas colunas — quatro botões em fila ocupariam a tela. */}
      <div className="mt-2.5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
        {leitorDeCodigoSuportado() && (
          <>
            <button
              type="button"
              onClick={() => setCamera('pix')}
              disabled={!!etapa}
              className="btn btn-ferramenta"
            >
              Ler QR do Pix
            </button>
            <button
              type="button"
              onClick={() => setCamera('boleto')}
              disabled={!!etapa}
              className="btn btn-ferramenta"
            >
              Ler código de barras
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => void colar()}
          disabled={!!etapa}
          className="btn btn-ferramenta"
        >
          Colar código
        </button>
        <button
          type="button"
          onClick={() => escolher.current?.click()}
          disabled={!!etapa}
          className="btn btn-ferramenta"
        >
          Enviar imagem ou PDF
        </button>
        <input
          ref={escolher}
          type="file"
          accept="image/*,application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const arquivo = e.target.files?.[0];
            e.target.value = '';
            if (arquivo) void doArquivo(arquivo);
          }}
        />
      </div>

      {etapa && <p className="mt-2 text-xs font-semibold text-tinta-500">{etapa}</p>}
      {erro && (
        <p className="mt-2 text-sm font-semibold text-rose-600 dark:text-rose-300">{erro}</p>
      )}
      {recado && !etapa && (
        <p className="mt-2 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
          {recado}
        </p>
      )}

      {camera && (
        <LeitorDeCodigo
          alvo={camera}
          onLido={(codigo) => {
            setCamera(null);
            void usar(codigo);
          }}
          onFechar={() => setCamera(null)}
        />
      )}
    </div>
  );
}
