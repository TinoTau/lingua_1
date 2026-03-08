/**
 * LID Router：状态机稳定切换，输出 selected_src_lang
 */

import { RoomStateStore, ROUTER_CONFIG, RouterConfig } from './router-state';
import { RouterResult } from './lid-types';

export function selectSrcLang(
  store: RoomStateStore,
  room_id: string,
  audio_ms: number,
  lang_pred: string,
  p: number,
  strategy: string,
  cfg: RouterConfig = ROUTER_CONFIG
): RouterResult {
  const now = Date.now();
  const state = store.get(room_id);
  state.last_update_ms = now;

  const current = state.current_lang;

  if (strategy !== 'model') {
    return { selected_src_lang: current, current_src_lang: current, switched: false, reason: 'lid_not_model' };
  }

  if (audio_ms < cfg.SHORT_UTT_MS) {
    return { selected_src_lang: current, current_src_lang: current, switched: false, reason: 'short_utt' };
  }

  if (p >= cfg.TH_STRONG) {
    if (now - state.last_switch_ms > cfg.SWITCH_MIN_INTERVAL_MS && lang_pred !== state.current_lang) {
      state.current_lang = lang_pred;
      state.last_switch_ms = now;
      state.pending_lang = null;
      state.pending_count = 0;
      return { selected_src_lang: lang_pred, current_src_lang: lang_pred, switched: true, reason: 'strong_switch' };
    }
    state.pending_lang = null;
    state.pending_count = 0;
    return { selected_src_lang: state.current_lang, current_src_lang: state.current_lang, switched: false, reason: 'weak_support_current' };
  }

  if (p >= cfg.TH_WEAK) {
    if (lang_pred !== state.current_lang) {
      if (state.pending_lang === lang_pred) {
        state.pending_count += 1;
      } else {
        state.pending_lang = lang_pred;
        state.pending_count = 1;
      }
      if (state.pending_count >= cfg.CONFIRM_SWITCH_N) {
        state.current_lang = lang_pred;
        state.last_switch_ms = now;
        state.pending_lang = null;
        state.pending_count = 0;
        return { selected_src_lang: lang_pred, current_src_lang: lang_pred, switched: true, reason: 'confirm_switch' };
      }
    }
    return { selected_src_lang: state.current_lang, current_src_lang: state.current_lang, switched: false, reason: 'weak_support_current' };
  }

  return { selected_src_lang: state.current_lang, current_src_lang: state.current_lang, switched: false, reason: 'low_conf_keep' };
}
