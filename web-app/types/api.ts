/**
 * Re-exports types from @auto-rfp/shared for backwards compatibility.
 * New code should import directly from @auto-rfp/shared.
 *
 * @deprecated Import types directly from '@auto-rfp/shared' instead
 */

import type {
  GroupedSection,
  GroupedQuestion,
  QuestionFileItem,
} from '@auto-rfp/shared';

// Type aliases for backwards compatibility
export type RfpSection = GroupedSection;
export type RfpQuestion = GroupedQuestion;
export type RfpDocument = QuestionFileItem;

// Re-export shared types for convenience
export type { GroupedSection, GroupedQuestion, QuestionFileItem };
