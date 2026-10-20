import { useQuery } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { CampoDeData } from '../../components/CampoDeData';
import { CampoDinheiro, Carregando, Selo, type Tom } from '../../components/ui';
import { api, mensagemErro } from '../../lib/api';
import { useTermoAdiado } from '../../lib/busca';
import type {
  BlocoDoContrato,
  FornecedorParaPatrocinio,
  Patrocinado,
  SituacaoDoContrato,
  SituacaoDoMes,
  SituacaoDoPagamento,
} from '../../lib/types';

/** O cadastro como o formulário o edita: tudo texto, vazio = sem valor. */
export const CADASTRO_VAZIO = {
  nome: '',
  projeto: '',
  cpfCnpj: '',
  responsavel: '',
  telefone: '',
  email: '',
  instagram: '',
  cidade: '',
  valorMensal: '',
  inicio: '',
  fim: '',
  observacoes: '',
};

export type Cadastro = typeof CADASTRO_VAZIO;

export function cadastroDe(p: Patrocinado): Cadastro {
  return {
    nome: p.nome,
    projeto: p.projeto ?? '',
    cpfCnpj: p.cpfCnpj ?? '',
    responsavel: p.responsavel ?? '',
    telefone: p.telefone ?? '',
    email: p.email ?? '',
    instagram: p.instagram ?? '',
    cidade: p.cidade ?? '',
    valorMensal: p.valorMensal ?? '',
    inicio: p.inicio?.slice(0, 10) ?? '',
    fim: p.fim?.slice(0, 10) ?? '',
    observacoes: p.observacoes ?? '',
  };
}

/**
 * O corpo que vai para a API. Vazio vai como texto vazio, que o servidor
 * entende como "apagar" — é assim que se tira o e-mail de um cadastro.
 */
export function corpoDoCadastro(c: Cadastro) {
  return {
    nome: c.nome.trim(),
    projeto: c.projeto,
    cpfCnpj: c.cpfCnpj,
    responsavel: c.responsavel,
    telefone: c.telefone,
    email: c.email,
    instagram: c.instagram,
    cidade: c.cidade,
    valorMensal: c.valorMensal || null,
    inicio: c.inicio,
    fim: c.fim,
    observacoes: c.observacoes,
  };
}

/** Os campos do patrocinado — os mesmos no cadastro novo e na edição. */
export function CamposDoPatrocinado({
  form,
  setForm,
}: {
  form: Cadastro;
  setForm: (c: Cadastro) => void;
}) {
  const campo = (chave: keyof Cadastro) => ({
    value: form[chave],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [chave]: e.target.value }),
    className: 'campo',
    autoComplete: 'off',
  });

  return (
    <div className="grid max-w-2xl grid-cols-1 gap-3">
      <Campo label="Nome do patrocinado">
        <input {...campo('nome')} placeholder="Ex.: Maria Clara, Futsal Unidos" />
      </Campo>
      <Campo label="O que se patrocina">
        <input {...campo('projeto')} placeholder="Ex.: Atleta de jiu-jitsu" />
      </Campo>
      <Campo label="CPF / CNPJ">
        <input {...campo('cpfCnpj')} />
      </Campo>
      <Campo label="Responsável">
        <input {...campo('responsavel')} placeholder="O técnico, a mãe do atleta…" />
      </Campo>
      <Campo label="Telefone / WhatsApp">
        <input {...campo('telefone')} inputMode="tel" />
      </Campo>
      <Campo label="E-mail">
        <input {...campo('email')} type="email" inputMode="email" />
      </Campo>
      <Campo label="Instagram">
        <input {...campo('instagram')} placeholder="@perfil" />
      </Campo>
      <Campo label="Cidade">
        <input {...campo('cidade')} />
      </Campo>
      <Campo label="Apoio combinado por mês (R$)">
        <CampoDinheiro
          valor={form.valorMensal}
          onChange={(v) => setForm({ ...form, valorMensal: v })}
          placeholder="Vazio = sem valor fixo"
        />
      </Campo>
      <Campo label="Início do patrocínio">
        <CampoDeData valor={form.inicio} onChange={(v) => setForm({ ...form, inicio: v })} />
      </Campo>
      <Campo label="Fim do patrocínio">
        <CampoDeData valor={form.fim} onChange={(v) => setForm({ ...form, fim: v })} />
      </Campo>
      <Campo label="Observações">
        <textarea {...campo('observacoes')} rows={2} />
      </Campo>
    </div>
  );
}

export function Campo({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="rotulo">{label}</label>
      {children}
    </div>
  );
}

const CONTRATO: Record<SituacaoDoContrato, { texto: string; tom: Tom; titulo: string }> = {
  ASSINADO: { texto: 'contrato assinado', tom: 'pago', titulo: 'Assinado pelo link ou escaneado' },
  AGUARDANDO: { texto: 'aguardando assinatura', tom: 'atencao', titulo: 'O link saiu e ninguém assinou ainda' },
  VENCIDO: { texto: 'link vencido', tom: 'erro', titulo: 'O link venceu sem ninguém assinar — gere outro' },
  SEM_CONTRATO: { texto: 'sem contrato', tom: 'neutro', titulo: 'Nenhum contrato enviado nem guardado' },
};

export function SeloDoContrato({ situacao }: { situacao: SituacaoDoContrato }) {
  const s = CONTRATO[situacao];
  return (
    <Selo tom={s.tom} pequeno titulo={s.titulo}>
      {s.texto}
    </Selo>
  );
}

const PAGAMENTO: Record<SituacaoDoPagamento, { texto: string; tom: Tom }> = {
  PAGO: { texto: 'pago', tom: 'pago' },
  EM_ABERTO: { texto: 'em aberto', tom: 'atencao' },
};

export function SeloDoPagamento({ situacao }: { situacao: SituacaoDoPagamento }) {
  const s = PAGAMENTO[situacao];
  return (
    <Selo tom={s.tom} pequeno>
      {s.texto}
    </Selo>
  );
}

const MES: Record<SituacaoDoMes, { texto: string; tom: Tom; titulo: string }> = {
  PAGO: { texto: 'pago', tom: 'pago', titulo: 'Saiu o combinado do mês' },
  EM_ABERTO: { texto: 'em aberto', tom: 'atencao', titulo: 'Lançado no IXC, esperando ser pago' },
  PARCIAL: { texto: 'falta uma parte', tom: 'atencao', titulo: 'Saiu ou foi lançada só uma parte do combinado' },
  FALTA: { texto: 'falta pagar', tom: 'erro', titulo: 'Nada lançado no mês' },
  SEM_PAGAMENTO: { texto: 'nada no mês', tom: 'neutro', titulo: 'Sem valor combinado e sem pagamento no mês' },
};

export function SeloDoMes({ situacao }: { situacao: SituacaoDoMes }) {
  const s = MES[situacao];
  return (
    <Selo tom={s.tom} pequeno titulo={s.titulo}>
      {s.texto}
    </Selo>
  );
}

/** O fornecedor escolhido na busca — o que a API precisa para ligar. */
export interface FornecedorEscolhido {
  idFornecedor: number;
  nome: string;
  cpfCnpj?: string | null;
}

/**
 * Achar no IXC o fornecedor por onde o patrocinado recebe.
 *
 * Só os que já existem lá: o patrocinado já é fornecedor, e cadastrar outro
 * daqui encheria a base de duplicados. O que já paga outro patrocinado aparece,
 * mas não se escolhe — cada fornecedor paga um só.
 */
export function EscolherFornecedor({
  valor,
  onChange,
  patrocinadoId,
}: {
  valor: FornecedorEscolhido | null;
  onChange: (f: FornecedorEscolhido | null) => void;
  /** O próprio patrocinado, na troca: o fornecedor dele não é "de outro". */
  patrocinadoId?: string;
}) {
  const [termo, setTermo] = useState('');
  // Cada tecla aqui seria uma consulta ao IXC: a busca sai quando se para de digitar.
  const busca = useTermoAdiado(termo);

  const achados = useQuery({
    queryKey: ['patrocinio-fornecedores', busca],
    queryFn: async () =>
      (await api.get<FornecedorParaPatrocinio[]>('/patrocinios/fornecedores', { params: { busca } })).data,
    enabled: busca.length >= 2 && !valor,
  });

  if (valor) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-tinta-100 bg-realce px-3 py-1.5">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-tinta-900">{valor.nome}</div>
          <div className="num text-xs text-tinta-500">
            nº {valor.idFornecedor}
            {valor.cpfCnpj ? ` · ${valor.cpfCnpj}` : ''}
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            onChange(null);
            setTermo('');
          }}
          className="btn btn-sutil btn-p"
        >
          Trocar
        </button>
      </div>
    );
  }

  return (
    <>
      <input
        value={termo}
        onChange={(e) => setTermo(e.target.value)}
        type="search"
        placeholder="Razão social, fantasia ou CPF/CNPJ"
        className="campo"
        autoComplete="off"
      />
      {achados.isFetching && <Carregando texto="Procurando no IXC…" />}
      {achados.error && (
        <p className="mt-2 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {mensagemErro(achados.error)}
        </p>
      )}
      {achados.data && achados.data.length === 0 && (
        <p className="mt-2 text-sm text-tinta-500">
          Nenhum fornecedor ativo com esse nome no IXC. Se ele ainda não existe, cadastre-o lá
          primeiro.
        </p>
      )}
      {!!achados.data?.length && (
        <div className="mt-2 max-h-56 overflow-y-auto rolagem-fina rounded-xl border border-tinta-100">
          {achados.data.map((f) => {
            const deOutro = f.patrocinado && f.patrocinado.id !== patrocinadoId ? f.patrocinado : null;
            return (
              <button
                key={f.idFornecedor}
                type="button"
                disabled={!!deOutro}
                onClick={() => onChange({ idFornecedor: f.idFornecedor, nome: f.nome, cpfCnpj: f.cpfCnpj })}
                className="item-dividido flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-tinta-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm text-tinta-800">{f.nome}</span>
                  {deOutro ? (
                    <span className="block truncate text-xs text-amber-700">
                      já recebe pelo patrocínio de {deOutro.nome}
                    </span>
                  ) : (
                    f.nomeFantasia &&
                    f.nomeFantasia !== f.nome && (
                      <span className="block truncate text-xs text-tinta-400">{f.nomeFantasia}</span>
                    )
                  )}
                </span>
                <span className="num shrink-0 text-xs text-tinta-400">{f.cpfCnpj ?? `nº ${f.idFornecedor}`}</span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

/** "2026-10" → "outubro de 2026". */
export function mesPorExtenso(mes: string): string {
  const [ano, m] = mes.split('-').map(Number);
  return new Date(Date.UTC(ano, m - 1, 1)).toLocaleDateString('pt-BR', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** O texto do contrato, como o papel o mostra: seções, itens e parágrafos. */
export function TextoDoContrato({ blocos }: { blocos: BlocoDoContrato[] }) {
  return (
    <div className="space-y-2 text-sm leading-relaxed text-tinta-700">
      {blocos.map((b, i) =>
        b.tipo === 'secao' ? (
          <h3 key={i} className="pt-3 font-display text-[15px] font-semibold text-tinta-900">
            {b.texto}
          </h3>
        ) : b.tipo === 'item' ? (
          <p key={i} className="flex gap-2 pl-2">
            <span className="text-tinta-400">•</span>
            <span>{b.texto}</span>
          </p>
        ) : (
          <p key={i}>{b.texto}</p>
        ),
      )}
    </div>
  );
}

/** O mesmo corte do servidor (`blocosDoContrato`), para a tela pública. */
export function blocosDoTexto(texto: string): BlocoDoContrato[] {
  return texto
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l): BlocoDoContrato => {
      if (/^\d+\.\s/.test(l)) return { tipo: 'secao', texto: l };
      if (l.startsWith('•')) return { tipo: 'item', texto: l.replace(/^•\s*/, '') };
      return { tipo: 'paragrafo', texto: l };
    });
}

/** "de 01/10/2026 a 30/09/2027", "a partir de 01/10/2026", ou null. */
export function textoDaVigencia(inicio: string | null, fim: string | null): string | null {
  const dia = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
  if (inicio && fim) return `de ${dia(inicio)} a ${dia(fim)}`;
  if (inicio) return `a partir de ${dia(inicio)}`;
  if (fim) return `até ${dia(fim)}`;
  return null;
}

export function emMegabytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`;
}
