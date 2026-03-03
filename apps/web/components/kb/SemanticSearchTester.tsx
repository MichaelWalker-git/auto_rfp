'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Search, Loader2, ChevronDown, ChevronUp, FileText, Star, BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiMutate, buildApiUrl } from '@/lib/hooks/api-helpers';

// ─── Types ────────────────────────────────────────────────────────────────────

interface SemanticResult {
  chunkKey?: string;
  score: number;
  text: string;
  sourceType?: 'chunk' | 'content_library' | 'past_performance';
}

interface PastPerformanceResult {
  projectId: string;
  score: number;
  title: string;
  client: string;
  description: string;
  technicalApproach?: string | null;
  achievements: string[];
  technologies: string[];
  domain?: string | null;
  value?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  performanceRating?: number | null;
}

interface SearchResponse {
  question: string;
  topK: number;
  results: SemanticResult[];
  pastPerformance: PastPerformanceResult[];
}

// ─── Form schema ──────────────────────────────────────────────────────────────

const SearchFormSchema = z.object({
  question: z.string().trim().min(1, 'Question is required'),
  topK: z.coerce.number().int().min(1).max(50).default(10),
});

type SearchFormValues = z.input<typeof SearchFormSchema>;

// ─── Score badge ──────────────────────────────────────────────────────────────

const ScoreBadge = ({ score }: { score: number }) => {
  const pct = Math.round(score * 100);
  const color =
    pct >= 80 ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
    pct >= 60 ? 'bg-blue-100 text-blue-700 border-blue-200' :
    pct >= 40 ? 'bg-amber-100 text-amber-700 border-amber-200' :
    'bg-gray-100 text-gray-600 border-gray-200';
  return (
    <Badge variant="outline" className={`text-xs font-mono ${color}`}>
      {pct}%
    </Badge>
  );
};

// ─── Expandable text ──────────────────────────────────────────────────────────

const ExpandableText = ({ text, maxLines = 4 }: { text: string; maxLines?: number }) => {
  const [expanded, setExpanded] = useState(false);
  const lines = text.split('\n');
  const isLong = lines.length > maxLines || text.length > 400;

  return (
    <div>
      <pre
        className={`text-xs text-muted-foreground whitespace-pre-wrap font-sans leading-relaxed ${
          !expanded && isLong ? 'line-clamp-4' : ''
        }`}
      >
        {text}
      </pre>
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-xs text-primary hover:underline flex items-center gap-0.5"
        >
          {expanded ? <><ChevronUp className="h-3 w-3" /> Show less</> : <><ChevronDown className="h-3 w-3" /> Show more</>}
        </button>
      )}
    </div>
  );
};

// ─── Props ────────────────────────────────────────────────────────────────────

interface SemanticSearchTesterProps {
  orgId: string;
  projectId?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export const SemanticSearchTester = ({ orgId, projectId }: SemanticSearchTesterProps) => {
  const [results, setResults] = useState<SearchResponse | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<SearchFormValues>({
    resolver: zodResolver(SearchFormSchema),
    defaultValues: { question: '', topK: 10 },
  });

  const onSubmit = async (values: SearchFormValues) => {
    setIsSearching(true);
    setSearchError(null);
    setResults(null);

    try {
      const response = await apiMutate<SearchResponse>(
        buildApiUrl('semantic/search', { orgId }),
        'POST',
        {
          question: values.question,
          topK: values.topK,
          projectId: projectId || undefined,
          includePastPerformance: true,
        },
      );
      setResults(response);
    } catch (err: unknown) {
      setSearchError((err as Error)?.message || 'Search failed');
    } finally {
      setIsSearching(false);
    }
  };

  const kbChunks = results?.results.filter(r => r.sourceType === 'chunk') ?? [];
  const clItems = results?.results.filter(r => r.sourceType === 'content_library') ?? [];
  const ppItems = results?.pastPerformance ?? [];

  return (
    <div className="space-y-6">
      {/* Search form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Semantic Search Tester
          </CardTitle>
          <CardDescription>
            Test semantic search across your knowledge base, content library, and past performance.
            {projectId && <span className="ml-1 text-primary">Scoped to project-linked KBs.</span>}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit(onSubmit)} className="flex gap-3 items-end">
            <div className="flex-1 grid gap-1.5">
              <Label htmlFor="search-question">Search query</Label>
              <Input
                id="search-question"
                placeholder="e.g. cloud migration experience AWS federal agency"
                {...register('question')}
              />
              {errors.question && <p className="text-xs text-destructive">{errors.question.message}</p>}
            </div>
            <div className="w-24 grid gap-1.5">
              <Label htmlFor="search-topk">Top K</Label>
              <Input
                id="search-topk"
                type="number"
                min={1}
                max={50}
                {...register('topK')}
              />
            </div>
            <Button type="submit" disabled={isSearching} className="gap-2">
              {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {isSearching ? 'Searching…' : 'Search'}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Error */}
      {searchError && (
        <Card className="border-destructive">
          <CardContent className="pt-4">
            <p className="text-sm text-destructive">{searchError}</p>
          </CardContent>
        </Card>
      )}

      {/* Results */}
      {results && (
        <div className="space-y-4">
          {/* Summary */}
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <span>Query: <span className="font-medium text-foreground">"{results.question}"</span></span>
            <Separator orientation="vertical" className="h-4" />
            <span>{kbChunks.length} KB chunks</span>
            <span>·</span>
            <span>{clItems.length} content library</span>
            <span>·</span>
            <span>{ppItems.length} past performance</span>
          </div>

          <Tabs defaultValue="kb">
            <TabsList>
              <TabsTrigger value="kb" className="gap-1.5">
                <FileText className="h-3.5 w-3.5" />
                KB Chunks
                <Badge variant="secondary" className="ml-1 text-xs">{kbChunks.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="cl" className="gap-1.5">
                <BookOpen className="h-3.5 w-3.5" />
                Q&A Library
                <Badge variant="secondary" className="ml-1 text-xs">{clItems.length}</Badge>
              </TabsTrigger>
              <TabsTrigger value="pp" className="gap-1.5">
                <Star className="h-3.5 w-3.5" />
                Past Performance
                <Badge variant="secondary" className="ml-1 text-xs">{ppItems.length}</Badge>
              </TabsTrigger>
            </TabsList>

            {/* KB Chunks */}
            <TabsContent value="kb" className="space-y-3 mt-4">
              {kbChunks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No KB chunks found.</p>
              ) : (
                kbChunks.map((r, i) => (
                  <Card key={i} className="overflow-hidden">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-xs font-mono text-muted-foreground shrink-0">#{i + 1}</span>
                          {r.chunkKey && (
                            <span className="text-xs text-muted-foreground truncate font-mono">{r.chunkKey.split('/').pop()}</span>
                          )}
                        </div>
                        <ScoreBadge score={r.score} />
                      </div>
                      <ExpandableText text={r.text} />
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            {/* Content Library */}
            <TabsContent value="cl" className="space-y-3 mt-4">
              {clItems.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No content library matches found.</p>
              ) : (
                clItems.map((r, i) => (
                  <Card key={i} className="overflow-hidden">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <span className="text-xs font-mono text-muted-foreground">#{i + 1}</span>
                        <ScoreBadge score={r.score} />
                      </div>
                      <ExpandableText text={r.text} />
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>

            {/* Past Performance */}
            <TabsContent value="pp" className="space-y-3 mt-4">
              {ppItems.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8">No past performance matches found.</p>
              ) : (
                ppItems.map((r, i) => (
                  <Card key={i} className="overflow-hidden">
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium text-sm">{r.title}</p>
                          <p className="text-xs text-muted-foreground">{r.client}{r.domain ? ` · ${r.domain}` : ''}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {r.performanceRating && (
                            <Badge variant="outline" className="text-xs gap-1">
                              <Star className="h-3 w-3" />
                              {r.performanceRating}/5
                            </Badge>
                          )}
                          <ScoreBadge score={r.score} />
                        </div>
                      </div>

                      {r.description && (
                        <ExpandableText text={r.description} maxLines={3} />
                      )}

                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {r.value && (
                          <Badge variant="outline" className="text-xs">
                            ${r.value.toLocaleString()}
                          </Badge>
                        )}
                        {r.startDate && r.endDate && (
                          <Badge variant="outline" className="text-xs">
                            {r.startDate} – {r.endDate}
                          </Badge>
                        )}
                        {r.technologies.slice(0, 5).map(t => (
                          <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                        ))}
                        {r.achievements.slice(0, 2).map((a, ai) => (
                          <span key={ai} className="text-xs text-muted-foreground">• {a}</span>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))
              )}
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  );
};
