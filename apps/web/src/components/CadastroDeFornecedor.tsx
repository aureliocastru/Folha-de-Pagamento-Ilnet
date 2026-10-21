import { useMutation, useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { api, mensagemErro } from '../lib/api';
import {
  TIPOS_CHAVE_PIX,
  type BeneficiarioSalvo,
  type CategoriaDespesa,
  type ConsultaCpfCnpj,
  type FormaPagamento,
} from '../lib/types';
import { FormularioEmPassos } from './FormularioEmPassos';
import { SeletorDeCategoria } from './SeletorDeCategoria';
import { Aviso } from './ui';

/** Cadastro em branco: começa no IXC, que é a forma rastreável. */
const CADASTRO_VAZIO = {
  nome: '',
  cpfCnpj: '',
  tipoPessoa: 'F',
  chavePix: '',
  tipoChavePix: '',
  formaPagamento: 'IXC' as FormaPagamento,
  categoriaId: '',
  observacoes: '',
};

type Cadastro = typeof CADASTRO_VAZIO;

/** O que fazer com o fornecedor que já existe no IXC com aquele documento. */
type EscolhaFornecedor =
  | { tipo: 'PERGUNTAR'; consulta: ConsultaCpfCnpj }
  | { tipo: 'REUSAR'; idFornecedorIxc: number; semPix: boolean }
  /**
   * `apesarDeExistir` é a diferença entre "não perguntamos nada" e "perguntamos
   * e a pessoa disse para criar outro".
   *
   * O servidor só pula a busca por CPF/CNPJ quando recebe `fornecedorNovoNoIxc`
   * ligado. Sem esta marca, o "Criar um novo mesmo assim" saía igual ao estado
   * inicial: o cadastro ia com ela desligada, a busca do servidor achava o
   * fornecedor que a tela acabara de mostrar, e vinculava a ele — desfazendo
   * calada a única escolha que a tela tinha pedido.
   */
  | { tipo: 'NOVO'; apesarDeExistir?: boolean };

/**
 * O cadastro de fornecedor (ou de beneficiário, na folha): o mesmo na tela de
 * Fornecedores e no "+" do "Lançar conta", para os dois não divergirem.
 *
 * Nasce aqui e no IXC de uma vez — ver `criarBeneficiario` no servidor.
 */
export function CadastroDeFornecedor({
  digitado = '',
  onSalvo,
  onCancelar,
}: {
  /** O que estava na busca: vira o nome, ou o documento se for só número. */
  digitado?: string;
  onSalvo: (salvo: BeneficiarioSalvo) => void;
  onCancelar: () => void;
}) {
  const [form, setForm] = useState<Cadastro>(() => {
    const t = digitado.trim();
    if (!t) return CADASTRO_VAZIO;
    const ehDocumento = /^[\d.\-/\s]+$/.test(t);
    const digitos = t.replace(/\D/g, '');
    return ehDocumento
      ? { ...CADASTRO_VAZIO, cpfCnpj: t, tipoPessoa: digitos.length === 14 ? 'J' : 'F' }
      : { ...CADASTRO_VAZIO, nome: t };
  });
  const [fornecedor, setFornecedor] = useState<EscolhaFornecedor>({
    tipo: 'NOVO',
  });
  const [aviso, setAviso] = useState<{ texto: string; ruim: boolean } | null>(
    null,
  );

  function avisar(texto: string, ruim = false) {
    setAviso({ texto, ruim });
  }

  const categorias = useQuery({
    queryKey: ['categorias-despesa'],
    queryFn: async () =>
      (await api.get<CategoriaDespesa[]>('/categorias-despesa')).data,
  });

  /**
   * Antes de cadastrar, pergunta ao IXC se aquele documento já é fornecedor.
   * Reaproveitar é quase sempre o certo — é no cadastro antigo que estão os
   * dados bancários — mas quem sabe se é a mesma pessoa é quem está aqui.
   */
  const consultar = useMutation({
    mutationFn: async (cpfCnpj: string) =>
      (
        await api.get<ConsultaCpfCnpj>('/avulsos/consultar-documento', {
          params: { cpfCnpj },
        })
      ).data,
    onSuccess: (consulta) => {
      if (consulta.beneficiario) {
        avisar(
          `${consulta.beneficiario.nome} já está cadastrado aqui com esse documento — use o cadastro dele em vez de criar outro.`,
          true,
        );
        return;
      }
      if (consulta.fornecedor) {
        setFornecedor({ tipo: 'PERGUNTAR', consulta });
        return;
      }
      setFornecedor({ tipo: 'NOVO' });
      avisar(
        consulta.ixcIndisponivel
          ? `Não deu para consultar o IXC agora (${consulta.ixcIndisponivel}). Dá para cadastrar assim mesmo.`
          : 'Nenhum fornecedor com esse documento no IXC — será criado um novo.',
        !!consulta.ixcIndisponivel,
      );
    },
    onError: (err) => avisar(mensagemErro(err), true),
  });

  const salvar = useMutation({
    mutationFn: async () =>
      (
        await api.post<BeneficiarioSalvo>('/avulsos/beneficiarios', {
          nome: form.nome,
          cpfCnpj: form.cpfCnpj || undefined,
          tipoPessoa: form.tipoPessoa,
          chavePix: form.chavePix || undefined,
          tipoChavePix: form.tipoChavePix,
          valorPorVenda: null,
          formaPagamento: form.formaPagamento,
          categoriaId: form.categoriaId || null,
          observacoes: form.observacoes || undefined,
          ...(fornecedor.tipo === 'REUSAR'
            ? { idFornecedorIxc: fornecedor.idFornecedorIxc }
            : {}),
          ...(fornecedor.tipo === 'NOVO'
            ? { fornecedorNovoNoIxc: fornecedor.apesarDeExistir ?? false }
            : {}),
        })
      ).data,
    onSuccess: onSalvo,
    onError: (err) => avisar(mensagemErro(err), true),
  });

  /**
   * Reusar o cadastro do IXC traz o que ele já tem. O motivo de reusar é não
   * redigitar — vir com os campos vazios seria o pior dos dois mundos.
   *
   * Só completa o que está em branco: o que a pessoa já escreveu foi escolha
   * dela, e o IXC não tem por que desfazê-la.
   */
  function usarFornecedor(f: NonNullable<ConsultaCpfCnpj['fornecedor']>) {
    setForm((atual) => ({
      ...atual,
      nome: atual.nome || f.nome,
      // Tipo de pessoa não é preferência de quem digita, é um fato do cadastro
      // — e o campo já nasce em "Física", então esperar que esteja vazio seria
      // esperar para sempre. O IXC ainda tem "Estrangeiro", que aqui não existe.
      tipoPessoa: f.tipoPessoa === 'J' ? 'J' : 'F',
      chavePix: atual.chavePix || (f.chavePix ?? ''),
      tipoChavePix: atual.tipoChavePix || (f.tipoChavePix ?? ''),
    }));
    setFornecedor({
      tipo: 'REUSAR',
      idFornecedorIxc: f.idFornecedor,
      semPix: !f.chavePix,
    });
    avisar(
      f.chavePix
        ? `Peguei os dados de ${f.nome} no IXC, inclusive a chave PIX dos dados bancários.`
        : `Peguei os dados de ${f.nome} no IXC. Ele não tem chave PIX cadastrada lá — preencha aqui que eu subo para o cadastro dele.`,
    );
  }

  const nomeValido = form.nome.trim().length >= 2;

  return (
    <FormularioEmPassos>
      {/*
        Na ordem em que se cadastra, e não na em que os campos nasceram.

        O documento vem antes do nome de propósito: é por ele que se
        pergunta ao IXC se aquela pessoa já está lá, e, estando, o cadastro
        de lá é reaproveitado com os dados bancários que já tem. Digitar o
        nome primeiro é digitar o que talvez não precise ser digitado.

        Telefone e e-mail saíram. O cadastro de fornecedor do IXC exige
        razão social, tipo de pessoa, cidade e data — e aceita os dois
        vazios; ficavam em branco em quase todo cadastro daqui. Campo que
        ninguém preenche só faz o formulário parecer maior do que é.
      */}
      <div className="grid max-w-2xl grid-cols-1 gap-3">
        <Campo label="Tipo de pessoa">
          <select
            value={form.tipoPessoa}
            onChange={(e) => setForm({ ...form, tipoPessoa: e.target.value })}
            className="campo"
          >
            <option value="F">Física</option>
            <option value="J">Jurídica</option>
          </select>
        </Campo>
        <Campo label={form.tipoPessoa === 'J' ? 'CNPJ' : 'CPF'}>
          <div className="flex gap-2">
            <input
              value={form.cpfCnpj}
              onChange={(e) => {
                setForm({ ...form, cpfCnpj: e.target.value });
                setFornecedor({ tipo: 'NOVO' });
              }}
              className="campo"
              placeholder="Confira no IXC antes de preencher o resto"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => consultar.mutate(form.cpfCnpj)}
              disabled={form.cpfCnpj.trim().length < 3 || consultar.isPending}
              className="btn btn-ferramenta shrink-0"
              title="Procura no IXC um fornecedor já cadastrado com esse documento"
            >
              {consultar.isPending ? 'Vendo…' : 'Conferir no IXC'}
            </button>
          </div>
        </Campo>
        <Campo label="Nome ou razão social">
          <input
            value={form.nome}
            onChange={(e) => setForm({ ...form, nome: e.target.value })}
            className="campo"
            placeholder="Ex.: João da Silva"
            autoComplete="off"
          />
          <p className="ajuda">
            É com este nome que o fornecedor nasce no IXC — o mesmo que aparece
            na conta a pagar.
          </p>
        </Campo>
        <Campo label="Como costuma receber">
          <select
            value={form.formaPagamento}
            onChange={(e) =>
              setForm({
                ...form,
                formaPagamento: e.target.value as FormaPagamento,
              })
            }
            className="campo"
          >
            <option value="IXC">Pelo IXC (conta a pagar)</option>
            <option value="EM_MAOS">Em mãos (sai do caixa)</option>
          </select>
        </Campo>
        <Campo label="Chave PIX">
          <input
            value={form.chavePix}
            onChange={(e) => setForm({ ...form, chavePix: e.target.value })}
            className="campo"
            placeholder="Sem ela o banco não paga"
            autoComplete="off"
          />
        </Campo>
        <Campo label="Tipo da chave">
          <select
            value={form.tipoChavePix}
            onChange={(e) => setForm({ ...form, tipoChavePix: e.target.value })}
            className="campo"
          >
            <option value="">Pelo formato da chave</option>
            {TIPOS_CHAVE_PIX.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Categoria dos pagamentos">
          <SeletorDeCategoria
            categorias={categorias.data}
            value={form.categoriaId}
            vazio="Escolher na hora de pagar"
            carregando={categorias.isLoading}
            onChange={(id) => setForm({ ...form, categoriaId: id })}
            title="É por ela que o dashboard separa os gastos. Fica guardada aqui — o IXC não tem onde recebê-la."
          />
          <p className="ajuda">
            Já vem marcada em todo pagamento a essa pessoa — e dá para trocar
            na hora.
          </p>
        </Campo>
        <Campo label="Observações">
          <input
            value={form.observacoes}
            onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
            className="campo"
            placeholder="O que essa pessoa faz, combinados…"
            autoComplete="off"
          />
        </Campo>
      </div>

      {aviso && (
        <div className="mt-4" data-passo-acao>
          <Aviso tom={aviso.ruim ? 'erro' : 'marca'}>{aviso.texto}</Aviso>
        </div>
      )}

      {fornecedor.tipo === 'PERGUNTAR' && fornecedor.consulta.fornecedor && (
        <EscolhaDoFornecedor
          fornecedor={fornecedor.consulta.fornecedor}
          onReusar={() => usarFornecedor(fornecedor.consulta.fornecedor!)}
          onNovo={() => setFornecedor({ tipo: 'NOVO', apesarDeExistir: true })}
        />
      )}
      {fornecedor.tipo === 'REUSAR' && (
        <Aviso tom="pago">
          Vai usar o fornecedor #{fornecedor.idFornecedorIxc} que já existe no
          IXC
          {fornecedor.semPix
            ? ' — ele ainda não tem chave PIX cadastrada lá. A que você preencher aqui sobe para os dados bancários dele ao salvar, e no próximo pagamento já vem pronta.'
            : '.'}
        </Aviso>
      )}

      <div className="mt-5 flex flex-wrap gap-3 border-t border-tinta-100 pt-4">
        <button
          type="button"
          onClick={() => salvar.mutate()}
          disabled={
            !nomeValido || salvar.isPending || fornecedor.tipo === 'PERGUNTAR'
          }
          className="btn btn-primario"
        >
          {salvar.isPending ? 'Salvando…' : 'Salvar'}
        </button>
        <button type="button" onClick={onCancelar} className="btn btn-neutro">
          Cancelar
        </button>
        {fornecedor.tipo === 'PERGUNTAR' && (
          <span className="text-sm text-amber-700">
            Escolha acima o que fazer com o fornecedor que já existe.
          </span>
        )}
      </div>
    </FormularioEmPassos>
  );
}

function EscolhaDoFornecedor({
  fornecedor,
  onReusar,
  onNovo,
}: {
  fornecedor: NonNullable<ConsultaCpfCnpj['fornecedor']>;
  onReusar: () => void;
  onNovo: () => void;
}) {
  return (
    <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <p className="text-sm text-amber-900">
        Esse CPF/CNPJ já é fornecedor no IXC:{' '}
        <strong>{fornecedor.nome}</strong> (#{fornecedor.idFornecedor})
        {!fornecedor.ativo && ' — inativo por lá'}. O que você quer fazer?
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={onReusar} className="btn btn-primario btn-p">
          Usar esse fornecedor
        </button>
        <button type="button" onClick={onNovo} className="btn btn-neutro btn-p">
          Criar um novo mesmo assim
        </button>
      </div>
      <p className="mt-2 text-xs text-amber-800">
        Usar o que existe costuma ser o certo: é lá que estão os dados bancários
        e o histórico. Criar outro faz sentido quando é outra pessoa com o
        documento digitado igual por engano.
      </p>
    </div>
  );
}

function Campo({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <label className="rotulo">{label}</label>
      {children}
    </div>
  );
}
