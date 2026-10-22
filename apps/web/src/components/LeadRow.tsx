import { leadPortals, priorityLabel } from '@homeradar/shared/core/leads';
import { recallLabel, recallStatus } from '@homeradar/shared/core/recall';
import { formatDate, formatEuro } from '@homeradar/shared/shared/format';
import { PORTAL_TAGS, type LeadView } from '@homeradar/shared/shared/types';
import { leadPath, linkProps } from '../router';
import { Cover } from './Cover';
import { Sparkline } from './Sparkline';

export const priceText = (price: number | null): string => (price != null ? `€ ${formatEuro(price)}` : 'Trattativa riservata');

/** Riga compatta della lista: apre la scheda del lead. Nessun comando di modifica qui. */
export function LeadRow({ lead, now, selected }: { lead: LeadView; now: number; selected: boolean }) {
  const { listing, evaluation, state } = lead;
  const portals = leadPortals(lead);
  const recall = state.status !== 'discarded' ? recallStatus(state.recallAt, now) : null;
  return (
    <li className={`lead lead--${evaluation.priority}${recall?.kind === 'overdue' ? ' lead--overdue' : ''}${selected ? ' lead--selected' : ''}`}>
      <a className="lead__link" {...linkProps(leadPath(listing.key))} aria-label={`Apri il lead: ${listing.title}`} aria-current={selected ? 'page' : undefined}>
        <Cover key={lead.covers.join(' ')} covers={lead.covers} />
        <div className="lead__main">
          <div className="lead__tags">
            {evaluation.priority !== 'none' && <span className={`pill pill--${evaluation.priority}`}>{priorityLabel(evaluation.priority, listing.portal)}</span>}
            {portals.map((p) => (
              <span key={p} className="portal-tag">{PORTAL_TAGS[p]}</span>
            ))}
            {portals.length > 1 && <span className="pill pill--multi">{`Su ${portals.length} portali`}</span>}
            {lead.reposted && <span className="pill pill--multi">Ripubblicato</span>}
            {lead.missing != null && <span className="pill pill--missing">{`Non più visto dal ${formatDate(lead.missing)}`}</span>}
          </div>
          <div className="lead__head">
            <div className="lead__title">{listing.title}</div>
            <div className="lead__price">{priceText(listing.currentPrice)}</div>
          </div>
          <div className="lead__meta">{evaluation.reasons.join(' · ')}</div>
          {recall && <span className={`recall__tag recall__tag--${recall.kind}`}>{`Richiamo ${recallLabel(recall)}`}</span>}
        </div>
        <Sparkline prices={lead.prices.map((p) => p.price)} />
      </a>
    </li>
  );
}
