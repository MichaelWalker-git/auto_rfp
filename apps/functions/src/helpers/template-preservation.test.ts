/**
 * Tests for template preservation functionality in RFP document generation.
 * 
 * These tests verify that images, styles, and template structure are properly
 * preserved during the document generation process.
 */

// Mock dependencies BEFORE imports
jest.mock('@middy/core', () => {
  const middy = (handler: unknown) => ({
    use: jest.fn().mockReturnThis(),
    handler,
  });
  return { __esModule: true, default: middy };
});
jest.mock('@/sentry-lambda', () => ({
  withSentryLambda: jest.fn((handler: unknown) => handler),
}));
jest.mock('@/middleware/rbac-middleware', () => ({
  authContextMiddleware: jest.fn(() => ({ before: jest.fn() })),
  httpErrorMiddleware: jest.fn(() => ({ onError: jest.fn() })),
  orgMembershipMiddleware: jest.fn(() => ({ before: jest.fn() })),
  requirePermission: jest.fn(() => ({ before: jest.fn() })),
}));
jest.mock('@/middleware/audit-middleware', () => ({
  auditMiddleware: jest.fn(() => ({ after: jest.fn() })),
  setAuditContext: jest.fn(),
}));
jest.mock('@/helpers/json', () => ({
  safeParseJsonFromModel: jest.fn(),
}));
jest.mock('@/helpers/document-context', () => ({
  gatherAllContext: jest.fn(),
}));
jest.mock('@/helpers/document-prompts', () => ({
  buildSystemPromptForDocumentType: jest.fn(),
  buildSectionSystemPrompt: jest.fn(),
  buildUserPromptForDocumentType: jest.fn(),
}));
jest.mock('@/helpers/document-generation', () => ({
  extractBedrockText: jest.fn(),
  loadQaPairs: jest.fn(),
  loadSolicitation: jest.fn(),
  resolveTemplateHtml: jest.fn(),
  buildMacroValues: jest.fn(),
  prepareTemplateScaffoldForAI: jest.requireActual('@/helpers/document-generation').prepareTemplateScaffoldForAI,
}));
jest.mock('@/helpers/template', () => ({
  getTemplate: jest.fn(),
  findBestTemplate: jest.fn(),
  loadTemplateHtml: jest.fn(),
  replaceMacros: jest.fn((text: string, macros: Record<string, string>) => {
    let result = text;
    Object.entries(macros).forEach(([key, value]) => {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
    });
    return result;
  }),
}));
jest.mock('@/helpers/rfp-document', () => ({
  uploadRFPDocumentHtml: jest.fn(),
  updateRFPDocumentMetadata: jest.fn(),
  getRFPDocument: jest.fn(),
}));
jest.mock('@/helpers/rfp-document-version', () => ({
  createVersion: jest.fn(),
  getLatestVersionNumber: jest.fn(),
  saveVersionHtml: jest.fn(),
}));
jest.mock('@/helpers/document-tools', () => ({
  DOCUMENT_TOOLS: [],
  executeDocumentTool: jest.fn(),
}));
jest.mock('@/helpers/bedrock-http-client', () => ({
  invokeModel: jest.fn(),
}));
jest.mock('@/helpers/document-section-generator', () => ({
  generateDocumentSectionBySectionHtml: jest.fn(),
  buildDocumentTitleHtml: jest.fn(),
}));

// Mock environment variables to avoid dependency issues
process.env.STAGE = 'test';
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { 
  injectSectionsIntoTemplate, 
  injectContentIntoSimpleTemplate 
} from './template-section-parser';
import { prepareTemplateScaffoldForAI } from './document-generation';
import { cleanGeneratedHtml, stripTemplateImagesFromContent } from './generate-document-worker';

describe('Template Preservation', () => {
  describe('prepareTemplateScaffoldForAI', () => {
    it('should preserve images with s3key attributes', () => {
      const template = `
        <h1>Company Proposal</h1>
        <img src="s3key:org-123/logo.png" alt="Company Logo" />
        <p>{{CONTENT}}</p>
      `;
      
      const result = prepareTemplateScaffoldForAI(template);
      
      expect(result).toContain('<!-- PRESERVE THIS IMAGE TAG EXACTLY AS-IS -->');
      expect(result).toContain('src="s3key:org-123/logo.png"');
    });

    it('should preserve CSS style blocks', () => {
      const template = `
        <style>
          .header { color: #333; font-weight: bold; }
        </style>
        <h1>Document Title</h1>
        <p>{{CONTENT}}</p>
      `;
      
      const result = prepareTemplateScaffoldForAI(template);
      
      expect(result).toContain('<!-- PRESERVE THIS STYLE BLOCK EXACTLY AS-IS -->');
      expect(result).toContain('.header { color: #333; font-weight: bold; }');
    });

    it('should preserve CSS link tags', () => {
      const template = `
        <link rel="stylesheet" type="text/css" href="styles.css" />
        <h1>Document Title</h1>
        <p>{{CONTENT}}</p>
      `;
      
      const result = prepareTemplateScaffoldForAI(template);
      
      expect(result).toContain('<!-- PRESERVE THIS STYLE LINK EXACTLY AS-IS -->');
      expect(result).toContain('rel="stylesheet"');
    });

    it('should preserve elements with styling attributes (inline styles kept as-is)', () => {
      const template = `
        <h1 style="color: blue; font-size: 24px;">Document Title</h1>
        <div class="content-wrapper" id="main">
          <p>{{CONTENT}}</p>
        </div>
      `;
      
      const result = prepareTemplateScaffoldForAI(template);
      
      // Inline styles, classes, and IDs are preserved in the template scaffold
      // (the AI is instructed to copy them exactly via the system prompt)
      expect(result).toContain('style="color: blue; font-size: 24px;"');
      expect(result).toContain('class="content-wrapper"');
      expect(result).toContain('id="main"');
    });

    it('should replace macros with real values', () => {
      const template = `
        <h1>Proposal for {{COMPANY_NAME}}</h1>
        <p>Date: {{TODAY}}</p>
        <p>{{CONTENT}}</p>
      `;
      
      const macroValues = {
        COMPANY_NAME: 'Acme Corp',
        TODAY: '2024-01-15'
      };
      
      const result = prepareTemplateScaffoldForAI(template, macroValues);
      
      expect(result).toContain('Proposal for Acme Corp');
      expect(result).toContain('Date: 2024-01-15');
    });

    it('should convert unresolved macros to readable labels', () => {
      const template = `
        <h1>{{AGENCY_NAME}} Requirements</h1>
        <p>{{SOLICITATION_NUMBER}}</p>
        <p>{{CONTENT}}</p>
      `;
      
      const result = prepareTemplateScaffoldForAI(template);
      
      expect(result).toContain('[Agency Name]');
      expect(result).toContain('[Solicitation Number]');
    });
  });

  describe('injectSectionsIntoTemplate', () => {
    it('should join all fragments in order preserving Introduction + h2 sections', () => {
      const template = `<img src="s3key:logo.png" /><h1>Title</h1><h2>S1</h2><p>c1</p><h2>S2</h2><p>c2</p>`;
      
      // Fragments correspond 1:1 with parseTemplateSections output:
      // [0] = Introduction (before first h2), [1] = Section 1, [2] = Section 2
      const fragments = [
        '<img src="s3key:logo.png" />\n<h1>Title</h1>\n<p>Intro text</p>',
        '<h2>S1</h2><p>Generated S1</p>',
        '<h2>S2</h2><p>Generated S2</p>'
      ];
      
      const result = injectSectionsIntoTemplate(template, fragments);
      
      // All fragments joined in order
      expect(result).toContain('src="s3key:logo.png"');
      expect(result).toContain('<h1>Title</h1>');
      expect(result).toContain('Intro text');
      expect(result).toContain('Generated S1');
      expect(result).toContain('Generated S2');
      
      // No duplication — Introduction content appears only once
      const introCount = (result.match(/Intro text/g) || []).length;
      expect(introCount).toBe(1);
      
      // Correct order: Introduction before S1 before S2
      const introIdx = result.indexOf('Intro text');
      const s1Idx = result.indexOf('Generated S1');
      const s2Idx = result.indexOf('Generated S2');
      expect(introIdx).toBeLessThan(s1Idx);
      expect(s1Idx).toBeLessThan(s2Idx);
    });

    it('should handle fragments without Introduction section', () => {
      const template = `<h2>S1</h2><p>c1</p><h2>S2</h2><p>c2</p>`;
      
      const fragments = [
        '<h2>S1</h2><p>Generated S1</p>',
        '<h2>S2</h2><p>Generated S2</p>'
      ];
      
      const result = injectSectionsIntoTemplate(template, fragments);
      
      expect(result).toContain('Generated S1');
      expect(result).toContain('Generated S2');
    });

    it('should handle empty fragments gracefully', () => {
      const template = `<h1>Document</h1><h2>Section</h2>`;
      const fragments: string[] = [];
      
      const result = injectSectionsIntoTemplate(template, fragments);
      
      expect(result).toBe('');
    });
  });

  describe('injectContentIntoSimpleTemplate', () => {
    it('should replace [CONTENT: ...] placeholder', () => {
      const template = `
        <img src="s3key:logo.png" alt="Logo" />
        <h1>Document Title</h1>
        <p>[CONTENT: Write the document content here]</p>
        <p>Footer text</p>
      `;
      
      const generatedContent = '<h2>Generated Section</h2><p>Generated content</p>';
      
      const result = injectContentIntoSimpleTemplate(template, generatedContent);
      
      expect(result).toContain('src="s3key:logo.png"');
      expect(result).toContain('<h1>Document Title</h1>');
      expect(result).toContain('<h2>Generated Section</h2>');
      expect(result).toContain('Generated content');
      expect(result).toContain('Footer text');
      expect(result).not.toContain('[CONTENT:');
    });

    it('should replace <p> wrapped [CONTENT: ...] placeholder', () => {
      const template = `
        <h1>Document Title</h1>
        <p style="margin: 1em;">[CONTENT: Write content here]</p>
        <p>Footer</p>
      `;
      
      const generatedContent = '<div><h2>Section</h2><p>Content</p></div>';
      
      const result = injectContentIntoSimpleTemplate(template, generatedContent);
      
      expect(result).toContain('<h1>Document Title</h1>');
      expect(result).toContain('<div><h2>Section</h2><p>Content</p></div>');
      expect(result).toContain('<p>Footer</p>');
      expect(result).not.toContain('style="margin: 1em;"');
    });

    it('should return null if no content placeholder found', () => {
      const template = `
        <h1>Document Title</h1>
        <p>Static content</p>
      `;
      
      const generatedContent = '<h2>Generated Section</h2>';
      
      const result = injectContentIntoSimpleTemplate(template, generatedContent);
      
      expect(result).toBeNull();
    });
  });

  describe('cleanGeneratedHtml', () => {
    it('should remove preservation comments while preserving elements', () => {
      const html = `
        <!-- PRESERVE THIS IMAGE TAG EXACTLY AS-IS --><img src="s3key:logo.png" alt="Logo" />
        <!-- PRESERVE THIS STYLE BLOCK EXACTLY AS-IS --><style>.header { color: blue; }</style>
        <!-- PRESERVE STYLING --><h1 style="color: red;">Title</h1>
        <p>Content</p>
      `;
      
      const result = cleanGeneratedHtml(html);
      
      expect(result).toContain('<img src="s3key:logo.png" alt="Logo" />');
      expect(result).toContain('<style>.header { color: blue; }</style>');
      expect(result).toContain('<h1 style="color: red;">Title</h1>');
      expect(result).toContain('<p>Content</p>');
      expect(result).not.toContain('<!-- PRESERVE');
    });

    it('should log validation warnings for missing preserved elements', () => {
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
      
      const html = `
        <!-- PRESERVE THIS IMAGE TAG EXACTLY AS-IS -->
        <!-- PRESERVE THIS STYLE BLOCK EXACTLY AS-IS -->
        <p>Content without preserved elements</p>
      `;
      
      cleanGeneratedHtml(html);
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('images were lost during generation')
      );
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('style blocks were lost during generation')
      );
      
      consoleSpy.mockRestore();
    });

    it('should handle empty or null input gracefully', () => {
      expect(cleanGeneratedHtml('')).toBe('');
      expect(cleanGeneratedHtml('   ')).toBe('   ');
    });

    it('should strip [CONTENT: ...] wrappers and keep inner content', () => {
      const html = `
        <h2>Program Management Approach</h2>
        <p>[CONTENT: Horus Technologies will leverage a hybrid program management approach that combines the structure and rigor of PMBOK with Agile methodologies.]</p>
      `;

      const result = cleanGeneratedHtml(html);

      expect(result).toContain('Horus Technologies will leverage a hybrid program management approach');
      expect(result).not.toContain('[CONTENT:');
      expect(result).not.toContain(']</p>');
      // The closing ] should be removed, leaving just the content
      expect(result).toContain('Agile methodologies.</p>');
    });

    it('should strip multiple [CONTENT: ...] wrappers in the same document', () => {
      const html = `
        <p>[CONTENT: First section content here.]</p>
        <p>[CONTENT: Second section content here.]</p>
      `;

      const result = cleanGeneratedHtml(html);

      expect(result).toContain('First section content here.');
      expect(result).toContain('Second section content here.');
      expect(result).not.toContain('[CONTENT:');
    });

    it('should strip leaked scaffold instruction text', () => {
      const html = `
        <p>Sincerely,</p>
        <p>John Smith</p>
         with a complete, well-structured HTML document body including appropriate headings and paragraphs. Keep all other text and elements (dates, company name, images, styles) in their original positions. PRESERVE ALL marked elements exactly as-is. -->
      `;

      const result = cleanGeneratedHtml(html);

      expect(result).toContain('Sincerely,');
      expect(result).toContain('John Smith');
      expect(result).not.toContain('well-structured HTML document body');
      expect(result).not.toContain('PRESERVE ALL marked elements');
      expect(result).not.toContain('-->');
    });

    it('should strip trailing --> from partial scaffold comments', () => {
      const html = `<p>Content here</p> -->`;

      const result = cleanGeneratedHtml(html);

      expect(result).toContain('Content here');
      expect(result).not.toContain('-->');
    });

    it('should strip original placeholder instruction text entirely instead of preserving it', () => {
      const html = `
        <h1>Technical Proposal</h1>
        <p>[CONTENT: Write the complete document content here based on the solicitation requirements and provided context. Preserve all surrounding template elements (images, dates, company name, etc.) exactly as they appear.]</p>
      `;

      const result = cleanGeneratedHtml(html);

      expect(result).toContain('Technical Proposal');
      expect(result).not.toContain('Write the complete document content here');
      expect(result).not.toContain('solicitation requirements');
      expect(result).not.toContain('Preserve all surrounding template elements');
      expect(result).not.toContain('[CONTENT:');
    });

    it('should strip default template placeholder instruction text', () => {
      const html = `
        <p>[CONTENT: Write the complete document content here based on the solicitation requirements and provided context. Include appropriate headings, sections, and structure.]</p>
      `;

      const result = cleanGeneratedHtml(html);

      expect(result).not.toContain('Write the complete document content here');
      expect(result).not.toContain('Include appropriate headings');
    });

    it('should strip leaked placeholder instruction text without [CONTENT:] wrapper', () => {
      const html = `
        <h1>Technical Proposal</h1>
        <p>Write the complete document content here based on the solicitation requirements and provided context. Preserve all surrounding template elements (images, dates, company name, etc.) exactly as they appear.</p>
      `;

      const result = cleanGeneratedHtml(html);

      expect(result).toContain('Technical Proposal');
      expect(result).not.toContain('Write the complete document content here');
    });

    it('should strip "Replace [CONTENT:...]" instruction text', () => {
      const html = `<p>Good content.</p> Replace [CONTENT: ...] with actual document text. <p>More content.</p>`;

      const result = cleanGeneratedHtml(html);

      expect(result).toContain('Good content.');
      expect(result).toContain('More content.');
      expect(result).not.toContain('Replace [CONTENT');
    });
  });

  describe('stripTemplateImagesFromContent', () => {
    it('should strip template images from AI output', () => {
      const template = `
        <img src="s3key:org-123/logo.png" alt="Logo" />
        <p>[CONTENT: Write content here]</p>
      `;
      // AI output includes the image (because it was told to preserve it)
      const aiOutput = `
        <img src="s3key:org-123/logo.png" alt="Logo" />
        <h2>Generated Section</h2>
        <p>AI generated content</p>
      `;

      const result = stripTemplateImagesFromContent(aiOutput, template);

      // Image should be stripped from AI output (template already has it)
      expect(result).not.toContain('s3key:org-123/logo.png');
      // Content preserved
      expect(result).toContain('Generated Section');
      expect(result).toContain('AI generated content');
    });

    it('should keep images that are NOT in the template', () => {
      const template = `
        <img src="s3key:org-123/logo.png" alt="Logo" />
        <p>[CONTENT: Write content here]</p>
      `;
      const aiOutput = `
        <img src="s3key:org-123/logo.png" alt="Logo" />
        <img src="s3key:org-123/diagram.png" alt="Diagram" />
        <p>Content</p>
      `;

      const result = stripTemplateImagesFromContent(aiOutput, template);

      // Template image stripped
      expect(result).not.toContain('logo.png');
      // Non-template image kept
      expect(result).toContain('diagram.png');
    });

    it('should handle empty inputs gracefully', () => {
      expect(stripTemplateImagesFromContent('', '<img src="x" />')).toBe('');
      expect(stripTemplateImagesFromContent('<p>Content</p>', '')).toBe('<p>Content</p>');
    });

    it('should not modify content when template has no images', () => {
      const template = '<p>[CONTENT: Write here]</p>';
      const aiOutput = '<h2>Section</h2><p>Content</p>';
      const result = stripTemplateImagesFromContent(aiOutput, template);
      expect(result).toBe(aiOutput);
    });

    it('should handle multiple template images', () => {
      const template = `
        <img src="s3key:org-123/logo.png" alt="Logo" />
        <img src="s3key:org-123/banner.png" alt="Banner" />
        <p>[CONTENT: Write content here]</p>
      `;
      const aiOutput = `
        <img src="s3key:org-123/logo.png" alt="Logo" />
        <img src="s3key:org-123/banner.png" alt="Banner" />
        <h2>Section</h2>
        <p>Content</p>
      `;

      const result = stripTemplateImagesFromContent(aiOutput, template);

      expect(result).not.toContain('logo.png');
      expect(result).not.toContain('banner.png');
      expect(result).toContain('Content');
    });
  });
});
