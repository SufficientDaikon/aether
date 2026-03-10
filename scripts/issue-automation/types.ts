// Shared types for issue automation scripts

export interface Issue {
  number: number;
  title: string;
  body: string | null;
  labels: Label[];
  state: "open" | "closed";
  created_at: string;
  updated_at: string;
  user: User;
  html_url: string;
}

export interface Label {
  id: number;
  name: string;
  color: string;
  description?: string | null;
}

export interface Comment {
  id: number;
  body: string;
  user: User;
  created_at: string;
  html_url: string;
  author_association: AuthorAssociation;
}

export interface User {
  login: string;
  type: string;
}

export type AuthorAssociation =
  | "COLLABORATOR"
  | "CONTRIBUTOR"
  | "FIRST_TIMER"
  | "FIRST_TIME_CONTRIBUTOR"
  | "MANNEQUIN"
  | "MEMBER"
  | "NONE"
  | "OWNER";

export interface Reaction {
  content: string;
  user: User;
}

// LLM types
export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  choices: Array<{
    message: {
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Classification types
export interface ClassificationResult {
  labels: string[];
  confidence: number;
  reasoning: string;
}

// Duplicate detection types
export interface SimilarityResult {
  issueNumber: number;
  score: number;
  reasoning: string;
}

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  originalIssue?: number;
  score?: number;
  reasoning?: string;
}

// Spam detection types
export type SpamAction = "delete" | "flag" | "none";

export interface SpamResult {
  action: SpamAction;
  confidence: number;
  reasoning: string;
  categories: string[];
}

// Lifecycle types
export interface LifecycleCheckResult {
  shouldClose: boolean;
  reason: string;
  daysStale: number;
}

// Label definitions for bootstrap
export interface LabelDefinition {
  name: string;
  color: string;
  description: string;
}
