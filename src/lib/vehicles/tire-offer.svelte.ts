import type { TireSeason } from "$lib/api/enums";
import { tireChange } from "./tire-task";

export type TireOffer = {
  assetId: string;
  taskTitle: string;
  season: TireSeason | null;
};

const OFFER_DELAY_MS = 400;

export class TireOffers {
  current = $state.raw<TireOffer | null>(null);
  #timer: ReturnType<typeof setTimeout> | undefined;

  offer(task: { title: string; assetId?: string | null | undefined }): void {
    if (!task.assetId) return;
    const change = tireChange(task.title);
    if (!change) return;
    const offer: TireOffer = {
      assetId: task.assetId,
      taskTitle: task.title,
      season: change.season,
    };
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.current = offer;
    }, OFFER_DELAY_MS);
  }

  dismiss(): void {
    clearTimeout(this.#timer);
    this.current = null;
  }
}

export const tireOffers = new TireOffers();
