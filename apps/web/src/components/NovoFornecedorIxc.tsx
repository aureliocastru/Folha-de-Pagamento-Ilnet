import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, mensagemErro } from '../lib/api';
import { FormularioEmPassos } from './FormularioEmPassos';
import { Aviso, Janela } from './ui';

/** O fornecedor como o IXC o devolve depois de cadastrado. */
export interface FornecedorCadastrado {
  idFornecedor: number;
  nome: string;
  nomeFantasia: string | null;
  cpfCnpj: string | null;
}

/**
 * Cadastra no IXC o fornecedor que a busca não achou — o "+" do campo de
 * fornecedor no "Lançar conta". Ele nasce lá e já volta escolhido.
 *
 * Com o CPF/CNPJ de alguém que já está no IXC, não nasce outro: a janela mostra
 * o que existe e oferece usá-lo.
 */
export function NovoFornecedorIxc({
  digitado,
  onFechar,
  onPronto,
}: {
  /** O que estava na busca: vira o nome, ou o documento se for só número. */
  digitado: string;
  onFechar: () => void;
  onPronto: (fornecedor: FornecedorCadastrado) => void;
}) {
  const qc = useQueryClient();
  const ehDocumento = /^[\d.\-/\s]+$/.test(digitado.trim());
  const [nome, setNome] = useState(ehDocumento ? '' : digitado.trim());
  const [cpfCnpj, setCpfCnpj] = useState(ehDocumento ? digitado.trim() : '');
  const [fantasia, setFantasia] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  /** O cadastro que já existia com o mesmo documento. */
  const [jaExistia, setJaExistia] = useState<FornecedorCadastrado | null>(null);

  const digitos = cpfCnpj.replace(/\D/g, '');
  const documentoErrado =
    digitos.length > 0 && digitos.length !== 11 && digitos.length !== 14;

  const cadastrar = useMutation({
    mutationFn: async () =>
      (
        await api.post<{
          fornecedor: FornecedorCadastrado;
          reaproveitado: boolean;
        }>('/fornecedores-ixc', {
          nome: nome.trim(),
          cpfCnpj: digitos || undefined,
          nomeFantasia: fantasia.trim() || undefined,
          telefone: telefone.trim() || undefined,
          email: email.trim() || undefined,
        })
      ).data,
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: ['fornecedores-ixc'] });
      if (r.reaproveitado) setJaExistia(r.fornecedor);
      else onPronto(r.fornecedor);
    },
  });

  if (jaExistia) {
    return (
      <Janela titulo="Já existe no IXC" onFechar={onFechar}>
        <p className="text-sm text-tinta-600">
          Este documento já é do fornecedor abaixo. Use este cadastro: é nele
          que estão os dados bancários.
        </p>
        <div className="mt-3 rounded-lg border border-tinta-100 bg-realce px-3 py-2">
          <div className="text-[13px] font-semibold text-tinta-900">
            {jaExistia.nome}
          </div>
          <div className="num text-xs text-tinta-500">
            nº {jaExistia.idFornecedor}
            {jaExistia.cpfCnpj ? ` · ${jaExistia.cpfCnpj}` : ''}
          </div>
        </div>
        <div className="mt-5 flex flex-wrap gap-3 border-t border-tinta-100 pt-4">
          <button
            type="button"
            onClick={() => onPronto(jaExistia)}
            className="btn btn-primario"
          >
            Usar este
          </button>
          <button type="button" onClick={onFechar} className="btn btn-neutro">
            Cancelar
          </button>
        </div>
      </Janela>
    );
  }

  return (
    <Janela titulo="Novo fornecedor no IXC" onFechar={onFechar}>
      <FormularioEmPassos>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            cadastrar.mutate();
          }}
        >
          <div className="grid grid-cols-1 gap-3">
            <div data-passo-falta={nome.trim().length < 2 ? 'Escreva o nome.' : undefined}>
              <label className="rotulo" htmlFor="novo-forn-nome">
                Razão social ou nome
              </label>
              <input
                id="novo-forn-nome"
                value={nome}
                onChange={(e) => setNome(e.target.value)}
                className="campo"
                autoComplete="off"
                autoFocus={!ehDocumento || !!nome}
                required
              />
            </div>
            <div
              data-passo-falta={
                documentoErrado ? 'O CPF tem 11 números e o CNPJ, 14.' : undefined
              }
            >
              <label className="rotulo" htmlFor="novo-forn-doc">
                CPF ou CNPJ
              </label>
              <input
                id="novo-forn-doc"
                value={cpfCnpj}
                onChange={(e) => setCpfCnpj(e.target.value)}
                className="campo num"
                inputMode="numeric"
                autoComplete="off"
              />
              {documentoErrado && (
                <p className="ajuda text-amber-700">
                  O CPF tem 11 números e o CNPJ, 14.
                </p>
              )}
            </div>
            <div>
              <label className="rotulo" htmlFor="novo-forn-fantasia">
                Fantasia (como é conhecido)
              </label>
              <input
                id="novo-forn-fantasia"
                value={fantasia}
                onChange={(e) => setFantasia(e.target.value)}
                className="campo"
                placeholder="Ex.: Deda pedreiro"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="rotulo" htmlFor="novo-forn-telefone">
                Telefone
              </label>
              <input
                id="novo-forn-telefone"
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                className="campo"
                inputMode="tel"
                autoComplete="off"
              />
            </div>
            <div>
              <label className="rotulo" htmlFor="novo-forn-email">
                E-mail
              </label>
              <input
                id="novo-forn-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="campo"
                type="email"
                autoComplete="off"
              />
            </div>
          </div>

          {cadastrar.isError && (
            <div className="mt-4">
              <Aviso tom="erro">{mensagemErro(cadastrar.error)}</Aviso>
            </div>
          )}

          <div className="mt-5 flex flex-wrap gap-3 border-t border-tinta-100 pt-4">
            <button
              type="submit"
              disabled={
                nome.trim().length < 2 || documentoErrado || cadastrar.isPending
              }
              className="btn btn-primario"
            >
              {cadastrar.isPending ? 'Cadastrando…' : 'Cadastrar'}
            </button>
            <button type="button" onClick={onFechar} className="btn btn-neutro">
              Cancelar
            </button>
          </div>
        </form>
      </FormularioEmPassos>
    </Janela>
  );
}
