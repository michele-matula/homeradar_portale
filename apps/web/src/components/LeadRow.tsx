import { leadPortals, priorityLabel } from '@homeradar/shared/core/leads';
import { recallLabel, recallStatus } from '@homeradar/shared/core/recall';
import { formatDate, formatEuro, formatPercent } from '@homeradar/shared/shared/format';
import { PORTAL_TAGS, type LeadView } from '@homeradar/shared/shared/types';
import { leadPath, linkProps } from '../router';
import { Cover } from './Cover';
import { Sparkline } from './Sparkline';

export const priceText = (price: number | null): string => (price != null ? `€ ${formatEuro(price)}` : 'Trattativa riservata');

/** Locali, superficie, città e zona: i campi che mancano si saltano. */
export function factsText(l: LeadView['listing']): string {
  return [l.rooms != null ? `${l.rooms} locali` : null, l.surfaceM2 != null ? `${l.surfaceM2} m²` : null, l.city, l.zone].filter(Boolean).join(' · ');
}

/** Ribasso da mostrare: prezzo più alto conosciuto e percentuale; null se il prezzo non è mai sceso. */
export function dropOf(lead: LeadView): { from: number; percent: number } | null {
  const { dropPercent, maxKnownPrice } = lead.evaluation;
  return dropPercent > 0 && maxKnownPrice != null ? { from: maxKnownPrice, percent: dropPercent } : null;
}

/** Scheda della lista: foto, prezzo, dati e motivi; apre la finestra del lead. Nessun comando di modifica qui. */
export function LeadRow({ lead, now, selected, isNew }: { lead: LeadView; now: number; selected: boolean; isNew: boolean }) {
  const { listing, evaluation, state } = lead;
  const portals = leadPortals(lead);
  const recall = state.status !== 'discarded' ? recallStatus(state.recallAt, now) : null;
  const drop = dropOf(lead);
  const facts = factsText(listing);
  return (
    <li className={`lead lead--${evaluation.priority}${recall?.kind === 'overdue' ? ' lead--overdue' : ''}${isNew ? ' lead--new' : ''}${selected ? ' lead--selected' : ''}`}>
      <a className="lead__link" {...linkProps(leadPath(listing.key))} aria-label={`Apri il lead: ${listing.title}`} aria-current={selected ? 'page' : undefined}>
        <div className="lead__photo">
          <Cover key={lead.covers.join(' ')} covers={lead.covers} size="card" />
          {isNew && <span className="new-badge">NUOVO</span>}
        </div>
        <div className="lead__main">
          <div className="lead__price">
            {priceText(listing.currentPrice)}
            {drop && <s className="lead__was">{priceText(drop.from)}</s>}
            {drop && <span className="lead__drop">{`−${formatPercent(drop.percent)}%`}</span>}
          </div>
          <div className="lead__title">{listing.title}</div>
          {facts && <div className="lead__facts">{facts}</div>}
          {evaluation.reasons.length > 0 && <div className="lead__meta">{evaluation.reasons.join(' · ')}</div>}
          <div className="lead__tags">
            {evaluation.priority !== 'none' && <span className={`pill pill--${evaluation.priority}`}>{priorityLabel(evaluation.priority, listing.portal)}</span>}
            {drop && <span className="pill pill--drop">{`Ribassato −${formatPercent(drop.percent)}%`}</span>}
            {portals.map((p) => (
              <span key={p} className="portal-tag">{PORTAL_TAGS[p]}</span>
            ))}
            {portals.length > 1 && <span className="pill pill--multi">{`Su ${portals.length} portali`}</span>}
            {lead.reposted && <span className="pill pill--multi">Ripubblicato</span>}
            {lead.missing != null && <span className="pill pill--missing">{`Non più visto dal ${formatDate(lead.missing)}`}</span>}
            {recall && <span className={`recall__tag recall__tag--${recall.kind}`}>{`Richiamo ${recallLabel(recall)}`}</span>}
          </div>
        </div>
        <Sparkline prices={lead.prices.map((p) => p.price)} />
      </a>
    </li>
  );
}
