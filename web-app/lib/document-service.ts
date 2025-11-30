import { LlamaParseResult } from "@/types/api";

const DOCUMENTS_STORAGE_KEY = 'auto_rfp_documents';

/**
 * Document store with localStorage persistence 
 * Simplified to focus only on upload functionality
 */
class DocumentStore {
  private documents: Map<string, LlamaParseResult>;
  private initialized = false;
  private isClient: boolean;

  constructor() {
    // Determine if we're in client or server environment
    this.isClient = typeof window !== 'undefined';
    
    // Initialize documents map
    this.documents = new Map();
    
    // Load saved documents if in client environment
    if (this.isClient) {
      this.loadFromStorage();
    }
  }

  /**
   * Load documents from localStorage if available (client-side only)
   */
  private loadFromStorage(): void {
    if (this.isClient && !this.initialized) {
      try {
        const savedDocs = localStorage.getItem(DOCUMENTS_STORAGE_KEY);
        if (savedDocs) {
          const parsedDocs = JSON.parse(savedDocs) as LlamaParseResult[];
          parsedDocs.forEach(doc => {
            this.documents.set(doc.documentId, doc);
          });
          console.log(`Loaded ${parsedDocs.length} documents from storage`);
        }
        this.initialized = true;
      } catch (error) {
        console.error('Error loading documents from storage:', error);
      }
    }
  }

  /**
   * Save documents to localStorage (client-side only)
   */
  private saveToStorage(): void {
    if (this.isClient) {
      try {
        const docsArray = Array.from(this.documents.values());
        localStorage.setItem(DOCUMENTS_STORAGE_KEY, JSON.stringify(docsArray));
      } catch (error) {
        console.error('Error saving documents to storage:', error);
      }
    }
  }

  /**
   * Add a document to the store
   */
  addDocument(document: LlamaParseResult): void {
    this.documents.set(document.documentId, document);
    
    // Only save to localStorage in client environment
    if (this.isClient) {
      this.saveToStorage();
    }
  }
  
  /**
   * Get all documents
   */
  getAllDocuments(): LlamaParseResult[] {
    // Ensure documents are loaded in client environment
    if (this.isClient && !this.initialized) {
      this.loadFromStorage();
    }
    return Array.from(this.documents.values());
  }
}

// Export a singleton instance
export const documentStore = new DocumentStore(); 