/* Native responsive images are used so the existing media URLs can provide srcSet without requiring a next.config remote-host change. */
"use client";

import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { NewsStory, TransferItem, TransferStatus } from "@/lib/touchline/homepage-types";
import { initials, pluralise, readFee, statusSlug } from "@/lib/touchline/directory-data";
import { DirectoryEmpty } from "./index-shell";
import { Icon } from "./icons";
import { NewsCard } from "./news-card";

const STATUS_ORDER: TransferStatus[] = ["Official", "In talks", "Reported", "Loan watch"];

/**
 * Presentation-layer enrichment resolved from existing records only:
 * the player profile whose name matches the transfer entry. No model change.
 */
export type EnrichedTransfer = TransferItem & {
  playerHref?: string;
  playerPosition?: string;
};

function ClubMark({ team, size = "md" }: { team: TransferItem["fromTeam"]; size?: "sm" | "md" }) {
  return (
    <span className={`tx-club-mark tx-club-mark--${size}`} style={{ "--tx-accent": team.accent ?? "#2c3d30" } as CSSProperties}>
      {team.logoUrl ? <img src={team.logoUrl} alt="" loading="lazy" decoding="async" /> : <span>{initials(team.shortName)}</span>}
    </span>
  );
}

function StatusChip({ status }: { status: string }) {
  return <span className={`tx-status tx-status--${statusSlug(status)}`}>{status}</span>;
}

function ClubCell({ team, label }: { team: TransferItem["fromTeam"]; label: string }) {
  return (
    <span className="tx-club">
      <span className="tx-cell-label" aria-hidden="true">{label}</span>
      <ClubMark team={team} />
      <span className="tx-club__name">{team.shortName}</span>
    </span>
  );
}

function PlayerCell({ transfer }: { transfer: EnrichedTransfer }) {
  const body = (
    <>
      <span className="tx-player__mark">
        {transfer.playerImage ? (
          <img src={transfer.playerImage.src} alt="" loading="lazy" decoding="async" />
        ) : (
          <span aria-hidden="true">{initials(transfer.playerName)}</span>
        )}
      </span>
      <span className="tx-player__copy">
        <span className="tx-player__name">{transfer.playerName}{transfer.playerHref && <Icon name="arrow-up-right" size={14} aria-hidden="true" />}</span>
        {transfer.playerPosition && <span className="tx-player__position">{transfer.playerPosition}</span>}
        <span className="tx-player__meta">{transfer.updatedAt}</span>
      </span>
    </>
  );
  if (transfer.playerHref) {
    return (
      <a className="tx-player" href={transfer.playerHref} aria-label={`View ${transfer.playerName} player profile`}>
        {body}
      </a>
    );
  }
  return <span className="tx-player">{body}</span>;
}

function MovementRow({ transfer, showFee }: { transfer: EnrichedTransfer; showFee: boolean }) {
  const fee = readFee(transfer.fee);
  return (
    <tr className="tx-row">
      <th className="tx-cell tx-cell--player" scope="row">
        <PlayerCell transfer={transfer} />
      </th>
      <td className="tx-cell tx-cell--club"><ClubCell team={transfer.fromTeam} label="From" /></td>
      <td className="tx-cell tx-cell--arrow" aria-hidden="true"><span className="tx-arrow"><Icon name="arrow-right" size={16} /></span></td>
      <td className="tx-cell tx-cell--club"><ClubCell team={transfer.toTeam} label="To" /></td>
      <td className="tx-cell tx-cell--status"><StatusChip status={transfer.status} /></td>
      {showFee && (
        <td className="tx-cell tx-cell--fee">
          {fee ? <><span className="tx-cell-label" aria-hidden="true">Fee</span>{fee}</> : null}
        </td>
      )}
    </tr>
  );
}

export function TransferHub({ transfers, stories }: { transfers: EnrichedTransfer[]; stories: NewsStory[] }) {
  const [status, setStatus] = useState<string>("All");

  const statuses = useMemo(() => {
    const present = new Set(transfers.map((transfer) => transfer.status));
    const ordered = STATUS_ORDER.filter((item) => present.has(item));
    for (const item of present) if (!ordered.includes(item)) ordered.push(item);
    return ordered;
  }, [transfers]);

  const filtered = useMemo(() => {
    return transfers.filter((transfer) => status === "All" || transfer.status === status);
  }, [transfers, status]);

  const showFee = transfers.some((transfer) => readFee(transfer.fee));
  const journalLead = stories[0];
  const journalRest = stories.slice(1, 3);

  return (
    <>
      <div className="tx-hub">
        <section className="tx-tracker" aria-labelledby="tx-tracker-heading">
          <header className="tx-section-heading">
            <div>
              <p className="eyebrow">Tracker</p>
              <h2 id="tx-tracker-heading">Player movement</h2>
            </div>
          </header>

          {statuses.length > 1 && (
            <div className="tx-controls">
              <div className="tx-status-rail" role="group" aria-label="Filter by transfer status">
                <button type="button" className={`tx-status-chip${status === "All" ? " is-active" : ""}`} aria-pressed={status === "All"} onClick={() => setStatus("All")}>
                  All<span className="tx-status-chip__count">{transfers.length}</span>
                </button>
                {statuses.map((item) => (
                  <button key={item} type="button" className={`tx-status-chip${status === item ? " is-active" : ""}`} aria-pressed={status === item} onClick={() => setStatus(item)}>
                    {item}<span className="tx-status-chip__count">{transfers.filter((transfer) => transfer.status === item).length}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {filtered.length === 0 ? (
            <DirectoryEmpty
              title={transfers.length === 0 ? "No transfer activity" : "No moves with this status"}
              description={transfers.length === 0 ? "Check back soon." : "Try a different status."}
            />
          ) : (
            <>
              <p className="tx-table-meta" aria-live="polite">{pluralise(filtered.length, "move")}</p>
              <div className="tx-table-wrap">
                <table className="tx-table">
                  <caption className="sr-only">Player transfers: player, from club, to club, status and fee.</caption>
                  <thead>
                    <tr>
                      <th scope="col">Player</th>
                      <th scope="col">From</th>
                      <th scope="col"><span className="sr-only">To</span></th>
                      <th scope="col">To</th>
                      <th scope="col">Status</th>
                      {showFee && <th scope="col">Fee</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((transfer) => (
                      <MovementRow transfer={transfer} showFee={showFee} key={transfer.id} />
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        {stories.length > 0 && (
          <section className="tx-journalism" aria-labelledby="tx-journalism-heading">
            <header className="tx-section-heading tx-section-heading--inverse">
              <div>
                <p className="eyebrow">Analysis</p>
                <h2 id="tx-journalism-heading">Transfer news</h2>
              </div>
              <a className="text-link tx-journalism__all" href="/news">
                All news
                <Icon name="arrow-right" size={16} />
              </a>
            </header>
            <div className="tx-journalism__body">
              {journalLead && (
                <div className="tx-journalism__lead">
                  <NewsCard story={journalLead} variant="standard" />
                </div>
              )}
              {journalRest.length > 0 && (
                <div className="tx-journalism__list">
                  {journalRest.map((story) => (
                    <NewsCard story={story} variant="compact" key={story.id} />
                  ))}
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </>
  );
}
