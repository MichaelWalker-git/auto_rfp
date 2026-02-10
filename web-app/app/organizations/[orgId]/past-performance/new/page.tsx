'use client';

import React from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Separator } from '@/components/ui/separator';
import { 
  ArrowLeft,
  Loader2, 
  Briefcase,
  Save
} from 'lucide-react';
import { useCreatePastProject } from '@/lib/hooks/use-past-performance';
import { useToast } from '@/components/ui/use-toast';
import Link from 'next/link';

const PastProjectFormSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  client: z.string().min(1, 'Client name is required'),
  description: z.string().min(10, 'Description must be at least 10 characters'),
  contractNumber: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  value: z.coerce.number().optional(),
  technicalApproach: z.string().optional(),
  achievements: z.string().optional(),
  performanceRating: z.coerce.number().min(1).max(5).optional(),
  domain: z.string().optional(),
  technologies: z.string().optional(),
  naicsCodes: z.string().optional(),
  contractType: z.string().optional(),
  setAside: z.string().optional(),
  teamSize: z.coerce.number().optional(),
  clientPOCName: z.string().optional(),
  clientPOCEmail: z.string().email().optional().or(z.literal('')),
  clientPOCPhone: z.string().optional(),
});

type PastProjectFormData = z.infer<typeof PastProjectFormSchema>;

export default function NewPastProjectPage() {
  const params = useParams();
  const router = useRouter();
  const orgId = params.orgId as string;
  const createProject = useCreatePastProject();
  const { toast } = useToast();

  const form = useForm<PastProjectFormData>({
    resolver: zodResolver(PastProjectFormSchema),
    defaultValues: {
      title: '',
      client: '',
      description: '',
      contractNumber: '',
      startDate: '',
      endDate: '',
      value: undefined,
      technicalApproach: '',
      achievements: '',
      performanceRating: undefined,
      domain: '',
      technologies: '',
      naicsCodes: '',
      contractType: '',
      setAside: '',
      teamSize: undefined,
      clientPOCName: '',
      clientPOCEmail: '',
      clientPOCPhone: '',
    },
  });

  const { formState: { isSubmitting } } = form;

  const onSubmit = async (data: PastProjectFormData) => {
    try {
      const payload = {
        orgId,
        title: data.title,
        client: data.client,
        description: data.description,
        contractNumber: data.contractNumber || undefined,
        startDate: data.startDate || undefined,
        endDate: data.endDate || undefined,
        value: data.value || undefined,
        technicalApproach: data.technicalApproach || undefined,
        achievements: data.achievements ? data.achievements.split('\n').filter(Boolean) : [],
        performanceRating: data.performanceRating || undefined,
        domain: data.domain || undefined,
        technologies: data.technologies ? data.technologies.split(',').map(t => t.trim()).filter(Boolean) : [],
        naicsCodes: data.naicsCodes ? data.naicsCodes.split(',').map(n => n.trim()).filter(Boolean) : [],
        contractType: data.contractType || undefined,
        setAside: data.setAside || undefined,
        teamSize: data.teamSize || undefined,
        clientPOC: data.clientPOCName ? {
          name: data.clientPOCName,
          email: data.clientPOCEmail || undefined,
          phone: data.clientPOCPhone || undefined,
        } : undefined,
      };

      await createProject.trigger(payload);
      
      toast({
        title: 'Project Created',
        description: `"${data.title}" has been added to your past performance database.`,
      });
      
      router.push(`/organizations/${orgId}/past-performance`);
    } catch (error) {
      console.error('Failed to create past project:', error);
      toast({
        title: 'Error',
        description: 'Failed to create project. Please try again.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="container max-w-4xl mx-auto py-6 px-4">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <Link 
            href={`/organizations/${orgId}/past-performance`}
            className="p-2 hover:bg-muted rounded-lg transition-colors"
            title="Back to Past Performance"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="p-2 bg-primary/10 rounded-lg">
            <Briefcase className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">Add Past Performance Project</h1>
            <p className="text-muted-foreground">
              Add a completed project to your database for RFP matching
            </p>
          </div>
        </div>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
              <CardDescription>Core project details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="title"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Project Title *</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Cloud Migration for DoD" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="client"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Client Name *</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Department of Defense" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Project Description *</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Describe the project scope, objectives, and outcomes..."
                        rows={4}
                        {...field} 
                      />
                    </FormControl>
                    <FormDescription>
                      Be specific about deliverables and outcomes (min. 10 characters)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="contractNumber"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contract Number</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., FA8750-21-C-0001" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="domain"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Domain/Industry</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Defense, Healthcare" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* Contract Details */}
          <Card>
            <CardHeader>
              <CardTitle>Contract Details</CardTitle>
              <CardDescription>Timeline, value, and contract information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-4 gap-4">
                <FormField
                  control={form.control}
                  name="startDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Start Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="endDate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>End Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="value"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contract Value ($)</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          placeholder="5000000" 
                          {...field} 
                          value={field.value ?? ''} 
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="teamSize"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Team Size</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          placeholder="25" 
                          {...field} 
                          value={field.value ?? ''} 
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="contractType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contract Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ''}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select type" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="FFP">Firm Fixed Price (FFP)</SelectItem>
                          <SelectItem value="T&M">Time & Materials (T&M)</SelectItem>
                          <SelectItem value="CPFF">Cost Plus Fixed Fee (CPFF)</SelectItem>
                          <SelectItem value="CPAF">Cost Plus Award Fee (CPAF)</SelectItem>
                          <SelectItem value="IDIQ">IDIQ</SelectItem>
                          <SelectItem value="BPA">BPA</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="setAside"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Set-Aside</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value || ''}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select set-aside" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="NONE">Full & Open Competition</SelectItem>
                          <SelectItem value="SB">Small Business (SB)</SelectItem>
                          <SelectItem value="8A">8(a) Business Development</SelectItem>
                          <SelectItem value="SDVOSB">Service-Disabled Veteran (SDVOSB)</SelectItem>
                          <SelectItem value="WOSB">Women-Owned (WOSB)</SelectItem>
                          <SelectItem value="HUBZone">HUBZone</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="performanceRating"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Performance Rating</FormLabel>
                      <Select 
                        onValueChange={(v) => field.onChange(parseInt(v))} 
                        value={field.value?.toString() || ''}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select rating" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="5">5 - Exceptional</SelectItem>
                          <SelectItem value="4">4 - Very Good</SelectItem>
                          <SelectItem value="3">3 - Satisfactory</SelectItem>
                          <SelectItem value="2">2 - Marginal</SelectItem>
                          <SelectItem value="1">1 - Unsatisfactory</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* Technical Details */}
          <Card>
            <CardHeader>
              <CardTitle>Technical Details</CardTitle>
              <CardDescription>Approach, achievements, and technologies</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <FormField
                control={form.control}
                name="technicalApproach"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Technical Approach</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Describe the technical approach, methodologies, and solutions used..."
                        rows={3}
                        {...field} 
                      />
                    </FormControl>
                    <FormDescription>
                      Include methodologies, frameworks, and key technical decisions
                    </FormDescription>
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="achievements"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Key Achievements</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Reduced costs by 30%&#10;Improved system uptime to 99.9%&#10;Migrated 500+ applications"
                        rows={3}
                        {...field} 
                      />
                    </FormControl>
                    <FormDescription>
                      One achievement per line. Quantify where possible.
                    </FormDescription>
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="technologies"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Technologies Used</FormLabel>
                      <FormControl>
                        <Input placeholder="AWS, Kubernetes, Python, React" {...field} />
                      </FormControl>
                      <FormDescription>Comma-separated list</FormDescription>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="naicsCodes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>NAICS Codes</FormLabel>
                      <FormControl>
                        <Input placeholder="541512, 541519, 518210" {...field} />
                      </FormControl>
                      <FormDescription>Comma-separated list</FormDescription>
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* Client Contact */}
          <Card>
            <CardHeader>
              <CardTitle>Client Reference</CardTitle>
              <CardDescription>Contact information for past performance verification</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <FormField
                  control={form.control}
                  name="clientPOCName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Contact Name</FormLabel>
                      <FormControl>
                        <Input placeholder="John Smith" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="clientPOCEmail"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Email Address</FormLabel>
                      <FormControl>
                        <Input type="email" placeholder="john.smith@agency.gov" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="clientPOCPhone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Phone Number</FormLabel>
                      <FormControl>
                        <Input placeholder="(555) 123-4567" {...field} />
                      </FormControl>
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>

          {/* Actions */}
          <Separator />
          <div className="flex items-center justify-between">
            <Button 
              type="button" 
              variant="outline"
              onClick={() => router.push(`/organizations/${orgId}/past-performance`)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Save className="h-4 w-4 mr-2" />
                  Create Project
                </>
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}