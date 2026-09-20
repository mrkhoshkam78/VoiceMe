/**
 * AI Vocal Production Studio — Orchestrator
 * Stage 1 Analyze → Stage 2 Process → Stage 3 QA
 * Non-destructive: original buffer never mutated.
 */
import { analyzeVocal } from './VocalAnalyzer.js';
import { processVocal, planProcessing } from './VocalProcessor.js';
import { qualityAssure } from './VocalQA.js';

export class VocalStudioEngine {
  constructor() {
    this.originalBuffer = null;
    this.processedBuffer = null;
    this.diagnosis = null;
    this.processResult = null;
    this.qaResult = null;
    this.aborted = false;
    this.options = {
      style: 'pop',
      intensity: 0.7,
      naturalness: 0.6,
      key: 'C',
      scale: 'major'
    };
  }

  setOptions(opts = {}) {
    Object.assign(this.options, opts);
  }

  abort() {
    this.aborted = true;
  }

  reset() {
    this.aborted = false;
    this.processedBuffer = null;
    this.diagnosis = null;
    this.processResult = null;
    this.qaResult = null;
  }

  /**
   * Full pipeline
   * @param {AudioBuffer} buffer
   * @param {object} meta
   * @param {function} onProgress - (stage, progress 0..1, label)
   */
  async runFull(buffer, meta = {}, onProgress) {
    this.aborted = false;
    this.originalBuffer = buffer;
    this.processedBuffer = null;
    this.diagnosis = null;
    this.processResult = null;
    this.qaResult = null;

    const report = (stage, p, label) => {
      if (onProgress) onProgress(stage, p, label);
    };

    // Stage 1
    report(1, 0, 'شروع تحلیل وکال...');
    this.diagnosis = await analyzeVocal(buffer, meta, (p, label) => {
      if (this.aborted) throw new Error('ABORTED');
      report(1, p, label);
    });
    if (this.aborted) throw new Error('ABORTED');

    // Stage 2
    report(2, 0, 'شروع پردازش هوشمند...');
    this.processResult = await processVocal(buffer, this.diagnosis, this.options, (p, label) => {
      if (this.aborted) throw new Error('ABORTED');
      report(2, p, label);
    });
    this.processedBuffer = this.processResult.buffer;
    if (this.aborted) throw new Error('ABORTED');

    // Stage 3
    report(3, 0, 'کنترل کیفیت...');
    this.qaResult = await qualityAssure(
      buffer,
      this.processedBuffer,
      this.diagnosis,
      this.processResult,
      (p, label) => {
        if (this.aborted) throw new Error('ABORTED');
        report(3, p, label);
      }
    );
    if (this.qaResult.finalBuffer) {
      this.processedBuffer = this.qaResult.finalBuffer;
    }

    report(3, 1, 'آماده');
    return this.getReport();
  }

  /** Stage 1 only */
  async runAnalyze(buffer, meta = {}, onProgress) {
    this.originalBuffer = buffer;
    this.diagnosis = await analyzeVocal(buffer, meta, (p, label) => {
      if (onProgress) onProgress(1, p, label);
    });
    return this.diagnosis;
  }

  /** Preview plan without processing */
  getPlan() {
    if (!this.diagnosis) return null;
    return planProcessing(this.diagnosis, this.options);
  }

  getReport() {
    return {
      diagnosis: this.diagnosis,
      processResult: this.processResult
        ? { plan: this.processResult.plan, log: this.processResult.log, disclaimer: this.processResult.disclaimer }
        : null,
      qa: this.qaResult
        ? {
            comparison: this.qaResult.comparison,
            artifacts: this.qaResult.artifacts,
            warnings: this.qaResult.warnings,
            qaScore: this.qaResult.qaScore,
            fixApplied: this.qaResult.fixApplied,
            disclaimer: this.qaResult.disclaimer
          }
        : null,
      hasProcessed: !!this.processedBuffer
    };
  }

  getProcessedBuffer() {
    return this.processedBuffer;
  }

  getOriginalBuffer() {
    return this.originalBuffer;
  }
}
