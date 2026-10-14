import type { ReactNode } from 'react';
import { CampoDeData } from '../../components/CampoDeData';
import { CampoDinheiro, Selo, type Tom } from '../../components/ui';
import type {
  BlocoDoContrato,
  Patrocinado,
  SituacaoDoContrato,
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
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <Campo label="Nome do patrocinado" span2>
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
      <Campo label="Observações" span2>
        <textarea {...campo('observacoes')} rows={2} />
      </Campo>
    </div>
  );
}

export function Campo({
  label,
  span2,
  children,
}: {
  label: string;
  span2?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={span2 ? 'sm:col-span-2' : ''}>
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
  AGUARDANDO: { texto: 'a caminho', tom: 'atencao' },
  NAO_SAIU: { texto: 'não saiu', tom: 'erro' },
};

export function SeloDoPagamento({ situacao }: { situacao: SituacaoDoPagamento }) {
  const s = PAGAMENTO[situacao];
  return (
    <Selo tom={s.tom} pequeno>
      {s.texto}
    </Selo>
  );
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
