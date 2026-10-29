import type {
  AnnotationView,
  CommentView,
  ModelRelease,
  PublicUser,
} from '@owm/core/client';
import type { ComparisonResponseView } from '@/lib/comparison-responses';

export type { ComparisonResponseView } from '@/lib/comparison-responses';

export type ComparisonPageData = {
  comparison: {
    id: string;
    title: string;
    prompt: string;
    categories: string[];
    effort: number;
    status: string;
    createdAt: string;
    publishedAt: string | null;
    authorId: string;
  };
  author: PublicUser;
  baseModel: { slug: string; name: string; monogram: string };
  responses: ComparisonResponseView[];
  annotations: AnnotationView[];
  comments: CommentView[];
  models: Array<{
    id: string;
    slug: string;
    displayName: string;
    monogram: string;
    etaSeconds: number;
    openWeights: boolean;
    family: string;
    release: ModelRelease;
  }>;
  maxChallengers: number;
  currentUserId: string | null;
  viewerSignedIn: boolean;
  viewerSuspended: boolean;
  initialModel: string | null;
  initialAnnOn: boolean;
  handle: string | null;
};

export type AddableModel = ComparisonPageData['models'][number];

/** The Prompt and position of one Turn, shared by both response columns. */
export type TurnInfo = { position: number; prompt: string };

export type RunAction = 'retry' | 'dismiss';
