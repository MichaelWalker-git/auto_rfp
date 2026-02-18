import {
  getExecutiveBriefByProjectId,
  queryCompanyKnowledgeBase,
  truncateText,
} from './executive-opportunity-brief';
import { loadTextFromS3 } from './s3';
import { searchPastProjects, listPastProjects } from './past-performance';
import { getEmbedding, semanticSearchContentLibrary } from './embeddings';
import { requireEnv } from './env';

const DOCUMENTS_BUCKET = requireEnv('DOCUMENTS_BUCKET');

const LIMITS = {
  kbChars: 15_000,
  execBriefChars: 12_000,
  pastPerfChars: 10_000,
  contentLibChars: 10_000,
  kbTopK: 20,
  pastPerfTopK: 5,
  contentLibTopK: 15,
} as const;

// ─── Helpers ───

function pushIf(parts: string[], value: unknown, prefix?: string) {
  if (value) parts.push(prefix ? `${prefix}: ${value}` : String(value));
}

function formatSectionData(
  sections: Record<string, any>,
  key: string,
  formatter: (data: any, parts: string[]) => void,
): string[] {
  const wrap = sections[key];
  if (wrap?.status !== 'COMPLETE' || !wrap?.data) return [];
  const parts: string[] = [];
  formatter(wrap.data, parts);
  return parts;
}

async function loadPineconeChunks(
  matches: Array<{ score?: number; source?: any }>,
  topK: number,
): Promise<string[]> {
  return Promise.all(
    matches.slice(0, topK).map(async (m, i) => {
      const header = `#${i + 1} score=${m.score}${m.source?.documentId ? ` doc=${m.source.documentId}` : ''}`;
      const text = m.source?.chunkKey ? await loadTextFromS3(DOCUMENTS_BUCKET, m.source.chunkKey) : '';
      return [header, text].filter(Boolean).join('\n');
    }),
  );
}

// ─── Context Loaders ───

export async function loadExecutiveBriefContext(projectId: string, opportunityId?: string): Promise<string> {
  try {
    const brief = await getExecutiveBriefByProjectId(projectId, opportunityId);
    const sections = brief?.sections as Record<string, any> | undefined;
    if (!sections) return '';

    const parts: string[] = [];

    parts.push(...formatSectionData(sections, 'summary', (s, p) => {
      p.push('=== EXECUTIVE BRIEF: SUMMARY ===');
      for (const [k, label] of [
        ['title', 'Title'], ['agency', 'Agency'], ['office', 'Office'],
        ['solicitationNumber', 'Solicitation #'], ['naics', 'NAICS'],
        ['contractType', 'Contract Type'], ['setAside', 'Set-Aside'],
        ['placeOfPerformance', 'Place of Performance'],
        ['periodOfPerformance', 'Period of Performance'], ['summary', 'Summary'],
      ] as const) {
        pushIf(p, s[k], label);
      }
      if (s.estimatedValueUsd) p.push(`Estimated Value: $${s.estimatedValueUsd}`);
    }));

    parts.push(...formatSectionData(sections, 'requirements', (r, p) => {
      p.push('\n=== EXECUTIVE BRIEF: REQUIREMENTS ===');
      pushIf(p, r.overview, 'Overview');
      r.requirements?.slice(0, 15).forEach((req: any, i: number) => {
        p.push(`  ${i + 1}. [${req.mustHave ? 'MUST-HAVE' : 'NICE-TO-HAVE'}] ${req.requirement}`);
      });
      if (r.deliverables?.length) p.push('Deliverables: ' + r.deliverables.slice(0, 10).join(', '));
      if (r.evaluationFactors?.length) p.push('Evaluation Factors: ' + r.evaluationFactors.slice(0, 10).join(', '));
    }));

    parts.push(...formatSectionData(sections, 'risks', (rk, p) => {
      p.push('\n=== EXECUTIVE BRIEF: RISKS ===');
      const fmtFlags = (label: string, flags: any[]) => {
        if (!flags?.length) return;
        p.push(`${label}:`);
        flags.slice(0, 5).forEach((f: any) => {
          p.push(`  - [${f.severity}] ${f.flag}${f.mitigation ? ` | Mitigation: ${f.mitigation}` : ''}`);
        });
      };
      fmtFlags('Red Flags', rk.redFlags);
      fmtFlags('Risks', rk.risks);
      if (rk.incumbentInfo) {
        const inc = rk.incumbentInfo;
        p.push(`Incumbent: ${inc.knownIncumbent ? `Yes - ${inc.incumbentName || 'Unknown'}` : 'No'}`);
      }
    }));

    parts.push(...formatSectionData(sections, 'contacts', (c, p) => {
      p.push('\n=== EXECUTIVE BRIEF: CONTACTS ===');
      c.contacts?.slice(0, 8).forEach((ct: any) => {
        p.push(`  - ${[ct.role, ct.name, ct.title, ct.organization].filter(Boolean).join(' • ')}`);
      });
    }));

    parts.push(...formatSectionData(sections, 'deadlines', (d, p) => {
      p.push('\n=== EXECUTIVE BRIEF: DEADLINES ===');
      pushIf(p, d.submissionDeadlineIso, 'Submission Deadline');
      d.deadlines?.slice(0, 8).forEach((dl: any) => {
        p.push(`  - ${dl.type}: ${dl.label} — ${dl.dateTimeIso || dl.rawText || 'TBD'}`);
      });
    }));

    parts.push(...formatSectionData(sections, 'scoring', (sc, p) => {
      p.push('\n=== EXECUTIVE BRIEF: SCORING & DECISION ===');
      for (const [k, label] of [
        ['decision', 'Decision'], ['recommendation', 'Recommendation'],
        ['summaryJustification', 'Justification'],
      ] as const) {
        pushIf(p, sc[k], label);
      }
      if (sc.compositeScore) p.push(`Composite Score: ${sc.compositeScore}/5`);
      if (sc.confidence) p.push(`Confidence: ${sc.confidence}%`);
      sc.criteria?.forEach((cr: any) => p.push(`  - ${cr.name}: ${cr.score}/5 — ${cr.rationale}`));
    }));

    parts.push(...formatSectionData(sections, 'pastPerformance', (pp, p) => {
      p.push('\n=== EXECUTIVE BRIEF: PAST PERFORMANCE ANALYSIS ===');
      pp.matches?.slice(0, 5).forEach((m: any) => {
        const proj = m.project || m;
        p.push(`  - ${proj.title || 'Project'} (Relevance: ${m.relevanceScore || 'N/A'}%)`);
        pushIf(p, proj.client, '    Client');
        if (proj.description) p.push(`    Description: ${truncateText(proj.description, 200)}`);
      });
      if (pp.gapAnalysis?.overallCoverage !== undefined) p.push(`Overall Coverage: ${pp.gapAnalysis.overallCoverage}%`);
      if (pp.gapAnalysis?.criticalGaps?.length) p.push(`Critical Gaps: ${pp.gapAnalysis.criticalGaps.join(', ')}`);
    }));

    return truncateText(parts.join('\n'), LIMITS.execBriefChars);
  } catch (err) {
    console.log('No executive brief found:', (err as Error)?.message);
    return '';
  }
}

export async function loadKnowledgeBaseContext(orgId: string, solicitation: string): Promise<string> {
  try {
    if (!solicitation?.trim()) return '';
    const matches = await queryCompanyKnowledgeBase(orgId, solicitation, LIMITS.kbTopK);
    if (!matches?.length) return '';
    const parts = await loadPineconeChunks(matches, LIMITS.kbTopK);
    return truncateText(parts.join('\n\n'), LIMITS.kbChars);
  } catch (err) {
    console.warn('Failed to load KB context:', (err as Error)?.message);
    return '';
  }
}

export async function loadPastPerformanceContext(orgId: string, solicitation: string): Promise<string> {
  try {
    if (!solicitation?.trim()) return '';

    const results = await searchPastProjects(orgId, solicitation, LIMITS.pastPerfTopK);

    const projects = results?.length
      ? results.map((r, i) => {
          const lines = [`#${i + 1} ${r.metadata?.title || 'Project'} (score=${r.score?.toFixed(2)})`];
          pushIf(lines, r.metadata?.client, '  Client');
          pushIf(lines, r.metadata?.domain, '  Domain');
          if (r.metadata?.technologies?.length) lines.push(`  Technologies: ${r.metadata.technologies.join(', ')}`);
          return lines.join('\n');
        })
      : await (async () => {
          const { items } = await listPastProjects(orgId, false, LIMITS.pastPerfTopK);
          return items.map((p, i) => {
            const lines = [`#${i + 1} ${p.title}`];
            pushIf(lines, p.client, '  Client');
            if (p.description) lines.push(`  Description: ${truncateText(p.description, 300)}`);
            if (p.technologies?.length) lines.push(`  Technologies: ${p.technologies.join(', ')}`);
            if (p.achievements?.length) lines.push(`  Achievements: ${p.achievements.slice(0, 3).join('; ')}`);
            if (p.value) lines.push(`  Value: $${p.value}`);
            if (p.performanceRating) lines.push(`  Rating: ${p.performanceRating}/5`);
            return lines.join('\n');
          });
        })();

    if (!projects.length) return '';
    return truncateText(projects.join('\n\n'), LIMITS.pastPerfChars);
  } catch (err) {
    console.warn('Failed to load past performance context:', (err as Error)?.message);
    return '';
  }
}

export async function loadContentLibraryContext(orgId: string, solicitation: string): Promise<string> {
  try {
    if (!solicitation?.trim()) return '';
    const embedding = await getEmbedding(solicitation.slice(0, 30_000));
    const hits = await semanticSearchContentLibrary(orgId, embedding, LIMITS.contentLibTopK);
    if (!hits?.length) return '';
    const parts = await loadPineconeChunks(hits, LIMITS.contentLibTopK);
    return truncateText(parts.join('\n\n'), LIMITS.contentLibChars);
  } catch (err) {
    console.warn('Failed to load content library context:', (err as Error)?.message);
    return '';
  }
}

/** Gather all context sources in parallel. Returns a combined enriched KB string. */
export async function gatherAllContext(args: {
  projectId: string;
  orgId: string;
  opportunityId?: string;
  solicitation: string;
}): Promise<string> {
  const { projectId, orgId, opportunityId, solicitation } = args;

  console.log(`Gathering context: projectId=${projectId}, orgId=${orgId}, opportunityId=${opportunityId || 'none'}`);

  const [execBrief, kb, pastPerf, contentLib] = await Promise.all([
    loadExecutiveBriefContext(projectId, opportunityId),
    loadKnowledgeBaseContext(orgId, solicitation),
    loadPastPerformanceContext(orgId, solicitation),
    loadContentLibraryContext(orgId, solicitation),
  ]);

  console.log(`Context: execBrief=${execBrief.length}, kb=${kb.length}, pastPerf=${pastPerf.length}, contentLib=${contentLib.length} chars`);

  const sections: [string, string, string][] = [
    ['EXECUTIVE OPPORTUNITY BRIEF ANALYSIS', 'Pre-analyzed summary of the opportunity. Use this data to inform your proposal content.', execBrief],
    ['COMPANY KNOWLEDGE BASE', 'Relevant excerpts from the company knowledge base. Use them to demonstrate company capabilities.', kb],
    ['PAST PERFORMANCE PROJECTS', 'Relevant past projects. Reference them to demonstrate track record and relevant experience.', pastPerf],
    ['CONTENT LIBRARY', 'Pre-approved content snippets. Use them where relevant for consistent messaging.', contentLib],
  ];

  return sections
    .filter(([, , text]) => text)
    .map(([title, desc, text]) => `--- ${title} ---\n(${desc})\n${text}`)
    .join('\n\n');
}
