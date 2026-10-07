import type { TransferItem } from "@/lib/touchline/homepage-types";
import { Icon } from "./icons";
import { TeamCrest } from "./match-cards";

export function TransferCard({ transfer }: { transfer: TransferItem }) {
  return (
    <article className="transfer-card">
      <a className="transfer-card__main" href={transfer.href} aria-label={`${transfer.playerName} from ${transfer.fromTeam.name} to ${transfer.toTeam.name}, ${transfer.status}`}>
        <div className="transfer-card__player">
          {transfer.playerImage ? <img src={transfer.playerImage.src} alt="" loading="lazy" decoding="async" /> : <span className="transfer-card__initials" aria-hidden="true">{transfer.playerName.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>}
          <span><strong>{transfer.playerName}</strong><small>{transfer.updatedAt}</small></span>
        </div>
        <div className="transfer-card__details"><span className={`transfer-status transfer-status--${transfer.status.toLowerCase().replace(/ /g, "-")}`}>{transfer.status}</span>{transfer.fee && transfer.fee.trim() !== "—" && <span className="transfer-card__fee">{transfer.fee}</span>}</div>
        <div className="transfer-card__route">
          <span className="transfer-card__club"><TeamCrest team={transfer.fromTeam} size="sm" /><span>{transfer.fromTeam.shortName}</span></span>
          <Icon name="arrow-right" size={16} aria-hidden="true" />
          <span className="transfer-card__club"><TeamCrest team={transfer.toTeam} size="sm" /><span>{transfer.toTeam.shortName}</span></span>
        </div>
      </a>
    </article>
  );
}
