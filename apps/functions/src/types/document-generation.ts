export interface QaPair {
  question: string;
  answer: string;
}

export interface BedrockResponse {
  content?: Array<{ text?: string }>;
  output_text?: string;
  completion?: string;
}
