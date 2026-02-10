'use client';

import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  AlertCircle, 
  ArrowRight,
  Briefcase,
  Calendar, 
  CheckCircle2, 
  Clock, 
  FileSearch,
  FileText, 
  FolderOpen,
  HelpCircle,
  ListChecks,
  Target
} from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { useProject, useQuestions } from '@/lib/hooks/use-api';
import { useProjectOutcome } from '@/lib/hooks/use-project-outcome';
import { useGetExecutiveBriefByProject } from '@/lib/hooks/use-executive-brief';
import { useFOIARequests } from '@/lib/hooks/use-foia-requests';
import {
  NoRfpDocumentAvailable,
  useQuestions as useQuestionsProvider
} from '@/app/organizations/[orgId]/projects/[projectId]/questions/components';
import { useEffect, useState } from 'react';

interface ProjectOverviewProps {
  projectId: string;
}

export function ProjectOverview({ projectId }: ProjectOverviewProps) {
  const { questionFiles, isLoading: isQL, error: err } = useQuestionsProvider();
  const { data: project, isLoading: projectLoading, error: projectError } = useProject(projectId);
  const { data: questions, isLoading: questionsLoading, error: questionsError } = useQuestions(projectId);
  const { outcome } = useProjectOutcome(project?.orgId ?? null, projectId);
  const getBriefByProject = useGetExecutiveBriefByProject();
  const { foiaRequests } = useFOIARequests(project?.orgId ?? '', projectId);
  
  const [briefItem, setBriefItem] = useState<any>(null);

  // Fetch executive brief
  useEffect(() => {
    if (projectId) {
      getBriefByProject.trigger({ projectId }).then((resp) => {
        if (resp?.ok && resp?.brief) {
          setBriefItem(resp.brief);
        }
      }).catch(() => {});
    }
  }, [projectId]);

  // Early return after all hooks
  if (!isQL && !err && !questionFiles?.length) {
    return <NoRfpDocumentAvailable projectId={projectId}/>;
  }

  const isLoading = questionsLoading || projectLoading;

  // Calculate project metrics
  const getTotalQuestions = () => questions?.sections?.reduce((total: any, section: any) => total + section.questions.length, 0) || 0;
  const getAnsweredQuestions = () => {
    if (!questions) return 0;
    return questions?.sections?.reduce((total: any, section: any) => {
      return total + section.questions.filter((q: any) => q.answer).length;
    }, 0);
  };

  const totalQuestions = getTotalQuestions();
  const answeredQuestions = getAnsweredQuestions();
  const completionPercentage = totalQuestions > 0 ? Math.round((answeredQuestions / totalQuestions) * 100) : 0;

  // Calculate brief sections status
  const getBriefSectionsStatus = () => {
    if (!briefItem?.sections) return { complete: 0, total: 6 };
    const sections = briefItem.sections;
    let complete = 0;
    const sectionKeys = ['summary', 'deadlines', 'contacts', 'requirements', 'risks', 'pastPerformance'];
    sectionKeys.forEach(key => {
      if (sections[key]?.status === 'COMPLETE') complete++;
    });
    return { complete, total: 6 };
  };

  const briefStatus = getBriefSectionsStatus();

  if (isLoading) {
    return (
      <div className="space-y-6 p-12">
        <Skeleton className="h-10 w-64"/>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="pb-2">
                <Skeleton className="h-4 w-20"/>
              </CardHeader>
              <CardContent>
                <Skeleton className="h-10 w-16 mb-1"/>
                <Skeleton className="h-3 w-32"/>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  if (projectError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4"/>
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{projectError.message}</AlertDescription>
      </Alert>
    );
  }

  if (questionsError) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4"/>
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{questionsError.message}</AlertDescription>
      </Alert>
    );
  }

  if (!project) {
    return (
      <Alert>
        <AlertCircle className="h-4 w-4"/>
        <AlertTitle>Project Not Found</AlertTitle>
        <AlertDescription>The requested project could not be found.</AlertDescription>
      </Alert>
    );
  }

  // Format dates
  const createdAt = new Date(project.createdAt);
  const updatedAt = new Date(project.updatedAt);
  const createdAtFormatted = format(createdAt, 'MMM d, yyyy');
  const updatedAtRelative = formatDistanceToNow(updatedAt, { addSuffix: true });

  const baseUrl = `/organizations/${project.orgId}/projects/${projectId}`;

  return (
    <div className="space-y-6 p-12">
      {/* Project Header */}
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-semibold mb-2">{project.name}</h1>
          {project.description && (
            <p className="text-muted-foreground">{project.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="h-4 w-4"/>
          <span>Created {createdAtFormatted}</span>
          <span className="mx-2">"</span>
          <Clock className="h-4 w-4"/>
          <span>Updated {updatedAtRelative}</span>
        </div>
      </div>

      {/* Dashboard Cards Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Executive Brief Card */}
        <Card className="hover:border-primary/50 transition-colors">
          <Link href={`${baseUrl}/brief`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Executive Brief</CardTitle>
              <Target className="h-4 w-4 text-muted-foreground"/>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{briefStatus.complete}/{briefStatus.total}</div>
              <p className="text-xs text-muted-foreground">sections complete</p>
              <Progress value={(briefStatus.complete / briefStatus.total) * 100} className="h-1 mt-2"/>
              <div className="flex items-center justify-between mt-3">
                <Badge variant={briefStatus.complete === briefStatus.total ? 'default' : 'secondary'} className="text-xs">
                  {briefStatus.complete === briefStatus.total ? 'Complete' : 'In Progress'}
                </Badge>
                <ArrowRight className="h-4 w-4 text-muted-foreground"/>
              </div>
            </CardContent>
          </Link>
        </Card>

        {/* Questions Card */}
        <Card className="hover:border-primary/50 transition-colors">
          <Link href={`${baseUrl}/questions`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Questions</CardTitle>
              <HelpCircle className="h-4 w-4 text-muted-foreground"/>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{answeredQuestions}/{totalQuestions}</div>
              <p className="text-xs text-muted-foreground">questions answered</p>
              <Progress value={completionPercentage} className="h-1 mt-2"/>
              <div className="flex items-center justify-between mt-3">
                <Badge variant={completionPercentage === 100 ? 'default' : 'secondary'} className="text-xs">
                  {completionPercentage}% complete
                </Badge>
                <ArrowRight className="h-4 w-4 text-muted-foreground"/>
              </div>
            </CardContent>
          </Link>
        </Card>

        {/* Documents Card */}
        <Card className="hover:border-primary/50 transition-colors">
          <Link href={`${baseUrl}/documents`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Documents</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground"/>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{questionFiles?.length || 0}</div>
              <p className="text-xs text-muted-foreground">RFP documents</p>
              <div className="flex items-center justify-between mt-5">
                <Badge variant="outline" className="text-xs">
                  {questionFiles?.length ? 'Uploaded' : 'None'}
                </Badge>
                <ArrowRight className="h-4 w-4 text-muted-foreground"/>
              </div>
            </CardContent>
          </Link>
        </Card>

        {/* Proposals Card */}
        <Card className="hover:border-primary/50 transition-colors">
          <Link href={`${baseUrl}/proposals`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Proposals</CardTitle>
              <Briefcase className="h-4 w-4 text-muted-foreground"/>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold"></div>
              <p className="text-xs text-muted-foreground">generated proposals</p>
              <div className="flex items-center justify-between mt-5">
                <Badge variant="outline" className="text-xs">
                  View All
                </Badge>
                <ArrowRight className="h-4 w-4 text-muted-foreground"/>
              </div>
            </CardContent>
          </Link>
        </Card>
      </div>

      {/* Second Row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {/* Opportunities Card */}
        <Card className="hover:border-primary/50 transition-colors">
          <Link href={`${baseUrl}/opportunities`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Opportunities</CardTitle>
              <ListChecks className="h-4 w-4 text-muted-foreground"/>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold"></div>
              <p className="text-xs text-muted-foreground">SAM.gov opportunities</p>
              <div className="flex items-center justify-between mt-5">
                <Badge variant="outline" className="text-xs">
                  Search
                </Badge>
                <ArrowRight className="h-4 w-4 text-muted-foreground"/>
              </div>
            </CardContent>
          </Link>
        </Card>

        {/* Outcomes Card */}
        <Card className="hover:border-primary/50 transition-colors">
          <Link href={`${baseUrl}/outcomes`}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Outcome</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-muted-foreground"/>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{outcome?.status || ''}</div>
              <p className="text-xs text-muted-foreground">project outcome</p>
              <div className="flex items-center justify-between mt-5">
                <Badge 
                  variant={outcome?.status === 'WON' ? 'default' : outcome?.status === 'LOST' ? 'destructive' : 'outline'} 
                  className="text-xs"
                >
                  {outcome?.status || 'Not Set'}
                </Badge>
                <ArrowRight className="h-4 w-4 text-muted-foreground"/>
              </div>
            </CardContent>
          </Link>
        </Card>

        {/* FOIA Card - Only show if outcome is LOST */}
        {outcome?.status === 'LOST' && (
          <Card className="hover:border-primary/50 transition-colors">
            <Link href={`${baseUrl}/foia`}>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">FOIA Requests</CardTitle>
                <FileSearch className="h-4 w-4 text-muted-foreground"/>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{foiaRequests?.length || 0}</div>
                <p className="text-xs text-muted-foreground">FOIA requests</p>
                <div className="flex items-center justify-between mt-5">
                  <Badge variant="outline" className="text-xs">
                    {foiaRequests?.length ? 'Active' : 'None'}
                  </Badge>
                  <ArrowRight className="h-4 w-4 text-muted-foreground"/>
                </div>
              </CardContent>
            </Link>
          </Card>
        )}

        {/* Sections Summary Card */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Sections</CardTitle>
            <FolderOpen className="h-4 w-4 text-muted-foreground"/>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{questions?.sections?.length || 0}</div>
            <p className="text-xs text-muted-foreground">question sections</p>
            <div className="flex items-center justify-between mt-5">
              <Badge variant="outline" className="text-xs">
                {questions?.sections?.length || 0} total
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Quick Actions</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`${baseUrl}/brief`}>
              <Target className="h-4 w-4 mr-2"/>
              View Executive Brief
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`${baseUrl}/questions`}>
              <HelpCircle className="h-4 w-4 mr-2"/>
              Answer Questions
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`${baseUrl}/documents`}>
              <FileText className="h-4 w-4 mr-2"/>
              Upload Documents
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`${baseUrl}/proposals`}>
              <Briefcase className="h-4 w-4 mr-2"/>
              Generate Proposal
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}