export type EvidenceStatus = 'ESTABLISHED' | 'CONSENSUS' | 'CONVENTION' | 'ASSUMPTION' | 'OPTIONAL';

const STYLE: Record<EvidenceStatus, { bg: string; fg: string }> = {
  ESTABLISHED: { bg: '#1b4332', fg: '#95d5b2' },
  CONSENSUS: { bg: '#1e3a5f', fg: '#a8d0f0' },
  CONVENTION: { bg: '#3d3010', fg: '#e8c468' },
  ASSUMPTION: { bg: '#4a1d1d', fg: '#f0a8a8' },
  OPTIONAL: { bg: '#2a2a3d', fg: '#c5b8f0' },
};

const TOOLTIP: Record<EvidenceStatus, string> = {
  ESTABLISHED: 'Direct empirical measurement, multi-site.',
  CONSENSUS: "Professional-society guideline position (e.g. ENA).",
  CONVENTION: 'Common industry practice, not independently validated.',
  ASSUMPTION: 'No evidence base — an engineering starting point, exposed so it can be overridden.',
  OPTIONAL: 'Not required — the tool degrades gracefully if left blank.',
};

export function EvidenceBadge({
  status,
  defaultValue,
  note,
}: {
  status: EvidenceStatus;
  defaultValue?: string;
  note?: string;
}) {
  const style = STYLE[status];
  return (
    <span
      className="evidence-badge"
      style={{ backgroundColor: style.bg, color: style.fg }}
      title={note ?? TOOLTIP[status]}
    >
      {status}
      {defaultValue ? ` · default ${defaultValue}` : ''}
    </span>
  );
}
