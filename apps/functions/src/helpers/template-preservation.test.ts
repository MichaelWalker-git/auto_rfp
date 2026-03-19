/**
 * Tests for template preservation functionality in RFP document generation.
 * 
 * These tests verify that images, styles, and template structure are properly
 * preserved during the document generation process.
 */

// Mock environment variables to avoid dependency issues
process.env.STAGE = 'test';
process.env.DB_TABLE_NAME = 'test-table';
process.env.REGION = 'us-east-1';

import { 
  injectSectionsIntoTemplate, 
  injectContentIntoSimpleTemplate 
} from './template-section-parser';
import { prepareTemplateScaffoldForAI } from './document-generation';

// Test the cleanGeneratedHtml function directly without importing the full worker
const cleanGeneratedHtml = (html: string): string => {
  if (!html?.trim()) return html;

  // Count preserved elements before cleaning for validation
  const imageCount = (html.match(/<!-- PRESERVE THIS IMAGE TAG EXACTLY AS-IS -->/gi) || []).length;
  const styleBlockCount = (html.match(/<!-- PRESERVE THIS STYLE BLOCK EXACTLY AS-IS -->/gi) || []).length;
  const styleLinkCount = (html.match(/<!-- PRESERVE THIS STYLE LINK EXACTLY AS-IS -->/gi) || []).length;

  // Count actual preserved elements (images with s3key, style blocks, etc.)
  const actualImages = (html.match(/<img[^>]*?(?:src="s3key:[^"]*"|data-s3-key="[^"]*")[^>]*?>/gi) || []).length;
  const actualStyleBlocks = (html.match(/<style[^>]*>[\s\S]*?<\/style>/gi) || []).length;
  const actualStyleLinks = (html.match(/<link[^>]*?(?:rel="stylesheet"|type="text\/css")[^>]*?>/gi) || []).length;

  // Log validation results
  if (imageCount > 0 && actualImages < imageCount) {
    console.warn(`WARNING: ${imageCount - actualImages} images were lost during generation`);
  }
  if (styleBlockCount > 0 && actualStyleBlocks < styleBlockCount) {
    console.warn(`WARNING: ${styleBlockCount - actualStyleBlocks} style blocks were lost during generation`);
  }
  if (styleLinkCount > 0 && actualStyleLinks < styleLinkCount) {
    console.warn(`WARNING: ${styleLinkCount - actualStyleLinks} style links were lost during generation`);
  }

  return html
    .replace(/<!--\s*TEMPLATE SCAFFOLD:[\s\S]*?-->\s*/gi, '')
    .replace(/<!--\s*PRESERVE THIS IMAGE TAG EXACTLY AS-IS\s*-->\s*/gi, '')
    .replace(/<!--\s*PRESERVE THIS STYLE BLOCK EXACTLY AS-IS\s*-->\s*/gi, '')
    .replace(/<!--\s*PRESERVE THIS STYLE LINK EXACTLY AS-IS\s*-->\s*/gi, '')
    .replace(/<!--\s*PRESERVE STYLING\s*-->\s*/gi, '')
    .replace(/<!--\s*Section guidance:[\s\S]*?-->\s*/gi, '')
    .replace(/<!--\s*TEMPLATE SCAFFOLD:[^\n]*\n?/gi, '')
    .replace(/<!--\s*PRESERVE THIS IMAGE TAG[^\n]*\n?/gi, '')
    .replace(/<!--\s*PRESERVE THIS STYLE[^\n]*\n?/gi, '')
    .replace(/<!--\s*PRESERVE STYLING[^\n]*\n?/gi, '')
    .replace(/<!--\s*Section guidance:[^\n]*\n?/gi, '');
};

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
  });
});