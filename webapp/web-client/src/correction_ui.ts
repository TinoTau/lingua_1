/**
 * Per-utterance Manual Correction UI (system_text immutable).
 */

import { logger } from './logger';
import {
  UtteranceCorrectionModel,
  beginEdit,
  cancelEdit,
  createCorrectionModel,
  ensureClientCorrectionId,
  gatewayHttpBaseFromWsUrl,
  apiKeyFromWsUrl,
  setDraft,
  submitCorrection,
  validateCorrectionSubmit,
} from './correction';

export class CorrectionPanel {
  private models = new Map<number, UtteranceCorrectionModel>();
  private sessionId: string | null = null;
  private schedulerWsUrl: string;

  constructor(schedulerWsUrl: string) {
    this.schedulerWsUrl = schedulerWsUrl;
  }

  setSessionId(sessionId: string | null): void {
    this.sessionId = sessionId;
  }

  setSchedulerWsUrl(url: string): void {
    this.schedulerWsUrl = url;
  }

  clear(): void {
    this.models.clear();
    const panel = document.getElementById('correction-panel');
    if (panel) panel.innerHTML = '';
  }

  /**
   * Register immutable system text for an utterance and render card.
   */
  registerUtterance(utteranceIndex: number, systemText: string, sessionId?: string): void {
    const sid = sessionId || this.sessionId;
    if (!sid || !systemText?.trim()) return;
    if (!this.models.has(utteranceIndex)) {
      this.models.set(utteranceIndex, createCorrectionModel(sid, utteranceIndex, systemText.trim()));
    } else {
      // Keep existing systemText immutable; refresh session id if needed
      const m = this.models.get(utteranceIndex)!;
      if (!m.sessionId) m.sessionId = sid;
    }
    this.render();
  }

  private ensurePanel(): HTMLElement {
    let panel = document.getElementById('correction-panel');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'correction-panel';
      panel.style.cssText =
        'margin: 12px 0; padding: 12px; background: #fff8f0; border: 1px solid #f0d0a0; border-radius: 8px;';
      const container = document.getElementById('translation-result-container');
      if (container?.parentElement) {
        container.parentElement.insertBefore(panel, container.nextSibling);
      } else {
        document.getElementById('app')?.appendChild(panel);
      }
    }
    return panel;
  }

  render(): void {
    const panel = this.ensurePanel();
    panel.innerHTML = `<div style="font-weight:bold;margin-bottom:8px;color:#a65c00;">手动纠错（系统原文不可覆盖）</div>`;
    const indices = [...this.models.keys()].sort((a, b) => a - b);
    for (const idx of indices) {
      const model = this.models.get(idx)!;
      panel.appendChild(this.renderCard(model));
    }
  }

  private renderCard(model: UtteranceCorrectionModel): HTMLElement {
    const card = document.createElement('div');
    card.dataset.utteranceIndex = String(model.utteranceIndex);
    card.style.cssText =
      'margin:8px 0;padding:10px;background:#fff;border:1px solid #e8c48a;border-radius:6px;font-size:13px;';

    const statusLabel =
      model.correctionState === 'submitted'
        ? `已提交${model.lastCorrectionId ? ` (#${model.lastCorrectionId.slice(0, 8)})` : ''}`
        : model.correctionState === 'error'
          ? `失败: ${model.lastError || ''}`
          : model.correctionState === 'submitting'
            ? '提交中…'
            : model.correctionState === 'editing'
              ? '编辑中'
              : '待纠错';

    card.innerHTML = `
      <div style="margin-bottom:6px;color:#666;">utterance [${model.utteranceIndex}] · ${statusLabel}</div>
      <div style="margin-bottom:4px;"><strong>系统原文 (immutable)</strong></div>
      <div class="corr-system" style="padding:8px;background:#f7f7f7;border-radius:4px;white-space:pre-wrap;"></div>
      <div class="corr-edit-area" style="margin-top:8px;"></div>
      <div class="corr-actions" style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;"></div>
      ${
        model.submittedCorrectedText
          ? `<div style="margin-top:6px;color:#0a7a0a;">已确认纠正：<span class="corr-submitted"></span></div>`
          : ''
      }
    `;
    (card.querySelector('.corr-system') as HTMLElement).textContent = model.systemText;
    const submittedEl = card.querySelector('.corr-submitted') as HTMLElement | null;
    if (submittedEl && model.submittedCorrectedText) {
      submittedEl.textContent = model.submittedCorrectedText;
    }

    const editArea = card.querySelector('.corr-edit-area') as HTMLElement;
    const actions = card.querySelector('.corr-actions') as HTMLElement;

    if (model.correctionState === 'editing' || model.correctionState === 'error' || model.correctionState === 'submitting') {
      const ta = document.createElement('textarea');
      ta.value = model.correctedTextDraft;
      ta.rows = 3;
      ta.style.cssText = 'width:100%;box-sizing:border-box;padding:8px;border:1px solid #ccc;border-radius:4px;';
      ta.disabled = model.correctionState === 'submitting';
      ta.addEventListener('input', () => {
        this.models.set(model.utteranceIndex, setDraft(model, ta.value));
      });
      editArea.appendChild(ta);

      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = '确认纠错';
      confirmBtn.disabled = model.correctionState === 'submitting';
      confirmBtn.onclick = () => void this.onConfirm(model.utteranceIndex);
      const cancelBtn = document.createElement('button');
      cancelBtn.textContent = '取消';
      cancelBtn.disabled = model.correctionState === 'submitting';
      cancelBtn.onclick = () => {
        this.models.set(model.utteranceIndex, cancelEdit(this.models.get(model.utteranceIndex)!));
        this.render();
      };
      actions.appendChild(confirmBtn);
      actions.appendChild(cancelBtn);
    } else {
      const editBtn = document.createElement('button');
      editBtn.textContent = model.correctionState === 'submitted' ? '再次纠错' : '编辑纠错';
      editBtn.onclick = () => {
        this.models.set(model.utteranceIndex, beginEdit(this.models.get(model.utteranceIndex)!));
        this.render();
      };
      actions.appendChild(editBtn);
    }

    return card;
  }

  private async onConfirm(utteranceIndex: number): Promise<void> {
    let model = this.models.get(utteranceIndex);
    if (!model) return;

    const validationError = validateCorrectionSubmit(model);
    if (validationError) {
      model = { ...model, correctionState: 'error', lastError: validationError };
      this.models.set(utteranceIndex, model);
      this.render();
      return;
    }

    model = ensureClientCorrectionId(model);
    model = { ...model, correctionState: 'submitting', lastError: null };
    this.models.set(utteranceIndex, model);
    this.render();

    const apiKey = apiKeyFromWsUrl(this.schedulerWsUrl);
    if (!apiKey) {
      model = {
        ...model,
        correctionState: 'error',
        lastError: 'Missing API key (set VITE_API_KEY for Gateway auth)',
      };
      this.models.set(utteranceIndex, model);
      this.render();
      return;
    }

    const httpBase = gatewayHttpBaseFromWsUrl(this.schedulerWsUrl);
    try {
      const result = await submitCorrection(httpBase, apiKey, {
        session_id: model.sessionId,
        utterance_index: model.utteranceIndex,
        system_text: model.systemText,
        corrected_text: model.correctedTextDraft.trim(),
        client_correction_id: model.clientCorrectionId!,
      });
      model = {
        ...model,
        correctionState: 'submitted',
        lastCorrectionId: result.correction_id,
        submittedCorrectedText: model.correctedTextDraft.trim(),
        lastError: null,
        // Next re-edit gets a new id
        clientCorrectionId: null,
      };
      this.models.set(utteranceIndex, model);
      logger.info('CorrectionPanel', 'correction accepted', {
        utterance_index: utteranceIndex,
        correction_id: result.correction_id,
        duplicate: result.duplicate,
      });
    } catch (e: any) {
      // Keep draft + same clientCorrectionId for retry
      model = {
        ...model,
        correctionState: 'error',
        lastError: String(e?.message || e),
      };
      this.models.set(utteranceIndex, model);
      logger.error('CorrectionPanel', 'correction failed', { error: String(e) });
    }
    this.render();
  }
}
