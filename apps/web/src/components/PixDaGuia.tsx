import { useState } from 'react';
import { api, mensagemErro } from '../lib/api';
import { LeitorDeCodigo, leitorDeCodigoSuportado } from './LeitorDeCodigo';
import { Aviso } from './ui';

/**
 * A guia que o banco não paga pelo código de barras — DARF, DAS, DARE, conta
 * de consumo —, paga pelo QR Code Pix dela.
 *
 * A API do ModoBank só paga boleto bancário e Pix; a guia de arrecadação ela
 * recusa. Toda guia de setembro/2026 trazia o QR Pix impresso, e ele paga.
 * Aqui ele entra pelo PDF da guia (o QR é lido do desenho da página, em
 * segundos) ou pela câmera, vai para a chave Pix da conta, e a prévia do banco
 * roda de novo — agora como Pix.
 */
export function PixDaGuia({
  idFnApagar,
  onPronto,
}: {
  idFnApagar: number;
  /** O Pix foi para a conta: quem chama pede a prévia de novo. */
  onPronto: () => void;
}) {
  const [etapa, setEtapa] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [camera, setCamera] = useState(false);

  async function gravar(pix: string) {
    setEtapa('Guardando o Pix na conta…');
    await api.patch(`/contas-abertas/${idFnApagar}`, {
      chavePix: pix,
      tipoChavePix: 'Código copia e cola',
    });
    onPronto();
  }

  async function doArquivo(arquivo: File) {
    setErro(null);
    setEtapa('Procurando o QR Code Pix na guia…');
    try {
      const { lerPixDoArquivo } = await import('../lib/ocr-pdf');
      const pix = await lerPixDoArquivo(arquivo);
      if (!pix) {
        setErro(
          'Não achei QR Code Pix nesse arquivo. Confira se é a guia certa, ou leia o QR com a câmera.',
        );
        return;
      }
      await gravar(pix);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEtapa(null);
    }
  }

  async function daCamera(pix: string) {
    setCamera(false);
    setErro(null);
    try {
      await gravar(pix);
    } catch (e) {
      setErro(mensagemErro(e));
    } finally {
      setEtapa(null);
    }
  }

  return (
    <Aviso tom="atencao">
      <p className="mb-2">
        Esta guia se paga pelo <strong>QR Code Pix</strong> dela — o banco não paga guia pelo
        código de barras.
      </p>
      <div className="flex flex-wrap gap-2">
        <label className={`btn btn-primario cursor-pointer ${etapa ? 'pointer-events-none opacity-60' : ''}`}>
          {etapa ?? 'Mandar o PDF da guia'}
          <input
            type="file"
            accept="application/pdf,.pdf,image/*"
            className="hidden"
            disabled={!!etapa}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void doArquivo(f);
            }}
          />
        </label>
        {leitorDeCodigoSuportado() && (
          <button
            type="button"
            onClick={() => setCamera(true)}
            disabled={!!etapa}
            className="btn btn-neutro"
          >
            Ler o QR com a câmera
          </button>
        )}
      </div>
      {erro && <p className="mt-2 text-sm text-rose-600">{erro}</p>}
      {camera && (
        <LeitorDeCodigo alvo="pix" onLido={(c) => void daCamera(c)} onFechar={() => setCamera(false)} />
      )}
    </Aviso>
  );
}
