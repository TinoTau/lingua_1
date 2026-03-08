/**
 * Router 状态：按 room_id 维护 current_lang 与切换防抖
 */

import { SHORT_UTT_MS, TH_STRONG, TH_WEAK, CONFIRM_SWITCH_N, SWITCH_MIN_INTERVAL_MS, ROOM_STATE_TTL_SEC } from './lid-constants';

export interface RoomState {
  current_lang: string;
  last_switch_ms: number;
  pending_lang: string | null;
  pending_count: number;
  last_update_ms: number;
}

function defaultState(firstCandidate?: string): RoomState {
  return {
    current_lang: (firstCandidate && firstCandidate.trim()) ? firstCandidate.trim().split('-')[0].toLowerCase() : 'zh',
    last_switch_ms: 0,
    pending_lang: null,
    pending_count: 0,
    last_update_ms: 0,
  };
}

export class RoomStateStore {
  private store = new Map<string, RoomState>();

  /** firstCandidate：该房间首次出现时用作 current_lang 先验（来自 lid.candidates[0]），缺省为 zh */
  get(room_id: string, firstCandidate?: string): RoomState {
    let s = this.store.get(room_id);
    if (!s) {
      s = defaultState(firstCandidate);
      this.store.set(room_id, s);
    }
    return s;
  }

  cleanup(ttl_sec: number = ROOM_STATE_TTL_SEC): void {
    const now = Date.now();
    for (const [k, v] of this.store.entries()) {
      if (now - v.last_update_ms > ttl_sec * 1000) {
        this.store.delete(k);
      }
    }
  }
}

export interface RouterConfig {
  SHORT_UTT_MS: number;
  TH_STRONG: number;
  TH_WEAK: number;
  CONFIRM_SWITCH_N: number;
  SWITCH_MIN_INTERVAL_MS: number;
}

export const ROUTER_CONFIG: RouterConfig = {
  SHORT_UTT_MS,
  TH_STRONG,
  TH_WEAK,
  CONFIRM_SWITCH_N,
  SWITCH_MIN_INTERVAL_MS,
};
