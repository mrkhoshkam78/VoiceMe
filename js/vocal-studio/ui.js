/**
 * AI Vocal Production Studio — UI helpers (report HTML, stage labels)
 */

export const STYLES = [
  { id: 'pop', label: 'پاپ' },
  { id: 'ballad', label: 'بالاد' },
  { id: 'traditional', label: 'سنتی' },
  { id: 'rock', label: 'راک' },
  { id: 'rap', label: 'رپ' },
  { id: 'metal', label: 'متال' },
  { id: 'natural', label: 'طبیعی' }
];

export function stageLabel(stage) {
  if (stage === 1) return 'تحلیل و تشخیص';
  if (stage === 2) return 'پردازش هوشمند';
  if (stage === 3) return 'کنترل کیفیت';
  return '—';
}

export function severityClass(s) {
  if (s >= 0.7) return 'sev-high';
  if (s >= 0.4) return 'sev-mid';
  return 'sev-low';
}

export function formatReportHTML(report) {
  if (!report?.diagnosis) {
    return '<p class="vs-muted">هنوز تحلیلی انجام نشده است.</p>';
  }
  const d = report.diagnosis;
  const qa = report.qa;
  const proc = report.processResult;

  let html = '';

  // Summary cards
  html += `<div class="vs-cards">
    <div class="vs-card"><span class="vs-card-label">اطمینان تحلیل</span><span class="vs-card-val">${Math.round((d.analysisConfidence || 0) * 100)}٪</span></div>
    <div class="vs-card"><span class="vs-card-label">مشکلات</span><span class="vs-card-val">${(d.issues || []).length}</span></div>
    <div class="vs-card"><span class="vs-card-label">Peak</span><span class="vs-card-val">${d.loudness?.peakDb ?? '—'} dB</span></div>
    <div class="vs-card"><span class="vs-card-label">RMS</span><span class="vs-card-val">${d.loudness?.rmsDb ?? '—'} dB</span></div>
  </div>`;

  // Issues
  html += `<h4 class="vs-h">مشکلات تشخیص‌داده‌شده</h4>`;
  if (!d.issues?.length) {
    html += `<p class="vs-ok">مشکل جدی شناسایی نشد.</p>`;
  } else {
    html += `<ul class="vs-issues">`;
    for (const iss of d.issues) {
      html += `<li class="${severityClass(iss.severity)}">
        <strong>${esc(iss.name)}</strong>
        <span class="vs-sev">${Math.round(iss.severity * 100)}٪</span>
        <span class="vs-detail">${esc(iss.detail || '')}</span>
      </li>`;
    }
    html += `</ul>`;
  }

  // Pitch range — non-definitive
  if (d.pitch?.estimatedRange) {
    html += `<div class="vs-note">
      <strong>محدوده صوتی (تخمینی):</strong> ${esc(d.pitch.estimatedRange.label)}
      — ${esc(d.pitch.estimatedRange.note)}
      <em>(اطمینان ${(d.pitch.estimatedRange.confidence * 100).toFixed(0)}٪ — حدس قطعی جنسیت نیست)</em>
    </div>`;
  }

  // Process log
  if (proc?.log?.length) {
    html += `<h4 class="vs-h">مراحل پردازش</h4><ul class="vs-log">`;
    for (const step of proc.log) {
      const ok = step.success ? '✓' : '✗';
      html += `<li class="${step.success ? 'ok' : 'fail'}">
        <span class="vs-step-id">${ok} ${esc(step.id)}</span>
        <span class="vs-detail">${esc(step.reason || '')}</span>
        <span class="vs-delta">RMS ${step.deltaRmsDb > 0 ? '+' : ''}${step.deltaRmsDb} dB</span>
      </li>`;
    }
    html += `</ul>`;
  }

  // QA comparison
  if (qa?.comparison) {
    const c = qa.comparison;
    html += `<h4 class="vs-h">مقایسه قبل / بعد</h4>
    <table class="vs-table">
      <tr><th>معیار</th><th>قبل</th><th>بعد</th><th>Δ</th></tr>
      <tr><td>Peak dB</td><td>${c.peakDb?.before ?? '—'}</td><td>${c.peakDb?.after ?? '—'}</td><td>${c.peakDb?.delta ?? '—'}</td></tr>
      <tr><td>RMS dB</td><td>${c.rmsDb?.before ?? '—'}</td><td>${c.rmsDb?.after ?? '—'}</td><td>${c.rmsDb?.delta ?? '—'}</td></tr>
      <tr><td>مسائل</td><td>${c.issuesBefore}</td><td>${c.issuesAfter}</td><td>${(c.issuesAfter - c.issuesBefore)}</td></tr>
    </table>`;
    html += `<div class="vs-card inline"><span class="vs-card-label">امتیاز QA</span><span class="vs-card-val">${Math.round((qa.qaScore || 0) * 100)}٪</span></div>`;
  }

  if (qa?.artifacts?.length) {
    html += `<h4 class="vs-h">Artifactهای احتمالی</h4><ul class="vs-issues">`;
    for (const a of qa.artifacts) {
      html += `<li class="${severityClass(a.severity)}"><strong>${esc(a.id)}</strong> — ${esc(a.detail)} <em>${esc(a.suggestion || '')}</em></li>`;
    }
    html += `</ul>`;
  }

  if (qa?.warnings?.length) {
    html += `<div class="vs-warnings">`;
    for (const w of qa.warnings) html += `<p>⚠ ${esc(w)}</p>`;
    html += `</div>`;
  }

  html += `<p class="vs-disclaimer">این پردازش وکال است، نه مسترینگ کامل آهنگ.</p>`;
  return html;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
