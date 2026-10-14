import { useQuery } from '@tanstack/react-query';
import { Bloco, CabecalhoPagina, Carregando, Pagina, Vazio } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import type { BlocoDoContrato } from '../../lib/types';
import { TextoDoContrato } from './comum';

/**
 * O contrato que vai no link, para ler antes de mandar. Só leitura: o texto
 * mora no código (`contrato.texto.ts` da API), e cada link guarda a cópia do
 * dia em que foi gerado.
 */
export function ContratoPadrao() {
  const contrato = useQuery({
    queryKey: ['contrato-padrao'],
    queryFn: async () =>
      (await api.get<{ texto: string; blocos: BlocoDoContrato[] }>('/patrocinios/contrato-padrao')).data,
    staleTime: Infinity,
  });

  return (
    <Pagina>
      <CabecalhoPagina secao="Contrato padrão" titulo="O que o patrocinado assina" />
      <Bloco className="surgir max-w-3xl">
        {contrato.isLoading && <Carregando />}
        {contrato.isError && <Vazio titulo="Não deu para carregar">{mensagemErro(contrato.error)}</Vazio>}
        {contrato.data && (
          <>
            <p className="mb-4 rounded-xl bg-tinta-50 px-4 py-3 text-sm text-tinta-600">
              No link, o contrato abre com o nome, o CPF/CNPJ, o projeto, o apoio mensal e a vigência
              do cadastro do patrocinado, seguidos destas cláusulas. Ele assina no celular, e o
              contrato assinado fica guardado em PDF na ficha dele.
            </p>
            <TextoDoContrato blocos={contrato.data.blocos} />
          </>
        )}
      </Bloco>
    </Pagina>
  );
}
