/**
 * LID Router 状态机单元测试（二选一；冻结参数：SHORT_UTT_MS=700, TH_STRONG=0.80, TH_WEAK=0.60, CONFIRM_SWITCH_N=2, SWITCH_MIN_INTERVAL_MS=1500）
 */

import { RoomStateStore } from './router-state';
import { selectSrcLang } from './router';

describe('LID Router', () => {
  let store: RoomStateStore;

  beforeEach(() => {
    store = new RoomStateStore();
  });

  it('strategy !== model 时保持 current_lang', () => {
    const s = store.get('room1');
    s.current_lang = 'zh';
    const r = selectSrcLang(store, 'room1', 1000, 'en', 0.9, 'timeout');
    expect(r.selected_src_lang).toBe('zh');
    expect(r.switched).toBe(false);
    expect(r.reason).toBe('lid_not_model');
  });

  it('短句 (< SHORT_UTT_MS) 保持 current_lang', () => {
    const s = store.get('room1');
    s.current_lang = 'zh';
    const r = selectSrcLang(store, 'room1', 500, 'en', 0.9, 'model');
    expect(r.selected_src_lang).toBe('zh');
    expect(r.reason).toBe('short_utt');
  });

  it('p >= TH_STRONG 且超过防抖时间可切换', () => {
    const s = store.get('room1');
    s.current_lang = 'zh';
    s.last_switch_ms = 0;
    const now = Date.now();
    const r = selectSrcLang(store, 'room1', 1000, 'en', 0.85, 'model');
    expect(r.selected_src_lang).toBe('en');
    expect(r.switched).toBe(true);
    expect(r.reason).toBe('strong_switch');
    expect(store.get('room1').current_lang).toBe('en');
  });

  it('p >= TH_STRONG 但未超过防抖时间不切换', () => {
    const s = store.get('room1');
    s.current_lang = 'zh';
    s.last_switch_ms = Date.now() - 500; // 仅 500ms 前切换过
    const r = selectSrcLang(store, 'room1', 1000, 'en', 0.85, 'model');
    expect(r.selected_src_lang).toBe('zh');
    expect(r.switched).toBe(false);
  });

  it('TH_WEAK <= p < TH_STRONG 需连续 CONFIRM_SWITCH_N 次才切换', () => {
    const s = store.get('room1');
    s.current_lang = 'zh';
    const r1 = selectSrcLang(store, 'room1', 1000, 'en', 0.70, 'model');
    expect(r1.selected_src_lang).toBe('zh');
    expect(r1.switched).toBe(false);
    const r2 = selectSrcLang(store, 'room1', 1000, 'en', 0.70, 'model');
    expect(r2.selected_src_lang).toBe('en');
    expect(r2.switched).toBe(true);
    expect(r2.reason).toBe('confirm_switch');
  });

  it('p < TH_WEAK 保持 current_lang', () => {
    const s = store.get('room1');
    s.current_lang = 'zh';
    const r = selectSrcLang(store, 'room1', 1000, 'en', 0.50, 'model');
    expect(r.selected_src_lang).toBe('zh');
    expect(r.reason).toBe('low_conf_keep');
  });

  it('同一 room_id 共享状态，不同 room 独立', () => {
    selectSrcLang(store, 'room1', 1000, 'en', 0.85, 'model');
    expect(store.get('room1').current_lang).toBe('en');
    // 紧接着再切 zh：未超过 SWITCH_MIN_INTERVAL_MS，故不切换，仍返回 en
    const r = selectSrcLang(store, 'room1', 1000, 'zh', 0.85, 'model');
    expect(r.selected_src_lang).toBe('en');
    expect(store.get('room1').current_lang).toBe('en');
    expect(store.get('room2').current_lang).toBe('zh'); // 未使用过，默认 zh
  });
});
