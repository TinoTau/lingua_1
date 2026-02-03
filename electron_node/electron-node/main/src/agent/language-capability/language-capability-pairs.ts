/**
 * 语言对结构（调度端池分配用 asr×semantic，节点端已改为上报交集，本类型仅保留供历史测试引用）
 */
export interface LanguagePair {
  src: string;
  tgt: string;
  semantic_on_src: boolean;
  semantic_on_tgt: boolean;
}
