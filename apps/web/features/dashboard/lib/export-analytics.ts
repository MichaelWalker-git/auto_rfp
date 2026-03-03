import type { GetAnalyticsResponse } from '@auto-rfp/core';
import { LOSS_REASON_LABELS } from '@auto-rfp/core';

const formatCurrency = (value: number) => `$${value.toLocaleString()}`;

// ─── CSV Export ───

export const exportToCsv = (data: GetAnalyticsResponse, orgName: string) => {
  const { analytics, summary } = data;

  const rows: string[][] = [
    ['AutoRFP Analytics Export'],
    [`Organization: ${orgName}`],
    [`Period: ${summary.periodStart} to ${summary.periodEnd}`],
    [`Generated: ${new Date().toLocaleDateString()}`],
    [],
    // Summary section
    ['SUMMARY'],
    ['Metric', 'Value'],
    ['Total Projects', String(summary.totalProjects)],
    ['Total Submitted', String(summary.totalSubmitted)],
    ['Total Won', String(summary.totalWon)],
    ['Total Lost', String(summary.totalLost)],
    ['Total No Bid', String(summary.totalNoBid)],
    ['Win Rate (%)', summary.winRate.toFixed(2)],
    ['Submission Rate (%)', summary.submissionRate.toFixed(2)],
    ['Total Pipeline Value', formatCurrency(summary.totalPipelineValue)],
    ['Total Won Value', formatCurrency(summary.totalWonValue)],
    ['Total Lost Value', formatCurrency(summary.totalLostValue)],
    ['Average Contract Value', formatCurrency(summary.averageContractValue)],
    ['Avg Time to Submit (days)', summary.averageTimeToSubmit.toFixed(1)],
    ['Avg Time to Decision (days)', summary.averageTimeToDecision.toFixed(1)],
    [],
    // Monthly breakdown
    ['MONTHLY BREAKDOWN'],
    [
      'Month',
      'Total Projects',
      'Submitted',
      'Won',
      'Lost',
      'No Bid',
      'Pending',
      'Win Rate (%)',
      'Submission Rate (%)',
      'Pipeline Value',
      'Won Value',
      'Lost Value',
      'Avg Contract Value',
      'Avg Time to Submit (days)',
      'Avg Time to Decision (days)',
    ],
    ...analytics.map((m) => [
      m.month,
      String(m.totalProjects),
      String(m.projectsSubmitted),
      String(m.projectsWon),
      String(m.projectsLost),
      String(m.projectsNoBid),
      String(m.projectsPending),
      m.winRate.toFixed(2),
      m.submissionRate.toFixed(2),
      formatCurrency(m.totalPipelineValue),
      formatCurrency(m.totalWonValue),
      formatCurrency(m.totalLostValue),
      formatCurrency(m.averageContractValue),
      m.averageTimeToSubmit.toFixed(1),
      m.averageTimeToDecision.toFixed(1),
    ]),
    [],
    // Loss reasons
    ['LOSS REASON BREAKDOWN'],
    ['Reason', 'Count'],
    ...Object.entries(summary.lossReasonCounts)
      .filter(([, count]) => count > 0)
      .sort(([, a], [, b]) => b - a)
      .map(([reason, count]) => [
        LOSS_REASON_LABELS[reason as keyof typeof LOSS_REASON_LABELS] ?? reason,
        String(count),
      ]),
  ];

  const csvContent = rows
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
    .join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `analytics-${orgName.replace(/\s+/g, '-').toLowerCase()}-${summary.periodStart}-${summary.periodEnd}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

// ─── PDF Export (using jsPDF) ───

export const exportToPdf = async (data: GetAnalyticsResponse, orgName: string) => {
  // Dynamic import to avoid SSR issues
  const { jsPDF } = await import('jspdf');
  const { summary, analytics } = data;

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 15;
  let y = margin;

  const addText = (text: string, x: number, fontSize = 10, style: 'normal' | 'bold' = 'normal') => {
    doc.setFontSize(fontSize);
    doc.setFont('helvetica', style);
    doc.text(text, x, y);
  };

  const addLine = () => {
    y += 2;
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pageWidth - margin, y);
    y += 4;
  };

  const newLine = (height = 6) => { y += height; };

  const checkPageBreak = (needed = 20) => {
    if (y + needed > doc.internal.pageSize.getHeight() - margin) {
      doc.addPage();
      y = margin;
    }
  };

  // Title
  addText('AutoRFP Analytics Report', margin, 18, 'bold');
  newLine(8);
  addText(`Organization: ${orgName}`, margin, 11);
  newLine(5);
  addText(`Period: ${summary.periodStart} → ${summary.periodEnd} (${summary.monthCount} months)`, margin, 10);
  newLine(4);
  addText(`Generated: ${new Date().toLocaleDateString('en-US', { dateStyle: 'long' })}`, margin, 9);
  newLine(4);
  addLine();

  // Summary KPIs
  addText('Executive Summary', margin, 13, 'bold');
  newLine(6);

  const kpis = [
    ['Win Rate', `${summary.winRate.toFixed(1)}%`],
    ['Total Pipeline Value', formatCurrency(summary.totalPipelineValue)],
    ['Won Contract Value', formatCurrency(summary.totalWonValue)],
    ['Submission Rate', `${summary.submissionRate.toFixed(1)}%`],
    ['Total Projects', String(summary.totalProjects)],
    ['Total Submitted', String(summary.totalSubmitted)],
    ['Total Won', String(summary.totalWon)],
    ['Total Lost', String(summary.totalLost)],
    ['Avg Contract Value', formatCurrency(summary.averageContractValue)],
    ['Avg Time to Submit', `${summary.averageTimeToSubmit.toFixed(1)} days`],
    ['Avg Time to Decision', `${summary.averageTimeToDecision.toFixed(1)} days`],
  ];

  const colWidth = (pageWidth - margin * 2) / 2;
  kpis.forEach(([label, value], i) => {
    checkPageBreak(8);
    const col = i % 2;
    const x = margin + col * colWidth;
    if (col === 0 && i > 0) newLine(6);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 100, 100);
    doc.text(label, x, y);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(value, x + colWidth * 0.55, y);
  });
  newLine(8);
  addLine();

  // Monthly table
  checkPageBreak(30);
  addText('Monthly Breakdown', margin, 13, 'bold');
  newLine(6);

  const tableHeaders = ['Month', 'Total', 'Won', 'Lost', 'Win Rate', 'Pipeline'];
  const colWidths = [22, 16, 14, 14, 20, 34];
  let xPos = margin;

  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setFillColor(240, 240, 240);
  doc.rect(margin, y - 4, pageWidth - margin * 2, 7, 'F');
  tableHeaders.forEach((h, i) => {
    doc.text(h, xPos + 1, y);
    xPos += colWidths[i];
  });
  newLine(5);

  analytics.forEach((m) => {
    checkPageBreak(7);
    xPos = margin;
    doc.setFont('helvetica', 'normal');
    const row = [
      m.month,
      String(m.totalProjects),
      String(m.projectsWon),
      String(m.projectsLost),
      `${m.winRate.toFixed(1)}%`,
      formatCurrency(m.totalPipelineValue),
    ];
    row.forEach((cell, i) => {
      doc.text(cell, xPos + 1, y);
      xPos += colWidths[i];
    });
    newLine(5);
  });

  addLine();

  // Loss reasons
  const lossEntries = Object.entries(summary.lossReasonCounts)
    .filter(([, count]) => count > 0)
    .sort(([, a], [, b]) => b - a);

  if (lossEntries.length > 0) {
    checkPageBreak(20);
    addText('Loss Reason Breakdown', margin, 13, 'bold');
    newLine(6);

    lossEntries.forEach(([reason, count]) => {
      checkPageBreak(7);
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      const label = LOSS_REASON_LABELS[reason as keyof typeof LOSS_REASON_LABELS] ?? reason;
      doc.text(label, margin, y);
      doc.setFont('helvetica', 'bold');
      doc.text(String(count), margin + 100, y);
      newLine(5);
    });
  }

  doc.save(`analytics-${orgName.replace(/\s+/g, '-').toLowerCase()}-${summary.periodStart}-${summary.periodEnd}.pdf`);
};
