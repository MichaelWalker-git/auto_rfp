import { IDocumentStore } from '@/lib/interfaces/llamaparse-service';
import { LlamaParseResponse } from '@/lib/validators/llamaparse';
import { LlamaParseResult } from '@/types/api';
import { documentStore } from '@/lib/document-service';
import { DatabaseError } from '@/lib/errors/api-errors';

/**
 * Document store service wrapper implementation
 */
export class DocumentStoreService implements IDocumentStore {
  /**
   * Store a parsed document
   */
  async addDocument(document: LlamaParseResponse): Promise<void> {
    try {
      // Convert LlamaParseResponse to LlamaParseResult format expected by existing store
      const storeDocument: LlamaParseResult = {
        success: document.success,
        documentId: document.documentId,
        documentName: document.documentName,
        status: document.status,
        content: document.content,
        metadata: {
          mode: this.determineMode(document.metadata),
          wordCount: this.calculateWordCount(document.content),
          pageCount: document.metadata?.pageCount,
          summary: document.metadata?.summary,
        },
      };

      // Use the existing document store
      documentStore.addDocument(storeDocument);
      console.log(`Document stored successfully: ${document.documentId}`);
    } catch (error) {
      throw new DatabaseError(
        `Failed to store document: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get document by ID
   */
  async getDocument(documentId: string): Promise<LlamaParseResponse | null> {
    try {
      // Note: The existing documentStore doesn't have a getDocument method
      // This is a placeholder for future implementation
      console.warn('getDocument method not implemented in existing documentStore');
      return null;
    } catch (error) {
      throw new DatabaseError(
        `Failed to get document: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Get document statistics
   */
  async getStats(): Promise<{
    totalDocuments: number;
    lastProcessed: Date | null;
  }> {
    try {
      const allDocuments = documentStore.getAllDocuments();
      return {
        totalDocuments: allDocuments.length,
        lastProcessed: allDocuments.length > 0 ? new Date() : null,
      };
    } catch (error) {
      throw new DatabaseError(
        `Failed to get document stats: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }

  /**
   * Determine parsing mode from metadata
   */
  private determineMode(metadata: Record<string, any> | undefined): 'fast' | 'balanced' | 'premium' | 'complexTables' {
    if (!metadata) return 'balanced';
    
    if (metadata.complexTables) return 'complexTables';
    if (metadata.premiumMode) return 'premium';
    if (metadata.fastMode) return 'fast';
    
    return 'balanced';
  }

  /**
   * Calculate word count from content
   */
  private calculateWordCount(content: string): number {
    return content.trim().split(/\s+/).length;
  }

  /**
   * Check if document store is available
   */
  isAvailable(): boolean {
    return !!documentStore;
  }

  /**
   * Get all documents
   */
  async getAllDocuments(): Promise<LlamaParseResult[]> {
    try {
      return documentStore.getAllDocuments();
    } catch (error) {
      throw new DatabaseError(
        `Failed to get all documents: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
    }
  }
}

// Export singleton instance
export const documentStoreService = new DocumentStoreService(); 