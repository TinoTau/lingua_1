/**
 * LID 输入/输出与 Router 结果类型
 */

export type LidStrategy = 'model' | 'timeout';

export interface LidResult {
  lang_pred: string;
  p: number;
  lid_ms: number;
  strategy: LidStrategy;
}

export interface RouterResult {
  selected_src_lang: string;
  current_src_lang: string;
  switched: boolean;
  reason: string;
}
